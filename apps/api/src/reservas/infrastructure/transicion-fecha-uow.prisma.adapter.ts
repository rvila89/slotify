/**
 * Adaptador de la UNIDAD DE TRABAJO transaccional de la transición «añadir fecha»
 * (US-005 / UC-04).
 *
 * Implementa `UnidadDeTrabajoTransicionPort`: abre UN único `prisma.$transaction`,
 * fija el contexto RLS con `fijarTenant(tx, tenantId)` (`SET LOCAL app.tenant_id`)
 * como PRIMERA operación, y expone los repositorios tx-bound de la transición. Si el
 * `trabajo` rechaza con un error no reintentable, la transacción revierte por
 * completo (all-or-nothing). El email de confirmación (efecto post-commit) vive
 * FUERA de aquí, en el caso de uso.
 *
 * Concurrencia D4 (idéntica a US-004): ante un `P2002` por el UNIQUE
 * `(tenant_id, fecha)` de FECHA_BLOQUEADA (la fecha la ganó otra transición), REABRE
 * la transacción y reintenta. Como la determinación del sub-estado vive DENTRO del
 * `trabajo`, el reintento re-deriva automáticamente a `2.d` cuando la fecha pasa a
 * `bloqueada-por-2b`. Reutiliza la primitiva `bloquearEnTx` de US-040 (sin SQL nuevo
 * de bloqueo) y la serialización de `posicion_cola` por la fila bloqueante.
 *
 * REGLA CRÍTICA (atomic-date-lock): la exclusión mutua vive SOLO en PostgreSQL
 * (`UNIQUE(tenant_id, fecha)` + `SELECT … FOR UPDATE`); nada de Redis/locks
 * distribuidos.
 */
import { Injectable } from '@nestjs/common';
import {
  AccionAudit,
  CodigoEmail,
  EstadoComunicacion,
  Prisma,
  SubEstadoConsulta,
} from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  AuditLogPort,
  RegistroAuditoria,
} from '../../shared/audit/audit-log.port';
import type {
  ActualizarReservaTransicionParams,
  ComunicacionTransicion,
  ComunicacionTransicionRepositoryPort,
  CrearComunicacionTransicionParams,
  EstadoFechaTransicion,
  FechaBloqueadaTransicionRepositoryPort,
  RepositoriosTransicionFecha,
  ReservaTransicion,
  ReservaTransicionRepositoryPort,
  UnidadDeTrabajoTransicionPort,
} from '../application/transicion-fecha.use-case';
import type { EstadoReserva as EstadoReservaDominio } from '../domain/maquina-estados';
import type { PlanBloqueo } from '../domain/bloquear-fecha.service';
import { FechaBloqueadaPrismaAdapter } from './fecha-bloqueada.prisma.adapter';
import {
  subEstadoDominioAPrisma,
  subEstadoPrismaADominio,
  type SubEstadoConsultaPrisma,
} from './sub-estado-consulta.mapper';

const formatearFecha = (fecha: Date): string => fecha.toISOString().slice(0, 10);

/** Repositorio de RESERVA tx-bound: lee el origen y aplica el UPDATE de la transición. */
class ReservaTransicionPrismaRepository implements ReservaTransicionRepositoryPort {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async buscarPorId(params: {
    tenantId: string;
    reservaId: string;
  }): Promise<ReservaTransicion | null> {
    const fila = await this.tx.reserva.findFirst({
      where: { idReserva: params.reservaId, tenantId: params.tenantId },
      include: { cliente: { select: { email: true } } },
    });
    if (fila === null) {
      return null;
    }
    return {
      idReserva: fila.idReserva,
      tenantId: fila.tenantId,
      clienteId: fila.clienteId,
      estado: fila.estado as EstadoReservaDominio,
      subEstado:
        fila.subEstado === null
          ? null
          : subEstadoPrismaADominio(fila.subEstado as SubEstadoConsultaPrisma),
      ttlExpiracion: fila.ttlExpiracion,
      fechaEvento: fila.fechaEvento,
      posicionCola: fila.posicionCola,
      consultaBloqueanteId: fila.consultaBloqueanteId,
      clienteEmail: fila.cliente?.email ?? '',
    };
  }

  async actualizar(
    p: ActualizarReservaTransicionParams,
  ): Promise<ReservaTransicion> {
    const fila = await this.tx.reserva.update({
      where: { idReserva: p.idReserva },
      data: {
        subEstado: subEstadoDominioAPrisma(p.subEstado) as SubEstadoConsulta,
        ...(p.fechaEvento !== undefined ? { fechaEvento: p.fechaEvento } : {}),
        ...(p.ttlExpiracion !== undefined ? { ttlExpiracion: p.ttlExpiracion } : {}),
        ...(p.posicionCola !== undefined ? { posicionCola: p.posicionCola } : {}),
        ...(p.consultaBloqueanteId !== undefined
          ? { consultaBloqueanteId: p.consultaBloqueanteId }
          : {}),
      },
      include: { cliente: { select: { email: true } } },
    });
    return {
      idReserva: fila.idReserva,
      tenantId: fila.tenantId,
      clienteId: fila.clienteId,
      estado: fila.estado as EstadoReservaDominio,
      subEstado:
        fila.subEstado === null
          ? null
          : subEstadoPrismaADominio(fila.subEstado as SubEstadoConsultaPrisma),
      ttlExpiracion: fila.ttlExpiracion,
      fechaEvento: fila.fechaEvento,
      posicionCola: fila.posicionCola,
      consultaBloqueanteId: fila.consultaBloqueanteId,
      clienteEmail: fila.cliente?.email ?? '',
    };
  }
}

/** Repositorio de COMUNICACION tx-bound (confirmación de bloqueo provisional, E1). */
class ComunicacionTransicionPrismaRepository
  implements ComunicacionTransicionRepositoryPort
{
  constructor(private readonly tx: Prisma.TransactionClient) {}

  /**
   * UPSERT de la fila `(reserva_id, codigo_email='E1')` (decisión humana US-005 QA,
   * Opción A). Toda RESERVA en `2.a` ya tiene su E1 (la respuesta inicial del alta
   * US-003/004), de modo que un `create` violaría SIEMPRE el UNIQUE parcial
   * `uq_comunicacion_reserva_codigo (reserva_id, codigo_email) WHERE reserva_id IS
   * NOT NULL` (P2002). Se reutiliza esa fila: si existe, se ACTUALIZA
   * `asunto/cuerpo/estado/fecha_envio/destinatario_email` con el contenido de la
   * confirmación de bloqueo provisional (reenvío); si no existe, se INSERTA.
   *
   * El UPSERT se hace manual (`findFirst` + `update`/`create`) porque el índice es
   * PARCIAL (predicado `WHERE`) y Prisma no lo modela como `@@unique`, por lo que su
   * `upsert` declarativo no es aplicable. Es seguro dentro de la transacción: en este
   * flujo el único escritor de la E1 de la reserva es esta transición (la RESERVA
   * está bloqueada por el camino `2.b`), así que no puede ocurrir un P2002 de
   * comunicación que dispare el retry de re-derivación a cola de la UoW (ese retry es
   * SOLO para colisiones de `fecha`/`posicion_cola`).
   */
  async crear(
    p: CrearComunicacionTransicionParams,
  ): Promise<ComunicacionTransicion> {
    const existente = await this.tx.comunicacion.findFirst({
      where: {
        tenantId: p.tenantId,
        reservaId: p.reservaId,
        codigoEmail: CodigoEmail.E1,
      },
      select: { idComunicacion: true },
    });

    const datos = {
      asunto: p.asunto,
      cuerpo: p.cuerpo,
      destinatarioEmail: p.destinatarioEmail,
      estado: EstadoComunicacion.borrador,
      fechaEnvio: p.fechaEnvio,
    };

    const fila =
      existente === null
        ? await this.tx.comunicacion.create({
            data: {
              tenantId: p.tenantId,
              reservaId: p.reservaId,
              clienteId: p.clienteId,
              codigoEmail: CodigoEmail.E1,
              ...datos,
            },
          })
        : await this.tx.comunicacion.update({
            where: { idComunicacion: existente.idComunicacion },
            data: datos,
          });

    return {
      idComunicacion: fila.idComunicacion,
      tenantId: fila.tenantId,
      reservaId: fila.reservaId ?? p.reservaId,
      clienteId: fila.clienteId,
      codigoEmail: 'E1',
      estado: 'borrador',
      destinatarioEmail: fila.destinatarioEmail,
      fechaEnvio: fila.fechaEnvio,
    };
  }
}

/**
 * Repositorio de AUDIT_LOG tx-bound de la transición: escribe DENTRO de la
 * transacción para que la auditoría comparta el destino del rollback. Soporta
 * `datosAnteriores`/`datosNuevos` (la transición registra ambos: `2a → destino`).
 */
class AuditLogTransicionPrismaRepository implements AuditLogPort {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async registrar(registro: RegistroAuditoria): Promise<void> {
    const datosAnteriores = registro.datosAnteriores as
      | Prisma.InputJsonValue
      | undefined;
    const datosNuevos = registro.datosNuevos as Prisma.InputJsonValue | undefined;
    await this.tx.auditLog.create({
      data: {
        tenantId: registro.tenantId,
        usuarioId: registro.usuarioId ?? null,
        entidad: registro.entidad ?? 'Sistema',
        entidadId: registro.entidadId ?? registro.usuarioId ?? '-',
        accion: registro.accion as AccionAudit,
        ...(datosAnteriores !== undefined ? { datosAnteriores } : {}),
        ...(datosNuevos !== undefined ? { datosNuevos } : {}),
      },
    });
  }
}

/** Fila cruda de `leerEstadoFecha` (columnas snake_case del JOIN). */
interface FilaEstadoFecha {
  reserva_id: string;
  estado: EstadoReservaDominio;
  sub_estado: SubEstadoConsultaPrisma | null;
}

/** Fila cruda del cálculo de la siguiente posición de cola. */
interface FilaSiguienteCola {
  siguiente: number;
}

/**
 * Repositorio tx-bound de FECHA_BLOQUEADA para la transición (US-005). Reutiliza la
 * primitiva atómica `bloquearEnTx` de US-040 (sin SQL de bloqueo nuevo); el `P2002`
 * del INSERT se propaga CRUDO para que la UoW lo reintente re-derivando a `2.d`. La
 * cola se serializa con `SELECT … FOR UPDATE` sobre la fila bloqueante (US-004 §D-5).
 */
class FechaBloqueadaTransicionPrismaRepository
  implements FechaBloqueadaTransicionRepositoryPort
{
  constructor(
    private readonly tx: Prisma.TransactionClient,
    private readonly adapter: FechaBloqueadaPrismaAdapter,
  ) {}

  async leerEstadoFecha(params: {
    tenantId: string;
    fecha: Date;
  }): Promise<EstadoFechaTransicion> {
    const { tenantId, fecha } = params;
    const fechaIso = formatearFecha(fecha);
    const filas = await this.tx.$queryRaw<FilaEstadoFecha[]>(Prisma.sql`
      SELECT fb.reserva_id, r.estado, r.sub_estado
      FROM fecha_bloqueada fb
      JOIN reserva r ON r.id_reserva = fb.reserva_id
      WHERE fb.tenant_id = ${tenantId} AND fb.fecha = ${fechaIso}::date
    `);
    if (filas.length === 0) {
      return { tipo: 'libre' };
    }
    const fila = filas[0];
    return {
      tipo: 'bloqueada',
      subEstadoBloqueante:
        fila.sub_estado === null ? null : subEstadoPrismaADominio(fila.sub_estado),
      estadoBloqueante: fila.estado,
      reservaBloqueanteId: fila.reserva_id,
    };
  }

  async bloquear(params: {
    tenantId: string;
    fecha: Date;
    reservaId: string;
    ttlExpiracion: Date;
  }): Promise<void> {
    const plan: PlanBloqueo = {
      modo: 'insert',
      tipo: 'blando',
      ttl: params.ttlExpiracion,
    };
    await this.adapter.bloquearEnTx(this.tx, {
      tenantId: params.tenantId,
      fecha: params.fecha,
      reservaId: params.reservaId,
      plan,
    });
  }

  async siguientePosicionCola(params: {
    tenantId: string;
    fecha: Date;
    consultaBloqueanteId: string;
  }): Promise<number> {
    const { tenantId, fecha } = params;
    const fechaIso = formatearFecha(fecha);
    // Serializa por la fila bloqueante: todas las transiciones 2.d de esa fecha
    // comparten este lock de UNA fila → posiciones únicas y contiguas sin locks
    // distribuidos.
    await this.tx.$queryRaw(Prisma.sql`
      SELECT id_bloqueo FROM fecha_bloqueada
      WHERE tenant_id = ${tenantId} AND fecha = ${fechaIso}::date
      FOR UPDATE
    `);
    const filas = await this.tx.$queryRaw<FilaSiguienteCola[]>(Prisma.sql`
      SELECT COALESCE(MAX(posicion_cola), 0) + 1 AS siguiente
      FROM reserva
      WHERE tenant_id = ${tenantId}
        AND fecha_evento = ${fechaIso}::date
        AND posicion_cola IS NOT NULL
    `);
    return Number(filas[0]?.siguiente ?? 1);
  }
}

/**
 * Nº máximo de intentos de la `$transaction` ante una colisión REINTENTABLE: el
 * bloqueo de fecha (UNIQUE `(tenant_id, fecha)` → re-derivación a `2.d`, D4) o la
 * posición de cola (UNIQUE parcial `reserva_cola_posicion_key`). Margen amplio
 * porque varias transiciones concurrentes sobre la misma fecha encadenan reintentos.
 */
const MAX_INTENTOS_TRANSACCION = 12;

/** ¿El error es una colisión P2002 reintentable (fecha / posicion_cola)? */
const esColisionReintentable = (error: unknown): boolean => {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2002'
  ) {
    return false;
  }
  const target = error.meta?.target;
  const texto = (
    Array.isArray(target) ? target.join(',') : String(target ?? '')
  ).toLowerCase();
  // `fecha` cubre el UNIQUE `(tenant_id, fecha)` de FECHA_BLOQUEADA (NO el
  // `reserva_id`, que indicaría que la propia reserva ya bloquea otra fecha).
  return (
    (texto.includes('fecha') && !texto.includes('reserva_id')) ||
    texto.includes('posicion_cola')
  );
};

@Injectable()
export class UnidadDeTrabajoTransicionPrismaAdapter
  implements UnidadDeTrabajoTransicionPort
{
  /** Adaptador de bloqueo cuyo núcleo `bloquearEnTx` reutiliza la transición. */
  private readonly fechaBloqueadaAdapter = new FechaBloqueadaPrismaAdapter(
    this.prisma,
  );

  constructor(private readonly prisma: PrismaService) {}

  async ejecutar(
    tenantId: string,
    trabajo: (repos: RepositoriosTransicionFecha) => Promise<unknown>,
  ): Promise<unknown> {
    let ultimoError: unknown;
    for (let intento = 1; intento <= MAX_INTENTOS_TRANSACCION; intento += 1) {
      try {
        return await this.ejecutarTransaccion(tenantId, trabajo);
      } catch (error) {
        if (esColisionReintentable(error) && intento < MAX_INTENTOS_TRANSACCION) {
          ultimoError = error;
          continue;
        }
        throw error;
      }
    }
    throw ultimoError;
  }

  private async ejecutarTransaccion(
    tenantId: string,
    trabajo: (repos: RepositoriosTransicionFecha) => Promise<unknown>,
  ): Promise<unknown> {
    return this.prisma.$transaction(async (tx) => {
      // RLS: primera operación de la transacción (SET LOCAL app.tenant_id).
      await this.prisma.fijarTenant(tx, tenantId);
      const repos: RepositoriosTransicionFecha = {
        reservas: new ReservaTransicionPrismaRepository(tx),
        fechaBloqueada: new FechaBloqueadaTransicionPrismaRepository(
          tx,
          this.fechaBloqueadaAdapter,
        ),
        comunicaciones: new ComunicacionTransicionPrismaRepository(tx),
        auditoria: new AuditLogTransicionPrismaRepository(tx),
      };
      return trabajo(repos);
    });
  }
}

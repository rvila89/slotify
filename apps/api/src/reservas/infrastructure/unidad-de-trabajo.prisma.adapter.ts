/**
 * Adaptador de la UNIDAD DE TRABAJO transaccional del alta de consulta
 * (US-003 / UC-03).
 *
 * Implementa `UnidadDeTrabajoPort`: abre UN único `prisma.$transaction`, fija el
 * contexto RLS con `fijarTenant(tx, tenantId)` (`SET LOCAL app.tenant_id`) como
 * PRIMERA operación, y expone los repositorios LIGADOS a esa transacción. Si el
 * `trabajo` rechaza, la transacción revierte por completo (all-or-nothing). El
 * envío de email (efecto post-commit) vive FUERA de aquí, en el caso de uso.
 *
 * Las clases de repositorio son tx-bound (se construyen con el cliente
 * transaccional): no son providers de Nest, viven y mueren con la transacción.
 */
import { Injectable } from '@nestjs/common';
import {
  AccionAudit,
  CanalEntrada,
  CodigoEmail,
  DuracionHoras,
  EstadoComunicacion,
  EstadoReserva,
  Prisma,
  SubEstadoConsulta,
  TipoEvento,
} from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  AuditLogPort,
  RegistroAuditoria,
} from '../../shared/audit/audit-log.port';
import type {
  BuscarClienteParams,
  ClienteParaAlta,
  ClienteRepositoryPort,
  ComunicacionParaAlta,
  ComunicacionRepositoryPort,
  CrearClienteParams,
  CrearComunicacionParams,
  CrearReservaParams,
  EstadoFechaAlta,
  FechaBloqueadaAltaRepositoryPort,
  RepositoriosAltaConsulta,
  ReservaParaAlta,
  ReservaRepositoryPort,
  UnidadDeTrabajoPort,
} from '../application/alta-consulta.use-case';
import type { EstadoReserva as EstadoReservaDominio } from '../domain/maquina-estados';
import type { PlanBloqueo } from '../domain/bloquear-fecha.service';
import { FechaBloqueadaPrismaAdapter } from './fecha-bloqueada.prisma.adapter';
import {
  subEstadoDominioAPrisma,
  subEstadoPrismaADominio,
  type SubEstadoConsultaPrisma,
} from './sub-estado-consulta.mapper';

/** Traduce el nº de horas de dominio al literal del enum Prisma (`h4`/`h8`/`h12`). */
const duracionHorasAPrisma = (horas: number): DuracionHoras => {
  switch (horas) {
    case 4:
      return DuracionHoras.h4;
    case 8:
      return DuracionHoras.h8;
    case 12:
      return DuracionHoras.h12;
    default:
      throw new Error(`Duración de horas no soportada: ${horas}`);
  }
};

/** Repositorio de CLIENTE ligado a la transacción (find-or-create por email). */
class ClienteAltaPrismaRepository implements ClienteRepositoryPort {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async buscarPorEmail({
    tenantId,
    email,
  }: BuscarClienteParams): Promise<ClienteParaAlta | null> {
    const fila = await this.tx.cliente.findFirst({ where: { tenantId, email } });
    return fila
      ? {
          idCliente: fila.idCliente,
          tenantId: fila.tenantId,
          nombre: fila.nombre,
          apellidos: fila.apellidos ?? '',
          email: fila.email ?? email,
          telefono: fila.telefono ?? '',
        }
      : null;
  }

  async crear(p: CrearClienteParams): Promise<ClienteParaAlta> {
    const fila = await this.tx.cliente.create({
      data: {
        tenantId: p.tenantId,
        nombre: p.nombre,
        apellidos: p.apellidos,
        email: p.email,
        telefono: p.telefono,
      },
    });
    return {
      idCliente: fila.idCliente,
      tenantId: fila.tenantId,
      nombre: fila.nombre,
      apellidos: fila.apellidos ?? p.apellidos,
      email: fila.email ?? p.email,
      telefono: fila.telefono ?? p.telefono,
    };
  }
}

/** Repositorio de RESERVA ligado a la transacción (entrada inicial consulta/2a). */
class ReservaAltaPrismaRepository implements ReservaRepositoryPort {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async crear(p: CrearReservaParams): Promise<ReservaParaAlta> {
    const codigo = await this.generarCodigo(p.tenantId);
    const fila = await this.tx.reserva.create({
      data: {
        tenantId: p.tenantId,
        clienteId: p.clienteId,
        codigo,
        estado: EstadoReserva.consulta,
        subEstado: subEstadoDominioAPrisma(p.subEstado) as SubEstadoConsulta,
        ttlExpiracion: p.ttlExpiracion,
        canalEntrada: p.canalEntrada as CanalEntrada,
        ...(p.fechaEvento !== undefined ? { fechaEvento: p.fechaEvento } : {}),
        ...(p.posicionCola !== undefined ? { posicionCola: p.posicionCola } : {}),
        ...(p.consultaBloqueanteId !== undefined
          ? { consultaBloqueanteId: p.consultaBloqueanteId }
          : {}),
        ...(p.tipoEvento !== undefined
          ? { tipoEvento: p.tipoEvento as TipoEvento }
          : {}),
        ...(p.duracionHoras !== undefined
          ? { duracionHoras: duracionHorasAPrisma(p.duracionHoras) }
          : {}),
        ...(p.numAdultosNinosMayores4 !== undefined
          ? { numAdultosNinosMayores4: p.numAdultosNinosMayores4 }
          : {}),
        ...(p.numNinosMenores4 !== undefined
          ? { numNinosMenores4: p.numNinosMenores4 }
          : {}),
        ...(p.notas !== undefined ? { notas: p.notas } : {}),
      },
    });
    return {
      idReserva: fila.idReserva,
      tenantId: fila.tenantId,
      clienteId: fila.clienteId,
      codigo: fila.codigo,
      estado: 'consulta',
      subEstado: p.subEstado,
      ttlExpiracion: fila.ttlExpiracion,
      canalEntrada: p.canalEntrada,
      posicionCola: fila.posicionCola,
      consultaBloqueanteId: fila.consultaBloqueanteId,
    };
  }

  /**
   * Genera un código de RESERVA `YY-NNNN` correlativo por tenant a partir del
   * `count(*)` del tenant dentro de la MISMA transacción. Este cálculo NO es
   * atómico por sí solo (dos altas concurrentes pueden leer el mismo `count`), por
   * lo que la unicidad real la garantiza —al estilo del proyecto, sin locks
   * distribuidos— el índice `reserva_codigo_key`: el segundo `INSERT` en colisión
   * recibe `P2002`. La carrera se resuelve con el retry-on-conflict de
   * `UnidadDeTrabajoPrismaAdapter.ejecutar`, que REABRE la `$transaction` (en
   * PostgreSQL una `P2002` aborta la transacción en curso) y reintenta: al re-leer
   * el `count` ya con el ganador confirmado, obtiene el siguiente correlativo. El
   * UNIQUE permanece como red de seguridad final (si se agotan los reintentos,
   * `P2002` → HTTP 409 vía el filtro global).
   */
  private async generarCodigo(tenantId: string): Promise<string> {
    const anio = new Date().getFullYear();
    const prefijo = String(anio).slice(-2);
    const total = await this.tx.reserva.count({ where: { tenantId } });
    return `${prefijo}-${String(total + 1).padStart(4, '0')}`;
  }
}

/** Repositorio de COMUNICACION ligado a la transacción (E1). */
class ComunicacionAltaPrismaRepository implements ComunicacionRepositoryPort {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async crear(p: CrearComunicacionParams): Promise<ComunicacionParaAlta> {
    const fila = await this.tx.comunicacion.create({
      data: {
        tenantId: p.tenantId,
        reservaId: p.reservaId,
        clienteId: p.clienteId,
        codigoEmail: CodigoEmail.E1,
        asunto: p.asunto,
        cuerpo: p.cuerpo,
        destinatarioEmail: p.destinatarioEmail,
        estado:
          p.estado === 'enviado'
            ? EstadoComunicacion.enviado
            : EstadoComunicacion.borrador,
        fechaEnvio: p.fechaEnvio,
      },
    });
    return {
      idComunicacion: fila.idComunicacion,
      tenantId: fila.tenantId,
      reservaId: fila.reservaId ?? p.reservaId,
      clienteId: fila.clienteId,
      codigoEmail: 'E1',
      estado: p.estado,
      destinatarioEmail: fila.destinatarioEmail,
      fechaEnvio: fila.fechaEnvio,
    };
  }
}

/**
 * Repositorio de AUDIT_LOG ligado a la transacción del alta. A diferencia del
 * adaptador compartido (que abre su propia transacción), este escribe DENTRO de la
 * transacción del alta para que la auditoría comparta el destino del rollback.
 */
class AuditLogAltaPrismaRepository implements AuditLogPort {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async registrar(registro: RegistroAuditoria): Promise<void> {
    const datosNuevos = registro.datosNuevos as Prisma.InputJsonValue | undefined;
    await this.tx.auditLog.create({
      data: {
        tenantId: registro.tenantId,
        usuarioId: registro.usuarioId ?? null,
        entidad: registro.entidad ?? 'Sistema',
        entidadId: registro.entidadId ?? registro.usuarioId ?? '-',
        accion: registro.accion as AccionAudit,
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

const formatearFecha = (fecha: Date): string => fecha.toISOString().slice(0, 10);

/**
 * Repositorio tx-bound de FECHA_BLOQUEADA para el alta con fecha (US-004). Vive
 * dentro de la transacción del alta (atomicidad RESERVA `2.b` + `FECHA_BLOQUEADA`)
 * y reutiliza la primitiva atómica `bloquearEnTx` de US-040 (§D-2). La
 * serialización de la cola se hace con `SELECT … FOR UPDATE` sobre la fila
 * bloqueante (§D-5); el `P2002` del INSERT del bloqueo se deja propagar para que la
 * UoW lo reintente re-derivando a `2.d` (§D-6).
 */
class FechaBloqueadaAltaPrismaRepository implements FechaBloqueadaAltaRepositoryPort {
  constructor(
    private readonly tx: Prisma.TransactionClient,
    private readonly adapter: FechaBloqueadaPrismaAdapter,
  ) {}

  async leerEstadoFecha(params: {
    tenantId: string;
    fecha: Date;
  }): Promise<EstadoFechaAlta> {
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
    // Reutiliza el núcleo atómico de US-040 dentro de la tx del alta. El `P2002`
    // (UNIQUE `(tenant_id, fecha)`) se propaga CRUDO para el retry de la UoW (D-6).
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
    // Serializa por la fila bloqueante: todas las altas 2.d de esa fecha comparten
    // este lock de UNA fila → posiciones únicas y contiguas sin locks distribuidos.
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
 * `codigo` correlativo (`reserva_codigo_key`), el bloqueo de fecha (UNIQUE
 * `(tenant_id, fecha)` de US-040, que dispara la re-derivación a `2.d` de US-004
 * §D-6) o la posición de cola (UNIQUE parcial de US-004 §D-8). El margen es amplio
 * porque varias altas concurrentes sobre la misma fecha pueden encadenar reintentos
 * (colisión de `codigo` y de fecha en la misma ventana).
 */
const MAX_INTENTOS_TRANSACCION = 12;

/** ¿El error es una colisión P2002 reintentable (codigo / fecha / posicion_cola)? */
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
  // `fecha` cubre el UNIQUE `(tenant_id, fecha)` de FECHA_BLOQUEADA (no el
  // `reserva_id`, que NO es reintentable: indica reserva ya bloqueante).
  return (
    texto.includes('codigo') ||
    texto.includes('fecha') ||
    texto.includes('posicion_cola')
  );
};

@Injectable()
export class UnidadDeTrabajoPrismaAdapter implements UnidadDeTrabajoPort {
  /** Adaptador de bloqueo cuyo núcleo `bloquearEnTx` reutiliza el alta (US-004 §D-2). */
  private readonly fechaBloqueadaAdapter = new FechaBloqueadaPrismaAdapter(this.prisma);

  constructor(private readonly prisma: PrismaService) {}

  /**
   * Abre la `$transaction` (con RLS) y ejecuta el `trabajo`. Si el commit choca con
   * una colisión REINTENTABLE (`codigo` correlativo, UNIQUE de FECHA_BLOQUEADA o
   * `posicion_cola`), REABRE una transacción nueva y reintenta hasta
   * `MAX_INTENTOS_TRANSACCION`: en PostgreSQL la `P2002` aborta la transacción en
   * curso, así que no se puede continuar la abortada, hay que reabrirla. Como la
   * determinación del sub-estado vive DENTRO del `trabajo`, el reintento re-deriva
   * automáticamente (libre→2.b colisiona→ ahora bloqueada-por-2.b → 2.d, US-004
   * §D-6). Cualquier otro error (o el `P2002` tras agotar los reintentos) se propaga
   * al filtro global.
   */
  async ejecutar(
    tenantId: string,
    trabajo: (repos: RepositoriosAltaConsulta) => Promise<unknown>,
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
    trabajo: (repos: RepositoriosAltaConsulta) => Promise<unknown>,
  ): Promise<unknown> {
    return this.prisma.$transaction(async (tx) => {
      // RLS: primera operación de la transacción (SET LOCAL app.tenant_id).
      await this.prisma.fijarTenant(tx, tenantId);
      const repos: RepositoriosAltaConsulta = {
        clientes: new ClienteAltaPrismaRepository(tx),
        reservas: new ReservaAltaPrismaRepository(tx),
        comunicaciones: new ComunicacionAltaPrismaRepository(tx),
        auditoria: new AuditLogAltaPrismaRepository(tx),
        fechaBloqueada: new FechaBloqueadaAltaPrismaRepository(
          tx,
          this.fechaBloqueadaAdapter,
        ),
      };
      return trabajo(repos);
    });
  }
}

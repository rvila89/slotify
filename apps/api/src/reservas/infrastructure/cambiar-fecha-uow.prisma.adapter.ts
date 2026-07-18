/**
 * Adaptador de la UNIDAD DE TRABAJO atómica de la operación «cambiar fecha ya bloqueada»
 * (US-051 §Punto 2 / UC-05/UC-12/UC-18). Implementa `UnidadDeTrabajoCambiarFechaPort`.
 *
 * Abre UN único `prisma.$transaction` bajo el contexto RLS del `tenantId` del Gestor
 * (`fijarTenant(tx, tenantId)` = `SET LOCAL app.tenant_id` como PRIMERA operación) y expone
 * los repositorios tx-bound. Liberar-antigua + bloquear-nueva viven DENTRO de la MISMA
 * transacción (all-or-nothing): si algo rechaza (p. ej. el `bloquear(F2)` choca con el
 * `UNIQUE(tenant_id, fecha)` → `P2002`), la transacción revierte por completo (rollback
 * total: la RESERVA conserva su fecha antigua y su bloqueo).
 *
 * REGLA CRÍTICA (atomic-date-lock, `CLAUDE.md §Regla crítica`): la exclusión mutua vive
 * SOLO en PostgreSQL (`SELECT … FOR UPDATE` + `UNIQUE(tenant_id, fecha)`); NADA de Redis
 * ni locks distribuidos. El `leerEstadoFecha(F2)` hace `SELECT … FOR UPDATE` para
 * serializar dos cambios concurrentes hacia la misma F2: el segundo espera al COMMIT del
 * primero y ve F2 ocupada → conflicto (D4).
 *
 * La PROMOCIÓN FIFO (A15) de la fecha antigua con cola se ejecuta DENTRO de la misma
 * transacción (reutilizando la mecánica de dominio `planificarPromocionCola` + la
 * primitiva `bloquearEnTx`, US-018/US-040): tras liberar F1 la fila de bloqueo no existe,
 * pero las RESERVA en `2d` de esa fecha quedaron bloqueadas por el `FOR UPDATE` de este
 * flujo, garantizando exactamente-una-vez sin estado intermedio observable.
 */
import { Injectable } from '@nestjs/common';
import { AccionAudit, Prisma, SubEstadoConsulta } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import {
  CambiarFechaConflictoError,
  type EstadoFechaDestino,
  type FechaBloqueadaCambioRepositoryPort,
  type PromocionColaCambioPort,
  type RegistroAuditoriaCambiarFecha,
  type RepositoriosCambiarFecha,
  type ReservaCambioFecha,
  type ReservaCambioFechaRepositoryPort,
  type UnidadDeTrabajoCambiarFechaPort,
} from '../application/cambiar-fecha.use-case';
import type { EstadoReserva as EstadoReservaDominio } from '../domain/maquina-estados';
import {
  planificarPromocionCola,
  type EntradaCola,
} from '../domain/promocion-cola';
import { resolverPlanBloqueo } from '../domain/bloquear-fecha.service';
import { FechaBloqueadaPrismaAdapter } from './fecha-bloqueada.prisma.adapter';
import { TenantSettingsPrismaAdapter } from './tenant-settings.prisma.adapter';
import {
  subEstadoDominioAPrisma,
  subEstadoPrismaADominio,
  type SubEstadoConsultaPrisma,
} from './sub-estado-consulta.mapper';

const formatearFecha = (fecha: Date): string => fecha.toISOString().slice(0, 10);

const MOTIVO_CONFLICTO_ADAPTADOR =
  'La fecha destino no está disponible: ya está bloqueada por otra reserva.';

/**
 * ¿El error es la colisión `P2002` del `UNIQUE(tenant_id, fecha)` de FECHA_BLOQUEADA (la
 * fecha nueva la ganó otro cambio concurrente)? NO cubre el `reserva_id` (que indicaría que
 * la propia RESERVA ya bloquea otra fecha, un caso distinto).
 */
const esColisionFecha = (error: unknown): boolean => {
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
  return (
    (texto.includes('fecha') && !texto.includes('reserva_id')) ||
    texto.includes('tenant_id')
  );
};

/** Fila cruda de la RESERVA bloqueada con `SELECT … FOR UPDATE`. */
interface FilaReserva {
  id_reserva: string;
  tenant_id: string;
  estado: EstadoReservaDominio;
  sub_estado: SubEstadoConsultaPrisma | null;
  fecha_evento: Date | null;
}

/** Fila cruda del estado de la fecha destino (JOIN FECHA_BLOQUEADA × RESERVA). */
interface FilaEstadoFecha {
  reserva_id: string;
  estado: EstadoReservaDominio;
  sub_estado: SubEstadoConsultaPrisma | null;
}

/** Fila cruda de una RESERVA en cola (columnas snake_case). */
interface FilaColaBloqueada {
  id_reserva: string;
  sub_estado: SubEstadoConsultaPrisma | null;
  posicion_cola: number | null;
  consulta_bloqueante_id: string | null;
}

/**
 * Repositorio de RESERVA tx-bound: `SELECT … FOR UPDATE` de la fila (serializa la RESERVA)
 * + `UPDATE fecha_evento`. NUNCA escribe estado/subEstado (§D-2.1).
 */
class ReservaCambioFechaPrismaRepository
  implements ReservaCambioFechaRepositoryPort
{
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async buscarPorId(params: {
    tenantId: string;
    reservaId: string;
  }): Promise<ReservaCambioFecha | null> {
    const filas = await this.tx.$queryRaw<FilaReserva[]>(Prisma.sql`
      SELECT id_reserva, tenant_id, estado, sub_estado, fecha_evento
      FROM reserva
      WHERE id_reserva = ${params.reservaId} AND tenant_id = ${params.tenantId}
      FOR UPDATE
    `);
    if (filas.length === 0) {
      return null;
    }
    const fila = filas[0];
    return {
      idReserva: fila.id_reserva,
      tenantId: fila.tenant_id,
      estado: fila.estado,
      subEstado:
        fila.sub_estado === null ? null : subEstadoPrismaADominio(fila.sub_estado),
      fechaEvento: fila.fecha_evento,
    };
  }

  async actualizarFecha(params: {
    idReserva: string;
    fechaEvento: Date;
  }): Promise<ReservaCambioFecha> {
    const fila = await this.tx.reserva.update({
      where: { idReserva: params.idReserva },
      data: { fechaEvento: params.fechaEvento },
    });
    return {
      idReserva: fila.idReserva,
      tenantId: fila.tenantId,
      estado: fila.estado as EstadoReservaDominio,
      subEstado:
        fila.subEstado === null
          ? null
          : subEstadoPrismaADominio(fila.subEstado as SubEstadoConsultaPrisma),
      fechaEvento: fila.fechaEvento,
    };
  }
}

/**
 * Repositorio tx-bound del bloqueo de FECHA_BLOQUEADA para el cambio. Reutiliza la
 * primitiva atómica `bloquearEnTx` de US-040 (sin SQL de bloqueo nuevo); el `P2002` del
 * INSERT se propaga CRUDO para provocar el rollback total (D4). El `leerEstadoFecha` hace
 * `SELECT … FOR UPDATE` sobre `FECHA_BLOQUEADA(tenant, F2)` para serializar cambios rivales.
 */
class FechaBloqueadaCambioPrismaRepository
  implements FechaBloqueadaCambioRepositoryPort
{
  constructor(
    private readonly tx: Prisma.TransactionClient,
    private readonly adapter: FechaBloqueadaPrismaAdapter,
    private readonly ttlConsultaDias: number,
  ) {}

  async leerEstadoFecha(params: {
    tenantId: string;
    fecha: Date;
  }): Promise<EstadoFechaDestino> {
    const fechaIso = formatearFecha(params.fecha);
    // SELECT … FOR UPDATE sobre la fila (puede no existir): serializa dos cambios rivales
    // hacia la misma F2. El segundo espera al COMMIT del primero y observa F2 ocupada.
    const filas = await this.tx.$queryRaw<FilaEstadoFecha[]>(Prisma.sql`
      SELECT fb.reserva_id, r.estado, r.sub_estado
      FROM fecha_bloqueada fb
      JOIN reserva r ON r.id_reserva = fb.reserva_id
      WHERE fb.tenant_id = ${params.tenantId} AND fb.fecha = ${fechaIso}::date
      FOR UPDATE OF fb
    `);
    if (filas.length === 0) {
      return { tipo: 'libre' };
    }
    const fila = filas[0];
    return {
      tipo: 'bloqueada',
      reservaBloqueanteId: fila.reserva_id,
      estadoBloqueante: fila.estado,
      subEstadoBloqueante:
        fila.sub_estado === null ? null : subEstadoPrismaADominio(fila.sub_estado),
    };
  }

  async bloquear(params: {
    tenantId: string;
    fecha: Date;
    reservaId: string;
  }): Promise<void> {
    // MOVER EN SITIO la fila de FECHA_BLOQUEADA de ESTA reserva (F1 → F2), NO insertar
    // una segunda fila: `FECHA_BLOQUEADA.reserva_id` es UNIQUE (1-a-1 con RESERVA), así
    // que un INSERT de una segunda fila para la misma reserva (que aún tiene la de F1)
    // violaría `UNIQUE(reserva_id)` antes de liberar F1. El UPDATE de `fecha` respeta
    // `UNIQUE(reserva_id)` (sigue habiendo UNA fila) y, si F2 ya está ocupada por OTRA
    // reserva, choca con `UNIQUE(tenant_id, fecha)` → P2002 → conflicto terminal (409)
    // con rollback total; la reserva conserva F1 (escenario 4). Este UPDATE es el punto
    // que serializa dos cambios rivales hacia la MISMA F2 libre: el segundo en commitear
    // recibe el P2002 del índice `(tenant_id, fecha)`.
    //
    // Se usa el update TIPADO de Prisma (NO `$executeRaw`): una violación de unicidad en
    // una query cruda saldría envuelta como `P2010` (raw query failed) con el `23505` de
    // Postgres dentro del mensaje, en vez de un `P2002` limpio con `meta.target`. El
    // `updateMany` tipado emite `P2002` con `meta.target`, que `esColisionFecha` reconoce
    // para distinguir la colisión de FECHA (traducir a conflicto) de la de `reserva_id`.
    try {
      const { count } = await this.tx.fechaBloqueada.updateMany({
        where: { tenantId: params.tenantId, reservaId: params.reservaId },
        data: { fecha: params.fecha },
      });
      // Defensa: si la reserva no tenía fila de bloqueo (dato inconsistente), la crea.
      if (count === 0) {
        const plan = resolverPlanBloqueo({
          fase: '2.b',
          ahora: new Date(),
          settings: {
            ttlConsultaDias: this.ttlConsultaDias,
            ttlPrereservaDias: this.ttlConsultaDias,
          },
        });
        await this.adapter.bloquearEnTx(this.tx, {
          tenantId: params.tenantId,
          fecha: params.fecha,
          reservaId: params.reservaId,
          plan,
        });
      }
    } catch (error) {
      if (esColisionFecha(error)) {
        throw new CambiarFechaConflictoError(MOTIVO_CONFLICTO_ADAPTADOR);
      }
      throw error;
    }
  }

  async liberar(params: {
    tenantId: string;
    fecha: Date;
    reservaId: string;
  }): Promise<void> {
    // La fila de bloqueo de ESTA reserva ya se movió de F1 a F2 en `bloquear()` (UPDATE en
    // sitio), de modo que F1 queda LIBRE sin borrar nada de esta reserva. Este DELETE es un
    // no-op defensivo (idempotente): solo eliminaría una fila residual de la MISMA reserva
    // que hubiera quedado en F1 (no ocurre con el UPDATE en sitio). NO borra el bloqueo de
    // OTRA reserva sobre F1 (filtra por `reserva_id`), preservando la promoción de cola.
    const fechaIso = formatearFecha(params.fecha);
    await this.tx.$executeRaw(Prisma.sql`
      DELETE FROM fecha_bloqueada
      WHERE tenant_id = ${params.tenantId}
        AND fecha = ${fechaIso}::date
        AND reserva_id = ${params.reservaId}
    `);
  }

  async tieneCola(params: {
    tenantId: string;
    fecha: Date;
    reservaId: string;
  }): Promise<boolean> {
    // Hay cola activa si existe alguna RESERVA en `2d` apuntando a la reserva liberada
    // como bloqueante (mecánica A15). Serializa las filas de la cola con FOR UPDATE.
    const filas = await this.tx.$queryRaw<{ id_reserva: string }[]>(Prisma.sql`
      SELECT id_reserva FROM reserva
      WHERE tenant_id = ${params.tenantId}
        AND consulta_bloqueante_id = ${params.reservaId}
        AND sub_estado = 's2d'
      FOR UPDATE
    `);
    return filas.length > 0;
  }
}

/**
 * Adaptador de PROMOCIÓN FIFO tx-bound (A15): promueve al primero en cola de la fecha
 * antigua liberada DENTRO de la misma transacción del cambio. Reutiliza la mecánica de
 * dominio `planificarPromocionCola` + la primitiva `bloquearEnTx` (US-018/US-040): mutar
 * la promovida a `2.b`, re-bloquear la fecha antigua y reordenar el resto FIFO, con su
 * AUDIT_LOG. La liberación previa ya bloqueó las filas de cola con `FOR UPDATE`, así que
 * la promoción es exactamente-una-vez sin estado intermedio observable.
 */
class PromocionColaCambioTxAdapter implements PromocionColaCambioPort {
  constructor(
    private readonly tx: Prisma.TransactionClient,
    private readonly fechaBloqueada: FechaBloqueadaPrismaAdapter,
    private readonly ttlConsultaDias: number,
  ) {}

  async promoverPrimeroEnCola(params: {
    tenantId: string;
    fecha: Date;
  }): Promise<void> {
    const { tenantId, fecha } = params;
    const fechaIso = formatearFecha(fecha);

    const filas = await this.tx.$queryRaw<FilaColaBloqueada[]>(Prisma.sql`
      SELECT id_reserva, sub_estado, posicion_cola, consulta_bloqueante_id
      FROM reserva
      WHERE tenant_id = ${tenantId}
        AND fecha_evento = ${fechaIso}::date
        AND sub_estado = 's2d'
      FOR UPDATE
    `);
    if (filas.length === 0) {
      return;
    }

    const cola: EntradaCola[] = filas.map((fila) => ({
      reservaId: fila.id_reserva,
      subEstado:
        fila.sub_estado === null ? '2d' : subEstadoPrismaADominio(fila.sub_estado),
      posicionCola: fila.posicion_cola ?? 0,
      consultaBloqueanteId: fila.consulta_bloqueante_id ?? '',
    }));

    const plan = planificarPromocionCola(cola);
    if (plan.anomalia || plan.promovida === null) {
      return;
    }
    const promovida = plan.promovida;

    const planBloqueo = resolverPlanBloqueo({
      fase: '2.b',
      ahora: new Date(),
      settings: {
        ttlConsultaDias: this.ttlConsultaDias,
        ttlPrereservaDias: this.ttlConsultaDias,
      },
    });

    // Mutar la promovida a 2.b: sale de la cola.
    await this.tx.reserva.update({
      where: { idReserva: promovida.reservaId },
      data: {
        estado: promovida.estadoDestino,
        subEstado: subEstadoDominioAPrisma(promovida.subEstadoDestino) as SubEstadoConsulta,
        posicionCola: null,
        consultaBloqueanteId: null,
        ttlExpiracion: planBloqueo.ttl,
      },
    });

    // Re-bloquear la fecha antigua para la promovida (misma tx). Un choque con el UNIQUE
    // lanza P2002 → rollback total (atomicidad).
    await this.fechaBloqueada.bloquearEnTx(this.tx, {
      tenantId,
      fecha,
      reservaId: promovida.reservaId,
      plan: planBloqueo,
    });

    // Reordenar el resto en orden ASCENDENTE para no violar el índice UNIQUE parcial.
    for (const reordenamiento of plan.reordenamientos) {
      await this.tx.reserva.update({
        where: { idReserva: reordenamiento.reservaId },
        data: {
          posicionCola: reordenamiento.posicionColaDestino,
          consultaBloqueanteId: reordenamiento.consultaBloqueanteIdDestino,
        },
      });
    }

    // AUDIT_LOG de la promoción (origen automático) en la misma transacción.
    await this.tx.auditLog.create({
      data: {
        tenantId,
        entidad: 'RESERVA',
        entidadId: promovida.reservaId,
        accion: AccionAudit.transicion,
        datosAnteriores: { subEstado: '2d' } as Prisma.InputJsonValue,
        datosNuevos: {
          subEstado: promovida.subEstadoDestino,
          origen: 'promocion_automatica',
          alertaInterna:
            'Consulta promovida al bloqueo de la fecha; contactar al cliente.',
        } as Prisma.InputJsonValue,
      },
    });
    for (const reordenamiento of plan.reordenamientos) {
      await this.tx.auditLog.create({
        data: {
          tenantId,
          entidad: 'RESERVA',
          entidadId: reordenamiento.reservaId,
          accion: AccionAudit.transicion,
          datosAnteriores: { subEstado: '2d' } as Prisma.InputJsonValue,
          datosNuevos: {
            subEstado: '2d',
            posicionCola: reordenamiento.posicionColaDestino,
            consultaBloqueanteId: reordenamiento.consultaBloqueanteIdDestino,
            origen: 'promocion_automatica',
          } as Prisma.InputJsonValue,
        },
      });
    }
  }
}

/** Repositorio de AUDIT_LOG tx-bound del cambio (F1→F2). */
class AuditLogCambioFechaPrismaRepository {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async registrar(registro: RegistroAuditoriaCambiarFecha): Promise<void> {
    const datosAnteriores = registro.datosAnteriores as
      | Prisma.InputJsonValue
      | undefined;
    const datosNuevos = registro.datosNuevos as Prisma.InputJsonValue | undefined;
    await this.tx.auditLog.create({
      data: {
        tenantId: registro.tenantId,
        usuarioId: registro.usuarioId ?? null,
        entidad: registro.entidad,
        entidadId: registro.entidadId,
        accion: registro.accion as AccionAudit,
        ...(datosAnteriores !== undefined ? { datosAnteriores } : {}),
        ...(datosNuevos !== undefined ? { datosNuevos } : {}),
      },
    });
  }
}

/** Días de TTL del bloqueo blando por defecto si el tenant no tiene settings. */
const TTL_CONSULTA_DIAS_DEFECTO = 3;

@Injectable()
export class CambiarFechaUoWPrismaAdapter
  implements UnidadDeTrabajoCambiarFechaPort
{
  private readonly fechaBloqueadaAdapter = new FechaBloqueadaPrismaAdapter(
    this.prisma,
  );

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantSettings: TenantSettingsPrismaAdapter,
  ) {}

  async ejecutar(
    tenantId: string,
    trabajo: (repos: RepositoriosCambiarFecha) => Promise<unknown>,
  ): Promise<unknown> {
    // Leer el TTL fuera de la transacción del cambio (lectura propia con RLS). El instante
    // absoluto se calcula dentro con el reloj del sistema (al re-bloquear).
    const settings = await this.tenantSettings.obtener(tenantId);
    const ttlConsultaDias = settings?.ttlConsultaDias ?? TTL_CONSULTA_DIAS_DEFECTO;

    return this.prisma.$transaction(async (tx) => {
      // RLS: primera operación de la transacción (SET LOCAL app.tenant_id).
      await this.prisma.fijarTenant(tx, tenantId);
      const repos: RepositoriosCambiarFecha = {
        reservas: new ReservaCambioFechaPrismaRepository(tx),
        fechaBloqueada: new FechaBloqueadaCambioPrismaRepository(
          tx,
          this.fechaBloqueadaAdapter,
          ttlConsultaDias,
        ),
        promocionCola: new PromocionColaCambioTxAdapter(
          tx,
          this.fechaBloqueadaAdapter,
          ttlConsultaDias,
        ),
        auditoria: new AuditLogCambioFechaPrismaRepository(tx),
      };
      return trabajo(repos);
    });
  }
}

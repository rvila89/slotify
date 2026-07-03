/**
 * Adaptador de la UNIDAD DE TRABAJO atómica de PROMOCIÓN MANUAL de cola (US-019 /
 * UC-12 FA manual, actor Gestor). Implementa `PromocionManualColaUoWPort`.
 *
 * Abre UN único `prisma.$transaction` bajo el contexto RLS del `tenantId` del Gestor
 * (`SET LOCAL app.tenant_id` como PRIMERA operación, D-7). Dentro de esa transacción,
 * all-or-nothing (§D-3/§D-4/§D-5):
 *   1. Resolver la RESERVA elegida DENTRO del tenant del JWT (RLS). Si no existe/otro
 *      tenant → `PromocionManualConsultaNoEnColaError`. Su `fecha_evento` fija la fecha.
 *   2. `SELECT … FOR UPDATE` sobre la fila de `FECHA_BLOQUEADA` de `(tenant, fecha)` —
 *      punto de SERIALIZACIÓN (RC-A/RC-B). La fila SÍ existe (la bloqueante aún no se
 *      liberó); si no existe → `PromocionManualSinBloqueoError` (inconsistencia). La
 *      exclusión mutua vive SOLO en PostgreSQL (atomic-date-lock).
 *   3. Guarda de origen (FA-05) + guarda "ya promovida" (D-4): tras adquirir el lock,
 *      re-leer la elegida. Si ya NO está en `2.d` (el automático/otro Gestor la promovió
 *      o expiró), y la fila de bloqueo YA apunta a una promovida viva (`2.b`) distinta de
 *      la bloqueante esperada, es carrera perdida → `PromocionManualCarreraPerdidaError`;
 *      si simplemente la elegida no está en cola sin señal de carrera →
 *      `PromocionManualConsultaNoEnColaError`.
 *   4. Leer la cola bajo lock, planificar (`planificarPromocionManualCola`). Anomalía →
 *      auditar + abortar.
 *   5. Aplicar (orden D-3): expirar la bloqueante viva a `2.x` (`ttl → NULL`), promover
 *      la elegida a `2.b` (posicion_cola/consulta_bloqueante_id → NULL, ttl = now()+ttl),
 *      RE-ASIGNAR la fila de `FECHA_BLOQUEADA` a la promovida (UPDATE de la MISMA fila,
 *      manteniendo una sola fila activa por (tenant,fecha)), reordenar por cierre de
 *      hueco, auditar cada RESERVA con `origen: 'promocion_manual'` + el `usuario_id`.
 *
 * Si algo falla, rollback total: la bloqueante sigue viva, la fecha bloqueada por ella,
 * la cola intacta. NADA de Redis/locks distribuidos.
 */
import { Injectable } from '@nestjs/common';
import { AccionAudit, Prisma, SubEstadoConsulta } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import {
  PromocionManualCarreraPerdidaError,
  PromocionManualConsultaNoEnColaError,
  PromocionManualReservaNoEncontradaError,
  PromocionManualSinBloqueoError,
  type PromocionManualColaUoWPort,
  type PromoverManualComando,
  type ResultadoPromocionManual,
} from '../application/promover-manual-en-cola.service';
import {
  planificarPromocionManualCola,
  type EntradaColaManual,
} from '../domain/promocion-manual-cola';
import { resolverExpiracionForzosaBloqueante } from '../domain/maquina-estados';
import { resolverPlanBloqueo } from '../domain/bloquear-fecha.service';
import { FechaBloqueadaPrismaAdapter } from './fecha-bloqueada.prisma.adapter';
import { TenantSettingsPrismaAdapter } from './tenant-settings.prisma.adapter';
import {
  subEstadoDominioAPrisma,
  subEstadoPrismaADominio,
  type SubEstadoConsultaPrisma,
} from './sub-estado-consulta.mapper';

const formatearFecha = (fecha: Date): string => fecha.toISOString().slice(0, 10);

/** Fila cruda de la RESERVA elegida (columnas snake_case). */
interface FilaReservaElegida {
  id_reserva: string;
  sub_estado: SubEstadoConsultaPrisma | null;
  fecha_evento: Date | null;
  posicion_cola: number | null;
  consulta_bloqueante_id: string | null;
}

/** Fila cruda del bloqueo vigente sobre `(tenant, fecha)`. */
interface FilaBloqueoVivo {
  id_bloqueo: string;
  reserva_id: string;
}

/** Fila cruda de una RESERVA en cola (columnas snake_case). */
interface FilaColaManual {
  id_reserva: string;
  sub_estado: SubEstadoConsultaPrisma | null;
  posicion_cola: number | null;
  consulta_bloqueante_id: string | null;
}

/** Estado leído de la bloqueante actual para decidir su expiración forzosa. */
interface FilaBloqueante {
  id_reserva: string;
  estado: string;
  sub_estado: SubEstadoConsultaPrisma | null;
}

@Injectable()
export class PromocionManualColaUoWPrismaAdapter implements PromocionManualColaUoWPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fechaBloqueada: FechaBloqueadaPrismaAdapter,
    private readonly tenantSettings: TenantSettingsPrismaAdapter,
  ) {}

  async promover(comando: PromoverManualComando): Promise<ResultadoPromocionManual> {
    const { tenantId, usuarioId, reservaId } = comando;

    // TTL leído fuera de la transacción de promoción (lectura propia con RLS); el
    // instante absoluto se calcula dentro con el reloj del sistema.
    const settings = await this.tenantSettings.obtener(tenantId);

    return this.prisma.$transaction(async (tx) => {
      // RLS write (D-7): fija el tenant del Gestor como PRIMERA operación.
      await this.prisma.fijarTenant(tx, tenantId);

      // (1) Resolver la elegida DENTRO del tenant del JWT (RLS), ANTES del lock. Si NO es
      // resoluble bajo RLS (no existe o es de OTRO tenant), es "no encontrada" (H-1,
      // code-review US-019): el controller lo mapea a 404, NUNCA a 422 (que se reserva
      // para FA-05 "existe pero ya no en 2.d"). Se captura su `consulta_bloqueante_id`
      // PRE-lock: es la bloqueante que el Gestor "cree" que está expirando (la vista de
      // US-017). Si bajo el lock esa bloqueante ya cambió (otra ruta promovió y reordenó
      // la cola), es carrera perdida.
      const elegidas = await tx.$queryRaw<FilaReservaElegida[]>(Prisma.sql`
        SELECT id_reserva, sub_estado, fecha_evento, posicion_cola, consulta_bloqueante_id
        FROM reserva
        WHERE tenant_id = ${tenantId} AND id_reserva = ${reservaId}
      `);
      if (elegidas.length === 0) {
        throw new PromocionManualReservaNoEncontradaError();
      }
      const elegida = elegidas[0];
      if (elegida.fecha_evento === null) {
        // Una RESERVA sin fecha de evento no es una consulta de cola resoluble: no es
        // localizable como elegida de la cola → tratada como "no encontrada" (404).
        throw new PromocionManualReservaNoEncontradaError();
      }
      const fecha = elegida.fecha_evento;
      const fechaIso = formatearFecha(fecha);
      const bloqueanteEsperadaId = elegida.consulta_bloqueante_id;

      // (2) SELECT … FOR UPDATE sobre la fila de FECHA_BLOQUEADA: punto de SERIALIZACIÓN
      // (RC-A/RC-B). La segunda ruta concurrente espera aquí hasta el COMMIT de la
      // primera. Sin fila activa → inconsistencia (una consulta en 2.d sin fecha
      // bloqueada), salvo que la carrera la haya dejado sin bloqueo momentáneamente.
      const bloqueos = await tx.$queryRaw<FilaBloqueoVivo[]>(Prisma.sql`
        SELECT id_bloqueo, reserva_id
        FROM fecha_bloqueada
        WHERE tenant_id = ${tenantId} AND fecha = ${fechaIso}::date
        FOR UPDATE
      `);
      if (bloqueos.length === 0) {
        throw new PromocionManualSinBloqueoError();
      }
      const bloqueo = bloqueos[0];

      // (3) Guardas bajo lock. Re-leer la elegida (pudo cambiar entre (1) y el lock).
      const elegidaReleidas = await tx.$queryRaw<FilaReservaElegida[]>(Prisma.sql`
        SELECT id_reserva, sub_estado, fecha_evento, posicion_cola, consulta_bloqueante_id
        FROM reserva
        WHERE tenant_id = ${tenantId} AND id_reserva = ${reservaId}
      `);
      const elegidaActual = elegidaReleidas[0];
      const subElegida =
        elegidaActual.sub_estado === null
          ? null
          : subEstadoPrismaADominio(elegidaActual.sub_estado);

      // Estado de la reserva que HOY posee el bloqueo (la bloqueante actual).
      const bloqueantes = await tx.$queryRaw<FilaBloqueante[]>(Prisma.sql`
        SELECT id_reserva, estado, sub_estado
        FROM reserva
        WHERE tenant_id = ${tenantId} AND id_reserva = ${bloqueo.reserva_id}
      `);
      const bloqueante = bloqueantes.length > 0 ? bloqueantes[0] : null;

      // Guarda "ya promovida" (D-4): distingue CARRERA PERDIDA (409) de FA-05 (422).
      // - Si la propia elegida ya está en 2.b, otra ruta la promovió → carrera (409).
      // - Si la elegida ya NO está en 2.d por otra causa (terminal 2x/2y/2z, etc.) →
      //   "ya no en cola" (422, FA-05): expiró/fue descartada por su cuenta.
      if (subElegida === '2b') {
        throw new PromocionManualCarreraPerdidaError();
      }
      if (subElegida !== '2d') {
        throw new PromocionManualConsultaNoEnColaError();
      }

      // La elegida SIGUE en 2.d, pero la bloqueante que "creía" estar expirando (leída
      // PRE-lock, o sea la de la vista del Gestor) ya cambió bajo el lock: otra ruta
      // (barrido automático US-018 u otro Gestor) promovió y reordenó la cola,
      // re-apuntando la elegida a una NUEVA bloqueante. FIFO estricto + gana el primer
      // lock (D-4, sin cesión): el Gestor pierde → carrera perdida (409).
      if (
        bloqueanteEsperadaId !== null &&
        elegidaActual.consulta_bloqueante_id !== bloqueanteEsperadaId
      ) {
        throw new PromocionManualCarreraPerdidaError();
      }

      // (4) Leer la cola bajo lock y planificar.
      const filasCola = await tx.$queryRaw<FilaColaManual[]>(Prisma.sql`
        SELECT id_reserva, sub_estado, posicion_cola, consulta_bloqueante_id
        FROM reserva
        WHERE tenant_id = ${tenantId}
          AND fecha_evento = ${fechaIso}::date
          AND sub_estado = 's2d'
        FOR UPDATE
      `);
      const cola: EntradaColaManual[] = filasCola.map((fila) => ({
        reservaId: fila.id_reserva,
        subEstado:
          fila.sub_estado === null ? '2d' : subEstadoPrismaADominio(fila.sub_estado),
        posicionCola: fila.posicion_cola ?? 0,
        consultaBloqueanteId: fila.consulta_bloqueante_id ?? '',
      }));

      const plan = planificarPromocionManualCola(cola, reservaId);

      if (plan.anomalia || plan.promovida === null) {
        await this.auditarAnomalia(tx, tenantId, usuarioId, fechaIso, cola);
        throw new PromocionManualConsultaNoEnColaError();
      }

      const promovida = plan.promovida;
      const ahora = new Date();

      // (5a) Expirar la bloqueante viva a 2.x (ttl → NULL), si sigue viva. La guarda
      // declarativa admite 2b/2c/2v (TTL vigente O vencido no barrido). Si la fila de
      // bloqueo apunta a la propia promovida o a una reserva ya terminal, no se expira.
      let bloqueanteExpiradaId: string | null = null;
      if (bloqueante !== null && bloqueante.id_reserva !== promovida.reservaId) {
        const subBloqueante =
          bloqueante.sub_estado === null
            ? null
            : subEstadoPrismaADominio(bloqueante.sub_estado);
        const destino = resolverExpiracionForzosaBloqueante(
          bloqueante.estado === 'consulta' ? 'consulta' : 'reserva_cancelada',
          subBloqueante,
        );
        if (destino !== null) {
          await tx.reserva.update({
            where: { idReserva: bloqueante.id_reserva },
            data: {
              estado: destino.estado,
              subEstado: subEstadoDominioAPrisma(destino.subEstado) as SubEstadoConsulta,
              ttlExpiracion: null,
            },
          });
          bloqueanteExpiradaId = bloqueante.id_reserva;
        }
      }

      // (5b) Promover la elegida a 2.b: sale de la cola, TTL blando = now()+ttl_consulta.
      const planBloqueo = resolverPlanBloqueo({
        fase: '2.b',
        ahora,
        settings: settings ?? { ttlConsultaDias: 0, ttlPrereservaDias: 0 },
      });

      await tx.reserva.update({
        where: { idReserva: promovida.reservaId },
        data: {
          estado: promovida.estadoDestino,
          subEstado: subEstadoDominioAPrisma(
            promovida.subEstadoDestino,
          ) as SubEstadoConsulta,
          posicionCola: null,
          consultaBloqueanteId: null,
          ttlExpiracion: planBloqueo.ttl,
        },
      });

      // (5c) RE-ASIGNAR la fila de FECHA_BLOQUEADA existente a la promovida (UPDATE de la
      // MISMA fila): mantiene UNA sola fila activa por (tenant, fecha) en todo momento, sin
      // instante observable con la fecha libre (D-3). No se borra ni se re-inserta.
      await tx.fechaBloqueada.update({
        where: { idBloqueo: bloqueo.id_bloqueo },
        data: {
          reservaId: promovida.reservaId,
          tipoBloqueo: 'blando',
          ttlExpiracion: planBloqueo.ttl,
        },
      });

      // (5d) Reordenar por cierre de hueco en orden ASCENDENTE de posición destino para
      // no violar el índice UNIQUE parcial de cola a mitad (US-004 §D-8).
      const reordenados = [...plan.reordenamientos].sort(
        (a, b) => a.posicionColaDestino - b.posicionColaDestino,
      );
      for (const reordenamiento of reordenados) {
        await tx.reserva.update({
          where: { idReserva: reordenamiento.reservaId },
          data: {
            posicionCola: reordenamiento.posicionColaDestino,
            consultaBloqueanteId: reordenamiento.consultaBloqueanteIdDestino,
          },
        });
      }

      // (5e) AUDIT_LOG por cada RESERVA modificada, en la misma transacción, con el
      // usuario_id del Gestor y `origen: 'promocion_manual'`.
      let auditadas = 0;

      if (bloqueanteExpiradaId !== null) {
        await tx.auditLog.create({
          data: {
            tenantId,
            usuarioId,
            entidad: 'RESERVA',
            entidadId: bloqueanteExpiradaId,
            accion: AccionAudit.transicion,
            datosAnteriores: {
              subEstado: bloqueante?.sub_estado ?? null,
            } as Prisma.InputJsonValue,
            datosNuevos: {
              subEstado: '2x',
              origen: 'promocion_manual',
            } as Prisma.InputJsonValue,
          },
        });
        auditadas += 1;
      }

      await tx.auditLog.create({
        data: {
          tenantId,
          usuarioId,
          entidad: 'RESERVA',
          entidadId: promovida.reservaId,
          accion: AccionAudit.transicion,
          datosAnteriores: { subEstado: '2d' } as Prisma.InputJsonValue,
          datosNuevos: {
            subEstado: promovida.subEstadoDestino,
            origen: 'promocion_manual',
          } as Prisma.InputJsonValue,
        },
      });
      auditadas += 1;

      for (const reordenamiento of reordenados) {
        await tx.auditLog.create({
          data: {
            tenantId,
            usuarioId,
            entidad: 'RESERVA',
            entidadId: reordenamiento.reservaId,
            accion: AccionAudit.transicion,
            datosAnteriores: { subEstado: '2d' } as Prisma.InputJsonValue,
            datosNuevos: {
              subEstado: '2d',
              posicionCola: reordenamiento.posicionColaDestino,
              consultaBloqueanteId: reordenamiento.consultaBloqueanteIdDestino,
              origen: 'promocion_manual',
            } as Prisma.InputJsonValue,
          },
        });
        auditadas += 1;
      }

      return {
        reservaPromovidaId: promovida.reservaId,
        bloqueanteExpiradaId,
        fechaReAsignada: true,
        reordenadas: reordenados.length,
        auditadas,
      };
    });
  }

  /**
   * Registra la anomalía (posiciones no contiguas o guarda de origen inviolada) en
   * AUDIT_LOG con el usuario del Gestor, sin corregir silenciosamente (§D-8).
   */
  private async auditarAnomalia(
    tx: Prisma.TransactionClient,
    tenantId: string,
    usuarioId: string,
    fechaIso: string,
    cola: ReadonlyArray<EntradaColaManual>,
  ): Promise<void> {
    for (const entrada of cola) {
      await tx.auditLog.create({
        data: {
          tenantId,
          usuarioId,
          entidad: 'RESERVA',
          entidadId: entrada.reservaId,
          accion: AccionAudit.transicion,
          datosNuevos: {
            origen: 'promocion_manual',
            anomalia: 'no_promovible',
            fecha: fechaIso,
            posicionCola: entrada.posicionCola,
          } as Prisma.InputJsonValue,
        },
      });
    }
  }
}

/**
 * Adaptador de la UNIDAD DE TRABAJO atómica de PROMOCIÓN de cola (US-018 / UC-12,
 * A15). Implementa `PromocionColaUoWPort`.
 *
 * Abre UN único `prisma.$transaction` bajo el contexto RLS del `tenantId` del comando
 * (`SET LOCAL app.tenant_id` como PRIMERA operación, D-7). Dentro de esa transacción,
 * all-or-nothing (§D-4):
 *   1. `SELECT … FOR UPDATE` sobre la fila de `FECHA_BLOQUEADA` de `(tenant, fecha)`
 *      (puede no existir aún: el post-commit de la liberación la eliminó) — punto de
 *      SERIALIZACIÓN (RC-1/RC-2/RC-3). La exclusión mutua vive SOLO en PostgreSQL
 *      (atomic-date-lock); NADA de Redis/locks distribuidos.
 *   2. Guarda "ya promovida" (D-3): si ya existe un bloqueo vivo sobre `(tenant, fecha)`
 *      (otra ruta promovió y re-bloqueó), no-op silencioso (`promovida = false`).
 *   3. Leer la cola bajo lock (RESERVA en `2.d` con `fecha_evento = fecha` de este
 *      tenant), calcular el plan puro (`planificarPromocionCola`). Cola vacía → no-op
 *      (FA-02). Posiciones no contiguas → auditar la anomalía + abortar sin corregir.
 *   4. Aplicar el plan: mutar la promovida a `2.b` (posicion_cola/consulta_bloqueante_id
 *      → NULL, ttl_expiracion = now()+ttl_consulta_dias), re-bloquear vía la primitiva
 *      atómica `bloquearFechaEnTx()` (US-040, reutilizada), reordenar el resto en orden
 *      ascendente para no violar el índice UNIQUE parcial de cola.
 *   5. AUDIT_LOG `accion='transicion'`, `entidad='RESERVA'` por cada RESERVA modificada
 *      (promovida con `origen: 'promocion_automatica'`; reordenadas con su nuevo
 *      posicion_cola/consulta_bloqueante_id). Deja constancia de la ALERTA INTERNA al
 *      gestor (D-5), sin email al cliente / sin tocar el puerto de comunicaciones.
 *
 * Si el re-bloqueo choca con el `UNIQUE(tenant_id, fecha)` (bloqueo intruso), Prisma
 * lanza `P2002` que se propaga y hace rollback total (atomicidad, §Riesgos).
 */
import { Injectable } from '@nestjs/common';
import { AccionAudit, Prisma, SubEstadoConsulta } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  PromocionColaUoWPort,
  PromoverPrimeroEnColaComando,
  ResultadoPromocion,
} from '../application/promover-primero-en-cola.service';
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

/** Fila cruda de una RESERVA en cola (columnas snake_case). */
interface FilaColaBloqueada {
  id_reserva: string;
  sub_estado: SubEstadoConsultaPrisma | null;
  posicion_cola: number | null;
  consulta_bloqueante_id: string | null;
}

const noPromovido = (anomalia = false): ResultadoPromocion => ({
  promovida: false,
  reservaPromovidaId: null,
  fechaReBloqueada: false,
  reordenadas: 0,
  alertaInternaRegistrada: false,
  anomalia,
});

@Injectable()
export class PromocionColaUoWPrismaAdapter implements PromocionColaUoWPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly fechaBloqueada: FechaBloqueadaPrismaAdapter,
    private readonly tenantSettings: TenantSettingsPrismaAdapter,
  ) {}

  async promover(comando: PromoverPrimeroEnColaComando): Promise<ResultadoPromocion> {
    const { tenantId, fecha } = comando;
    const fechaIso = formatearFecha(fecha);

    // Leer los TTL fuera de la transacción de promoción (lectura propia con RLS);
    // el instante absoluto se calcula dentro con el reloj del sistema.
    const settings = await this.tenantSettings.obtener(tenantId);

    return this.prisma.$transaction(async (tx) => {
      // RLS write (D-7): fija el tenant del comando como PRIMERA operación.
      await this.prisma.fijarTenant(tx, tenantId);

      // (1) SELECT … FOR UPDATE de la cola: punto de SERIALIZACIÓN (RC-1/RC-2/RC-3).
      // La fila de FECHA_BLOQUEADA de (tenant, fecha) no existe tras la liberación
      // post-commit, así que NO sirve como cerrojo (un `FOR UPDATE` sobre 0 filas no
      // bloquea a nadie). En su lugar se bloquean las RESERVA en `2.d` de esta fecha:
      // la segunda ruta concurrente queda bloqueada aquí hasta el COMMIT de la primera.
      const filas = await tx.$queryRaw<FilaColaBloqueada[]>(Prisma.sql`
        SELECT id_reserva, sub_estado, posicion_cola, consulta_bloqueante_id
        FROM reserva
        WHERE tenant_id = ${tenantId}
          AND fecha_evento = ${fechaIso}::date
          AND sub_estado = 's2d'
        FOR UPDATE
      `);

      // (2) Guarda "ya promovida" (D-3): TRAS adquirir el lock de la cola, re-verificar
      // si YA existe un bloqueo vivo sobre (tenant, fecha). Si la primera ruta ya
      // promovió y re-bloqueó, aquí se detecta → no-op silencioso (idempotencia /
      // RC-1 / RC-2 / RC-3), sin re-promover ni re-decrementar.
      const bloqueos = await tx.$queryRaw<{ reserva_id: string }[]>(Prisma.sql`
        SELECT reserva_id FROM fecha_bloqueada
        WHERE tenant_id = ${tenantId} AND fecha = ${fechaIso}::date
      `);
      if (bloqueos.length > 0) {
        return noPromovido();
      }

      if (filas.length === 0) {
        // FA-02: sin candidato en cola → no-op sin error (idempotencia defensiva).
        return noPromovido();
      }

      const cola: EntradaCola[] = filas.map((fila) => ({
        reservaId: fila.id_reserva,
        subEstado:
          fila.sub_estado === null ? '2d' : subEstadoPrismaADominio(fila.sub_estado),
        posicionCola: fila.posicion_cola ?? 0,
        consultaBloqueanteId: fila.consulta_bloqueante_id ?? '',
      }));

      const plan = planificarPromocionCola(cola);

      // Anomalía de posiciones no contiguas (§D-8): auditar + abortar sin corregir.
      if (plan.anomalia) {
        await this.auditarAnomalia(tx, tenantId, fechaIso, cola);
        return noPromovido(true);
      }

      if (plan.promovida === null) {
        return noPromovido();
      }

      const promovida = plan.promovida;

      // (4) Mutar la promovida a 2.b: sale de la cola, re-calcula el TTL blando como
      // INSTANTE now()+ttl_consulta_dias (nunca fecha formateada, D-4).
      const planBloqueo = resolverPlanBloqueo({
        fase: '2.b',
        ahora: new Date(),
        settings: settings ?? { ttlConsultaDias: 0, ttlPrereservaDias: 0 },
      });

      await tx.reserva.update({
        where: { idReserva: promovida.reservaId },
        data: {
          estado: promovida.estadoDestino,
          subEstado: subEstadoDominioAPrisma(promovida.subEstadoDestino) as SubEstadoConsulta,
          posicionCola: null,
          consultaBloqueanteId: null,
          ttlExpiracion: planBloqueo.ttl,
        },
      });

      // Re-bloquear la fecha con la primitiva atómica reutilizada (US-040), DENTRO de
      // esta misma transacción. Un choque con UNIQUE(tenant, fecha) lanza P2002 →
      // rollback total (atomicidad).
      await this.fechaBloqueada.bloquearEnTx(tx, {
        tenantId,
        fecha,
        reservaId: promovida.reservaId,
        plan: planBloqueo,
      });

      // Reordenar el resto en orden ASCENDENTE de posición destino para no violar el
      // índice UNIQUE parcial de cola a mitad (US-004 §D-8).
      for (const reordenamiento of plan.reordenamientos) {
        await tx.reserva.update({
          where: { idReserva: reordenamiento.reservaId },
          data: {
            posicionCola: reordenamiento.posicionColaDestino,
            consultaBloqueanteId: reordenamiento.consultaBloqueanteIdDestino,
          },
        });
      }

      // (5) AUDIT_LOG por cada RESERVA modificada, en la misma transacción.
      await tx.auditLog.create({
        data: {
          tenantId,
          entidad: 'RESERVA',
          entidadId: promovida.reservaId,
          accion: AccionAudit.transicion,
          datosAnteriores: { subEstado: '2d' } as Prisma.InputJsonValue,
          datosNuevos: {
            subEstado: promovida.subEstadoDestino,
            origen: 'promocion_automatica',
            // Alerta interna al gestor (D-5), sin email al cliente / sin US-045.
            alertaInterna:
              'Consulta promovida al bloqueo de la fecha; contactar al cliente.',
          } as Prisma.InputJsonValue,
        },
      });

      for (const reordenamiento of plan.reordenamientos) {
        await tx.auditLog.create({
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

      return {
        promovida: true,
        reservaPromovidaId: promovida.reservaId,
        fechaReBloqueada: true,
        reordenadas: plan.reordenamientos.length,
        alertaInternaRegistrada: true,
        anomalia: false,
      };
    });
  }

  /**
   * Registra la anomalía de posiciones no contiguas en AUDIT_LOG (una entrada por cada
   * RESERVA de la cola afectada), sin corregir silenciosamente las posiciones (§D-8).
   */
  private async auditarAnomalia(
    tx: Prisma.TransactionClient,
    tenantId: string,
    fechaIso: string,
    cola: ReadonlyArray<EntradaCola>,
  ): Promise<void> {
    for (const entrada of cola) {
      await tx.auditLog.create({
        data: {
          tenantId,
          entidad: 'RESERVA',
          entidadId: entrada.reservaId,
          accion: AccionAudit.transicion,
          datosNuevos: {
            origen: 'promocion_automatica',
            anomalia: 'posiciones_no_contiguas',
            fecha: fechaIso,
            posicionCola: entrada.posicionCola,
          } as Prisma.InputJsonValue,
        },
      });
    }
  }
}

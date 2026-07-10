/**
 * Adaptador Prisma del puerto `AlertaFianzaPendientePort` (US-037 / UC-28, §D-3=3.1/§D-4=4.2).
 *
 * La alerta interna FA-01 ("fianza sin resolver en T+7d") se materializa como una ENTRADA
 * de `AUDIT_LOG` (D-3=3.1), NO como un email ni una superficie nueva de notificaciones
 * (eso es US-044). Actor Sistema: `usuario_id` NULO. El discriminante de la alerta
 * (`tipo = 'fianza_pendiente_t7d'`) viaja en `datos_nuevos`. Como el enum `AccionAudit` NO
 * tiene un valor `alerta`, se usa `accion = 'actualizar'` (existente, NO `transicion`) — la
 * alerta NO es una transición de estado (la RESERVA sigue en `post_evento`); los tests la
 * distinguen justamente por `accion != transicion` + el discriminante en `datos_nuevos`.
 *
 * ANTI-DUPLICACIÓN por AUDIT_LOG (D-4=4.2, SIN migración/flag): `debeEmitir` NO re-emite si
 * ya existe una alerta `fianza_pendiente_t7d` POSTERIOR (o igual) al último cambio de la
 * fianza de esa RESERVA. El "último cambio de fianza" se deriva del rastro auditable: la
 * entrada de AUDIT_LOG más reciente cuyo `datos_nuevos` referencia un campo de fianza
 * (`fianza_status`/`fianza_eur`/`fianzaStatus`/`fianzaEur`), tal como la escribe la
 * devolución de fianza (US-036, `accion='actualizar'`) o el cobro (US-030). Si NO hay
 * ningún cambio de fianza auditado, basta con que exista una alerta previa para suprimir la
 * re-emisión (dos barridos seguidos sin cambio de fianza → UNA sola alerta). Al cambiar la
 * fianza (nueva entrada posterior a la alerta), la ventana se reabre y el siguiente barrido
 * vuelve a alertar.
 *
 * RLS (D-8): `AUDIT_LOG` tiene Row-Level Security activo (`tenant_isolation`), por lo que
 * TODA lectura/escritura de auditoría debe correr bajo el contexto RLS del tenant. Igual que
 * los UoW de facturación (`fijarTenant(tx, tenantId)` como PRIMERA operación dentro de un
 * `$transaction`): sin ese contexto, el INSERT lo RECHAZA la política (`WITH CHECK` derivado
 * del `USING`, `tenant_id = current_setting('app.tenant_id')` no casa) y el SELECT no ve
 * ninguna fila. El `tenantId` sale SIEMPRE de la fila candidata (nunca de input externo).
 */
import { Injectable } from '@nestjs/common';
import { AccionAudit, Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  AlertaFianzaPendiente,
  AlertaFianzaPendientePort,
  ReservaCompletableCandidata,
} from '../application/archivar-reservas-completadas.service';

/** Discriminante de la alerta FA-01 en `datos_nuevos`. */
const TIPO_ALERTA_FA01 = 'fianza_pendiente_t7d';

/** Proyección de una entrada de AUDIT_LOG relevante para la anti-duplicación. */
interface FilaAudit {
  fecha: Date;
  datos_nuevos: unknown;
}

const referenciaFianza = (datosNuevos: unknown): boolean => {
  const serializado = JSON.stringify(datosNuevos ?? {});
  return (
    serializado.includes('fianza_status') ||
    serializado.includes('fianza_eur') ||
    serializado.includes('fianzaStatus') ||
    serializado.includes('fianzaEur')
  );
};

const esAlertaFa01 = (datosNuevos: unknown): boolean =>
  JSON.stringify(datosNuevos ?? {}).includes(TIPO_ALERTA_FA01);

@Injectable()
export class AlertaFianzaPendientePrismaAdapter implements AlertaFianzaPendientePort {
  constructor(private readonly prisma: PrismaService) {}

  async debeEmitir(candidata: ReservaCompletableCandidata): Promise<boolean> {
    // Rastro auditable de esta RESERVA, más reciente primero. Se lee `accion` para
    // separar transiciones (nunca son alertas ni cambios de fianza relevantes aquí) del
    // resto de actualizaciones. La lectura corre bajo el contexto RLS del tenant de LA
    // candidata (RLS activo en audit_log): sin `SET LOCAL app.tenant_id` la política
    // filtraría todas las filas y la anti-duplicación no vería la alerta previa.
    const filas = await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, candidata.tenantId);
      return tx.$queryRaw<FilaAudit[]>(Prisma.sql`
        SELECT fecha_creacion AS fecha, datos_nuevos
        FROM audit_log
        WHERE entidad_id = ${candidata.reservaId}
          AND accion <> ${AccionAudit.transicion}::"AccionAudit"
        ORDER BY fecha_creacion DESC
      `);
    });

    const ultimaAlerta = filas.find((f) => esAlertaFa01(f.datos_nuevos));
    if (ultimaAlerta === undefined) {
      // No hay alerta previa: se debe emitir.
      return true;
    }

    const ultimoCambioFianza = filas.find(
      (f) => !esAlertaFa01(f.datos_nuevos) && referenciaFianza(f.datos_nuevos),
    );
    if (ultimoCambioFianza === undefined) {
      // Hay alerta previa y ningún cambio de fianza posterior conocido: NO re-emitir.
      return false;
    }

    // Re-emitir solo si la fianza cambió DESPUÉS de la última alerta (ventana reabierta).
    return ultimoCambioFianza.fecha.getTime() > ultimaAlerta.fecha.getTime();
  }

  async emitir(alerta: AlertaFianzaPendiente): Promise<void> {
    // RLS write (D-8): el INSERT en audit_log corre bajo el contexto RLS del tenant de la
    // alerta (`fijarTenant(tx, tenantId)` como PRIMERA operación dentro del $transaction,
    // patrón canónico de los UoW de facturación). Sin ese contexto la política de RLS
    // RECHAZA la fila y la alerta FA-01 nunca se persiste.
    await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, alerta.tenantId);
      await tx.auditLog.create({
        data: {
          tenantId: alerta.tenantId,
          usuarioId: null,
          entidad: 'RESERVA',
          entidadId: alerta.reservaId,
          // El enum AccionAudit no tiene 'alerta': se usa 'actualizar' (NO 'transicion'); el
          // discriminante real de la alerta va en datos_nuevos.tipo.
          accion: AccionAudit.actualizar,
          datosNuevos: {
            tipo: TIPO_ALERTA_FA01,
            codigo: alerta.codigo,
            causa: 'T+7d',
          } as Prisma.InputJsonValue,
        },
      });
    });
  }
}

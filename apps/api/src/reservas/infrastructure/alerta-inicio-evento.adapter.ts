/**
 * Adaptador del puerto `AlertaInicioEventoPort` (US-031 / UC-23, §D-8).
 *
 * US-031 PRODUCE las alertas del inicio de evento pero NO construye una superficie de
 * notificaciones nueva (eso es US-044): la crítica por precondiciones incumplidas (remite
 * al forzado manual US-032) y la A29 no bloqueante por condiciones particulares no
 * firmadas. Mientras no exista un canal formal de alertas de Sistema en el MVP, se
 * registran de forma TRAZABLE (log de Sistema) sin bloquear el barrido (decisión de
 * implementación menor, no de alcance): el rastro auditable de la transición efectiva es
 * `AUDIT_LOG`. Cuando US-044 aterrice el dashboard de notificaciones, este adaptador es el
 * único punto a re-cablear hacia el canal real.
 */
import { Injectable, Logger } from '@nestjs/common';
import type {
  AlertaA29,
  AlertaInicioEventoPort,
  AlertaPrecondicionesIncumplidas,
} from '../application/iniciar-eventos-del-dia.service';

@Injectable()
export class AlertaInicioEventoAdapter implements AlertaInicioEventoPort {
  private readonly logger = new Logger('AlertaInicioEvento');

  async emitirPrecondicionesIncumplidas(
    alerta: AlertaPrecondicionesIncumplidas,
  ): Promise<void> {
    this.logger.warn(
      `[ALERTA CRÍTICA] Evento de hoy (reserva ${alerta.reservaId}, tenant ` +
        `${alerta.tenantId}) con precondiciones incumplidas: ` +
        `[${alerta.incumplidas.join(', ')}]. El gestor puede forzar el inicio ` +
        `manualmente (US-032).`,
    );
  }

  async emitirA29(alerta: AlertaA29): Promise<void> {
    this.logger.warn(
      `[A29] Las condiciones particulares de la reserva ${alerta.reservaId} (tenant ` +
        `${alerta.tenantId}) no están firmadas el día del evento. El cliente puede ` +
        `firmarlas presencialmente. (No bloqueante.)`,
    );
  }
}

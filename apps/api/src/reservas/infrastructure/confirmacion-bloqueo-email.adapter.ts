/**
 * Adaptador del puerto `ConfirmacionBloqueoEmailPort` (US-005 / §D-6).
 *
 * Envía el email de confirmación de bloqueo provisional (extensión de E1, sin código
 * `E` propio) REUTILIZANDO el motor real de US-045 (`DespacharEmailService`): NO se
 * reinventa el envío. La COMUNICACION ya se creó en `borrador` dentro de la
 * transacción de la transición; aquí se delega POST-COMMIT en `finalizarEnvio`, que
 * centraliza el try/catch del proveedor y promueve la fila a `enviado`/`fallido` sin
 * propagar la excepción (un fallo de email no revierte la transición ya comprometida).
 */
import { Injectable } from '@nestjs/common';
import { DespacharEmailService } from '../../comunicaciones/application/despachar-email.service';
import type {
  ConfirmacionBloqueoEmailPort,
  EnviarConfirmacionBloqueoParams,
  EnviarConfirmacionBloqueoResultado,
} from '../application/transicion-fecha.use-case';

@Injectable()
export class ConfirmacionBloqueoEmailAdapter implements ConfirmacionBloqueoEmailPort {
  constructor(private readonly motorEmail: DespacharEmailService) {}

  async enviarConfirmacionBloqueoProvisional(
    params: EnviarConfirmacionBloqueoParams,
  ): Promise<EnviarConfirmacionBloqueoResultado> {
    const { estado, fechaEnvio } = await this.motorEmail.finalizarEnvio({
      tenantId: params.tenantId,
      reservaId: params.reservaId,
      idComunicacion: params.idComunicacion,
      destinatario: params.destinatario,
      asunto: params.asunto,
      cuerpo: params.cuerpo,
      // Extensión de E1 (confirmación de bloqueo provisional): mismo código E1.
      codigoEmail: 'E1',
    });
    return { estado, fechaEnvio };
  }
}

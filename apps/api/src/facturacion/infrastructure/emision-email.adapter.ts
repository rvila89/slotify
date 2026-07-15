/**
 * Adaptadores del ENVÍO de email de la emisión (US-028 / UC-21, UC-22) — cablean los puertos
 * de facturacion (`enviarE4`, `enviarRecibo`, `reenviarE4`) al motor/transporte de email de
 * US-045 (`EnviarEmailPort`, fake en test/CI, Resend en prod).
 *
 * E4/recibo/reenvío son SÍNCRONOS y CONFIRMADOS (design.md §D-1): el envío se espera y, si el
 * proveedor falla, el error PROPAGA (a diferencia del post-commit fire-and-forget de E1–E3),
 * de modo que la unidad de trabajo de la emisión REVIERTA. El registro de la COMUNICACION lo
 * hace el propio use-case dentro de la tx; estos adaptadores solo confirman el envío.
 */
import { Injectable } from '@nestjs/common';
import type { AdjuntoRef, EnviarEmailPort } from '../../comunicaciones/domain/enviar-email.port';
import type {
  EnviarE4EmisionParams,
  EnviarE4EmisionPort,
} from '../application/aprobar-y-enviar-liquidacion.use-case';
import type {
  EnviarE3EmisionParams,
  EnviarE3EmisionPort,
} from '../application/enviar-factura-senal.use-case';
import type {
  EnviarReciboFianzaParams,
  EnviarReciboFianzaPort,
} from '../application/enviar-recibo-fianza-separado.use-case';
import type {
  ReenviarE4Params,
  ReenviarE4Port,
} from '../application/reenviar-liquidacion.use-case';

/** Convierte los adjuntos del use-case a `AdjuntoRef` del puerto de email. */
const aAdjuntosRef = (
  adjuntos: ReadonlyArray<{ clave: string; nombre: string; pdfUrl: string }>,
): AdjuntoRef[] =>
  adjuntos.map((a) => ({ clave: a.clave, nombre: a.nombre, pdfUrl: a.pdfUrl }));

/** Adaptador del envío de E4 (aprobar y enviar la liquidación). */
@Injectable()
export class EnviarE4EmisionAdapter {
  constructor(private readonly enviarEmail: EnviarEmailPort) {}

  readonly enviar: EnviarE4EmisionPort = async (params: EnviarE4EmisionParams) => {
    await this.enviarEmail.enviar({
      destinatario: params.destinatario,
      asunto: `Factura de liquidación y recibo de fianza — reserva ${params.codigoReserva}`,
      cuerpo: 'Adjuntamos la documentación de cobro de tu evento.',
      codigoEmail: 'E4',
      tenantId: params.tenantId,
      adjuntos: aAdjuntosRef(params.adjuntos),
    });
    return { idComunicacion: '', estado: 'enviado' as const, fechaEnvio: new Date() };
  };
}

/**
 * Adaptador del envío de E3 (enviar la factura de señal 40% + condicions particulars). Espejo
 * literal de `EnviarE4EmisionAdapter`: usa `EnviarEmailPort` DIRECTO con `codigoEmail: 'E3'` (NO
 * pasa por el motor/catálogo, §D-ruta-email). SÍNCRONO y CONFIRMADO: si el proveedor falla, el
 * error PROPAGA para que la unidad de trabajo de la emisión REVIERTA.
 */
@Injectable()
export class EnviarE3EmisionAdapter {
  constructor(private readonly enviarEmail: EnviarEmailPort) {}

  readonly enviar: EnviarE3EmisionPort = async (params: EnviarE3EmisionParams) => {
    await this.enviarEmail.enviar({
      destinatario: params.destinatario,
      asunto: `Confirmación de tu reserva y factura de señal — reserva ${params.codigoReserva}`,
      cuerpo: 'Adjuntamos la factura de la señal y las condicions particulars de tu evento.',
      codigoEmail: 'E3',
      tenantId: params.tenantId,
      adjuntos: aAdjuntosRef(params.adjuntos),
    });
    return { idComunicacion: '', estado: 'enviado' as const, fechaEnvio: new Date() };
  };
}

/** Adaptador del envío separado del recibo de fianza (email `manual`). */
@Injectable()
export class EnviarReciboFianzaAdapter {
  constructor(private readonly enviarEmail: EnviarEmailPort) {}

  readonly enviar: EnviarReciboFianzaPort = async (params: EnviarReciboFianzaParams) => {
    await this.enviarEmail.enviar({
      destinatario: params.destinatario,
      asunto: `Recibo de fianza — reserva ${params.codigoReserva}`,
      cuerpo: 'Adjuntamos el recibo de la fianza de tu evento.',
      codigoEmail: 'manual',
      tenantId: params.tenantId,
      adjuntos: aAdjuntosRef(params.adjuntos),
    });
    return { idComunicacion: '', estado: 'enviado' as const, fechaEnvio: new Date() };
  };
}

/** Adaptador del reenvío de E4 (reenvía el PDF ya emitido). */
@Injectable()
export class ReenviarE4Adapter {
  constructor(private readonly enviarEmail: EnviarEmailPort) {}

  readonly reenviar: ReenviarE4Port = async (params: ReenviarE4Params) => {
    await this.enviarEmail.enviar({
      destinatario: params.destinatario,
      asunto: `Reenvío factura de liquidación ${params.numeroFactura ?? ''} — reserva ${params.codigoReserva}`,
      cuerpo: 'Reenviamos tu factura de liquidación.',
      codigoEmail: 'E4',
      tenantId: params.tenantId,
      adjuntos: aAdjuntosRef(params.adjuntos),
    });
    return { idComunicacion: '', estado: 'enviado' as const, fechaEnvio: new Date() };
  };
}

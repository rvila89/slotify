/**
 * Adaptadores del ENVÍO de email de la emisión (UC-21 liquidación, UC-18 señal) — cablean los
 * puertos de facturacion (`enviarE4`, `enviarE3`, `reenviarE4`, `reenviarE3`) al motor/transporte
 * de email de US-045 (`EnviarEmailPort`, fake en test/CI, Resend en prod).
 *
 * E3/E4/reenvíos son SÍNCRONOS y CONFIRMADOS (design.md §D-1): el envío se espera y, si el
 * proveedor falla, el error PROPAGA (a diferencia del post-commit fire-and-forget de E1–E2), de
 * modo que la unidad de trabajo de la emisión REVIERTA. El registro de la COMUNICACION lo hace el
 * propio use-case dentro de la tx; estos adaptadores solo confirman el envío.
 *
 * fix-liquidacion-fianza-independientes: E4 = SOLO liquidación (texto bilingüe nuevo del catálogo,
 * variables `nombre`/`fianzaEur`); desaparece el adaptador del recibo de fianza por separado.
 */
import { Injectable } from '@nestjs/common';
import type { AdjuntoRef, EnviarEmailPort } from '../../comunicaciones/domain/enviar-email.port';
import type { CatalogoPlantillasPort } from '../../comunicaciones/domain/catalogo-plantillas.port';
import type {
  EnviarE4EmisionParams,
  EnviarE4EmisionPort,
} from '../application/enviar-factura-liquidacion.use-case';
import type {
  EnviarE3EmisionParams,
  EnviarE3EmisionPort,
} from '../application/enviar-factura-senal.use-case';
import type {
  ReenviarE4Params,
  ReenviarE4Port,
} from '../application/reenviar-liquidacion.use-case';
import type {
  ReenviarE3Params,
  ReenviarE3Port,
} from '../application/reenviar-e3.use-case';

/** Convierte los adjuntos del use-case a `AdjuntoRef` del puerto de email. */
const aAdjuntosRef = (
  adjuntos: ReadonlyArray<{ clave: string; nombre: string; pdfUrl: string }>,
): AdjuntoRef[] =>
  adjuntos.map((a) => ({ clave: a.clave, nombre: a.nombre, pdfUrl: a.pdfUrl }));

/**
 * Adaptador del envío de E4 (aprobar y enviar la liquidación). E4 = SOLO liquidación: usa la
 * plantilla E4 del catálogo (bilingüe CA/ES por `idioma`, variables `nombre`/`fianzaEur`) con el
 * ÚNICO adjunto de la liquidación. SÍNCRONO y CONFIRMADO: si el proveedor falla, PROPAGA para que
 * la unidad de trabajo REVIERTA.
 */
@Injectable()
export class EnviarE4EmisionAdapter {
  constructor(
    private readonly enviarEmail: EnviarEmailPort,
    private readonly catalogo: CatalogoPlantillasPort,
  ) {}

  readonly enviar: EnviarE4EmisionPort = async (params: EnviarE4EmisionParams) => {
    const plantilla =
      this.catalogo.seleccionar('E4', params.idioma ?? 'es') ??
      this.catalogo.seleccionar('E4', 'es')!;
    const rendered = plantilla.render({
      nombre: params.nombre ?? '',
      fianzaEur: params.fianzaEur ?? '',
      codigoReserva: params.codigoReserva,
    });
    await this.enviarEmail.enviar({
      destinatario: params.destinatario,
      asunto: rendered.asunto,
      cuerpo: rendered.cuerpoHtml,
      cuerpoEsHtml: true,
      codigoEmail: 'E4',
      idioma: params.idioma,
      tenantId: params.tenantId,
      adjuntos: aAdjuntosRef(params.adjuntos),
    });
    return { idComunicacion: '', estado: 'enviado' as const, fechaEnvio: new Date() };
  };
}

/**
 * Adaptador del envío de E3 (enviar la factura de señal 40% + condicions particulars). Usa
 * `EnviarEmailPort` DIRECTO con `codigoEmail: 'E3'` (§D-ruta-email). SÍNCRONO y CONFIRMADO: si el
 * proveedor falla, el error PROPAGA para que la unidad de trabajo de la emisión REVIERTA.
 */
@Injectable()
export class EnviarE3EmisionAdapter {
  constructor(
    private readonly enviarEmail: EnviarEmailPort,
    private readonly catalogo: CatalogoPlantillasPort,
  ) {}

  readonly enviar: EnviarE3EmisionPort = async (params: EnviarE3EmisionParams) => {
    const plantilla =
      this.catalogo.seleccionar('E3', params.idioma ?? 'es') ??
      this.catalogo.seleccionar('E3', 'es')!;
    const rendered = plantilla.render({
      nombre: params.nombre ?? '',
      codigoReserva: params.codigoReserva,
    });
    await this.enviarEmail.enviar({
      destinatario: params.destinatario,
      asunto: rendered.asunto,
      cuerpo: rendered.cuerpoHtml,
      cuerpoEsHtml: true,
      codigoEmail: 'E3',
      idioma: params.idioma,
      tenantId: params.tenantId,
      adjuntos: aAdjuntosRef(params.adjuntos),
    });
    return { idComunicacion: '', estado: 'enviado' as const, fechaEnvio: new Date() };
  };
}

/**
 * Adaptador del reenvío de E4 (reenvía el PDF de la liquidación ya emitido). Usa la plantilla E4
 * del catálogo (bilingüe). SÍNCRONO/CONFIRMADO.
 */
@Injectable()
export class ReenviarE4Adapter {
  constructor(
    private readonly enviarEmail: EnviarEmailPort,
    private readonly catalogo: CatalogoPlantillasPort,
  ) {}

  readonly reenviar: ReenviarE4Port = async (params: ReenviarE4Params) => {
    const plantilla =
      this.catalogo.seleccionar('E4', params.idioma ?? 'es') ??
      this.catalogo.seleccionar('E4', 'es')!;
    const rendered = plantilla.render({
      nombre: params.nombre ?? '',
      fianzaEur: params.fianzaEur ?? '',
      codigoReserva: params.codigoReserva,
    });
    await this.enviarEmail.enviar({
      destinatario: params.destinatario,
      asunto: rendered.asunto,
      cuerpo: rendered.cuerpoHtml,
      cuerpoEsHtml: true,
      codigoEmail: 'E4',
      idioma: params.idioma,
      tenantId: params.tenantId,
      adjuntos: aAdjuntosRef(params.adjuntos),
    });
    return { idComunicacion: '', estado: 'enviado' as const, fechaEnvio: new Date() };
  };
}

/**
 * Adaptador del reenvío de E3 (US-023 / GAP 3): reenvía la factura de señal ya emitida + el
 * DOCUMENTO de condiciones ya persistido, sin regenerar nada. `EnviarEmailPort` DIRECTO con
 * `codigoEmail: 'E3'`, SÍNCRONO/CONFIRMADO (si el proveedor falla, PROPAGA).
 */
@Injectable()
export class ReenviarE3Adapter {
  constructor(
    private readonly enviarEmail: EnviarEmailPort,
    private readonly catalogo: CatalogoPlantillasPort,
  ) {}

  readonly reenviar: ReenviarE3Port = async (params: ReenviarE3Params) => {
    const plantilla =
      this.catalogo.seleccionar('E3', params.idioma ?? 'es') ??
      this.catalogo.seleccionar('E3', 'es')!;
    const rendered = plantilla.render({
      nombre: params.nombre ?? '',
      codigoReserva: params.codigoReserva,
    });
    await this.enviarEmail.enviar({
      destinatario: params.destinatario,
      asunto: rendered.asunto,
      cuerpo: rendered.cuerpoHtml,
      cuerpoEsHtml: true,
      codigoEmail: 'E3',
      idioma: params.idioma,
      tenantId: params.tenantId,
      adjuntos: aAdjuntosRef(params.adjuntos),
    });
    return { idComunicacion: '', estado: 'enviado' as const, fechaEnvio: new Date() };
  };
}

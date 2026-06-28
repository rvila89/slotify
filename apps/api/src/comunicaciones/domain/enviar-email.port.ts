/**
 * Puerto de DOMINIO para el envío de email (US-003 / UC-03).
 *
 * Interfaz PURA: no importa `@nestjs/*`, Prisma ni infraestructura (hook
 * `no-infra-in-domain`). La lógica de cuándo enviar (auto-envío de E1 vs borrador
 * según `comentarios`) vive en la aplicación; este puerto solo describe el
 * CONTRATO de transporte.
 *
 * En US-003 el adaptador es un STUB no-op (no hace red). US-045 sustituye ese
 * adaptador por el transporte real (Resend/Postmark) SIN tocar este puerto ni el
 * dominio/aplicación que dependen de él.
 */

import type { CodigoEmail } from './codigo-email';

/**
 * Referencia a un adjunto por su `pdf_url` (de `FACTURA`/`DOCUMENTO`/`PRESUPUESTO`).
 * El motor adjunta por referencia; la GENERACIÓN del PDF se difiere a las US de
 * E2/E3/E4. `pdfUrl` nulo = adjunto requerido aún no disponible (bloquea el envío).
 */
export interface AdjuntoRef {
  /** Clave lógica del adjunto declarada por la plantilla (p. ej. `presupuesto`). */
  clave: string;
  /** Nombre de fichero presentado al destinatario (p. ej. `presupuesto.pdf`). */
  nombre: string;
  /** URL del PDF a adjuntar; `null` si todavía no está disponible. */
  pdfUrl: string | null;
}

/**
 * Datos para despachar un email transaccional.
 *
 * US-003 solo usaba los 4 campos base. US-045 (design.md §6) lo extiende con campos
 * OPCIONALES retro-compatibles (idioma, tenantId, variables, adjuntos): los
 * llamadores antiguos siguen compilando y el contrato del puerto no cambia de firma.
 */
export interface EnviarEmailComando {
  /** Dirección de correo del destinatario. */
  destinatario: string;
  /** Asunto del mensaje. */
  asunto: string;
  /** Cuerpo del mensaje (texto/HTML según el adaptador). */
  cuerpo: string;
  /** Código de plantilla del catálogo (E1…E8 o manual). */
  codigoEmail: CodigoEmail;
  /** Idioma de la plantilla aplicada (opcional, US-045). */
  idioma?: string;
  /** Tenant emisor (opcional, para trazas/diagnóstico del adaptador). */
  tenantId?: string;
  /** Variables sustituidas en la plantilla (opcional, para trazas). */
  variables?: Record<string, unknown>;
  /** Adjuntos por referencia a incorporar al envío (opcional). */
  adjuntos?: AdjuntoRef[];
}

/** Puerto de envío de email. La infraestructura lo implementa con un adaptador. */
export interface EnviarEmailPort {
  enviar(comando: EnviarEmailComando): Promise<void>;
}

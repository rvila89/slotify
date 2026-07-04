/**
 * Alias de tipos del dominio de facturación (US-022 · UC-18) sobre el cliente
 * generado del contrato OpenAPI (`@/api-client`). Centralizar aquí evita repetir
 * `components['schemas'][...]` por el dominio y da un único punto de import para
 * componentes y hooks. No se inventan tipos de API: todos derivan del SDK
 * generado (única fuente de verdad).
 */
import type { components } from '@/api-client';

export type FacturaSenal = components['schemas']['FacturaSenalDto'];
export type EstadoFactura = components['schemas']['EstadoFactura'];
export type FacturaEstadoInvalidoError =
  components['schemas']['FacturaEstadoInvalidoError'];
export type FacturaDatosFiscalesIncompletosError =
  components['schemas']['FacturaDatosFiscalesIncompletosError'];
export type FacturaPdfPendienteError =
  components['schemas']['FacturaPdfPendienteError'];
export type ErrorResponse = components['schemas']['ErrorResponse'];

/**
 * Campo fiscal del CLIENTE que puede faltar para emitir la factura de señal
 * (contrato: `FacturaDatosFiscalesIncompletosError.camposFaltantes`).
 */
export type CampoFiscalFaltante =
  FacturaDatosFiscalesIncompletosError['camposFaltantes'][number];

/**
 * Error normalizado de las mutaciones de la factura de señal (aprobar / rechazar /
 * regenerar PDF), para que la UI ramifique en español sin volver a mirar códigos
 * HTTP. Cada `tipo` mapea 1:1 con un caso del contrato OpenAPI de US-022:
 *  - `factura-no-borrador` (409 `FACTURA_NO_BORRADOR`): ya `enviada`/`cobrada`.
 *  - `datos-fiscales-incompletos` (422 `DATOS_FISCALES_INCOMPLETOS`): borrador
 *    inválido; `camposFaltantes` enumera los campos del CLIENTE que faltan.
 *  - `pdf-pendiente` (422 `PDF_PENDIENTE`): fallo transitorio del PDF; reintenta.
 *  - `motivo-requerido` (400): el rechazo llegó sin motivo válido.
 *  - `generico` (401/403/404/red).
 */
export type FacturaError = {
  tipo:
    | 'factura-no-borrador'
    | 'datos-fiscales-incompletos'
    | 'pdf-pendiente'
    | 'motivo-requerido'
    | 'generico';
  mensaje: string;
  /** Solo presente en `datos-fiscales-incompletos` (422 con `camposFaltantes`). */
  camposFaltantes?: CampoFiscalFaltante[];
};

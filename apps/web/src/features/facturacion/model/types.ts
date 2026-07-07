/**
 * Alias de tipos del dominio de facturación (US-022 · UC-18) sobre el cliente
 * generado del contrato OpenAPI (`@/api-client`). Centralizar aquí evita repetir
 * `components['schemas'][...]` por el dominio y da un único punto de import para
 * componentes y hooks. No se inventan tipos de API: todos derivan del SDK
 * generado (única fuente de verdad).
 */
import type { components } from '@/api-client';

export type FacturaSenal = components['schemas']['FacturaSenalDto'];

/**
 * Item de la colección `GET /reservas/{id}/facturas` (US-027). Misma forma que la
 * factura de señal; el tipo distingue `senal` | `liquidacion` | `fianza` |
 * `complementaria`. La visualización de los borradores de liquidación y fianza
 * (US-027) y la alerta al Gestor se derivan de esta colección, sin endpoint propio.
 */
export type Factura = components['schemas']['FacturaDto'];
export type TipoFactura = components['schemas']['TipoFactura'];
export type EstadoFactura = components['schemas']['EstadoFactura'];
export type FacturaEstadoInvalidoError =
  components['schemas']['FacturaEstadoInvalidoError'];
export type FacturaDatosFiscalesIncompletosError =
  components['schemas']['FacturaDatosFiscalesIncompletosError'];
export type FacturaPdfPendienteError =
  components['schemas']['FacturaPdfPendienteError'];
export type ErrorResponse = components['schemas']['ErrorResponse'];

/**
 * Sub-procesos de la RESERVA relevantes para las acciones de facturación de US-028
 * (aprobar/enviar liquidación, enviar recibo de fianza). Derivan de los enums del
 * contrato OpenAPI; la UI habilita/deshabilita acciones según su valor.
 */
export type LiquidacionStatus = components['schemas']['LiquidacionStatus'];
export type FianzaStatus = components['schemas']['FianzaStatus'];

/**
 * Respuestas de las acciones dedicadas de US-028 (facturacion), sobre el SDK generado:
 *  - `AprobarEnviarLiquidacionResponse`: liquidación (+ fianza si se emitió aquí) + status.
 *  - `EnviarReciboFianzaResponse`: recibo de fianza emitido por separado + `fianzaStatus`.
 *  - `ReenviarLiquidacionResponse`: liquidación sin cambios + la nueva COMUNICACION de reenvío.
 */
export type AprobarEnviarLiquidacionResponse =
  components['schemas']['AprobarEnviarLiquidacionResponse'];
export type EnviarReciboFianzaResponse =
  components['schemas']['EnviarReciboFianzaResponse'];
export type ReenviarLiquidacionResponse =
  components['schemas']['ReenviarLiquidacionResponse'];
export type AprobarEnviarLiquidacionRequest =
  components['schemas']['AprobarEnviarLiquidacionRequest'];

/**
 * Tipos del **cobro de fianza** (US-030 · UC-22), sobre el SDK generado:
 *  - `RegistrarCobroFianzaRequest`: body `{ importe, fechaCobro, justificanteDocId?, confirmarSinRecibo }`.
 *  - `RegistrarCobroFianzaResponse`: unión discriminada por `resultado`:
 *      - `RegistrarCobroFianzaCobrado` (`resultado='cobrado'`): PAGO creado, fianza `cobrada`,
 *        `fianzaEur`, `fianzaCobradaFecha`.
 *      - `RegistrarCobroFianzaConfirmacionRequerida` (`resultado='confirmacion_requerida'`): aviso
 *        Negociable (`RECIBO_FIANZA_NO_ENVIADO`) cuando `fianzaStatus='pendiente'` sin
 *        `confirmarSinRecibo`; NO crea PAGO. El frontend muestra el diálogo y reintenta con el flag.
 */
export type RegistrarCobroFianzaRequest =
  components['schemas']['RegistrarCobroFianzaRequest'];
export type RegistrarCobroFianzaResponse =
  components['schemas']['RegistrarCobroFianzaResponse'];
export type RegistrarCobroFianzaCobrado =
  components['schemas']['RegistrarCobroFianzaCobrado'];
export type RegistrarCobroFianzaConfirmacionRequerida =
  components['schemas']['RegistrarCobroFianzaConfirmacionRequerida'];

/** Envelope de error CRUDO del cobro de fianza (`ErrorResponse` + `codigo` + `motivo`). */
export type CobroFianzaErrorResponse = components['schemas']['CobroFianzaError'];

/**
 * Error NORMALIZADO del cobro de fianza (US-030), para que la UI ramifique en español sin
 * volver a mirar códigos HTTP. Cada `tipo` mapea a un caso del contrato OpenAPI de US-030
 * (via `normalizarErrorCobroFianza`):
 *  - `ya-cobrada` (409 `FIANZA_YA_COBRADA`): doble cobro; la fianza ya está `cobrada`.
 *  - `cobro-invalido` (400 `COBRO_INVALIDO`): `importe <= 0` o `fechaCobro` posterior al evento.
 *  - `factura-no-encontrada` (404 `FACTURA_FIANZA_NO_ENCONTRADA`).
 *  - `justificante-no-encontrado` (404 `JUSTIFICANTE_NO_ENCONTRADO`).
 *  - `generico` (401/403/otros/red).
 */
export type CobroFianzaError = {
  tipo:
    | 'ya-cobrada'
    | 'cobro-invalido'
    | 'factura-no-encontrada'
    | 'justificante-no-encontrado'
    | 'generico';
  mensaje: string;
};

/**
 * Envelope de error del contrato para las acciones de US-028 (`ErrorResponse` + `codigo`
 * + `motivo`). Forma CRUDA tal cual la devuelve el SDK; `normalizarErrorLiquidacion` la
 * traduce a la unión `LiquidacionError` en español (más abajo).
 */
export type LiquidacionErrorResponse = components['schemas']['LiquidacionError'];

/**
 * Error NORMALIZADO de las mutaciones de US-028 (aprobar/enviar liquidación, enviar recibo
 * de fianza, reenviar liquidación), para que la UI ramifique en español sin volver a mirar
 * códigos HTTP. Mismo patrón que `FacturaError` (US-022). Cada `tipo` mapea a un caso del
 * contrato OpenAPI de US-028 (via `normalizarErrorLiquidacion`):
 *  - `factura-no-borrador` (409 `FACTURA_NO_BORRADOR`): ya `enviada`/`cobrada`.
 *  - `no-enviada` (409 `FACTURA_NO_ENVIADA`, solo reenviar): aún no emitida.
 *  - `datos-fiscales-incompletos` (422 `DATOS_FISCALES_INCOMPLETOS`): `camposFaltantes`.
 *  - `pdf-pendiente` (422 `PDF_PENDIENTE`): fallo transitorio del PDF; reintenta.
 *  - `descuento-invalido` (422 `DESCUENTO_INVALIDO`): descuento fuera de rango.
 *  - `emision-envio-fallido` (502/503 `EMISION_ENVIO_FALLIDO`): rollback total, reintentable.
 *  - `generico` (401/403/404/red).
 */
export type LiquidacionError = {
  tipo:
    | 'factura-no-borrador'
    | 'no-enviada'
    | 'datos-fiscales-incompletos'
    | 'pdf-pendiente'
    | 'descuento-invalido'
    | 'emision-envio-fallido'
    | 'generico';
  mensaje: string;
  /** Solo presente en `datos-fiscales-incompletos` (422 con `camposFaltantes`). */
  camposFaltantes?: CampoFiscalFaltante[];
  /** Solo presente en `emision-envio-fallido` (fallo recuperable, reintentable). */
  reintentable?: boolean;
};

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

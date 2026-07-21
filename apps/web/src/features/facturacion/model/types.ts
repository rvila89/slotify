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
 * Tipos del **envío de la factura de señal 40% por email** (rebanada 6.4b), sobre el SDK
 * generado:
 *  - `EnviarFacturaSenalResponse`: `{ factura, condPartEnviadasFecha }`; la factura de señal
 *    emitida y el timestamp de envío de las condicions particulars ya fijado en la RESERVA.
 *    Desde el change `condiciones-idioma-e2-firma-banner` las condiciones se adjuntan en E2
 *    (confirmar presupuesto), no en este envío.
 */
export type EnviarFacturaSenalResponse =
  components['schemas']['EnviarFacturaSenalResponse'];

/** Envelope de error CRUDO del envío de la factura de señal (`ErrorResponse` + `codigo` + `motivo`). */
export type FacturaSenalEnvioErrorResponse =
  components['schemas']['FacturaSenalEnvioError'];

/**
 * Respuesta del **reenvío de E3** (US-023 · GAP 3 · design.md §D-reenvio-e3), sobre el SDK generado
 * (`operation reenviarE3`, `POST /reservas/{id}/facturas/senal/reenviar`):
 *  - `factura`: la factura de señal YA emitida (sin cambios de estado, número ni desglose).
 *  - `comunicacion`: la NUEVA COMUNICACION E3 creada por el reenvío (`esReenvio=true`).
 *  - `condPartEnviadasFecha`: el nuevo timestamp fijado en `RESERVA.cond_part_enviadas_fecha`.
 */
export type ReenviarE3Response = components['schemas']['ReenviarE3Response'];

/**
 * Error NORMALIZADO del **reenvío de E3** (US-023 · GAP 3), para que la UI ramifique en español sin
 * volver a mirar códigos HTTP. El contrato comparte el envelope `FacturaSenalEnvioError` con el envío
 * inicial; el reenvío observa este subconjunto de `codigo` (via `normalizarErrorReenvioE3`):
 *  - `no-enviado-previamente` (409 `E3_NO_ENVIADO_PREVIAMENTE`): no hay un E3 enviado previamente que
 *    reenviar.
 *  - `condiciones-no-configuradas` (409 `CONDICIONES_NO_CONFIGURADAS`): el tenant no tiene condiciones
 *    particulares configuradas (endurecido en GAP 2); hay que configurarlas para poder enviar E3.
 *  - `no-encontrada` (404 `FACTURA_SENAL_NO_ENCONTRADA`): no existe factura de señal en la reserva.
 *  - `envio-fallido` (502/503 `EMISION_ENVIO_FALLIDO`): fallo RECUPERABLE, reintentable (rollback total).
 *  - `generico` (401/403/otros/red).
 */
export type ReenvioE3Error = {
  tipo:
    | 'no-enviado-previamente'
    | 'condiciones-no-configuradas'
    | 'no-encontrada'
    | 'envio-fallido'
    | 'generico';
  mensaje: string;
};

/**
 * Error NORMALIZADO del envío de la factura de señal por E3 (6.4b), para que la UI ramifique
 * en español sin volver a mirar códigos HTTP. Cada `tipo` mapea 1:1 con un `codigo` del
 * contrato OpenAPI (via `normalizarErrorEnvioSenal`):
 *  - `no-encontrada` (404 `FACTURA_SENAL_NO_ENCONTRADA`): no hay factura de señal.
 *  - `ya-enviado` (409 `E3_YA_ENVIADO`): idempotencia; el email E3 ya se envió (sin re-envío).
 *  - `no-enviable` (409 `FACTURA_SENAL_NO_ENVIABLE`): la factura no está en estado enviable.
 *  - `envio-fallido` (502 `EMISION_ENVIO_FALLIDO`): fallo RECUPERABLE, reintentable.
 *  - `generico` (401/403/otros/red).
 */
export type EnvioSenalError = {
  tipo: 'no-encontrada' | 'ya-enviado' | 'no-enviable' | 'envio-fallido' | 'generico';
  mensaje: string;
};

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
 * Tipos de la **devolución de fianza** (US-036 · UC-27, acción simétrica inversa del cobro de
 * US-030), sobre el SDK generado:
 *  - `RegistrarDevolucionFianzaRequest`: body JSON
 *    `{ importeDevuelto, fechaCobro, motivoRetencion?, justificanteDocId? }` (G1-3: NO multipart;
 *    el justificante se sube antes por `POST /documentos` y aquí solo se referencia por id).
 *  - `RegistrarDevolucionFianzaResponse`: `{ reserva, documentoJustificante?, avisoSinJustificante }`
 *    con la RESERVA actualizada (`fianzaStatus` derivado `devuelta`|`retenida_parcial`,
 *    `fianzaDevueltaEur`, `fianzaDevueltaFecha`, `motivoRetencion` si parcial).
 *  - `Documento`: metadatos del DOCUMENTO `justificante_pago` subido (respuesta de `POST /documentos`).
 */
export type RegistrarDevolucionFianzaRequest =
  components['schemas']['RegistrarDevolucionFianzaRequest'];
export type RegistrarDevolucionFianzaResponse =
  components['schemas']['RegistrarDevolucionFianzaResponse'];
export type Documento = components['schemas']['Documento'];

/** Envelope de error CRUDO de la devolución de fianza (`ErrorResponse` + `codigo` + `motivo`). */
export type DevolucionFianzaErrorResponse = components['schemas']['DevolucionFianzaError'];

/**
 * Error NORMALIZADO de la devolución de fianza (US-036), para que la UI ramifique en español sin
 * volver a mirar códigos HTTP. Cada `tipo` mapea 1:1 con un `codigo` del contrato OpenAPI de US-036
 * (via `normalizarErrorDevolucionFianza`):
 *  - `importe-supera-fianza` (400 `IMPORTE_SUPERA_FIANZA`, FA-02): importe > fianzaEur o negativo.
 *  - `fecha-invalida` (400 `FECHA_DEVOLUCION_INVALIDA`, FA-03): fecha < fianzaCobradaFecha.
 *  - `motivo-requerido` (400 `MOTIVO_RETENCION_REQUERIDO`): devolución parcial sin motivo.
 *  - `justificante-no-encontrado` (404 `JUSTIFICANTE_NO_ENCONTRADO`).
 *  - `precondicion-no-cumplida` (409 `PRECONDICION_NO_CUMPLIDA`): estado≠post_evento /
 *    fianzaStatus≠cobrada / sin IBAN de devolución.
 *  - `ya-registrada` (409 `DEVOLUCION_YA_REGISTRADA`): doble registro sobre estado final irreversible.
 *  - `generico` (401/403/otros/red).
 */
export type DevolucionFianzaError = {
  tipo:
    | 'importe-supera-fianza'
    | 'fecha-invalida'
    | 'motivo-requerido'
    | 'justificante-no-encontrado'
    | 'precondicion-no-cumplida'
    | 'ya-registrada'
    | 'generico';
  mensaje: string;
};

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

/**
 * Alias de tipos del dominio de facturación (US-022 · UC-18) sobre el cliente
 * generado del contrato OpenAPI (`@/api-client`). Centralizar aquí evita repetir
 * `components['schemas'][...]` por el dominio y da un único punto de import para
 * componentes y hooks. No se inventan tipos de API: todos derivan del SDK
 * generado (única fuente de verdad).
 */
import type { components } from '@/api-client';

/**
 * Factura de señal (US-022 · UC-18). Es `FacturaDto` extendida con el flag DERIVADO
 * `e3Enviado: boolean` (true cuando ya existe una COMUNICACION E3 enviada, no reenvío):
 * la UI lo usa para mostrar sólo "Enviar factura 40%" antes del primer envío y sólo
 * "Reenviar E3" después, nunca ambas a la vez.
 */
export type FacturaSenal = components['schemas']['FacturaSenalDto'];

/**
 * Factura de liquidación (US-028 · UC-21, standalone tras
 * fix-liquidacion-fianza-independientes). Es `FacturaDto` extendida con el flag DERIVADO
 * `e4Enviado: boolean` (true cuando ya existe una COMUNICACION E4 enviada, no reenvío): la
 * UI lo usa para el banner permanente "Liquidación enviada el {fecha/hora}" y para mostrar
 * solo "Reenviar" tras el primer envío. Flujo espejo de la factura de señal.
 */
export type FacturaLiquidacion = components['schemas']['FacturaLiquidacionDto'];

/**
 * Item de la colección `GET /reservas/{id}/facturas` (US-027). Misma forma que la
 * factura de señal; el tipo distingue `senal` | `liquidacion` | `complementaria`.
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
 * Sub-procesos de la RESERVA relevantes para las acciones de facturación y fianza. Derivan
 * de los enums del contrato OpenAPI; la UI habilita/deshabilita acciones según su valor.
 * `FianzaStatus` = `pendiente | cobrada | devuelta` (tras
 * fix-liquidacion-fianza-independientes): `cobrada` = comprobante recibido.
 */
export type LiquidacionStatus = components['schemas']['LiquidacionStatus'];
export type FianzaStatus = components['schemas']['FianzaStatus'];

/**
 * Respuestas de las acciones **standalone** de liquidación (espejo de la señal), sobre el
 * SDK generado:
 *  - `EnviarFacturaLiquidacionResponse`: liquidación emitida + `liquidacionStatus`.
 *  - `ReenviarLiquidacionResponse`: liquidación sin cambios + la nueva COMUNICACION de reenvío.
 */
export type EnviarFacturaLiquidacionResponse =
  components['schemas']['EnviarFacturaLiquidacionResponse'];
export type ReenviarLiquidacionResponse =
  components['schemas']['ReenviarLiquidacionResponse'];

/**
 * Tipos de la **fianza pasiva** (comprobante + devolución), sobre el SDK generado:
 *  - `SubirComprobanteFianzaResponse`: RESERVA con `fianzaStatus='cobrada'` +
 *    `fianzaComprobanteFecha` + el DOCUMENTO `comprobante_fianza` creado.
 *  - `DevolverFianzaResponse`: RESERVA con `fianzaStatus='devuelta'` + `fianzaDevueltaFecha`
 *    + `avisoEmail` (best-effort E10; presente si el email falló).
 *  - `DevolverFianzaAvisoEmail`: aviso del fallo de E10 (post-commit, reintentable).
 */
export type SubirComprobanteFianzaResponse =
  components['schemas']['SubirComprobanteFianzaResponse'];
export type DevolverFianzaResponse = components['schemas']['DevolverFianzaResponse'];
export type DevolverFianzaAvisoEmail = components['schemas']['DevolverFianzaAvisoEmail'];
export type Documento = components['schemas']['Documento'];

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
 * Error NORMALIZADO de la **subida del comprobante de fianza** (fix-liquidacion-fianza-
 * independientes), espejo de `CondicionesFirmadasError`, para que la UI ramifique en español
 * sin volver a mirar códigos HTTP. Cada `tipo` mapea 1:1 con un `codigo` del contrato
 * (`SubirComprobanteFianzaValidacionError`, 422):
 *  - `estado-invalido` → 422 `ESTADO_INVALIDO` (fuera de reserva_confirmada/evento_en_curso/post_evento).
 *  - `comprobante-requerido` / `formato-no-permitido` / `tamano-excedido` → 422 (validación de fichero).
 *  - `generico` → 400/401/403/404/red.
 */
export type ComprobanteFianzaError = {
  tipo:
    | 'estado-invalido'
    | 'comprobante-requerido'
    | 'formato-no-permitido'
    | 'tamano-excedido'
    | 'generico';
  mensaje: string;
};

/**
 * Error NORMALIZADO de la **devolución de fianza** (fix-liquidacion-fianza-independientes:
 * devolución completa, sin IBAN ni retención). Cada `tipo` mapea 1:1 con un `codigo` del
 * contrato (`DevolucionFianzaError`, 409):
 *  - `precondicion-no-cumplida` (409 `PRECONDICION_NO_CUMPLIDA`): estado≠post_evento o
 *    fianzaStatus≠cobrada.
 *  - `ya-registrada` (409 `DEVOLUCION_YA_REGISTRADA`): doble registro sobre estado final irreversible.
 *  - `generico` (401/403/404/red).
 */
export type DevolucionFianzaError = {
  tipo: 'precondicion-no-cumplida' | 'ya-registrada' | 'generico';
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

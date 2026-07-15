/**
 * Alias de tipos del dominio de presupuestos sobre el cliente generado del
 * contrato OpenAPI (`@/api-client`). Centralizar aquí evita repetir
 * `components['schemas'][...]` por todo el dominio y da un único punto de import
 * para páginas, hooks y componentes. No se inventan tipos de API: todos derivan
 * del SDK generado (única fuente de verdad, US-014).
 */
import type { components } from '@/api-client';

export type PreviewPresupuestoRequest = components['schemas']['PreviewPresupuestoRequest'];
export type PresupuestoPreviewResponse = components['schemas']['PresupuestoPreviewResponse'];
export type ConfirmarPresupuestoRequest = components['schemas']['ConfirmarPresupuestoRequest'];
export type ConfirmarPresupuestoResponse = components['schemas']['ConfirmarPresupuestoResponse'];
export type DesgloseFiscal = components['schemas']['DesgloseFiscal'];
export type RepartoPago = components['schemas']['RepartoPago'];
export type PresupuestoExtraInput = components['schemas']['PresupuestoExtraInput'];
export type Presupuesto = components['schemas']['Presupuesto'];
export type Extra = components['schemas']['Extra'];
export type ReservaExtra = components['schemas']['ReservaExtra'];

// US-015 — Edición versionada + reenvío del presupuesto en pre_reserva (UC-15).
export type EdicionPresupuestoPreviewRequest =
  components['schemas']['EdicionPresupuestoPreviewRequest'];
export type EdicionPresupuestoPreviewResponse =
  components['schemas']['EdicionPresupuestoPreviewResponse'];
export type EdicionPresupuestoRequest = components['schemas']['EdicionPresupuestoRequest'];
export type EdicionPresupuestoResponse = components['schemas']['EdicionPresupuestoResponse'];
export type EdicionExtraInput = components['schemas']['EdicionExtraInput'];
export type ReenviarPresupuestoResponse = components['schemas']['ReenviarPresupuestoResponse'];
/** Duración del evento en horas admitida por la edición (recalcula la tarifa). */
export type DuracionHorasEdicion = NonNullable<EdicionPresupuestoPreviewRequest['duracionHoras']>;

/** [6.2] Método de pago elegido por el Gestor al generar el presupuesto. */
export type MetodoPago = components['schemas']['MetodoPago'];
/** [6.2] Régimen fiscal derivado del método de pago (respuesta del preview/confirmar). */
export type RegimenIva = components['schemas']['RegimenIva'];

export type ActualizarDatosFiscalesClienteRequest =
  components['schemas']['ActualizarDatosFiscalesClienteRequest'];
export type ActualizarDatosFiscalesClienteResponse =
  components['schemas']['ActualizarDatosFiscalesClienteResponse'];

export type PresupuestoDatosFiscalesError =
  components['schemas']['PresupuestoDatosFiscalesError'];
export type PresupuestoPrecioManualRequeridoError =
  components['schemas']['PresupuestoPrecioManualRequeridoError'];
export type PresupuestoGuardaOrigenError =
  components['schemas']['PresupuestoGuardaOrigenError'];
export type PresupuestoEdicionValidacionError =
  components['schemas']['PresupuestoEdicionValidacionError'];
export type ErrorResponse = components['schemas']['ErrorResponse'];

/** Campos fiscales/de reserva que el backend puede reportar como faltantes (FA-01). */
export type CampoFiscalFaltante =
  PresupuestoDatosFiscalesError['camposFaltantes'][number];

/**
 * Error normalizado de las mutaciones de presupuesto (preview y confirmar), para
 * que la UI ramifique en español sin volver a mirar códigos HTTP. Cada `tipo`
 * mapea 1:1 con un caso del contrato OpenAPI de US-014.
 */
export type PresupuestoError =
  | {
      /** 422 DATOS_FISCALES_INCOMPLETOS (FA-01): enumera los campos faltantes. */
      tipo: 'datos-fiscales';
      camposFaltantes: CampoFiscalFaltante[];
      mensaje: string;
    }
  | {
      /** 422 TARIFA_NO_CONFIGURADA / TEMPORADA_NO_CONFIGURADA: tarifario incompleto. */
      tipo: 'tarifa-no-configurada';
      mensaje: string;
    }
  | {
      /** 422 PRECIO_MANUAL_REQUERIDO (FA-02): >50 invitados sin `precioManualEur`. */
      tipo: 'precio-manual-requerido';
      mensaje: string;
    }
  | {
      /** 409 FECHA_NO_DISPONIBLE (carrera D4 sobre UNIQUE(tenant, fecha)). */
      tipo: 'fecha-no-disponible';
      mensaje: string;
    }
  | {
      /** 409 PRESUPUESTO_YA_EXISTE: hay uno enviado/aceptado → remite a UC-15. */
      tipo: 'presupuesto-ya-existe';
      mensaje: string;
    }
  | {
      /** 409 ORIGEN_INVALIDO: la RESERVA está en 2d/terminal/pre_reserva+. */
      tipo: 'origen-invalido';
      mensaje: string;
    }
  | {
      /**
       * 409 (edición/reenvío, US-015): la RESERVA no está en `pre_reserva` o su
       * último PRESUPUESTO está `aceptado`/`rechazado` (no editable).
       */
      tipo: 'edicion-no-permitida';
      mensaje: string;
    }
  | {
      /** 422 DESCUENTO_INVALIDO (US-015): negativo o mayor que la base imponible. */
      tipo: 'descuento-invalido';
      mensaje: string;
    }
  | {
      /** 422 DURACION_INVALIDA (US-015): `duracionHoras` fuera de {4,8,12}. */
      tipo: 'duracion-invalida';
      mensaje: string;
    }
  | {
      /** 401/403/404/red u otros: error genérico. */
      tipo: 'generico';
      mensaje: string;
    };

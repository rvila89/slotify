/**
 * Entidad de dominio FACTURA de señal y su máquina de estados — DOMINIO PURO (US-022 /
 * UC-18, design.md §D-9). skill `state-machine`: transiciones como estructura de datos
 * declarativa, no como `if/else` dispersos.
 *
 * Ciclo de vida: `borrador` → `enviada` → `cobrada`. En este change solo se materializa
 * `borrador → enviada` (aprobar); `cobrada` es futuro (conciliación de PAGO). El rechazo
 * NO es una transición: la factura permanece en `borrador` y el motivo va a AUDIT_LOG.
 *
 * Flags DERIVADOS (no son columnas de FACTURA):
 *   - `esBorradorInvalido`: faltan datos fiscales del CLIENTE (bloqueo por DATOS; no se
 *     reintenta solo). La aplicación lo determina con la lista de campos faltantes.
 *   - `pdfPendiente`: `pdf_url = null` sin ser inválido por datos (fallo TRANSITORIO del
 *     PDF; el sistema reintenta). Se deriva de `pdfUrl === null && !esBorradorInvalido`.
 *
 * Sin dependencias de framework/infra (hook `no-infra-in-domain`).
 */

/** Estados del ciclo de vida de la factura. */
export type EstadoFactura = 'borrador' | 'enviada' | 'cobrada';

/** Tipos de factura del MVP (solo `senal` en este change). */
export type TipoFactura = 'senal' | 'liquidacion' | 'fianza' | 'complementaria';

/**
 * Tabla declarativa de transiciones de estado permitidas. Clave = estado origen; valor =
 * estados destino alcanzables. Una transición no contemplada aquí es inválida (→ 409/422
 * según la guarda). No se dispersan `if/else` de estado por el código.
 */
export const TRANSICIONES: Readonly<Record<EstadoFactura, ReadonlyArray<EstadoFactura>>> = {
  borrador: ['enviada'],
  enviada: ['cobrada'],
  cobrada: [],
};

/** ¿Es válida la transición `origen → destino` según la tabla declarativa? */
export const puedeTransicionar = (
  origen: EstadoFactura,
  destino: EstadoFactura,
): boolean => TRANSICIONES[origen].includes(destino);

/** ¿Está la factura en `borrador` (único estado aprobable/rechazable/regenerable)? */
export const esBorrador = (estado: EstadoFactura): boolean => estado === 'borrador';

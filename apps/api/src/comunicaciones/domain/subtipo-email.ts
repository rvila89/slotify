/**
 * Helper PURO de dominio del mapeo `tipoE1` / `tipoTransicion` → `SubtipoEmail`
 * (change `historial-completo-comunicaciones`, design.md §D-subtipo).
 *
 * Centraliza el mapeo del subtipo semántico del E1 para que los 3 puntos de generación
 * (alta, transición «añadir fecha», cambio de fecha) NO lo dupliquen. Sin Prisma ni
 * `@nestjs/*` (guardrail hexagonal): es lógica de dominio sobre las etiquetas del evento.
 *
 * Taxonomía (design.md §D-subtipo):
 *  - `consulta_exploratoria` → "Respuesta a consulta (sin fecha)"
 *  - `fecha_disponible`      → "Fecha disponible / asignada"
 *  - `fecha_confirmada`      → "Fecha confirmada"
 *  - `cola_espera`           → "En cola de espera"
 *  - `cambio_fecha`          → "Cambio de fecha"
 */

/** Enum de dominio del subtipo (espejo del enum Prisma `SubtipoEmail`). */
export type SubtipoEmail =
  | 'consulta_exploratoria'
  | 'fecha_disponible'
  | 'fecha_confirmada'
  | 'cola_espera'
  | 'cambio_fecha';

/** `tipoE1` del alta (`renderizarE1` de `alta-consulta.use-case`). */
export type TipoE1 = 'sin_fecha' | 'fecha_disponible' | 'fecha_confirmada' | 'fecha_cola';

/**
 * Discriminador del evento de los adaptadores UoW: la MISMA rama de plantilla
 * (`disponible`) es un `fecha_disponible` cuando se AÑADE una fecha (transición) pero un
 * `cambio_fecha` cuando se CAMBIA (cambio de fecha), de ahí el `evento`.
 */
export interface TransicionSubtipo {
  evento: 'transicion' | 'cambio';
  tipo: 'disponible' | 'cola';
}

/** Mapeo del `tipoE1` del alta (design.md §D-subtipo). */
export const subtipoDesdeTipoE1 = (tipoE1: TipoE1): SubtipoEmail => {
  switch (tipoE1) {
    case 'sin_fecha':
      return 'consulta_exploratoria';
    case 'fecha_disponible':
      return 'fecha_disponible';
    case 'fecha_confirmada':
      return 'fecha_confirmada';
    case 'fecha_cola':
      return 'cola_espera';
  }
};

/**
 * Mapeo del `tipo` de los adaptadores UoW al subtipo, discriminando por `evento`:
 *  - transición «añadir fecha»: `disponible` → `fecha_disponible`; `cola` → `cola_espera`.
 *  - cambio de fecha: `disponible` → `cambio_fecha` (semánticamente un cambio, no un alta).
 */
export const subtipoDesdeTransicion = (params: TransicionSubtipo): SubtipoEmail => {
  if (params.tipo === 'cola') {
    return 'cola_espera';
  }
  return params.evento === 'cambio' ? 'cambio_fecha' : 'fecha_disponible';
};

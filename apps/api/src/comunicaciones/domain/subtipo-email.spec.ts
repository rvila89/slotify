/**
 * TEST UNITARIO PURO del mapeo `tipoE1`/`tipoTransicion` → `subtipo` (change
 * `historial-completo-comunicaciones`) — fase TDD RED.
 *
 * Trazabilidad: design.md §D-subtipo (tabla "Poblado en cada punto de generación de
 * E1"): el `tipoE1` del alta (`sin_fecha | fecha_disponible | fecha_confirmada |
 * fecha_cola`) y el `tipo` de los adaptadores UoW (`disponible` | `cola` en la
 * transición; `disponible` = `cambio_fecha` en el cambio) se traducen al enum
 * `SubtipoEmail` persistido en COMUNICACION.
 *
 * Helper PURO de dominio (sin Prisma ni framework): centraliza el mapeo para que los 3
 * puntos de generación (alta, transición, cambio) no lo dupliquen. `null` para E2–E8.
 *
 * RED: el módulo `./subtipo-email` (y sus helpers) AÚN NO EXISTE; el import falla en
 * compilación y la batería está en ROJO. GREEN es de `backend-developer` (crear el enum
 * + los helpers). Es un test PEQUEÑO: fija el contrato del mapeo sin forzar decisiones
 * de API más allá de las firmas que el design ya nombra.
 */
import {
  subtipoDesdeTipoE1,
  subtipoDesdeTransicion,
} from './subtipo-email';

describe('subtipoDesdeTipoE1 — mapeo del `tipoE1` del alta al enum SubtipoEmail', () => {
  it('debe_mapear_sin_fecha_a_consulta_exploratoria', () => {
    expect(subtipoDesdeTipoE1('sin_fecha')).toBe('consulta_exploratoria');
  });

  it('debe_mapear_fecha_disponible_a_fecha_disponible', () => {
    expect(subtipoDesdeTipoE1('fecha_disponible')).toBe('fecha_disponible');
  });

  it('debe_mapear_fecha_confirmada_a_fecha_confirmada', () => {
    expect(subtipoDesdeTipoE1('fecha_confirmada')).toBe('fecha_confirmada');
  });

  it('debe_mapear_fecha_cola_a_cola_espera', () => {
    expect(subtipoDesdeTipoE1('fecha_cola')).toBe('cola_espera');
  });
});

describe('subtipoDesdeTransicion — mapeo del `tipo` de los adaptadores UoW', () => {
  // Transición «añadir fecha»: rama libre `disponible` → fecha_disponible; `cola` → cola_espera.
  it('debe_mapear_disponible_de_la_transicion_a_fecha_disponible', () => {
    expect(subtipoDesdeTransicion({ evento: 'transicion', tipo: 'disponible' })).toBe(
      'fecha_disponible',
    );
  });

  it('debe_mapear_cola_de_la_transicion_a_cola_espera', () => {
    expect(subtipoDesdeTransicion({ evento: 'transicion', tipo: 'cola' })).toBe(
      'cola_espera',
    );
  });

  // Cambio de fecha: la rama `disponible` es semánticamente un `cambio_fecha`.
  it('debe_mapear_disponible_del_cambio_de_fecha_a_cambio_fecha', () => {
    expect(subtipoDesdeTransicion({ evento: 'cambio', tipo: 'disponible' })).toBe(
      'cambio_fecha',
    );
  });
});

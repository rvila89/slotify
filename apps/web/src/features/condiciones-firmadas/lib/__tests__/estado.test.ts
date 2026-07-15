import { describe, expect, it } from 'vitest';
import {
  condicionesEnviadas,
  condicionesFirmadas,
  debeMostrarSeccionCondiciones,
} from '../estado';

/** US-024 — guardas de cliente (espejo de las guardas declarativas del backend). */
describe('debeMostrarSeccionCondiciones', () => {
  it.each(['reserva_confirmada', 'evento_en_curso', 'post_evento'])(
    'muestra la sección en %s',
    (estado) => {
      expect(debeMostrarSeccionCondiciones({ estado })).toBe(true);
    },
  );

  it.each(['consulta', 'pre_reserva', 'reserva_completada', 'reserva_cancelada'])(
    'oculta la sección en %s',
    (estado) => {
      expect(debeMostrarSeccionCondiciones({ estado })).toBe(false);
    },
  );
});

describe('condicionesEnviadas', () => {
  it('true cuando condPartFechaEnvio tiene valor', () => {
    expect(condicionesEnviadas({ condPartFechaEnvio: '2026-07-01T10:00:00Z' })).toBe(true);
  });

  it('false cuando es null o undefined', () => {
    expect(condicionesEnviadas({ condPartFechaEnvio: null })).toBe(false);
    expect(condicionesEnviadas({})).toBe(false);
  });
});

describe('condicionesFirmadas', () => {
  it('true solo cuando el flag es exactamente true', () => {
    expect(condicionesFirmadas({ condPartFirmadas: true })).toBe(true);
    expect(condicionesFirmadas({ condPartFirmadas: false })).toBe(false);
    expect(condicionesFirmadas({ condPartFirmadas: null })).toBe(false);
    expect(condicionesFirmadas({})).toBe(false);
  });
});

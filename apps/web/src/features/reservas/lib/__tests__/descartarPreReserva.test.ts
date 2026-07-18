import { describe, expect, it } from 'vitest';
import { puedeDescartarPreReserva } from '../descartarPreReserva';

/**
 * Workstream B (`presupuesto-prereserva-cta-descarte-y-e2`) — guarda de origen de
 * cliente de la acción "Descartar pre-reserva". Espejo de la guarda declarativa del
 * backend (`ORIGENES_TRANSICION_DESCARTAR_PRERESERVA`): la acción SOLO se ofrece en
 * `pre_reserva`.
 */
describe('puedeDescartarPreReserva (guarda de origen de la acción)', () => {
  it('debe_habilitar_la_accion_solo_en_pre_reserva', () => {
    expect(puedeDescartarPreReserva({ estado: 'pre_reserva' })).toBe(true);
  });

  it('debe_deshabilitar_la_accion_en_cualquier_otro_estado', () => {
    for (const estado of [
      'consulta',
      'reserva_confirmada',
      'evento_en_curso',
      'post_evento',
      'reserva_completada',
      'reserva_cancelada',
    ] as const) {
      expect(puedeDescartarPreReserva({ estado })).toBe(false);
    }
    expect(puedeDescartarPreReserva({ estado: undefined })).toBe(false);
  });
});

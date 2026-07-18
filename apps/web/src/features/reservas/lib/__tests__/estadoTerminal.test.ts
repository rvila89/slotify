import { describe, expect, it } from 'vitest';
import { esConsultaTerminal } from '../estadoTerminal';

/**
 * US-051 §Punto 4: predicado de "consulta cerrada". Sub-estados `2x/2y/2z` y
 * estados `reserva_cancelada`/`reserva_completada` son terminales.
 */
describe('esConsultaTerminal', () => {
  it.each(['2x', '2y', '2z'] as const)('true_para_sub_estado_terminal_%s', (sub) => {
    expect(esConsultaTerminal({ estado: 'consulta', subEstado: sub })).toBe(true);
  });

  it.each(['reserva_cancelada', 'reserva_completada'] as const)(
    'true_para_estado_terminal_%s',
    (estado) => {
      expect(esConsultaTerminal({ estado })).toBe(true);
    },
  );

  it.each(['2a', '2b', '2c', '2d', '2v'] as const)('false_para_sub_estado_activo_%s', (sub) => {
    expect(esConsultaTerminal({ estado: 'consulta', subEstado: sub })).toBe(false);
  });

  it('false_para_pre_reserva', () => {
    expect(esConsultaTerminal({ estado: 'pre_reserva' })).toBe(false);
  });

  it('false_cuando_no_hay_datos', () => {
    expect(esConsultaTerminal({})).toBe(false);
  });
});

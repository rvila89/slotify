import { describe, expect, it } from 'vitest';
import {
  camposCompletitudFaltantes,
  motivoNoPuedeGenerar,
  puedeGenerarPresupuesto,
} from '../estado';

/**
 * Gate de completitud de "Generar presupuesto" (US-051 §Punto 3). Además de la
 * guarda de estado/sub-estado, la acción solo se ofrece cuando la RESERVA tiene
 * `fechaEvento`, `numAdultosNinosMayores4` (≥ 1), `duracionHoras` y `horario`.
 * Cuando falta alguno, el botón queda deshabilitado y la ficha enumera qué falta.
 */
const completa = {
  estado: 'consulta',
  subEstado: '2b',
  fechaEvento: '2999-06-01',
  numAdultosNinosMayores4: 30,
  duracionHoras: 8 as const,
  horario: '11:00',
};

describe('camposCompletitudFaltantes', () => {
  it('devuelve_vacio_cuando_todos_los_datos_estan_presentes', () => {
    expect(camposCompletitudFaltantes(completa)).toEqual([]);
  });

  it('detecta_fechaEvento_ausente', () => {
    expect(camposCompletitudFaltantes({ ...completa, fechaEvento: null })).toEqual(['fechaEvento']);
  });

  it('detecta_numAdultosNinosMayores4_ausente', () => {
    expect(
      camposCompletitudFaltantes({ ...completa, numAdultosNinosMayores4: null }),
    ).toEqual(['numAdultosNinosMayores4']);
  });

  it('trata_numAdultosNinosMayores4_cero_como_faltante', () => {
    expect(camposCompletitudFaltantes({ ...completa, numAdultosNinosMayores4: 0 })).toEqual([
      'numAdultosNinosMayores4',
    ]);
  });

  it('detecta_duracionHoras_ausente', () => {
    expect(camposCompletitudFaltantes({ ...completa, duracionHoras: null })).toEqual([
      'duracionHoras',
    ]);
  });

  it('detecta_horario_ausente', () => {
    expect(camposCompletitudFaltantes({ ...completa, horario: null })).toEqual(['horario']);
  });

  it('enumera_todos_los_faltantes_en_orden_estable', () => {
    expect(
      camposCompletitudFaltantes({
        estado: 'consulta',
        subEstado: '2b',
        fechaEvento: null,
        numAdultosNinosMayores4: null,
        duracionHoras: null,
        horario: null,
      }),
    ).toEqual(['fechaEvento', 'numAdultosNinosMayores4', 'duracionHoras', 'horario']);
  });
});

describe('puedeGenerarPresupuesto — gate de completitud', () => {
  it('true_con_estado_valido_y_todos_los_datos', () => {
    expect(puedeGenerarPresupuesto(completa)).toBe(true);
  });

  it('false_si_falta_la_duracion_aunque_el_estado_sea_valido', () => {
    expect(puedeGenerarPresupuesto({ ...completa, duracionHoras: null })).toBe(false);
  });

  it('false_si_falta_el_horario_aunque_el_estado_sea_valido', () => {
    expect(puedeGenerarPresupuesto({ ...completa, horario: null })).toBe(false);
  });

  it('false_si_el_estado_no_es_origen_valido_aunque_haya_datos', () => {
    expect(puedeGenerarPresupuesto({ ...completa, subEstado: '2d' })).toBe(false);
  });

  it('sigue_siendo_false_en_terminales', () => {
    expect(puedeGenerarPresupuesto({ ...completa, subEstado: '2x' })).toBe(false);
  });
});

describe('motivoNoPuedeGenerar — enumera datos faltantes y sugiere editar', () => {
  it('enumera_los_campos_faltantes_y_sugiere_editar_consulta', () => {
    const motivo = motivoNoPuedeGenerar({
      ...completa,
      duracionHoras: null,
      horario: null,
    });
    expect(motivo).toContain('Duración');
    expect(motivo).toContain('Hora de inicio');
    expect(motivo).toContain('Editar consulta');
  });

  it('cuando_falta_solo_el_horario_lo_nombra', () => {
    const motivo = motivoNoPuedeGenerar({ ...completa, horario: null });
    expect(motivo).toContain('Hora de inicio');
    expect(motivo).toContain('Editar consulta');
  });

  it('prioriza_el_motivo_de_estado_sobre_la_completitud_en_2d', () => {
    const motivo = motivoNoPuedeGenerar({ ...completa, subEstado: '2d', duracionHoras: null });
    expect(motivo).toContain('cola');
  });

  it('prioriza_el_motivo_de_estado_en_terminales', () => {
    const motivo = motivoNoPuedeGenerar({ ...completa, subEstado: '2x', duracionHoras: null });
    expect(motivo).toContain('terminal');
  });
});

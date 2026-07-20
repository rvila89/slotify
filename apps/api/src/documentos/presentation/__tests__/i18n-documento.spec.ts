/**
 * TESTS UNITARIOS de los HELPERS PUROS de i18n/formato del documento de presupuesto
 * para el change `pdf-presupuesto-horario-idioma` — fase TDD RED (tasks.md 3.1, 3.2, 3.5).
 *
 * Trazabilidad: design.md D1 (horaFin `mod 1440`, "HH:MM" con cero-padding),
 * D2 (mapa estático `MESES` por idioma, NUNCA `Intl`; etiquetas puras por idioma).
 *
 * CONTRATO NUEVO QUE ESTOS TESTS ESPERAN (a implementar por backend-developer en GREEN),
 * como helpers PUROS de `documentos/presentation` (arrow functions, sin `Intl` de locale):
 *
 *   // meses.ts
 *   export const MESES: { ca: readonly string[]; es: readonly string[] };
 *   export const formatearFechaLarga = (fecha: Date, idioma: 'es' | 'ca') => string;
 *       → "D de <mes> de AAAA" (día sin cero-padding, en UTC, mes por idioma).
 *
 *   // horario.ts
 *   export const calcularHoraFin = (horaInicio: string, duracionHoras: number) => string;
 *       → "HH:MM" con `(inicioMin + duracionHoras*60) mod 1440`.
 *   export const formatearHorario = (
 *     horario: string | null, duracionHoras: number, idioma: 'es' | 'ca',
 *   ) => string; → "De HH:MM a HH:MM (N <hores|horas>)" o fallback "(N ...)".
 *
 *   // etiquetas-por-idioma.ts
 *   export const etiquetasDocumento = (idioma: 'es' | 'ca') => EtiquetasDocumento;
 *       → default 'es' para idioma no reconocible.
 *
 * RED: ninguno de estos módulos/funciones existe todavía → los imports fallan (TS2307)
 * y la batería está en ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN es de backend-developer.
 */
import { MESES, formatearFechaLarga } from '../meses';
import { calcularHoraFin, formatearHorario } from '../horario';
import { etiquetasDocumento } from '../etiquetas-por-idioma';

// ===========================================================================
// meses.ts — mapa estático por idioma + formateo de fecha larga en UTC.
// ===========================================================================

describe('MESES — mapa estático de nombres de mes por idioma (sin Intl)', () => {
  it('debe_tener_12_meses_en_catalan_y_castellano', () => {
    expect(MESES.ca).toHaveLength(12);
    expect(MESES.es).toHaveLength(12);
  });

  it('debe_nombrar_septiembre_como_setembre_en_ca_y_septiembre_en_es', () => {
    // Índice 8 = mes 9 (septiembre / setembre).
    expect(MESES.ca[8]).toBe('setembre');
    expect(MESES.es[8]).toBe('septiembre');
  });

  it('debe_nombrar_enero_como_gener_en_ca_y_enero_en_es', () => {
    expect(MESES.ca[0]).toBe('gener');
    expect(MESES.es[0]).toBe('enero');
  });
});

describe('formatearFechaLarga — "D de <mes> de AAAA" determinista en UTC', () => {
  it('debe_formatear_20_septiembre_2026_en_catalan', () => {
    expect(formatearFechaLarga(new Date('2026-09-20T00:00:00.000Z'), 'ca')).toBe(
      '20 de setembre de 2026',
    );
  });

  it('debe_formatear_20_septiembre_2026_en_castellano', () => {
    expect(formatearFechaLarga(new Date('2026-09-20T00:00:00.000Z'), 'es')).toBe(
      '20 de septiembre de 2026',
    );
  });

  it('debe_mostrar_el_dia_sin_cero_padding', () => {
    expect(formatearFechaLarga(new Date('2026-09-01T00:00:00.000Z'), 'ca')).toBe(
      '1 de setembre de 2026',
    );
  });

  it('debe_usar_UTC_y_no_desplazar_el_dia_en_medianoche', () => {
    // A medianoche UTC un formateo con getDate local caería al día 31 anterior en TZ-.
    expect(formatearFechaLarga(new Date('2026-06-01T00:00:00.000Z'), 'es')).toBe(
      '1 de junio de 2026',
    );
  });
});

// ===========================================================================
// horario.ts — cálculo de hora de fin (mod 1440) + formateo del rango.
// ===========================================================================

describe('calcularHoraFin — (inicioMin + duracionHoras*60) mod 1440', () => {
  it('debe_sumar_la_duracion_dentro_del_mismo_dia', () => {
    expect(calcularHoraFin('12:00', 8)).toBe('20:00');
  });

  it('debe_conservar_los_minutos_del_inicio', () => {
    expect(calcularHoraFin('09:30', 4)).toBe('13:30');
  });

  it('debe_cruzar_medianoche_con_mod_1440', () => {
    // (22*60 + 240) mod 1440 = 120 min → 02:00.
    expect(calcularHoraFin('22:00', 4)).toBe('02:00');
  });

  it('debe_aplicar_cero_padding_a_horas_y_minutos', () => {
    // (23*60 + 45 + 60) mod 1440 = 1425+60=... comprobamos padding: 08:05.
    expect(calcularHoraFin('04:05', 4)).toBe('08:05');
  });
});

describe('formatearHorario — rango o fallback según idioma', () => {
  it('debe_formatear_el_rango_completo_en_catalan', () => {
    expect(formatearHorario('12:00', 8, 'ca')).toBe('De 12:00 a 20:00 (8 hores)');
  });

  it('debe_formatear_el_rango_completo_en_castellano', () => {
    expect(formatearHorario('12:00', 8, 'es')).toBe('De 12:00 a 20:00 (8 horas)');
  });

  it('debe_cruzar_medianoche_en_el_rango', () => {
    expect(formatearHorario('22:00', 4, 'ca')).toBe('De 22:00 a 02:00 (4 hores)');
  });

  it('debe_caer_al_fallback_sin_rango_cuando_horario_es_null_ca', () => {
    expect(formatearHorario(null, 8, 'ca')).toBe('(8 hores)');
  });

  it('debe_caer_al_fallback_sin_rango_cuando_horario_es_null_es', () => {
    expect(formatearHorario(null, 12, 'es')).toBe('(12 horas)');
  });
});

// ===========================================================================
// etiquetas-por-idioma.ts — etiquetas fijas por idioma con default es.
// ===========================================================================

describe('etiquetasDocumento — etiquetas fijas por idioma', () => {
  it('debe_devolver_las_etiquetas_catalanas', () => {
    const e = etiquetasDocumento('ca');
    expect(e.titulo).toBe('PRESSUPOST');
    expect(e.concepto).toBe('CONCEPTE');
    expect(e.precio).toBe('PREU');
    expect(e.personas).toBe('persones');
    expect(e.validesa).toBe('Validesa');
  });

  it('debe_devolver_las_etiquetas_castellanas', () => {
    const e = etiquetasDocumento('es');
    expect(e.titulo).toBe('PRESUPUESTO');
    expect(e.concepto).toBe('CONCEPTO');
    expect(e.precio).toBe('PRECIO');
    expect(e.personas).toBe('personas');
    expect(e.validesa).toBe('Validez');
  });

  it('debe_caer_al_default_castellano_para_idioma_no_reconocible', () => {
    const e = etiquetasDocumento('xx' as unknown as 'es' | 'ca');
    expect(e.titulo).toBe('PRESUPUESTO');
  });

  it('debe_traducir_las_frases_del_pie_bancario_en_catalan', () => {
    const e = etiquetasDocumento('ca');
    // El email se interpola fuera del literal traducible (frase de formalización).
    expect(e.formalitzarPagament).toBe(
      '*Per formalitzar el pagament, envieu el comprovant a',
    );
    expect(e.transferenciaCompte).toBe(
      'El pagament es pot efectuar mitjançant transferència al núm. de compte:',
    );
    expect(e.dadesBancaries).toBe('Dades bancàries:');
  });

  it('debe_traducir_las_frases_del_pie_bancario_en_castellano', () => {
    const e = etiquetasDocumento('es');
    expect(e.formalitzarPagament).toBe(
      '*Para formalizar el pago, envíe el comprobante a',
    );
    expect(e.transferenciaCompte).toBe(
      'El pago puede efectuarse mediante transferencia al núm. de cuenta:',
    );
    expect(e.dadesBancaries).toBe('Datos bancarios:');
  });
});

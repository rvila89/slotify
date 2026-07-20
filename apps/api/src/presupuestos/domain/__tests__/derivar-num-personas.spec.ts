/**
 * TESTS UNITARIOS del helper PURO de derivación del nº de personas del documento de
 * presupuesto — change `pdf-presupuesto-horario-idioma`, fase TDD RED (tasks.md 3.3).
 *
 * Trazabilidad: spec-delta `presupuestos` — Scenario "El nº de personas se deriva del
 * aforo real"; design.md D5 (`numPersonas = numInvitadosFinal ??
 * (numAdultosNinosMayores4 + numNinosMenores4)`); memoria del proyecto
 * "aforo/personas es campo derivado" (unit tests enmascararon que el adaptador solo
 * tomaba `numAdultosNinosMayores4`).
 *
 * CONTRATO NUEVO QUE ESTE TEST ESPERA (a implementar por backend-developer en GREEN),
 * como helper PURO reusable por el adaptador de carga (deja la derivación testeable sin
 * Postgres; la verificación del adaptador contra BD real la hace QA):
 *
 *   // presupuestos/domain/derivar-num-personas.ts
 *   export const derivarNumPersonas = (aforo: {
 *     numInvitadosFinal: number | null;
 *     numAdultosNinosMayores4: number | null;
 *     numNinosMenores4: number | null;
 *   }) => number;
 *       → numInvitadosFinal cuando está informado; si no, suma del desglose
 *         (nulls tratados como 0, consistente con el adaptador).
 *
 * RED: el módulo `derivar-num-personas` NO existe → import falla (TS2307), batería en
 * ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN es de backend-developer.
 */
import { derivarNumPersonas } from '../derivar-num-personas';

describe('derivarNumPersonas — aforo derivado del documento de presupuesto', () => {
  it('debe_usar_numInvitadosFinal_cuando_esta_informado', () => {
    const personas = derivarNumPersonas({
      numInvitadosFinal: 55,
      numAdultosNinosMayores4: 30,
      numNinosMenores4: 10,
    });

    // numInvitadosFinal tiene prioridad sobre la suma del desglose.
    expect(personas).toBe(55);
  });

  it('debe_sumar_adultos_y_ninos_cuando_numInvitadosFinal_es_null', () => {
    // Escenario de la spec: 30 + 10 = 40, NO 30 (bug previo que solo tomaba adultos).
    const personas = derivarNumPersonas({
      numInvitadosFinal: null,
      numAdultosNinosMayores4: 30,
      numNinosMenores4: 10,
    });

    expect(personas).toBe(40);
  });

  it('debe_tratar_los_nulls_del_desglose_como_cero', () => {
    const personas = derivarNumPersonas({
      numInvitadosFinal: null,
      numAdultosNinosMayores4: 14,
      numNinosMenores4: null,
    });

    expect(personas).toBe(14);
  });

  it('debe_devolver_cero_cuando_no_hay_ningun_dato_de_aforo', () => {
    const personas = derivarNumPersonas({
      numInvitadosFinal: null,
      numAdultosNinosMayores4: null,
      numNinosMenores4: null,
    });

    expect(personas).toBe(0);
  });
});

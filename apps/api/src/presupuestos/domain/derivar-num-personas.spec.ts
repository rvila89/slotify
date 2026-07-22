/**
 * TESTS del helper puro `derivarNumPersonas` (change `reserva-viva-edicion-recalculo-
 * ficha`, tasks.md 3.2 sub-test A) — fase TDD RED.
 *
 * Trazabilidad: spec-delta `ficha-operativa` (Requirement "Nº de invitados confirmado
 * como campo derivado (no escrito)"; Scenarios "El nº de invitados confirmado refleja
 * el desglose de la RESERVA" y "numInvitadosFinal informado tiene prioridad"); design.md
 * §D-1/§D-2; memoria del proyecto "aforo/personas es campo derivado".
 *
 * Regla:
 *   derivarNumPersonas = numInvitadosFinal ?? (numAdultosNinosMayores4 + numNinosMenores4)
 * con los nulls tratados como 0. La ficha operativa reutiliza esta regla para exponer el
 * "nº de invitados confirmado" como valor DERIVADO read-only (no escrito por esa vía).
 *
 * NOTA (verde esperado): `derivarNumPersonas` YA EXISTE (`presupuestos/domain/derivar-
 * num-personas.ts`, usado por presupuestos). Esta batería CONSOLIDA la cobertura de los
 * casos de pre-relleno de la ficha (numInvitadosFinal presente vs. nulo). Si pasa en
 * verde, confirma que la función ya cubre el comportamiento requerido por este change.
 */
import {
  derivarNumPersonas,
  type AforoReserva,
} from './derivar-num-personas';

const aforo = (over: Partial<AforoReserva> = {}): AforoReserva => ({
  numInvitadosFinal: null,
  numAdultosNinosMayores4: null,
  numNinosMenores4: null,
  ...over,
});

describe('derivarNumPersonas — prioridad de numInvitadosFinal (3.2 A)', () => {
  it('debe_usar_numInvitadosFinal_cuando_esta_presente', () => {
    const personas = derivarNumPersonas(
      aforo({ numInvitadosFinal: 45, numAdultosNinosMayores4: 40, numNinosMenores4: 3 }),
    );

    // numInvitadosFinal MANDA sobre el desglose (45, no 43).
    expect(personas).toBe(45);
  });

  it('debe_usar_numInvitadosFinal_incluso_cuando_es_cero', () => {
    // `0 ?? x` = 0: un cero informado NO cae al desglose.
    const personas = derivarNumPersonas(
      aforo({ numInvitadosFinal: 0, numAdultosNinosMayores4: 40, numNinosMenores4: 3 }),
    );

    expect(personas).toBe(0);
  });
});

describe('derivarNumPersonas — suma del desglose cuando numInvitadosFinal es nulo (3.2 A)', () => {
  it('debe_sumar_numAdultosNinosMayores4_y_numNinosMenores4', () => {
    const personas = derivarNumPersonas(
      aforo({ numInvitadosFinal: null, numAdultosNinosMayores4: 48, numNinosMenores4: 2 }),
    );

    expect(personas).toBe(50);
  });

  it('debe_tratar_los_nulls_del_desglose_como_cero', () => {
    const personas = derivarNumPersonas(
      aforo({ numInvitadosFinal: null, numAdultosNinosMayores4: 40, numNinosMenores4: null }),
    );

    expect(personas).toBe(40);
  });

  it('debe_devolver_cero_cuando_todo_el_aforo_es_nulo', () => {
    expect(derivarNumPersonas(aforo())).toBe(0);
  });
});

/**
 * TESTS de la GUARDA DE PRECONDICIÓN de la devolución de la FIANZA — MÁQUINA DE ESTADOS de dominio
 * puro (US-036 / UC-27) — fase TDD RED. tasks.md Fase 3: 3.8 (precondición triple) + 3.9 (guarda
 * de doble registro, parte de dominio). Paso SIMÉTRICO INVERSO de `puede-registrar-cobro-fianza`
 * (US-030), calcado en estructura.
 *
 * `puedeRegistrarDevolucion` es una FUNCIÓN PURA de dominio (hook `no-infra-in-domain`) que modela
 * la guarda de la transición del sub-proceso de fianza `cobrada → {devuelta | retenida_parcial}`
 * como ESTRUCTURA DE DATOS, NO como código disperso (CLAUDE.md §Máquina de estados). Aplica la
 * PRECONDICIÓN TRIPLE (spec-delta `facturacion` Requirement "Precondición triple de disponibilidad
 * del registro de devolución"; design.md §D-4):
 *   - `estado = 'post_evento'` Y `fianzaStatus = 'cobrada'` Y `ibanDevolucion != null` → PROCEDE.
 *   - `estado != 'post_evento'` → BLOQUEA `PRECONDICION_NO_CUMPLIDA` (409).
 *   - `fianzaStatus != 'cobrada'` (p. ej. `recibo_enviado`, `pendiente`) → BLOQUEA
 *     `PRECONDICION_NO_CUMPLIDA` (409).
 *   - `ibanDevolucion == null` → BLOQUEA `PRECONDICION_NO_CUMPLIDA` (409).
 *   - `fianzaStatus ∈ {'devuelta', 'retenida_parcial'}` (ya registrada) → BLOQUEA
 *     `DEVOLUCION_YA_REGISTRADA` (409, doble registro / estado final irreversible).
 *
 * La guarda es dominio puro; el use-case la REEVALÚA dentro de la transacción tras el
 * `SELECT ... FOR UPDATE` (la concurrencia real vive en el spec de integración de concurrencia).
 *
 * RED: aún NO existe `facturacion/domain/puede-registrar-devolucion.ts`. El import falla y la
 * batería está en ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import { puedeRegistrarDevolucion } from '../puede-registrar-devolucion';

const IBAN = 'ES9121000418450200051332';

// ===========================================================================
// 3.8 — Precondición triple satisfecha → PROCEDE.
// ===========================================================================

describe('puedeRegistrarDevolucion — precondición triple satisfecha procede (3.8)', () => {
  it('debe_permitir_cuando_post_evento_y_fianza_cobrada_y_con_iban', () => {
    const resultado = puedeRegistrarDevolucion({
      estado: 'post_evento',
      fianzaStatus: 'cobrada',
      ibanDevolucion: IBAN,
    });

    expect(resultado.permitido).toBe(true);
  });
});

// ===========================================================================
// 3.8 — estado != post_evento → PRECONDICION_NO_CUMPLIDA.
// ===========================================================================

describe('puedeRegistrarDevolucion — fuera de post_evento bloquea (3.8)', () => {
  it('debe_bloquear_cuando_el_estado_no_es_post_evento', () => {
    const resultado = puedeRegistrarDevolucion({
      estado: 'evento_en_curso',
      fianzaStatus: 'cobrada',
      ibanDevolucion: IBAN,
    });

    expect(resultado.permitido).toBe(false);
    if (!resultado.permitido) {
      expect(resultado.codigo).toBe('PRECONDICION_NO_CUMPLIDA');
    }
  });
});

// ===========================================================================
// 3.8 — fianza_status != cobrada → PRECONDICION_NO_CUMPLIDA.
// ===========================================================================

describe('puedeRegistrarDevolucion — fianza no cobrada bloquea (3.8)', () => {
  it('debe_bloquear_cuando_la_fianza_no_esta_cobrada_recibo_enviado', () => {
    const resultado = puedeRegistrarDevolucion({
      estado: 'post_evento',
      fianzaStatus: 'recibo_enviado',
      ibanDevolucion: IBAN,
    });

    expect(resultado.permitido).toBe(false);
    if (!resultado.permitido) {
      expect(resultado.codigo).toBe('PRECONDICION_NO_CUMPLIDA');
    }
  });

  it('debe_bloquear_cuando_la_fianza_esta_pendiente', () => {
    const resultado = puedeRegistrarDevolucion({
      estado: 'post_evento',
      fianzaStatus: 'pendiente',
      ibanDevolucion: IBAN,
    });

    expect(resultado.permitido).toBe(false);
    if (!resultado.permitido) {
      expect(resultado.codigo).toBe('PRECONDICION_NO_CUMPLIDA');
    }
  });
});

// ===========================================================================
// 3.8 — iban_devolucion null → PRECONDICION_NO_CUMPLIDA.
// ===========================================================================

describe('puedeRegistrarDevolucion — sin IBAN de devolución bloquea (3.8)', () => {
  it('debe_bloquear_cuando_el_cliente_no_tiene_iban_de_devolucion', () => {
    const resultado = puedeRegistrarDevolucion({
      estado: 'post_evento',
      fianzaStatus: 'cobrada',
      ibanDevolucion: null,
    });

    expect(resultado.permitido).toBe(false);
    if (!resultado.permitido) {
      expect(resultado.codigo).toBe('PRECONDICION_NO_CUMPLIDA');
    }
  });
});

// ===========================================================================
// 3.9 — fianza ya en estado final → DEVOLUCION_YA_REGISTRADA (irreversible).
// ===========================================================================

describe('puedeRegistrarDevolucion — doble registro sobre estado final bloquea (3.9)', () => {
  it('debe_bloquear_con_DevolucionYaRegistrada_cuando_ya_esta_devuelta', () => {
    const resultado = puedeRegistrarDevolucion({
      estado: 'post_evento',
      fianzaStatus: 'devuelta',
      ibanDevolucion: IBAN,
    });

    expect(resultado.permitido).toBe(false);
    if (!resultado.permitido) {
      expect(resultado.codigo).toBe('DEVOLUCION_YA_REGISTRADA');
    }
  });

  it('debe_bloquear_con_DevolucionYaRegistrada_cuando_ya_esta_retenida_parcial', () => {
    const resultado = puedeRegistrarDevolucion({
      estado: 'post_evento',
      fianzaStatus: 'retenida_parcial',
      ibanDevolucion: IBAN,
    });

    expect(resultado.permitido).toBe(false);
    if (!resultado.permitido) {
      expect(resultado.codigo).toBe('DEVOLUCION_YA_REGISTRADA');
    }
  });

  it('debe_distinguir_el_doble_registro_de_la_precondicion_no_cumplida', () => {
    // Estado final ⇒ DEVOLUCION_YA_REGISTRADA; precondición incompleta ⇒ PRECONDICION_NO_CUMPLIDA.
    const yaRegistrada = puedeRegistrarDevolucion({
      estado: 'post_evento',
      fianzaStatus: 'devuelta',
      ibanDevolucion: IBAN,
    });
    const sinIban = puedeRegistrarDevolucion({
      estado: 'post_evento',
      fianzaStatus: 'cobrada',
      ibanDevolucion: null,
    });

    if (!yaRegistrada.permitido) {
      expect(yaRegistrada.codigo).toBe('DEVOLUCION_YA_REGISTRADA');
    }
    if (!sinIban.permitido) {
      expect(sinIban.codigo).toBe('PRECONDICION_NO_CUMPLIDA');
    }
  });
});

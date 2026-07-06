/**
 * TESTS de la GUARDA DE PRECONDICIÓN del cobro — MÁQUINA DE ESTADOS de dominio puro
 * (US-029 / UC-21) — fase TDD RED. tasks.md Fase 3: 3.3.
 *
 * `puedeRegistrarCobro` es una FUNCIÓN PURA de dominio (hook `no-infra-in-domain`) que modela
 * la guarda de la transición del sub-proceso de liquidación de la RESERVA hacia el cobro
 * como ESTRUCTURA DE DATOS, no como código disperso (CLAUDE.md §Máquina de estados):
 *   - `liquidacion_status = 'facturada'` → PROCEDE (única precondición válida).
 *   - `liquidacion_status = 'pendiente'` → BLOQUEA `LIQUIDACION_NO_FACTURADA` (la factura de
 *     liquidación aún no fue enviada, US-028 no ejecutada). Mensaje: "La factura de
 *     liquidación debe estar enviada antes de registrar su cobro".
 *   - `liquidacion_status = 'cobrada'` → BLOQUEA `LIQUIDACION_YA_COBRADA` (doble cobro).
 *     Mensaje: "La liquidación ya está marcada como cobrada".
 * (spec-delta `facturacion` Requirements "Guarda contra el doble cobro" y "Precondición de
 * estado — solo se cobra desde facturada"; design.md §D-2; contrato `CobroLiquidacionError`
 * 409.)
 *
 * La guarda es dominio puro; el use-case la reevalúa DENTRO de la transacción tras el
 * `SELECT ... FOR UPDATE` (la concurrencia real vive en el spec de integración).
 *
 * RED: aún NO existe `facturacion/domain/puede-registrar-cobro.ts`. El import falla y la
 * batería está en ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import { puedeRegistrarCobro } from '../puede-registrar-cobro';

// ===========================================================================
// 3.3 — 'facturada' PROCEDE (permitido = true, sin código de error).
// ===========================================================================

describe('puedeRegistrarCobro — desde facturada procede (3.3)', () => {
  it('debe_permitir_registrar_el_cobro_cuando_liquidacion_status_es_facturada', () => {
    const resultado = puedeRegistrarCobro('facturada');

    expect(resultado.permitido).toBe(true);
  });
});

// ===========================================================================
// 3.3 — 'pendiente' BLOQUEA con LIQUIDACION_NO_FACTURADA (precondición).
// ===========================================================================

describe('puedeRegistrarCobro — desde pendiente bloquea (3.3)', () => {
  it('debe_bloquear_cuando_liquidacion_status_es_pendiente', () => {
    const resultado = puedeRegistrarCobro('pendiente');

    expect(resultado.permitido).toBe(false);
  });

  it('debe_devolver_el_codigo_LIQUIDACION_NO_FACTURADA_desde_pendiente', () => {
    const resultado = puedeRegistrarCobro('pendiente');

    expect(resultado.permitido).toBe(false);
    if (!resultado.permitido) {
      expect(resultado.codigo).toBe('LIQUIDACION_NO_FACTURADA');
      expect(resultado.motivo).toContain('debe estar enviada');
    }
  });
});

// ===========================================================================
// 3.3 — 'cobrada' BLOQUEA con LIQUIDACION_YA_COBRADA (doble cobro).
// ===========================================================================

describe('puedeRegistrarCobro — desde cobrada bloquea el doble cobro (3.3)', () => {
  it('debe_bloquear_cuando_liquidacion_status_ya_es_cobrada', () => {
    const resultado = puedeRegistrarCobro('cobrada');

    expect(resultado.permitido).toBe(false);
  });

  it('debe_devolver_el_codigo_LIQUIDACION_YA_COBRADA_desde_cobrada', () => {
    const resultado = puedeRegistrarCobro('cobrada');

    expect(resultado.permitido).toBe(false);
    if (!resultado.permitido) {
      expect(resultado.codigo).toBe('LIQUIDACION_YA_COBRADA');
      expect(resultado.motivo).toContain('ya está marcada como cobrada');
    }
  });
});

/**
 * TESTS de la GUARDA DE PRECONDICIÓN del cobro de la FIANZA — MÁQUINA DE ESTADOS de dominio
 * puro (US-030 / UC-22) — fase TDD RED. tasks.md Fase 3: 3.2.
 *
 * `puedeRegistrarCobroFianza` es una FUNCIÓN PURA de dominio (hook `no-infra-in-domain`) que
 * modela la guarda de la transición del sub-proceso de fianza de la RESERVA hacia el cobro como
 * ESTRUCTURA DE DATOS, no como código disperso (CLAUDE.md §Máquina de estados). A DIFERENCIA de
 * la liquidación (US-029, donde `pendiente` bloqueaba de forma dura), la fianza aplica la
 * política "Negociable" (design.md §D-2):
 *   - `fianza_status = 'recibo_enviado'` → PROCEDE (happy path; el flag `confirmarSinRecibo` es
 *     irrelevante).
 *   - `fianza_status = 'cobrada'` → BLOQUEA `FIANZA_YA_COBRADA` (doble cobro). Mensaje: "La
 *     fianza ya está marcada como cobrada".
 *   - `fianza_status = 'pendiente'` → política "Negociable": SIN `confirmarSinRecibo=true` PIDE
 *     CONFIRMACIÓN (`RECIBO_FIANZA_NO_ENVIADO`, aviso NO bloqueante); CON `confirmarSinRecibo=true`
 *     PROCEDE (flujo excepcional trazado).
 * (spec-delta `facturacion` Requirements "Guarda contra el doble cobro de la fianza" y "Política
 * Negociable — el cobro con fianza pendiente avisa pero no bloquea"; design.md §D-1/§D-2;
 * contrato `CobroFianzaError` 409 / `RegistrarCobroFianzaConfirmacionRequerida` 200.)
 *
 * La guarda es dominio puro; el use-case la reevalúa DENTRO de la transacción tras el
 * `SELECT ... FOR UPDATE` (la concurrencia real vive en el spec de integración).
 *
 * RED: aún NO existe `facturacion/domain/puede-registrar-cobro-fianza.ts`. El import falla y la
 * batería está en ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import { puedeRegistrarCobroFianza } from '../puede-registrar-cobro-fianza';

// ===========================================================================
// 3.2 — 'recibo_enviado' PROCEDE (happy path), con o sin confirmarSinRecibo.
// ===========================================================================

describe('puedeRegistrarCobroFianza — desde recibo_enviado procede (3.2)', () => {
  it('debe_permitir_registrar_el_cobro_cuando_fianza_status_es_recibo_enviado', () => {
    const resultado = puedeRegistrarCobroFianza({
      fianzaStatus: 'recibo_enviado',
      confirmarSinRecibo: false,
    });

    expect(resultado.permitido).toBe(true);
  });

  it('debe_permitir_desde_recibo_enviado_ignorando_el_flag_confirmarSinRecibo', () => {
    const resultado = puedeRegistrarCobroFianza({
      fianzaStatus: 'recibo_enviado',
      confirmarSinRecibo: true,
    });

    expect(resultado.permitido).toBe(true);
  });
});

// ===========================================================================
// 3.2 — 'cobrada' BLOQUEA con FIANZA_YA_COBRADA (doble cobro).
// ===========================================================================

describe('puedeRegistrarCobroFianza — desde cobrada bloquea el doble cobro (3.2)', () => {
  it('debe_bloquear_cuando_fianza_status_ya_es_cobrada', () => {
    const resultado = puedeRegistrarCobroFianza({
      fianzaStatus: 'cobrada',
      confirmarSinRecibo: false,
    });

    expect(resultado.permitido).toBe(false);
  });

  it('debe_bloquear_desde_cobrada_aunque_venga_confirmarSinRecibo_true', () => {
    // El doble cobro es un bloqueo duro: ni la confirmación "Negociable" lo levanta.
    const resultado = puedeRegistrarCobroFianza({
      fianzaStatus: 'cobrada',
      confirmarSinRecibo: true,
    });

    expect(resultado.permitido).toBe(false);
  });

  it('debe_devolver_el_codigo_FIANZA_YA_COBRADA_y_el_mensaje_desde_cobrada', () => {
    const resultado = puedeRegistrarCobroFianza({
      fianzaStatus: 'cobrada',
      confirmarSinRecibo: false,
    });

    expect(resultado.permitido).toBe(false);
    if (!resultado.permitido) {
      expect(resultado.codigo).toBe('FIANZA_YA_COBRADA');
      expect(resultado.motivo).toContain('ya está marcada como cobrada');
    }
  });
});

// ===========================================================================
// 3.2 — 'pendiente' política "Negociable": sin flag PIDE CONFIRMACIÓN; con flag PROCEDE.
// ===========================================================================

describe('puedeRegistrarCobroFianza — desde pendiente aplica la política Negociable (3.2)', () => {
  it('debe_pedir_confirmacion_cuando_pendiente_y_confirmarSinRecibo_es_false', () => {
    const resultado = puedeRegistrarCobroFianza({
      fianzaStatus: 'pendiente',
      confirmarSinRecibo: false,
    });

    // NO es un bloqueo duro: es un aviso no bloqueante que pide confirmación explícita.
    expect(resultado.permitido).toBe(false);
    if (!resultado.permitido) {
      expect(resultado.codigo).toBe('RECIBO_FIANZA_NO_ENVIADO');
      expect(resultado.requiereConfirmacion).toBe(true);
      expect(resultado.motivo).toContain('no ha sido enviado al cliente');
    }
  });

  it('debe_distinguir_la_confirmacion_requerida_de_un_bloqueo_duro_de_doble_cobro', () => {
    const negociable = puedeRegistrarCobroFianza({
      fianzaStatus: 'pendiente',
      confirmarSinRecibo: false,
    });
    const dobleCobro = puedeRegistrarCobroFianza({
      fianzaStatus: 'cobrada',
      confirmarSinRecibo: false,
    });

    // 'pendiente' es reintentable (requiereConfirmacion); 'cobrada' es un bloqueo duro.
    if (!negociable.permitido) {
      expect(negociable.requiereConfirmacion).toBe(true);
    }
    if (!dobleCobro.permitido) {
      expect(dobleCobro.requiereConfirmacion).not.toBe(true);
    }
  });

  it('debe_proceder_cuando_pendiente_y_confirmarSinRecibo_es_true', () => {
    // El Gestor confirma el aviso → el cobro procede (flujo excepcional Negociable).
    const resultado = puedeRegistrarCobroFianza({
      fianzaStatus: 'pendiente',
      confirmarSinRecibo: true,
    });

    expect(resultado.permitido).toBe(true);
  });
});

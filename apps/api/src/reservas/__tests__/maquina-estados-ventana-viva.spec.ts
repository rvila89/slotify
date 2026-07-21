/**
 * TESTS de la guarda declarativa `esEditableEnVentanaViva` de la máquina de estados de
 * la RESERVA (change `reserva-viva-edicion-recalculo-ficha`, tasks.md 3.1) — fase TDD RED.
 *
 * Trazabilidad: spec-delta `reserva-viva` (Requirement "Ventana de edición viva de la
 * reserva (guarda declarativa)"; Scenarios "Reserva confirmada, ficha abierta y
 * liquidación no cobrada permite recálculo", "Ficha ya cerrada bloquea el recálculo",
 * "Liquidación ya cobrada bloquea el recálculo", "Reserva anterior a reserva_confirmada
 * no está en la ventana viva"); design.md §D-3.
 *
 * La ventana viva se define por la CONJUNCIÓN declarativa:
 *   esEditableEnVentanaViva(estado, preEventoStatus, liquidacionStatus) =
 *     estado === 'reserva_confirmada'
 *     && preEventoStatus !== 'cerrado'
 *     && liquidacionStatus !== 'cobrada'
 *
 * Es una GUARDA DE EDITABILIDAD (no una arista de la máquina), función PURA de dominio
 * (skill `state-machine`, hook `no-infra-in-domain`): sin `@nestjs/*` ni Prisma. La falla
 * de la guarda se traduce en `FueraDeVentanaVivaError` (422) en la capa de aplicación.
 *
 * RED: aún NO existe `esEditableEnVentanaViva` en `reservas/domain/maquina-estados.ts`;
 * el import falla y la batería está en ROJO. GREEN es de `backend-developer`.
 */
import {
  esEditableEnVentanaViva,
  type EstadoReserva,
  type PreEventoStatusDominio,
  type LiquidacionStatusDominio,
} from '../domain/maquina-estados';

// ===========================================================================
// 3.1 — Dentro de la ventana viva: reserva_confirmada + ficha NO cerrada +
//        liquidación NO cobrada → true.
// ===========================================================================

describe('Máquina de estados — esEditableEnVentanaViva DENTRO de la ventana (3.1)', () => {
  it('debe_permitir_recalculo_cuando_confirmada_ficha_en_curso_y_liquidacion_pendiente', () => {
    expect(esEditableEnVentanaViva('reserva_confirmada', 'en_curso', 'pendiente')).toBe(
      true,
    );
  });

  it('debe_permitir_recalculo_cuando_confirmada_ficha_pendiente_y_liquidacion_facturada', () => {
    // `pendiente` de ficha y `facturada` de liquidación NO son estados de cierre/cobro:
    // la ventana viva sigue abierta.
    expect(esEditableEnVentanaViva('reserva_confirmada', 'pendiente', 'facturada')).toBe(
      true,
    );
  });
});

// ===========================================================================
// 3.1 — Fuera de la ventana viva por ficha CERRADA o liquidación COBRADA.
// ===========================================================================

describe('Máquina de estados — esEditableEnVentanaViva FUERA de la ventana (3.1)', () => {
  it('debe_bloquear_cuando_la_ficha_esta_cerrada_aunque_la_liquidacion_este_pendiente', () => {
    expect(esEditableEnVentanaViva('reserva_confirmada', 'cerrado', 'pendiente')).toBe(
      false,
    );
  });

  it('debe_bloquear_cuando_la_liquidacion_esta_cobrada_aunque_la_ficha_este_en_curso', () => {
    expect(esEditableEnVentanaViva('reserva_confirmada', 'en_curso', 'cobrada')).toBe(
      false,
    );
  });

  it('debe_bloquear_cuando_la_ficha_esta_cerrada_y_la_liquidacion_cobrada', () => {
    expect(esEditableEnVentanaViva('reserva_confirmada', 'cerrado', 'cobrada')).toBe(
      false,
    );
  });
});

// ===========================================================================
// 3.1 — Fuera de la ventana viva por ESTADO anterior/posterior a reserva_confirmada.
//        El aforo/duración de una consulta/pre_reserva se editan por su propio editor,
//        no por esta vía de recálculo.
// ===========================================================================

describe('Máquina de estados — esEditableEnVentanaViva exige reserva_confirmada (3.1)', () => {
  const noConfirmados: ReadonlyArray<EstadoReserva> = [
    'consulta',
    'pre_reserva',
    'evento_en_curso',
    'post_evento',
    'reserva_completada',
    'reserva_cancelada',
  ];

  it.each(noConfirmados)(
    'debe_bloquear_cuando_el_estado_es_%s_aunque_ficha_y_liquidacion_esten_abiertas',
    (estado) => {
      expect(esEditableEnVentanaViva(estado, 'en_curso', 'pendiente')).toBe(false);
    },
  );

  it('debe_bloquear_explicitamente_pre_reserva_como_estado_anterior', () => {
    // Scenario spec-delta: una RESERVA en pre_reserva NO está en la ventana viva.
    const preEvento: PreEventoStatusDominio = 'pendiente';
    const liquidacion: LiquidacionStatusDominio = 'pendiente';
    expect(esEditableEnVentanaViva('pre_reserva', preEvento, liquidacion)).toBe(false);
  });

  it('debe_bloquear_explicitamente_consulta_como_estado_anterior', () => {
    expect(esEditableEnVentanaViva('consulta', 'pendiente', 'pendiente')).toBe(false);
  });
});

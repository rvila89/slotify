/**
 * TESTS de la GUARDA DE PRECONDICIÓN DECLARATIVA «estado válido para EDITAR el
 * presupuesto» (`esEstadoValidoParaEditarPresupuesto`) de la edición/reenvío de
 * presupuesto en pre_reserva (US-015 / UC-15) — fase TDD RED. tasks.md Fase 3: 3.1
 * (vertiente de estado de la RESERVA).
 *
 * Trazabilidad: US-015 §Reglas de negocio, §Estado inválido — RESERVA fuera de
 * pre_reserva; spec-delta `presupuestos` (Requirement "Precondición de edición —
 * pre_reserva y presupuesto no aceptado"); design.md D5 ("la guarda de precondición
 * (pre_reserva …) se modela como estructura declarativa en la máquina de estados, no
 * como `if` dispersos").
 *
 * Esta guarda cubre SOLO la vertiente del `estado` de la RESERVA (debe ser
 * `pre_reserva`). La segunda vertiente de la precondición —que el ÚLTIMO PRESUPUESTO
 * esté en `{borrador, enviado}` y NO en `aceptado`/`rechazado`— NO es un estado de la
 * máquina de la RESERVA: se valida sobre el PRESUPUESTO en el use-case
 * (`editar-presupuesto.use-case.spec.ts`), no aquí.
 *
 * A diferencia de `esOrigenValidoParaConfirmarSenal` (origen ESTRICTO de una
 * transición origen→destino), esta es una PRECONDICIÓN de estado (la edición
 * NO transiciona la RESERVA: permanece `pre_reserva`), análoga a
 * `esEstadoConBloqueoBlandoExtensible` (US-006) y a
 * `esEstadoValidoParaRegistrarFirmaCondiciones` (US-024). Se modela como tabla de
 * datos en `maquina-estados.ts`, NO como transición no-op del grafo.
 *
 * DOMINIO PURO (hook `no-infra-in-domain`): la guarda se resuelve con una ESTRUCTURA
 * DE DATOS declarativa.
 *
 * RED: aún NO existe `esEstadoValidoParaEditarPresupuesto` en
 * `reservas/domain/maquina-estados.ts`. La batería está en ROJO por AUSENCIA DE
 * IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import {
  esEstadoValidoParaEditarPresupuesto,
  type EstadoReserva,
} from '../domain/maquina-estados';

// ===========================================================================
// 1. ÚNICO estado válido: pre_reserva. La edición del presupuesto solo procede
//    mientras la RESERVA está en pre_reserva (no transiciona: se queda ahí).
// ===========================================================================

describe('esEstadoValidoParaEditarPresupuesto — solo pre_reserva es válido', () => {
  it('debe_aceptar_pre_reserva_como_unico_estado_valido_para_editar', () => {
    expect(esEstadoValidoParaEditarPresupuesto('pre_reserva')).toBe(true);
  });
});

// ===========================================================================
// 2. RESERVA fuera de pre_reserva → NO válida (409, sin efectos). Cubre el
//    estado principal `consulta` (con o sin sub-estado; p. ej. 2b), el
//    posterior `reserva_confirmada` (señal ya confirmada) y los demás estados
//    principales / terminales inmutables.
// ===========================================================================

describe('esEstadoValidoParaEditarPresupuesto — cualquier otro estado NO es válido', () => {
  const invalidos: ReadonlyArray<EstadoReserva> = [
    'consulta',
    'reserva_confirmada',
    'evento_en_curso',
    'post_evento',
    'reserva_completada',
    'reserva_cancelada',
  ];

  it.each(invalidos)(
    'no_debe_aceptar_el_estado_%s_para_editar_el_presupuesto',
    (estado) => {
      expect(esEstadoValidoParaEditarPresupuesto(estado)).toBe(false);
    },
  );
});

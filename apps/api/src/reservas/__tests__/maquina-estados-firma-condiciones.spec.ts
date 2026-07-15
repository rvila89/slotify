/**
 * TESTS de la GUARDA DE PRECONDICIÓN DECLARATIVA «estado válido para registrar la
 * firma de condiciones particulares» (`esEstadoValidoParaRegistrarFirmaCondiciones`)
 * del registro de la firma (US-024 / UC-19 segundo flujo) — fase TDD RED. tasks.md
 * Fase 3: 3.1 (vertiente de estado).
 *
 * Trazabilidad: US-024 §Reglas de Validación (`estado ∈ {reserva_confirmada,
 * evento_en_curso, post_evento}`), spec-delta `confirmacion` (Requirement "La firma no
 * transiciona el estado de la reserva y es válida en tres estados"), design.md
 * §D-no-transicion (la firma NO es una transición origen→destino sino una PRECONDICIÓN
 * sobre el estado actual; se modela como tabla de datos en `maquina-estados.ts`, mismo
 * estilo que `ESTADOS_BLOQUEO_BLANDO_EXTENSIBLE` de US-006, NO como `if` dispersos ni
 * como transiciones no-op en el grafo). Decisión firme del Gate 1:
 *   válido ⇔ `estado ∈ {reserva_confirmada, evento_en_curso, post_evento}`.
 *   NO válido: `consulta` (todos sus sub-estados), `pre_reserva`, y los terminales
 *   `reserva_completada` / `reserva_cancelada` → 422 sin efectos.
 *
 * DOMINIO PURO (hook `no-infra-in-domain`): la guarda se resuelve con una ESTRUCTURA
 * DE DATOS. A diferencia de `esOrigenValidoParaConfirmarSenal` (origen estricto de una
 * transición), esta es una PRECONDICIÓN de estado (la firma actualiza campos, no
 * transiciona), análoga a `esEstadoConBloqueoBlandoExtensible` de US-006.
 *
 * RED: aún NO existe `esEstadoValidoParaRegistrarFirmaCondiciones` en
 * `reservas/domain/maquina-estados.ts`. La batería está en ROJO por AUSENCIA DE
 * IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import {
  esEstadoValidoParaRegistrarFirmaCondiciones,
  type EstadoReserva,
} from '../domain/maquina-estados';

// ===========================================================================
// 1. Los TRES estados válidos: la firma se acepta en reserva_confirmada,
//    evento_en_curso y post_evento (hasta el cierre del post-evento).
// ===========================================================================

describe('esEstadoValidoParaRegistrarFirmaCondiciones — estados válidos {reserva_confirmada, evento_en_curso, post_evento}', () => {
  const validos: ReadonlyArray<EstadoReserva> = [
    'reserva_confirmada',
    'evento_en_curso',
    'post_evento',
  ];

  it.each(validos)(
    'debe_aceptar_el_estado_%s_como_valido_para_registrar_la_firma',
    (estado) => {
      expect(esEstadoValidoParaRegistrarFirmaCondiciones(estado)).toBe(true);
    },
  );
});

// ===========================================================================
// 2. Estados terminales: reserva_completada y reserva_cancelada NO son válidos
//    (la firma no puede registrarse sobre una reserva terminal) → 422.
// ===========================================================================

describe('esEstadoValidoParaRegistrarFirmaCondiciones — terminales NO válidos', () => {
  const terminales: ReadonlyArray<EstadoReserva> = [
    'reserva_completada',
    'reserva_cancelada',
  ];

  it.each(terminales)(
    'no_debe_aceptar_el_estado_terminal_%s',
    (estado) => {
      expect(esEstadoValidoParaRegistrarFirmaCondiciones(estado)).toBe(false);
    },
  );
});

// ===========================================================================
// 3. Estados anteriores al ciclo de confirmación (consulta / pre_reserva) NO son
//    válidos: la firma exige que las condiciones ya se hayan enviado (E3), lo que
//    ocurre a partir de reserva_confirmada.
// ===========================================================================

describe('esEstadoValidoParaRegistrarFirmaCondiciones — consulta y pre_reserva NO válidos', () => {
  const previos: ReadonlyArray<EstadoReserva> = ['consulta', 'pre_reserva'];

  it.each(previos)(
    'no_debe_aceptar_el_estado_%s_previo_a_la_confirmacion',
    (estado) => {
      expect(esEstadoValidoParaRegistrarFirmaCondiciones(estado)).toBe(false);
    },
  );
});

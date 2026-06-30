/**
 * TESTS de la GUARDA DE PRECONDICIÓN DECLARATIVA «bloqueo blando extensible»
 * (`esEstadoConBloqueoBlandoExtensible`) de la extensión manual del TTL (US-006 /
 * UC-05) — fase TDD RED. tasks.md Fase 3: 3.1.
 *
 * Trazabilidad: US-006, spec-delta `consultas` (Requirement "Estado sin bloqueo
 * activo extensible — la extensión no está permitida", "La precondición se modela
 * como dato declarativo"), design.md §D-1 (la guarda NO es una transición
 * origen→destino sino una PRECONDICIÓN sobre el estado actual; se modela como tabla
 * de datos en `maquina-estados.ts`, mismo estilo que `ORIGENES_TRANSICION_*`, NO como
 * `if` dispersos). Decisión firme del Gate:
 *   extensible ⇔ `subEstado ∈ {2b, 2c, 2v}` O `estado = 'pre_reserva'`.
 *   NO extensible: `2a`, terminales (`2x/2y/2z`/`reserva_cancelada`/
 *   `reserva_completada`) y `reserva_confirmada` (bloqueo FIRME, sin TTL).
 *
 * DOMINIO PURO (hook `no-infra-in-domain`): la guarda se resuelve con una ESTRUCTURA
 * DE DATOS. A diferencia de US-005 (origen estricto `2.a`), US-007 (origen estricto
 * `2.b`) y US-008 (orígenes `{2a,2b,2c}`), US-006 NO es una transición: es la defensa
 * rápida de estado previa a la BD (la condición REAL de runtime —fila blanda vigente
 * con `ttl_expiracion > ahora`— se valida en el use-case bajo el lock).
 *
 * RED: aún NO existe `esEstadoConBloqueoBlandoExtensible` en
 * `reservas/domain/maquina-estados.ts`. La batería está en ROJO por AUSENCIA DE
 * IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import {
  esEstadoConBloqueoBlandoExtensible,
  type EstadoReserva,
  type SubEstadoConsulta,
} from '../domain/maquina-estados';

// ===========================================================================
// 1. Sub-estados de consulta con bloqueo blando vigente extensible: {2b, 2c, 2v}.
// ===========================================================================

describe('esEstadoConBloqueoBlandoExtensible — sub-estados extensibles {2b,2c,2v}', () => {
  const extensibles: ReadonlyArray<SubEstadoConsulta> = ['2b', '2c', '2v'];

  it.each(extensibles)(
    'debe_aceptar_consulta_%s_como_estado_con_bloqueo_blando_extensible',
    (subEstado) => {
      expect(esEstadoConBloqueoBlandoExtensible('consulta', subEstado)).toBe(true);
    },
  );
});

// ===========================================================================
// 2. `pre_reserva` es extensible aunque NO sea un sub-estado de consulta (regla
//    multi-estado del Gate: `estado = 'pre_reserva'` O `subEstado ∈ {2b,2c,2v}`).
// ===========================================================================

describe('esEstadoConBloqueoBlandoExtensible — pre_reserva es extensible', () => {
  it('debe_aceptar_pre_reserva_aunque_no_tenga_sub_estado_de_consulta', () => {
    expect(esEstadoConBloqueoBlandoExtensible('pre_reserva', null)).toBe(true);
  });
});

// ===========================================================================
// 3. `2a` (exploratoria, SIN fecha bloqueada) NO es extensible → 422.
// ===========================================================================

describe('esEstadoConBloqueoBlandoExtensible — 2a sin fecha bloqueada NO es extensible', () => {
  it('no_debe_aceptar_consulta_2a', () => {
    expect(esEstadoConBloqueoBlandoExtensible('consulta', '2a')).toBe(false);
  });
});

// ===========================================================================
// 4. Sub-estados terminales de consulta (2d cola, 2x/2y/2z) NO son extensibles.
//    (2.d cola no tiene bloqueo blando propio; los terminales son inmutables.)
// ===========================================================================

describe('esEstadoConBloqueoBlandoExtensible — cola 2d y terminales 2x/2y/2z NO extensibles', () => {
  const noExtensibles: ReadonlyArray<SubEstadoConsulta> = ['2d', '2x', '2y', '2z'];

  it.each(noExtensibles)(
    'no_debe_aceptar_el_sub_estado_%s_como_extensible',
    (subEstado) => {
      expect(esEstadoConBloqueoBlandoExtensible('consulta', subEstado)).toBe(false);
    },
  );
});

// ===========================================================================
// 5. `reserva_confirmada` (bloqueo FIRME, sin TTL) NO es extensible: no hay TTL que
//    extender. El resto de estados principales no-consulta y distintos de
//    `pre_reserva` (evento_en_curso, post_evento, terminales) tampoco.
// ===========================================================================

describe('esEstadoConBloqueoBlandoExtensible — estados firmes/terminales NO extensibles', () => {
  const noExtensibles: ReadonlyArray<EstadoReserva> = [
    'reserva_confirmada',
    'evento_en_curso',
    'post_evento',
    'reserva_completada',
    'reserva_cancelada',
  ];

  it.each(noExtensibles)(
    'no_debe_aceptar_el_estado_%s_como_extensible',
    (estado) => {
      expect(esEstadoConBloqueoBlandoExtensible(estado, null)).toBe(false);
    },
  );
});

// ===========================================================================
// 6. `consulta` sin sub-estado (caso defensivo) NO es extensible.
// ===========================================================================

describe('esEstadoConBloqueoBlandoExtensible — consulta sin sub-estado no es extensible', () => {
  it('no_debe_aceptar_consulta_con_sub_estado_null', () => {
    expect(esEstadoConBloqueoBlandoExtensible('consulta', null)).toBe(false);
  });
});

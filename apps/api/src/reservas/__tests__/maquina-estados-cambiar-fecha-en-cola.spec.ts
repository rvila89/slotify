/**
 * TESTS de la GUARDA DE ORIGEN DECLARATIVA de la operación «cambiar fecha desde la cola»
 * (`esOrigenCambiarFechaEnCola(estado, subEstado)` + `ORIGENES_CAMBIAR_FECHA_EN_COLA`) del
 * change `cambiar-fecha-consulta-en-cola` — fase TDD RED. tasks.md §"TDD primero" (dominio +
 * máquina de estados).
 *
 * Trazabilidad: proposal §"Impacto por capa / Dominio"; design.md §D-1 (guarda declarativa
 * SEPARADA de `esOrigenValidoParaCambiarFecha`, semánticas distintas); spec-delta `consultas`
 * (Requirement "Cambio atómico de una fecha ya bloqueada", escenario "Guarda de origen — el
 * cambio de fecha es válido desde 2d además de 2b/2c/2v"). CLAUDE.md §Máquina de estados;
 * skill `state-machine`.
 *
 * Contrato de la guarda NUEVA:
 *   ORIGENES_CAMBIAR_FECHA_EN_COLA = [{ estado: 'consulta', subEstado: '2d' }]
 *   esOrigenCambiarFechaEnCola('consulta','2d') === true
 *   esOrigenCambiarFechaEnCola(<cualquier otro>) === false
 *
 * INVARIANTE de NO-REGRESIÓN (design.md §D-1): la guarda EXISTENTE de 2b/2c/2v
 * `esOrigenValidoParaCambiarFecha` SIGUE sin aceptar `2d` (ramas separadas: la 2d no posee
 * fila FECHA_BLOQUEADA). NO se mezcla `2d` dentro de la tabla de 2b/2c/2v.
 *
 * DOMINIO PURO (hook `no-infra-in-domain`): la guarda es una ESTRUCTURA DE DATOS, NO `if`
 * dispersos, en paralelo estricto a `ORIGENES_CAMBIAR_FECHA_BLOQUEADA`.
 *
 * RED: aún NO existen `esOrigenCambiarFechaEnCola` ni `ORIGENES_CAMBIAR_FECHA_EN_COLA` en
 * `reservas/domain/maquina-estados.ts`. La batería está en ROJO por AUSENCIA DE
 * IMPLEMENTACIÓN (símbolo inexistente). GREEN es de `backend-developer`.
 */
import {
  esOrigenCambiarFechaEnCola,
  esOrigenValidoParaCambiarFecha,
  ORIGENES_CAMBIAR_FECHA_EN_COLA,
  type EstadoReserva,
  type SubEstadoConsulta,
} from '../domain/maquina-estados';

/** Forma esperada de cada fila de la tabla declarativa de orígenes. */
interface OrigenEsperado {
  estado: EstadoReserva;
  subEstado: SubEstadoConsulta;
}

// ===========================================================================
// 1. `esOrigenCambiarFechaEnCola` acepta SOLO `consulta/2d`.
// ===========================================================================

describe('esOrigenCambiarFechaEnCola — solo consulta/2d es origen válido', () => {
  it('debe_aceptar_consulta_2d', () => {
    expect(esOrigenCambiarFechaEnCola('consulta', '2d')).toBe(true);
  });

  it.each(['2a', '2b', '2c', '2v', '2x', '2y', '2z'] as const)(
    'debe_rechazar_consulta_%s',
    (sub) => {
      expect(esOrigenCambiarFechaEnCola('consulta', sub)).toBe(false);
    },
  );

  it('debe_rechazar_subEstado_null', () => {
    expect(esOrigenCambiarFechaEnCola('consulta', null)).toBe(false);
  });

  it.each([
    'pre_reserva',
    'reserva_confirmada',
    'evento_en_curso',
    'post_evento',
    'reserva_completada',
  ] as const)('debe_rechazar_el_estado_no_consulta_%s', (estado) => {
    expect(esOrigenCambiarFechaEnCola(estado as EstadoReserva, '2d')).toBe(false);
  });
});

// ===========================================================================
// 2. La TABLA declarativa es la única fuente de verdad (no `if` dispersos).
// ===========================================================================

describe('ORIGENES_CAMBIAR_FECHA_EN_COLA — tabla declarativa exacta', () => {
  it('debe_contener_exactamente_consulta_2d', () => {
    expect(ORIGENES_CAMBIAR_FECHA_EN_COLA).toEqual<ReadonlyArray<OrigenEsperado>>([
      { estado: 'consulta', subEstado: '2d' },
    ]);
  });

  it('debe_tener_un_unico_origen', () => {
    expect(ORIGENES_CAMBIAR_FECHA_EN_COLA).toHaveLength(1);
  });
});

// ===========================================================================
// 3. NO-REGRESIÓN: la guarda de 2b/2c/2v NO acepta `2d` (ramas separadas, §D-1).
// ===========================================================================

describe('esOrigenValidoParaCambiarFecha — NO acepta 2d (rama separada de 2b/2c/2v)', () => {
  it('sigue_rechazando_consulta_2d', () => {
    expect(esOrigenValidoParaCambiarFecha('consulta', '2d')).toBe(false);
  });

  it.each(['2b', '2c', '2v'] as const)(
    'sigue_aceptando_el_origen_existente_%s',
    (sub: SubEstadoConsulta) => {
      expect(esOrigenValidoParaCambiarFecha('consulta', sub)).toBe(true);
    },
  );
});

// ===========================================================================
// 4. Las dos guardas son DISJUNTAS: ningún (estado,subEstado) las satisface a la vez.
// ===========================================================================

describe('guardas de origen de cambiar-fecha — disjuntas (2b/2c/2v ⊥ 2d)', () => {
  const subEstados: ReadonlyArray<SubEstadoConsulta> = [
    '2a',
    '2b',
    '2c',
    '2d',
    '2v',
    '2x',
    '2y',
    '2z',
  ];

  it.each(subEstados)(
    'no_debe_aceptar_%s_en_ambas_guardas_a_la_vez',
    (sub) => {
      const enBloqueo = esOrigenValidoParaCambiarFecha('consulta', sub);
      const enCola = esOrigenCambiarFechaEnCola('consulta', sub);
      expect(enBloqueo && enCola).toBe(false);
    },
  );
});

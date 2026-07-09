/**
 * TESTS del MAPA/GUARDA DE ORIGEN DECLARATIVOS de la FINALIZACIÓN MANUAL DEL EVENTO
 * (`resolverFinalizacionEvento(estado, subEstado)` + `MAPA_FINALIZACION_EVENTO`) de
 * US-034 (UC-25, "Gestor finaliza el evento") — fase TDD RED. tasks.md Fase 3: 3.1.
 *
 * Trazabilidad: US-034, spec-delta `consultas` (Requirements "Finalización manual del
 * evento — transición evento_en_curso → post_evento", "La acción de finalizar solo está
 * disponible en estado evento_en_curso", "La transición evento_en_curso → post_evento es
 * irreversible"), design.md §D-9 (guarda de ORIGEN declarativa en `maquina-estados.ts`,
 * en paralelo estricto a `resolverInicioEvento` de US-031). CLAUDE.md §Máquina de estados;
 * skill `state-machine`.
 *
 * MAPA_FINALIZACION_EVENTO (guarda de ORIGEN — sin sub-estado):
 *   { evento_en_curso, null } → { post_evento, null }
 *   (cualquier otro estado/sub-estado → no candidato: `null`, conflicto de estado)
 *
 * IRREVERSIBILIDAD: no existe transición de retorno `post_evento → evento_en_curso` en la
 * tabla declarativa; `resolverFinalizacionEvento('post_evento', …)` devuelve `null`.
 *
 * DOMINIO PURO (hook `no-infra-in-domain`): la guarda es una ESTRUCTURA DE DATOS. No se
 * importa `@nestjs/*`, Prisma ni infraestructura — SOLO el módulo de dominio
 * `reservas/domain/maquina-estados.ts`. La guarda se re-evalúa DENTRO de la transacción
 * bajo `SELECT … FOR UPDATE` de la fila RESERVA (base de la idempotencia y de la
 * concurrencia de doble finalización), por eso es pura y re-evaluable.
 *
 * RED: aún NO existen `resolverFinalizacionEvento`, `MAPA_FINALIZACION_EVENTO` ni
 * `ResultadoFinalizacionEvento` en `reservas/domain/maquina-estados.ts`. La batería está
 * en ROJO por AUSENCIA DE IMPLEMENTACIÓN (símbolo inexistente). GREEN es de
 * `backend-developer`.
 */
import {
  resolverFinalizacionEvento,
  MAPA_FINALIZACION_EVENTO,
  type EstadoReserva,
  type SubEstadoConsulta,
  type ResultadoFinalizacionEvento,
} from '../domain/maquina-estados';

// ===========================================================================
// 1. Origen ÚNICO candidato: `evento_en_curso` (sub_estado NULL) → `post_evento`.
//    spec-delta: "evento_en_curso → post_evento" (guarda de origen, incondicional
//    respecto a la fianza y al email).
// ===========================================================================

describe('resolverFinalizacionEvento — evento_en_curso finaliza a post_evento', () => {
  it('debe_resolver_evento_en_curso_a_post_evento_con_sub_estado_null', () => {
    const destino = resolverFinalizacionEvento('evento_en_curso', null);
    expect(destino).toEqual<ResultadoFinalizacionEvento>({
      estado: 'post_evento',
      subEstado: null,
    });
  });
});

// ===========================================================================
// 2. Guarda de disponibilidad de la acción: SOLO en `evento_en_curso`. Cualquier otro
//    estado principal → null (conflicto de estado). Incluye explícitamente `post_evento`
//    (segunda finalización) y `reserva_confirmada` (estado previo típico).
//    spec-delta: "La acción de finalizar solo está disponible en estado evento_en_curso".
// ===========================================================================

describe('resolverFinalizacionEvento — el resto de estados principales NO son candidatos (null)', () => {
  const noCandidatos: ReadonlyArray<EstadoReserva> = [
    'consulta',
    'pre_reserva',
    'reserva_confirmada',
    'post_evento',
    'reserva_completada',
    'reserva_cancelada',
  ];

  it.each(noCandidatos)(
    'no_debe_finalizar_el_estado_%s_devolviendo_null',
    (estado) => {
      expect(resolverFinalizacionEvento(estado, null)).toBeNull();
    },
  );

  it('no_debe_finalizar_evento_en_curso_con_un_sub_estado_espurio_caso_defensivo', () => {
    // La guarda es ESTRICTA en (estado, subEstado): evento_en_curso solo es origen con
    // sub_estado NULL. Un sub-estado presente (dato inconsistente) NO es candidato.
    expect(resolverFinalizacionEvento('evento_en_curso', '2b')).toBeNull();
  });
});

// ===========================================================================
// 3. Sub-estados de consulta: NUNCA finalizan evento (el filtro por estado los excluye
//    antes que el sub-estado). Ninguno es candidato.
// ===========================================================================

describe('resolverFinalizacionEvento — sub-estados de consulta NO finalizan evento (null)', () => {
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
    'no_debe_finalizar_consulta_%s_devolviendo_null',
    (subEstado) => {
      expect(resolverFinalizacionEvento('consulta', subEstado)).toBeNull();
    },
  );
});

// ===========================================================================
// 4. IRREVERSIBILIDAD (spec-delta: "La transición evento_en_curso → post_evento es
//    irreversible"): NO existe ninguna arista de retorno post_evento → evento_en_curso
//    en la tabla declarativa. Se comprueba (a) que resolver desde post_evento es null y
//    (b) que NINGUNA entrada del mapa produce un destino evento_en_curso.
// ===========================================================================

describe('resolverFinalizacionEvento — irreversibilidad: sin camino de retorno a evento_en_curso', () => {
  it('no_debe_existir_transicion_de_vuelta_desde_post_evento', () => {
    expect(resolverFinalizacionEvento('post_evento', null)).toBeNull();
  });

  it('ninguna_arista_de_la_tabla_declarativa_devuelve_a_evento_en_curso', () => {
    const devuelveAEventoEnCurso = MAPA_FINALIZACION_EVENTO.some(
      (t) => t.destino.estado === 'evento_en_curso',
    );
    expect(devuelveAEventoEnCurso).toBe(false);
  });
});

// ===========================================================================
// 5. La resolución es un LOOKUP en tabla declarativa (skill `state-machine`), no
//    condicionales dispersos: una sola entrada en el mapa, función pura y determinista.
// ===========================================================================

describe('resolverFinalizacionEvento — determinismo y forma de la tabla declarativa', () => {
  it('debe_ser_determinista_para_la_misma_entrada', () => {
    const a = resolverFinalizacionEvento('evento_en_curso', null);
    const b = resolverFinalizacionEvento('evento_en_curso', null);
    expect(a).toEqual(b);
  });

  it('debe_declarar_una_sola_arista_evento_en_curso_a_post_evento', () => {
    // La única transición de la finalización de evento vive en la TABLA (no en `if`s):
    // un solo origen candidato con su único destino.
    expect(MAPA_FINALIZACION_EVENTO).toHaveLength(1);
    expect(MAPA_FINALIZACION_EVENTO[0]).toEqual({
      origen: { estado: 'evento_en_curso', subEstado: null },
      destino: { estado: 'post_evento', subEstado: null },
    });
  });
});

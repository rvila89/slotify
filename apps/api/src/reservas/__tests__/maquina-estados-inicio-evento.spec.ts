/**
 * TESTS del MAPA/GUARDA DE ORIGEN DECLARATIVOS del INICIO AUTOMÁTICO DE EVENTO en T-0
 * (`resolverInicioEvento(estado, subEstado)` + `MAPA_INICIO_EVENTO`) de US-031
 * (UC-23, "Sistema transiciona reserva a evento en curso") — fase TDD RED.
 * tasks.md Fase 3: 3.1.
 *
 * Trazabilidad: US-031, spec-delta `consultas` (Requirement "Transición atómica a
 * evento_en_curso solo con las tres precondiciones cumplidas"; "Filtro estricto por
 * estado y fecha — solo reserva_confirmada con fecha_evento hoy"), design.md §D-3
 * (transición modelada como TABLA DE DATOS en `maquina-estados.ts`, NO `if` dispersos;
 * una función pura consulta el mapa y devuelve el destino o `null` si no es candidato).
 * CLAUDE.md §Máquina de estados; skill `state-machine`.
 *
 * MAPA_INICIO_EVENTO (guarda de ORIGEN — sin sub-estado):
 *   { reserva_confirmada, null } → { evento_en_curso, null }
 *   (cualquier otro estado/sub-estado → no candidato: `null`, no-op)
 *
 * DOMINIO PURO (hook `no-infra-in-domain`): la guarda es una ESTRUCTURA DE DATOS. No se
 * importa `@nestjs/*`, Prisma ni infraestructura — SOLO el módulo de dominio
 * `reservas/domain/maquina-estados.ts`. La guarda se re-evalúa DENTRO de la transacción
 * de cada RESERVA (base de la idempotencia y de RC-1/RC-2), por eso es pura y
 * re-evaluable. Es la guarda de ORIGEN de la transición; las TRES precondiciones se
 * evalúan aparte (`preconditionesEventoCumplidas`, test 3.2).
 *
 * RED: aún NO existen `resolverInicioEvento`, `MAPA_INICIO_EVENTO` ni
 * `ResultadoInicioEvento` en `reservas/domain/maquina-estados.ts`. La batería está en
 * ROJO por AUSENCIA DE IMPLEMENTACIÓN (símbolo inexistente). GREEN es de
 * `backend-developer`.
 */
import {
  resolverInicioEvento,
  MAPA_INICIO_EVENTO,
  type EstadoReserva,
  type SubEstadoConsulta,
  type ResultadoInicioEvento,
} from '../domain/maquina-estados';

// ===========================================================================
// 1. Origen ÚNICO candidato: `reserva_confirmada` (sub_estado NULL) → `evento_en_curso`.
//    spec-delta: "reserva_confirmada → evento_en_curso" (guarda de origen).
// ===========================================================================

describe('resolverInicioEvento — reserva_confirmada inicia a evento_en_curso', () => {
  it('debe_resolver_reserva_confirmada_a_evento_en_curso_con_sub_estado_null', () => {
    const destino = resolverInicioEvento('reserva_confirmada', null);
    expect(destino).toEqual<ResultadoInicioEvento>({
      estado: 'evento_en_curso',
      subEstado: null,
    });
  });
});

// ===========================================================================
// 2. Filtro ESTRICTO por estado: cualquier otro estado principal → null (no candidato),
//    aunque su fecha_evento fuera hoy. Solo `reserva_confirmada` es origen legal.
//    spec-delta: "RESERVA en otro estado con fecha_evento hoy no se transiciona".
// ===========================================================================

describe('resolverInicioEvento — el resto de estados principales NO son candidatos (null)', () => {
  const noCandidatos: ReadonlyArray<EstadoReserva> = [
    'consulta',
    'pre_reserva',
    'evento_en_curso',
    'post_evento',
    'reserva_completada',
    'reserva_cancelada',
  ];

  it.each(noCandidatos)(
    'no_debe_iniciar_el_estado_%s_devolviendo_null',
    (estado) => {
      expect(resolverInicioEvento(estado, null)).toBeNull();
    },
  );

  it('no_debe_iniciar_reserva_confirmada_con_un_sub_estado_espurio_caso_defensivo', () => {
    // La guarda es ESTRICTA en (estado, subEstado): reserva_confirmada solo es origen
    // con sub_estado NULL. Un sub-estado presente (dato inconsistente) NO es candidato.
    expect(resolverInicioEvento('reserva_confirmada', '2b')).toBeNull();
  });
});

// ===========================================================================
// 3. Sub-estados de consulta con fecha_evento hoy: NO son candidatos (el filtro por
//    estado los excluye antes que el sub-estado). Ninguno inicia evento.
// ===========================================================================

describe('resolverInicioEvento — sub-estados de consulta NO inician evento (null)', () => {
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
    'no_debe_iniciar_consulta_%s_devolviendo_null',
    (subEstado) => {
      expect(resolverInicioEvento('consulta', subEstado)).toBeNull();
    },
  );
});

// ===========================================================================
// 4. La resolución es un LOOKUP en tabla declarativa (skill `state-machine`), no
//    condicionales dispersos: una sola entrada en el mapa, función pura y determinista.
// ===========================================================================

describe('resolverInicioEvento — determinismo y forma de la tabla declarativa', () => {
  it('debe_ser_determinista_para_la_misma_entrada', () => {
    const a = resolverInicioEvento('reserva_confirmada', null);
    const b = resolverInicioEvento('reserva_confirmada', null);
    expect(a).toEqual(b);
  });

  it('debe_declarar_una_sola_arista_reserva_confirmada_a_evento_en_curso', () => {
    // La única transición del inicio de evento vive en la TABLA (no en `if`s): un solo
    // origen candidato con su único destino.
    expect(MAPA_INICIO_EVENTO).toHaveLength(1);
    expect(MAPA_INICIO_EVENTO[0]).toEqual({
      origen: { estado: 'reserva_confirmada', subEstado: null },
      destino: { estado: 'evento_en_curso', subEstado: null },
    });
  });
});

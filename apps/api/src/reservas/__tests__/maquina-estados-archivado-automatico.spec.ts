/**
 * TESTS del MAPA/GUARDA DE ORIGEN DECLARATIVOS del ARCHIVADO AUTOMÁTICO en T+7d
 * (`resolverArchivadoAutomatico(estado, subEstado)` + `MAPA_ARCHIVADO_AUTOMATICO`) de
 * US-037 (UC-28, "Sistema archiva la reserva a reserva_completada") — fase TDD RED.
 * tasks.md Fase 4: 4.1.
 *
 * Trazabilidad: US-037, spec-delta `consultas` (Requirements "Transición atómica a
 * reserva_completada solo con la guarda de fianza resuelta"; "Filtro estricto por estado
 * y antigüedad — solo post_evento con ≥ 7 días naturales"), design.md §D-6 (transición
 * modelada como TABLA DE DATOS en `maquina-estados.ts`, NO `if` dispersos; una función
 * pura consulta el mapa y devuelve el destino o `null` si no es candidato; misma forma que
 * `MAPA_FINALIZACION_EVENTO` de US-034 y `MAPA_INICIO_EVENTO` de US-031). CLAUDE.md
 * §Máquina de estados; skill `state-machine`.
 *
 * MAPA_ARCHIVADO_AUTOMATICO (guarda de ORIGEN — sin sub-estado):
 *   { post_evento, null } → { reserva_completada, null }
 *   (cualquier otro estado/sub-estado → no candidato: `null`, no-op)
 *
 * TERMINALIDAD: `reserva_completada` es TERMINAL e INMUTABLE — no existe NINGUNA arista de
 * salida en la tabla declarativa; resolver desde `reserva_completada` devuelve `null`.
 *
 * DOMINIO PURO (hook `no-infra-in-domain`): la guarda es una ESTRUCTURA DE DATOS. No se
 * importa `@nestjs/*`, Prisma ni infraestructura — SOLO el módulo de dominio
 * `reservas/domain/maquina-estados.ts`. La guarda se re-evalúa DENTRO de la transacción de
 * cada RESERVA (base de la idempotencia y de RC-1/RC-2), por eso es pura y re-evaluable. Es
 * la guarda de ORIGEN; la guarda de fianza se evalúa aparte (`fianzaResuelta`, test 4.2).
 *
 * RED: aún NO existen `resolverArchivadoAutomatico`, `MAPA_ARCHIVADO_AUTOMATICO` ni
 * `ResultadoArchivadoAutomatico` en `reservas/domain/maquina-estados.ts`. La batería está
 * en ROJO por AUSENCIA DE IMPLEMENTACIÓN (símbolo inexistente). GREEN es de
 * `backend-developer`.
 */
import {
  resolverArchivadoAutomatico,
  MAPA_ARCHIVADO_AUTOMATICO,
  type EstadoReserva,
  type SubEstadoConsulta,
  type ResultadoArchivadoAutomatico,
} from '../domain/maquina-estados';

// ===========================================================================
// 1. Origen ÚNICO candidato: `post_evento` (sub_estado NULL) → `reserva_completada`.
//    spec-delta: "post_evento → reserva_completada" (guarda de origen).
// ===========================================================================

describe('resolverArchivadoAutomatico — post_evento archiva a reserva_completada', () => {
  it('debe_resolver_post_evento_a_reserva_completada_con_sub_estado_null', () => {
    const destino = resolverArchivadoAutomatico('post_evento', null);
    expect(destino).toEqual<ResultadoArchivadoAutomatico>({
      estado: 'reserva_completada',
      subEstado: null,
    });
  });
});

// ===========================================================================
// 2. Filtro ESTRICTO por estado: cualquier otro estado principal → null (no candidato),
//    aunque llevara ≥ 7 días. Solo `post_evento` es origen legal.
//    spec-delta: "RESERVA en otro estado no se archiva".
// ===========================================================================

describe('resolverArchivadoAutomatico — el resto de estados principales NO son candidatos (null)', () => {
  const noCandidatos: ReadonlyArray<EstadoReserva> = [
    'consulta',
    'pre_reserva',
    'reserva_confirmada',
    'evento_en_curso',
    'reserva_completada',
    'reserva_cancelada',
  ];

  it.each(noCandidatos)(
    'no_debe_archivar_el_estado_%s_devolviendo_null',
    (estado) => {
      expect(resolverArchivadoAutomatico(estado, null)).toBeNull();
    },
  );

  it('no_debe_archivar_post_evento_con_un_sub_estado_espurio_caso_defensivo', () => {
    // La guarda es ESTRICTA en (estado, subEstado): post_evento solo es origen con
    // sub_estado NULL. Un sub-estado presente (dato inconsistente) NO es candidato.
    expect(resolverArchivadoAutomatico('post_evento', '2b')).toBeNull();
  });
});

// ===========================================================================
// 3. Sub-estados de consulta: NUNCA archivan (el filtro por estado los excluye antes que
//    el sub-estado). Ninguno es candidato.
// ===========================================================================

describe('resolverArchivadoAutomatico — sub-estados de consulta NO archivan (null)', () => {
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
    'no_debe_archivar_consulta_%s_devolviendo_null',
    (subEstado) => {
      expect(resolverArchivadoAutomatico('consulta', subEstado)).toBeNull();
    },
  );
});

// ===========================================================================
// 4. TERMINALIDAD de reserva_completada (spec-delta: "reserva_completada es TERMINAL e
//    inmutable: no existe transición de salida"): NO hay NINGUNA arista de salida en la
//    tabla declarativa. Se comprueba (a) que resolver desde reserva_completada es null
//    (idempotencia bajo lock: un segundo pase ve reserva_completada y no muta) y (b) que
//    NINGUNA entrada del mapa tiene reserva_completada como ORIGEN.
// ===========================================================================

describe('resolverArchivadoAutomatico — reserva_completada es terminal (sin salida)', () => {
  it('no_debe_existir_transicion_de_salida_desde_reserva_completada', () => {
    expect(resolverArchivadoAutomatico('reserva_completada', null)).toBeNull();
  });

  it('ninguna_arista_de_la_tabla_declarativa_tiene_reserva_completada_como_origen', () => {
    const tieneSalidaDeCompletada = MAPA_ARCHIVADO_AUTOMATICO.some(
      (t) => t.origen.estado === 'reserva_completada',
    );
    expect(tieneSalidaDeCompletada).toBe(false);
  });
});

// ===========================================================================
// 5. La resolución es un LOOKUP en tabla declarativa (skill `state-machine`), no
//    condicionales dispersos: una sola entrada en el mapa, función pura y determinista.
// ===========================================================================

describe('resolverArchivadoAutomatico — determinismo y forma de la tabla declarativa', () => {
  it('debe_ser_determinista_para_la_misma_entrada', () => {
    const a = resolverArchivadoAutomatico('post_evento', null);
    const b = resolverArchivadoAutomatico('post_evento', null);
    expect(a).toEqual(b);
  });

  it('debe_declarar_una_sola_arista_post_evento_a_reserva_completada', () => {
    // La única transición del archivado automático vive en la TABLA (no en `if`s): un
    // solo origen candidato con su único destino.
    expect(MAPA_ARCHIVADO_AUTOMATICO).toHaveLength(1);
    expect(MAPA_ARCHIVADO_AUTOMATICO[0]).toEqual({
      origen: { estado: 'post_evento', subEstado: null },
      destino: { estado: 'reserva_completada', subEstado: null },
    });
  });
});

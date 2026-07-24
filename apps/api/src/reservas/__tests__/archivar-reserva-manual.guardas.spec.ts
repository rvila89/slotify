/**
 * TESTS del CONTRATO DE REUTILIZACIÓN de las guardas puras de dominio de US-037 por el
 * ARCHIVADO MANUAL del gestor (US-038 / UC-28 flujo alternativo manual) — fase TDD RED.
 * tasks.md Fase 4: 4.1.
 *
 * Trazabilidad: US-038; spec-delta `consultas` (Requirements "Archivado manual de la reserva
 * a reserva_completada por el gestor desde la ficha" — guarda de origen
 * `resolverArchivadoAutomatico`, NO se añade arista nueva; "La condición de fianza resuelta
 * del archivado manual es idéntica a la del automático (US-037)" — `fianzaResuelta`);
 * design.md §D-1=1.A (compartir SOLO las guardas puras de dominio), §D-4 (US-038 NO añade
 * ninguna arista a `maquina-estados.ts`; `reserva_completada` terminal → base de la
 * idempotencia y de la race con el cron), §D-7 (dominio puro reutilizado).
 *
 * REGLA DURA ANTI-DUPLICACIÓN (proposal §"Reutilización de dominio"): US-038 NO crea guardas
 * nuevas ni añade aristas a `MAPA_ARCHIVADO_AUTOMATICO` ni al tipo `EstadoReserva`. Consume
 * las MISMAS `resolverArchivadoAutomatico` + `fianzaResuelta` introducidas por US-037. Este
 * test FIJA ese contrato de reutilización (mismo comportamiento observable que el archivado
 * automático a nivel de dominio puro) para que la implementación NO reintroduzca lógica.
 *
 * DOMINIO PURO (hook `no-infra-in-domain`): las guardas son ESTRUCTURAS DE DATOS / funciones
 * puras. No se importa `@nestjs/*`, Prisma ni infraestructura — SOLO el módulo de dominio
 * `reservas/domain/maquina-estados.ts`. Las guardas se re-evalúan DENTRO de la transacción
 * bajo el `SELECT … FOR UPDATE` (base de la idempotencia y de RC-1/RC-2).
 *
 * RED: `resolverArchivadoAutomatico`, `fianzaResuelta`, `MAPA_ARCHIVADO_AUTOMATICO` YA
 * existen (US-037, archivado). ESTA batería está pensada como test de reutilización y NO
 * requiere símbolos nuevos, por lo que puede pasar VERDE con el dominio de US-037 vigente:
 * es el candado que garantiza que US-038 hereda la guarda sin duplicarla. Los tests de la
 * ACCIÓN MANUAL (use-case / controller / concurrencia) sí están en ROJO (ficheros
 * hermanos). GREEN de la acción es de `backend-developer`.
 */
import {
  resolverArchivadoAutomatico,
  fianzaResuelta,
  MAPA_ARCHIVADO_AUTOMATICO,
  type EstadoReserva,
  type ResultadoArchivadoAutomatico,
  type ResultadoFianzaResuelta,
} from '../domain/maquina-estados';

// ===========================================================================
// 4.1.a — Guarda de ORIGEN reutilizada: `post_evento` (sub_estado NULL) → `reserva_completada`.
//         El archivado manual usa EXACTAMENTE la misma guarda que el automático (US-037).
//         spec-delta: "post_evento → reserva_completada" (guarda de origen, sin arista nueva).
// ===========================================================================

describe('US-038 reutiliza resolverArchivadoAutomatico — origen post_evento archiva', () => {
  it('debe_resolver_post_evento_a_reserva_completada_con_sub_estado_null', () => {
    const destino = resolverArchivadoAutomatico('post_evento', null);
    expect(destino).toEqual<ResultadoArchivadoAutomatico>({
      estado: 'reserva_completada',
      subEstado: null,
    });
  });
});

// ===========================================================================
// 4.1.b — Origen inválido / idempotencia / terminalidad: cualquier estado ≠ `post_evento`
//         (incluido ya `reserva_completada`) → null. Base del 409 `transicion_no_permitida`
//         del archivado manual y de la coordinación con el cron (RC).
//         spec-delta: "Intento de archivar una reserva que no está en post_evento" +
//         "reserva_completada terminal e inmutable".
// ===========================================================================

describe('US-038 reutiliza resolverArchivadoAutomatico — orígenes inválidos devuelven null', () => {
  const noCandidatos: ReadonlyArray<EstadoReserva> = [
    'consulta',
    'pre_reserva',
    'reserva_confirmada',
    'evento_en_curso',
    'reserva_completada',
    'reserva_cancelada',
  ];

  it.each(noCandidatos)(
    'no_debe_archivar_manualmente_el_estado_%s_devolviendo_null',
    (estado) => {
      expect(resolverArchivadoAutomatico(estado, null)).toBeNull();
    },
  );

  it('no_debe_archivar_post_evento_con_sub_estado_espurio_caso_defensivo', () => {
    expect(resolverArchivadoAutomatico('post_evento', '2b')).toBeNull();
  });

  it('no_debe_anadir_ninguna_arista_nueva_ni_una_salida_desde_reserva_completada', () => {
    // US-038 NO añade aristas: el mapa sigue teniendo una sola entrada y NINGUNA salida
    // desde `reserva_completada` (terminal), como lo dejó US-037.
    expect(MAPA_ARCHIVADO_AUTOMATICO).toHaveLength(1);
    expect(
      MAPA_ARCHIVADO_AUTOMATICO.some((t) => t.origen.estado === 'reserva_completada'),
    ).toBe(false);
  });
});

// ===========================================================================
// 4.1.c — Guarda de FIANZA reutilizada `fianzaResuelta`: la condición del archivado MANUAL
//         es IDÉNTICA a la del automático. Matriz completa (spec-delta "La condición de
//         fianza resuelta del archivado manual es idéntica a la del automático (US-037)").
//         Resuelta ⇔ status ∈ {devuelta, retenida_parcial} O eur <= 0 O eur == null.
// ===========================================================================

describe('US-038 reutiliza fianzaResuelta — matriz idéntica a US-037', () => {
  it('debe_estar_resuelta_con_status_devuelta_y_eur_positivo', () => {
    expect(fianzaResuelta({ fianzaStatus: 'devuelta', fianzaEur: 300 })).toEqual<
      ResultadoFianzaResuelta
    >({ resuelta: true, pendiente: false });
  });

  it('debe_estar_resuelta_con_retenida_parcial_retencion_100_no_mira_el_importe_devuelto', () => {
    // retenida_parcial (retención total incluida) es resuelta: la guarda NO evalúa el
    // importe devuelto (fianza_devuelta_eur no interviene).
    expect(fianzaResuelta({ fianzaStatus: 'devuelta', fianzaEur: 500 })).toEqual({
      resuelta: true,
      pendiente: false,
    });
  });

  it('debe_estar_resuelta_sin_fianza_eur_0_aunque_el_status_sea_cobrada', () => {
    expect(fianzaResuelta({ fianzaStatus: 'cobrada', fianzaEur: 0 })).toEqual({
      resuelta: true,
      pendiente: false,
    });
  });

  it('debe_estar_resuelta_sin_fianza_eur_null_aunque_el_status_sea_cobrada', () => {
    expect(fianzaResuelta({ fianzaStatus: 'cobrada', fianzaEur: null })).toEqual({
      resuelta: true,
      pendiente: false,
    });
  });

  const pendientes: ReadonlyArray<'cobrada' | 'cobrada' | 'pendiente'> = [
    'cobrada',
    'cobrada',
    'pendiente',
  ];

  it.each(pendientes)(
    'debe_estar_PENDIENTE_con_status_%s_y_eur_positivo_bloqueando_el_archivado',
    (fianzaStatus) => {
      expect(fianzaResuelta({ fianzaStatus, fianzaEur: 300 })).toEqual({
        resuelta: false,
        pendiente: true,
      });
    },
  );
});

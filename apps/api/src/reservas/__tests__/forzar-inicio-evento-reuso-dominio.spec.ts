/**
 * TESTS de REUTILIZACIÓN de las guardas de dominio de US-031 por el FORZADO MANUAL del
 * inicio de evento (US-032 / UC-23 FA-01) — fase TDD RED. tasks.md Fase 3: 3.2.
 *
 * Trazabilidad: US-032, spec-delta `consultas` (Requirement "Forzado manual del inicio
 * de evento por el Gestor — transición reserva_confirmada → evento_en_curso": «SHALL
 * reutilizar la misma guarda de origen declarativa que el inicio automático de US-031
 * (`resolverInicioEvento`); la única diferencia es que fuerza la transición con
 * independencia de si las tres precondiciones se cumplen»), design.md §D-1/§D-7.
 *
 * REGRESIÓN CERO de US-031: US-032 NO añade tabla ni arista nueva a la máquina de estados
 * (el destino es el mismo `evento_en_curso`) y NO redefine `MAPA_INICIO_EVENTO` ni las
 * precondiciones. Estos tests fijan ese contrato de reutilización:
 *   - `resolverInicioEvento('reserva_confirmada', null)` sigue dando `evento_en_curso` y
 *     el mapa sigue teniendo UNA sola arista (la de US-031, sin duplicados por US-032).
 *   - `preconditionesEventoCumplidas` sigue devolviendo `{ cumple, faltantes }` con los
 *     mismos tres `*_status`; US-032 la usa para PERSISTIR `faltantes` en el AUDIT_LOG,
 *     no para vetar la transición.
 *
 * DOMINIO PURO (hook `no-infra-in-domain`): SOLO se importa el módulo de dominio. Como los
 * símbolos `resolverInicioEvento`/`preconditionesEventoCumplidas` YA existen (US-031),
 * este fichero NO está en rojo por ellos: su función es blindar la reutilización. Está en
 * la batería RED de US-032 porque tanto este slice como el resto exigen que la
 * implementación de US-032 (use-case/adaptador) NO toque la máquina de US-031.
 */
import {
  resolverInicioEvento,
  preconditionesEventoCumplidas,
  MAPA_INICIO_EVENTO,
  type ResultadoInicioEvento,
} from '../domain/maquina-estados';

// ===========================================================================
// 1. Guarda de ORIGEN reutilizada: única arista reserva_confirmada → evento_en_curso.
//    US-032 usa la MISMA guarda; no añade orígenes ni destinos nuevos.
// ===========================================================================

describe('US-032 reutiliza la guarda de origen de US-031 (resolverInicioEvento)', () => {
  it('debe_seguir_resolviendo_reserva_confirmada_a_evento_en_curso', () => {
    expect(resolverInicioEvento('reserva_confirmada', null)).toEqual<ResultadoInicioEvento>({
      estado: 'evento_en_curso',
      subEstado: null,
    });
  });

  it('debe_mantener_una_sola_arista_en_el_mapa_sin_aristas_nuevas_de_us032', () => {
    // US-032 NO añade tabla ni arista: el destino es el mismo `evento_en_curso`.
    expect(MAPA_INICIO_EVENTO).toHaveLength(1);
    expect(MAPA_INICIO_EVENTO[0]).toEqual({
      origen: { estado: 'reserva_confirmada', subEstado: null },
      destino: { estado: 'evento_en_curso', subEstado: null },
    });
  });

  it('no_debe_existir_ninguna_arista_que_devuelva_a_reserva_confirmada', () => {
    const vuelveAConfirmada = MAPA_INICIO_EVENTO.some(
      (t) => t.destino.estado === 'reserva_confirmada',
    );
    expect(vuelveAConfirmada).toBe(false);
  });
});

// ===========================================================================
// 2. Guarda de PRECONDICIONES reutilizada: US-032 la usa para PERSISTIR `faltantes`, no
//    para vetar. Se comprueba que sigue nombrando los mismos tres `*_status`.
// ===========================================================================

describe('US-032 reutiliza preconditionesEventoCumplidas de US-031 (para el audit log)', () => {
  it('debe_devolver_cumple_true_y_faltantes_vacio_con_las_tres_a_su_valor', () => {
    const r = preconditionesEventoCumplidas({
      preEventoStatus: 'cerrado',
      liquidacionStatus: 'cobrada',
      fianzaStatus: 'cobrada',
    });
    expect(r).toEqual({ cumple: true, faltantes: [] });
  });

  it('debe_enumerar_las_precondiciones_incumplidas_por_su_nombre_de_dominio', () => {
    // fix-liquidacion-fianza-independientes (§D-4): la fianza deja de ser precondición del
    // inicio del evento. Solo quedan pre_evento_status y liquidacion_status.
    const r = preconditionesEventoCumplidas({
      preEventoStatus: 'pendiente',
      liquidacionStatus: 'facturada',
      fianzaStatus: 'pendiente',
    });
    expect(r.cumple).toBe(false);
    expect(r.faltantes).toEqual(['pre_evento_status', 'liquidacion_status']);
  });

  it('debe_enumerar_solo_la_incumplida_cuando_las_otras_dos_se_cumplen', () => {
    const r = preconditionesEventoCumplidas({
      preEventoStatus: 'cerrado',
      liquidacionStatus: 'facturada',
      fianzaStatus: 'cobrada',
    });
    expect(r.cumple).toBe(false);
    expect(r.faltantes).toEqual(['liquidacion_status']);
  });
});

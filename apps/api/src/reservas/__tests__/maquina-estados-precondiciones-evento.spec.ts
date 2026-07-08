/**
 * TESTS de la GUARDA PURA DE LAS TRES PRECONDICIONES del inicio automático de evento
 * (`preconditionesEventoCumplidas({ preEventoStatus, liquidacionStatus, fianzaStatus })`)
 * de US-031 (UC-23) — fase TDD RED. tasks.md Fase 3: 3.2.
 *
 * Trazabilidad: US-031, spec-delta `consultas` (Requirement "Transición atómica a
 * evento_en_curso solo con las tres precondiciones cumplidas": `pre_evento_status =
 * 'cerrado'` AND `liquidacion_status = 'cobrada'` AND `fianza_status = 'cobrada'`;
 * Requirement "Precondiciones incumplidas — no transiciona y alerta crítica al gestor":
 * la guarda "devuelve además QUÉ precondiciones faltan" para poblar la alerta),
 * design.md §D-3 (guarda pura de dominio, evalúa las tres en una única lectura de la
 * fila y devuelve las faltantes). CLAUDE.md §Máquina de estados; skill `state-machine`.
 *
 * DOMINIO PURO (hook `no-infra-in-domain`): función pura sobre una estructura de datos.
 * No importa `@nestjs/*`, Prisma ni infraestructura — SOLO el módulo de dominio.
 *
 * FORMA ESPERADA (D-3): `{ cumple: boolean; faltantes: string[] }` — `cumple = true`
 * solo con las tres a su valor requerido; en los casos negativos, `faltantes` enumera
 * las precondiciones incumplidas (por su nombre de dominio), sin lógica dispersa, para
 * que el use-case alimente la alerta crítica (test 3.4).
 *
 * RED: aún NO existe `preconditionesEventoCumplidas` (ni su tipo de entrada/salida) en
 * `reservas/domain/maquina-estados.ts`. La batería está en ROJO por AUSENCIA DE
 * IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import {
  preconditionesEventoCumplidas,
  type PrecondicionesEvento,
  type ResultadoPrecondicionesEvento,
} from '../domain/maquina-estados';

const cumplidas: PrecondicionesEvento = {
  preEventoStatus: 'cerrado',
  liquidacionStatus: 'cobrada',
  fianzaStatus: 'cobrada',
};

// ===========================================================================
// 1. Happy: las TRES a su valor requerido → cumple, sin faltantes.
// ===========================================================================

describe('preconditionesEventoCumplidas — las tres cumplidas', () => {
  it('debe_devolver_cumple_true_y_lista_de_faltantes_vacia', () => {
    const r = preconditionesEventoCumplidas(cumplidas);
    expect(r).toEqual<ResultadoPrecondicionesEvento>({ cumple: true, faltantes: [] });
  });
});

// ===========================================================================
// 2. Cada precondición aislada distinta de su valor → NO cumple y la enumera como
//    faltante. La guarda es un AND estricto de las tres.
//    spec-delta: "Liquidación no cobrada … enumerando la precondición incumplida".
// ===========================================================================

describe('preconditionesEventoCumplidas — una sola incumplida', () => {
  it('no_debe_cumplir_cuando_pre_evento_status_no_es_cerrado', () => {
    const r = preconditionesEventoCumplidas({ ...cumplidas, preEventoStatus: 'en_curso' });
    expect(r.cumple).toBe(false);
    expect(r.faltantes).toContain('pre_evento_status');
    expect(r.faltantes).not.toContain('liquidacion_status');
    expect(r.faltantes).not.toContain('fianza_status');
  });

  it('no_debe_cumplir_cuando_liquidacion_status_no_es_cobrada', () => {
    const r = preconditionesEventoCumplidas({ ...cumplidas, liquidacionStatus: 'facturada' });
    expect(r.cumple).toBe(false);
    expect(r.faltantes).toEqual(['liquidacion_status']);
  });

  it('no_debe_cumplir_cuando_fianza_status_no_es_cobrada', () => {
    const r = preconditionesEventoCumplidas({ ...cumplidas, fianzaStatus: 'recibo_enviado' });
    expect(r.cumple).toBe(false);
    expect(r.faltantes).toEqual(['fianza_status']);
  });
});

// ===========================================================================
// 3. Varias / todas incumplidas → NO cumple y `faltantes` las enumera TODAS (para la
//    alerta crítica con la lista completa).
// ===========================================================================

describe('preconditionesEventoCumplidas — varias incumplidas se enumeran todas', () => {
  it('debe_enumerar_las_tres_cuando_ninguna_se_cumple', () => {
    const r = preconditionesEventoCumplidas({
      preEventoStatus: 'pendiente',
      liquidacionStatus: 'pendiente',
      fianzaStatus: 'pendiente',
    });
    expect(r.cumple).toBe(false);
    expect(r.faltantes.slice().sort()).toEqual(
      ['fianza_status', 'liquidacion_status', 'pre_evento_status'].sort(),
    );
  });

  it('debe_enumerar_las_dos_incumplidas_cuando_solo_una_se_cumple', () => {
    const r = preconditionesEventoCumplidas({
      preEventoStatus: 'cerrado',
      liquidacionStatus: 'facturada',
      fianzaStatus: 'pendiente',
    });
    expect(r.cumple).toBe(false);
    expect(r.faltantes).toHaveLength(2);
    expect(r.faltantes).toEqual(expect.arrayContaining(['liquidacion_status', 'fianza_status']));
  });
});

// ===========================================================================
// 4. Función pura y determinista: misma entrada → mismo resultado, sin efectos.
// ===========================================================================

describe('preconditionesEventoCumplidas — función pura y determinista', () => {
  it('debe_ser_determinista_para_la_misma_entrada', () => {
    expect(preconditionesEventoCumplidas(cumplidas)).toEqual(
      preconditionesEventoCumplidas(cumplidas),
    );
  });
});

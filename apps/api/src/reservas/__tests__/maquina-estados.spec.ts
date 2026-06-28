/**
 * TESTS de la ENTRADA INICIAL de la máquina de estados de la RESERVA
 * (US-003 / UC-03) — fase TDD RED. tasks.md Fase 3: 3.1.
 *
 * Trazabilidad: US-003, spec-delta `consultas` (Requirement "Alta de consulta
 * exploratoria sin fecha crea una RESERVA en 2.a"), design.md §3 (estructura
 * declarativa MÍNIMA de la máquina de estados) y §2.1 (mapeo dominio `'2a'` ↔
 * literal Prisma `'s2a'`). CLAUDE.md §Máquina de estados.
 *
 * El alta de US-003 es la TRANSICIÓN DE CREACIÓN (entrada al agregado raíz
 * RESERVA): `∅ → consulta / 2a` con `ttl_expiracion = NULL`. NO es una
 * transición entre dos estados existentes (esas llegan en US-005+).
 *
 * Se ejercita:
 *   - DOMINIO PURO: la entrada inicial (`consulta`/`2a`/ttl null) y la guarda
 *     declarativa que la valida, modeladas como ESTRUCTURA DE DATOS (skill
 *     `state-machine`), sin condicionales dispersos.
 *   - INFRAESTRUCTURA (mapper puro, sin BD): el mapeo del valor de dominio `'2a'`
 *     al literal Prisma `'s2a'` (un identificador TS del enum no puede empezar
 *     por dígito), y su inverso.
 *
 * RED: aún no existen `reservas/domain/maquina-estados.ts` ni
 * `reservas/infrastructure/sub-estado-consulta.mapper.ts`; los imports fallan y
 * la batería está en ROJO. GREEN es responsabilidad de `backend-developer`.
 */
import {
  entradaInicialConsultaExploratoria,
  esEntradaInicialValida,
  type EstadoConsultaInicial,
} from '../domain/maquina-estados';
import {
  subEstadoDominioAPrisma,
  subEstadoPrismaADominio,
} from '../infrastructure/sub-estado-consulta.mapper';

// ===========================================================================
// 1. Entrada inicial del agregado: creación → consulta / 2a / ttl NULL (DOMINIO)
//    spec-delta: "crea una RESERVA con estado='consulta', sub_estado='2a' y
//    ttl_expiracion=NULL".
// ===========================================================================

describe('Máquina de estados — entrada inicial de la consulta exploratoria (2.a)', () => {
  it('debe_crear_la_entrada_inicial_en_consulta_2a_con_ttl_expiracion_null', () => {
    const entrada: EstadoConsultaInicial = entradaInicialConsultaExploratoria();

    expect(entrada.estado).toBe('consulta');
    expect(entrada.subEstado).toBe('2a');
    expect(entrada.ttlExpiracion).toBeNull();
  });

  it('debe_fijar_ttl_expiracion_estrictamente_a_null_no_a_una_fecha', () => {
    // La consulta exploratoria SIN fecha no tiene caducidad por TTL: la entrada
    // 2.a nace con ttl_expiracion = NULL (no se programa barrido en esta fase).
    const entrada = entradaInicialConsultaExploratoria();

    expect(entrada.ttlExpiracion).toBeNull();
    expect(entrada.ttlExpiracion).not.toBeInstanceOf(Date);
  });

  it('debe_aceptar_consulta_2a_como_entrada_inicial_valida', () => {
    // La guarda declarativa reconoce 2.a como punto de entrada del agregado.
    expect(esEntradaInicialValida('consulta', '2a')).toBe(true);
  });

  it('no_debe_aceptar_un_estado_distinto_de_consulta_como_entrada_inicial', () => {
    // La creación SIEMPRE entra por la fase `consulta`; nunca se nace ya en
    // pre_reserva ni en reserva_confirmada (eso exige transiciones posteriores).
    expect(esEntradaInicialValida('pre_reserva')).toBe(false);
    expect(esEntradaInicialValida('reserva_confirmada')).toBe(false);
  });

  it('no_debe_aceptar_un_sub_estado_terminal_como_entrada_inicial', () => {
    // Los sub-estados terminales (2.x/2.y/2.z) son SALIDAS, jamás entradas.
    expect(esEntradaInicialValida('consulta', '2x')).toBe(false);
  });
});

// ===========================================================================
// 2. Mapeo dominio '2a' ↔ literal Prisma 's2a' (INFRAESTRUCTURA, mapper puro)
//    design.md §2.1: el enum SubEstadoConsulta NO tiene @map, así que el literal
//    en BD/Prisma es `s2a`. Es CÓDIGO (helper de mapeo), NO una migración.
// ===========================================================================

describe('Mapper sub-estado dominio ↔ Prisma — s2a', () => {
  it('debe_mapear_el_valor_de_dominio_2a_al_literal_prisma_s2a', () => {
    expect(subEstadoDominioAPrisma('2a')).toBe('s2a');
  });

  it('debe_mapear_el_literal_prisma_s2a_de_vuelta_al_valor_de_dominio_2a', () => {
    expect(subEstadoPrismaADominio('s2a')).toBe('2a');
  });

  it('debe_ser_idempotente_en_el_viaje_de_ida_y_vuelta_para_otros_sub_estados', () => {
    // El helper es un mapeo total y reversible (prefijo 's' del enum Prisma).
    expect(subEstadoPrismaADominio(subEstadoDominioAPrisma('2b'))).toBe('2b');
    expect(subEstadoDominioAPrisma(subEstadoPrismaADominio('s2v'))).toBe('s2v');
  });
});

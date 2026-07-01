/**
 * TESTS de DOMINIO PURO: derivación del color del calendario a partir del par
 * `(estado, subEstado)` de la reserva bloqueante (US-039 / UC-29) — fase TDD RED.
 *
 * Trazabilidad: US-039 §Happy Path (código de colores canónico), spec-delta
 * `calendario` (Requirement "Vista mensual … con código de colores canónico" y
 * "evento_en_curso/post_evento heredan verde"), design.md §D-2 (tabla declarativa
 * estado/sub_estado → color, herencia del verde, exclusión de terminales),
 * SlotifyGeneralSpecs §11.3, contrato `ColorCalendario` (gris|ambar|verde|azul|rojo).
 *
 * Se ejercita SOLO la función pura `derivarColor`, modelada como ESTRUCTURA DE
 * DATOS declarativa (skill `state-machine`: nada de `if/else` dispersos). Sin BD,
 * sin Prisma, sin NestJS — testeable como pieza de dominio aislada (design.md §D-5).
 *
 * Regla clave: los sub-estados TERMINALES de consulta (`2x`/`2y`/`2z`) no ocupan
 * fecha (su bloqueo ya fue liberado) → `derivarColor` los EXCLUYE devolviendo
 * `null` (no aparecen como celda coloreada). Esta US es LECTURA PURA: sin tests de
 * concurrencia (US-039 §Concurrencia; las garantías de bloqueo viven en US-040).
 *
 * RED: aún NO existe `calendario/domain/derivacion-color.ts`; el import falla y la
 * batería está en ROJO POR AUSENCIA DE IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import {
  derivarColor,
  type ColorCalendario,
} from '../derivacion-color';
import type {
  EstadoReserva,
  SubEstadoConsulta,
} from '../../../reservas/domain/maquina-estados';

describe('derivarColor — DOMINIO PURO: (estado, subEstado) → ColorCalendario | null', () => {
  // -------------------------------------------------------------------------
  // 1. GRIS → consulta activa (2a, 2b, 2c, 2v). El sub-estado manda en consulta.
  //    spec-delta: "Gris → consulta activa (sub_estado 2a, 2b, 2c o 2v)".
  // -------------------------------------------------------------------------
  describe('consulta activa → gris', () => {
    it.each<SubEstadoConsulta>(['2a', '2b', '2c', '2v'])(
      'debe_derivar_gris_para_consulta_en_sub_estado_%s',
      (subEstado) => {
        expect(derivarColor('consulta', subEstado)).toBe<ColorCalendario>('gris');
      },
    );
  });

  // -------------------------------------------------------------------------
  // 2. ÁMBAR → pre_reserva. spec-delta: "Ámbar → pre_reserva".
  // -------------------------------------------------------------------------
  it('debe_derivar_ambar_para_pre_reserva', () => {
    expect(derivarColor('pre_reserva', null)).toBe<ColorCalendario>('ambar');
  });

  // -------------------------------------------------------------------------
  // 3. VERDE → reserva_confirmada / evento_en_curso / post_evento (herencia).
  //    spec-delta: "evento_en_curso y post_evento heredan el verde de confirmada";
  //    la diferenciación de detalle solo se ve en la ficha (US-039 §Supuestos).
  // -------------------------------------------------------------------------
  describe('confirmada / en curso / post-evento → verde (herencia)', () => {
    it.each<EstadoReserva>([
      'reserva_confirmada',
      'evento_en_curso',
      'post_evento',
    ])('debe_derivar_verde_para_%s', (estado) => {
      expect(derivarColor(estado, null)).toBe<ColorCalendario>('verde');
    });
  });

  // -------------------------------------------------------------------------
  // 4. AZUL → reserva_completada (histórica). spec-delta §Histórico.
  // -------------------------------------------------------------------------
  it('debe_derivar_azul_para_reserva_completada', () => {
    expect(derivarColor('reserva_completada', null)).toBe<ColorCalendario>('azul');
  });

  // -------------------------------------------------------------------------
  // 5. ROJO → reserva_cancelada. spec-delta §Histórico.
  // -------------------------------------------------------------------------
  it('debe_derivar_rojo_para_reserva_cancelada', () => {
    expect(derivarColor('reserva_cancelada', null)).toBe<ColorCalendario>('rojo');
  });

  // -------------------------------------------------------------------------
  // 6. TERMINALES de consulta (2x/2y/2z) → null (NO aparecen): su bloqueo ya fue
  //    liberado, no son una celda coloreada. design.md §D-2; spec-delta §Histórico
  //    ("las fechas de consultas terminales aparecen sin color").
  // -------------------------------------------------------------------------
  describe('consulta terminal → null (excluida, sin color)', () => {
    it.each<SubEstadoConsulta>(['2x', '2y', '2z'])(
      'debe_excluir_devolviendo_null_para_consulta_en_sub_estado_%s',
      (subEstado) => {
        expect(derivarColor('consulta', subEstado)).toBeNull();
      },
    );
  });

  // -------------------------------------------------------------------------
  // 7. La función es PURA y TOTAL sobre el enum del contrato: solo emite los 5
  //    colores canónicos de `ColorCalendario` o `null` (nunca un valor fuera del
  //    enum). Refuerza que la tabla es la ÚNICA fuente de verdad (design.md §D-2).
  // -------------------------------------------------------------------------
  it('debe_emitir_solo_colores_del_enum_canonico_o_null', () => {
    const coloresValidos: ReadonlyArray<ColorCalendario> = [
      'gris',
      'ambar',
      'verde',
      'azul',
      'rojo',
    ];
    const casos: ReadonlyArray<[EstadoReserva, SubEstadoConsulta | null]> = [
      ['consulta', '2a'],
      ['consulta', '2b'],
      ['consulta', '2c'],
      ['consulta', '2v'],
      ['pre_reserva', null],
      ['reserva_confirmada', null],
      ['evento_en_curso', null],
      ['post_evento', null],
      ['reserva_completada', null],
      ['reserva_cancelada', null],
    ];
    for (const [estado, subEstado] of casos) {
      const color = derivarColor(estado, subEstado);
      expect(coloresValidos).toContain(color);
    }
  });
});

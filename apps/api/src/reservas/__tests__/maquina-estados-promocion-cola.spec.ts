/**
 * TESTS del MAPA/GUARDA DECLARATIVOS de PROMOCIÓN de cola
 * (`resolverPromocionCola(estado, subEstado)` + `MAPA_PROMOCION_COLA`) de US-018
 * (UC-12, A15 "Promoción automática de la primera consulta en cola") — fase TDD RED.
 * tasks.md Fase 3: 3.1 (parte declarativa).
 *
 * Trazabilidad: US-018, spec-delta `consultas` (Requirement "Promoción automática
 * FIFO del primero en cola al liberarse la fecha (A15/UC-12)" — la transición
 * `{consulta,2d} → {consulta,2b}` DEBE modelarse en la máquina de estados
 * declarativa, NO `if` dispersos); design.md §D-2 (guarda de ORIGEN ESTRICTA:
 * solo `2.d` es promovible; cualquier otro origen → `null`; mismo patrón que
 * `resolverExpiracionTtl` de US-012 §D-3). CLAUDE.md §Máquina de estados; skill
 * `state-machine`.
 *
 * MAPA_PROMOCION_COLA (origen candidato → destino promovido):
 *   { consulta, 2d } → { consulta, 2b }
 *
 * DOMINIO PURO (hook `no-infra-in-domain`): la guarda es una ESTRUCTURA DE DATOS.
 * Solo el primero en cola (`2.d`) es promovible a `2.b`; el resto de sub-estados
 * (`2a/2b/2c/2v`), los terminales (`2x/2y/2z`), y cualquier estado principal
 * distinto de `consulta` devuelven `null` (no son promovibles). La guarda se
 * evalúa DENTRO de la transacción de promoción (base de la idempotencia y de RC-1),
 * por eso es pura y re-evaluable.
 *
 * RED: aún NO existen `resolverPromocionCola`, `ResultadoPromocionCola` ni
 * `MAPA_PROMOCION_COLA` en `reservas/domain/maquina-estados.ts`. La batería está en
 * ROJO por AUSENCIA DE IMPLEMENTACIÓN (símbolo inexistente). GREEN es de
 * `backend-developer`.
 */
import {
  resolverPromocionCola,
  type EstadoReserva,
  type SubEstadoConsulta,
  type ResultadoPromocionCola,
} from '../domain/maquina-estados';

// ===========================================================================
// 1. Origen candidato ÚNICO: consulta/2d (primero en cola) → consulta/2b.
//    spec-delta: "R2 pasa a sub_estado = '2b'"; transición declarativa
//    {consulta,2d} → {consulta,2b}.
// ===========================================================================

describe('resolverPromocionCola — consulta/2d se promueve a consulta/2b', () => {
  it('debe_resolver_consulta_2d_a_consulta_2b', () => {
    const destino = resolverPromocionCola('consulta', '2d');
    expect(destino).toEqual<ResultadoPromocionCola>({
      estado: 'consulta',
      subEstado: '2b',
    });
  });
});

// ===========================================================================
// 2. Orígenes NO promovibles del resto de la fase consulta → null.
//    Solo la cola (2d) es promovible; 2a/2b/2c/2v NO lo son (ya bloquean o no
//    están en cola).
// ===========================================================================

describe('resolverPromocionCola — otros sub-estados de consulta NO se promueven (null)', () => {
  const noPromovibles: ReadonlyArray<SubEstadoConsulta> = ['2a', '2b', '2c', '2v'];

  it.each(noPromovibles)(
    'no_debe_promover_el_sub_estado_%s_devolviendo_null',
    (subEstado) => {
      expect(resolverPromocionCola('consulta', subEstado)).toBeNull();
    },
  );
});

// ===========================================================================
// 3. Terminales INMUTABLES de consulta (2x/2y/2z) → null. Una consulta ya
//    descartada/expirada NO se promueve aunque estuviera en cola.
// ===========================================================================

describe('resolverPromocionCola — terminales de consulta NO se promueven (null)', () => {
  const terminales: ReadonlyArray<SubEstadoConsulta> = ['2x', '2y', '2z'];

  it.each(terminales)(
    'no_debe_promover_el_sub_estado_terminal_%s_devolviendo_null',
    (subEstado) => {
      expect(resolverPromocionCola('consulta', subEstado)).toBeNull();
    },
  );
});

// ===========================================================================
// 4. Estados principales distintos de consulta → null (no aplica promoción de
//    cola a pre_reserva/reserva_confirmada/… ni a reservas canceladas/completadas).
// ===========================================================================

describe('resolverPromocionCola — estados no-consulta NO se promueven (null)', () => {
  const estados: ReadonlyArray<EstadoReserva> = [
    'pre_reserva',
    'reserva_confirmada',
    'evento_en_curso',
    'post_evento',
    'reserva_completada',
    'reserva_cancelada',
  ];

  it.each(estados)('no_debe_promover_el_estado_%s_devolviendo_null', (estado) => {
    expect(resolverPromocionCola(estado, null)).toBeNull();
  });

  it('no_debe_promover_una_consulta_sin_sub_estado_caso_defensivo', () => {
    expect(resolverPromocionCola('consulta', null)).toBeNull();
  });
});

// ===========================================================================
// 5. La resolución es un LOOKUP en tabla declarativa (función pura, determinista):
//    misma entrada → mismo destino; el único destino de promoción es 2b (nunca 2c/2v).
// ===========================================================================

describe('resolverPromocionCola — determinismo (función pura sobre tabla de datos)', () => {
  it('debe_ser_determinista_para_la_misma_entrada', () => {
    const a = resolverPromocionCola('consulta', '2d');
    const b = resolverPromocionCola('consulta', '2d');
    expect(a).toEqual(b);
  });

  it('el_unico_destino_de_promocion_es_2b_nunca_2c_ni_2v', () => {
    expect(resolverPromocionCola('consulta', '2d')?.subEstado).toBe('2b');
  });
});

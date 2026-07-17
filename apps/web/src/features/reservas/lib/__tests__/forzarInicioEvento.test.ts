import { describe, expect, it } from 'vitest';
import type { components } from '@/api-client';
import {
  etiquetaPrecondicionIncumplida,
  precondicionesIncumplidas,
  puedeForzarInicioEvento,
} from '../forzarInicioEvento';

type ReservaDetalle = components['schemas']['ReservaDetalle'];

/**
 * US-032 · UC-23 FA-01 — guarda de cliente (origen + fecha) y derivación de las
 * precondiciones incumplidas. Espejo de las guardas de dominio del backend
 * (`resolverInicioEvento` + `esDiaDelEvento` + `preconditionesEventoCumplidas`); el
 * backend revalida de forma defensiva (409/422).
 */
const HOY = new Date('2026-07-17T10:00:00');
const iso = (d: string) => new Date(d).toISOString();

describe('puedeForzarInicioEvento (guarda de origen + fecha)', () => {
  it('debe_habilitar_solo_en_reserva_confirmada_con_fecha_evento_hoy', () => {
    expect(puedeForzarInicioEvento('reserva_confirmada', iso('2026-07-17T18:00:00'), HOY)).toBe(true);
  });

  it('debe_ser_true_aunque_la_hora_del_evento_sea_tarde_hoy_blindaje_off_by_one_TZ', () => {
    expect(puedeForzarInicioEvento('reserva_confirmada', iso('2026-07-17T23:00:00'), HOY)).toBe(true);
  });

  it('debe_deshabilitar_si_la_fecha_es_ayer_o_manana', () => {
    expect(puedeForzarInicioEvento('reserva_confirmada', iso('2026-07-16T18:00:00'), HOY)).toBe(false);
    expect(puedeForzarInicioEvento('reserva_confirmada', iso('2026-07-18T18:00:00'), HOY)).toBe(false);
  });

  it('debe_deshabilitar_en_cualquier_estado_distinto_de_reserva_confirmada', () => {
    for (const estado of [
      'consulta',
      'pre_reserva',
      'evento_en_curso',
      'post_evento',
      'reserva_completada',
      'reserva_cancelada',
    ] as const) {
      expect(puedeForzarInicioEvento(estado, iso('2026-07-17T18:00:00'), HOY)).toBe(false);
    }
    expect(puedeForzarInicioEvento(undefined, iso('2026-07-17T18:00:00'), HOY)).toBe(false);
  });

  it('debe_deshabilitar_si_la_fecha_evento_es_nula_indefinida_o_invalida', () => {
    expect(puedeForzarInicioEvento('reserva_confirmada', null, HOY)).toBe(false);
    expect(puedeForzarInicioEvento('reserva_confirmada', undefined, HOY)).toBe(false);
    expect(puedeForzarInicioEvento('reserva_confirmada', 'no-es-fecha', HOY)).toBe(false);
  });
});

describe('precondicionesIncumplidas (derivación en cliente)', () => {
  const reserva = (over: Partial<ReservaDetalle> = {}): ReservaDetalle =>
    ({
      preEventoStatus: 'cerrado',
      liquidacionStatus: 'cobrada',
      fianzaStatus: 'cobrada',
      ...over,
    }) as ReservaDetalle;

  it('debe_devolver_vacio_cuando_las_tres_precondiciones_estan_cumplidas', () => {
    expect(precondicionesIncumplidas(reserva())).toEqual([]);
  });

  it('debe_marcar_pre_evento_cuando_no_esta_cerrado', () => {
    expect(precondicionesIncumplidas(reserva({ preEventoStatus: 'en_curso' }))).toEqual([
      'pre_evento_status',
    ]);
  });

  it('debe_marcar_liquidacion_cuando_no_esta_cobrada', () => {
    expect(precondicionesIncumplidas(reserva({ liquidacionStatus: 'facturada' }))).toEqual([
      'liquidacion_status',
    ]);
  });

  it('debe_marcar_fianza_cuando_no_esta_cobrada', () => {
    expect(precondicionesIncumplidas(reserva({ fianzaStatus: 'recibo_enviado' }))).toEqual([
      'fianza_status',
    ]);
  });

  it('debe_marcar_las_tres_en_orden_estable_cuando_ninguna_se_cumple', () => {
    expect(
      precondicionesIncumplidas(
        reserva({
          preEventoStatus: 'pendiente',
          liquidacionStatus: 'pendiente',
          fianzaStatus: 'pendiente',
        }),
      ),
    ).toEqual(['pre_evento_status', 'liquidacion_status', 'fianza_status']);
  });

  it('debe_tratar_los_status_ausentes_como_incumplidos_fail_safe', () => {
    expect(precondicionesIncumplidas({})).toEqual([
      'pre_evento_status',
      'liquidacion_status',
      'fianza_status',
    ]);
  });
});

describe('etiquetaPrecondicionIncumplida', () => {
  it('debe_traducir_las_claves_conocidas', () => {
    expect(etiquetaPrecondicionIncumplida('pre_evento_status')).toMatch(/pre-evento/i);
    expect(etiquetaPrecondicionIncumplida('liquidacion_status')).toMatch(/liquidaci/i);
    expect(etiquetaPrecondicionIncumplida('fianza_status')).toMatch(/fianza/i);
  });

  it('debe_normalizar_claves_desconocidas_fail_open', () => {
    expect(etiquetaPrecondicionIncumplida('otra_precondicion_nueva')).toBe(
      'Otra precondicion nueva',
    );
  });
});

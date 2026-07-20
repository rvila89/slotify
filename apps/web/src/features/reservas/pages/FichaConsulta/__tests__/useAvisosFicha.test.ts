/**
 * TDD-RED (change `2026-07-20-descarte-aviso-inline-ficha`): hook `useAvisosFicha`
 * que centraliza el estado de TODOS los avisos de desenlace de la Ficha de consulta.
 *
 * INVARIANTE bajo prueba: como máximo un aviso visible a la vez (el último). Al invocar
 * cualquier `mostrarX`, se limpian los demás avisos antes de fijar el suyo. `cerrar()`
 * los limpia todos.
 *
 * Este test FALLA (RED) porque `../useAvisosFicha` aún no existe → el import no resuelve.
 * El hook lo creará el `frontend-developer` en la fase de implementación.
 */
import { describe, expect, it } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useAvisosFicha } from '../useAvisosFicha';
import type { Reserva } from '../../../model/types';

const reserva = (codigo: string) => ({ codigo }) as unknown as Reserva;

describe('useAvisosFicha — como máximo un aviso visible a la vez', () => {
  it('estado_inicial_todos_los_avisos_nulos_y_email_no_enviado', () => {
    const { result } = renderHook(() => useAvisosFicha());

    expect(result.current.resultado).toBeNull();
    expect(result.current.invitados).toBeNull();
    expect(result.current.visita).toBeNull();
    expect(result.current.interesado).toBeNull();
    expect(result.current.reservaInmediata).toBeNull();
    expect(result.current.extension).toBeNull();
    expect(result.current.presupuesto).toBeNull();
    expect(result.current.edicion).toBeNull();
    expect(result.current.senal).toBeNull();
    expect(result.current.forzar).toBeNull();
    expect(result.current.finalizar).toBeNull();
    expect(result.current.descarte).toBeNull();
    expect(result.current.emailEnviado).toBe(false);
  });

  it('mostrarVisita_fija_solo_el_aviso_de_visita_y_deja_el_resto_nulo', () => {
    const { result } = renderHook(() => useAvisosFicha());
    const rA = reserva('SLO-2026-0001');

    act(() => result.current.mostrarVisita(rA));

    expect(result.current.visita).toBe(rA);
    expect(result.current.resultado).toBeNull();
    expect(result.current.descarte).toBeNull();
    expect(result.current.presupuesto).toBeNull();
    expect(result.current.emailEnviado).toBe(false);
  });

  it('mostrarDescarte_limpia_el_aviso_de_visita_previo_solo_el_ultimo_es_visible', () => {
    const { result } = renderHook(() => useAvisosFicha());
    const rA = reserva('SLO-2026-0001');
    const rB = reserva('SLO-2026-0013');

    act(() => result.current.mostrarVisita(rA));
    act(() => result.current.mostrarDescarte({ reserva: rB, tipo: 'consulta' }));

    expect(result.current.descarte).toEqual({ reserva: rB, tipo: 'consulta' });
    expect(result.current.visita).toBeNull();
  });

  it('mostrarPresupuesto_limpia_el_descarte_visible_previo', () => {
    const { result } = renderHook(() => useAvisosFicha());
    const rB = reserva('SLO-2026-0013');
    const pC = { alguna: 'respuesta-de-presupuesto' } as never;

    act(() => result.current.mostrarDescarte({ reserva: rB, tipo: 'prereserva' }));
    act(() => result.current.mostrarPresupuesto(pC));

    expect(result.current.presupuesto).toBe(pC);
    expect(result.current.descarte).toBeNull();
  });

  it('cerrar_limpia_todos_los_avisos', () => {
    const { result } = renderHook(() => useAvisosFicha());
    const rB = reserva('SLO-2026-0013');

    act(() => result.current.mostrarDescarte({ reserva: rB, tipo: 'consulta' }));
    act(() => result.current.cerrar());

    expect(result.current.descarte).toBeNull();
    expect(result.current.visita).toBeNull();
    expect(result.current.presupuesto).toBeNull();
    expect(result.current.emailEnviado).toBe(false);
  });

  it('mostrarEmailEnviado_activa_email_y_limpia_cualquier_aviso_previo', () => {
    const { result } = renderHook(() => useAvisosFicha());
    const rB = reserva('SLO-2026-0013');

    act(() => result.current.mostrarDescarte({ reserva: rB, tipo: 'consulta' }));
    act(() => result.current.mostrarEmailEnviado());

    expect(result.current.emailEnviado).toBe(true);
    expect(result.current.descarte).toBeNull();
    expect(result.current.visita).toBeNull();
  });
});

/**
 * Fase RED — US-050 · Pipeline de Reservas · helper de aforo/pax.
 *
 * Trazabilidad: US-050 §Happy Path — Kanban (fecha + aforo), §Happy Path — Listado
 * (columna Aforo); design.md D-1 (aforo = `numInvitadosFinal` con fallback a la suma
 * `numAdultosNinosMayores4 + numNinosMenores4`); tasks.md Fase 3 (helper de aforo) y
 * 5.2.
 *
 * Contrato de producción que la fase GREEN debe cumplir en
 * `@/features/reservas/lib/aforo`:
 *   - `aforoDeReserva(reserva)`: devuelve `numInvitadosFinal` si está presente;
 *     si no, la suma de `numAdultosNinosMayores4 + numNinosMenores4`; y `null`
 *     cuando no hay ningún dato de aforo (para que la UI pueda ocultar/omitir el pax).
 *
 * RED: `@/features/reservas/lib/aforo` aún no existe → import falla y la batería
 * está en ROJO por falta de implementación.
 */
import { describe, expect, it } from 'vitest';
import type { Reserva } from '../../model/types';
import { aforoDeReserva } from '../aforo';

const reserva = (over: Partial<Reserva>): Reserva =>
  ({
    idReserva: crypto.randomUUID(),
    codigo: 'SLO-2026-0001',
    clienteId: crypto.randomUUID(),
    estado: 'consulta',
    canalEntrada: 'web',
    ...over,
  }) as Reserva;

describe('aforoDeReserva — pax con fallback al desglose (D-1)', () => {
  it('debe_devolver_numInvitadosFinal_cuando_esta_presente', () => {
    const r = reserva({ numInvitadosFinal: 120, numAdultosNinosMayores4: 90, numNinosMenores4: 10 });
    expect(aforoDeReserva(r)).toBe(120);
  });

  it('debe_sumar_adultos_y_ninos_cuando_no_hay_numInvitadosFinal', () => {
    const r = reserva({
      numInvitadosFinal: null,
      numAdultosNinosMayores4: 80,
      numNinosMenores4: 15,
    });
    expect(aforoDeReserva(r)).toBe(95);
  });

  it('debe_devolver_null_cuando_no_hay_ningun_dato_de_aforo', () => {
    const r = reserva({
      numInvitadosFinal: null,
      numAdultosNinosMayores4: null,
      numNinosMenores4: null,
    });
    expect(aforoDeReserva(r)).toBeNull();
  });
});

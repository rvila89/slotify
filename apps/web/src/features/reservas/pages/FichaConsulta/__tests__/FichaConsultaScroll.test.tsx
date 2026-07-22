import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { ConfirmarPresupuestoResponse } from '@/features/presupuestos';

/**
 * 3.4 — La `FichaConsulta` hace scroll al top al confirmar el presupuesto.
 *   Change `presupuesto-confirmar-ux-e2-idioma`, workstream A — fase TDD RED.
 *
 * Trazabilidad: spec-delta `pipeline-ui` (ADDED "Scroll al top tras confirmar el
 * presupuesto en la FichaConsulta"): en el callback `onConfirmadoPresupuesto` DEBE
 * ejecutarse `window.scrollTo({ top: 0 })` para que el banner de éxito quede visible,
 * replicando el precedente vivo de `NuevaConsultaPage`.
 *
 * ESTRATEGIA: dobla `useReserva` (para no tocar la red), `react-router-dom` (params) y
 * el hijo pesado `DialogosFicha`, que aquí expone un botón que INVOCA
 * `onConfirmadoPresupuesto` con un resultado — simulando la confirmación exitosa. Se
 * espía `window.scrollTo`.
 *
 * RED: hoy `onConfirmadoPresupuesto` es directamente `setResultadoPresupuesto` (no hace
 * scroll). El `expect(scrollTo)` no se cumple → ROJO. GREEN es de `frontend-developer`.
 */
const RESERVA_ID = '11111111-1111-1111-1111-111111111111';

vi.mock('react-router-dom', () => ({
  useParams: () => ({ id: RESERVA_ID }),
}));

vi.mock('../../../api/useReserva', () => ({
  reservaQueryKey: (id: string) => ['reserva', id],
  useReserva: () => ({
    data: {
      idReserva: RESERVA_ID,
      codigo: 'R-0001',
      estado: 'consulta',
      subEstado: '2b',
      canalEntrada: 'email',
      cliente: { nombre: 'Flori', apellidos: 'Bosch', email: 'flori@example.com' },
    },
    isLoading: false,
    isError: false,
  }),
}));

// Hijos pesados neutralizados; `DialogosFicha` expone un botón que dispara el callback.
vi.mock('../components/SeccionesFicha', () => ({ SeccionesFicha: () => null }));
vi.mock('../components/AvisosFicha', () => ({ AvisosFicha: () => null }));
vi.mock('../components/DetallesEvento', () => ({ DetallesEvento: () => null }));
vi.mock('../components/AccionesConsulta', () => ({ AccionesConsulta: () => null }));
vi.mock('../components/DialogosFicha', () => ({
  DialogosFicha: ({
    onConfirmadoPresupuesto,
  }: {
    onConfirmadoPresupuesto: (r: ConfirmarPresupuestoResponse) => void;
  }) => (
    <button
      type="button"
      data-testid="disparar-confirmado"
      onClick={() => onConfirmadoPresupuesto({} as ConfirmarPresupuestoResponse)}
    >
      confirmar
    </button>
  ),
}));

import { FichaConsultaPage } from '../FichaConsultaPage';

let scrollToSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  scrollToSpy = vi.fn();
  vi.stubGlobal('scrollTo', scrollToSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe('FichaConsultaPage — scroll al confirmar el presupuesto (3.4)', () => {
  it('debe_hacer_scrollTo_top_0_al_confirmar_el_presupuesto', async () => {
    render(<FichaConsultaPage />);

    await userEvent.click(screen.getByTestId('disparar-confirmado'));

    expect(scrollToSpy).toHaveBeenCalledWith(expect.objectContaining({ top: 0 }));
  });
});

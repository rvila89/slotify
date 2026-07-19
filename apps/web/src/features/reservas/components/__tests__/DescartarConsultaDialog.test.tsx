/**
 * Confirmación de descarte desde la ficha (spec `ficha-consulta-ui`): al
 * confirmar el descarte con éxito, el diálogo DEBE mostrar el alert de éxito
 * (toast) y notificar a la página vía `onDescartado` (que en la ficha desplaza el
 * "puntero" al inicio). El toast solo se renderiza si el host `<Toaster/>` está
 * montado — por eso el test lo monta, reproduciendo el árbol real de la app.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { Toaster } from '@/components/ui/sonner';
import { DescartarConsultaDialog } from '../DescartarConsultaDialog';
import type { components } from '@/api-client';

type Reserva = components['schemas']['Reserva'];

const reservaDescartada = { codigo: 'SLO-2026-0013', subEstado: '2z' } as Reserva;

// Doble del hook de mutación: al invocar `mutate`, resuelve el `onSuccess` con la
// RESERVA ya en `2z`, como haría el 200 del backend.
vi.mock('../../api/useDescartarConsulta', () => ({
  useDescartarConsulta: () => ({
    mutate: (_vars: unknown, opts: { onSuccess: (r: Reserva) => void }) =>
      opts.onSuccess(reservaDescartada),
    reset: () => {},
    isPending: false,
    error: null,
  }),
}));

describe('DescartarConsultaDialog — alert de éxito al descartar', () => {
  it('muestra_el_toast_de_exito_y_notifica_onDescartado_al_confirmar', async () => {
    const user = userEvent.setup();
    const onDescartado = vi.fn();

    render(
      <>
        <Toaster />
        <DescartarConsultaDialog
          reservaId="r-1"
          codigo="SLO-2026-0013"
          abierto
          onAbiertoChange={() => {}}
          onDescartado={onDescartado}
        />
      </>,
    );

    await user.click(screen.getByTestId('confirmar-descartar-consulta'));

    expect(await screen.findByText(/marcada como descartada por el cliente/i)).toBeInTheDocument();
    expect(onDescartado).toHaveBeenCalledWith(reservaDescartada);
  });
});

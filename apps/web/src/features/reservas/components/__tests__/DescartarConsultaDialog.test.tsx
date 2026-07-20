/**
 * TDD-RED (change `2026-07-20-descarte-aviso-inline-ficha`): al confirmar el
 * descarte de una CONSULTA con éxito (200), el diálogo YA NO emite un toast lateral
 * de Sonner. La confirmación pasa a ser un aviso inline verde en la cabecera de la
 * ficha (`AvisoDescarte`), que la página monta a partir del callback `onDescartado`.
 *
 * Este test reemplaza la conducta anterior (spec hermano no archivado que asertaba el
 * toast). Ahora verifica: (a) NO se invoca `toast.success`; (b) SÍ se notifica
 * `onDescartado(reserva)` al éxito. FALLA (RED) mientras el diálogo siga llamando
 * `toast.success` en `onSuccess`.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { toast } from 'sonner';
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

// Espía de Sonner: el aserto clave es que `toast.success` NO se invoca.
vi.mock('sonner', () => ({
  toast: { success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));
const toastMock = toast as unknown as { success: ReturnType<typeof vi.fn> };

describe('DescartarConsultaDialog — sin toast, notifica onDescartado', () => {
  it('al_confirmar_con_exito_NO_emite_toast_success_y_notifica_onDescartado', async () => {
    const user = userEvent.setup();
    const onDescartado = vi.fn();

    render(
      <DescartarConsultaDialog
        reservaId="r-1"
        codigo="SLO-2026-0013"
        abierto
        onAbiertoChange={() => {}}
        onDescartado={onDescartado}
      />,
    );

    await user.click(screen.getByTestId('confirmar-descartar-consulta'));

    expect(toastMock.success).not.toHaveBeenCalled();
    expect(onDescartado).toHaveBeenCalledWith(reservaDescartada);
  });
});

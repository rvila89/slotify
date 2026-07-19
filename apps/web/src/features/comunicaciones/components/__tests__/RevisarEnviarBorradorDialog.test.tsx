import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'sonner';
import { RevisarEnviarBorradorDialog } from '../RevisarEnviarBorradorDialog';
import type { ComunicacionListItem } from '../../model/types';

/**
 * Envío MANUAL del borrador E1 (mejoras-detalle-consulta §D-3). Tras el éxito, la
 * mutación debe invalidar TANTO el listado de comunicaciones COMO la propia RESERVA
 * (`['reserva', id]`), para que `tieneBorradorE1Pendiente` se recalcule y las acciones
 * se desbloqueen sin recargar. Además avisa a la ficha vía `onEnviado` (que muestra el
 * banner arriba + scroll) en lugar del toast. El SDK va DOBLADO; ningún test toca red.
 */
const postMock = vi.fn();
vi.mock('@/api-client', () => ({
  apiClient: { POST: (...args: unknown[]) => postMock(...args) },
  default: { POST: (...args: unknown[]) => postMock(...args) },
}));

vi.mock('sonner', () => ({
  toast: { success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));
const toastMock = toast as unknown as {
  success: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
};

const RESERVA_ID = '11111111-1111-1111-1111-111111111111';
const ID_COM = '22222222-2222-2222-2222-222222222222';

const borrador = (): ComunicacionListItem =>
  ({
    idComunicacion: ID_COM,
    codigoEmail: 'E1',
    estado: 'borrador',
    asunto: 'Tu consulta en Slotify',
    cuerpo: 'Hola, gracias por tu consulta…',
    destinatarioEmail: 'cliente@ejemplo.com',
    accionable: true,
  }) as ComunicacionListItem;

const okEnviado = () => ({
  data: { idComunicacion: ID_COM, estado: 'enviado', fechaEnvio: '2026-07-19T10:00:00.000Z' },
  error: undefined,
  response: { status: 200 } as Response,
});

const renderDialog = (onEnviado: () => void) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries');
  render(
    <QueryClientProvider client={queryClient}>
      <RevisarEnviarBorradorDialog
        reservaId={RESERVA_ID}
        borrador={borrador()}
        abierto
        onAbiertoChange={vi.fn()}
        onEnviado={onEnviado}
      />
    </QueryClientProvider>,
  );
  return { invalidateSpy };
};

beforeEach(() => {
  postMock.mockReset();
  toastMock.success.mockReset();
  toastMock.info.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('RevisarEnviarBorradorDialog — refresco de la ficha tras envío manual', () => {
  it('al_enviar_ok_invalida_comunicaciones_y_la_reserva', async () => {
    postMock.mockResolvedValue(okEnviado());
    const { invalidateSpy } = renderDialog(vi.fn());

    await userEvent.click(screen.getByTestId('confirmar-enviar-borrador'));

    await waitFor(() =>
      expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['reserva', RESERVA_ID] }),
    );
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: ['comunicaciones', RESERVA_ID] });
  });

  it('al_enviar_ok_avisa_a_la_ficha_via_onEnviado_y_no_usa_toast_de_exito', async () => {
    postMock.mockResolvedValue(okEnviado());
    const onEnviado = vi.fn();
    renderDialog(onEnviado);

    await userEvent.click(screen.getByTestId('confirmar-enviar-borrador'));

    await waitFor(() => expect(onEnviado).toHaveBeenCalledTimes(1));
    expect(toastMock.success).not.toHaveBeenCalled();
  });
});

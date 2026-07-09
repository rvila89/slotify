import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { FinalizarEventoDialog } from '../FinalizarEventoDialog';

/**
 * US-034 · UC-25 — diálogo de confirmación "Marcar evento como finalizado". Consume
 * el SDK generado (`apiClient.POST('/reservas/{id}/finalizar-evento')`), que aquí se
 * DOBLA; ningún test toca la red. Verifica: confirmación explícita → POST; advertencia
 * NO bloqueante de documentación pendiente; 200 con `e5.resultado='fallido'` NO es un
 * error de la mutación (la reserva sí avanzó); 409 `transicion_no_permitida` → aviso
 * inline sin cerrar.
 */
const postMock = vi.fn();
vi.mock('@/api-client', () => ({
  apiClient: { POST: (...args: unknown[]) => postMock(...args) },
  default: { POST: (...args: unknown[]) => postMock(...args) },
}));

const RESERVA_ID = '11111111-1111-1111-1111-111111111111';

const ok = (resultado: 'enviado' | 'fallido' | 'no_aplica', documentacionPendiente: string[] = []) => ({
  data: {
    idReserva: RESERVA_ID,
    codigo: 'SLO-2026-0034',
    clienteId: '22222222-2222-2222-2222-222222222222',
    estado: 'post_evento',
    canalEntrada: 'web',
    e5: { resultado, comunicacionId: resultado === 'no_aplica' ? null : 'c1' },
    documentacionPendiente,
  },
  error: undefined,
  response: { status: 200 } as Response,
});

const conflicto = () => ({
  data: undefined,
  error: { code: 'transicion_no_permitida', message: 'La reserva no está en curso.' },
  response: { status: 409 } as Response,
});

const renderDialog = (props: Partial<Parameters<typeof FinalizarEventoDialog>[0]> = {}) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onFinalizado = vi.fn();
  const onAbiertoChange = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <FinalizarEventoDialog
        reservaId={RESERVA_ID}
        abierto
        onAbiertoChange={onAbiertoChange}
        onFinalizado={onFinalizado}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { onFinalizado, onAbiertoChange };
};

beforeEach(() => {
  postMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('FinalizarEventoDialog (US-034)', () => {
  it('debe_hacer_POST_al_endpoint_generado_y_devolver_la_respuesta_al_confirmar', async () => {
    postMock.mockResolvedValue(ok('enviado'));
    const { onFinalizado, onAbiertoChange } = renderDialog();

    await userEvent.click(screen.getByTestId('confirmar-finalizar-evento'));

    await waitFor(() => expect(onFinalizado).toHaveBeenCalledTimes(1));
    expect(postMock).toHaveBeenCalledWith(
      '/reservas/{id}/finalizar-evento',
      expect.objectContaining({ params: { path: { id: RESERVA_ID } } }),
    );
    expect(onFinalizado.mock.calls[0][0].e5.resultado).toBe('enviado');
    expect(onAbiertoChange).toHaveBeenCalledWith(false);
  });

  it('un_200_con_e5_fallido_NO_es_error_de_la_mutacion_la_reserva_avanzo', async () => {
    postMock.mockResolvedValue(ok('fallido'));
    const { onFinalizado } = renderDialog();

    await userEvent.click(screen.getByTestId('confirmar-finalizar-evento'));

    await waitFor(() => expect(onFinalizado).toHaveBeenCalledTimes(1));
    expect(onFinalizado.mock.calls[0][0].estado).toBe('post_evento');
    expect(screen.queryByTestId('aviso-error-finalizar-evento')).not.toBeInTheDocument();
  });

  it('debe_mostrar_la_advertencia_no_bloqueante_de_documentacion_pendiente', () => {
    renderDialog({ documentacionPendiente: ['dni_anverso'] });
    const aviso = screen.getByTestId('aviso-documentacion-pendiente');
    expect(aviso).toHaveTextContent('DNI (anverso)');
    expect(aviso).toHaveTextContent(/continuar igualmente/i);
    // No bloquea: el botón de confirmar sigue habilitado.
    expect(screen.getByTestId('confirmar-finalizar-evento')).not.toBeDisabled();
  });

  it('un_409_transicion_no_permitida_muestra_aviso_inline_sin_cerrar', async () => {
    postMock.mockResolvedValue(conflicto());
    const { onFinalizado, onAbiertoChange } = renderDialog();

    await userEvent.click(screen.getByTestId('confirmar-finalizar-evento'));

    await waitFor(() =>
      expect(screen.getByTestId('aviso-error-finalizar-evento')).toBeInTheDocument(),
    );
    expect(onFinalizado).not.toHaveBeenCalled();
    expect(onAbiertoChange).not.toHaveBeenCalledWith(false);
  });
});

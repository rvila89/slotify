import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ForzarInicioEventoDialog } from '../ForzarInicioEventoDialog';

/**
 * US-032 · UC-23 FA-01 — diálogo de "Forzar inicio del evento" con DOBLE
 * confirmación. Consume el SDK generado (`apiClient.POST('/reservas/{id}/forzar-inicio-
 * evento')`), que aquí se DOBLA; ningún test toca la red. Verifica: el POST SOLO se
 * dispara en el paso 2 (cancelar en paso 1 o 2 = no-op); enumeración de precondiciones;
 * 200 → onForzado + cierre; 409 `conflicto_estado` y 422 `fecha_evento_no_es_hoy` →
 * aviso inline sin cerrar.
 */
const postMock = vi.fn();
vi.mock('@/api-client', () => ({
  apiClient: { POST: (...args: unknown[]) => postMock(...args) },
  default: { POST: (...args: unknown[]) => postMock(...args) },
}));

const RESERVA_ID = '11111111-1111-1111-1111-111111111111';

const ok = (precondicionesIncumplidas: string[] = ['liquidacion_status']) => ({
  data: {
    idReserva: RESERVA_ID,
    codigo: 'SLO-2026-0032',
    clienteId: '22222222-2222-2222-2222-222222222222',
    estado: 'evento_en_curso',
    canalEntrada: 'web',
    forzadoPorGestor: true,
    precondicionesIncumplidas,
  },
  error: undefined,
  response: { status: 200 } as Response,
});

const conflicto = () => ({
  data: undefined,
  error: {
    code: 'conflicto_estado',
    message: 'El evento ya está en curso (iniciado automáticamente o por otro usuario).',
  },
  response: { status: 409 } as Response,
});

const fueraDeDia = () => ({
  data: undefined,
  error: { code: 'fecha_evento_no_es_hoy', message: 'Solo el día del evento.' },
  response: { status: 422 } as Response,
});

const renderDialog = (
  props: Partial<Parameters<typeof ForzarInicioEventoDialog>[0]> = {},
) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onForzado = vi.fn();
  const onAbiertoChange = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <ForzarInicioEventoDialog
        reservaId={RESERVA_ID}
        precondiciones={['liquidacion_status', 'fianza_status']}
        abierto
        onAbiertoChange={onAbiertoChange}
        onForzado={onForzado}
        {...props}
      />
    </QueryClientProvider>,
  );
  return { onForzado, onAbiertoChange };
};

const avanzarAlPaso2 = async () => {
  await userEvent.click(screen.getByTestId('continuar-forzar-inicio-evento'));
  await screen.findByTestId('confirmar-forzar-inicio-evento');
};

beforeEach(() => {
  postMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ForzarInicioEventoDialog — doble confirmación (US-032)', () => {
  it('el_paso_1_enumera_las_precondiciones_incumplidas', () => {
    renderDialog();
    const aviso = screen.getByTestId('aviso-precondiciones-incumplidas');
    expect(aviso).toHaveTextContent(/liquidaci/i);
    expect(aviso).toHaveTextContent(/fianza/i);
  });

  it('el_paso_1_no_dispara_el_POST_solo_avanza_al_paso_2', async () => {
    renderDialog();
    // En el paso 1 no existe el botón de confirmar final ni se ha llamado a la red.
    expect(screen.queryByTestId('confirmar-forzar-inicio-evento')).not.toBeInTheDocument();
    await avanzarAlPaso2();
    expect(postMock).not.toHaveBeenCalled();
  });

  it('cancelar_en_el_paso_1_es_no_op_cierra_sin_POST', async () => {
    const { onAbiertoChange } = renderDialog();
    await userEvent.click(screen.getByTestId('cancelar-forzar-inicio-evento'));
    expect(onAbiertoChange).toHaveBeenCalledWith(false);
    expect(postMock).not.toHaveBeenCalled();
  });

  it('atras_en_el_paso_2_vuelve_al_paso_1_sin_POST', async () => {
    renderDialog();
    await avanzarAlPaso2();
    await userEvent.click(screen.getByTestId('cancelar-forzar-inicio-evento'));
    // Vuelve al paso 1: el botón de confirmar final desaparece.
    await waitFor(() =>
      expect(screen.queryByTestId('confirmar-forzar-inicio-evento')).not.toBeInTheDocument(),
    );
    expect(postMock).not.toHaveBeenCalled();
  });

  it('confirmar_en_el_paso_2_dispara_el_POST_al_endpoint_generado', async () => {
    postMock.mockResolvedValue(ok());
    const { onForzado, onAbiertoChange } = renderDialog();

    await avanzarAlPaso2();
    await userEvent.click(screen.getByTestId('confirmar-forzar-inicio-evento'));

    await waitFor(() => expect(onForzado).toHaveBeenCalledTimes(1));
    expect(postMock).toHaveBeenCalledWith(
      '/reservas/{id}/forzar-inicio-evento',
      expect.objectContaining({ params: { path: { id: RESERVA_ID } }, body: {} }),
    );
    expect(onForzado.mock.calls[0][0].estado).toBe('evento_en_curso');
    expect(onForzado.mock.calls[0][0].forzadoPorGestor).toBe(true);
    expect(onAbiertoChange).toHaveBeenCalledWith(false);
  });

  it('un_409_conflicto_estado_muestra_aviso_inline_sin_cerrar', async () => {
    postMock.mockResolvedValue(conflicto());
    const { onForzado, onAbiertoChange } = renderDialog();

    await avanzarAlPaso2();
    await userEvent.click(screen.getByTestId('confirmar-forzar-inicio-evento'));

    await waitFor(() =>
      expect(screen.getByTestId('aviso-error-forzar-inicio-evento')).toHaveTextContent(
        /ya está en curso/i,
      ),
    );
    expect(onForzado).not.toHaveBeenCalled();
    expect(onAbiertoChange).not.toHaveBeenCalledWith(false);
  });

  it('un_422_fecha_evento_no_es_hoy_muestra_aviso_inline_de_defensa', async () => {
    postMock.mockResolvedValue(fueraDeDia());
    const { onForzado } = renderDialog();

    await avanzarAlPaso2();
    await userEvent.click(screen.getByTestId('confirmar-forzar-inicio-evento'));

    await waitFor(() =>
      expect(screen.getByTestId('aviso-error-forzar-inicio-evento')).toHaveTextContent(
        /día del evento/i,
      ),
    );
    expect(onForzado).not.toHaveBeenCalled();
  });
});

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AccionReenviarE3 } from '../AccionReenviarE3';

/**
 * US-023 · GAP 3 — acción "Reenviar E3". Consume el SDK generado
 * (`apiClient.POST('/reservas/{id}/facturas/senal/reenviar')`, operación `reenviarE3`), aquí
 * DOBLADO; ningún test toca la red. Verifica: 200 → toast de éxito; 409
 * `E3_NO_ENVIADO_PREVIAMENTE` → aviso inline informativo; 409 `CONDICIONES_NO_CONFIGURADAS` →
 * alerta de configurar condiciones; 502 `EMISION_ENVIO_FALLIDO` → aviso reintentable.
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
  warning: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
};

const RESERVA_ID = '11111111-1111-1111-1111-111111111111';

const ok = () => ({
  data: {
    factura: { idFactura: 'f1', estado: 'enviada' },
    comunicacion: { idComunicacion: 'c1', estado: 'enviado', esReenvio: true },
    condPartEnviadasFecha: '2026-07-15T10:00:00.000Z',
  },
  error: undefined,
  response: { status: 200 } as Response,
});

const fallo = (status: number, codigo: string) => ({
  data: undefined,
  error: { statusCode: status, codigo },
  response: { status } as Response,
});

const renderAccion = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <AccionReenviarE3 reservaId={RESERVA_ID} />
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  postMock.mockReset();
  toastMock.success.mockReset();
  toastMock.info.mockReset();
  toastMock.warning.mockReset();
  toastMock.error.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('AccionReenviarE3', () => {
  it('reenvio_ok_200_dispara_toast_de_exito', async () => {
    postMock.mockResolvedValue(ok());
    renderAccion();

    await userEvent.click(screen.getByTestId('reenviar-e3'));

    await waitFor(() => expect(toastMock.success).toHaveBeenCalledTimes(1));
    expect(postMock).toHaveBeenCalledWith('/reservas/{id}/facturas/senal/reenviar', {
      params: { path: { id: RESERVA_ID } },
    });
  });

  it('409_E3_NO_ENVIADO_PREVIAMENTE_muestra_aviso_informativo', async () => {
    postMock.mockResolvedValue(fallo(409, 'E3_NO_ENVIADO_PREVIAMENTE'));
    renderAccion();

    await userEvent.click(screen.getByTestId('reenviar-e3'));

    const aviso = await screen.findByTestId('aviso-error-reenvio-e3');
    expect(aviso).toHaveAttribute('data-error-tipo', 'no-enviado-previamente');
    expect(aviso).toHaveTextContent('No hay un E3 enviado previamente que reenviar');
    expect(toastMock.info).toHaveBeenCalledTimes(1);
  });

  it('409_CONDICIONES_NO_CONFIGURADAS_muestra_alerta_de_configurar', async () => {
    postMock.mockResolvedValue(fallo(409, 'CONDICIONES_NO_CONFIGURADAS'));
    renderAccion();

    await userEvent.click(screen.getByTestId('reenviar-e3'));

    const aviso = await screen.findByTestId('aviso-error-reenvio-e3');
    expect(aviso).toHaveAttribute('data-error-tipo', 'condiciones-no-configuradas');
    expect(aviso).toHaveTextContent('Configura las condiciones particulares');
    expect(toastMock.warning).toHaveBeenCalledTimes(1);
  });

  it('502_EMISION_ENVIO_FALLIDO_muestra_aviso_reintentable', async () => {
    postMock.mockResolvedValue(fallo(502, 'EMISION_ENVIO_FALLIDO'));
    renderAccion();

    await userEvent.click(screen.getByTestId('reenviar-e3'));

    const aviso = await screen.findByTestId('aviso-error-reenvio-e3');
    expect(aviso).toHaveAttribute('data-error-tipo', 'envio-fallido');
    expect(aviso).toHaveTextContent('Puedes volver a intentarlo');
    expect(toastMock.warning).toHaveBeenCalledTimes(1);
  });
});

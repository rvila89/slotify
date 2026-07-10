import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { IbanDevolucionCard } from '../IbanDevolucionCard';

/**
 * US-035 · UC-26/UC-27 — tarjeta "Registrar IBAN de devolución". Consume el SDK
 * generado (`apiClient.PATCH('/reservas/{id}/iban-devolucion')`), aquí DOBLADO;
 * ningún test toca la red. Verifica: 200 con `avisoEmail=null` (Happy Path) →
 * PATCH + aviso de guardado; 422 (FA-01) → error inline; precarga del IBAN existente
 * (FA-02); 200 con `avisoEmail` (FA-03) → alerta de E8 fallido + reenvío (reintenta la
 * misma mutación); validación de formato mod-97 en cliente bloquea antes de enviar.
 */
const patchMock = vi.fn();
vi.mock('@/api-client', () => ({
  apiClient: { PATCH: (...args: unknown[]) => patchMock(...args) },
  default: { PATCH: (...args: unknown[]) => patchMock(...args) },
}));

const RESERVA_ID = '11111111-1111-1111-1111-111111111111';
const IBAN_VALIDO = 'ES9121000418450200051332';

const ok = (avisoEmail: unknown = null) => ({
  data: { iban: IBAN_VALIDO, avisoEmail },
  error: undefined,
  response: { status: 200 } as Response,
});

const invalido = () => ({
  data: undefined,
  error: { statusCode: 422, message: 'El IBAN introducido no tiene un formato válido.' },
  response: { status: 422 } as Response,
});

const renderCard = (props: Partial<Parameters<typeof IbanDevolucionCard>[0]> = {}) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={queryClient}>
      <IbanDevolucionCard reservaId={RESERVA_ID} {...props} />
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  patchMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('IbanDevolucionCard (US-035)', () => {
  it('guarda_un_IBAN_valido_via_PATCH_y_muestra_el_aviso_de_guardado', async () => {
    patchMock.mockResolvedValue(ok(null));
    renderCard();

    await userEvent.type(screen.getByTestId('input-iban'), IBAN_VALIDO);
    await userEvent.click(screen.getByTestId('guardar-iban'));

    await waitFor(() => expect(screen.getByTestId('aviso-iban-guardado')).toBeInTheDocument());
    expect(patchMock).toHaveBeenCalledWith(
      '/reservas/{id}/iban-devolucion',
      expect.objectContaining({
        params: { path: { id: RESERVA_ID } },
        body: { iban: IBAN_VALIDO },
      }),
    );
  });

  it('valida_el_formato_en_cliente_y_no_envia_si_es_invalido_FA01', async () => {
    renderCard();

    await userEvent.type(screen.getByTestId('input-iban'), 'ES00INVALIDO');
    await userEvent.click(screen.getByTestId('guardar-iban'));

    await waitFor(() => expect(screen.getByTestId('error-iban')).toBeInTheDocument());
    expect(patchMock).not.toHaveBeenCalled();
  });

  it('muestra_el_error_422_del_servidor_bajo_el_campo_FA01', async () => {
    patchMock.mockResolvedValue(invalido());
    renderCard();

    await userEvent.type(screen.getByTestId('input-iban'), IBAN_VALIDO);
    await userEvent.click(screen.getByTestId('guardar-iban'));

    await waitFor(() => expect(screen.getByTestId('error-iban')).toBeInTheDocument());
    expect(patchMock).toHaveBeenCalledTimes(1);
  });

  it('precarga_el_IBAN_existente_en_correccion_FA02', () => {
    renderCard({ ibanExistente: IBAN_VALIDO });
    expect(screen.getByTestId('input-iban')).toHaveValue(IBAN_VALIDO);
  });

  it('un_200_con_avisoEmail_muestra_la_alerta_de_E8_fallido_y_permite_reenviar_FA03', async () => {
    patchMock.mockResolvedValue(
      ok({ codigo: 'e8_fallido', mensaje: 'IBAN guardado, pero E8 no pudo enviarse.', comunicacionId: 'c1' }),
    );
    renderCard();

    await userEvent.type(screen.getByTestId('input-iban'), IBAN_VALIDO);
    await userEvent.click(screen.getByTestId('guardar-iban'));

    await waitFor(() => expect(screen.getByTestId('aviso-e8-fallido')).toBeInTheDocument());
    // No se muestra el aviso de guardado "OK" cuando E8 falló.
    expect(screen.queryByTestId('aviso-iban-guardado')).not.toBeInTheDocument();

    // El reenvío reintenta la MISMA mutación con el mismo IBAN.
    patchMock.mockResolvedValue(ok(null));
    await userEvent.click(screen.getByTestId('boton-reenviar-e8'));

    await waitFor(() => expect(screen.getByTestId('aviso-iban-guardado')).toBeInTheDocument());
    expect(patchMock).toHaveBeenCalledTimes(2);
    expect(patchMock.mock.calls[1][1]).toMatchObject({ body: { iban: IBAN_VALIDO } });
  });
});

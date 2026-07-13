import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GenerarPresupuestoDialog } from '../GenerarPresupuestoDialog';

/**
 * US-014 · incidencia #5 (Parte B) — sección "Datos fiscales del cliente" inline en el
 * diálogo de presupuesto. Verifica (tasks 5.1–5.5):
 *  - precarga de los 5 campos fiscales del CLIENTE desde `GET /reservas/{id}` (cliente);
 *  - al confirmar se guarda PRIMERO vía `PATCH /reservas/{id}/datos-fiscales` (solo los
 *    campos no vacíos, D-2) y luego se confirma el presupuesto;
 *  - el bucle de resolución D-5: `DATOS_FISCALES_INCOMPLETOS` (422) del preview resalta
 *    los inputs faltantes; tras completar y guardar, la confirmación tiene éxito.
 *
 * El SDK generado (`@/api-client`) se DOBLA por completo (GET/POST/PATCH); ningún test
 * toca la red.
 */
const getMock = vi.fn();
const postMock = vi.fn();
const patchMock = vi.fn();

vi.mock('@/api-client', () => ({
  apiClient: {
    GET: (...args: unknown[]) => getMock(...args),
    POST: (...args: unknown[]) => postMock(...args),
    PATCH: (...args: unknown[]) => patchMock(...args),
  },
  default: {
    GET: (...args: unknown[]) => getMock(...args),
    POST: (...args: unknown[]) => postMock(...args),
    PATCH: (...args: unknown[]) => patchMock(...args),
  },
}));

const RESERVA_ID = '11111111-1111-1111-1111-111111111111';
const CLIENTE_ID = '22222222-2222-2222-2222-222222222222';

const reservaDetalle = (cliente: Record<string, string | null>) => ({
  data: {
    idReserva: RESERVA_ID,
    codigo: 'SLO-2026-0014',
    clienteId: CLIENTE_ID,
    estado: 'consulta',
    subEstado: '2b',
    canalEntrada: 'web',
    cliente: { idCliente: CLIENTE_ID, nombre: 'Ada', ...cliente },
  },
  error: undefined,
  response: { status: 200 } as Response,
});

const previewOk = () => ({
  data: {
    tarifaAConsultar: false,
    desglose: { baseImponibleEur: 100, ivaEur: 21, totalEur: 121 },
    reparto: {},
    extrasTotalEur: 0,
  },
  error: undefined,
  response: { status: 200 } as Response,
});

const previewDatosFiscales = (camposFaltantes: string[]) => ({
  data: undefined,
  error: {
    codigo: 'DATOS_FISCALES_INCOMPLETOS',
    message: 'Faltan datos fiscales del cliente.',
    camposFaltantes,
  },
  response: { status: 422 } as Response,
});

const confirmarOk = () => ({
  data: {
    presupuesto: { idPresupuesto: 'p1' },
    reserva: {
      idReserva: RESERVA_ID,
      codigo: 'SLO-2026-0014',
      clienteId: CLIENTE_ID,
      estado: 'pre_reserva',
      canalEntrada: 'web',
    },
    reparto: {},
    consultasDescartadas: 0,
  },
  error: undefined,
  response: { status: 201 } as Response,
});

const patchOk = (valores: Record<string, string | null>) => ({
  data: {
    dniNif: null,
    direccion: null,
    codigoPostal: null,
    poblacion: null,
    provincia: null,
    ...valores,
  },
  error: undefined,
  response: { status: 200 } as Response,
});

const renderDialog = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const onConfirmado = vi.fn();
  const onAbiertoChange = vi.fn();
  render(
    <QueryClientProvider client={queryClient}>
      <GenerarPresupuestoDialog
        reservaId={RESERVA_ID}
        abierto
        onAbiertoChange={onAbiertoChange}
        onConfirmado={onConfirmado}
      />
    </QueryClientProvider>,
  );
  return { onConfirmado, onAbiertoChange };
};

beforeEach(() => {
  getMock.mockReset();
  postMock.mockReset();
  patchMock.mockReset();
  // Los extras (GET /extras) no son relevantes aquí; solo importa GET /reservas/{id}.
  getMock.mockImplementation((path: string) => {
    if (path === '/reservas/{id}') {
      return Promise.resolve(
        reservaDetalle({
          dniNif: '12345678Z',
          direccion: 'Calle Mayor 1',
          codigoPostal: '',
          poblacion: 'Madrid',
          provincia: 'Madrid',
        }),
      );
    }
    return Promise.resolve({ data: [], error: undefined, response: { status: 200 } as Response });
  });
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('GenerarPresupuestoDialog · datos fiscales del cliente (incidencia #5)', () => {
  it('precarga_los_campos_fiscales_del_cliente_desde_la_reserva', async () => {
    postMock.mockResolvedValue(previewOk());
    renderDialog();

    await waitFor(() =>
      expect(screen.getByTestId('input-fiscal-dniNif')).toHaveValue('12345678Z'),
    );
    expect(screen.getByTestId('input-fiscal-direccion')).toHaveValue('Calle Mayor 1');
    expect(screen.getByTestId('input-fiscal-poblacion')).toHaveValue('Madrid');
    // El campo vacío en BD se precarga en blanco (no "null").
    expect(screen.getByTestId('input-fiscal-codigoPostal')).toHaveValue('');
  });

  it('al_confirmar_guarda_primero_los_datos_fiscales_PATCH_y_luego_confirma', async () => {
    postMock.mockImplementation((path: string) => {
      if (path === '/reservas/{id}/presupuesto') return Promise.resolve(confirmarOk());
      return Promise.resolve(previewOk());
    });
    patchMock.mockResolvedValue(patchOk({ codigoPostal: '28013' }));
    const { onConfirmado } = renderDialog();

    // Espera a que el preview resuelva y habilite el botón de confirmar.
    await waitFor(() =>
      expect(screen.getByTestId('confirmar-presupuesto')).not.toBeDisabled(),
    );
    await userEvent.type(screen.getByTestId('input-fiscal-codigoPostal'), '28013');
    await userEvent.click(screen.getByTestId('confirmar-presupuesto'));

    await waitFor(() => expect(onConfirmado).toHaveBeenCalledTimes(1));
    // PATCH datos-fiscales con SOLO los campos no vacíos (D-2): incluye el CP recién puesto.
    expect(patchMock).toHaveBeenCalledWith(
      '/reservas/{id}/datos-fiscales',
      expect.objectContaining({
        params: { path: { id: RESERVA_ID } },
        body: expect.objectContaining({ codigoPostal: '28013', dniNif: '12345678Z' }),
      }),
    );
    // Y después se confirma el presupuesto.
    expect(postMock).toHaveBeenCalledWith(
      '/reservas/{id}/presupuesto',
      expect.objectContaining({ params: { path: { id: RESERVA_ID } } }),
    );
  });

  it('resalta_los_campos_faltantes_al_recibir_DATOS_FISCALES_INCOMPLETOS_del_preview', async () => {
    // Cliente sin CP en BD; el preview reporta codigoPostal como faltante.
    getMock.mockImplementation((path: string) => {
      if (path === '/reservas/{id}') {
        return Promise.resolve(
          reservaDetalle({
            dniNif: '12345678Z',
            direccion: 'Calle Mayor 1',
            codigoPostal: null,
            poblacion: 'Madrid',
            provincia: 'Madrid',
          }),
        );
      }
      return Promise.resolve({ data: [], error: undefined, response: { status: 200 } as Response });
    });
    postMock.mockResolvedValue(previewDatosFiscales(['codigoPostal']));
    renderDialog();

    await waitFor(() =>
      expect(screen.getByTestId('input-fiscal-codigoPostal')).toHaveAttribute(
        'aria-invalid',
        'true',
      ),
    );
    // Se muestra el aviso de error del contrato con la lista de campos faltantes.
    const aviso = await screen.findByTestId('aviso-error-presupuesto');
    expect(within(aviso).getByTestId('lista-campos-faltantes')).toBeInTheDocument();
  });
});

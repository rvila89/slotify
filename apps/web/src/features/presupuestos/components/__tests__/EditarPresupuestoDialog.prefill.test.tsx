import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { EditarPresupuestoDialog } from '../EditarPresupuestoDialog';

/**
 * Prefill del diálogo de edición (mejora US-015 · UC-15, change
 * `presupuesto-edicion-reenvio-email-real`, D3) — fase TDD RED.
 *
 * D3: el diálogo recibe props NUEVAS con los valores de la RESERVA y pre-rellena:
 *  - "nº de invitados" con `invitadosIniciales` (= `reserva.numAdultosNinosMayores4`, el
 *    campo que el editor escribe; NO `numInvitadosFinal`, que es derivado — ver memoria
 *    "aforo/personas es campo derivado" para no repetir el bug del `___`);
 *  - "duración" con `duracionInicial` (= `reserva.duracionHoras`) ACOTADA al enum
 *    {4,8,12}; si el valor no pertenece al enum o es null/undefined → fallback '4'.
 *
 * El SDK generado (`@/api-client`) se DOBLA por completo; ningún test toca la red.
 *
 * RED: hoy `EditarPresupuestoDialog` NO acepta `invitadosIniciales`/`duracionInicial` y
 * arranca con `numInvitados: ''` y `duracionHoras: '4'` hardcodeados. El prefill no
 * ocurre y estas aserciones FALLAN por comportamiento. GREEN es de `frontend-developer`.
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

const previewOk = () => ({
  data: {
    tarifaAConsultar: false,
    desglose: { baseImponibleEur: 100, ivaEur: 21, totalEur: 121 },
    reparto: {},
    extrasTotalEur: 0,
    regimenIva: 'con_iva',
  },
  error: undefined,
  response: { status: 200 } as Response,
});

/**
 * Renderiza el diálogo con las props de prefill. `invitadosIniciales`/`duracionInicial`
 * son las props NUEVAS de D3: se pasan por cast mientras el tipo no las declare, para
 * que el RED sea de COMPORTAMIENTO (no se prefillan) y no un fallo de tipos.
 */
const renderDialog = (prefill: {
  invitadosIniciales?: number | null;
  duracionInicial?: number | null;
}) => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const props = {
    reservaId: RESERVA_ID,
    abierto: true,
    onAbiertoChange: vi.fn(),
    onEditado: vi.fn(),
    onReenviado: vi.fn(),
    ...prefill,
  } as unknown as React.ComponentProps<typeof EditarPresupuestoDialog>;
  render(
    <QueryClientProvider client={queryClient}>
      <EditarPresupuestoDialog {...props} />
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  getMock.mockReset();
  postMock.mockReset();
  patchMock.mockReset();
  // GET /extras y cualquier otra lectura no relevante → colección vacía.
  getMock.mockResolvedValue({ data: [], error: undefined, response: { status: 200 } as Response });
  // El preview de edición se dispara al abrir (POST); devuelve un borrador válido.
  postMock.mockResolvedValue(previewOk());
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('EditarPresupuestoDialog · prefill de invitados y duración (D3)', () => {
  it('prefilla_el_numero_de_invitados_con_invitadosIniciales', async () => {
    renderDialog({ invitadosIniciales: 40, duracionInicial: 8 });

    await waitFor(() =>
      expect(screen.getByTestId('input-num-invitados')).toHaveValue(40),
    );
  });

  it('prefilla_la_duracion_con_duracionInicial_cuando_pertenece_al_enum', async () => {
    renderDialog({ invitadosIniciales: 40, duracionInicial: 8 });

    await waitFor(() =>
      expect(screen.getByTestId('select-duracion')).toHaveValue('8'),
    );
  });

  it('acota_la_duracion_fuera_del_enum_al_fallback_4', async () => {
    renderDialog({ invitadosIniciales: 25, duracionInicial: 6 });

    await waitFor(() =>
      expect(screen.getByTestId('select-duracion')).toHaveValue('4'),
    );
  });

  it('acota_la_duracion_nula_al_fallback_4', async () => {
    renderDialog({ invitadosIniciales: 25, duracionInicial: null });

    await waitFor(() =>
      expect(screen.getByTestId('select-duracion')).toHaveValue('4'),
    );
  });
});

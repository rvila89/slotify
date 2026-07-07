/**
 * Fase RED — US-050 · Pipeline de Reservas · orquestador de tabs + estados de vista.
 *
 * Trazabilidad: US-050 §Happy Path (tab por defecto), §FA-01/FA-02/FA-03; spec-delta
 * `pipeline-ui` (Requirements "Pantalla de pipeline con tabs Kanban y Listado",
 * "Estado vacío del pipeline con CTA de Nueva Reserva", "Estado de carga con skeleton",
 * "Estado de error con opción de reintento"); design.md D-3 (un único hook compartido),
 * D-4 (tab por defecto = flujo), D-5 (loading/empty/error); tasks.md Fase 3: 3.4 y 3.5.
 *
 * Contrato de producción que la fase GREEN debe cumplir en
 * `@/features/reservas` → `ReservasPage` (exportado por el barrel):
 *   - Tab "Flujo de Reserva" (Kanban) ACTIVO por defecto, con las 5 columnas.
 *   - Cambiar al tab "Listado" NO dispara una segunda llamada a `GET /reservas`
 *     (mismo hook/queryKey, D-3).
 *   - `isLoading` → skeleton de carga (rol/status "skeleton") sin errores de UI.
 *   - éxito con `data: []` → estado vacío + CTA "Nueva Reserva".
 *   - `isError` → estado de error con botón de "Reintentar" que reejecuta la carga
 *     (`refetch` → nueva llamada al SDK).
 *
 * El SDK generado se DOBLA con `vi.mock('@/api-client', …)`: ningún test toca la red.
 *
 * RED: `ReservasPage` aún no existe en `@/features/reservas` → el import del símbolo de
 * producción falla y la batería está en ROJO por falta de implementación (no por
 * configuración del runner).
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ReservasPage, type Reserva } from '@/features/reservas';

// El SDK generado se DOBLA: el hook `useReservasActivas` llama a `apiClient.GET('/reservas')`.
const getMock = vi.fn();
vi.mock('@/api-client', () => ({
  apiClient: { GET: (...args: unknown[]) => getMock(...args) },
  default: { GET: (...args: unknown[]) => getMock(...args) },
}));

const reserva = (over: Partial<Reserva>): Reserva =>
  ({
    idReserva: crypto.randomUUID(),
    codigo: 'SLO-2026-0001',
    clienteId: crypto.randomUUID(),
    estado: 'reserva_confirmada',
    canalEntrada: 'web',
    nombreEvento: 'Evento X',
    fechaEvento: '2026-09-12',
    numInvitadosFinal: 100,
    progressLogistica: 0,
    progressLiquidacion: 0,
    ...over,
  }) as Reserva;

const okConData = (data: Reserva[]) => ({
  data: { data, metadata: { total: data.length, page: 1, pageSize: 20 } },
  error: undefined,
  response: { status: 200 } as Response,
});

const errorRed = () => ({
  data: undefined,
  error: { message: 'fallo de red' },
  response: { status: 503 } as Response,
});

const renderPage = () => {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={['/reservas']}>
        <ReservasPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );
};

beforeEach(() => {
  getMock.mockReset();
});

afterEach(() => {
  vi.clearAllMocks();
});

describe('ReservasPage — orquestador de tabs (D-3, D-4)', () => {
  it('debe_mostrar_el_tab_Flujo_de_Reserva_activo_por_defecto_con_las_5_columnas', async () => {
    // Arrange
    getMock.mockResolvedValue(okConData([reserva({ estado: 'pre_reserva' })]));

    // Act
    renderPage();

    // Assert — tab "Flujo de Reserva" seleccionado por defecto
    await waitFor(() => {
      const tabFlujo = screen.getByRole('tab', { name: /flujo de reserva/i });
      expect(tabFlujo).toHaveAttribute('aria-selected', 'true');
    });
    // ...y las 5 columnas del Kanban visibles
    for (const label of ['Consulta', 'Pre-reserva', 'Confirmada', 'En Curso', 'Post-evento']) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
  });

  it('no_debe_disparar_una_segunda_llamada_al_cambiar_al_tab_Listado_mismo_hook', async () => {
    // Arrange
    const user = userEvent.setup();
    getMock.mockResolvedValue(okConData([reserva({ nombreEvento: 'Boda Ada' })]));
    renderPage();
    await screen.findByText('Boda Ada');
    const llamadasTrasCarga = getMock.mock.calls.length;

    // Act — cambiar al tab "Listado"
    await user.click(screen.getByRole('tab', { name: /listado/i }));

    // Assert — el Listado muestra los mismos datos SIN una segunda llamada al SDK
    expect(await screen.findByText('Boda Ada')).toBeInTheDocument();
    expect(getMock.mock.calls.length).toBe(llamadasTrasCarga);
  });
});

describe('ReservasPage — estados de vista (D-5)', () => {
  it('debe_mostrar_el_skeleton_de_carga_mientras_GET_reservas_esta_en_curso_FA02', async () => {
    // Arrange — promesa que nunca resuelve para mantener el estado de carga
    getMock.mockReturnValue(new Promise(() => {}));

    // Act
    renderPage();

    // Assert — skeleton de carga presente, sin estado de error ni vacío
    expect(await screen.findByTestId('pipeline-skeleton')).toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
  });

  it('debe_mostrar_estado_vacio_con_CTA_Nueva_Reserva_cuando_no_hay_reservas_FA01', async () => {
    // Arrange
    getMock.mockResolvedValue(okConData([]));

    // Act
    renderPage();

    // Assert — CTA "Nueva Reserva" del estado vacío
    expect(await screen.findByRole('link', { name: /nueva reserva/i })).toBeInTheDocument();
  });

  it('debe_mostrar_estado_de_error_con_reintento_que_reejecuta_la_carga_FA03', async () => {
    // Arrange — primera carga falla, la segunda (reintento) devuelve datos
    const user = userEvent.setup();
    getMock.mockResolvedValueOnce(errorRed());
    renderPage();

    // Assert — estado de error con botón de reintento
    const botonReintentar = await screen.findByRole('button', { name: /reintentar/i });
    const llamadasTrasError = getMock.mock.calls.length;

    // Act — reintentar: la segunda respuesta trae datos
    getMock.mockResolvedValue(okConData([reserva({ nombreEvento: 'Boda tras reintento' })]));
    await user.click(botonReintentar);

    // Assert — el refetch reejecuta la carga (nueva llamada al SDK) y muestra datos
    await waitFor(() => {
      expect(getMock.mock.calls.length).toBeGreaterThan(llamadasTrasError);
    });
    expect(await screen.findByText('Boda tras reintento')).toBeInTheDocument();
  });
});

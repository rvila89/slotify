import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toast } from 'sonner';
import { notify } from '../notify';

/**
 * `notify` centraliza los toasts (sonner) con la conducta de "solo el último":
 * antes de emitir un toast nuevo DEBE descartar los previos (`toast.dismiss()`),
 * de modo que a cada acción solo quede el último mensaje visible. Reenvía tipo,
 * mensaje y opciones intactos a `toast.*()`.
 */
vi.mock('sonner', () => ({
  toast: {
    success: vi.fn(),
    error: vi.fn(),
    warning: vi.fn(),
    info: vi.fn(),
    dismiss: vi.fn(),
  },
}));

const toastMock = toast as unknown as {
  success: ReturnType<typeof vi.fn>;
  error: ReturnType<typeof vi.fn>;
  warning: ReturnType<typeof vi.fn>;
  info: ReturnType<typeof vi.fn>;
  dismiss: ReturnType<typeof vi.fn>;
};

beforeEach(() => {
  toastMock.success.mockReset();
  toastMock.error.mockReset();
  toastMock.warning.mockReset();
  toastMock.info.mockReset();
  toastMock.dismiss.mockReset();
});

afterEach(() => vi.clearAllMocks());

const variantes = ['success', 'error', 'warning', 'info'] as const;

describe('notify — solo el último toast', () => {
  it.each(variantes)('notify.%s descarta los toasts previos antes de emitir', (variante) => {
    notify[variante]('Mensaje');

    expect(toastMock.dismiss).toHaveBeenCalledTimes(1);
    expect(toastMock[variante]).toHaveBeenCalledTimes(1);
    // El dismiss ocurre ANTES del toast (orden de invocación).
    expect(toastMock.dismiss.mock.invocationCallOrder[0]).toBeLessThan(
      toastMock[variante].mock.invocationCallOrder[0],
    );
  });

  it('reenvía mensaje y opciones intactos a toast', () => {
    const opciones = { description: 'Detalle del error' };
    notify.warning('Error de envío, reintenta', opciones);

    expect(toastMock.warning).toHaveBeenCalledWith('Error de envío, reintenta', opciones);
  });
});

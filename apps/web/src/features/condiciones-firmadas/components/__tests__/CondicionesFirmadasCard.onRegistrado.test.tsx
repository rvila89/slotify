/**
 * TDD-RED (change `condiciones-idioma-e2-firma-banner`, Mejora C): registrar la firma
 * de condiciones debe dejar de emitir un TOAST de Sonner y pasar a un BANNER inline en
 * la cabecera de la ficha (patrón `useAvisosFicha` + `AvisosFicha`, como el resto de
 * acciones de desenlace).
 *
 * `CondicionesFirmadasCard` acepta una prop opcional
 * `onRegistrado?: (tipo: 'registrada' | 'reregistrada') => void`. Cuando se PASA:
 *   · NO llama `notify.success()` (el aviso lo pinta la página vía el banner);
 *   · llama a la prop con el `tipo` correcto (`'registrada'` en el primer registro,
 *     `'reregistrada'` en la re-firma).
 *
 * El `RegistrarFirmaDialog` se DOBLA para exponer un botón que dispara su prop
 * `onRegistrado(resultado)` (simula el 200 del backend), aislando el test de la
 * mecánica del formulario/fichero.
 *
 * RED: hoy la Card NO acepta `onRegistrado` y su callback interno llama SIEMPRE a
 * `notify.success()`. Los asserts (prop invocada con el tipo + `notify.success` no
 * llamado) FALLAN. GREEN es de `frontend-developer`.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { notify } from '@/lib/notify';
import { CondicionesFirmadasCard } from '../CondicionesFirmadasCard';
import type { RegistrarCondicionesFirmadasResponse } from '../../model/types';

// Espía de notify: el aserto clave es que `success` NO se invoca cuando se pasa
// `onRegistrado`.
vi.mock('@/lib/notify', () => ({
  notify: { success: vi.fn(), info: vi.fn(), warning: vi.fn(), error: vi.fn() },
}));
const notifyMock = notify as unknown as { success: ReturnType<typeof vi.fn> };

// Doble del diálogo: un botón que, al pulsarlo, invoca la prop `onRegistrado` de la
// Card con la respuesta 200 (RESERVA con `condPartFirmadas=true`).
const respuesta200 = {
  reserva: { condPartFirmadas: true },
} as unknown as RegistrarCondicionesFirmadasResponse;

vi.mock('../RegistrarFirmaDialog', () => ({
  RegistrarFirmaDialog: ({
    onRegistrado,
  }: {
    onRegistrado: (r: RegistrarCondicionesFirmadasResponse) => void;
  }) => (
    <button type="button" data-testid="fake-registrar" onClick={() => onRegistrado(respuesta200)}>
      registrar
    </button>
  ),
}));

describe('CondicionesFirmadasCard — onRegistrado (Mejora C)', () => {
  it('al_registrar_con_exito_invoca_onRegistrado_con_registrada_cuando_no_estaba_firmada', async () => {
    const user = userEvent.setup();
    const onRegistrado = vi.fn();

    render(
      <CondicionesFirmadasCard
        reservaId="r-1"
        condPartFechaEnvio="2026-07-01T10:00:00.000Z"
        condPartFirmadas={false}
        onRegistrado={onRegistrado}
      />,
    );

    await user.click(screen.getByTestId('fake-registrar'));

    expect(onRegistrado).toHaveBeenCalledWith('registrada');
  });

  it('al_registrar_con_exito_invoca_onRegistrado_con_reregistrada_cuando_ya_estaba_firmada', async () => {
    const user = userEvent.setup();
    const onRegistrado = vi.fn();

    render(
      <CondicionesFirmadasCard
        reservaId="r-1"
        condPartFechaEnvio="2026-07-01T10:00:00.000Z"
        condPartFirmadas
        condPartFechaFirma="2026-07-05T10:00:00.000Z"
        onRegistrado={onRegistrado}
      />,
    );

    await user.click(screen.getByTestId('fake-registrar'));

    expect(onRegistrado).toHaveBeenCalledWith('reregistrada');
  });

  it('NO_emite_notify_success_cuando_se_pasa_onRegistrado', async () => {
    const user = userEvent.setup();

    render(
      <CondicionesFirmadasCard
        reservaId="r-1"
        condPartFechaEnvio="2026-07-01T10:00:00.000Z"
        condPartFirmadas={false}
        onRegistrado={vi.fn()}
      />,
    );

    await user.click(screen.getByTestId('fake-registrar'));

    expect(notifyMock.success).not.toHaveBeenCalled();
  });
});

/**
 * Fase RED — change gestion-sesion-ux-modal-f5-error-banner · Pieza 4.
 *
 * Trazabilidad: spec-delta `auth` (Requirement ADDED "Aviso de expiración de sesión
 * con countdown y cierre por inactividad": modal de sesión cerrada tras llegar a
 * `exp` sin reaccionar). design.md Decisión 4. tasks.md Fase 2: 2.6.
 *
 * Contrato de producción que la fase GREEN debe crear
 * (`components/SessionExpiredModal.tsx`):
 *   - Props: `{ open: boolean; onLogin: () => void }`.
 *   - Con `open` muestra el mensaje de sesión cerrada ("Tu sesión se ha cerrado…")
 *     y un botón "Iniciar sesión" que invoca `onLogin` (el consumidor navega a
 *     `/login`).
 *   - Modal FORZADO: no ofrece cierre por "X".
 *
 * RED esperado: `SessionExpiredModal` aún no existe → el import del símbolo de
 * producción falla y la batería está en ROJO.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
// Símbolo de producción aún inexistente (RED esperado):
import { SessionExpiredModal } from '../SessionExpiredModal';

describe('SessionExpiredModal — sesión cerrada por inactividad', () => {
  it('debe_mostrar_el_mensaje_de_sesion_cerrada', () => {
    render(<SessionExpiredModal open onLogin={vi.fn()} />);

    expect(screen.getByText(/tu sesión se ha cerrado/i)).toBeInTheDocument();
  });

  it('debe_invocar_onLogin_al_pulsar_iniciar_sesion', async () => {
    const onLogin = vi.fn();
    const user = userEvent.setup();
    render(<SessionExpiredModal open onLogin={onLogin} />);

    await user.click(screen.getByRole('button', { name: /iniciar sesión/i }));

    expect(onLogin).toHaveBeenCalledTimes(1);
  });

  it('no_debe_ofrecer_un_boton_de_cierre_X_por_ser_un_modal_forzado', () => {
    render(<SessionExpiredModal open onLogin={vi.fn()} />);

    expect(screen.queryByRole('button', { name: /^cerrar$/i })).not.toBeInTheDocument();
  });
});

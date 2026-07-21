/**
 * Fase RED — change gestion-sesion-ux-modal-f5-error-banner · Pieza 4.
 *
 * Trazabilidad: spec-delta `auth` (Requirement ADDED "Aviso de expiración de sesión
 * con countdown y cierre por inactividad", scenario "Aviso 60 s antes de expirar con
 * countdown"). design.md Decisión 4. tasks.md Fase 2: 2.5.
 *
 * Contrato de producción que la fase GREEN debe crear
 * (`components/SessionExpiryWarningModal.tsx`):
 *   - Props: `{ open: boolean; secondsLeft: number; onKeepSession: () => void;
 *     onLogout: () => void }`.
 *   - Con `open` muestra el countdown regresivo (texto con los segundos restantes)
 *     y dos botones: "Mantener sesión" (→ `onKeepSession`) y "Cerrar sesión"
 *     (→ `onLogout`).
 *   - Modal FORZADO: no ofrece cierre por "X" (no cerrable salvo por las acciones).
 *
 * RED esperado: `SessionExpiryWarningModal` aún no existe → el import del símbolo de
 * producción falla y la batería está en ROJO.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
// Símbolo de producción aún inexistente (RED esperado):
import { SessionExpiryWarningModal } from '../SessionExpiryWarningModal';

describe('SessionExpiryWarningModal — aviso con countdown', () => {
  it('debe_mostrar_los_segundos_restantes_del_countdown', () => {
    render(
      <SessionExpiryWarningModal open secondsLeft={30} onKeepSession={vi.fn()} onLogout={vi.fn()} />,
    );

    // El countdown muestra los segundos restantes (formato "0:30" o "30").
    expect(screen.getByText(/(0:30|(^|\D)30(\D|$))/)).toBeInTheDocument();
  });

  it('debe_invocar_onKeepSession_al_pulsar_mantener_sesion', async () => {
    const onKeepSession = vi.fn();
    const user = userEvent.setup();
    render(
      <SessionExpiryWarningModal
        open
        secondsLeft={30}
        onKeepSession={onKeepSession}
        onLogout={vi.fn()}
      />,
    );

    await user.click(screen.getByRole('button', { name: /mantener sesión/i }));

    expect(onKeepSession).toHaveBeenCalledTimes(1);
  });

  it('debe_invocar_onLogout_al_pulsar_cerrar_sesion', async () => {
    const onLogout = vi.fn();
    const user = userEvent.setup();
    render(
      <SessionExpiryWarningModal open secondsLeft={30} onKeepSession={vi.fn()} onLogout={onLogout} />,
    );

    await user.click(screen.getByRole('button', { name: /cerrar sesión/i }));

    expect(onLogout).toHaveBeenCalledTimes(1);
  });

  it('no_debe_ofrecer_un_boton_de_cierre_X_por_ser_un_modal_forzado', () => {
    render(
      <SessionExpiryWarningModal open secondsLeft={30} onKeepSession={vi.fn()} onLogout={vi.fn()} />,
    );

    // El Dialog base incluye un botón con sr-only "Cerrar"; el modal forzado NO debe exponerlo.
    expect(screen.queryByRole('button', { name: /^cerrar$/i })).not.toBeInTheDocument();
  });
});

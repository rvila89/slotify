/**
 * TDD-RED (change `2026-07-20-descarte-aviso-inline-ficha`): aviso inline verde de
 * confirmación de descarte en la cabecera de la ficha, en sustitución del toast de
 * Sonner. Espeja el patrón esmeralda de `AvisoVisitaProgramada` (banner verde,
 * ícono, título en negrita con el código, descripción, botón "Cerrar aviso").
 *
 * Componente de presentación puro: sin red ni SDK. Props:
 *   { tipo: 'consulta' | 'prereserva'; codigo: string; onCerrar: () => void }
 *
 * Este test FALLA (RED) porque `../AvisoDescarte` aún no existe.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AvisoDescarte } from '../AvisoDescarte';

describe('AvisoDescarte — banner inline verde de confirmación de descarte', () => {
  it('con_tipo_prereserva_muestra_titulo_con_codigo_y_su_testid', () => {
    render(<AvisoDescarte tipo="prereserva" codigo="SLO-2026-0021" onCerrar={() => {}} />);

    const aviso = screen.getByTestId('alerta-descarte-prereserva');
    expect(aviso).toBeInTheDocument();
    expect(aviso).toHaveTextContent(/Pre-reserva SLO-2026-0021 descartada/i);
  });

  it('con_tipo_consulta_muestra_titulo_con_codigo_y_su_testid', () => {
    render(<AvisoDescarte tipo="consulta" codigo="SLO-2026-0013" onCerrar={() => {}} />);

    const aviso = screen.getByTestId('alerta-descarte-consulta');
    expect(aviso).toBeInTheDocument();
    expect(aviso).toHaveTextContent(/Consulta SLO-2026-0013 descartada/i);
    expect(screen.queryByTestId('alerta-descarte-prereserva')).not.toBeInTheDocument();
  });

  it('es_un_banner_verde_esmeralda_como_los_demas_avisos_de_la_ficha', () => {
    render(<AvisoDescarte tipo="prereserva" codigo="SLO-2026-0021" onCerrar={() => {}} />);

    const aviso = screen.getByTestId('alerta-descarte-prereserva');
    expect(aviso).toHaveAttribute('role', 'status');
    expect(aviso).toHaveClass('border-emerald-200', 'bg-emerald-50', 'text-emerald-900');
  });

  it('el_boton_cerrar_invoca_onCerrar', async () => {
    const user = userEvent.setup();
    const onCerrar = vi.fn();
    render(<AvisoDescarte tipo="consulta" codigo="SLO-2026-0013" onCerrar={onCerrar} />);

    await user.click(screen.getByRole('button', { name: /cerrar aviso/i }));

    expect(onCerrar).toHaveBeenCalledTimes(1);
  });
});

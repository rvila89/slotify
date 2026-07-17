/**
 * US-042 · Histórico — tabla paginada de solo lectura.
 *
 * Trazabilidad: design.md D-5 (columnas código · cliente · fechaEvento ·
 * tipoEvento · importeTotal · estado; destacado del término; navegación al
 * detalle en modo lectura). Contrato de `HistoricoTabla` (exportada por el barrel
 * `@/features/historico`): cabeceras, una fila por reserva, destacado del término
 * y navegación a `/historico/{idReserva}` al hacer clic en la fila.
 */
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { HistoricoTabla, type ReservaHistorico } from '@/features/historico';

const fila = (over: Partial<ReservaHistorico>): ReservaHistorico => ({
  idReserva: crypto.randomUUID(),
  codigo: 'SLO-2026-0001',
  clienteId: crypto.randomUUID(),
  clienteNombre: 'Ada',
  clienteApellidos: 'Lovelace',
  estado: 'reserva_completada',
  fechaEvento: '2026-03-15',
  tipoEvento: 'boda',
  importeTotal: '1210.00',
  ...over,
});

const RESERVAS: ReservaHistorico[] = [
  fila({
    idReserva: 'bbbbbbbb-0000-0000-0000-000000000001',
    codigo: 'SLO-2026-0001',
    clienteNombre: 'Ada',
    clienteApellidos: 'García',
  }),
  fila({
    idReserva: 'bbbbbbbb-0000-0000-0000-000000000002',
    codigo: 'SLO-2026-0002',
    clienteNombre: 'Grace',
    clienteApellidos: 'Hopper',
    estado: 'reserva_cancelada',
  }),
];

const renderTabla = (termino?: string) =>
  render(
    <MemoryRouter initialEntries={['/historico']}>
      <Routes>
        <Route path="/historico" element={<HistoricoTabla reservas={RESERVAS} termino={termino} />} />
        <Route path="/historico/:id" element={<div>Detalle</div>} />
      </Routes>
    </MemoryRouter>,
  );

describe('HistoricoTabla — columnas y filas', () => {
  it('muestra las cabeceras código, cliente, fecha, tipo, importe y estado', () => {
    renderTabla();
    const cabeceras = screen.getAllByRole('columnheader').map((c) => c.textContent ?? '');
    expect(cabeceras.some((t) => /código/i.test(t))).toBe(true);
    expect(cabeceras.some((t) => /cliente/i.test(t))).toBe(true);
    expect(cabeceras.some((t) => /fecha/i.test(t))).toBe(true);
    expect(cabeceras.some((t) => /tipo/i.test(t))).toBe(true);
    expect(cabeceras.some((t) => /importe/i.test(t))).toBe(true);
    expect(cabeceras.some((t) => /estado/i.test(t))).toBe(true);
  });

  it('renderiza una fila por reserva con su código', () => {
    renderTabla();
    expect(screen.getByText('SLO-2026-0001')).toBeInTheDocument();
    expect(screen.getByText('SLO-2026-0002')).toBeInTheDocument();
  });

  it('destaca el término buscado con <mark>', () => {
    renderTabla('García');
    const marca = document.querySelector('mark');
    expect(marca?.textContent).toBe('García');
  });
});

describe('HistoricoTabla — navegación al detalle en modo lectura', () => {
  it('navega a /historico/{id} al hacer clic en la fila', async () => {
    const user = userEvent.setup();
    renderTabla();
    const filaGrace = screen.getByText('SLO-2026-0002').closest('tr');
    expect(filaGrace).not.toBeNull();
    await user.click(within(filaGrace as HTMLElement).getByText('SLO-2026-0002'));
    expect(await screen.findByText('Detalle')).toBeInTheDocument();
  });
});

/**
 * Fase RED — US-050 · Pipeline de Reservas · tab Listado.
 *
 * Trazabilidad: US-050 §Happy Path — Listado; spec-delta `pipeline-ui` (Requirements
 * "Tabla del Listado con columnas Nombre, Estado, Fecha, Aforo y Acciones" y
 * "Navegación a la FichaConsulta desde tarjeta o fila"); tasks.md Fase 3: 3.3.
 *
 * Contrato de producción que la fase GREEN debe cumplir en
 * `@/features/reservas` → `ListadoView` (exportado por el barrel):
 *   - Renderiza una tabla con las columnas Nombre · Estado · Fecha · Aforo · Acciones.
 *   - Una fila por cada reserva activa (nombre y aforo visibles por fila).
 *   - Clic en una fila navega a la FichaConsulta `/reservas/{idReserva}` (solo lectura).
 *
 * RED: `ListadoView` aún no existe en `@/features/reservas` → el import del símbolo de
 * producción falla y la batería está en ROJO por falta de implementación.
 */
import { describe, expect, it } from 'vitest';
import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ListadoView, type Reserva } from '@/features/reservas';

const reserva = (over: Partial<Reserva>): Reserva =>
  ({
    idReserva: crypto.randomUUID(),
    codigo: 'SLO-2026-0001',
    clienteId: crypto.randomUUID(),
    estado: 'reserva_confirmada',
    canalEntrada: 'web',
    nombreEvento: 'Evento sin nombre',
    fechaEvento: '2026-09-12',
    numInvitadosFinal: 100,
    progressLogistica: 0,
    progressLiquidacion: 0,
    ...over,
  }) as Reserva;

const RESERVAS: Reserva[] = [
  reserva({ idReserva: 'aaaaaaaa-0000-0000-0000-000000000001', nombreEvento: 'Boda Ada', numInvitadosFinal: 120 }),
  reserva({ idReserva: 'aaaaaaaa-0000-0000-0000-000000000002', nombreEvento: 'Cena Grace', numInvitadosFinal: 60 }),
  reserva({ idReserva: 'aaaaaaaa-0000-0000-0000-000000000003', nombreEvento: 'Gala Alan', numInvitadosFinal: 200 }),
];

const renderListado = (reservas: Reserva[]) =>
  render(
    <MemoryRouter initialEntries={['/reservas']}>
      <Routes>
        <Route path="/reservas" element={<ListadoView reservas={reservas} />} />
        <Route path="/reservas/:id" element={<div>Ficha</div>} />
      </Routes>
    </MemoryRouter>,
  );

describe('ListadoView — tabla de reservas activas', () => {
  it('debe_mostrar_las_cabeceras_Nombre_Estado_Fecha_Aforo_Acciones', () => {
    renderListado(RESERVAS);
    const cabeceras = screen.getAllByRole('columnheader').map((c) => c.textContent ?? '');
    expect(cabeceras.some((t) => /nombre/i.test(t))).toBe(true);
    expect(cabeceras.some((t) => /estado/i.test(t))).toBe(true);
    expect(cabeceras.some((t) => /fecha/i.test(t))).toBe(true);
    expect(cabeceras.some((t) => /aforo/i.test(t))).toBe(true);
    expect(cabeceras.some((t) => /acciones/i.test(t))).toBe(true);
  });

  it('debe_renderizar_una_fila_por_reserva_con_su_nombre', () => {
    renderListado(RESERVAS);
    expect(screen.getByText('Boda Ada')).toBeInTheDocument();
    expect(screen.getByText('Cena Grace')).toBeInTheDocument();
    expect(screen.getByText('Gala Alan')).toBeInTheDocument();
  });
});

describe('ListadoView — navegación por fila', () => {
  it('debe_navegar_a_la_ficha_de_la_reserva_al_hacer_clic_en_su_fila', async () => {
    // Arrange
    const user = userEvent.setup();
    renderListado(RESERVAS);

    // Act — clic en la fila de "Cena Grace"
    const fila = screen.getByText('Cena Grace').closest('tr');
    expect(fila).not.toBeNull();
    await user.click(within(fila as HTMLElement).getByText('Cena Grace'));

    // Assert — navega a la ficha
    expect(await screen.findByText('Ficha')).toBeInTheDocument();
  });
});

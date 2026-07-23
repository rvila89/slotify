/**
 * Fase RED — US-050 · Pipeline de Reservas · tarjeta del Kanban.
 *
 * Trazabilidad: US-050 §Happy Path — Kanban; spec-delta `pipeline-ui` (Requirements
 * "Contenido de la tarjeta del Kanban" y "Navegación a la FichaConsulta desde tarjeta
 * o fila"); tasks.md Fase 3: 3.2.
 *
 * Contrato de producción que la fase GREEN debe cumplir en
 * `@/features/reservas` → `ReservaKanbanCard` (exportado por el barrel):
 *   - Renderiza el nombre del evento (`nombreEvento`), la fecha (`fechaEvento`)
 *     junto al aforo/pax, una barra de progreso LOGÍSTICA con su % (`progressLogistica`)
 *     y una barra LIQUIDACIÓN con su % (`progressLiquidacion`).
 *   - Muestra la nota de estado (`notas`) SOLO si existe (no vacía).
 *   - Al hacer clic en la tarjeta (o en su icono de enlace) navega a
 *     `/reservas/{idReserva}` SIN mutar ni ejecutar transición.
 *
 * RED: `ReservaKanbanCard` aún no existe en `@/features/reservas` → el import del
 * símbolo de producción falla y la batería está en ROJO por falta de implementación.
 */
import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { ReservaKanbanCard, type Reserva } from '@/features/reservas';

const ID = '11111111-1111-1111-1111-111111111111';

const reserva = (over: Partial<Reserva> = {}): Reserva =>
  ({
    idReserva: ID,
    codigo: 'SLO-2026-0001',
    clienteId: '22222222-2222-2222-2222-222222222222',
    estado: 'reserva_confirmada',
    canalEntrada: 'email',
    nombreEvento: 'Boda Ada Lovelace',
    fechaEvento: '2026-09-12',
    numInvitadosFinal: 120,
    progressLogistica: 50,
    progressLiquidacion: 75,
    notas: 'Pendiente confirmar menú',
    ...over,
  }) as Reserva;

const renderCard = (r: Reserva) =>
  render(
    <MemoryRouter initialEntries={['/reservas']}>
      <Routes>
        <Route path="/reservas" element={<ReservaKanbanCard reserva={r} />} />
        <Route path="/reservas/:id" element={<div>Ficha de {r.idReserva}</div>} />
      </Routes>
    </MemoryRouter>,
  );

describe('ReservaKanbanCard — contenido de la tarjeta', () => {
  it('debe_renderizar_nombre_del_evento', () => {
    renderCard(reserva());
    expect(screen.getByText('Boda Ada Lovelace')).toBeInTheDocument();
  });

  it('debe_renderizar_la_fecha_del_evento_y_el_aforo', () => {
    renderCard(reserva());
    // Fecha formateada en español (septiembre) y el pax (120) presentes en la tarjeta.
    expect(screen.getByText(/septiembre/i)).toBeInTheDocument();
    expect(screen.getByText(/120/)).toBeInTheDocument();
  });

  it('debe_renderizar_la_barra_LOGISTICA_con_su_porcentaje', () => {
    renderCard(reserva({ progressLogistica: 50 }));
    expect(screen.getByText(/log[íi]stica/i)).toBeInTheDocument();
    expect(screen.getByText('50%')).toBeInTheDocument();
  });

  it('debe_renderizar_la_barra_LIQUIDACION_con_su_porcentaje', () => {
    renderCard(reserva({ progressLiquidacion: 75 }));
    expect(screen.getByText(/liquidaci[óo]n/i)).toBeInTheDocument();
    expect(screen.getByText('75%')).toBeInTheDocument();
  });

  it('debe_mostrar_la_nota_de_estado_cuando_existe', () => {
    renderCard(reserva({ notas: 'Pendiente confirmar menú' }));
    expect(screen.getByText('Pendiente confirmar menú')).toBeInTheDocument();
  });

  it('no_debe_mostrar_el_bloque_de_nota_cuando_notas_es_vacio_o_ausente', () => {
    renderCard(reserva({ notas: null }));
    expect(screen.queryByText('Pendiente confirmar menú')).not.toBeInTheDocument();
  });
});

describe('ReservaKanbanCard — navegación a la ficha', () => {
  it('debe_navegar_a_la_ficha_de_la_reserva_al_hacer_clic_en_la_tarjeta', async () => {
    // Arrange
    const user = userEvent.setup();
    renderCard(reserva());

    // Act — clic en la tarjeta (rol de enlace/botón con el nombre del evento)
    await user.click(screen.getByText('Boda Ada Lovelace'));

    // Assert — navega a /reservas/{idReserva}
    expect(await screen.findByText(`Ficha de ${ID}`)).toBeInTheDocument();
  });
});

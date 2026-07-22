import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DetallesEvento } from '../DetallesEvento';
import type { ReservaDetalle } from '../../../../model/types';

/**
 * "Detalles del evento" de la ficha (mejoras-detalle-consulta §D-1/D-2):
 *  - Invitados en UNA sola fila "Invitados" (`numAdultosNinosMayores4`); ya NO se
 *    muestran "Niños ≤ 4" ni "Nº de invitados final" (no se piden al crear).
 *  - "Comentarios" lee `reserva.comentarios` (lo que dejó el cliente al crear la
 *    consulta), NO `notas`.
 * Componente de presentación puro: sin red ni SDK.
 */
const reserva = (over: Partial<ReservaDetalle> = {}): ReservaDetalle =>
  ({
    idReserva: crypto.randomUUID(),
    codigo: 'SLO-2026-0007',
    clienteId: crypto.randomUUID(),
    estado: 'consulta',
    subEstado: '2a',
    canalEntrada: 'email',
    duracionHoras: 8,
    horario: '10:00',
    numAdultosNinosMayores4: 40,
    numNinosMenores4: 5,
    numInvitadosFinal: 45,
    comentarios: 'Quieren barra libre y DJ',
    notas: 'Nota interna del gestor',
    ...over,
  }) as ReservaDetalle;

describe('DetallesEvento — invitados en una sola fila', () => {
  it('muestra_una_fila_Invitados_con_numAdultosNinosMayores4', () => {
    render(<DetallesEvento reserva={reserva()} />);
    expect(screen.getByText('Invitados')).toBeInTheDocument();
    expect(screen.getByText('40')).toBeInTheDocument();
  });

  it('no_muestra_ninos_menores_4_ni_invitados_final', () => {
    render(<DetallesEvento reserva={reserva()} />);
    expect(screen.queryByText(/Niños ≤ 4/)).not.toBeInTheDocument();
    expect(screen.queryByText(/invitados final/i)).not.toBeInTheDocument();
    // Su desglose (5) y aforo final (45) no deben aparecer como valores.
    expect(screen.queryByText('5')).not.toBeInTheDocument();
    expect(screen.queryByText('45')).not.toBeInTheDocument();
  });
});

describe('DetallesEvento — Comentarios del alta', () => {
  it('muestra_los_comentarios_del_alta_no_las_notas_internas', () => {
    render(<DetallesEvento reserva={reserva()} />);
    expect(screen.getByText('Quieren barra libre y DJ')).toBeInTheDocument();
    expect(screen.queryByText('Nota interna del gestor')).not.toBeInTheDocument();
  });

  it('muestra_placeholder_cuando_no_hay_comentarios', () => {
    render(<DetallesEvento reserva={reserva({ comentarios: null })} />);
    expect(screen.getByText('Comentarios')).toBeInTheDocument();
    expect(screen.getByText(/no se dispone de esta información/i)).toBeInTheDocument();
  });
});

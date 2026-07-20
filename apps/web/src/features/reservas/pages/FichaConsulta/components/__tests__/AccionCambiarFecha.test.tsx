/**
 * Gating del bloque "Cambiar fecha" de la ficha (change `cambiar-fecha-consulta-en-cola`):
 * la acción DEBE ofrecerse para una consulta con fecha bloqueada (`2b`/`2c`/`2v`) **y**
 * para una consulta en cola de espera (`2d`), que es lo que habilita este change; NO debe
 * renderizarse en `2a` (sin fecha → "Añadir fecha") ni en sub-estados terminales.
 */
import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { AccionCambiarFecha } from '../AccionCambiarFecha';
import type { components } from '@/api-client';

type Reserva = components['schemas']['Reserva'];

const reservaCon = (subEstado: string) => ({ codigo: 'SLO-2026-0001', subEstado } as Reserva);

describe('AccionCambiarFecha — gating por sub-estado', () => {
  it('renderiza "Cambiar fecha" para una consulta en cola de espera (2d)', () => {
    render(<AccionCambiarFecha reserva={reservaCon('2d')} onCambiarFecha={() => {}} />);
    expect(screen.getByTestId('boton-cambiar-fecha')).toBeInTheDocument();
  });

  it.each(['2b', '2c', '2v'])('sigue renderizando "Cambiar fecha" para %s', (sub) => {
    render(<AccionCambiarFecha reserva={reservaCon(sub)} onCambiarFecha={() => {}} />);
    expect(screen.getByTestId('boton-cambiar-fecha')).toBeInTheDocument();
  });

  it.each(['2a', '2x', '2y', '2z'])('NO renderiza la acción para %s', (sub) => {
    render(<AccionCambiarFecha reserva={reservaCon(sub)} onCambiarFecha={() => {}} />);
    expect(screen.queryByTestId('boton-cambiar-fecha')).not.toBeInTheDocument();
  });

  it('invoca onCambiarFecha al pulsar el botón (2d)', async () => {
    const onCambiarFecha = vi.fn();
    render(<AccionCambiarFecha reserva={reservaCon('2d')} onCambiarFecha={onCambiarFecha} />);
    await userEvent.click(screen.getByTestId('boton-cambiar-fecha'));
    expect(onCambiarFecha).toHaveBeenCalledTimes(1);
  });
});

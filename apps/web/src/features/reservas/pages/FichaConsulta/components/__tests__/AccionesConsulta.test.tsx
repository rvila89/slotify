import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { components } from '@/api-client';
import { AccionesConsulta } from '../AccionesConsulta';
import type { Reserva } from '../../../../model/types';

type EstadoReserva = components['schemas']['EstadoReserva'];

/**
 * Reglas de negocio de la botonera de la ficha (refinamientos de UI):
 *  - "Marcar como pendiente de invitados" (2b con bloqueo vigente) solo se ofrece
 *    mientras NO se hayan introducido invitados para la reserva.
 *  - "Generar presupuesto" es la acción PRINCIPAL: se muestra la primera y en verde
 *    (token semántico `accent-success`).
 * Componente de presentación puro: sin red ni SDK.
 */
const TTL_FUTURO = '2999-01-01T00:00:00.000Z';

const reserva = (over: Partial<Reserva> = {}): Reserva =>
  ({
    idReserva: crypto.randomUUID(),
    codigo: 'SLO-2026-0007',
    clienteId: crypto.randomUUID(),
    estado: 'consulta' as EstadoReserva,
    subEstado: '2b',
    canalEntrada: 'web',
    fechaEvento: '2999-06-01',
    ttlExpiracion: TTL_FUTURO,
    ...over,
  }) as Reserva;

const noop = () => {};

const renderAcciones = (r: Reserva) =>
  render(
    <AccionesConsulta
      reserva={r}
      onAnadirFecha={noop}
      onPendienteInvitados={noop}
      onProgramarVisita={noop}
      onRegistrarResultadoVisita={noop}
      onExtenderBloqueo={noop}
      onGenerarPresupuesto={noop}
      onEditarPresupuesto={noop}
      onConfirmarSenal={noop}
      onForzarInicioEvento={noop}
      onFinalizarEvento={noop}
      onArchivarReserva={noop}
      onDescartarConsulta={noop}
    />,
  );

describe('AccionesConsulta — "Marcar como pendiente de invitados" según invitados', () => {
  it('se_ofrece_en_2b_con_bloqueo_vigente_cuando_no_hay_invitados_introducidos', () => {
    renderAcciones(reserva());
    expect(screen.getByTestId('boton-pendiente-invitados')).toBeInTheDocument();
  });

  it('NO_se_ofrece_si_ya_hay_invitados_introducidos', () => {
    // `numAdultosNinosMayores4` es el campo donde el alta guarda "Invitados".
    renderAcciones(reserva({ numAdultosNinosMayores4: 50 }));
    expect(screen.queryByTestId('boton-pendiente-invitados')).not.toBeInTheDocument();
  });

  it('tambien_se_oculta_si_hay_solo_ninos_menores_de_4_o_aforo_final', () => {
    renderAcciones(reserva({ numNinosMenores4: 3 }));
    expect(screen.queryByTestId('boton-pendiente-invitados')).not.toBeInTheDocument();
  });
});

describe('AccionesConsulta — "Generar presupuesto" es la acción principal', () => {
  it('es_el_primer_boton_de_accion_de_la_botonera', () => {
    renderAcciones(reserva());
    const botones = screen.getAllByRole('button');
    expect(botones[0]).toHaveAttribute('data-testid', 'boton-generar-presupuesto');
  });

  it('usa_el_verde_del_sistema_de_diseno_token_accent_success', () => {
    renderAcciones(reserva());
    expect(screen.getByTestId('boton-generar-presupuesto')).toHaveClass('bg-accent-success');
  });
});

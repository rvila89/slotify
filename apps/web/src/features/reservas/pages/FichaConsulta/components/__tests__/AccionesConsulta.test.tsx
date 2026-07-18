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
      onEditarConsulta={noop}
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
    // Datos de evento completos → botón habilitado (verde).
    renderAcciones(reserva({ duracionHoras: 8, numAdultosNinosMayores4: 30, horario: '11:00' }));
    expect(screen.getByTestId('boton-generar-presupuesto')).toHaveClass('bg-accent-success');
  });
});

/**
 * US-051 §Punto 4: en consultas cerradas (sub-estados terminales `2x/2y/2z` o
 * estados terminales) NO se renderiza NINGUNA acción, ni siquiera deshabilitada;
 * solo el fallback "No hay acciones disponibles…".
 */
describe('AccionesConsulta — saneo de acciones en terminales', () => {
  it.each(['2x', '2y', '2z'] as const)(
    'no_renderiza_ningun_boton_en_sub_estado_terminal_%s',
    (sub) => {
      renderAcciones(reserva({ subEstado: sub, ttlExpiracion: null }));
      expect(screen.queryAllByRole('button')).toHaveLength(0);
      expect(screen.queryByTestId('boton-generar-presupuesto')).not.toBeInTheDocument();
      expect(screen.queryByTestId('boton-descartar-consulta')).not.toBeInTheDocument();
      expect(screen.queryByTestId('boton-editar-consulta')).not.toBeInTheDocument();
      expect(screen.getByTestId('sin-acciones')).toBeInTheDocument();
    },
  );

  it.each(['reserva_cancelada', 'reserva_completada'] as EstadoReserva[])(
    'no_renderiza_ningun_boton_en_estado_terminal_%s',
    (estado) => {
      renderAcciones(reserva({ estado, subEstado: undefined, ttlExpiracion: null }));
      expect(screen.queryAllByRole('button')).toHaveLength(0);
      expect(screen.getByTestId('sin-acciones')).toBeInTheDocument();
    },
  );

  it('en_2b_activa_si_muestra_acciones', () => {
    renderAcciones(reserva());
    expect(screen.getAllByRole('button').length).toBeGreaterThan(0);
    expect(screen.queryByTestId('sin-acciones')).not.toBeInTheDocument();
  });
});

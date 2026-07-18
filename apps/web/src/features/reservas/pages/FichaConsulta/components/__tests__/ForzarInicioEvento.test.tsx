import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { components } from '@/api-client';
import { AccionesConsulta } from '../AccionesConsulta';
import { AvisoEventoForzado } from '../AvisoEventoForzado';
import type { Reserva } from '../../../../model/types';

type EstadoReserva = components['schemas']['EstadoReserva'];
type ForzarInicioEventoResponse = components['schemas']['ForzarInicioEventoResponse'];

/**
 * US-032 · UC-23 FA-01 — visibilidad de la acción "Forzar inicio del evento" en la
 * ficha (solo `reserva_confirmada` + `fechaEvento = hoy`) y aviso de desenlace tras el
 * forzado. Componentes de presentación puros: sin red ni SDK.
 */
const HOY_ISO = new Date().toISOString();
const AYER_ISO = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();

const reserva = (estado: EstadoReserva, over: Partial<Reserva> = {}): Reserva =>
  ({
    idReserva: crypto.randomUUID(),
    codigo: 'SLO-2026-0032',
    clienteId: crypto.randomUUID(),
    estado,
    canalEntrada: 'web',
    fechaEvento: HOY_ISO,
    preEventoStatus: 'pendiente',
    liquidacionStatus: 'pendiente',
    fianzaStatus: 'pendiente',
    ...over,
  }) as Reserva;

const noop = () => {};

const renderAcciones = (r: Reserva, onForzarInicioEvento = vi.fn()) =>
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
      onForzarInicioEvento={onForzarInicioEvento}
      onFinalizarEvento={noop}
      onArchivarReserva={noop}
      onDescartarConsulta={noop}
    />,
  );

describe('AccionesConsulta — acción Forzar inicio de evento (US-032)', () => {
  it('debe_mostrar_el_boton_solo_en_reserva_confirmada_con_fecha_evento_hoy', () => {
    renderAcciones(reserva('reserva_confirmada', { fechaEvento: HOY_ISO }));
    expect(screen.getByTestId('boton-forzar-inicio-evento')).toBeInTheDocument();
  });

  it('no_debe_mostrar_el_boton_si_la_fecha_evento_no_es_hoy', () => {
    renderAcciones(reserva('reserva_confirmada', { fechaEvento: AYER_ISO }));
    expect(screen.queryByTestId('boton-forzar-inicio-evento')).not.toBeInTheDocument();
  });

  it('no_debe_mostrar_el_boton_en_otros_estados', () => {
    for (const estado of ['pre_reserva', 'evento_en_curso', 'post_evento'] as const) {
      const { unmount } = renderAcciones(reserva(estado, { fechaEvento: HOY_ISO }));
      expect(screen.queryByTestId('boton-forzar-inicio-evento')).not.toBeInTheDocument();
      unmount();
    }
  });

  it('debe_avisar_de_las_precondiciones_incumplidas_junto_al_boton', () => {
    renderAcciones(reserva('reserva_confirmada', { fechaEvento: HOY_ISO }));
    expect(screen.getByTestId('aviso-precondiciones-ficha')).toBeInTheDocument();
  });

  it('debe_invocar_onForzarInicioEvento_al_pulsar_el_boton', async () => {
    const onForzar = vi.fn();
    renderAcciones(reserva('reserva_confirmada', { fechaEvento: HOY_ISO }), onForzar);
    await userEvent.click(screen.getByTestId('boton-forzar-inicio-evento'));
    expect(onForzar).toHaveBeenCalledTimes(1);
  });
});

const respuesta = (
  precondicionesIncumplidas: string[] = [],
): ForzarInicioEventoResponse =>
  ({
    idReserva: crypto.randomUUID(),
    codigo: 'SLO-2026-0032',
    clienteId: crypto.randomUUID(),
    estado: 'evento_en_curso',
    canalEntrada: 'web',
    forzadoPorGestor: true,
    precondicionesIncumplidas,
  }) as ForzarInicioEventoResponse;

describe('AvisoEventoForzado — desenlace del forzado (US-032)', () => {
  it('confirma_la_transicion_a_evento_en_curso', () => {
    render(<AvisoEventoForzado resultado={respuesta()} onCerrar={noop} />);
    expect(screen.getByTestId('aviso-evento-forzado')).toHaveTextContent(/evento en curso/i);
  });

  it('lista_las_precondiciones_que_quedaron_sin_resolver', () => {
    render(
      <AvisoEventoForzado
        resultado={respuesta(['liquidacion_status', 'fianza_status'])}
        onCerrar={noop}
      />,
    );
    const docs = screen.getByTestId('aviso-forzado-precondiciones');
    expect(docs).toHaveTextContent(/liquidaci/i);
    expect(docs).toHaveTextContent(/fianza/i);
  });

  it('sin_precondiciones_incumplidas_no_muestra_el_bloque', () => {
    render(<AvisoEventoForzado resultado={respuesta()} onCerrar={noop} />);
    expect(screen.queryByTestId('aviso-forzado-precondiciones')).not.toBeInTheDocument();
  });
});

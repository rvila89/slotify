import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { components } from '@/api-client';
import { AccionesConsulta } from '../AccionesConsulta';
import {
  MENSAJE_FIANZA_NO_RESUELTA,
  fianzaResueltaCliente,
  motivoArchivarBloqueado,
  puedeArchivarReserva,
} from '../../../../lib/archivarReserva';
import type { Reserva } from '../../../../model/types';

type EstadoReserva = components['schemas']['EstadoReserva'];
type FianzaStatus = components['schemas']['FianzaStatus'];

/**
 * US-038 · UC-28 (flujo manual) — visibilidad de la acción "Archivar reserva" en la
 * ficha (solo `post_evento`) y su deshabilitado cuando la fianza no está resuelta
 * (defensa en UI; el backend revalida — 422 `fianza_no_resuelta`). Componente de
 * presentación puro: sin red ni SDK.
 */
const reserva = (estado: EstadoReserva, over: Partial<Reserva> = {}): Reserva =>
  ({
    idReserva: crypto.randomUUID(),
    codigo: 'SLO-2026-0038',
    clienteId: crypto.randomUUID(),
    estado,
    canalEntrada: 'web',
    // Por defecto sin fianza (resuelta por ausencia), salvo override.
    fianzaEur: null,
    ...over,
  }) as Reserva;

const noop = () => {};

const renderAcciones = (r: Reserva, onArchivarReserva = vi.fn()) =>
  render(
    <AccionesConsulta
      reserva={r}
      onAnadirFecha={noop}
      onCambiarFecha={noop}
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
      onArchivarReserva={onArchivarReserva}
      onDescartarConsulta={noop}
      onDescartarPreReserva={noop}
    />,
  );

describe('AccionesConsulta — acción Archivar reserva (US-038)', () => {
  it('debe_mostrar_el_boton_solo_cuando_la_reserva_esta_en_post_evento', () => {
    renderAcciones(reserva('post_evento'));
    expect(screen.getByTestId('boton-archivar-reserva')).toBeInTheDocument();
  });

  it('no_debe_mostrar_el_boton_en_otros_estados', () => {
    for (const estado of [
      'reserva_confirmada',
      'evento_en_curso',
      'reserva_completada',
      'pre_reserva',
    ] as const) {
      const { unmount } = renderAcciones(reserva(estado));
      expect(screen.queryByTestId('boton-archivar-reserva')).not.toBeInTheDocument();
      unmount();
    }
  });

  it('debe_habilitar_el_boton_con_fianza_resuelta_e_invocar_el_handler', async () => {
    const onArchivarReserva = vi.fn();
    renderAcciones(
      reserva('post_evento', { fianzaEur: '500.00', fianzaStatus: 'devuelta' }),
      onArchivarReserva,
    );
    const boton = screen.getByTestId('boton-archivar-reserva');
    expect(boton).not.toBeDisabled();
    await userEvent.click(boton);
    expect(onArchivarReserva).toHaveBeenCalledTimes(1);
  });

  it('debe_deshabilitar_el_boton_y_mostrar_la_razon_con_fianza_no_resuelta', async () => {
    const onArchivarReserva = vi.fn();
    renderAcciones(
      reserva('post_evento', { fianzaEur: '500.00', fianzaStatus: 'cobrada' }),
      onArchivarReserva,
    );
    const boton = screen.getByTestId('boton-archivar-reserva');
    expect(boton).toBeDisabled();
    expect(screen.getByTestId('aviso-archivar-bloqueado')).toHaveTextContent(
      /fianza está pendiente de resolución/i,
    );
    await userEvent.click(boton);
    expect(onArchivarReserva).not.toHaveBeenCalled();
  });

  it('archiva_sin_fianza_aunque_el_status_no_sea_devuelta', () => {
    // Sin fianza (fianzaEur null/0) la guarda se satisface sin evaluar el status.
    renderAcciones(reserva('post_evento', { fianzaEur: null, fianzaStatus: 'pendiente' }));
    expect(screen.getByTestId('boton-archivar-reserva')).not.toBeDisabled();
    expect(screen.queryByTestId('aviso-archivar-bloqueado')).not.toBeInTheDocument();
  });
});

describe('lib/archivarReserva — guardas de cliente (US-038)', () => {
  it('puedeArchivarReserva solo en post_evento', () => {
    expect(puedeArchivarReserva('post_evento')).toBe(true);
    expect(puedeArchivarReserva('reserva_completada')).toBe(false);
    expect(puedeArchivarReserva('evento_en_curso')).toBe(false);
    expect(puedeArchivarReserva(undefined)).toBe(false);
  });

  it('fianzaResueltaCliente respeta la matriz de US-037/US-036', () => {
    // Sin fianza: resuelta por ausencia sin mirar status.
    expect(fianzaResueltaCliente('pendiente', null)).toBe(true);
    expect(fianzaResueltaCliente('cobrada', '0.00')).toBe(true);
    // Con importe > 0: depende del status.
    expect(fianzaResueltaCliente('devuelta', '500.00')).toBe(true);
    expect(fianzaResueltaCliente('retenida_parcial', '500.00')).toBe(true);
    expect(fianzaResueltaCliente('cobrada', '500.00')).toBe(false);
    expect(fianzaResueltaCliente('recibo_enviado', '500.00')).toBe(false);
    expect(fianzaResueltaCliente('pendiente' as FianzaStatus, '500.00')).toBe(false);
  });

  it('motivoArchivarBloqueado devuelve el mensaje FA-01 solo si no está resuelta', () => {
    expect(motivoArchivarBloqueado('devuelta', '500.00')).toBeNull();
    expect(motivoArchivarBloqueado('cobrada', '500.00')).toBe(MENSAJE_FIANZA_NO_RESUELTA);
  });
});

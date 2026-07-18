import { describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { components } from '@/api-client';
import { AccionesConsulta } from '../AccionesConsulta';
import { AvisoEventoFinalizado } from '../AvisoEventoFinalizado';
import type { Reserva } from '../../../../model/types';

type EstadoReserva = components['schemas']['EstadoReserva'];
type FinalizarEventoResponse = components['schemas']['FinalizarEventoResponse'];

/**
 * US-034 · UC-25 — visibilidad de la acción "Marcar evento como finalizado" en la
 * ficha (solo `evento_en_curso`) y ramificación del aviso de desenlace según
 * `e5.resultado` (enviado / fallido / no_aplica) + advertencia de documentación
 * pendiente. Componentes de presentación puros: sin red ni SDK.
 */
const reserva = (estado: EstadoReserva, over: Partial<Reserva> = {}): Reserva =>
  ({
    idReserva: crypto.randomUUID(),
    codigo: 'SLO-2026-0034',
    clienteId: crypto.randomUUID(),
    estado,
    canalEntrada: 'web',
    ...over,
  }) as Reserva;

const noop = () => {};

const renderAcciones = (r: Reserva, onFinalizarEvento = vi.fn()) =>
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
      onFinalizarEvento={onFinalizarEvento}
      onArchivarReserva={noop}
      onDescartarConsulta={noop}
      onDescartarPreReserva={noop}
    />,
  );

describe('AccionesConsulta — acción Finalizar evento (US-034)', () => {
  it('debe_mostrar_el_boton_solo_cuando_la_reserva_esta_en_evento_en_curso', () => {
    renderAcciones(reserva('evento_en_curso'));
    expect(screen.getByTestId('boton-finalizar-evento')).toBeInTheDocument();
  });

  it('no_debe_mostrar_el_boton_en_otros_estados', () => {
    for (const estado of [
      'reserva_confirmada',
      'post_evento',
      'pre_reserva',
    ] as const) {
      const { unmount } = renderAcciones(reserva(estado));
      expect(screen.queryByTestId('boton-finalizar-evento')).not.toBeInTheDocument();
      unmount();
    }
  });

  it('debe_invocar_onFinalizarEvento_al_pulsar_el_boton', async () => {
    const onFinalizarEvento = vi.fn();
    renderAcciones(reserva('evento_en_curso'), onFinalizarEvento);
    await userEvent.click(screen.getByTestId('boton-finalizar-evento'));
    expect(onFinalizarEvento).toHaveBeenCalledTimes(1);
  });
});

const respuesta = (
  resultado: FinalizarEventoResponse['e5']['resultado'],
  documentacionPendiente: string[] = [],
): FinalizarEventoResponse =>
  ({
    idReserva: crypto.randomUUID(),
    codigo: 'SLO-2026-0034',
    clienteId: crypto.randomUUID(),
    estado: 'post_evento',
    canalEntrada: 'web',
    e5: { resultado, comunicacionId: resultado === 'no_aplica' ? null : crypto.randomUUID() },
    documentacionPendiente,
  }) as FinalizarEventoResponse;

describe('AvisoEventoFinalizado — ramificación por e5.resultado (US-034)', () => {
  it('e5_enviado_confirma_el_email_de_agradecimiento_e_IBAN_al_cliente', () => {
    render(<AvisoEventoFinalizado resultado={respuesta('enviado')} onCerrar={noop} />);
    expect(screen.getByTestId('aviso-evento-finalizado')).toHaveTextContent(/post-evento/i);
    expect(screen.getByTestId('e5-enviado')).toBeInTheDocument();
    expect(screen.queryByTestId('e5-fallido')).not.toBeInTheDocument();
  });

  it('e5_fallido_muestra_la_alerta_de_reenvio_diferido_sin_boton_de_reenvio', () => {
    render(<AvisoEventoFinalizado resultado={respuesta('fallido')} onCerrar={noop} />);
    const fallido = screen.getByTestId('e5-fallido');
    expect(fallido).toHaveTextContent(/no pudo enviarse/i);
    expect(fallido).toHaveTextContent(/reenviarlo desde la ficha/i);
    // El reenvío se DIFIERE a otra US: no hay botón de reenvío en este aviso.
    expect(screen.queryByRole('button', { name: /reenviar/i })).not.toBeInTheDocument();
  });

  it('e5_no_aplica_no_menciona_el_email_E5', () => {
    render(<AvisoEventoFinalizado resultado={respuesta('no_aplica')} onCerrar={noop} />);
    expect(screen.getByTestId('aviso-evento-finalizado')).toHaveTextContent(/post-evento/i);
    expect(screen.queryByTestId('e5-enviado')).not.toBeInTheDocument();
    expect(screen.queryByTestId('e5-fallido')).not.toBeInTheDocument();
  });

  it('documentacion_pendiente_se_lista_como_advertencia_no_bloqueante', () => {
    render(
      <AvisoEventoFinalizado
        resultado={respuesta('enviado', ['dni_anverso', 'clausula_responsabilidad'])}
        onCerrar={noop}
      />,
    );
    const docs = screen.getByTestId('aviso-finalizado-documentacion');
    expect(docs).toHaveTextContent('DNI (anverso)');
    expect(docs).toHaveTextContent('Cláusula de responsabilidad');
  });

  it('sin_documentacion_pendiente_no_muestra_la_advertencia', () => {
    render(<AvisoEventoFinalizado resultado={respuesta('enviado')} onCerrar={noop} />);
    expect(screen.queryByTestId('aviso-finalizado-documentacion')).not.toBeInTheDocument();
  });
});

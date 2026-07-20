import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { components } from '@/api-client';
import { AvisosTransicion } from '../AvisosTransicion';
import type { Reserva } from '../../../../model/types';

type EstadoReserva = components['schemas']['EstadoReserva'];

/**
 * RED (change `consulta-fecha-borrador-fix`, spec-delta `consultas` — Requirement
 * "Email de confirmación de bloqueo provisional vía el motor de US-045"):
 * el aviso del resultado de la transición de fecha NO debe comunicar "email enviado"
 * (el correo E1 queda en BORRADOR pendiente de revisión/envío). Debe ser un aviso ÁMBAR
 * que indique "borrador pendiente de revisión y envío".
 *
 * Hoy la rama 2b usa estilo verde (emerald) y el texto "Se ha enviado un email de
 * confirmación al cliente" → las aserciones fallan → ROJO.
 */
const noop = () => {};

const reserva = (over: Partial<Reserva> = {}): Reserva =>
  ({
    idReserva: crypto.randomUUID(),
    codigo: 'SLO-2026-0007',
    clienteId: crypto.randomUUID(),
    estado: 'consulta' as EstadoReserva,
    subEstado: '2b',
    canalEntrada: 'web',
    fechaEvento: '2999-06-01',
    ttlExpiracion: '2999-01-01T00:00:00.000Z',
    ...over,
  }) as Reserva;

describe('AvisosTransicion — 2b comunica borrador pendiente, no "email enviado"', () => {
  it('no_dice_que_se_ha_enviado_un_email_de_confirmacion', () => {
    render(<AvisosTransicion resultado={reserva()} onCerrar={noop} />);

    const aviso = screen.getByTestId('alerta-fecha-bloqueada');
    expect(aviso.textContent ?? '').not.toMatch(/se ha enviado un email/i);
    expect(aviso.textContent ?? '').not.toMatch(/confirmación al cliente/i);
  });

  it('indica_que_hay_un_borrador_pendiente_de_revision_y_envio', () => {
    render(<AvisosTransicion resultado={reserva()} onCerrar={noop} />);

    const aviso = screen.getByTestId('alerta-fecha-bloqueada');
    expect(aviso.textContent ?? '').toMatch(/borrador/i);
    expect(aviso.textContent ?? '').toMatch(/revisi[oó]n/i);
  });

  it('usa_estilo_ambar_amber_no_verde_emerald', () => {
    render(<AvisosTransicion resultado={reserva()} onCerrar={noop} />);

    const aviso = screen.getByTestId('alerta-fecha-bloqueada');
    expect(aviso.className).toMatch(/amber/);
    expect(aviso.className).not.toMatch(/emerald/);
  });
});

describe('AvisosTransicion — 2d (cola) sigue sin prometer envío de email', () => {
  it('no_dice_que_se_ha_enviado_un_email_en_la_rama_de_cola', () => {
    render(
      <AvisosTransicion resultado={reserva({ subEstado: '2d', posicionCola: 2 } as Partial<Reserva>)} onCerrar={noop} />,
    );

    const aviso = screen.getByTestId('alerta-cola');
    expect(aviso.textContent ?? '').not.toMatch(/se ha enviado un email/i);
    expect(aviso.textContent ?? '').toMatch(/borrador/i);
  });
});

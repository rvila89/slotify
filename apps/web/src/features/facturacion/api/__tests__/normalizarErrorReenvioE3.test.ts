import { describe, expect, it } from 'vitest';
import { normalizarErrorReenvioE3 } from '../normalizarErrorReenvioE3';

/**
 * US-023 · GAP 3 — mapeo 1:1 de los `codigo` del contrato (envelope `FacturaSenalEnvioError`) a la
 * unión `ReenvioE3Error` en español, con fallback por status.
 */
describe('normalizarErrorReenvioE3', () => {
  it('E3_NO_ENVIADO_PREVIAMENTE_409', () => {
    const e = normalizarErrorReenvioE3(409, {
      codigo: 'E3_NO_ENVIADO_PREVIAMENTE',
      motivo: 'No hay un E3 enviado previamente que reenviar.',
    });
    expect(e.tipo).toBe('no-enviado-previamente');
    expect(e.mensaje).toContain('E3 enviado previamente');
  });

  it('FACTURA_SENAL_NO_ENCONTRADA_404', () => {
    const e = normalizarErrorReenvioE3(404, { codigo: 'FACTURA_SENAL_NO_ENCONTRADA' });
    expect(e.tipo).toBe('no-encontrada');
  });

  it('EMISION_ENVIO_FALLIDO_502_recuperable', () => {
    const e = normalizarErrorReenvioE3(502, { codigo: 'EMISION_ENVIO_FALLIDO' });
    expect(e.tipo).toBe('envio-fallido');
    expect(e.mensaje).toContain('inténtalo de nuevo');
  });

  it('EMISION_ENVIO_FALLIDO_503_recuperable', () => {
    const e = normalizarErrorReenvioE3(503, { codigo: 'EMISION_ENVIO_FALLIDO' });
    expect(e.tipo).toBe('envio-fallido');
  });

  it('usa_message_array_cuando_no_hay_motivo', () => {
    const e = normalizarErrorReenvioE3(409, {
      codigo: 'E3_NO_ENVIADO_PREVIAMENTE',
      message: ['Nada', 'que', 'reenviar'],
    });
    expect(e.mensaje).toBe('Nada que reenviar');
  });

  it('fallback_por_status_sin_codigo', () => {
    expect(normalizarErrorReenvioE3(404, {}).tipo).toBe('no-encontrada');
    expect(normalizarErrorReenvioE3(409, {}).tipo).toBe('no-enviado-previamente');
    expect(normalizarErrorReenvioE3(502, {}).tipo).toBe('envio-fallido');
    expect(normalizarErrorReenvioE3(503, {}).tipo).toBe('envio-fallido');
  });

  it('generico_para_status_no_mapeado_o_red', () => {
    expect(normalizarErrorReenvioE3(500, undefined).tipo).toBe('generico');
    expect(normalizarErrorReenvioE3(undefined, undefined).tipo).toBe('generico');
  });
});

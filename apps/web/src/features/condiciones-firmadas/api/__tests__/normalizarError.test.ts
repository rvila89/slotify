import { describe, expect, it } from 'vitest';
import { normalizarErrorCondicionesFirmadas } from '../normalizarError';

/**
 * US-024 — mapeo 1:1 de los `codigo` del contrato (409 conflicto / 422 validación) a la
 * unión `CondicionesFirmadasError` en español, con fallback por status.
 */
describe('normalizarErrorCondicionesFirmadas', () => {
  it('CONDICIONES_NO_ENVIADAS_409', () => {
    const e = normalizarErrorCondicionesFirmadas(409, { codigo: 'CONDICIONES_NO_ENVIADAS' });
    expect(e.tipo).toBe('condiciones-no-enviadas');
    expect(e.mensaje).toContain('no han sido enviadas');
  });

  it('ESTADO_INVALIDO_422', () => {
    const e = normalizarErrorCondicionesFirmadas(422, { codigo: 'ESTADO_INVALIDO' });
    expect(e.tipo).toBe('estado-invalido');
    expect(e.mensaje).toContain('estado terminal');
  });

  it('CONDICIONES_REQUERIDAS_422', () => {
    const e = normalizarErrorCondicionesFirmadas(422, { codigo: 'CONDICIONES_REQUERIDAS' });
    expect(e.tipo).toBe('condiciones-requeridas');
  });

  it('FORMATO_NO_PERMITIDO_422', () => {
    const e = normalizarErrorCondicionesFirmadas(422, { codigo: 'FORMATO_NO_PERMITIDO' });
    expect(e.tipo).toBe('formato-no-permitido');
    expect(e.mensaje).toContain('JPG');
  });

  it('TAMANO_EXCEDIDO_422', () => {
    const e = normalizarErrorCondicionesFirmadas(422, { codigo: 'TAMANO_EXCEDIDO' });
    expect(e.tipo).toBe('tamano-excedido');
    expect(e.mensaje).toContain('10 MB');
  });

  it('usa_message_del_envelope_cuando_llega', () => {
    const e = normalizarErrorCondicionesFirmadas(422, {
      codigo: 'ESTADO_INVALIDO',
      message: 'Mensaje del servidor',
    });
    expect(e.mensaje).toBe('Mensaje del servidor');
  });

  it('fallback_por_status_409_sin_codigo', () => {
    const e = normalizarErrorCondicionesFirmadas(409, {});
    expect(e.tipo).toBe('condiciones-no-enviadas');
  });

  it('fallback_por_status_422_sin_codigo', () => {
    const e = normalizarErrorCondicionesFirmadas(422, {});
    expect(e.tipo).toBe('estado-invalido');
  });

  it('generico_para_otros_status', () => {
    const e = normalizarErrorCondicionesFirmadas(500, undefined);
    expect(e.tipo).toBe('generico');
  });
});

import { describe, expect, it } from 'vitest';
import { normalizarErrorDevolucionFianza } from '../normalizarErrorDevolucionFianza';

/**
 * US-036 — mapeo 1:1 de los `codigo` del contrato a la unión `DevolucionFianzaError` en español.
 */
describe('normalizarErrorDevolucionFianza', () => {
  it('IMPORTE_SUPERA_FIANZA_400_FA02', () => {
    const e = normalizarErrorDevolucionFianza(400, {
      codigo: 'IMPORTE_SUPERA_FIANZA',
      motivo: 'El importe a devolver (1.500,00 €) no puede superar la fianza cobrada (1.000,00 €)',
    });
    expect(e.tipo).toBe('importe-supera-fianza');
    expect(e.mensaje).toContain('no puede superar');
  });

  it('FECHA_DEVOLUCION_INVALIDA_400_FA03', () => {
    const e = normalizarErrorDevolucionFianza(400, { codigo: 'FECHA_DEVOLUCION_INVALIDA' });
    expect(e.tipo).toBe('fecha-invalida');
  });

  it('MOTIVO_RETENCION_REQUERIDO_400', () => {
    const e = normalizarErrorDevolucionFianza(400, { codigo: 'MOTIVO_RETENCION_REQUERIDO' });
    expect(e.tipo).toBe('motivo-requerido');
  });

  it('JUSTIFICANTE_NO_ENCONTRADO_404', () => {
    const e = normalizarErrorDevolucionFianza(404, { codigo: 'JUSTIFICANTE_NO_ENCONTRADO' });
    expect(e.tipo).toBe('justificante-no-encontrado');
  });

  it('PRECONDICION_NO_CUMPLIDA_409', () => {
    const e = normalizarErrorDevolucionFianza(409, { codigo: 'PRECONDICION_NO_CUMPLIDA' });
    expect(e.tipo).toBe('precondicion-no-cumplida');
  });

  it('DEVOLUCION_YA_REGISTRADA_409_doble_registro', () => {
    const e = normalizarErrorDevolucionFianza(409, { codigo: 'DEVOLUCION_YA_REGISTRADA' });
    expect(e.tipo).toBe('ya-registrada');
  });

  it('fallback_por_status_sin_codigo', () => {
    expect(normalizarErrorDevolucionFianza(400, {}).tipo).toBe('importe-supera-fianza');
    expect(normalizarErrorDevolucionFianza(404, {}).tipo).toBe('justificante-no-encontrado');
    expect(normalizarErrorDevolucionFianza(409, {}).tipo).toBe('precondicion-no-cumplida');
  });

  it('generico_para_status_no_mapeado_o_red', () => {
    expect(normalizarErrorDevolucionFianza(500, undefined).tipo).toBe('generico');
    expect(normalizarErrorDevolucionFianza(undefined, undefined).tipo).toBe('generico');
  });
});

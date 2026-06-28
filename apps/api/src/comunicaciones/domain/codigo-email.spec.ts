/**
 * Test de CONTRATO de los tipos de dominio `CodigoEmail` y `EstadoComunicacion`
 * (US-045). Tipos puros (sin framework/ORM): aquí se fija la FORMA de la unión de
 * literales que el resto del motor consume. El comportamiento real se ejercita en
 * el catálogo, el repositorio y el motor.
 */
import type { CodigoEmail, EstadoComunicacion } from './codigo-email';

describe('CodigoEmail / EstadoComunicacion — contrato de tipos de dominio', () => {
  it('debe_admitir_los_codigos_E1_a_E8_y_manual', () => {
    const codigos: CodigoEmail[] = ['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8', 'manual'];
    expect(codigos).toHaveLength(9);
    expect(codigos[0]).toBe('E1');
  });

  it('debe_admitir_los_estados_borrador_enviado_y_fallido', () => {
    const estados: EstadoComunicacion[] = ['borrador', 'enviado', 'fallido'];
    expect(estados).toEqual(['borrador', 'enviado', 'fallido']);
  });
});

/**
 * Test de CONTRATO del puerto de dominio `TenantSettingsPort` del motor de email
 * (US-045). Puerto PURO: el motor resuelve el idioma del tenant a través de él
 * (`TENANT_SETTINGS.idioma`, default `es`). La implementación Prisma vive en
 * infraestructura; aquí se fija la forma del contrato.
 */
import type { TenantSettingsPort } from './tenant-settings.port';

const TENANT = '00000000-0000-0000-0000-000000000001';

describe('TenantSettingsPort — contrato del puerto de dominio', () => {
  it('debe_aceptar_una_implementacion_que_devuelva_el_idioma_o_null', async () => {
    const conIdioma: TenantSettingsPort = { obtenerIdioma: async () => 'ca' };
    const sinIdioma: TenantSettingsPort = { obtenerIdioma: async () => null };

    expect(await conIdioma.obtenerIdioma(TENANT)).toBe('ca');
    expect(await sinIdioma.obtenerIdioma(TENANT)).toBeNull();
  });
});

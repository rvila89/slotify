/**
 * TEST del adaptador dev/local `AlmacenDocumentosLocalAdapter` (épico #6, rebanada
 * 6.1a `documentos-config-tenant-storage`). tasks.md Fase 2: 2.1 (parte de infra).
 *
 * Trazabilidad: spec-delta `documentos` (Requirement "Adaptador de almacén
 * configurable por entorno sin credenciales en tests"; Scenario "Los tests no
 * requieren credenciales cloud"), design.md cuestión abierta B (decisión B1:
 * adaptador dev/local ahora, cloud cuando haya credenciales).
 *
 * Verifica que el adaptador local cumple el contrato de `AlmacenDocumentosPort`
 * SIN credenciales cloud (regla dura B1): tras `subir`, `urlPublica` de la misma
 * clave devuelve una URL para ese objeto; claves distintas → URLs distintas.
 * Vive en `infrastructure/__tests__/` porque importa el adaptador concreto de
 * infraestructura (el contrato puro del puerto se prueba en `domain/__tests__/`).
 */
import type { AlmacenDocumentosPort } from '../../domain/almacen-documentos.port';
import { AlmacenDocumentosLocalAdapter } from '../almacen-documentos-local.adapter';

const CLAVE = 'tenants/00000000-0000-0000-0000-000000000001/logo.png';
const BYTES = Buffer.from('PNG-FAKE-BYTES');

describe('AlmacenDocumentosLocalAdapter — adaptador dev/local sin credenciales cloud (2.1)', () => {
  it('debe_implementar_el_puerto_de_dominio_AlmacenDocumentosPort', () => {
    // Arrange / Act
    const adaptador: AlmacenDocumentosPort = new AlmacenDocumentosLocalAdapter();

    // Assert
    expect(typeof adaptador.subir).toBe('function');
    expect(typeof adaptador.urlPublica).toBe('function');
  });

  it('debe_subir_bytes_bajo_una_clave_y_resolver_una_url_sin_credenciales_cloud', async () => {
    // Arrange
    const adaptador = new AlmacenDocumentosLocalAdapter();

    // Act
    const url = await adaptador.subir(BYTES, CLAVE);

    // Assert
    expect(typeof url).toBe('string');
    expect(url.length).toBeGreaterThan(0);
  });

  it('debe_devolver_urlPublica_para_la_misma_clave_previamente_subida', async () => {
    // Arrange
    const adaptador = new AlmacenDocumentosLocalAdapter();

    // Act
    const urlSubida = await adaptador.subir(BYTES, CLAVE);
    const urlPublica = adaptador.urlPublica(CLAVE);

    // Assert — la URL pública referencia la MISMA clave que se subió.
    expect(urlPublica).toContain(CLAVE);
    expect(urlPublica).toBe(urlSubida);
  });

  it('debe_generar_claves_publicas_distintas_para_claves_distintas', async () => {
    // Arrange
    const adaptador = new AlmacenDocumentosLocalAdapter();
    const claveA = 'tenants/a/logo.png';
    const claveB = 'tenants/b/logo.png';

    // Act
    await adaptador.subir(BYTES, claveA);
    await adaptador.subir(BYTES, claveB);

    // Assert
    expect(adaptador.urlPublica(claveA)).not.toBe(adaptador.urlPublica(claveB));
  });
});

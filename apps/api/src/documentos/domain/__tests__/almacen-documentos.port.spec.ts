/**
 * TEST del CONTRATO del puerto de dominio `AlmacenDocumentosPort` (épico #6,
 * rebanada 6.1a `documentos-config-tenant-storage`). tasks.md Fase 2: 2.1.
 *
 * Trazabilidad: spec-delta `documentos` (Requirement "Puerto de dominio para el
 * almacén de documentos"; Scenarios "subir devuelve una URL referenciable",
 * "El puerto vive en el dominio sin acoplarse a infraestructura"), design.md
 * §Arquitectura hexagonal.
 *
 * Este spec es PURO de dominio: verifica la forma del contrato con un doble
 * in-memory y NO importa infraestructura (mantiene `domain/` sin acoplarse a
 * infra; hook `no-infra-in-domain` + regla depcruise). La conformidad del
 * adaptador dev/local concreto se prueba en
 * `infrastructure/__tests__/almacen-documentos-local.adapter.spec.ts`.
 */
import type { AlmacenDocumentosPort } from '../almacen-documentos.port';

const CLAVE = 'tenants/00000000-0000-0000-0000-000000000001/logo.png';
const BYTES = Buffer.from('PNG-FAKE-BYTES');

describe('AlmacenDocumentosPort — contrato del puerto de dominio (2.1)', () => {
  it('debe_aceptar_una_implementacion_que_suba_bytes_y_resuelva_una_url', async () => {
    // Arrange — doble in-memory que implementa el puerto (sin tocar red ni disco).
    const subidos = new Map<string, Uint8Array>();
    const doble: AlmacenDocumentosPort = {
      subir: async (bytes, clave) => {
        subidos.set(clave, bytes);
        return `mem://${clave}`;
      },
      urlPublica: (clave) => `mem://${clave}`,
    };

    // Act
    const url = await doble.subir(BYTES, CLAVE);

    // Assert — subir resuelve una URL referenciable y urlPublica coincide.
    expect(typeof url).toBe('string');
    expect(url).toContain(CLAVE);
    expect(doble.urlPublica(CLAVE)).toBe(url);
    expect(subidos.has(CLAVE)).toBe(true);
  });
});

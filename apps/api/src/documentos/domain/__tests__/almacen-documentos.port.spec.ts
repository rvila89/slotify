/**
 * TEST del CONTRATO del puerto de dominio `AlmacenDocumentosPort` (épico #6,
 * rebanada 6.1a `documentos-config-tenant-storage`; ampliado en 6.5
 * `documentos-rediseno-pdf-logo-storage`). tasks.md Fase 2: 2.1.
 *
 * Trazabilidad: spec-delta `documentos` (Requirement "Puerto de dominio para el
 * almacén de documentos"; Scenarios "subir devuelve una URL referenciable",
 * "El puerto vive en el dominio sin acoplarse a infraestructura"), design.md
 * §Arquitectura hexagonal y §B (decisión gate 6.5): el puerto gana la operación
 * de LECTURA `obtener(clave): Promise<Uint8Array | null>` (el storage lee y
 * escribe), usada para cargar los bytes del logo en el render por data-URI.
 *
 * Este spec es PURO de dominio: verifica la forma del contrato con un doble
 * in-memory y NO importa infraestructura (mantiene `domain/` sin acoplarse a
 * infra; hook `no-infra-in-domain` + regla depcruise). La conformidad del
 * adaptador dev/local concreto se prueba en
 * `infrastructure/__tests__/almacen-documentos-local.adapter.spec.ts`.
 *
 * RED 6.5: el puerto todavía no declara `obtener`, así que el doble que lo
 * implementa no es asignable a `AlmacenDocumentosPort` (error de tipos) y el
 * contrato no garantiza `obtener`. GREEN = añadir `obtener` a la interfaz.
 */
import type { AlmacenDocumentosPort } from '../almacen-documentos.port';

const CLAVE = 'tenants/00000000-0000-0000-0000-000000000001/logo.png';
const BYTES = Buffer.from('PNG-FAKE-BYTES');

/** Doble in-memory que implementa el contrato completo (subir + obtener + url). */
const crearAlmacenFalso = (): AlmacenDocumentosPort => {
  const subidos = new Map<string, Uint8Array>();
  return {
    subir: async (bytes, clave) => {
      subidos.set(clave, bytes);
      return `mem://${clave}`;
    },
    obtener: async (clave) => subidos.get(clave) ?? null,
    urlPublica: (clave) => `mem://${clave}`,
  };
};

describe('AlmacenDocumentosPort — contrato del puerto de dominio (2.1 / 6.5)', () => {
  it('debe_aceptar_una_implementacion_que_suba_bytes_y_resuelva_una_url', async () => {
    // Arrange — doble in-memory que implementa el puerto (sin tocar red ni disco).
    const doble = crearAlmacenFalso();

    // Act
    const url = await doble.subir(BYTES, CLAVE);

    // Assert — subir resuelve una URL referenciable y urlPublica coincide.
    expect(typeof url).toBe('string');
    expect(url).toContain(CLAVE);
    expect(doble.urlPublica(CLAVE)).toBe(url);
  });

  it('debe_declarar_la_operacion_de_lectura_obtener_en_el_contrato', () => {
    // Arrange / Act
    const doble = crearAlmacenFalso();

    // Assert — el contrato incluye lectura (`obtener`) además de escritura.
    expect(typeof doble.subir).toBe('function');
    expect(typeof doble.obtener).toBe('function');
    expect(typeof doble.urlPublica).toBe('function');
  });

  it('debe_devolver_por_obtener_los_bytes_previamente_subidos', async () => {
    // Arrange
    const doble = crearAlmacenFalso();

    // Act
    await doble.subir(BYTES, CLAVE);
    const leidos = await doble.obtener(CLAVE);

    // Assert
    expect(leidos).toEqual(BYTES);
  });

  it('debe_devolver_null_por_obtener_cuando_la_clave_no_existe', async () => {
    // Arrange
    const doble = crearAlmacenFalso();

    // Act
    const leidos = await doble.obtener('clave/inexistente.png');

    // Assert
    expect(leidos).toBeNull();
  });
});

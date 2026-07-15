/**
 * TEST del adaptador local durable `AlmacenDocumentosLocalAdapter` (épico #6).
 * Actualizado en la rebanada 6.5 `documentos-rediseno-pdf-logo-storage`
 * (tasks.md Fase 2: 2.1). RED.
 *
 * Trazabilidad: proposal.md Bloque A (storage durable en disco), design.md §A
 * (decisión gate: `@nestjs/serve-static` sirve `ALMACEN_LOCAL_DIR`) y §B
 * (decisión gate: el puerto gana `obtener(clave): Promise<Uint8Array | null>`,
 * implementado leyendo de disco).
 *
 * El adaptador YA NO guarda en memoria (`Map`): PERSISTE a disco bajo un
 * directorio configurable (constructor `dir` + `baseUrl`, o `ALMACEN_LOCAL_DIR`).
 * `subir` escribe el fichero creando subdirectorios de la clave; `obtener` relee
 * los MISMOS bytes del disco (o `null` si no existe); la durabilidad se prueba
 * con una instancia NUEVA apuntando al MISMO dir. `urlPublica` sigue siendo
 * determinista desde `baseUrl` (contrato sin cambios).
 *
 * Sin Postgres: usa un temp dir bajo `os.tmpdir()`, limpiado en afterEach.
 */
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';

import type { AlmacenDocumentosPort } from '../../domain/almacen-documentos.port';
import { AlmacenDocumentosLocalAdapter } from '../almacen-documentos-local.adapter';

const CLAVE = 'logos/00000000-0000-0000-0000-000000000001.jpg';
const BYTES = Buffer.from('JPG-FAKE-BYTES-\x00\x01\x02');
const BASE_URL = 'http://localhost:3000/almacen';

describe('AlmacenDocumentosLocalAdapter — almacén local durable a disco (6.5, 2.1)', () => {
  let dir: string;

  beforeEach(async () => {
    dir = await fs.mkdtemp(path.join(os.tmpdir(), 'slotify-almacen-'));
  });

  afterEach(async () => {
    await fs.rm(dir, { recursive: true, force: true });
  });

  it('debe_implementar_el_puerto_de_dominio_incluyendo_obtener', () => {
    // Arrange / Act
    const adaptador: AlmacenDocumentosPort = new AlmacenDocumentosLocalAdapter(
      dir,
      BASE_URL,
    );

    // Assert — el puerto durable expone subir, obtener y urlPublica.
    expect(typeof adaptador.subir).toBe('function');
    expect(typeof adaptador.obtener).toBe('function');
    expect(typeof adaptador.urlPublica).toBe('function');
  });

  it('debe_escribir_el_fichero_a_disco_bajo_el_dir_creando_subdirectorios_de_la_clave', async () => {
    // Arrange
    const adaptador = new AlmacenDocumentosLocalAdapter(dir, BASE_URL);

    // Act
    await adaptador.subir(BYTES, CLAVE);

    // Assert — existe el fichero físico bajo dir/{clave} (con subdir logos/).
    const rutaEsperada = path.join(dir, CLAVE);
    const contenido = await fs.readFile(rutaEsperada);
    expect(Buffer.from(contenido)).toEqual(BYTES);
  });

  it('debe_devolver_por_obtener_los_MISMOS_bytes_que_se_subieron', async () => {
    // Arrange
    const adaptador = new AlmacenDocumentosLocalAdapter(dir, BASE_URL);

    // Act
    await adaptador.subir(BYTES, CLAVE);
    const leidos = await adaptador.obtener(CLAVE);

    // Assert
    expect(leidos).not.toBeNull();
    expect(Buffer.from(leidos as Uint8Array)).toEqual(BYTES);
  });

  it('debe_devolver_null_por_obtener_cuando_la_clave_no_existe', async () => {
    // Arrange
    const adaptador = new AlmacenDocumentosLocalAdapter(dir, BASE_URL);

    // Act
    const leidos = await adaptador.obtener('clave/inexistente.jpg');

    // Assert
    expect(leidos).toBeNull();
  });

  it('debe_persistir_entre_instancias_una_instancia_nueva_lee_lo_que_otra_subio', async () => {
    // Arrange — una instancia sube; OTRA instancia (mismo dir) debe poder leer.
    const escritor = new AlmacenDocumentosLocalAdapter(dir, BASE_URL);
    await escritor.subir(BYTES, CLAVE);

    // Act — instancia NUEVA apuntando al MISMO dir (no memoria por-instancia).
    const lector = new AlmacenDocumentosLocalAdapter(dir, BASE_URL);
    const leidos = await lector.obtener(CLAVE);

    // Assert
    expect(leidos).not.toBeNull();
    expect(Buffer.from(leidos as Uint8Array)).toEqual(BYTES);
  });

  it('debe_derivar_urlPublica_determinista_desde_baseUrl_para_la_misma_clave', async () => {
    // Arrange
    const adaptador = new AlmacenDocumentosLocalAdapter(dir, BASE_URL);

    // Act
    const urlSubida = await adaptador.subir(BYTES, CLAVE);
    const urlPublica = adaptador.urlPublica(CLAVE);

    // Assert — la URL referencia la MISMA clave y coincide con la de subir.
    expect(urlPublica).toContain(CLAVE);
    expect(urlPublica).toBe(urlSubida);
    expect(urlPublica).toBe(`${BASE_URL}/${CLAVE}`);
  });

  it('debe_componer_urlPublica_sin_barra_final_duplicada_aunque_baseUrl_la_tenga', () => {
    // Arrange — baseUrl con barra final: no debe duplicarse en la URL.
    const adaptador = new AlmacenDocumentosLocalAdapter(dir, `${BASE_URL}/`);

    // Act
    const url = adaptador.urlPublica(CLAVE);

    // Assert
    expect(url).toBe(`${BASE_URL}/${CLAVE}`);
    expect(url).not.toContain('//logos');
  });

  it('debe_generar_urls_publicas_distintas_para_claves_distintas', async () => {
    // Arrange
    const adaptador = new AlmacenDocumentosLocalAdapter(dir, BASE_URL);
    const claveA = 'logos/a.jpg';
    const claveB = 'logos/b.jpg';

    // Act
    await adaptador.subir(BYTES, claveA);
    await adaptador.subir(BYTES, claveB);

    // Assert
    expect(adaptador.urlPublica(claveA)).not.toBe(adaptador.urlPublica(claveB));
  });
});

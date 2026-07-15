/**
 * Adaptador dev/local DURABLE de `AlmacenDocumentosPort` (épico #6, rebanada 6.1a
 * `documentos-config-tenant-storage`; hecho durable en 6.5
 * `documentos-rediseno-pdf-logo-storage`).
 *
 * Decisión B1: implementación sin credenciales cloud, seleccionable por env
 * (`ALMACEN_PROVIDER=local`). Desde 6.5 PERSISTE a DISCO bajo un directorio
 * configurable (`ALMACEN_LOCAL_DIR`), no en memoria: `subir(bytes, clave)`
 * escribe el fichero creando los subdirectorios de la clave; `obtener(clave)`
 * relee los MISMOS bytes del disco (o `null` si no existe), y la durabilidad
 * sobrevive a reinicios y a instancias distintas apuntando al mismo dir.
 * `urlPublica(clave)` sigue derivando la URL de forma determinista desde
 * `baseUrl` (`ALMACEN_LOCAL_BASE_URL`), coherente con la ruta estática
 * `GET /almacen/*` (design.md §A). El adaptador cloud real (S3/Supabase) se
 * añadirá como hermano cuando haya bucket, sin tocar el dominio.
 *
 * `baseUrl` es opcional para que los tests instancien sin configuración de URL;
 * `dir` es obligatorio (el almacén escribe en algún sitio del disco). En runtime
 * el módulo inyecta ambos desde `ALMACEN_LOCAL_DIR` y `ALMACEN_LOCAL_BASE_URL`.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';

import type { AlmacenDocumentosPort } from '../domain/almacen-documentos.port';

const BASE_URL_POR_DEFECTO = 'http://localhost:3000/almacen';

export class AlmacenDocumentosLocalAdapter implements AlmacenDocumentosPort {
  private readonly dir: string;
  private readonly baseUrl: string;

  constructor(dir: string, baseUrl: string = BASE_URL_POR_DEFECTO) {
    this.dir = dir;
    // Normaliza sin barra final para componer la URL de forma estable.
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async subir(bytes: Uint8Array, clave: string): Promise<string> {
    const ruta = this.rutaDeClave(clave);
    await fs.mkdir(path.dirname(ruta), { recursive: true });
    await fs.writeFile(ruta, bytes);
    return this.urlPublica(clave);
  }

  async obtener(clave: string): Promise<Uint8Array | null> {
    try {
      const contenido = await fs.readFile(this.rutaDeClave(clave));
      return new Uint8Array(contenido);
    } catch (error) {
      // Clave inexistente → null (no es un error del almacén). Cualquier otro
      // fallo de E/S se propaga.
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return null;
      }
      throw error;
    }
  }

  urlPublica(clave: string): string {
    return `${this.baseUrl}/${this.claveNormalizada(clave)}`;
  }

  /**
   * Ruta física del fichero para una clave (bajo el dir del almacén). Blinda
   * contra path traversal: la ruta resuelta debe quedar ESTRICTAMENTE dentro del
   * dir del almacén. Claves con `..`, absolutas o que apunten al propio dir se
   * rechazan (defensa en profundidad; hoy las claves son internas y controladas,
   * pero el puerto es genérico).
   */
  private rutaDeClave(clave: string): string {
    const base = path.resolve(this.dir);
    const ruta = path.resolve(base, this.claveNormalizada(clave));
    const rel = path.relative(base, ruta);
    if (rel === '' || rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(
        `Clave de almacén inválida (fuera del directorio permitido): "${clave}"`,
      );
    }
    return ruta;
  }

  /** Clave sin barra inicial (evita rutas/URLs con barra duplicada). */
  private claveNormalizada(clave: string): string {
    return clave.replace(/^\/+/, '');
  }
}

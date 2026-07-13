/**
 * Adaptador dev/local de `AlmacenDocumentosPort` (épico #6, rebanada 6.1a
 * `documentos-config-tenant-storage`).
 *
 * Decisión B1: implementación sin credenciales cloud, seleccionable por env
 * (`ALMACEN_PROVIDER=local`). Guarda los bytes en memoria (dev/tests) y deriva
 * la URL pública de forma determinista a partir de la clave: tras `subir`,
 * `urlPublica(clave)` devuelve la MISMA URL; claves distintas → URLs distintas.
 * El adaptador cloud real (S3/Supabase) se añadirá como hermano cuando haya
 * bucket, sin tocar el dominio.
 *
 * `baseUrl` es opcional para que los tests instancien sin configuración
 * (`new AlmacenDocumentosLocalAdapter()`); en runtime el módulo inyecta la base
 * desde `ALMACEN_LOCAL_BASE_URL`.
 */
import type { AlmacenDocumentosPort } from '../domain/almacen-documentos.port';

const BASE_URL_POR_DEFECTO = 'http://localhost:3000/almacen';

export class AlmacenDocumentosLocalAdapter implements AlmacenDocumentosPort {
  private readonly baseUrl: string;
  private readonly objetos = new Map<string, Uint8Array>();

  constructor(baseUrl: string = BASE_URL_POR_DEFECTO) {
    // Normaliza sin barra final para componer la URL de forma estable.
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async subir(bytes: Uint8Array, clave: string): Promise<string> {
    this.objetos.set(clave, bytes);
    return this.urlPublica(clave);
  }

  urlPublica(clave: string): string {
    const claveNormalizada = clave.replace(/^\/+/, '');
    return `${this.baseUrl}/${claveNormalizada}`;
  }
}

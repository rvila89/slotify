/**
 * Puerto de dominio del almacén de objetos de documentos (épico #6, rebanada
 * 6.1a `documentos-config-tenant-storage`).
 *
 * Interfaz PURA de dominio: abstrae el almacenamiento (logo del tenant ahora,
 * PDFs generados en 6.1b) SIN conocer el proveedor concreto (S3, Supabase,
 * filesystem). El dominio depende solo de esta interfaz; los adaptadores viven
 * en infraestructura y se seleccionan por env (`ALMACEN_PROVIDER`). No importa
 * `@nestjs`, Prisma ni SDK cloud (hook `no-infra-in-domain`).
 */
export interface AlmacenDocumentosPort {
  /**
   * Persiste `bytes` bajo `clave` y resuelve la URL con la que referenciar el
   * objeto subido.
   */
  subir(bytes: Uint8Array, clave: string): Promise<string>;

  /** Devuelve la URL pública/accesible de una `clave` existente. */
  urlPublica(clave: string): string;
}

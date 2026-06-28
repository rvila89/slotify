/**
 * Puerto de DOMINIO `TenantSettingsPort` del motor de email (US-045 / UC-35).
 *
 * Interfaz PURA (sin `@nestjs/*`, Prisma ni infraestructura): el motor resuelve el
 * idioma de la plantilla desde `TENANT_SETTINGS.idioma` a través de este puerto. El
 * adaptador Prisma vive en infraestructura. Devuelve `null` si el tenant no tiene
 * idioma configurado (el motor cae a `es` por defecto).
 */
export interface TenantSettingsPort {
  /** Idioma configurado del tenant (`TENANT_SETTINGS.idioma`) o `null`. */
  obtenerIdioma(tenantId: string): Promise<string | null>;
}

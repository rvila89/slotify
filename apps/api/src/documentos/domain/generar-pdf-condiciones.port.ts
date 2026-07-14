/**
 * Puerto de dominio de generación del PDF de "Condicions particulars" (épico #6,
 * rebanada 6.4a `documentos-condiciones-particulares-pdf`).
 *
 * Interfaz PURA de dominio (sin `@nestjs`, Prisma ni react-pdf; hook
 * `no-infra-in-domain`). El documento es LEGAL, largo e IDÉNTICO por tenant; se
 * genera on-demand con clave fija `condiciones/{tenantId}.pdf` y se reutiliza.
 * Devuelve la URL del PDF o `null` cuando degrada (sin config del tenant o sin
 * secciones — D3). Token de inyección `GENERAR_PDF_CONDICIONES_PORT`.
 */
export interface GenerarPdfCondicionesPort {
  generar(params: { tenantId: string }): Promise<string | null>;
}

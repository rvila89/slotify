/**
 * Puerto de dominio de generación del PDF de "Condicions particulars" (épico #6,
 * rebanada 6.4a `documentos-condiciones-particulares-pdf`).
 *
 * Interfaz PURA de dominio (sin `@nestjs`, Prisma ni react-pdf; hook
 * `no-infra-in-domain`). El documento es LEGAL y largo; se genera on-demand y se
 * reutiliza. La clave diferencia por tenant e IDIOMA (`condiciones/{tenantId}-{idioma}.pdf`,
 * Mejora A): dos reservas del mismo tenant con idiomas distintos NO comparten PDF; el
 * `idioma` selecciona además el texto del JSON bilingüe en el renderizador.
 * Devuelve la URL del PDF o `null` cuando degrada (sin config del tenant o sin
 * secciones — D3). Token de inyección `GENERAR_PDF_CONDICIONES_PORT`.
 */
export interface GenerarPdfCondicionesPort {
  generar(params: { tenantId: string; idioma: 'es' | 'ca' }): Promise<string | null>;
}

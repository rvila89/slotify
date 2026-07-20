/**
 * Helper PURO de APLICACIÓN `textoPlanoAHtml` (change `consulta-fecha-borrador-fix`,
 * design.md §D-2).
 *
 * Convierte un cuerpo de correo en TEXTO PLANO (con saltos de línea `\n`) a HTML
 * preservando el formato para el cliente de correo:
 *   - Escape HTML de los caracteres especiales (evita email content injection).
 *   - `\n\n` → separación de párrafos `<p>…</p>`.
 *   - `\n` simple (dentro de un párrafo) → `<br>`.
 *
 * Módulo PURO y compartido: sin dependencias de framework ni de infraestructura (no
 * importa `@nestjs/*` ni `@prisma/*`). Lo reutilizan el CATÁLOGO de plantillas (que ya
 * generaba este mismo HTML dentro de cada render) y el BORDE DE ENVÍO (adaptador de
 * transporte), de modo que un cuerpo texto plano (E1 de transición / email manual) llega
 * al cliente con el formato preservado. El `htmlEscape` se centraliza aquí y se reexporta
 * para que el catálogo produzca EXACTAMENTE el mismo escape (sin cambiar el HTML actual).
 */

/**
 * Escapa los caracteres HTML especiales del texto de usuario antes de interpolarlo en
 * HTML. Previene email content injection cuando el valor viene de input externo (p. ej.
 * el nombre del cliente o el cuerpo editado por el gestor).
 */
export const htmlEscape = (s: string): string =>
  s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');

/**
 * Convierte texto plano a HTML preservando párrafos (`\n\n`) y saltos de línea simples
 * (`\n`), escapando siempre el marcado del usuario. Puro y determinista.
 *
 * - Un texto vacío produce cadena vacía (HTML coherente, no mal formado).
 * - Un texto sin saltos produce un único `<p>…</p>`.
 * - El orden de los párrafos se conserva.
 */
export const textoPlanoAHtml = (texto: string): string =>
  texto === ''
    ? ''
    : texto
        .split('\n\n')
        .map((parrafo) => `<p>${htmlEscape(parrafo).replace(/\n/g, '<br>')}</p>`)
        .join('');

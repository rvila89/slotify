# QA Report — pdf-presupuesto-horario-idioma

Ejecutado desde la sesión principal (con Postgres real; los subagentes no tienen BD).
BD de test aislada del worktree: `slotify_test_pdf` (localhost:5432).

## 1. Migración bilingüe (contra Postgres real)
- `pnpm prisma migrate deploy` aplicó todas las migraciones, incluida `20260720120000_documento_textos_bilingues`. **OK**.
- Esquema resultante de `plantilla_documento_tenant` verificado (`\d`):
  - Columnas nuevas NOT NULL: `plantilla_concepto_fiscal_ca/_es`, `validesa_texto_ca/_es`, `pie_legal_ca/_es`.
  - Columnas monolingües antiguas **eliminadas** (`plantilla_concepto_fiscal`, `validesa_texto`, `pie_legal`). **OK** (decisión del gate: DROP en la misma migración).
  - `condiciones` (jsonb) migrado a estructura bilingüe `{ca,es}`.
- Backfill: la migración copia `_ca = <columna monolingüe>` y `_es = _ca` (placeholder), y el reseed fija el `es` real. Verificado por lógica del SQL (tabla fresca en test ⇒ el seed inserta ya bilingüe).

## 2. Seed piloto bilingüe (contra Postgres real)
- `pnpm prisma db seed` → OK. Datos verificados en BD:
  - concepto: ca `Gestió ús espai de {nombreComercial} per esdeveniment` / es `Gestión de uso del espacio de {nombreComercial} para evento`.
  - validesa: `10 DIES` / `10 DÍAS`.
  - condiciones.titulo: `Condicions Particulars` / `Condiciones Particulares`.
  - pie legal es: traducción castellana completa y fiel.
  - Regla dura del épico respetada: nunca aparece "lloguer" (ca ni es).

## 3. Suite de tests (documentos + presupuestos)
- Run global `--runInBand`: `2709 passed, 9 failed`. Los 9 fallos son EXCLUSIVAMENTE suites de render `@react-pdf/renderer` (`renderToBuffer` → firma `%PDF`), que corresponden a la **flakiness ESM conocida** del proyecto al correr varias suites react-pdf en el mismo proceso (ver memoria `react-pdf-esm-suite-flakiness`).
- Verificadas en aislamiento / workers separados: **verde** (ver §6). Los tests de integración que requieren BD (config-documento-integracion, activar-prereserva) pasaron en el run global.
- Suites nuevas del builder/i18n/layout: verde (53 RED→GREEN inicial + 47 tras el fix del pie bancario).

## 4. PDF real — verificación end-to-end (react-pdf → bytes → pdftotext)
Generados 4 PDFs reales con la config bilingüe del piloto y extraído su texto:

| Escenario | fecha evento | horario | idioma etiquetas/textos |
|---|---|---|---|
| ca + horario | `20 de setembre de 2026` | `De 12:00 a 20:00 (8 hores)` | PRESSUPOST, Dades client, CONCEPTE, persones, Validesa, Condicions, Pagament anticipat, pie bancario en catalán |
| es + horario | `20 de septiembre de 2026` | `De 12:00 a 20:00 (8 horas)` | PRESUPUESTO, Datos del cliente, CONCEPTO, personas, Validez, Condiciones, Pago anticipado, Fianza, pie bancario en español |
| es + sin horario | `20 de septiembre de 2026` | `(8 horas)` (fallback sin rango) | español |
| ca + cruce medianoche | `20 de setembre de 2026` | `De 22:00 a 02:00 (4 hores)` (mod 1440) | catalán |

PDFs adjuntos en `reports/pdf/`.

### Requisitos del usuario verificados
1. **Horario en el presupuesto**: las tres líneas (fecha larga con año / rango horario `De HH:MM a HH:MM (N hores|horas)` / `N persones|personas`) aparecen en el PDF real. Cruce de medianoche correcto. Fallback sin horario correcto.
2. **Título en amarillo**: cubierto por el test de layout `documento-presupuesto-titulo-amarillo.layout.spec.ts` (el título del presupuesto usa `COLOR_ACENTO=#ffd978`; la factura conserva turquesa). *(Nota: pdftotext no expone color; verificación por test de layout + apertura visual del PDF por el usuario.)*
3. **Idioma es/ca**: etiquetas fijas + textos libres del tenant + fecha/horario cambian según `reserva.idioma`. Verificado en PDF real ca y es.

## 5. Defecto encontrado y corregido en QA
- **PieBancario no internacionalizado**: el PDF español mostraba 3 frases fijas en catalán (`*Per formalitzar…`, `El pagament es pot efectuar…`, `Dades bancàries:`). Corregido: añadidas al bundle `etiquetas` (es/ca), `PieBancario` las recibe por prop; la factura mantiene idioma fijo `ca`. Re-verificado en PDF real: el pie español ahora es `*Para formalizar el pago…`, `El pago puede efectuarse…`, `Datos bancarios:`, sin catalán residual.

## 6. Lint / typecheck
- `pnpm lint`: EXIT=0 (0 errores; 1 warning preexistente ajeno en `comunicaciones`).
- `pnpm typecheck`: EXIT=0.

## 7. Riesgos / notas para el usuario
- **Producción**: para el tenant existente, tras aplicar la migración el `_es` queda con el texto catalán (placeholder) hasta que se re-ejecute el seed (upsert del piloto). Confirmar que el despliegue re-siembra la config del piloto, o poblar el `_es` en el paso de deploy.
- **Traducciones es**: redactadas por el implementador (concepto, validesa, pie legal, 14 secciones de condicions). Pendiente de tu revisión sobre el PDF real (`reports/pdf/presupuesto-es-horario.pdf`).
- **Factura**: no cambia de idioma en este change (fuera de alcance); conserva título turquesa y textos `ca`.

# Tasks — documentos-sin-iva-omite-pie-bancario

> Fix acotado de render backend. **NO hay fase de contrato/SDK** (no cambia el
> contrato OpenAPI ni el cliente generado) **ni fase de frontend/E2E** (no hay
> UI): el paso `step-N+3` (E2E Playwright) **NO aplica**.

## 0. Setup: crear feature branch (OBLIGATORIO — PRIMER PASO)

- [x] 0.1 Crear branch `feature/documentos-sin-iva-omite-pie-bancario` desde
      `feature/documentos-presupuesto-sin-iva-doble-numeracion` (PR apilado sobre
      la 6.2, NO desde `master`: este fix depende del código de la 6.2)
- [x] 0.2 Verificar que el `git log` muestra los commits de la 6.2 (incl.
      `feat(documentos): presupuesto SIN IVA + método de pago + doble numeración (6.2)`)

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd)

- [x] 1.1 Gate SDD aprobado por el humano **2026-07-14** ("apruebo") — habilitada
      la fase TDD/implementación

## 2. Tests primero — TDD RED (OBLIGATORIO — tdd-first)

- [x] 2.1 Test del modelo de vista (`construirModeloDocumentoPresupuesto`):
      `regimen = sin_iva` ⇒ el flag del pie bancario es `false` (RED)
- [x] 2.2 Test del modelo: `regimen = con_iva` ⇒ el flag del pie bancario es
      `true` y conserva IBAN/beneficiario/concepto (sin regresión) (RED)
- [x] 2.3 Test de plantilla SIN IVA: el PDF/árbol NO contiene IBAN, beneficiario
      ni concepto/texto de transferència (RED)
- [x] 2.4 Test de plantilla CON IVA: el PDF/árbol SÍ contiene IBAN + beneficiario
      + concepto (guardarraíl de no-regresión) (RED)
- [x] 2.5 Confirmar que los tests fallan por la razón correcta antes de implementar

## 3. Backend: implementación + revisar/actualizar tests unitarios (OBLIGATORIO — step-N)

- [x] 3.1 Añadir el flag de visibilidad al `PieBancarioModelo`
      (`mostrar: boolean`) y resolverlo en `construirModeloDocumentoPresupuesto`
      desde `datos.regimen === 'con_iva'` (declarativo, arrow functions)
- [x] 3.2 `DocumentoLayout`: renderizar `<PieBancario>` solo cuando
      `modelo.pieBancario.mostrar === true`
- [x] 3.3 Revisar/actualizar tests unitarios existentes de la plantilla (6.1b/6.2)
      para que sigan verdes; poner en verde los tests RED del paso 2
- [x] 3.4 `pnpm lint` (ESLint, no Prettier) verde: arrow functions, límites
      hexagonales (`documentos` ↛ `presupuestos`)

## 4. QA: unit tests + verificación de BD (OBLIGATORIO — step-N+1 — EL AGENTE DEBE EJECUTARLO)

- [x] 4.1 N/A — fix de presentación pura, sin cambios de esquema/datos
- [x] 4.2 Specs dirigidos aislados verdes: pie-bancario 8/8, SIN IVA 11/11, CON IVA 16/16
- [x] 4.3 Ejecutados desde la sesión principal (aislados por ESM jest+react-pdf); typecheck OK
- [x] 4.4 BD intacta (sin mutación)
- [x] 4.5 Report `reports/2026-07-14-step-4-unit-test-and-db-verification.md`
- [x] 4.6 Completado: verde + report

## 5. QA: verificación de render del PDF (OBLIGATORIO — step-N+2 — EL AGENTE DEBE EJECUTARLO)

> No hay endpoint nuevo que probar con curl; la verificación equivalente es el
> **re-render del PDF** de ambas variantes desde la sesión principal.

- [x] 5.1 PDF SIN IVA re-renderizado (`fix-sin-iva.pdf`, 3.246 B) e inspeccionado:
      termina en "Validesa: 10 DIES", SIN Dades bancàries/IBAN/beneficiari/concepte
- [x] 5.2 PDF CON IVA (`fix-con-iva.pdf`, 3.740 B) byte-idéntico al de 6.2 → conserva
      base/IVA/total + pie bancario (no-regresión)
- [x] 5.3 N/A (sin endpoint nuevo; render directo cubre la verificación)
- [x] 5.4 Report `reports/2026-07-14-step-5-render-pdf-verification.md`
      (incl. nota: el `pieLegal` va dentro de PieBancario y también se omite en SIN IVA;
      la validez sigue visible arriba y es fiel al Excel)

## 6. QA: E2E con Playwright MCP — NO APLICA (step-N+3)

- [x] 6.1 E2E no aplica (sin frontend afectado) — documentado en el report de fase 5

## 7. Docs: actualizar documentación técnica (OBLIGATORIO — step-N+4)

- [x] 7.1 Nota de presentación añadida en `docs/er-diagram.md` (regla "SIN IVA omite
      pie bancario"); sin cambio de datos

## 8. Code review (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO)

- [x] 8.1 `code-reviewer` ejecutado; sin bloqueantes; 1 Baja no bloqueante (cobertura
      estructural del layout, coherente con vecinos); guardrails duros OK
- [x] 8.2 Informe `reports/2026-07-14-step-review-code-review.md` con `Veredicto: APTO`

## 9. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final)

- [x] 9.1 Gate final: OK humano **2026-07-14** ("procede") tras code-review APTO +
      render de ambas variantes verificado (incl. refinamiento pieLegal conservado en SIN IVA)

## 10. Archivar change + abrir PR (OBLIGATORIO — archive)

- [x] 10.1 `openspec archive` ejecutado (documentos: ~1 modified — requirement SIN IVA)
- [x] 10.2 6.2 ya en master; rama rebaseada sobre `origin/master`; PR abierto directo a `master`

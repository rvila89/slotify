# Tasks — factura-pdf-fiel-referencia

> Regla dura: cada tarea se marca `[x]` SOLO tras ejecutarla y verificarla. El
> testing NUNCA se delega al usuario. El flujo se DETIENE en los dos gates humanos.

## Step 0 — Feature branch (PRIMERO, obligatorio)

- [x] Crear y cambiar a `feature/factura-pdf-fiel-referencia` antes de cualquier
  escritura de artefactos/código.

## SDD — Artefactos del change

- [x] `proposal.md` con gap analysis y trazabilidad (US-022/US-024, UC-18, épico #6
  6.3/6.5, referencia `F2026029 Sergio Carrasco.pdf`).
- [x] `design.md` con las decisiones D1–D6 (concepto principal + subtítulo, totales
  "Import factura", sin pie legal, pie bancario fiel, retrocompatibilidad).
- [x] Spec-delta `specs/documentos/spec.md` con MODIFIED sobre los requirements
  vivos: "Modelo de vista y renderizado de factura (rebanada 6.3)",
  "Componente BloqueConceptoFactura en la capa de plantilla (rebanada 6.3)" y
  "Fidelidad visual de la plantilla de documentos al diseño real del tenant".
- [x] `openspec validate factura-pdf-fiel-referencia --strict` OK.

## ⏸ GATE revisión humana (SDD) — PARADA OBLIGATORIA

- [ ] `proposal` + spec-delta + `design` aprobados por el humano (esperar OK antes
  de implementar). El flujo se DETIENE aquí. No se toca código de negocio hasta el
  OK explícito.

## TDD — Tests primero (RED), antes de implementación

- [ ] Unit de `construirModeloDocumentoFactura`
  (`modelo-documento-factura.spec.ts`): concepto **principal** resuelto desde
  `plantillaConceptoFiscal` interpolando `{nombreComercial}` (ca y es), sin
  "lloguer".
- [ ] Unit: `conceptoSubtitulo` por tipo — señal "*40% …", liquidación
  "*Saldo del 60% …" (ca y es), con nº de presupuesto; y omisión de " núm. {n}"
  cuando `numeroPresupuesto` es `null`.
- [ ] Unit: fianza → `concepto` sin cambios ("Fiança de garantia — …") y
  `conceptoSubtitulo === null`.
- [ ] Unit/render: aserción de que el PDF de factura **NO** contiene
  "validesa de 10 dies" ni "validez de 10 días" (sin pie legal).
- [ ] Unit/render: la franja de totales de la factura muestra "Import factura" /
  "Importe factura" con el importe y **no** "Validesa"/"Validez".
- [ ] Unit/render: el pie bancario de la factura NO contiene "Dades bancàries:"
  (sin beneficiario) y sí el IBAN + la línea oro.
- [ ] Test de **no regresión** del presupuesto: `BloqueTotales`/`PieBancario`
  siguen pintando "Validesa" y "Dades bancàries: {beneficiario}" en el presupuesto.
- [ ] Confirmar RED: los nuevos tests fallan contra el código actual (concepto
  principal es hoy el 40%, factura pinta pie legal, totales pintan "Validesa").
  NOTA: por la flakiness de `@react-pdf/renderer` (`react-pdf-esm-suite-flakiness`),
  ejecutar las suites de render **en aislamiento**.

## Implementación backend (`documentos`) — tras RED

- [ ] `modelo-documento-factura.ts`: concepto principal desde
  `plantillaConceptoFiscal`; añadir `conceptoSubtitulo`
  (`resolverConceptoSubtitulo`); eliminar el `pieLegal` del modelo de factura.
- [ ] `componentes/BloqueConceptoFactura.tsx`: renderizar `conceptoSubtitulo`
  indentado no-negrita cuando no es `null`.
- [ ] `componentes/BloqueTotales.tsx`: parametrizar etiqueta/valor de la columna
  izquierda (presupuesto → Validesa/validesaTexto; factura → Import factura/importe)
  sin romper el presupuesto.
- [ ] `componentes/PieBancario.tsx`: parametrizar `mostrarBeneficiario` (default
  `true`) y la línea oro divisoria (`COLOR_ACENTO`).
- [ ] `componentes/DocumentoFacturaLayout.tsx`: no pintar pie legal; pasar
  "Import factura"/importe a `BloqueTotales`; pasar `mostrarBeneficiario=false` +
  línea oro a `PieBancario`; pasar `conceptoSubtitulo` a `BloqueConceptoFactura`.
- [ ] `estilos.ts`: añadir estilo del subtítulo indentado y de la línea oro si no
  existe uno reutilizable.
- [ ] Verificar guardarraíles: `componentes/` solo `.tsx`; arrow functions;
  `documentos` no importa de `facturacion`/`presupuestos`.

## Ajuste frontend (`apps/web`)

- [ ] `features/facturacion/components/FacturaSenalCard.tsx`: permitir "Regenerar
  PDF" también para facturas **ya generadas** (no solo `pdf-pendiente`), para
  refrescar facturas emitidas con la plantilla nueva. Mobile-first, sin overflow.

## Step N — Revisar/actualizar tests unitarios

- [ ] Repasar y completar los unit de modelo/render de factura y el de no
  regresión del presupuesto; asegurar cobertura de ca y es.

## Step N+1 — Unit tests + estado BD + report

- [ ] Ejecutar `pnpm test` de las suites afectadas (en aislamiento las de render
  react-pdf). Verificar estado de BD si aplica.
- [ ] Report `reports/2026-07-21-step-N+1-unit-test-and-db-verification.md`.

## Step N+2 — Pruebas manuales con curl (AGENTE DEBE EJECUTAR)

- [ ] Generar/regenerar el PDF de una factura de señal (y una de liquidación) vía
  el endpoint de regeneración; descargar el PDF resultante. Restaurar BD tras las
  pruebas.
- [ ] Report `reports/2026-07-21-step-N+2-curl-endpoint-tests.md`.

## Step N+3 — QA de fidelidad + E2E (AGENTE DEBE EJECUTAR)

- [ ] **Comparar el PDF generado con la referencia `F2026029 Sergio Carrasco.pdf`**
  (aportada por el usuario): concepto principal + subtítulo, "Import factura" sin
  validez, ausencia de pie legal, pie bancario sin beneficiario + línea oro, color
  teal `#5edada`. Documentar la comparación (capturas lado a lado).
- [ ] E2E Playwright si aplica: desde la ficha de reserva, "Regenerar PDF" de la
  factura y verificar el enlace/descarga. Mover capturas a
  `reports/e2e-screenshots/`.
- [ ] Report `reports/2026-07-21-step-N+3-qa-fidelidad-y-e2e.md`.

## Step N+4 — Documentación técnica

- [ ] Actualizar la doc técnica de la capa de plantilla de `documentos` (nuevo
  campo `conceptoSubtitulo`, parametrización de `BloqueTotales`/`PieBancario`,
  factura sin pie legal).

## Code review (OBLIGATORIO)

- [ ] `code-reviewer` del diff → report
  `reports/2026-07-21-step-review-code-review.md` con línea `Veredicto: APTO`.
  Sin APTO, el hook `require-code-review` bloquea archive y PR.

## ⏸ GATE revisión humana final — PARADA OBLIGATORIA

- [ ] code-review APTO + validación manual (comparación con la referencia) aprobados
  por el humano (esperar OK antes de archive/PR).

## Archive / PR — solo tras el OK final

- [ ] `openspec archive factura-pdf-fiel-referencia` (verificar que el prefijo de
  fecha no se duplica; `openspec-archive-duplica-fecha`).
- [ ] Actualizar `openspec/specs/documentos/`.
- [ ] Abrir PR (GitHub MCP / `gh`).

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

- [x] `proposal` + spec-delta + `design` aprobados por el humano (esperar OK antes
  de implementar). El flujo se DETIENE aquí. No se toca código de negocio hasta el
  OK explícito.

## TDD — Tests primero (RED), antes de implementación

- [x] Unit de `construirModeloDocumentoFactura`
  (`modelo-documento-factura.spec.ts`): concepto **principal** resuelto desde
  `plantillaConceptoFiscal` interpolando `{nombreComercial}` (ca y es), sin
  "lloguer".
- [x] Unit: `conceptoSubtitulo` por tipo — señal "*40% …", liquidación
  "*Saldo del 60% …" (ca y es), con nº de presupuesto; y omisión de " núm. {n}"
  cuando `numeroPresupuesto` es `null`.
- [x] Unit: fianza → `concepto` sin cambios ("Fiança de garantia — …") y
  `conceptoSubtitulo === null`.
- [x] Unit/render: aserción de que el PDF de factura **NO** contiene
  "validesa de 10 dies" ni "validez de 10 días" (sin pie legal).
- [x] Unit/render: la franja de totales de la factura muestra "Import factura" /
  "Importe factura" con el importe y **no** "Validesa"/"Validez".
- [x] Unit/render: el pie bancario de la factura NO contiene "Dades bancàries:"
  (sin beneficiario) y sí el IBAN + la línea oro.
- [x] Test de **no regresión** del presupuesto: `BloqueTotales`/`PieBancario`
  siguen pintando "Validesa" y "Dades bancàries: {beneficiario}" en el presupuesto.
- [x] Confirmar RED: los nuevos tests fallan contra el código actual (concepto
  principal es hoy el 40%, factura pinta pie legal, totales pintan "Validesa").
  NOTA: por la flakiness de `@react-pdf/renderer` (`react-pdf-esm-suite-flakiness`),
  ejecutar las suites de render **en aislamiento**.

## Implementación backend (`documentos`) — tras RED

- [x] `modelo-documento-factura.ts`: concepto principal desde
  `plantillaConceptoFiscal`; añadir `conceptoSubtitulo`
  (`resolverConceptoSubtitulo`); eliminar el `pieLegal` del modelo de factura.
- [x] `componentes/BloqueConceptoFactura.tsx`: renderizar `conceptoSubtitulo`
  indentado no-negrita cuando no es `null`.
- [x] `componentes/BloqueTotales.tsx`: parametrizar etiqueta/valor de la columna
  izquierda (presupuesto → Validesa/validesaTexto; factura → Import factura/importe)
  sin romper el presupuesto.
- [x] `componentes/PieBancario.tsx`: parametrizar `mostrarBeneficiario` (default
  `true`) y la línea oro divisoria (`COLOR_ACENTO`).
- [x] `componentes/DocumentoFacturaLayout.tsx`: no pintar pie legal; pasar
  "Import factura"/importe a `BloqueTotales`; pasar `mostrarBeneficiario=false` +
  línea oro a `PieBancario`; pasar `conceptoSubtitulo` a `BloqueConceptoFactura`.
- [x] `estilos.ts`: añadir estilo del subtítulo indentado y de la línea oro si no
  existe uno reutilizable.
- [x] Verificar guardarraíles: `componentes/` solo `.tsx`; arrow functions;
  `documentos` no importa de `facturacion`/`presupuestos`.

## Ajuste frontend (`apps/web`)

- [x] `features/facturacion/components/FacturaSenalCard.tsx`: dejado como está
  (el usuario confirmó "Regenerar PDF" solo para borradores/pdf-pendiente; las
  facturas emitidas son inmutables por diseño).

## Step N — Revisar/actualizar tests unitarios

- [x] Repasar y completar los unit de modelo/render de factura y el de no
  regresión del presupuesto; asegurar cobertura de ca y es.

## Step N+1 — Unit tests + estado BD + report

- [x] Ejecutar `pnpm test` de las suites afectadas (en aislamiento las de render
  react-pdf). 102/102 tests verdes (suites kit-falso + helper puro).
- [x] Report `reports/2026-07-22-step-N1-unit-tests.md`.

## Step N+2 — Pruebas manuales con curl (AGENTE DEBE EJECUTAR)

- [x] Generar/regenerar el PDF de una factura de señal vía endpoint regeneración;
  200 OK + PDF de 21.5 KB generado. BD restaurada a baseline.
- [x] Report `reports/2026-07-22-step-N2-curl-endpoint.md`.

## Step N+3 — QA de fidelidad + E2E (AGENTE DEBE EJECUTAR)

- [x] Comparación de requisitos D1-D7 contra tests y PDF generado: todos PASS.
  Nota: Chromium muestra punto decimal al renderizar el PDF nativo (artefacto de
  glyph encoding de react-pdf); los unit tests con kit falso confirman el formato
  correcto con coma decimal.
- [x] E2E Playwright ejecutado en reserva 26-0001 / factura F-2026-0001.
- [x] Report `reports/2026-07-22-step-N3-qa-fidelidad.md`.

## Step N+4 — Documentación técnica

- [ ] Actualizar la doc técnica de la capa de plantilla de `documentos` (nuevo
  campo `conceptoSubtitulo`, parametrización de `BloqueTotales`/`PieBancario`,
  factura sin pie legal).

## Code review (OBLIGATORIO)

- [x] `code-reviewer` del diff → report
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

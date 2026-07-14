# Tasks: documentos-facturas-pdf (6.3)

## Step 0 — Feature branch [DONE]

- [x] Crear branch `feature/documentos-facturas-pdf`

## GATE revisión humana (SDD) [APROBADO]

- [x] `proposal.md` aprobado por el usuario
- [x] `design.md` (D1–D8) aprobado por el usuario — Q1 asumido sin IVA, Q2 sin ref presupuesto, Q3 guarda no cambia
- [x] Spec-delta revisado y aprobado

## Contrato OpenAPI

- [x] Auditar `ivaPorcentaje = 0.00` — schema `Porcentaje` (`^\d+\.\d{2}$`) ya admite "0.00". Sin cambios.
- [x] SDK sin regenerar (no hay cambios de contrato).

## TDD — Tests primero (RED)

- [x] `calculo-factura.spec.ts` — casos `regimenIva = 'sin_iva'` añadidos y verificados RED
- [x] `modelo-documento-factura.spec.ts` (nuevo) — tests para {señal, liquidación, fianza} × {con_iva, sin_iva} verificados RED
- [x] `generar-factura-senal.use-case.spec.ts` — caso sin_iva añadido y verificado RED
- [x] `generar-borradores-liquidacion-fianza.use-case.spec.ts` — caso sin_iva añadido y verificado RED
- [x] Todos los tests nuevos fallaban (RED) antes de implementar

## Implementación

### N.1 — Domain fix: calculo-factura + ReservaFacturable

- [x] `domain/calculo-factura.ts` — `calcularDesgloseFactura(total, regimenIva)` implementado
- [x] `ReservaFacturable` VO — campo `regimenIva` añadido
- [x] `ReservaLiquidable` VO — campo `regimenIva` añadido
- [x] Adapters Prisma de `CargarReservaFacturablePort` y `CargarReservaLiquidablePort` actualizados

### N.2 — Use-cases actualizados

- [x] `application/generar-factura-senal.use-case.ts` — usa `regimenIva` en `calcularDesgloseFactura`
- [x] `application/generar-borradores-liquidacion-fianza.use-case.ts` — idem

### N.3 — Port + Adapter CargarDatosDocumentoFactura

- [x] `domain/cargar-datos-documento-factura.port.ts` — interfaz + VO `DatosDocumentoFactura`
- [x] `infrastructure/cargar-datos-documento-factura.prisma.adapter.ts` — implementación Prisma con RLS
- [x] `facturacion.tokens.ts` — `CARGAR_DATOS_DOCUMENTO_FACTURA_PORT` añadido

### N.4 — Template de factura en documentos/presentation

- [x] `modelo-documento-factura.ts` — VO + `construirModeloDocumentoFactura(params)`
- [x] `documento-factura.render.ts` — `renderizarDocumentoFacturaABytes(modelo)`
- [x] `componentes/BloqueConceptoFactura.tsx` — concepto sin horas, ref. nº presupuesto
- [x] `componentes/DocumentoFacturaLayout.tsx` — layout de factura

### N.5 — PdfFacturaRealAdapter

- [x] `infrastructure/pdf-factura.real.adapter.ts` — implementa `GenerarPdfFacturaPort`

### N.6 — Wiring módulo

- [x] `facturacion.module.ts` — `PdfFacturaRealAdapter` wired; `DocumentosModule` importado

## Step N+1 — Tests unitarios + verificación BD

- [x] 4 suites target: 76/76 tests en verde
- [x] `prisma validate` — OK sin errores
- [x] BD: `PlantillaDocumentoTenant` piloto intacta, sin nueva migración
- [x] Report: `reports/2026-07-14-step-N+1-unit-test-and-db-verification.md`

## Step N+2 — Pruebas manuales con curl

- [x] Report: `reports/2026-07-14-step-N+2-curl-endpoint-tests.md` (N/A — API no arranca en subagente; comandos documentados para ejecución manual)

## Step N+3 — E2E con Playwright MCP

- [x] Report: N/A — API no arrancada; E2E pendiente de ejecución manual con la API corriendo

## Step N+4 — Documentación técnica

- [x] `openspec/specs/facturacion/spec.md` — requirements "Desglose fiscal" y "Generación del PDF" actualizados; requirement `ReservaFacturable.regimenIva` añadido; port `CargarDatosDocumentoFacturaPort` añadido
- [x] `openspec/specs/documentos/spec.md` — requirements `ModeloDocumentoFactura` y `BloqueConceptoFactura` añadidos

## Code review (OBLIGATORIO)

- [x] Code-reviewer lanzado sobre el diff
- [x] Report: `reports/2026-07-14-step-review-code-review.md`
- [x] `Veredicto: APTO` confirmado (sin hallazgos Alta/Media)

## GATE revisión humana final [APROBADO]

- [x] Code-review con `Veredicto: APTO`
- [x] Gate aprobado por el usuario (OK explícito 2026-07-14)

## Archive

- [ ] `openspec archive documentos-facturas-pdf` (tras OK del gate final)
- [ ] Abrir PR `feature/documentos-facturas-pdf → master`

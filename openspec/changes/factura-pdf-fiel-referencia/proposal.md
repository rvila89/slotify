# Change: factura-pdf-fiel-referencia

## Why

El usuario aportó una **factura real de referencia** de Masia l'Encís
(`F2026029 Sergio Carrasco.pdf`) para que el PDF de factura que genera el sistema
sea **idéntico en diseño y contenido**. Hoy el PDF de factura **diverge** de esa
referencia en la capa de presentación de documentos (capability `documentos`,
rebanadas 6.3/6.5). Este change corrige exclusivamente la **presentación** de las
facturas de tipo **señal** y **liquidación**; la fianza (REBUT) **no cambia**.

### Gap analysis (fuente de verdad = el PDF de referencia)

Hallazgo clave: la config del tenant **ya contiene** el texto correcto del
concepto principal en `textos.plantillaConceptoFiscal` = "Gestió ús espai de
{nombreComercial} per esdeveniment"
(`apps/api/src/documentos/infrastructure/seed/configuracion-documento-piloto.ts`),
pero `apps/api/src/documentos/presentation/modelo-documento-factura.ts` **NO lo
usa**: pone el texto "40% de l'import…" como línea principal del concepto.

Divergencias detectadas (código actual → objetivo según la referencia):

1. **Concepto principal.** Hoy: "40% de l'import total anticipat del pressupost
   núm. N" en negrita. Objetivo: "Gestió ús espai de Masia l'Encís per
   esdeveniment" en negrita, resuelto desde `plantillaConceptoFiscal` interpolando
   `{nombreComercial}` con `identidadFiscal.nombreComercial`, según el idioma.
2. **Subtítulo de concepto (nuevo).** Hoy: no existe. Objetivo: una línea
   indentada, no negrita, bajo el concepto principal:
   - señal → "*40% de l'import total anticipat del pressupost núm. N"
   - liquidación → "*Saldo del 60% de l'import del pressupost núm. N"
   - fianza → **sin subtítulo** (`null`).
   Nuevo campo `conceptoSubtitulo: string | null` en `ModeloDocumentoFactura`.
   Cuando `numeroPresupuesto` es `null` se omite " núm. N".
3. **Franja de totales.** Hoy: la columna izquierda pinta la etiqueta "Validesa"
   con valor vacío (`validesaTexto=""`). Objetivo: etiqueta "Import factura" (ya
   existe `etiquetas.importFactura`) con el valor del importe de la factura, **sin
   fila de validez**. `BloqueTotales` debe **parametrizar** etiqueta/valor de la
   columna izquierda sin romper el presupuesto (que sigue usando
   "Validesa"/`validesaTexto`).
4. **Pie legal.** Hoy: la factura pinta SIEMPRE `modelo.pieLegal` ("Aquest
   document té una validesa de 10 dies…"). Objetivo: la factura **NO** renderiza el
   pie legal de validez (la validez es del presupuesto, no de la factura).
5. **Pie bancario.** Hoy: incluye la línea "Dades bancàries: Canoliart, SL".
   Objetivo: **sin** la línea de beneficiario, y con una **línea oro divisoria**
   (`COLOR_ACENTO = #ffd978`) sobre el pie, fiel a la referencia. `PieBancario`
   debe parametrizar la visibilidad de la línea de beneficiario (default visible
   para presupuesto; oculta para factura) y la línea oro.
6. **Color teal `#5edada`.** Se mantiene; se verifica en QA que coincide con la
   referencia.

### Decisiones de producto ya confirmadas (no se cuestionan)

- La reestructura de concepto (principal + subtítulo) aplica **solo** a facturas de
  tipo **señal** y **liquidación**. La **fianza (REBUT) NO cambia**.
- **Sin migración masiva** de PDFs existentes: se corrige la plantilla; las
  facturas ya emitidas se refrescan con el botón **"Regenerar PDF"** existente.
- **Réplica EXACTA** del pie de la referencia.

## What Changes

- **`documentos` (capability, capa de presentación):**
  - `modelo-documento-factura.ts`: el concepto principal pasa a resolverse desde
    `plantillaConceptoFiscal` (interpolando `{nombreComercial}`); se añade
    `conceptoSubtitulo: string | null` (40%/60% con nº presupuesto para
    señal/liquidación; `null` para fianza); el pie legal deja de formar parte del
    render de la factura.
  - `BloqueConceptoFactura.tsx`: renderiza el subtítulo indentado no-negrita cuando
    no es `null`.
  - `BloqueTotales.tsx`: parametriza etiqueta/valor de la columna izquierda
    (presupuesto → "Validesa"/`validesaTexto`; factura → "Import factura"/importe),
    sin regresión del presupuesto.
  - `PieBancario.tsx`: parametriza la visibilidad de la línea de beneficiario
    (default `true` para presupuesto; `false` para factura) y la línea oro
    divisoria (`COLOR_ACENTO`).
  - `DocumentoFacturaLayout.tsx`: deja de pintar el pie legal; pasa a `BloqueTotales`
    la etiqueta/valor "Import factura"; pasa a `PieBancario` los flags de
    beneficiario/línea oro; pasa el subtítulo al bloque de concepto.
  - `etiquetas-por-idioma.ts`: ya tiene `importFactura` (ca/es); se reutiliza.
- **Frontend (`apps/web`, ajuste menor):** verificar que "Regenerar PDF"
  (`FacturaSenalCard.tsx`) sirva para facturas **ya generadas** (no solo
  `pdf-pendiente`), para poder refrescar facturas emitidas con la plantilla nueva.

Todos los textos son **bilingües ca/es** donde aplique (el idioma ya viaja en el
modelo de vista).

### Fuera de alcance

- La fianza (REBUT): concepto, subtítulo y layout **no cambian**.
- El presupuesto (`construirModeloDocumentoPresupuesto`, `DocumentoLayout`):
  los cambios en `BloqueTotales`/`PieBancario` son **retrocompatibles** (defaults
  que preservan el comportamiento actual del presupuesto).
- Migración/regeneración masiva de PDFs históricos (se usa "Regenerar PDF").
- Cambios de dominio, contrato OpenAPI o base de datos.

## Impact

- Specs afectadas (capability `documentos`, MODIFIED sobre requirements vivos):
  - "Modelo de vista y renderizado de factura (rebanada 6.3)".
  - "Componente BloqueConceptoFactura en la capa de plantilla (rebanada 6.3)".
  - "Fidelidad visual de la plantilla de documentos al diseño real del tenant".
- Código de presentación (backend, capa `documentos/presentation`):
  - `modelo-documento-factura.ts`
  - `componentes/BloqueConceptoFactura.tsx`
  - `componentes/BloqueTotales.tsx`
  - `componentes/PieBancario.tsx`
  - `componentes/DocumentoFacturaLayout.tsx`
  - (reutiliza `etiquetas-por-idioma.ts` sin cambios de contenido)
- Frontend: `apps/web/src/features/facturacion/components/FacturaSenalCard.tsx`
  (ajuste menor de "Regenerar PDF").
- Trazabilidad: US-022 (factura de señal), US-024 (liquidación), UC-18; épico #6
  rebanadas 6.3/6.5; documento de referencia `F2026029 Sergio Carrasco.pdf`
  (aportado por el usuario, fuera del repo).
- Riesgo conocido: flakiness de las suites `@react-pdf/renderer` cuando se ejecutan
  juntas (`react-pdf-esm-suite-flakiness`); verificar cada suite en aislamiento.

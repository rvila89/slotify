# Change: documentos-presupuesto-pdf-con-iva

## Why

El épico **#6 — Documentos PDF por tenant** entrega los documentos reales
(presupuesto/factura) como el Excel del tenant, con **layout fijo en código y
contenido 100% por tenant**. La rebanada **6.1a**
(`documentos-config-tenant-storage`, ya MERGEADA en master) estableció los dos
cimientos: la configuración de documento por tenant
(`PlantillaDocumentoTenant` → VO `ConfiguracionDocumentoTenant`) y el puerto de
object storage `AlmacenDocumentosPort` (adaptador `local`). Esa rebanada
**no** genera ningún PDF: solo deja la config para que 6.1b la consuma.

Hoy el presupuesto se "genera" con un **fake**
(`apps/api/src/presupuestos/infrastructure/pdf-presupuesto.fake.adapter.ts`,
`PdfPresupuestoFakeAdapter`) que devuelve una `pdf_url` sintética
(`https://storage.local/presupuestos/{id}.pdf`) sin renderizar nada. El gestor
del piloto no puede enviar al cliente un presupuesto real: el E2 adjunta una URL
que no existe.

Esta rebanada **6.1b** sustituye ese fake por un **PDF real** renderizado con
**@react-pdf/renderer** (backend/Node), que consume la config del tenant de 6.1a,
lo sube por `AlmacenDocumentosPort.subir(...)` y devuelve la URL real que el E2
adjunta. Es la variante **CON IVA** (pago por transferencia), la hoja
"PRESSUPOST IVA" del Excel. (Fuente: `epico-6-documentos-pdf-roadmap`;
`presupuesto-parte-b-plan` #6; Excel `Plantilla_factures i pressupostos.xlsx`;
spec viva `documentos` de 6.1a.)

## What Changes

- **Instalar `@react-pdf/renderer`** en `apps/api` (render de PDF en Node,
  server-side; NO en frontend). Decisión de motor ya fijada por el épico.
- **Nueva capa de plantilla de documentos react-pdf reutilizable** (componentes
  `DocumentoLayout`, `Cabecera`, `BloqueCliente`, `TablaConcepto`,
  `BloqueTotales`, `PieBancario`), parametrizada por la config del tenant
  (`ConfiguracionDocumentoTenant`) + los datos del documento. La usa el
  presupuesto ahora; las **facturas (6.3) la reutilizarán**. Vive en la
  capability/módulo `documentos` (justificación abajo).
- **Adaptador real de PDF de presupuesto** que implementa el puerto de dominio
  **existente** `GenerarPdfPresupuestoPort` (firma
  `(params:{tenantId,reservaId,idPresupuesto}) => Promise<string|null>`):
  1. carga la config del tenant (`ObtenerConfiguracionDocumentoService`) y los
     datos del presupuesto/reserva/cliente/extras;
  2. renderiza el PDF con la capa de plantilla (contenido 100% de la config,
     nada hardcodeado);
  3. sube los bytes con `AlmacenDocumentosPort.subir(bytes, clave)`;
  4. devuelve la URL real.
  Se inyecta por el token **existente** `GENERAR_PDF_PRESUPUESTO_PORT` en
  `PresupuestosModule`, sustituyendo al `PdfPresupuestoFakeAdapter`. La
  generación sigue siendo **post-commit**, fuera de la transacción crítica del
  `FOR UPDATE` (sin cambios en `GenerarPresupuestoUseCase`).
- **Numeración del presupuesto CON IVA**: secuencia única por tenant estilo
  `2026001` (año + contador). Requiere **migración Prisma** que añada
  `numero_presupuesto` a `Presupuesto` (+ `tenant_id` para la unicidad; ver
  cuestión abierta N2 en `design.md`) y una función de dominio de numeración
  reutilizando el patrón de `facturacion/domain/numeracion-factura.ts`. El
  **cuándo/dónde** se asigna el número (en la transacción de confirmación) es la
  **cuestión abierta N1** de `design.md`.
- **Fallback de logo**: `logoUrl` puede ser `null` (el upload de logo es 6.5).
  La cabecera se renderiza **solo-texto** si no hay logo (propuesta; se aprueba
  en el gate). Ver cuestión abierta N3.

### Fuera de alcance (rebanadas posteriores)

- **Variante SIN IVA**, método de pago (transferencia/efectivo/tarjeta) y la
  **doble numeración** (dos secuencias por variante) → **6.2**. En 6.1b la
  numeración es una **única** secuencia (solo CON IVA).
- **Facturas 40/60** (señal/liquidación) y su PDF → **6.3** (reutilizarán la
  capa de plantilla que esta rebanada crea).
- **Condicions particulars** → 6.4. **UI de ajustes del tenant + upload de logo**
  → 6.5.
- **Sin cambios de contrato OpenAPI/SDK**: el endpoint de generar presupuesto y
  el campo `pdf_url` ya existen en el contrato; esta rebanada solo cambia lo que
  hay **detrás** de `pdf_url` (URL real en lugar de sintética). Se **confirma** en
  `design.md` (cuestión abierta N4) que no hay delta de contrato; por tanto el
  `tasks.md` **no** tiene fase de contrato/SDK ni de frontend/E2E Playwright.

## Capability elegida y justificación

Se ubica en **dos capabilities**, con el grueso en `documentos`:

- **`documentos` (capability principal del delta)**: la **capa de plantilla
  react-pdf** (layout + componentes) es transversal a presupuestos **y** facturas
  (6.3) y a las Condicions particulars (6.4). No pertenece al agregado
  `Presupuesto`. Vive con la config y el storage que ya viven en `documentos`
  (6.1a), formando el hogar coherente del épico #6 "documentos PDF por tenant".
  Meterla en `presupuestos` obligaría a `facturacion` a depender de
  `presupuestos` solo para renderizar.
- **`presupuestos` (delta acotado)**: lo específico del presupuesto —el
  **adaptador real** que reemplaza el fake tras el token
  `GENERAR_PDF_PRESUPUESTO_PORT`, y la **numeración** `numero_presupuesto`— es
  propio del agregado `Presupuesto` y del caso de uso US-014. Reside en
  `presupuestos`.

Esta separación deja a 6.3 (facturas) reutilizar la capa `documentos` sin tocar
`presupuestos`.

## Trazabilidad

- Épico **#6**, rebanada **6.1b** (roadmap `epico-6-documentos-pdf-roadmap`).
- Continúa la spec viva **`documentos`** de 6.1a
  (`documentos-config-tenant-storage`, archivada 2026-07-13): consume
  `ConfiguracionDocumentoTenant` y `AlmacenDocumentosPort`.
- **US-014 / UC-14** (generar presupuesto + activar pre_reserva): el PDF es el
  efecto post-commit §D-6; el E2 §D-7 lo adjunta. Puerto
  `GenerarPdfPresupuestoPort` ya definido en
  `presupuestos/application/generar-presupuesto.use-case.ts`.
- `presupuesto-parte-b-plan` #6 (datos reales, Excel hoja "PRESSUPOST IVA").
- `CLAUDE.md §Arquitectura` (hexagonal: el renderizador es infra/presentación, el
  puerto ya vive en dominio), `§Multi-tenancy` (tenantId del JWT + RLS),
  `§Testing` (TDD), regla dura arrow-functions.
- Reutiliza el patrón de numeración de `facturacion/domain/numeracion-factura.ts`
  (US-022 §D-3).

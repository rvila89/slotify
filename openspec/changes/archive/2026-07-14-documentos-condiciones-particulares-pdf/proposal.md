# Change: documentos-condiciones-particulares-pdf (6.4a)

## Why

El épico **#6 — Documentos PDF por tenant** entrega los documentos reales del
tenant (presupuesto, factura) con **layout fijo en código y contenido 100% por
tenant**. Las rebanadas ya en master aportan los cimientos que esta consume:

- **6.1a** (`documentos-config-tenant-storage`, archivada 2026-07-13): la
  configuración de documento por tenant (`PlantillaDocumentoTenant` → VO
  `ConfiguracionDocumentoTenant`) y el puerto de object storage
  `AlmacenDocumentosPort` (adaptador `local`).
- **6.1b** (`documentos-presupuesto-pdf-con-iva`, archivada 2026-07-14): la
  **capa de plantilla react-pdf** reutilizable (`Cabecera`, `estilos.ts`,
  `kit-react-pdf.ts`) y el patrón de **adaptador real** de generación de PDF
  (`PdfPresupuestoRealAdapter`: config → render → `AlmacenDocumentosPort.subir`
  → url), más el disparo del E2 (`DispararE2Adapter`) que adjunta el PDF.

Hoy el email de presupuesto (E2) adjunta **solo** el PDF del presupuesto. Falta
el documento legal de **"Condicions particulars"**: un texto largo que el
cliente debe firmar. En el Excel del tenant es una hoja con **14 secciones** y un
**bloque de firma EN BLANCO** (no se rellena con datos del cliente). Por tanto el
documento es **idéntico para todos los clientes de un tenant** (no depende de la
reserva) y debe acompañar al presupuesto que se envía.

Esta rebanada **6.4a** entrega la **generación del PDF de Condicions
particulars** (dominio `documentos`) y lo **adjunta al email del presupuesto
(E2)**. El **envío por email de la factura de señal (E3)** —que hoy no existe—
queda **fuera** de esta rebanada: es la **6.4b**.

(Fuentes: `epico-6-documentos-pdf-roadmap` §6.4/6.4a; Excel
`Plantilla_factures i pressupostos.xlsx` hoja "Condicions particulars"; specs
vivas `documentos` de 6.1a/6.1b.)

## What Changes

### Bloque A — Generación del PDF de "Condicions particulars" (capability `documentos`)

- **Config: nuevo bloque `condiciones`** en el VO
  `ConfiguracionDocumentoTenant` (`documentos/domain/configuracion-documento.ts`),
  con forma `{ titulo: string; secciones: Array<{ titulo: string; cuerpo: string }> }`.
  Contenido 100% del tenant (nada hardcodeado en la plantilla).
- **Migración Prisma**: nueva **columna JSON** en `PlantillaDocumentoTenant`
  (p. ej. `condiciones Json @map("condiciones")`) para persistir ese bloque. La
  tabla ya es **1-1 con `Tenant` con RLS activo** (6.1a); la columna hereda ese
  aislamiento. Migración **no destructiva** (nullable / con default) para no
  romper filas existentes; el adapter y el seed la pueblan.
- **Adapter Prisma de config**: `ConfiguracionDocumentoPrismaAdapter` mapea la
  nueva columna JSON al bloque `condiciones` del VO.
- **Seed**: poblar `construirConfiguracionDocumentoPiloto`
  (`documentos/infrastructure/seed/configuracion-documento-piloto.ts`) con el
  **texto REAL de Masia** parseado de la hoja "Condicions particulars" del Excel
  del tenant. Título del doc: **"Condicions Particulars"**. **14 secciones**:
  (Reserva i pagament), (Fiança), (Política de cancel·lació),
  (Responsabilitat i dades personals), (Visites), (Neteja),
  (Gestió de residus), (Horaris), (Excés d'horari),
  (Normes de convivència i ús responsable), (Capacitat), (Piscina),
  (Música i respecte veïnal), (Parking). El **texto exacto** lo aporta el usuario
  desde el Excel (ver **cuestión abierta D1**: pendiente de la fuente literal).
- **Plantilla react-pdf** en `documentos/presentation/`:
  - `modelo-documento-condiciones.ts` — VO de vista + `construirModeloDocumentoCondiciones(config)`.
  - `documento-condiciones.render.ts` — `renderizarDocumentoCondicionesABytes(config)`
    (espejo de `documento-presupuesto.render.ts`: `import()` nativo de react-pdf,
    `renderToBuffer`, `Uint8Array` que empieza por `%PDF`).
  - Componentes `.tsx` en `presentation/componentes/`:
    `DocumentoCondicionesLayout.tsx`, un componente **lista de secciones**
    (título + cuerpo), y un **bloque de firma EN BLANCO** con etiquetas
    `NOM I COGNOMS CLIENT` / `SIGNATURA CLIENT` / `DNI` / `DATA ESDEVENIMENT`.
    Reutiliza `Cabecera` (branding) y `estilos.ts` / `kit-react-pdf.ts`
    existentes. **Guardarraíl duro**: en `presentation/componentes/` SOLO
    `.tsx`; modelos/helpers/estilos viven fuera de `componentes/`.
- **Puerto + adapters de generación** (espejo de `PdfPresupuestoRealAdapter`):
  - `GenerarPdfCondicionesPort` con firma
    `(params: { tenantId: string }) => Promise<string | null>` (dominio de
    `documentos`).
  - **Adapter real**: `ObtenerConfiguracionDocumentoService.ejecutar(tenantId)`
    → si `null` degrada a `null` → render (`renderizarDocumentoCondicionesABytes`)
    → `AlmacenDocumentosPort.subir(bytes, 'condiciones/{tenantId}.pdf')` → url.
    **Clave fija** por tenant (documento idéntico por tenant → se reutiliza).
  - **Adapter fake** para tests (URL sintética).
  - **Token nuevo** `GENERAR_PDF_CONDICIONES_PORT` en `documentos.tokens.ts`.
  - Cablear en `DocumentosModule` y **exportarlo**.

### Bloque B — Adjuntar condiciones al email del presupuesto (E2)

- En `DispararE2Adapter` (`presupuestos/infrastructure/disparar-e2.adapter.ts`):
  además del adjunto `presupuesto`, generar la URL de condiciones vía
  `GenerarPdfCondicionesPort.ejecutar/generar({ tenantId })` y **añadir**
  `{ clave: 'condiciones', nombre: 'condicions-particulars.pdf', pdfUrl }` al
  array de adjuntos.
- Es **fire-and-forget post-commit**: si condiciones devuelve `null` (sin
  config), se **OMITE** ese adjunto **sin romper** el despacho E2 (el presupuesto
  se sigue adjuntando si existe). Idempotencia E2 intacta.
- Inyectar el puerto `GENERAR_PDF_CONDICIONES_PORT` en `DispararE2Adapter` y en
  el módulo de presupuestos (importar/exportar desde `DocumentosModule`).

### Fuera de alcance (rebanadas posteriores)

- **Envío por email de la factura de señal (E3)** —hoy inexistente: plantillas
  E2–E8 inactivas, solo E1 activa; la factura de señal solo se genera en
  borrador+PDF y nunca se despacha— → **6.4b** (use-case
  `enviar-factura-senal` espejo de `aprobar-y-enviar-liquidacion`; plantilla E3
  ACTIVA; endpoint `POST /reservas/{id}/factura-senal/enviar` con **contrato +
  SDK**; frontend). **Adjuntar condiciones a E3 es 6.4b.**
- **UI de ajustes del tenant + upload de logo** → **6.5**.
- **Sin cambio de contrato OpenAPI/SDK en 6.4a**: E2 es post-commit interno; no
  hay endpoint nuevo ni cambio de shape de API. Por tanto el `tasks.md` **no**
  tiene fase de contrato/SDK ni de frontend/E2E Playwright.

## Capability elegida y justificación

- **`documentos` (capability principal del delta)**: la generación del PDF de
  Condicions particulars —config `condiciones`, plantilla react-pdf, puerto
  `GenerarPdfCondicionesPort` y adapters— es transversal (la usan E2 en
  presupuestos y, en 6.4b, E3 en facturación). Vive con la config, el storage y
  la capa de plantilla que ya viven en `documentos` (6.1a/6.1b). Es el hogar
  coherente del épico #6 "documentos PDF por tenant".
- **`presupuestos` (delta acotado)**: solo el **adjunto** de condiciones al E2
  (`DispararE2Adapter`) es específico del flujo de presupuesto (US-014 §D-7).
  Reside en `presupuestos`, consumiendo el puerto de `documentos`.

## Trazabilidad

- Épico **#6**, rebanada **6.4a** (roadmap `epico-6-documentos-pdf-roadmap`).
  **No hay US numerada clásica**: es rebanada de épico.
- Base **6.1a** (`documentos-config-tenant-storage`, archivada 2026-07-13):
  reutiliza `ConfiguracionDocumentoTenant`, `PlantillaDocumentoTenant`,
  `AlmacenDocumentosPort`, `ObtenerConfiguracionDocumentoService`,
  `construirConfiguracionDocumentoPiloto`.
- Base **6.1b** (`documentos-presupuesto-pdf-con-iva`, archivada 2026-07-14):
  reutiliza la capa de plantilla react-pdf (`Cabecera`, `estilos.ts`,
  `kit-react-pdf.ts`), el patrón `PdfPresupuestoRealAdapter` (espejo del nuevo
  adapter) y `DispararE2Adapter` (donde se añade el adjunto).
- **US-014 / UC-14** (generar presupuesto + activar pre_reserva): el E2 §D-7 es
  el punto donde se adjunta el documento; puerto `DispararE2Port` y adapter ya
  existen.
- `CLAUDE.md §Arquitectura` (hexagonal: render/almacén son infra; los puertos
  viven en dominio), `§Multi-tenancy` (tenantId + RLS en la nueva columna),
  `§Testing` (TDD), regla dura arrow-functions, guardarraíl `components/` solo
  `.tsx`.

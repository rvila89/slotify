# Change: documentos-rediseno-pdf-logo-storage

## Why

El épico **#6 — Documentos PDF por tenant** entrega los documentos reales
(presupuesto / factura / condicions particulars) como el Excel/dossier del
tenant, con **layout fijo en código y contenido 100% por tenant**. Las
rebanadas previas (6.1a config+storage, 6.1b presupuesto CON IVA, 6.2 SIN IVA,
6.3 facturas 40/60, 6.4a condicions, 6.4b envío E3) están MERGEADAS en master.
Queda **6.5**, la última rebanada del épico.

La rebanada 6.5 estaba planificada como "**UI de ajustes del tenant + upload de
logo**". Se **re-scopea** (decisión cerrada con el usuario en brainstorming):
para el MVP solo hay **un tenant real** (Masia l'Encís) y sus datos ya viven en
el seed (6.1a). No aporta valor un formulario de edición de config ni un editor
de condicions para un único tenant que ya está sembrado. Por tanto 6.5 pasa a
cubrir la deuda visual y de infraestructura que quedó abierta:

1. **El PDF no se parece al documento real de Masia.** El diseño actual (6.1b/6.2)
   es una plantilla neutra genérica; el documento de referencia real
   (`P2026023 Laura Mas.pdf`) tiene una identidad visual muy concreta (logo,
   turquesa `#5edada`, título grande "PRESSUPOST", barra de concepto turquesa,
   franja de totales, mini-tabla de condicions con acento amarillo, pie bancario
   centrado). Hoy el gestor entregaría un PDF que **no representa la marca**.
2. **El storage no es durable.** `AlmacenDocumentosLocalAdapter` guarda los bytes
   **en memoria** (`Map`), lo que era aceptable como cimiento en 6.1a pero
   significa que las URLs (`logoUrl`, `pdf_url`, `condiciones/{tenantId}.pdf`)
   **no resuelven** tras un reinicio ni desde el navegador: no hay ruta que sirva
   esos ficheros. El adaptador cloud (S3/Supabase) sigue difiriéndose hasta que
   haya bucket/credenciales.
3. **No hay logo.** `branding.logoUrl` está `null` en el seed (6.1a) y la cabecera
   se renderiza solo-texto. El asset ya existe en el repo
   (`apps/api/prisma/seed-assets/masia-logo.jpg`) pero nadie lo sube ni lo fija.

Esta rebanada 6.5 = **rediseño fiel del PDF al documento real de Masia + logo en
el seed + storage durable en disco + ruta estática que sirve los ficheros**. Es
**todo backend** (`apps/api`; los templates react-pdf viven ahí). Sin frontend,
sin endpoints de negocio nuevos, sin editor de condicions.

## What Changes

### Bloque A — Storage durable en disco + ruta estática

- **`AlmacenDocumentosLocalAdapter` persiste a disco**, no en memoria. Directorio
  configurable por env **`ALMACEN_LOCAL_DIR`** (con default, p. ej.
  `apps/api/.almacen`), creando subdirectorios por la clave
  (`logos/`, `presupuestos/`, `facturas/`, `condiciones/`). `subir(bytes, clave)`
  escribe el fichero; `urlPublica(clave)` sigue derivando la URL de forma
  determinista desde `ALMACEN_LOCAL_BASE_URL`. Se mantiene el contrato del puerto
  `AlmacenDocumentosPort` **sin cambios** (dominio intacto).
- **Nueva ruta estática `GET /almacen/*`** en la API (fuera del prefijo `/api`,
  contenido estático servido por Nest, p. ej. `ServeStaticModule` o middleware),
  que sirve los ficheros de `ALMACEN_LOCAL_DIR` para que `logoUrl` y `pdf_url`
  resuelvan desde el navegador y desde el render. **No es API de negocio**: es un
  file server de assets, por lo que **no cambia el contrato OpenAPI** (ver
  "Contrato" abajo).
- El adaptador cloud (S3/Supabase) se **sigue difiriendo** como adaptador hermano
  futuro, seleccionable por `ALMACEN_PROVIDER`, sin tocar el dominio.

### Bloque B — Logo del tenant en el seed

- El seed (`prisma/seed.ts`) lee **`apps/api/prisma/seed-assets/masia-logo.jpg`**
  (asset ya presente en el repo), lo sube por
  `AlmacenDocumentosPort.subir(bytes, 'logos/{tenantId}.jpg')` y fija
  `branding.logoUrl` a la URL resultante (hoy `null` en
  `configuracion-documento-piloto.ts`).
- **Carga del logo en react-pdf por data-URI / bytes de disco**, NO por
  auto-request HTTP de la propia API durante el render (frágil: el render puede
  correr antes de que el server escuche, o sin red). El adaptador de PDF resuelve
  los bytes del logo desde el almacén y los pasa a la `Image` de react-pdf como
  data-URI o `Buffer`, no como URL remota.

### Bloque C — Rediseño de la plantilla compartida, fiel a la referencia

Reescribir la capa de presentación compartida de `documentos` para replicar el
documento real de Masia (`P2026023 Laura Mas.pdf`), aplicándolo a **TODOS** los
documentos (presupuesto CON/SIN IVA, factura 40/60, condicions):

- `presentation/estilos.ts` — nueva paleta y layout (turquesa + acento amarillo).
- `presentation/componentes/Cabecera.tsx` — logo arriba-izquierda + identidad
  fiscal arriba-derecha.
- `BloqueCliente.tsx` — bloque "Dades client" a la izquierda + mini-tabla con
  borde `Pressupost | Data` a la derecha.
- `TablaConcepto.tsx` — **barra turquesa** con cabecera blanca `CONCEPTE | PREU`;
  concepto en negrita + líneas indentadas (data / hores / persones); cuerpo con
  borde.
- `BloqueTotales.tsx` — franja `Validesa | Base imp. | % Iva | Total`.
- `PieBancario.tsx` — pie centrado "*Per formalitzar el pagament…" + IBAN
  centrado.
- `DocumentoLayout.tsx`, `DocumentoFacturaLayout.tsx`,
  `DocumentoCondicionesLayout.tsx` — título grande "PRESSUPOST" turquesa;
  mini-tabla con borde de 3 columnas de condicions (40 / 60 / fiança) con acento
  turquesa/amarillo; composición fiel a la referencia.

Las variantes **SIN IVA** y **factura 40/60** se **derivan por las reglas ya
existentes** (flags `cabecera.mostrarIdentidadFiscal`, `totales.mostrarDesgloseIva`,
`pieBancario.mostrar`), **sin PDFs de referencia extra**: se extrapola el lenguaje
visual. El **modelo de vista** (`construirModeloDocumentoPresupuesto`,
`construirModeloDocumentoFactura`, condicions) cambia **mínima o nulamente** — los
datos ya existen; esto es **presentación**. Los tests de **CONTENIDO del modelo**
deben quedar **verdes sin cambios** (los datos no cambian).

### Valores concretos cerrados

- `branding.colorPrimario` del seed: `#1A1A1A` → **turquesa `#5edada`**.
- Nuevo color de **acento amarillo `#ffd978`** (línea/acento inferior del bloque
  concepto / condicions). Se introduce en la capa de estilos (constante de
  presentación, no dato de negocio del tenant salvo que se decida en `design.md`).
- `textos.plantillaConceptoFiscal` del seed:
  `"Gestió de l'ús espai de {nombreComercial} per esdeveniment"` →
  **`"Gestió ús espai de {nombreComercial} per esdeveniment"`** (alinear a la
  referencia). Se **mantiene** el placeholder `{nombreComercial}` y la **regla
  dura del épico**: el concepto **NUNCA** contiene la palabra "lloguer".

### Fuera de alcance

- **Adaptador cloud real** (S3/Supabase): se difiere; el hermano `local` durable
  es suficiente para el MVP del piloto.
- **UI de ajustes del tenant / formulario de edición de config / editor de
  condicions**: descartado del MVP (un solo tenant, ya sembrado).
- **Sin frontend, sin endpoints de negocio nuevos, sin cambio de contrato
  OpenAPI** (ver siguiente sección). Por eso el `tasks.md` **no** tiene fase de
  contrato/SDK ni de E2E Playwright.

## Contrato OpenAPI — sin delta

La ruta estática `GET /almacen/*` es un **file server de assets** (sirve bytes de
ficheros del almacén local), no una API de negocio. No expone recursos del
dominio, no viaja por el SDK generado del frontend, y las URLs (`logoUrl`,
`pdf_url`, `condiciones/{tenantId}.pdf`) ya existen como strings en las respuestas
de negocio (definidas en rebanadas previas); esta rebanada solo hace que esas URLs
**resuelvan**. Por tanto **no hay cambio en `docs/api-spec.yml`** ni regeneración
de SDK. Se **confirma** en `design.md`; si en la implementación se detectara que la
ruta debe documentarse en OpenAPI, se abriría un delta de contrato antes de
continuar (gate de contrato).

## Capability elegida y justificación

Capability única: **`documentos`**. Todo el cambio vive en el módulo/capability
`documentos` de `apps/api`:

- El **storage durable** y su **ruta estática** son el adaptador de infraestructura
  de `AlmacenDocumentosPort`, que ya vive en `documentos` (6.1a).
- El **rediseño de la plantilla** es la capa de presentación de `documentos`,
  compartida por presupuesto, factura y condicions (6.1b/6.3/6.4a).
- El **logo en el seed** y el **texto de concepto** son la config del tenant piloto
  (`configuracion-documento-piloto.ts`), infraestructura de `documentos`.

No se toca `presupuestos` ni `facturacion` (consumen la capa de plantilla y el
puerto sin cambios de firma).

## Trazabilidad

- Épico **#6**, rebanada **6.5** (roadmap `epico-6-documentos-pdf-roadmap`), última
  del épico; re-scopeada de "UI de ajustes" a "rediseño PDF + logo + storage".
- Continúa la spec viva **`documentos`**: reutiliza `AlmacenDocumentosPort` (6.1a),
  `ConfiguracionDocumentoTenant` (6.1a), la capa de plantilla react-pdf
  (6.1b/6.2/6.3/6.4a) y el seed piloto.
- **Documento de referencia real**: `P2026023 Laura Mas.pdf` (presupuesto CON IVA
  del tenant) — diseño target a replicar.
- `presupuesto-parte-b-plan` #6 (datos reales del piloto, Excel/dossier).
- `CLAUDE.md §Arquitectura` (hexagonal: el renderizador y el almacén son
  infra/presentación; el puerto `AlmacenDocumentosPort` no cambia),
  `§Multi-tenancy` (clave por `tenantId`), `§Stack` (react-pdf, Prisma seed),
  regla dura **arrow-functions** y guardarraíl **`componentes/` solo `.tsx`**.
- Regla dura del épico: el concepto fiscal **nunca** contiene "lloguer".

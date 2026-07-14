# Design — documentos-condiciones-particulares-pdf (6.4a)

## Contexto y alcance técnico

Añadir la generación del PDF de "Condicions particulars" (capability
`documentos`) y adjuntarlo al email de presupuesto (E2). El documento es **legal,
largo e idéntico por tenant** (bloque de firma en blanco, sin datos de reserva);
por eso se genera **on-demand con clave fija** `condiciones/{tenantId}.pdf` y se
reutiliza. Es un **espejo** del patrón ya vivo en 6.1b
(`PdfPresupuestoRealAdapter` + capa de plantilla react-pdf de `documentos` +
`DispararE2Adapter`). **Sin cambio de contrato OpenAPI** (E2 es post-commit
interno).

## Bloque A — Generación del PDF (capability `documentos`)

### Config `condiciones` en el VO + migración Prisma

- VO `ConfiguracionDocumentoTenant` (`documentos/domain/configuracion-documento.ts`)
  gana un bloque `condiciones`:

  ```ts
  export interface SeccionCondiciones {
    titulo: string;
    cuerpo: string;
  }
  export interface CondicionesDocumento {
    titulo: string;
    secciones: SeccionCondiciones[];
  }
  // en ConfiguracionDocumentoTenant:
  //   condiciones: CondicionesDocumento;
  ```

- **Migración Prisma** en `PlantillaDocumentoTenant`: columna
  `condiciones Json @map("condiciones")`. Para no romper filas existentes, la
  migración es **no destructiva** (ver cuestión abierta **D2**: nullable +
  backfill del piloto vs. default `'{}'`). La tabla ya es 1-1 con `Tenant` con
  RLS (6.1a); no se recrea la policy.
- `ConfiguracionDocumentoPrismaAdapter.aDominio(...)` mapea la columna JSON al
  bloque `condiciones` (cast tipado del `Json` de Prisma a `CondicionesDocumento`).

### Seed piloto

`construirConfiguracionDocumentoPiloto` añade el bloque `condiciones` con título
"Condicions Particulars" y las 14 secciones reales de Masia. **El texto literal
lo aporta el usuario** (Excel hoja "Condicions particulars"); ver cuestión
abierta **D1**.

### Plantilla react-pdf (ubicación y componentes)

Estructura (espejo de 6.1b; `.tsx` SOLO en `componentes/`):

```
apps/api/src/documentos/presentation/
  modelo-documento-condiciones.ts        # VO de vista + construirModeloDocumentoCondiciones(config)
  documento-condiciones.render.ts        # renderizarDocumentoCondicionesABytes(config) -> Uint8Array
  componentes/
    DocumentoCondicionesLayout.tsx       # raíz: Cabecera + título + lista secciones + firma en blanco
    ListaSeccionesCondiciones.tsx        # lista título+cuerpo por sección
    BloqueFirmaCondiciones.tsx           # bloque de firma EN BLANCO (etiquetas fijas de layout)
  estilos.ts / kit-react-pdf.ts          # REUTILIZADOS de 6.1b (no se duplican)
  componentes/Cabecera.tsx               # REUTILIZADO de 6.1b
```

- `documento-condiciones.render.ts` sigue el patrón ESM de
  `documento-presupuesto.render.ts`: `import()` **nativo** vía `Function` (no
  transpilado a `require`), `renderToBuffer`, `Uint8Array` que empieza por `%PDF`.
  Los `.tsx` NO importan react-pdf: reciben el `kit` de primitivas.
- Las **etiquetas del bloque de firma** (NOM I COGNOMS CLIENT / SIGNATURA CLIENT
  / DNI / DATA ESDEVENIMENT) son **layout fijo** (no contenido de negocio), igual
  que las etiquetas de columnas del presupuesto en 6.1b. El bloque va **en
  blanco** (sin valores).

### Puerto + adapters de generación (espejo de PdfPresupuestoRealAdapter)

- Puerto de dominio `GenerarPdfCondicionesPort`:
  `(params: { tenantId: string }) => Promise<string | null>`.
- **Adapter real** (`documentos/infrastructure/pdf-condiciones.real.adapter.ts`):
  1. `ObtenerConfiguracionDocumentoService.ejecutar(tenantId)`; `null` → `null`.
  2. `renderizar(config)` → bytes (render inyectado como
     `(config) => Promise<Uint8Array>`, como en 6.1b, para no instanciar react-pdf
     en los tests del adapter).
  3. `AlmacenDocumentosPort.subir(bytes, 'condiciones/{tenantId}.pdf')` → url.
- **Adapter fake** (`pdf-condiciones.fake.adapter.ts`) para tests: URL sintética.
- Token `GENERAR_PDF_CONDICIONES_PORT` en `documentos.tokens.ts`.
- `DocumentosModule` provee y **exporta** el token (factory que inyecta
  `ObtenerConfiguracionDocumentoService`, `ALMACEN_DOCUMENTOS_PORT` y el render).

> **Nota de firma del puerto**: la firma pedida es `(params) => Promise<...>`. Se
> materializa como una **propiedad `generar`/`ejecutar`** del adapter (patrón de
> 6.1b: `readonly generar: GenerarPdfPresupuestoPort = async (params) => {...}`).
> Se decide en implementación el nombre del método (`generar` para alinear con
> 6.1b). No afecta al diseño.

## Bloque B — Adjuntar condiciones al E2 (capability `presupuestos`)

`DispararE2Adapter` (`presupuestos/infrastructure/disparar-e2.adapter.ts`) recibe
inyectado el `GENERAR_PDF_CONDICIONES_PORT`. Tras resolver el presupuesto:

```ts
const adjuntos: Adjunto[] = [];
if (params.pdfUrl !== null) {
  adjuntos.push({ clave: 'presupuesto', nombre: 'presupuesto.pdf', pdfUrl: params.pdfUrl });
}
const urlCondiciones = await this.generarCondiciones.generar({ tenantId: params.tenantId });
if (urlCondiciones !== null) {
  adjuntos.push({ clave: 'condiciones', nombre: 'condicions-particulars.pdf', pdfUrl: urlCondiciones });
}
await this.motorEmail.despachar({ ..., adjuntos });
```

- **Post-commit fire-and-forget**: si condiciones devuelve `null`, se omite sin
  romper el E2. El presupuesto se adjunta igual que hoy.
- **Wiring**: `PresupuestosModule` importa `DocumentosModule` (ya lo hace por el
  PDF del presupuesto en 6.1b) y `DispararE2Adapter` gana la dependencia del
  token de condiciones.
- **Sin cambio de contrato**: E2 es interno; el shape de la API no cambia. El
  `tasks.md` no tiene fase de contrato/SDK ni de frontend/E2E Playwright.

## Reglas duras aplicadas

- **Hexagonal/DDD**: `GenerarPdfCondicionesPort` y `AlmacenDocumentosPort` viven
  en dominio; render y almacén son infra. `documento-condiciones.render.ts` no
  contamina el dominio.
- **Multi-tenant/RLS**: la columna `condiciones` vive en `PlantillaDocumentoTenant`
  (1-1 con Tenant, RLS activo); la config se lee bajo RLS; clave de almacenamiento
  con `tenant_id`.
- **TDD**: tests primero — render de la plantilla de condiciones, VO config con
  `condiciones`, seed piloto (14 secciones), adapter Prisma de config (mapea la
  columna JSON), adapter real (degrada a `null` sin config; aísla la clave por
  tenant), y `DispararE2Adapter` (añade el adjunto condiciones; lo omite si
  `null`).
- **ESM react-pdf**: tests con `NODE_OPTIONS=--experimental-vm-modules` (ya en el
  script `test`).
- **Arrow functions**, guardarraíl `componentes/` solo `.tsx`.
- **Verificación de PDF/integración desde la sesión principal** (los subagentes QA
  no tienen Postgres/Docker).

## Cuestiones abiertas (PARA EL GATE — no resueltas aquí)

### D1 — Texto literal de las 14 secciones de Masia

**Contexto**: el seed debe llevar el texto REAL de la hoja "Condicions
particulars" del Excel del tenant. Ese texto **no está** verbatim en las notas
del roadmap; solo los **títulos** de las 14 secciones y el título del documento.

**Propuesta**: en el gate, el usuario aporta el texto íntegro (o autoriza
parsear el Excel `Plantilla_factures i pressupostos.xlsx` con Python stdlib —
zipfile+xml.etree, como en 6.3— desde la sesión principal). En implementación se
poblan los 14 `cuerpo`. **Pregunta al humano**: ¿pegas el texto literal, o
autorizas parsear el Excel desde la sesión principal para extraerlo?

### D2 — Estrategia de la migración de la columna JSON

**Contexto**: `PlantillaDocumentoTenant` puede tener filas existentes (el
piloto). Añadir `condiciones Json` sin default rompería el `create`/lecturas.

**Propuesta**: columna `condiciones Json` **con default `'{}'`** (o nullable) en
la migración, y **backfill** de la fila del piloto vía el seed re-ejecutado (el
seed hace `deleteMany + create` del piloto). **Pregunta al humano**: ¿default
`'{}'` + reseed del piloto, o columna nullable con backfill explícito? ¿El VO
tolera `condiciones` vacío (0 secciones) degradando el documento, o exige
secciones?

### D3 — ¿Qué hace el render si `condiciones` está vacío?

**Contexto**: un tenant sin secciones configuradas.

**Propuesta**: el adapter real degrada a `null` si no hay config del tenant
(igual que 6.1b). Si hay config pero `condiciones.secciones` está vacío, el
render produce un PDF con cabecera + título + bloque de firma y **sin secciones**
(no falla). **Pregunta al humano**: ¿OK generar el PDF aunque no haya secciones,
o preferís degradar a `null` (no adjuntar) cuando no hay secciones?

### D4 — Confirmación: sin cambio de contrato OpenAPI

**Análisis**: E2 es post-commit interno; no hay endpoint nuevo ni cambio de
shape. El adjunto viaja dentro del motor de email, no por la API.

**Propuesta**: **sin delta de contrato ni regeneración de SDK**; el `tasks.md` no
tiene fase de contrato ni de frontend/E2E. **Pregunta al humano**: ¿confirmáis
que 6.4a no toca OpenAPI (el envío E3 y su endpoint son 6.4b)?

### D5 — Verificación visual del PDF en QA

**Contexto**: el PDF es binario; los subagentes QA corren sin Postgres.

**Propuesta**: QA en dos capas — (a) **tests unitarios de render** (bytes no
vacíos, empieza por `%PDF`, contiene los títulos de sección y las etiquetas del
bloque de firma); (b) **verificación de integración desde la sesión principal**
(que sí tiene Postgres): seed → generar el PDF de condiciones → descargar del
almacén local → **abrir/inspeccionar visualmente** (guardar muestra en
`reports/`). No hay endpoint HTTP nuevo → el `step-N+2` (curl) es limitado; se
propone **cubrirlo con el disparo del E2 en integración** (verificar que el email
lleva los dos adjuntos) en lugar de curl a un endpoint inexistente. **Pregunta al
humano**: ¿validáis este plan (render unit + integración PDF + verificación del
E2 con dos adjuntos, sin fase Playwright)?

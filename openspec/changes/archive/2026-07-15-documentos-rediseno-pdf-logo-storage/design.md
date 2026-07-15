# Design — documentos-rediseno-pdf-logo-storage (6.5)

Decisiones técnicas no triviales de la rebanada 6.5. Se aprueban en el gate SDD.

## Contexto

- Todo backend en `apps/api`, capability `documentos`. Sin frontend, sin
  endpoints de negocio nuevos.
- Documento de referencia real (target del rediseño):
  `C:\Users\roger.vila\OneDrive - Atmira Espacio de Consultoría SL\ENCIS\P2026023 Laura Mas.pdf`
  (presupuesto CON IVA del tenant piloto).
- Diseño anterior (before, a sustituir):
  `openspec/changes/archive/2026-07-14-documentos-presupuesto-pdf-con-iva/reports/muestra-presupuesto-con-iva.pdf`.
- Estado actual relevante:
  - `AlmacenDocumentosLocalAdapter` guarda en un `Map` en memoria; `urlPublica`
    deriva de `ALMACEN_LOCAL_BASE_URL` (`http://localhost:3000/almacen` por
    defecto). No existe ruta que sirva esos ficheros.
  - `configuracion-documento-piloto.ts`: `branding.logoUrl = null`,
    `colorPrimario = '#1A1A1A'`,
    `plantillaConceptoFiscal = "Gestió de l'ús espai de {nombreComercial} per esdeveniment"`.
  - Asset ya en el repo: `apps/api/prisma/seed-assets/masia-logo.jpg` (JPG, no PNG).
  - `Cabecera.tsx` ya soporta `logoUrl` en `<Image src={...}>` (hoy nunca se usa
    porque `logoUrl = null`).

## Cuestiones abiertas / decisiones a aprobar

### A — Mecanismo de la ruta estática `GET /almacen/*`

**Contexto**: hay que servir los ficheros de `ALMACEN_LOCAL_DIR` para que
`logoUrl`/`pdf_url` resuelvan desde el navegador. El prefijo global de la API es
`/api`; la base actual del almacén es `.../almacen` (sin `/api`).

**Propuesta**: usar `@nestjs/serve-static` (`ServeStaticModule.forRoot`) montado en
`serveRoot: '/almacen'` con `rootPath = ALMACEN_LOCAL_DIR`, **fuera** del prefijo
`/api` (el prefijo global no aplica a assets estáticos). Alternativa: middleware
Express `express.static`. Mantener `ALMACEN_LOCAL_BASE_URL` como base pública para
que `urlPublica` siga siendo determinista y coherente con la ruta servida.

**A decidir**: `@nestjs/serve-static` vs `express.static` a mano; si se añade la
dependencia. **No es API de negocio** → no se documenta en OpenAPI (ver E).

**✅ Decidido (gate SDD)**: **`@nestjs/serve-static`** (`ServeStaticModule.forRoot`,
`serveRoot: '/almacen'`, `rootPath = ALMACEN_LOCAL_DIR`, fuera del prefijo `/api`).
Se añade la dependencia. Acotar el directorio servido al almacén.

### B — Carga del logo en react-pdf: bytes/data-URI, no auto-request HTTP

**Contexto**: react-pdf `<Image src>` acepta una URL, un `Buffer`/`Uint8Array` o un
data-URI. Cargar por URL remota (`http://localhost:3000/almacen/logos/…`) durante
el render obliga a que el server esté escuchando y haya red — frágil, sobre todo en
tests y en el momento post-commit del render.

**Propuesta**: el adaptador de PDF (presupuesto/factura/condicions) resuelve los
**bytes del logo** desde `AlmacenDocumentosPort` (nueva capacidad de lectura o
lectura directa de disco por clave) y los pasa a la cabecera como `Buffer` o
data-URI (`data:image/jpeg;base64,…`). El modelo de vista transporta los bytes/URI
del logo, no una URL remota. Si el logo no se resuelve → `null` → cabecera
solo-texto (sin romper el render).

**A decidir**: si `AlmacenDocumentosPort` gana una operación de lectura
(`obtener(clave): Promise<Uint8Array | null>`) — cambio de puerto de dominio,
mínimo y coherente — o si la lectura de bytes vive solo en el adaptador de infra.
Preferencia: mantener el puerto lo más estable posible; evaluar en implementación.

**✅ Decidido (gate SDD)**: **añadir `obtener(clave): Promise<Uint8Array | null>`
al puerto `AlmacenDocumentosPort`** (hexagonal limpio: el storage lee y escribe).
El adaptador local durable lo implementa leyendo de disco; el adaptador de PDF
obtiene los bytes del logo por clave y los pasa a la `Image` como data-URI/`Buffer`.
Devuelve `null` si la clave no existe → cabecera solo-texto (sin romper el render).

### C — Color de acento amarillo `#ffd978`: constante de presentación vs dato del tenant

**Contexto**: el turquesa `#5edada` ya es `branding.colorPrimario` (dato del
tenant). El acento amarillo de la referencia (`#ffd978`) es un segundo color de
marca.

**Propuesta**: introducir `#ffd978` como **constante de la capa de estilos**
(presentación), no como dato del tenant, para no ampliar el esquema de `branding`
en la última rebanada del épico (un solo tenant real). Se documenta que, si el
futuro multi-tenant lo exige, se promueve a `branding.colorSecundario` en un change
aparte. Esto es coherente con "layout fijo en código, contenido por tenant": el
acento es lenguaje visual de layout.

**A decidir**: aceptar la constante de presentación (recomendado) vs añadir ya
`branding.colorSecundario` (migración + seed + VO).

**✅ Decidido (gate SDD)**: **constante de presentación** en la capa de estilos
(`#ffd978`), NO dato del tenant. Sin migración ni cambio de VO/seed para el acento.
Documentado: se promueve a `branding.colorSecundario` en un change aparte si el
multi-tenant lo exige.

### D — Alcance del rediseño en SIN IVA / factura / condicions

**Propuesta**: rediseñar la capa **compartida** una sola vez; las variantes SIN
IVA y factura 40/60 heredan el lenguaje visual y **derivan** las omisiones por los
flags existentes (`mostrarIdentidadFiscal`, `mostrarDesgloseIva`,
`pieBancario.mostrar`). Sin PDFs de referencia extra: se extrapola. El modelo de
vista cambia mínima o nulamente; los tests de contenido del modelo quedan verdes.
QA visual genera muestras de las 4 variantes para verificar coherencia.

### E — Sin cambio de contrato OpenAPI (confirmación)

`GET /almacen/*` es un file server de assets, no API de negocio: no expone recursos
del dominio, no viaja por el SDK generado, y las URLs (`logoUrl`, `pdf_url`,
`condiciones/{tenantId}.pdf`) ya existen como strings en respuestas de negocio de
rebanadas previas. **Conclusión: sin delta de `docs/api-spec.yml`, sin regeneración
de SDK, sin fase de contrato ni de E2E Playwright.** Si en implementación se
detectara necesidad de documentar la ruta en OpenAPI, se abre delta de contrato
antes de continuar.

## Riesgos

- **Flakiness ESM de react-pdf** (MEMORY: suites de render juntas en rojo con
  `pnpm test` global). Mitigación: verificar cada suite de render en aislamiento;
  las muestras visuales se generan desde la sesión principal.
- **Regresión de contenido** al tocar la capa compartida. Mitigación: los tests de
  contenido del modelo NO deben cambiar; si cambian, es señal de que el rediseño
  se coló en el modelo de vista (debe ser solo presentación).
- **Tests de integración/render y muestras** requieren Postgres y render real → se
  lanzan desde la **sesión principal** (los subagentes QA no tienen BD).

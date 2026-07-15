# Spec Delta — Capability `documentos`

> Rebanada **6.5** del épico #6 (última), apilada sobre las rebanadas previas de
> `documentos` (6.1a/6.1b/6.2/6.3/6.4a). Re-scopeada de "UI de ajustes" a
> **rediseño fiel del PDF al documento real de Masia + logo en el seed + storage
> durable en disco + ruta estática**. Todo backend, sin frontend, sin cambio de
> contrato OpenAPI.
>
> - **MODIFICA** el adaptador de almacén (memoria → disco durable + ruta estática).
> - **MODIFICA** el seed piloto (logo + texto de concepto alineado a la referencia).
> - **MODIFICA** el requirement de cabecera solo-texto (carga del logo por
>   bytes/data-URI, no por auto-request HTTP; identidad visual de la referencia).
> - **AÑADE** el requirement de fidelidad visual de la plantilla a la referencia.
>
> Fuente: `epico-6-documentos-pdf-roadmap` §6.5; documento de referencia real
> `P2026023 Laura Mas.pdf`; spec viva `documentos`; `CLAUDE.md §Arquitectura /
> §Multi-tenancy / §Stack`, regla arrow-functions y guardarraíl `componentes/`
> solo `.tsx`.

## MODIFIED Requirements

### Requirement: Adaptador de almacén configurable por entorno sin credenciales en tests

El sistema SHALL (DEBE) proveer una implementación de `AlmacenDocumentosPort` en la
capa de **infraestructura**, seleccionada y configurada por **variables de
entorno** (proveedor y credenciales/bucket). El adaptador `local` (proveedor por
defecto, `ALMACEN_PROVIDER=local`) SHALL (DEBE) **persistir los bytes en disco**,
no en memoria: escribe cada objeto en un directorio configurable por env
**`ALMACEN_LOCAL_DIR`** (con default), creando los subdirectorios que la clave
implique (p. ej. `logos/`, `presupuestos/`, `facturas/`, `condiciones/`). Tras
`subir(bytes, clave)`, el fichero existe en `ALMACEN_LOCAL_DIR/{clave}` y
`urlPublica(clave)` devuelve una URL determinista derivada de
`ALMACEN_LOCAL_BASE_URL` (misma clave → misma URL). El contrato del puerto
`AlmacenDocumentosPort` **no cambia** (el dominio queda intacto). La configuración
por env DEBE permitir que los **tests no dependan de credenciales cloud** (el
adaptador `local` escribe a un directorio temporal/aislado en tests, sin S3/
Supabase). El adaptador cloud real (S3/Supabase) sigue **diferido** como adaptador
hermano seleccionable por `ALMACEN_PROVIDER`, sin tocar el dominio. (Fuente:
`epico-6-documentos-pdf-roadmap` §6.1a/§6.5; `CLAUDE.md §Stack / §Arquitectura`;
`design.md` cuestión abierta A.)

#### Scenario: El adaptador se selecciona por variables de entorno

- **GIVEN** las variables de entorno que definen proveedor/credenciales del almacén
- **WHEN** arranca la aplicación
- **THEN** se inyecta la implementación de `AlmacenDocumentosPort` acorde a esa
  configuración

#### Scenario: El adaptador local persiste los bytes en disco

- **GIVEN** el adaptador `local` con `ALMACEN_LOCAL_DIR` apuntando a un directorio
- **WHEN** se invoca `subir(bytes, 'logos/{tenantId}.jpg')`
- **THEN** existe el fichero `ALMACEN_LOCAL_DIR/logos/{tenantId}.jpg` con esos bytes
- **AND** una posterior `urlPublica('logos/{tenantId}.jpg')` devuelve la URL
  determinista derivada de `ALMACEN_LOCAL_BASE_URL` para esa misma clave

#### Scenario: Los bytes persisten entre reinicios del proceso

- **GIVEN** un fichero subido por el adaptador `local` a `ALMACEN_LOCAL_DIR`
- **WHEN** el proceso de la API se reinicia
- **THEN** el fichero sigue existiendo en disco y sigue siendo servible por su clave
  (a diferencia del almacén en memoria, que se perdía al reiniciar)

#### Scenario: Los tests no requieren credenciales cloud

- **WHEN** se ejecuta la suite de tests (`pnpm test`)
- **THEN** los tests del puerto/adaptador de almacén se ejecutan con el adaptador
  `local` sobre un directorio temporal/aislado, sin necesitar credenciales de
  S3/Supabase

### Requirement: Seed idempotente de la configuración de documento del tenant piloto

El seed (`apps/api/prisma/seed.ts`) SHALL (DEBE) provisionar la
`PlantillaDocumentoTenant` del tenant piloto **Masia l'Encís** con los datos reales:
`razon_social_fiscal = "Canoliart, SL"`, `nombre_comercial = "Masia l'Encís"`,
`nif = "B10874287"`, `direccion_fiscal = "08731 - Sant Martí Sarroca / Barcelona"`,
`web = "www.masialencis.com"`, `email = "info@masialencis.com"`,
`iban = "ES30 0182 1683 4002 0172 9599"`,
`beneficiario_transferencia = "Canoliart, SL"`,
`concepto_transferencia = "Masia l'Encís"`, y los textos de
`plantilla_concepto_fiscal`, `validesa_texto` y `pie_legal`. El seed SHALL (DEBE)
además **subir el logo del tenant**: lee el asset del repo
`apps/api/prisma/seed-assets/masia-logo.jpg`, lo sube por
`AlmacenDocumentosPort.subir(bytes, 'logos/{tenantId}.jpg')` y fija
`branding.logo_url` a la URL resultante (dejando de ser `null`). El
`plantilla_concepto_fiscal` DEBE expresar **"Gestió ús espai de {nombreComercial}
per esdeveniment"** (alineado al documento de referencia del tenant),
manteniendo el placeholder `{nombreComercial}` y **nunca** conteniendo la palabra
"lloguer". El seed DEBE ser **idempotente** (`deleteMany` + `create`/`createMany`
y subida del logo con clave fija por tenant, sobrescribible), de modo que
re-ejecutarlo no duplique filas ni cambie el resultado final. (Fuente:
`presupuesto-parte-b-plan` #6 datos reales; `epico-6-documentos-pdf-roadmap` §6.5;
capability `foundation` requirement "Seed del tenant piloto Masia l'Encís"; regla
del épico "concepto nunca lloguer".)

#### Scenario: El seed crea la configuración del piloto con los datos reales

- **WHEN** se ejecuta `pnpm db:seed` tras migrar
- **THEN** existe una `PlantillaDocumentoTenant` del tenant Masia l'Encís con
  `razon_social_fiscal = "Canoliart, SL"`, `nombre_comercial = "Masia l'Encís"`,
  `nif = "B10874287"` e `iban = "ES30 0182 1683 4002 0172 9599"`

#### Scenario: El seed sube el logo del tenant y fija logo_url

- **WHEN** se ejecuta `pnpm db:seed` tras migrar
- **THEN** el logo `masia-logo.jpg` se ha subido por
  `AlmacenDocumentosPort.subir(bytes, 'logos/{tenantId}.jpg')`
- **AND** `branding.logo_url` de la `PlantillaDocumentoTenant` del piloto es una
  URL no nula que referencia ese logo (deja de ser `null`)

#### Scenario: El concepto fiscal usa "espai" y nunca "lloguer"

- **GIVEN** la `PlantillaDocumentoTenant` sembrada del piloto
- **WHEN** se lee `plantilla_concepto_fiscal`
- **THEN** el texto expresa "Gestió ús espai de {nombreComercial} per esdeveniment"
- **AND** no contiene la palabra "lloguer"

#### Scenario: Re-ejecutar el seed es idempotente

- **GIVEN** el seed ya ejecutado una vez
- **WHEN** se ejecuta `pnpm db:seed` de nuevo
- **THEN** sigue existiendo exactamente una `PlantillaDocumentoTenant` por tenant
  piloto, con los mismos valores (sin filas duplicadas)
- **AND** el logo sigue subido bajo la misma clave `logos/{tenantId}.jpg` (sin
  duplicar objetos)

### Requirement: Cabecera solo-texto cuando no hay logo del tenant

La `Cabecera` de la plantilla SHALL (DEBE) renderizar la identidad fiscal del
emisor (razón social fiscal, NIF, dirección fiscal, email, web) tomada de la
config del tenant, y el **logo del tenant** cuando `branding.logo_url` esté
presente. El logo SHALL (DEBE) cargarse en react-pdf a partir de los **bytes del
fichero** (data-URI o `Buffer` resuelto desde el almacén de documentos), **NO**
mediante un auto-request HTTP de la propia API durante el render (patrón frágil:
el render puede correr antes de que el servidor escuche o sin red). Cuando
`branding.logo_url` sea **`null`** (o el logo no se pueda resolver), la cabecera
DEBE renderizarse **solo-texto** sin romper el layout ni fallar el render. La
disposición fiel a la referencia del tenant es **logo arriba-izquierda** e
**identidad fiscal arriba-derecha**. (Fuente: `documentos` 6.1a
`branding.logo_url` nullable; `epico-6-documentos-pdf-roadmap` §6.5; documento de
referencia `P2026023 Laura Mas.pdf`; `design.md` cuestión abierta B.)

#### Scenario: Render con logo lo carga por bytes, no por URL remota

- **GIVEN** una `ConfiguracionDocumentoTenant` con `branding.logo_url` no nulo y el
  fichero del logo disponible en el almacén de documentos
- **WHEN** se renderiza el documento
- **THEN** la cabecera incluye el logo, cargado a partir de sus **bytes**
  (data-URI/`Buffer`) sin que el render haga una petición HTTP a la propia API

#### Scenario: Render sin logo produce cabecera solo-texto

- **GIVEN** una `ConfiguracionDocumentoTenant` con `branding.logo_url = null` (o un
  logo que no se puede resolver)
- **WHEN** se renderiza el documento
- **THEN** el PDF se genera correctamente con una cabecera de solo-texto (razón
  social fiscal, NIF, dirección, email, web) sin hueco roto ni error de render

## ADDED Requirements

### Requirement: Fidelidad visual de la plantilla de documentos al diseño real del tenant

La capa de plantilla react-pdf de `documentos` SHALL (DEBE) replicar la **identidad
visual** del documento real del tenant (referencia `P2026023 Laura Mas.pdf`),
aplicada de forma consistente a **TODOS** los tipos de documento (presupuesto CON
IVA, presupuesto SIN IVA, factura 40/60 y condicions particulars). El rediseño
afecta a la capa **compartida** de presentación (`estilos.ts`, `Cabecera`,
`BloqueCliente`, `TablaConcepto`, `BloqueTotales`, `PieBancario`,
`DocumentoLayout`, `DocumentoFacturaLayout`, `DocumentoCondicionesLayout`) y DEBE
incluir, para la variante CON IVA (documento canónico de referencia):

- **Cabecera**: logo arriba-izquierda + identidad fiscal arriba-derecha.
- **Título** grande "PRESSUPOST" en **turquesa** (`branding.color_primario`,
  `#5edada` en el piloto).
- **Bloque "Dades client"** a la izquierda y una **mini-tabla con borde**
  `Pressupost | Data` a la derecha.
- **Tabla de concepto** con **barra turquesa** de cabecera y texto blanco
  (`CONCEPTE | PREU`), concepto en negrita + líneas indentadas (data / hores /
  persones), cuerpo con borde.
- **Franja de totales** `Validesa | Base imp. | % Iva | Total`.
- **Mini-tabla con borde de 3 columnas** de condicions (40 / 60 / fiança) con
  **acento turquesa/amarillo** (color de acento `#ffd978`).
- **Pie** centrado ("*Per formalitzar el pagament…") + **IBAN centrado**.

El **layout es fijo en código**; el **contenido sigue siendo 100% del
tenant/documento** (colores desde `branding`, textos y datos desde la config y el
documento): la plantilla NO PUEDE hardcodear datos de negocio (razón social, NIF,
IBAN, textos de concepto/validesa). Las variantes **SIN IVA** y **factura 40/60**
se **derivan por los flags ya existentes** (`cabecera.mostrarIdentidadFiscal`,
`totales.mostrarDesgloseIva`, `pieBancario.mostrar`), **sin PDFs de referencia
extra** (se extrapola el lenguaje visual). El cambio es de **presentación**: el
modelo de vista cambia mínima o nulamente y los tests de **contenido del modelo**
quedan verdes sin cambios. Todas las funciones nombradas se escriben como **arrow
functions** y los ficheros de `presentation/componentes/` son SOLO `.tsx`. (Fuente:
`epico-6-documentos-pdf-roadmap` §6.5; documento de referencia `P2026023 Laura
Mas.pdf`; `documentos` 6.1b capa de plantilla; `CLAUDE.md §Stack` arrow-functions
y guardarraíl `componentes/` solo `.tsx`; `design.md` cuestiones abiertas C/D.)

#### Scenario: El presupuesto CON IVA replica la identidad visual de la referencia

- **GIVEN** el tenant piloto con `branding.color_primario = "#5edada"` y su logo
  subido
- **WHEN** se renderiza el presupuesto CON IVA
- **THEN** el PDF muestra el logo arriba-izquierda, la identidad fiscal
  arriba-derecha, el título "PRESSUPOST" en turquesa, la tabla de concepto con
  barra turquesa y cabecera `CONCEPTE | PREU`, la franja `Validesa | Base imp. | %
  Iva | Total`, la mini-tabla de condicions 40/60/fiança con acento amarillo, y el
  pie con el IBAN centrado

#### Scenario: El rediseño no hardcodea contenido de negocio

- **GIVEN** dos tenants con `ConfiguracionDocumentoTenant` distintas (distinto
  `color_primario`, razón social, NIF, IBAN, textos)
- **WHEN** se renderiza el mismo tipo de documento para cada tenant
- **THEN** cada PDF refleja los colores y datos del tenant correspondiente
- **AND** no aparece ningún valor de negocio fijo compartido entre ambos (solo el
  color de acento de presentación es una constante de layout)

#### Scenario: Las variantes SIN IVA y factura 40/60 se derivan por flags sin regresión de contenido

- **GIVEN** un presupuesto SIN IVA y una factura de señal (40%) del mismo tenant
- **WHEN** se renderizan con la plantilla rediseñada
- **THEN** cada documento aplica el nuevo lenguaje visual coherente con la
  referencia, derivando la ausencia de identidad fiscal / desglose de IVA / pie
  bancario por los flags `mostrarIdentidadFiscal` / `mostrarDesgloseIva` /
  `pieBancario.mostrar`
- **AND** los tests de contenido del modelo de vista (datos: concepto, importes,
  reparto, validesa) siguen verdes sin cambios, porque el cambio es de presentación

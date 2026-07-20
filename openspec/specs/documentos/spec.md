# documentos Specification

## Purpose
TBD - created by archiving change documentos-config-tenant-storage. Update Purpose after archive.
## Requirements
### Requirement: Configuración de documento por tenant (PlantillaDocumentoTenant)

El sistema SHALL (DEBE) modelar una entidad de configuración
`PlantillaDocumentoTenant` con relación **1-1 con `Tenant`** (`tenant_id` con
restricción **UNIQUE** y FK a `Tenant`) que contenga el contenido configurable de
los documentos del tenant, agrupado en cuatro bloques:

- **Branding**: `logo_url` (`nullable`, referencia a object storage),
  `color_primario`, `color_texto`.
- **Identidad fiscal**: `razon_social_fiscal`, `nombre_comercial` (campos
  **distintos**: la razón social fiscal no es el nombre comercial), `nif`,
  `direccion_fiscal` (texto multi-línea), `web`, `email`.
- **Banca**: `iban`, `beneficiario_transferencia`, `concepto_transferencia`.
- **Textos**: `plantilla_concepto_fiscal`, `validesa_texto`, `pie_legal`.

Esta entidad es la **fuente de verdad del contenido de los documentos** del tenant.
El change **NO** elimina ni migra los campos existentes `Tenant.nombre`/`nif`/
`direccion` (los usa el resto del sistema). El modelo requiere una **migración
Prisma** que cree la tabla `plantilla_documento_tenant`. Esta rebanada (6.1a)
**NO** genera ningún PDF ni consume esta configuración desde un documento: solo la
establece para que la rebanada 6.1b la consuma. (Fuente: épico #6 rebanada 6.1a,
`epico-6-documentos-pdf-roadmap`; `presupuesto-parte-b-plan` #6; `CLAUDE.md
§Máquina de estados / Documentación de referencia`.)

#### Scenario: La razón social fiscal y el nombre comercial son campos distintos

- **GIVEN** una `PlantillaDocumentoTenant` con `razon_social_fiscal = "Canoliart, SL"`
  y `nombre_comercial = "Masia l'Encís"`
- **WHEN** se lee la configuración de documento del tenant
- **THEN** `razon_social_fiscal` y `nombre_comercial` se devuelven como valores
  independientes, sin colapsar en un único campo `nombre`

#### Scenario: La configuración es 1-1 con el tenant

- **GIVEN** un `Tenant` con una `PlantillaDocumentoTenant` ya creada
- **WHEN** se intenta insertar una segunda `PlantillaDocumentoTenant` con el mismo
  `tenant_id`
- **THEN** la inserción falla por violación de la restricción `UNIQUE(tenant_id)`

#### Scenario: La migración crea la tabla con la restricción única

- **WHEN** se aplican las migraciones Prisma
- **THEN** existe la tabla `plantilla_documento_tenant` con `tenant_id` UNIQUE y FK
  a `Tenant`, y los campos de branding, identidad fiscal, banca y textos

### Requirement: Aislamiento multi-tenant con RLS de la configuración de documento

La tabla `plantilla_documento_tenant` SHALL (DEBE) incluir `tenant_id` y tener
**Row-Level Security** habilitada con una política que filtre por
`current_setting('app.tenant_id')`, igual que el resto de tablas de negocio. En
runtime, el `tenant_id` DEBE derivar del contexto de tenant (JWT), nunca de datos
de entrada; en el **seed** se escribe directamente el `tenant_id` del piloto. Un
tenant NO PUEDE leer ni escribir la configuración de documento de otro tenant.
(Fuente: `CLAUDE.md §Multi-tenancy`; capability `foundation` requirement
"Multi-tenancy con tenant_id y RLS".)

#### Scenario: RLS habilitado en la migración de la tabla

- **WHEN** se aplican las migraciones
- **THEN** `plantilla_documento_tenant` tiene `ENABLE ROW LEVEL SECURITY`
- **AND** existe una `POLICY` que filtra por `current_setting('app.tenant_id')`

#### Scenario: Un tenant no ve la configuración de otro tenant

- **GIVEN** dos tenants A y B, cada uno con su `PlantillaDocumentoTenant`
- **WHEN** se consulta la configuración bajo el contexto RLS del tenant A
- **THEN** solo se devuelve la `PlantillaDocumentoTenant` del tenant A
- **AND** la del tenant B no es visible ni modificable

### Requirement: Puerto de dominio para el almacén de documentos

El sistema SHALL (DEBE) definir en el **dominio** un puerto `AlmacenDocumentosPort`
(interfaz, sin imports de framework ni de infraestructura) que abstraiga el
almacenamiento de objetos, con al menos las operaciones:

- `subir(bytes, clave): Promise<url>` — persiste los bytes bajo una clave y
  devuelve la URL con la que referenciarlos.
- `urlPublica(clave)` — devuelve la URL pública/accesible de una clave existente.

El puerto sirve para el **logo del tenant** en esta rebanada y para los **PDFs
generados** en 6.1b. El dominio NO PUEDE conocer el proveedor concreto (S3,
Supabase, filesystem): solo depende de la interfaz. (Fuente: `CLAUDE.md
§Arquitectura` "los puertos (interfaces) viven en dominio; los adaptadores en
infraestructura"; hook `no-infra-in-domain`.)

#### Scenario: El puerto vive en el dominio sin acoplarse a infraestructura

- **WHEN** se inspecciona la definición de `AlmacenDocumentosPort`
- **THEN** está en la capa `domain/` y no importa `@nestjs`, `prisma`, SDK de S3,
  cliente de Supabase ni ninguna librería de infraestructura

#### Scenario: subir devuelve una URL referenciable

- **GIVEN** una implementación del puerto (real o doble de test)
- **WHEN** se invoca `subir(bytes, clave)`
- **THEN** se resuelve con una URL que permite referenciar el objeto subido
- **AND** una posterior `urlPublica(clave)` devuelve una URL para esa misma clave

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

### Requirement: Capa de plantilla de documentos react-pdf reutilizable

El sistema SHALL (DEBE) proveer una **capa de componentes de plantilla de
documentos** basada en `@react-pdf/renderer`, en la capa de presentación de
documentos de la capability `documentos`, con un componente raíz
`DocumentoLayout` compuesto por, al menos, los sub-componentes `Cabecera`,
`BloqueCliente`, `TablaConcepto`, `BloqueTotales` y `PieBancario`. La plantilla
DEBE ser **parametrizable** por:

- la **configuración del tenant** (`ConfiguracionDocumentoTenant` de 6.1a:
  branding, identidad fiscal, banca, textos), y
- los **datos del documento concreto** (emisor, cliente, conceptos, totales,
  numeración, fecha), incluyendo el **idioma del documento** (`idioma ∈ {es, ca}`,
  default `es`): el modelo de vista resuelve TODAS las etiquetas fijas del layout
  en ese idioma (dentro del builder puro o helpers puros de i18n), y los
  componentes react-pdf solo pintan strings ya resueltos.

El **layout es fijo en código**; el **contenido es 100% del tenant/documento**:
la plantilla NO PUEDE contener datos de negocio hardcodeados (razón social, NIF,
IBAN, textos de concepto/validesa, colores). La capa DEBE ser **reutilizable por
las facturas de 6.3** sin depender de la capability `presupuestos`. Todas las
funciones nombradas se escriben como **arrow functions** (regla dura del
proyecto). (Fuente: `epico-6-documentos-pdf-roadmap` §Motor react-pdf + layout
fijo/contenido por tenant; `CLAUDE.md §Stack`, regla arrow-functions; change
`pdf-presupuesto-horario-idioma` — parametrización por idioma.)

#### Scenario: La plantilla no hardcodea contenido de negocio

- **GIVEN** dos tenants con `ConfiguracionDocumentoTenant` distintas (distinta
  razón social fiscal, NIF, IBAN, colores y textos)
- **WHEN** se renderiza el mismo tipo de documento para cada tenant con la capa
  de plantilla
- **THEN** cada PDF refleja los datos del tenant correspondiente
- **AND** no aparece ningún valor de negocio fijo compartido entre ambos

#### Scenario: La capa de plantilla es reutilizable por otros documentos

- **WHEN** se inspecciona la ubicación y las dependencias de la capa de plantilla
- **THEN** vive en la capability `documentos` y no importa de la capability
  `presupuestos`
- **AND** puede componer un documento con distinta cabecera de conceptos/totales
  (p. ej. una futura factura) reutilizando `DocumentoLayout` y sus
  sub-componentes

#### Scenario: Las etiquetas fijas del layout se resuelven por idioma en el modelo de vista

- **GIVEN** un documento de presupuesto con `idioma = 'ca'` y otro con `idioma = 'es'`
- **WHEN** se construye el modelo de vista de cada uno
- **THEN** las etiquetas fijas (título, cabeceras de tabla, totales, condicions,
  nombres de mes) vienen ya resueltas en el idioma correspondiente
- **AND** los componentes react-pdf solo pintan esos strings, sin lógica de idioma
  dispersa en los `.tsx`

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

### Requirement: El PDF se persiste vía el puerto de almacén de documentos

La generación de un documento PDF SHALL (DEBE) subir los bytes renderizados a
través del puerto de dominio **`AlmacenDocumentosPort`** (6.1a) mediante
`subir(bytes, clave)` y devolver la **URL** resultante para referenciar el
documento. El renderizador y el almacén son **infraestructura**; el dominio solo
conoce el puerto. La `clave` de almacenamiento DEBE incluir el `tenant_id` para
aislar los objetos por tenant. (Fuente: `documentos` 6.1a `AlmacenDocumentosPort`;
`CLAUDE.md §Arquitectura` hexagonal, `§Multi-tenancy`.)

#### Scenario: El PDF generado se sube por el puerto de almacén

- **GIVEN** un documento renderizado en bytes
- **WHEN** se persiste el documento
- **THEN** se invoca `AlmacenDocumentosPort.subir(bytes, clave)` con una clave que
  incluye el `tenant_id`
- **AND** se devuelve la URL con la que referenciar el PDF subido

### Requirement: Variante SIN IVA del documento (cabecera sin identidad fiscal, totales sin base/IVA)

El modelo de vista y la capa de plantilla de documentos SHALL (DEBE) soportar
**dos variantes** del documento de presupuesto según un **régimen** que llega
como dato del documento (`regimen ∈ {con_iva, sin_iva}`), aplicando las reglas
del Excel del tenant:

- **Variante CON IVA** (transferencia, hoja "PRESSUPOST IVA"): comportamiento de
  6.1b (cabecera con razón social fiscal + NIF; totales con base imponible + IVA
  + total; **pie de datos bancarios presente**).
- **Variante SIN IVA** (efectivo, hoja "PRESSUPOST SENSE IVA"):
  - (a) el bloque de totales **no lleva base imponible ni desglose de IVA**: solo
    el **importe total**;
  - (b) la cabecera **omite la razón social fiscal y el NIF** (queda el nombre
    comercial y el branding del tenant); y
  - (c) el documento **omite el pie de datos bancarios** (IBAN + beneficiario +
    concepto/texto de transferència): el pago es en efectivo, no hay
    transferencia, y la hoja "PRESSUPOST SENSE IVA" del Excel **termina en la
    Fiança** sin bloque bancario.

El resto del documento es **idéntico** en ambas variantes: concepto "Gestió de
l'ús espai de {nombreComercial} per esdeveniment" (nunca "lloguer"), fecha del
evento, duración "(N hores)", nº de personas, extras como sub-conceptos,
**reparto 40/60/fiança** y validesa. La decisión de cada variante se resuelve en
el **modelo de vista puro** (`construirModeloDocumentoPresupuesto`) como flags
(`cabecera.mostrarIdentidadFiscal`, `totales.mostrarDesgloseIva` y un flag de
visibilidad del pie bancario, p. ej. `pieBancario.mostrar`/`mostrarPieBancario`,
`false` en SIN IVA y `true` en CON IVA) y los componentes (`Cabecera`,
`BloqueTotales`, `PieBancario`/`DocumentoLayout`) los consumen; **layout fijo en
código, contenido 100% del tenant/documento**, sin datos de negocio
hardcodeados. La capa NO importa de `presupuestos` (el `regimen` es un dato del
documento; el enum se declara en `documentos`, como los tipos de desglose/reparto
duplicados intencionadamente en 6.1b). Todas las funciones nombradas son **arrow
functions**. (Fuente: Excel hojas "PRESSUPOST IVA" y "PRESSUPOST SENSE IVA";
`design.md` D3; `documentos` 6.1b/6.2
`construirModeloDocumentoPresupuesto`/`Cabecera`/`BloqueTotales`/`PieBancario`;
`CLAUDE.md §Arquitectura` `documentos`↛`presupuestos`, regla arrow-functions.)

#### Scenario: SIN IVA no muestra base imponible ni desglose de IVA

- **GIVEN** un documento de presupuesto con `regimen = sin_iva` cuyo `total`
  congelado es la **base sin IVA** (importe menor; ver capability `presupuestos`)
- **WHEN** se renderiza el bloque de totales
- **THEN** el PDF muestra **solo el Total** (= base, sin el 21%), sin filas
  "Base imposable" ni "IVA (%)"
- **AND** el reparto 40/60/fiança (calculado sobre el total SIN IVA) y la
  validesa se muestran igual que en CON IVA

#### Scenario: SIN IVA omite razón social fiscal y NIF pero mantiene dirección/contacto

- **GIVEN** un documento con `regimen = sin_iva` y una config con
  `razonSocialFiscal = "Canoliart, SL"`, `nif = "B10874287"`,
  `nombreComercial = "Masia l'Encís"` y `direccionFiscal`/`web`/`email` presentes
- **WHEN** se renderiza la cabecera
- **THEN** el PDF **no** contiene "Canoliart, SL" ni el NIF
- **AND** sí contiene el nombre comercial "Masia l'Encís", el branding y la
  dirección fiscal / web / email del tenant

#### Scenario: SIN IVA omite el pie de datos bancarios

- **GIVEN** un documento con `regimen = sin_iva` y una config con
  `iban = "ES30 0182 1683 4002 0172 9599"`,
  `beneficiarioTransferencia = "Canoliart, SL"` y `conceptoTransferencia` presentes
- **WHEN** se construye el modelo de vista y se renderiza el documento
- **THEN** el flag de visibilidad del pie bancario del modelo de vista es `false`
- **AND** el PDF **no** contiene el IBAN, ni el beneficiario de transferencia, ni
  el concepto/texto de transferència ("El pagament mitjançant transferència…")
- **AND** el documento termina en la Fiança, coherente con la hoja "PRESSUPOST
  SENSE IVA" del Excel

#### Scenario: CON IVA conserva cabecera, totales y pie bancario

- **GIVEN** un documento con `regimen = con_iva`
- **WHEN** se renderiza el documento
- **THEN** la cabecera muestra razón social fiscal + NIF y los totales muestran
  base imponible + IVA + total (sin regresión respecto a 6.1b/6.2)
- **AND** el flag de visibilidad del pie bancario es `true` y el PDF **sí**
  contiene el IBAN, el beneficiario y el concepto de transferencia

#### Scenario: El concepto y el resto del cuerpo son idénticos en ambas variantes

- **GIVEN** dos documentos del mismo presupuesto, uno CON IVA y otro SIN IVA
- **WHEN** se renderizan
- **THEN** ambos muestran el mismo concepto ("Gestió de l'ús espai de Masia
  l'Encís per esdeveniment", sin "lloguer"), la misma duración "(N hores)", los
  mismos extras, el mismo reparto 40/60/fiança y validesa
- **AND** difieren únicamente en cabecera (identidad fiscal), totales (desglose
  de IVA) y presencia del pie bancario

#### Scenario: La variante no acopla documentos a presupuestos

- **WHEN** se inspeccionan las dependencias del modelo de vista y de los
  componentes de la variante
- **THEN** viven en la capability `documentos` y no importan de `presupuestos`
- **AND** el enum de régimen usado por el render se declara en `documentos`

### Requirement: Modelo de vista y renderizado de factura (rebanada 6.3)

El sistema SHALL (DEBE) proveer en `documentos/presentation/` una función de
construcción del modelo de vista de factura, `construirModeloDocumentoFactura(params)`,
y una función de renderizado, `renderizarDocumentoFacturaABytes(modelo)`, que juntas
generan el PDF de una FACTURA. El modelo de vista (`ModeloDocumentoFactura`) SHALL
(DEBE) incluir:

- `tipo`: `'senal' | 'liquidacion' | 'fianza'`
- `numeroFactura`: número de factura o `null` (en borradores de liquidación/fianza)
- `fechaEmision`: fecha de emisión
- `concepto`: texto generado según el tipo de factura y el número de presupuesto
- `extras`: sub-conceptos de extras (solo en liquidación)
- `totales`: `{ total, baseImponible | null, ivaPorcentaje | null, ivaImporte | null,
  mostrarDesgloseIva: boolean }`
- `cabecera`: `{ mostrarIdentidadFiscal: boolean, … datos del tenant }`
- `pieBancario`: `{ mostrar: boolean, … datos bancarios }`
- `cliente`: datos fiscales del receptor

La función `construirModeloDocumentoFactura` es lógica **pura** (sin side-effects):
recibe como input la `ConfiguracionDocumentoTenant`, los datos de la factura, el
cliente y el presupuesto, y devuelve el modelo. Todas las funciones nombradas son
**arrow functions**. (Fuente: épico #6 rebanada 6.3 `documentos-facturas-pdf`;
`CLAUDE.md` regla arrow-functions; reutiliza la capa de plantilla introducida en 6.1b.)

#### Scenario: El modelo de vista de señal CON IVA activa todos los bloques

- **GIVEN** una factura de señal con `ivaPorcentaje = 21.00` y datos completos
- **WHEN** se construye `ModeloDocumentoFactura`
- **THEN** `cabecera.mostrarIdentidadFiscal = true`, `totales.mostrarDesgloseIva = true`,
  `pieBancario.mostrar = true`
- **AND** el concepto es "40% de l'import total anticipat del pressupost núm. {n}"

#### Scenario: El modelo de vista de señal SIN IVA desactiva identidad fiscal, IVA y pie

- **GIVEN** una factura de señal con `ivaPorcentaje = 0.00`
- **WHEN** se construye `ModeloDocumentoFactura`
- **THEN** `cabecera.mostrarIdentidadFiscal = false`, `totales.mostrarDesgloseIva = false`,
  `pieBancario.mostrar = false`
- **AND** el concepto es "40% de l'import total anticipat del pressupost núm. {n}"

#### Scenario: El modelo de vista de fianza usa concepto sin referencia a presupuesto

- **GIVEN** una factura de fianza para un tenant con `nombreComercial = "Masia l'Encís"`
- **WHEN** se construye `ModeloDocumentoFactura`
- **THEN** el concepto es `"Fiança de garantia — Masia l'Encís"`
- **AND** no aparece ningún número de presupuesto en el concepto

### Requirement: Componente BloqueConceptoFactura en la capa de plantilla (rebanada 6.3)

El sistema SHALL (DEBE) proveer en `documentos/presentation/componentes/` un componente
React-PDF `BloqueConceptoFactura` que renderice el concepto de la factura sin
información de horas ni desglose de invitados (a diferencia del presupuesto). El
componente DEBE aceptar como props el concepto principal (string) y, opcionalmente,
una lista de extras (`{ descripcion, subtotal }`). El componente es un `.tsx` reutilizado
por la factura de liquidación (con extras) y la de señal/fianza (sin extras). Todas las
funciones nombradas son **arrow functions**. (Fuente: épico #6 rebanada 6.3; nota del Excel
"sin horas" para facturas; `CLAUDE.md` regla `components/ solo .tsx`.)

#### Scenario: BloqueConceptoFactura sin extras renderiza solo el concepto

- **GIVEN** un `BloqueConceptoFactura` con `concepto = "40% de l'import…"` y sin extras
- **WHEN** se renderiza en el PDF
- **THEN** el PDF contiene el concepto y no muestra sección de extras ni de horas

#### Scenario: BloqueConceptoFactura con extras renderiza los sub-conceptos

- **GIVEN** un `BloqueConceptoFactura` con `concepto` y `extras = [{ descripcion, subtotal }]`
- **WHEN** se renderiza en el PDF
- **THEN** el PDF contiene el concepto principal y cada extra como sub-concepto con su subtotal

### Requirement: Configuración de "Condicions particulars" por tenant

El VO `ConfiguracionDocumentoTenant` SHALL (DEBE) incluir un bloque
**`condiciones`** con la forma
`{ titulo: { ca: string; es: string }; secciones: Array<{ titulo: { ca; es };
cuerpo: { ca; es } }> }` (bilingüe), que representa el documento legal de
"Condicions particulars" del tenant. El contenido DEBE ser **100% del tenant**
(título, títulos y cuerpos de cada sección, en ca y es); la plantilla NO PUEDE
contener texto de negocio hardcodeado. Este bloque DEBE **persistirse en
`PlantillaDocumentoTenant`** como una columna JSON con la estructura bilingüe
(migración Prisma no destructiva; backfill del contenido catalán existente en `ca`)
y mapearse al VO en el adapter Prisma de configuración. El consumidor (p. ej. el
presupuesto) elige el idioma del texto según el `idioma` del documento. La fila es
**1-1 con `Tenant` bajo RLS** (6.1a): la columna hereda ese aislamiento por tenant.
(Fuente: `epico-6-documentos-pdf-roadmap` §6.4a; `documentos` 6.1a
`ConfiguracionDocumentoTenant`/`PlantillaDocumentoTenant`; `CLAUDE.md
§Multi-tenancy`; change `pdf-presupuesto-horario-idioma` — condicions bilingües.)

#### Scenario: El bloque condiciones bilingüe se persiste y se lee por tenant

- **GIVEN** un tenant con una `PlantillaDocumentoTenant` cuya columna JSON
  `condiciones` tiene un título `{ ca, es }` y una lista de secciones con
  `titulo`/`cuerpo` bilingües
- **WHEN** se obtiene la configuración del tenant vía el adapter Prisma bajo su
  RLS
- **THEN** el VO `ConfiguracionDocumentoTenant` devuelto incluye el bloque
  `condiciones` con el título y las secciones bilingües persistidas

#### Scenario: El bloque condiciones no hardcodea contenido de negocio

- **GIVEN** dos tenants con configuraciones de `condiciones` distintas (distinto
  título y secciones)
- **WHEN** se genera el documento de condiciones para cada tenant
- **THEN** cada PDF refleja el contenido del tenant correspondiente
- **AND** no aparece ningún texto de sección fijo compartido entre ambos

### Requirement: Seed piloto del documento de "Condicions particulars"

El factory de seed `construirConfiguracionDocumentoPiloto` SHALL (DEBE) poblar el
bloque `condiciones` del tenant piloto (Masia l'Encís) con el **texto real bilingüe**:
en **catalán** (`ca`) el texto parseado de la hoja "Condicions particulars" del
Excel del tenant, y en **castellano** (`es`) su traducción — título
**"Condicions Particulars" / "Condiciones Particulares"** y **14 secciones** en
este orden — Reserva i pagament, Fiança, Política de cancel·lació, Responsabilitat i
dades personals, Visites, Neteja, Gestió de residus, Horaris, Excés d'horari, Normes
de convivència i ús responsable, Capacitat, Piscina, Música i respecte veïnal,
Parking. El factory DEBE seguir siendo **determinista y puro** (sin efectos),
verificable por unit test sin Postgres. (Fuente: `epico-6-documentos-pdf-roadmap`
§6.4a; Excel `Plantilla_factures i pressupostos.xlsx` hoja "Condicions
particulars"; change `pdf-presupuesto-horario-idioma` — condicions bilingües.)

#### Scenario: El seed piloto expone las 14 secciones bilingües en orden

- **WHEN** se invoca `construirConfiguracionDocumentoPiloto(tenantId)`
- **THEN** `condiciones.titulo` es `{ ca: 'Condicions Particulars', es:
  'Condiciones Particulares' }`
- **AND** `condiciones.secciones` tiene exactamente 14 elementos, cada uno con
  `titulo` y `cuerpo` bilingües (`ca` y `es` no vacíos), en el orden especificado

### Requirement: Plantilla react-pdf del documento de "Condicions particulars"

El sistema SHALL (DEBE) proveer una **plantilla react-pdf** del documento de
Condicions particulars en la capa de presentación de `documentos`, con un
componente raíz `DocumentoCondicionesLayout` que componga: la `Cabecera`
(branding del tenant, reutilizada de 6.1b), el **título** del documento, la
**lista de secciones** (título + cuerpo de cada una) y un **bloque de firma EN
BLANCO** con las etiquetas `NOM I COGNOMS CLIENT`, `SIGNATURA CLIENT`, `DNI` y
`DATA ESDEVENIMENT` (sin datos del cliente: el documento es idéntico por tenant).
El **layout es fijo en código**; el **contenido es 100% del bloque
`condiciones`** del tenant. Todas las funciones nombradas se escriben como
**arrow functions**. **Guardarraíl duro**: los ficheros de
`presentation/componentes/` son SOLO `.tsx`; el modelo de vista, el render y los
helpers viven fuera de `componentes/`. (Fuente: `epico-6-documentos-pdf-roadmap`
§6.4a; `documentos` 6.1b capa de plantilla + `Cabecera` + `estilos.ts`;
`CLAUDE.md §Stack` arrow-functions; guardarraíl `components/` solo `.tsx`.)

#### Scenario: El render produce un PDF con las secciones y el bloque de firma

- **GIVEN** una `ConfiguracionDocumentoTenant` con un bloque `condiciones` de N
  secciones
- **WHEN** se invoca `renderizarDocumentoCondicionesABytes(config)`
- **THEN** devuelve un `Uint8Array` no vacío cuya cabecera empieza por `%PDF`
- **AND** el documento incluye el título, las N secciones (título + cuerpo) y el
  bloque de firma con las etiquetas NOM I COGNOMS CLIENT / SIGNATURA CLIENT / DNI
  / DATA ESDEVENIMENT

#### Scenario: El bloque de firma va en blanco (idéntico por tenant)

- **GIVEN** dos reservas distintas del mismo tenant
- **WHEN** se genera el documento de condiciones para ese tenant
- **THEN** el documento es idéntico (no contiene datos de ninguna reserva ni
  cliente); el bloque de firma queda en blanco

### Requirement: Generación y almacenamiento del PDF de "Condicions particulars"

El sistema SHALL (DEBE) proveer un puerto de dominio
**`GenerarPdfCondicionesPort`** con firma
`(params: { tenantId: string }) => Promise<string | null>`, cuyo **adaptador
real** (infraestructura de `documentos`): (1) obtiene la configuración del tenant
vía `ObtenerConfiguracionDocumentoService`; si es `null` **degrada a `null`** sin
renderizar ni subir; (2) renderiza el PDF con la plantilla de condiciones; (3)
sube los bytes por `AlmacenDocumentosPort.subir(bytes, clave)` con la **clave
fija** `condiciones/{tenantId}.pdf` (documento idéntico por tenant → se
reutiliza/sobrescribe); (4) devuelve la URL. El puerto se enlaza por el token
**`GENERAR_PDF_CONDICIONES_PORT`** en `DocumentosModule` (que lo exporta), y se
provee un **adaptador fake** para tests. El render y el almacén son
**infraestructura**; el puerto vive en dominio. (Fuente:
`epico-6-documentos-pdf-roadmap` §6.4a; espejo de `PdfPresupuestoRealAdapter`
6.1b; `documentos` 6.1a `AlmacenDocumentosPort`; `CLAUDE.md §Arquitectura`
hexagonal, `§Multi-tenancy`.)

#### Scenario: Genera, sube con clave fija por tenant y devuelve la URL

- **GIVEN** un tenant con configuración de documento (incluye `condiciones`)
- **WHEN** se invoca el adaptador real con `{ tenantId }`
- **THEN** se renderiza el PDF, se invoca `AlmacenDocumentosPort.subir(bytes,
  'condiciones/{tenantId}.pdf')`
- **AND** se devuelve la URL resultante

#### Scenario: Sin configuración del tenant degrada a null

- **GIVEN** un tenant sin `ConfiguracionDocumentoTenant`
- **WHEN** se invoca el adaptador real con `{ tenantId }`
- **THEN** devuelve `null` sin renderizar ni subir nada

#### Scenario: La clave aísla los objetos por tenant

- **GIVEN** dos tenants distintos
- **WHEN** se genera el documento de condiciones para cada uno
- **THEN** cada uno se sube a su propia clave `condiciones/{tenantId}.pdf`, sin
  colisión entre tenants

### Requirement: Reutilización del PDF de condicions particulars como adjunto de E3

El sistema SHALL (DEBE), al enviar la factura de señal (E3), obtener el PDF de las
**condicions particulars** del tenant reutilizando `GenerarPdfCondicionesPort.generar({
tenantId })` (6.4a), que devuelve la URL del PDF (clave fija `condiciones/{tenantId}.pdf`)
o **`null`** cuando degrada (tenant sin configuración o sin secciones). Si devuelve una
URL, el sistema DEBE adjuntarla a E3 junto a la factura de señal. No se genera un documento
por reserva: el documento es **idéntico por tenant** (6.4a). (Fuente: `US-023 §Happy Path`;
6.4a `GenerarPdfCondicionesPort`; `design.md §D-adjunto-condiciones`.)

#### Scenario: Las condicions particulars se adjuntan a E3 cuando están configuradas

- **GIVEN** un tenant con las condicions particulars configuradas (6.4a) y una factura de
  señal enviable
- **WHEN** el Gestor envía la factura de señal (E3)
- **THEN** `GenerarPdfCondicionesPort.generar` devuelve la URL del PDF de condiciones
- **AND** E3 se envía con dos adjuntos: la factura de señal y las condicions particulars

### Requirement: El fallo del adjunto de condicions particulars no tumba el envío confirmado de E3

El sistema SHALL (DEBE), en el envío CONFIRMADO/rollback de E3, tratar las **condicions
particulars** como **adjunto imprescindible**: DEBE obtener el PDF vía
`GenerarPdfCondicionesPort.generar`. Si devuelve `null` (tenant sin configuración/sin secciones),
el sistema NO DEBE enviar E3, NO DEBE persistir el `DOCUMENTO` de condiciones y DEBE **abortar** la
operación con un **error de negocio** (`CONDICIONES_NO_CONFIGURADAS`, recuperable), dejando la
RESERVA sin `cond_part_enviadas_fecha` y la factura de señal en `borrador` (rollback total); el
Gestor recibe la alerta "Configura las condiciones particulares del espacio para poder enviar E3".
Si la generación **lanza** un error transitorio (p. ej. fallo de render/subida), el sistema DEBE
tratarlo como error **recuperable** (reintentable) con rollback total, sin consolidar la emisión.
En el camino feliz, E3 SIEMPRE se envía con **ambos** adjuntos (factura de señal + condiciones) y la
respuesta expone `condPartAdjuntada = true`. (Fuente: `US-023 §Condiciones particulares del tenant
no configuradas`, `§Reglas de negocio`; `design.md §D-condiciones-bloqueante`; reemplaza el criterio
tolerante de 6.4b `§D-adjunto-condiciones`.)

> **US-023 endurece el criterio de 6.4b (decisión cerrada — `design.md
> §D-condiciones-bloqueante`).** 6.4b trataba el adjunto de condiciones como **tolerante/opcional**
> (si degradaba a `null`, E3 se enviaba igual con `condPartAdjuntada = false`). US-023 revierte esa
> concesión: las condiciones son el **contrato** del evento y pasan a ser **requisito duro** del
> envío E3.

#### Scenario: Sin condiciones configuradas, E3 no se envía y se alerta al Gestor

- **GIVEN** un tenant SIN condicions particulars configuradas y una factura de señal enviable con su
  PDF
- **WHEN** el Gestor envía la factura de señal (E3)
- **THEN** `GenerarPdfCondicionesPort.generar` devuelve `null` y el sistema aborta con
  `CONDICIONES_NO_CONFIGURADAS`
- **AND** no se envía E3, no se persiste el `DOCUMENTO` de condiciones, la factura permanece en
  `borrador` y `RESERVA.cond_part_enviadas_fecha` permanece `NULL`
- **AND** el Gestor recibe la alerta "Configura las condiciones particulares del espacio para poder
  enviar E3"

#### Scenario: Un fallo de render de condiciones aborta la emisión de forma recuperable

- **GIVEN** un tenant con condiciones configuradas cuya generación de PDF **lanza** un error
  transitorio
- **WHEN** el Gestor envía la factura de señal (E3)
- **THEN** el sistema aborta con un error recuperable y hace rollback total (factura en `borrador`,
  sin COMUNICACION E3 `enviado`, sin `DOCUMENTO` de condiciones)
- **AND** el Gestor puede reintentar el envío

#### Scenario: Con condiciones configuradas, E3 se envía con ambos adjuntos

- **GIVEN** un tenant con condiciones configuradas y una factura de señal enviable con su PDF
- **WHEN** el Gestor envía la factura de señal (E3) y el envío se confirma
- **THEN** E3 se envía con dos adjuntos (factura de señal + condiciones particulares)
- **AND** la respuesta expone `condPartAdjuntada = true` y se persiste el `DOCUMENTO` de condiciones

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
- **Título** grande del documento con jerarquía de color por **tipo de documento**:
  el título del **PRESUPUESTO** ("PRESSUPOST"/"PRESUPUESTO") se pinta en
  **amarillo** (color de acento `COLOR_ACENTO = #ffd978`, constante de
  presentación), mientras que la **FACTURA** conserva su título en **turquesa**
  (`branding.color_primario`, `#5edada` en el piloto). El color del título es una
  decisión del **layout concreto** (`DocumentoLayout` pasa el acento amarillo;
  `DocumentoFacturaLayout` pasa el `colorPrimario`), sin alterar el contrato del
  componente `BloqueTitulo`.
- **Bloque "Dades client"** a la izquierda y una **mini-tabla con borde**
  `Pressupost | Data` a la derecha.
- **Tabla de concepto** con **barra turquesa** de cabecera y texto blanco
  (`CONCEPTE | PREU`), concepto en negrita + líneas indentadas (data / horari /
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
extra** (se extrapola el lenguaje visual). El cambio de color de título es de
**presentación**: el modelo de vista cambia mínima o nulamente y los tests de
**contenido del modelo** quedan verdes sin cambios. Todas las funciones nombradas
se escriben como **arrow functions** y los ficheros de `presentation/componentes/`
son SOLO `.tsx`. (Fuente: `epico-6-documentos-pdf-roadmap` §6.5; documento de
referencia `P2026023 Laura Mas.pdf`; `documentos` 6.1b capa de plantilla;
`estilos.ts §COLOR_ACENTO`; `CLAUDE.md §Stack` arrow-functions y guardarraíl
`componentes/` solo `.tsx`; change `pdf-presupuesto-horario-idioma` — título del
presupuesto en amarillo.)

#### Scenario: El presupuesto CON IVA replica la identidad visual de la referencia con título amarillo

- **GIVEN** el tenant piloto con `branding.color_primario = "#5edada"` y su logo
  subido
- **WHEN** se renderiza el presupuesto CON IVA
- **THEN** el PDF muestra el logo arriba-izquierda, la identidad fiscal
  arriba-derecha, el título "PRESSUPOST" en **amarillo** (`COLOR_ACENTO #ffd978`),
  la tabla de concepto con barra turquesa y cabecera `CONCEPTE | PREU`, la franja
  `Validesa | Base imp. | % Iva | Total`, la mini-tabla de condicions
  40/60/fiança con acento amarillo, y el pie con el IBAN centrado

#### Scenario: La factura conserva el título turquesa

- **GIVEN** el tenant piloto con `branding.color_primario = "#5edada"`
- **WHEN** se renderiza una factura (señal/liquidación/fianza)
- **THEN** el título de la factura se pinta en **turquesa** (`branding.color_primario`),
  NO en el amarillo del presupuesto

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

### Requirement: Persistencia idempotente del DOCUMENTO de condiciones particulares al enviar E3

El sistema SHALL (DEBE), al enviar E3 (envío de la factura de señal), **persistir una fila
`DOCUMENTO`** con `tipo = 'condiciones_particulares'`, `reserva_id`, `tenant_id`, `url` (la URL del
PDF de condiciones ya generado por `GenerarPdfCondicionesPort`, clave `condiciones/{tenantId}.pdf`)
y `mime_type = 'application/pdf'`. La persistencia DEBE ocurrir **dentro de la misma transacción
atómica** del envío E3 (si E3 falla, la fila `DOCUMENTO` **revierte** junto al resto). La operación
DEBE ser **idempotente por reserva**: solo puede existir **un** `DOCUMENTO` de
`tipo = 'condiciones_particulares'` por `reserva_id`; si ya existe, el sistema DEBE **reutilizarlo**
(no crea una segunda fila ni registra un segundo AUDIT_LOG). Cuando se crea la fila por primera vez,
el sistema DEBE registrar `AUDIT_LOG` con `accion = 'crear'` para ese `DOCUMENTO`. El acceso DEBE
respetar RLS multi-tenant (la búsqueda de idempotencia filtra por `tenant_id`; nunca reutiliza un
documento de otro tenant). (Fuente: `US-023 §Happy Path`, `§Reglas de Validación`; `design.md
§D-persistencia-documento`; `er-diagram.md §DOCUMENTO`.)

#### Scenario: El primer envío de E3 crea el DOCUMENTO de condiciones y lo audita

- **GIVEN** una RESERVA sin `DOCUMENTO` de `tipo = 'condiciones_particulares'` y un tenant con las
  condiciones configuradas (el PDF de condiciones se genera correctamente)
- **WHEN** el Gestor envía la factura de señal (E3) y el envío se confirma
- **THEN** se persiste una fila `DOCUMENTO` con `tipo = 'condiciones_particulares'`, `reserva_id`,
  `tenant_id`, `url` del PDF y `mime_type = 'application/pdf'`
- **AND** la fila se consolida en la misma transacción que la emisión de la factura y la
  actualización de `RESERVA.cond_part_enviadas_fecha`
- **AND** `AUDIT_LOG` registra `accion = 'crear'` para ese `DOCUMENTO`

#### Scenario: Un DOCUMENTO de condiciones ya existente se reutiliza sin duplicar

- **GIVEN** una RESERVA que ya tiene un `DOCUMENTO` de `tipo = 'condiciones_particulares'`
- **WHEN** el flujo de envío/reenvío de E3 vuelve a resolver el documento de condiciones
- **THEN** el sistema reutiliza la fila existente y **no** crea una segunda fila `DOCUMENTO`
- **AND** no registra un segundo `AUDIT_LOG accion = 'crear'` para el documento

#### Scenario: El rollback del envío de E3 no deja DOCUMENTO huérfano

- **GIVEN** una RESERVA sin `DOCUMENTO` de condiciones y un envío de E3 en curso
- **WHEN** el envío de E3 falla dentro de la transacción
- **THEN** no queda persistida ninguna fila `DOCUMENTO` de `tipo = 'condiciones_particulares'`
  (la creación revierte junto al resto de la transacción)

### Requirement: Fecha y horario legibles del evento en el bloque de concepto

El modelo de vista del presupuesto (`construirModeloDocumentoPresupuesto`) SHALL
(DEBE) resolver, en el **builder puro** (donde recaen las aserciones de contenido),
la representación legible de la **fecha** y el **horario** del evento que el bloque
de concepto pinta como líneas independientes, a partir de nuevos datos de entrada
`DatosDocumentoPresupuesto`:

- **`horario: string | null`** — hora de inicio del evento en formato "HH:MM"
  (`Reserva.horario`, nullable).
- **`duracionHoras: number`** — duración del evento (enum de negocio 4/8/12), ya
  existente.

El builder DEBE producir:

- **Fecha del evento** como **"D de <mes> de AAAA"** (CON año), con el nombre del
  mes en el **idioma del cliente** (ver requisito de idioma). NO se usa `dd/mm/aaaa`.
- **Horario** como **"De HH:MM a HH:MM (N <hores|horas>)"** cuando `horario` no es
  `null`, donde la **hora de fin se calcula en memoria** como
  `horaFin = (inicioEnMinutos + duracionHoras*60) mod 1440`, reformateada a "HH:MM"
  (siempre con minutos: p. ej. "18:00", nunca "18h"). La hora de fin **NO se
  persiste** en ningún sitio.
- **Fallback**: cuando `horario` es `null`, el horario se reduce a
  **"(N <hores|horas>)"** sin rango, preservando el comportamiento actual, sin
  romper el render.

El cálculo del `mod 1440` DEBE ser correcto cruzando medianoche (p. ej. inicio
22:00 + 4h → fin 02:00). Los componentes react-pdf (`TablaConcepto`) solo pintan
los strings del modelo. Todas las funciones nombradas son **arrow functions** y el
builder es **puro** (sin `Intl` dependiente del locale del entorno; el mapa de
meses por idioma es determinista). (Fuente: requisito del usuario; `documentos` 6.1b
`construirModeloDocumentoPresupuesto`/`TablaConcepto`; `Reserva.horario`/
`Reserva.duracionHoras`; `CLAUDE.md §Stack` arrow-functions.)

#### Scenario: Fecha del evento con año en el idioma del cliente (ca)

- **GIVEN** un presupuesto con `fechaEvento = 2026-09-20` e `idioma = 'ca'`
- **WHEN** se construye el modelo de vista
- **THEN** la línea de fecha del concepto es **"20 de setembre de 2026"** (con año,
  mes en catalán), no `20/09/2026`

#### Scenario: Fecha del evento con año en el idioma del cliente (es)

- **GIVEN** un presupuesto con `fechaEvento = 2026-09-20` e `idioma = 'es'`
- **WHEN** se construye el modelo de vista
- **THEN** la línea de fecha del concepto es **"20 de septiembre de 2026"** (con
  año, mes en castellano)

#### Scenario: Horario con rango de inicio a fin calculado en memoria

- **GIVEN** un presupuesto con `horario = '12:00'`, `duracionHoras = 8` e
  `idioma = 'ca'`
- **WHEN** se construye el modelo de vista
- **THEN** la línea de horario es **"De 12:00 a 18:00 (8 hores)"** (fin = 12:00 + 8h)
- **AND** la hora de fin (18:00) no se persiste en ninguna columna

#### Scenario: El horario cruza medianoche con mod 1440

- **GIVEN** un presupuesto con `horario = '22:00'` y `duracionHoras = 4`
- **WHEN** se construye el modelo de vista
- **THEN** la hora de fin es **"02:00"** (`(22*60 + 240) mod 1440`) y la línea es
  "De 22:00 a 02:00 (4 hores)"

#### Scenario: Fallback sin horario muestra solo la duración

- **GIVEN** un presupuesto con `horario = null` y `duracionHoras = 8` e
  `idioma = 'ca'`
- **WHEN** se construye el modelo de vista
- **THEN** la línea de horario es **"(8 hores)"** sin rango horario
- **AND** el modelo se construye sin error y el PDF se renderiza correctamente

### Requirement: Idioma del documento de presupuesto según el idioma del cliente

El modelo de vista del presupuesto SHALL (DEBE) parametrizarse por un nuevo dato de
entrada **`idioma: 'es' | 'ca'`** en `DatosDocumentoPresupuesto` (que el adaptador
proyecta desde `Reserva.idioma`, default `'es'`), y resolver **TODAS las etiquetas
fijas** del layout del presupuesto en ese idioma, dentro del **builder puro** (o
helpers puros de i18n de `documentos/presentation`), **no** dispersas por los
`.tsx`. El conjunto de etiquetas traducidas incluye, al menos:

- Título del documento: **PRESSUPOST / PRESUPUESTO**
- Mini-tabla: **Pressupost / Presupuesto**, **Data / Fecha**
- Bloque cliente: **Dades client / Datos del cliente**
- Tabla de concepto: **CONCEPTE / CONCEPTO**, **PREU / PRECIO**,
  **persones / personas**, **hores / horas**
- Totales: **Validesa / Validez**, **Base imposable / Base imponible**, **% Iva**,
  **Total**
- Condicions: **Condicions / Condiciones**, **Pagament anticipat / Pago anticipado**,
  **Fiança / Fianza**
- Los **nombres de mes** (para la línea de fecha del concepto).

El **layout es fijo en código**; la elección del idioma se resuelve en el modelo de
vista, y los componentes react-pdf solo pintan strings ya resueltos. El default es
**`'es'`**. Todas las funciones nombradas son **arrow functions**. (Fuente:
requisito del usuario; paridad con las plantillas de email traducidas en código;
`Reserva.idioma`; `documentos` 6.1b modelo de vista + capa de plantilla.)

#### Scenario: El presupuesto en catalán usa las etiquetas fijas catalanas

- **GIVEN** un presupuesto con `idioma = 'ca'`
- **WHEN** se renderiza el documento
- **THEN** el PDF muestra "PRESSUPOST", "Pressupost", "Data", "Dades client",
  "CONCEPTE", "PREU", "persones", "Validesa", "Base imposable", "Condicions",
  "Pagament anticipat", "Fiança"

#### Scenario: El presupuesto en castellano usa las etiquetas fijas castellanas

- **GIVEN** un presupuesto con `idioma = 'es'`
- **WHEN** se renderiza el documento
- **THEN** el PDF muestra "PRESUPUESTO", "Presupuesto", "Fecha", "Datos del
  cliente", "CONCEPTO", "PRECIO", "personas", "Validez", "Base imponible",
  "Condiciones", "Pago anticipado", "Fianza"

#### Scenario: Idioma ausente/desconocido cae al default castellano

- **GIVEN** un presupuesto cuyo `idioma` no es reconocible (o ausente en datos de
  entrada)
- **WHEN** se construye el modelo de vista
- **THEN** el documento se resuelve en **castellano** (`'es'`) sin romper

### Requirement: Textos libres del tenant bilingües (es/ca) en la configuración de documento

El VO `ConfiguracionDocumentoTenant` SHALL (DEBE) modelar los **textos libres del
tenant** como **bilingües** `{ ca: string; es: string }` por texto:
`plantillaConceptoFiscal`, `validesaTexto`, `pieLegal` (bloque `textos`) y el bloque
`condiciones` (su `titulo` y el `titulo`/`cuerpo` de cada sección). El modelo de
vista del presupuesto DEBE **elegir el texto según `datos.idioma`** y seguir
resolviendo el placeholder `{nombreComercial}` (regla dura: expresa "espai", NUNCA
"lloguer"). Estos textos se gestionan **por seed/migración** (sin UI de ajustes),
igual que las plantillas de email traducidas en código.

La persistencia DEBE realizarse mediante **migración Prisma no destructiva** sobre
`PlantillaDocumentoTenant`: desdoblar `plantilla_concepto_fiscal`, `validesa_texto`
y `pie_legal` a columnas **`_ca`/`_es`**, y migrar la columna JSON `condiciones` a
la **estructura bilingüe** (título y secciones con `ca`/`es`). El **backfill** DEBE
fijar el valor **`_ca`** con el contenido catalán **actual** (ya existente) y el
valor **`_es`** con la traducción provista por el seed. La fila sigue **1-1 con
`Tenant` bajo RLS**: las columnas nuevas heredan ese aislamiento (NO se recrea la
policy). El adaptador Prisma de configuración mapea las columnas bilingües al VO.
(Fuente: requisito del usuario; `documentos` 6.1a `ConfiguracionDocumentoTenant`/
`PlantillaDocumentoTenant`; `CLAUDE.md §Multi-tenancy`.)

#### Scenario: El VO expone los textos libres como bilingües

- **GIVEN** una `PlantillaDocumentoTenant` con `plantilla_concepto_fiscal_ca`,
  `plantilla_concepto_fiscal_es`, `validesa_texto_ca/_es`, `pie_legal_ca/_es` y un
  `condiciones` bilingüe persistidos
- **WHEN** se obtiene la configuración vía el adapter Prisma bajo su RLS
- **THEN** el VO `ConfiguracionDocumentoTenant` devuelve `textos.plantillaConceptoFiscal`,
  `textos.validesaTexto`, `textos.pieLegal` y `condiciones` como objetos `{ ca, es }`

#### Scenario: El presupuesto elige el texto libre según el idioma del cliente (ca)

- **GIVEN** una config con `plantillaConceptoFiscal = { ca: 'Gestió ús espai de
  {nombreComercial} per esdeveniment', es: 'Gestión de uso del espacio de
  {nombreComercial} para evento' }` y un presupuesto `idioma = 'ca'`
- **WHEN** se construye el modelo de vista
- **THEN** el concepto es "Gestió ús espai de Masia l'Encís per esdeveniment"
- **AND** el documento no contiene la palabra "lloguer"

#### Scenario: El presupuesto elige el texto libre según el idioma del cliente (es)

- **GIVEN** la misma config y un presupuesto `idioma = 'es'`
- **WHEN** se construye el modelo de vista
- **THEN** el concepto es "Gestión de uso del espacio de Masia l'Encís para evento"

#### Scenario: La migración es no destructiva y hace backfill del catalán

- **WHEN** se aplican las migraciones Prisma
- **THEN** `plantilla_documento_tenant` tiene las columnas bilingües
  (`plantilla_concepto_fiscal_ca/_es`, `validesa_texto_ca/_es`, `pie_legal_ca/_es`)
  y `condiciones` en estructura bilingüe
- **AND** el valor `_ca` de cada texto conserva el contenido catalán preexistente
  (backfill), sin perder datos
- **AND** no se recrea la policy RLS de `plantilla_documento_tenant`


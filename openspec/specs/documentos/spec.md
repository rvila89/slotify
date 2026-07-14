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
entorno** (proveedor y credenciales/bucket). La configuración por env DEBE permitir
que los **tests no dependan de credenciales cloud** (mediante un doble/adaptador de
test o local seleccionable por env). La decisión de si esta rebanada implementa ya
el adaptador cloud real o un adaptador dev/local, dejando el cloud para cuando haya
credenciales, se fija en `design.md` (cuestión abierta B) y se aprueba en el gate
SDD. (Fuente: `epico-6-documentos-pdf-roadmap` §Almacenamiento; `CLAUDE.md §Stack`;
`design.md` cuestión abierta B.)

#### Scenario: El adaptador se selecciona por variables de entorno

- **GIVEN** las variables de entorno que definen proveedor/credenciales del almacén
- **WHEN** arranca la aplicación
- **THEN** se inyecta la implementación de `AlmacenDocumentosPort` acorde a esa
  configuración

#### Scenario: Los tests no requieren credenciales cloud

- **WHEN** se ejecuta la suite de tests (`pnpm test`)
- **THEN** los tests del puerto/adaptador de almacén se ejecutan con un doble o un
  adaptador local, sin necesitar credenciales de S3/Supabase

### Requirement: Seed idempotente de la configuración de documento del tenant piloto

El seed (`apps/api/prisma/seed.ts`) SHALL (DEBE) provisionar la
`PlantillaDocumentoTenant` del tenant piloto **Masia l'Encís** con los datos reales:
`razon_social_fiscal = "Canoliart, SL"`, `nombre_comercial = "Masia l'Encís"`,
`nif = "B10874287"`, `direccion_fiscal = "08731 - Sant Martí Sarroca / Barcelona"`,
`web = "www.masialencis.com"`, `email = "info@masialencis.com"`,
`iban = "ES30 0182 1683 4002 0172 9599"`,
`beneficiario_transferencia = "Canoliart, SL"`,
`concepto_transferencia = "Masia l'Encís"`, y los textos de
`plantilla_concepto_fiscal`, `validesa_texto` y `pie_legal`. El
`plantilla_concepto_fiscal` DEBE expresar "Gestió de l'ús espai de
{nombreComercial} per esdeveniment" y **nunca** contener la palabra "lloguer". El
seed DEBE ser **idempotente** (`deleteMany` + `create`/`createMany`), de modo que
re-ejecutarlo no duplique filas ni cambie el resultado final. (Fuente:
`presupuesto-parte-b-plan` #6 datos reales; capability `foundation` requirement
"Seed del tenant piloto Masia l'Encís"; regla del épico "concepto nunca lloguer".)

#### Scenario: El seed crea la configuración del piloto con los datos reales

- **WHEN** se ejecuta `pnpm db:seed` tras migrar
- **THEN** existe una `PlantillaDocumentoTenant` del tenant Masia l'Encís con
  `razon_social_fiscal = "Canoliart, SL"`, `nombre_comercial = "Masia l'Encís"`,
  `nif = "B10874287"` e `iban = "ES30 0182 1683 4002 0172 9599"`

#### Scenario: El concepto fiscal usa "espai" y nunca "lloguer"

- **GIVEN** la `PlantillaDocumentoTenant` sembrada del piloto
- **WHEN** se lee `plantilla_concepto_fiscal`
- **THEN** el texto expresa "Gestió de l'ús espai de {nombreComercial} per
  esdeveniment"
- **AND** no contiene la palabra "lloguer"

#### Scenario: Re-ejecutar el seed es idempotente

- **GIVEN** el seed ya ejecutado una vez
- **WHEN** se ejecuta `pnpm db:seed` de nuevo
- **THEN** sigue existiendo exactamente una `PlantillaDocumentoTenant` por tenant
  piloto, con los mismos valores (sin filas duplicadas)

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
  numeración, fecha).

El **layout es fijo en código**; el **contenido es 100% del tenant/documento**:
la plantilla NO PUEDE contener datos de negocio hardcodeados (razón social, NIF,
IBAN, textos de concepto/validesa, colores). La capa DEBE ser **reutilizable por
las facturas de 6.3** sin depender de la capability `presupuestos`. Todas las
funciones nombradas se escriben como **arrow functions** (regla dura del
proyecto). (Fuente: `epico-6-documentos-pdf-roadmap` §Motor react-pdf + layout
fijo/contenido por tenant; `CLAUDE.md §Stack`, regla arrow-functions.)

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

### Requirement: Cabecera solo-texto cuando no hay logo del tenant

La `Cabecera` de la plantilla SHALL (DEBE) renderizar la identidad fiscal del
emisor (razón social fiscal, NIF, dirección fiscal, email, web) tomada de la
config del tenant. Cuando `branding.logoUrl` sea **`null`** (el upload de logo es
6.5 y por defecto no hay logo), la cabecera DEBE renderizarse **solo-texto** sin
romper el layout ni fallar el render. Cuando `logoUrl` esté presente, la cabecera
DEBE incluir el logo. (Fuente: `documentos` 6.1a `BrandingDocumento.logoUrl`
nullable; `design.md` cuestión abierta N3.)

#### Scenario: Render sin logo produce cabecera solo-texto

- **GIVEN** una `ConfiguracionDocumentoTenant` con `branding.logoUrl = null`
- **WHEN** se renderiza el documento
- **THEN** el PDF se genera correctamente con una cabecera de solo-texto (razón
  social fiscal, NIF, dirección, email, web) sin hueco roto ni error de render

#### Scenario: Render con logo incluye el logo

- **GIVEN** una `ConfiguracionDocumentoTenant` con `branding.logoUrl` no nulo
- **WHEN** se renderiza el documento
- **THEN** la cabecera incluye el logo además de los datos fiscales de texto

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
`{ titulo: string; secciones: Array<{ titulo: string; cuerpo: string }> }`, que
representa el documento legal de "Condicions particulars" del tenant. El
contenido DEBE ser **100% del tenant** (título, títulos y cuerpos de cada
sección); la plantilla NO PUEDE contener texto de negocio hardcodeado. Este
bloque DEBE **persistirse en `PlantillaDocumentoTenant`** como una columna JSON
(migración Prisma no destructiva) y mapearse al VO en el adapter Prisma de
configuración. La fila es **1-1 con `Tenant` bajo RLS** (6.1a): la nueva columna
hereda ese aislamiento por tenant. (Fuente: `epico-6-documentos-pdf-roadmap`
§6.4a; `documentos` 6.1a `ConfiguracionDocumentoTenant` /
`PlantillaDocumentoTenant`; `CLAUDE.md §Multi-tenancy`.)

#### Scenario: El bloque condiciones se persiste y se lee por tenant

- **GIVEN** un tenant con una `PlantillaDocumentoTenant` cuya columna JSON
  `condiciones` tiene un título y una lista de secciones (título + cuerpo)
- **WHEN** se obtiene la configuración del tenant vía el adapter Prisma bajo su
  RLS
- **THEN** el VO `ConfiguracionDocumentoTenant` devuelto incluye el bloque
  `condiciones` con el mismo título y las mismas secciones persistidas

#### Scenario: El bloque condiciones no hardcodea contenido de negocio

- **GIVEN** dos tenants con configuraciones de `condiciones` distintas (distinto
  título y secciones)
- **WHEN** se genera el documento de condiciones para cada tenant
- **THEN** cada PDF refleja el contenido del tenant correspondiente
- **AND** no aparece ningún texto de sección fijo compartido entre ambos

### Requirement: Seed piloto del documento de "Condicions particulars"

El factory de seed `construirConfiguracionDocumentoPiloto` SHALL (DEBE) poblar el
bloque `condiciones` del tenant piloto (Masia l'Encís) con el **texto real**
parseado de la hoja "Condicions particulars" del Excel del tenant: título
**"Condicions Particulars"** y **14 secciones** en este orden — Reserva i
pagament, Fiança, Política de cancel·lació, Responsabilitat i dades personals,
Visites, Neteja, Gestió de residus, Horaris, Excés d'horari, Normes de
convivència i ús responsable, Capacitat, Piscina, Música i respecte veïnal,
Parking. El factory DEBE seguir siendo **determinista y puro** (sin efectos),
verificable por unit test sin Postgres. (Fuente: `epico-6-documentos-pdf-roadmap`
§6.4a; Excel `Plantilla_factures i pressupostos.xlsx` hoja "Condicions
particulars".)

#### Scenario: El seed piloto expone las 14 secciones en orden

- **WHEN** se invoca `construirConfiguracionDocumentoPiloto(tenantId)`
- **THEN** `condiciones.titulo` es "Condicions Particulars"
- **AND** `condiciones.secciones` tiene exactamente 14 elementos, cada uno con
  `titulo` y `cuerpo` no vacíos, en el orden especificado

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


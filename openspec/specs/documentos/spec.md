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


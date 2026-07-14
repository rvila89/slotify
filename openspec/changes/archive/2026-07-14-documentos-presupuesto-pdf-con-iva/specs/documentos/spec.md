# documentos Specification

## ADDED Requirements

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

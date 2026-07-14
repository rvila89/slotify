# documentos Specification

## ADDED Requirements

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

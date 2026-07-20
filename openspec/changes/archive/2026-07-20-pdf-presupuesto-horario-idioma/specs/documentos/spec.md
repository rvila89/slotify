# Spec Delta — Capability `documentos`

> **pdf-presupuesto-horario-idioma** — El PDF de presupuesto gana: (1) fecha
> legible "D de mes de AAAA" + rango horario "De HH:MM a HH:MM (N hores)" en el
> bloque de concepto (`horaFin` calculada en memoria, no persistida); (2) título
> "PRESSUPOST" en amarillo `COLOR_ACENTO` (SOLO el presupuesto; la factura conserva
> turquesa); (3) idioma del PDF según `reserva.idioma` (es/ca): etiquetas fijas
> traducidas en el modelo de vista + textos libres del tenant bilingües gestionados
> por seed/migración. NO reimplementa el bloqueo atómico de fecha, la máquina de
> estados ni el contrato OpenAPI.
>
> Fuente: requisito del usuario (validado); `Reserva.idioma`/`Reserva.horario`/
> `Reserva.duracionHoras`; `documentos` `construirModeloDocumentoPresupuesto`,
> `estilos.ts §COLOR_ACENTO`, `DocumentoLayout`/`DocumentoFacturaLayout`,
> `configuracion-documento.ts`; `CLAUDE.md §Arquitectura` (hexagonal,
> `documentos`↛`presupuestos`), `§Multi-tenancy`, regla arrow-functions.

## ADDED Requirements

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

## MODIFIED Requirements

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

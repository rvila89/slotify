# documentos — spec delta (factura-pdf-fiel-referencia)

Corrige la capa de presentación de la FACTURA (señal/liquidación) para replicar
fielmente el documento real del tenant `F2026029 Sergio Carrasco.pdf`. La fianza
(REBUT) no cambia. Cambios de presentación; el modelo de vista puro gana un campo
`conceptoSubtitulo` y ajusta el concepto principal.

## MODIFIED Requirements

### Requirement: Modelo de vista y renderizado de factura (rebanada 6.3)

El sistema SHALL (DEBE) proveer en `documentos/presentation/` una función de
construcción del modelo de vista de factura, `construirModeloDocumentoFactura(params)`,
y una función de renderizado, `renderizarDocumentoFacturaABytes(modelo)`, que juntas
generan el PDF de una FACTURA. El modelo de vista (`ModeloDocumentoFactura`) SHALL
(DEBE) incluir:

- `tipo`: `'senal' | 'liquidacion' | 'fianza'`
- `numeroFactura`: número de factura o `null` (en borradores de liquidación/fianza)
- `fechaEmision`: fecha de emisión
- `concepto`: **concepto principal** resuelto desde
  `config.textos.plantillaConceptoFiscal.{idioma}` interpolando `{nombreComercial}`
  con `config.identidadFiscal.nombreComercial` (regla dura: expresa "espai", NUNCA
  "lloguer"). Es el mismo texto de concepto que el presupuesto del tenant.
- `conceptoSubtitulo`: `string | null` — línea de referencia (indentada, no negrita)
  bajo el concepto principal, resuelta según el **tipo** y el `numeroPresupuesto`:
  - `senal` → "*40% de l'import total anticipat del pressupost núm. {n}" (ca) /
    "*40% del importe total anticipado del presupuesto núm. {n}" (es)
  - `liquidacion` → "*Saldo del 60% de l'import del pressupost núm. {n}" (ca) /
    "*Saldo del 60% del importe del presupuesto núm. {n}" (es)
  - `fianza` → `null` (la fianza no cambia)
  - Cuando `numeroPresupuesto` es `null` en señal/liquidación, se OMITE " núm. {n}".
- `extras`: sub-conceptos de extras (solo en liquidación)
- `totales`: `{ total, baseImponible | null, ivaPorcentaje | null, ivaImporte | null,
  mostrarDesgloseIva: boolean }`
- `cabecera`: `{ mostrarIdentidadFiscal: boolean, … datos del tenant }`
- `pieBancario`: `{ mostrar: boolean, … datos bancarios }`
- `cliente`: datos fiscales del receptor

El modelo de factura **NO** expone pie legal de validez: la validez es del
presupuesto, no de la factura; el layout de factura no renderiza pie legal.

La función `construirModeloDocumentoFactura` es lógica **pura** (sin side-effects):
recibe como input la `ConfiguracionDocumentoTenant`, los datos de la factura, el
cliente y el presupuesto, y devuelve el modelo. Todas las funciones nombradas son
**arrow functions**. (Fuente: épico #6 rebanada 6.3 `documentos-facturas-pdf`;
change `factura-pdf-fiel-referencia`; documento de referencia
`F2026029 Sergio Carrasco.pdf`; `CLAUDE.md` regla arrow-functions.)

#### Scenario: El modelo de vista de señal CON IVA activa todos los bloques

- **GIVEN** una factura de señal con `ivaPorcentaje = 21.00` y datos completos
- **WHEN** se construye `ModeloDocumentoFactura`
- **THEN** `cabecera.mostrarIdentidadFiscal = true`, `totales.mostrarDesgloseIva = true`,
  `pieBancario.mostrar = true`
- **AND** el `concepto` (principal) es "Gestió ús espai de Masia l'Encís per
  esdeveniment" (desde `plantillaConceptoFiscal`, sin "lloguer")
- **AND** el `conceptoSubtitulo` es "*40% de l'import total anticipat del pressupost
  núm. {n}"

#### Scenario: El modelo de vista de señal SIN IVA desactiva identidad fiscal, IVA y pie

- **GIVEN** una factura de señal con `ivaPorcentaje = 0.00`
- **WHEN** se construye `ModeloDocumentoFactura`
- **THEN** `cabecera.mostrarIdentidadFiscal = false`, `totales.mostrarDesgloseIva = false`,
  `pieBancario.mostrar = false`
- **AND** el `concepto` (principal) es el de `plantillaConceptoFiscal` interpolado
- **AND** el `conceptoSubtitulo` es "*40% de l'import total anticipat del pressupost
  núm. {n}"

#### Scenario: El concepto principal de liquidación usa plantilla y el subtítulo el 60%

- **GIVEN** una factura de liquidación con `numeroPresupuesto = "P2026029"` e
  `idioma = 'ca'`
- **WHEN** se construye `ModeloDocumentoFactura`
- **THEN** el `concepto` (principal) es "Gestió ús espai de Masia l'Encís per
  esdeveniment"
- **AND** el `conceptoSubtitulo` es "*Saldo del 60% de l'import del pressupost núm.
  P2026029"

#### Scenario: El concepto principal en castellano usa la plantilla castellana

- **GIVEN** una factura de señal con `idioma = 'es'` y `numeroPresupuesto = "P2026029"`
- **WHEN** se construye `ModeloDocumentoFactura`
- **THEN** el `concepto` (principal) es "Gestión de uso del espacio de Masia l'Encís
  para evento"
- **AND** el `conceptoSubtitulo` es "*40% del importe total anticipado del presupuesto
  núm. P2026029"

#### Scenario: El subtítulo omite el número cuando no hay presupuesto

- **GIVEN** una factura de señal con `numeroPresupuesto = null`
- **WHEN** se construye `ModeloDocumentoFactura`
- **THEN** el `conceptoSubtitulo` no contiene " núm. " (se omite la referencia)

#### Scenario: El modelo de vista de fianza no cambia y no lleva subtítulo

- **GIVEN** una factura de fianza para un tenant con `nombreComercial = "Masia l'Encís"`
- **WHEN** se construye `ModeloDocumentoFactura`
- **THEN** el `concepto` es `"Fiança de garantia — Masia l'Encís"` (comportamiento
  actual de la fianza, sin cambios)
- **AND** `conceptoSubtitulo` es `null`
- **AND** no aparece ningún número de presupuesto en el concepto

#### Scenario: La factura no renderiza el pie legal de validez

- **GIVEN** una factura de señal renderizada a bytes/PDF
- **WHEN** se inspecciona el contenido del PDF
- **THEN** el PDF **no** contiene "validesa de 10 dies" (ni su equivalente
  castellano "validez de 10 días")

#### Scenario: La franja de totales de la factura muestra "Import factura" sin validez

- **GIVEN** una factura de señal renderizada a bytes/PDF
- **WHEN** se inspecciona la franja de totales
- **THEN** la columna izquierda muestra SOLO la etiqueta "Import factura" (ca) /
  "Importe factura" (es) en negrita, con la celda de valor VACÍA debajo (fiel a la
  referencia: los importes van bajo Base imp./% Iva/Total)
- **AND** no aparece la etiqueta "Validesa"/"Validez" ni una fila de validez en la
  factura

#### Scenario: El pie bancario de la factura es fiel a la referencia

- **GIVEN** una factura de señal CON IVA renderizada a bytes/PDF
- **WHEN** se inspecciona el pie bancario
- **THEN** el pie muestra la frase de formalización, la de transferencia y el IBAN
- **AND** **no** contiene la línea "Dades bancàries: {beneficiario}" (se omite el
  beneficiario en la factura)
- **AND** el pie va precedido por una línea oro divisoria (color de acento
  `#ffd978`)

### Requirement: Componente BloqueConceptoFactura en la capa de plantilla (rebanada 6.3)

El sistema SHALL (DEBE) proveer en `documentos/presentation/componentes/` un componente
React-PDF `BloqueConceptoFactura` que renderice el concepto de la factura sin
información de horas ni desglose de invitados (a diferencia del presupuesto). El
componente DEBE aceptar como props el **concepto principal** (string, en negrita), un
**subtítulo opcional** de referencia (`conceptoSubtitulo?: string | null`, línea
indentada NO negrita bajo el principal) y, opcionalmente, una lista de extras
(`{ descripcion, subtotal }`). Cuando `conceptoSubtitulo` es `null`/ausente, el
componente NO pinta la línea de subtítulo (fianza y compatibilidad). El componente es
un `.tsx` reutilizado por la factura de liquidación (con extras), la de señal (con
subtítulo) y la de fianza (sin subtítulo). Todas las funciones nombradas son **arrow
functions**. (Fuente: épico #6 rebanada 6.3; change `factura-pdf-fiel-referencia`;
documento de referencia `F2026029 Sergio Carrasco.pdf`; `CLAUDE.md` regla
`components/ solo .tsx`.)

#### Scenario: BloqueConceptoFactura sin subtítulo ni extras renderiza solo el concepto

- **GIVEN** un `BloqueConceptoFactura` con `concepto = "Gestió ús espai…"`, sin
  `conceptoSubtitulo` y sin extras
- **WHEN** se renderiza en el PDF
- **THEN** el PDF contiene el concepto principal y no muestra subtítulo, extras ni horas

#### Scenario: BloqueConceptoFactura con subtítulo renderiza la línea de referencia indentada

- **GIVEN** un `BloqueConceptoFactura` con `concepto = "Gestió ús espai…"` y
  `conceptoSubtitulo = "*40% de l'import total anticipat del pressupost núm. P2026029"`
- **WHEN** se renderiza en el PDF
- **THEN** el PDF contiene el concepto principal en negrita y, debajo, la línea de
  subtítulo indentada y NO en negrita

#### Scenario: BloqueConceptoFactura con extras renderiza los sub-conceptos

- **GIVEN** un `BloqueConceptoFactura` con `concepto`, `conceptoSubtitulo` y
  `extras = [{ descripcion, subtotal }]`
- **WHEN** se renderiza en el PDF
- **THEN** el PDF contiene el concepto principal, el subtítulo y cada extra como
  sub-concepto con su subtotal

### Requirement: Fidelidad visual de la plantilla de documentos al diseño real del tenant

La capa de plantilla react-pdf de `documentos` SHALL (DEBE) replicar la **identidad
visual** del documento real del tenant, aplicada de forma consistente a **TODOS** los
tipos de documento (presupuesto CON IVA, presupuesto SIN IVA, factura señal/liquidación
40/60 y condicions particulars), tomando como referencias los documentos reales
`P2026023 Laura Mas.pdf` (presupuesto) y `F2026029 Sergio Carrasco.pdf` (factura de
señal). El rediseño afecta a la capa **compartida** de presentación (`estilos.ts`,
`Cabecera`, `BloqueCliente`, `TablaConcepto`, `BloqueTotales`, `PieBancario`,
`DocumentoLayout`, `DocumentoFacturaLayout`, `DocumentoCondicionesLayout`) y DEBE
incluir, para la variante CON IVA del **presupuesto** (documento canónico de
referencia):

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

Para la **FACTURA** (señal/liquidación), fiel a `F2026029 Sergio Carrasco.pdf`, el
layout `DocumentoFacturaLayout` DEBE además:

- **Concepto**: pintar el **concepto principal** (desde `plantillaConceptoFiscal`, en
  negrita) y una **línea de subtítulo indentada NO negrita** (`conceptoSubtitulo`:
  el 40%/60% con nº de presupuesto). La fianza (REBUT) **no** lleva subtítulo.
- **Franja de totales**: la columna izquierda muestra SOLO la etiqueta
  **"Import factura"** (`etiquetas.importFactura`, ca/es) en negrita, con la celda de
  valor VACÍA (fiel a la referencia); **sin** fila de validez.
- **Pie legal**: la factura **NO** renderiza el pie legal de validez.
- **Pie bancario**: fiel a la referencia — **sin** la línea de beneficiario ("Dades
  bancàries: …") y con una **línea oro divisoria** (`COLOR_ACENTO = #ffd978`) sobre
  el pie. Sigue mostrándose solo en la variante CON IVA (`pieBancario.mostrar`).

Los componentes compartidos `BloqueTotales` y `PieBancario` DEBEN **parametrizarse**
(etiqueta/valor de la columna izquierda de totales; visibilidad de la línea de
beneficiario y de la línea oro en el pie) de modo **retrocompatible con el
presupuesto** (defaults que preservan su comportamiento actual).

**Formato de importes (todos los documentos):** los importes monetarios SHALL (DEBEN)
pintarse con **coma decimal** y separador de millares con **punto** (convención
es-ES/ca-ES; p. ej. "178,51 €", "1.200,00 €"), fiel a las referencias `F2026029` y
`P2026023`, mediante un helper PURO de presentación aplicado de forma consistente en
concepto, extras, franja de totales y reparto/condicions de **factura y presupuesto**.
El helper formatea a partir del string decimal (sin `parseFloat`) para no introducir
error de coma flotante en importes monetarios. La etiqueta de base imponible de la
franja de totales SHALL (DEBE) ser la abreviatura "Base imp." (ca y es), fiel a ambas
referencias.

El **layout es fijo en código**; el **contenido sigue siendo 100% del
tenant/documento** (colores desde `branding`, textos y datos desde la config y el
documento): la plantilla NO PUEDE hardcodear datos de negocio (razón social, NIF,
IBAN, textos de concepto/validesa). Las variantes **SIN IVA** y **factura 40/60**
se **derivan por los flags ya existentes** (`cabecera.mostrarIdentidadFiscal`,
`totales.mostrarDesgloseIva`, `pieBancario.mostrar`). El cambio de color de título es
de **presentación**: el modelo de vista del presupuesto cambia mínima o nulamente y
los tests de **contenido del modelo del presupuesto** quedan verdes sin cambios.
Todas las funciones nombradas se escriben como **arrow functions** y los ficheros de
`presentation/componentes/` son SOLO `.tsx`. (Fuente: `epico-6-documentos-pdf-roadmap`
§6.5; change `factura-pdf-fiel-referencia`; documentos de referencia
`P2026023 Laura Mas.pdf` y `F2026029 Sergio Carrasco.pdf`; `documentos` 6.1b capa de
plantilla; `estilos.ts §COLOR_ACENTO`; `CLAUDE.md §Stack` arrow-functions y
guardarraíl `componentes/` solo `.tsx`.)

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

#### Scenario: La factura de señal replica la identidad visual de su referencia

- **GIVEN** el tenant piloto y una factura de señal CON IVA
- **WHEN** se renderiza la factura
- **THEN** el PDF muestra el concepto principal en negrita (desde
  `plantillaConceptoFiscal`) con el subtítulo indentado 40% debajo, la franja de
  totales con "Import factura" y sin validez, sin pie legal de validez, y el pie
  bancario sin línea de beneficiario y con la línea oro divisoria

#### Scenario: Los importes se pintan con coma decimal y separador de millares

- **GIVEN** una factura (o presupuesto) con `baseImponible = "178.51"`,
  `total = "1200.00"`
- **WHEN** se renderiza el documento
- **THEN** los importes aparecen como "178,51 €" y "1.200,00 €" (coma decimal,
  millares con punto), NO "178.51 €" ni "1200.00 €"
- **AND** la etiqueta de base imponible de la franja de totales es "Base imp."

#### Scenario: Los cambios de la factura no rompen el presupuesto (retrocompatibilidad)

- **GIVEN** un presupuesto CON IVA del mismo tenant
- **WHEN** se renderiza con los componentes `BloqueTotales` y `PieBancario`
  parametrizados
- **THEN** el presupuesto sigue mostrando la franja `Validesa | Base imp. | % Iva |
  Total` con su validesaTexto, y el pie bancario con la línea de beneficiario "Dades
  bancàries: …"
- **AND** los tests de contenido del modelo de vista del presupuesto siguen verdes
  sin cambios

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
- **AND** los tests de contenido del modelo de vista del presupuesto (datos:
  concepto, importes, reparto, validesa) siguen verdes sin cambios, porque el cambio
  es de presentación

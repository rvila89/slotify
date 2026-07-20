# Spec Delta — Capability `presupuestos`

> **pdf-presupuesto-horario-idioma** — El contenido del PDF de presupuesto se
> enriquece: el bloque de concepto muestra la fecha del evento como "D de mes de
> AAAA" (con año, mes en el idioma del cliente), un rango horario "De HH:MM a HH:MM
> (N hores)" (con fallback si no hay hora de inicio) y el nº de personas derivado
> del aforo real; y el documento se genera en el idioma del cliente
> (`Reserva.idioma`, es/ca). El adaptador de carga proyecta `idioma` y `horario` de
> la reserva y corrige la derivación de `numPersonas`. NO reimplementa el bloqueo
> atómico de fecha, el motor de tarifa ni el contrato OpenAPI.
>
> Fuente: requisito del usuario (validado); `Reserva.idioma`/`Reserva.horario`/
> `Reserva.duracionHoras`; `cargar-datos-documento-presupuesto.prisma.adapter.ts`;
> `documentos` `construirModeloDocumentoPresupuesto`; `CLAUDE.md §Multi-tenancy`,
> §Máquina de estados (aforo derivado).

## MODIFIED Requirements

### Requirement: Contenido del PDF de presupuesto tomado de la config del tenant

El PDF del presupuesto CON IVA SHALL (DEBE) componerse **exclusivamente** con
datos del tenant y de la reserva, sin valores de negocio hardcodeados, y en el
**idioma del cliente** (`Reserva.idioma ∈ {es, ca}`, default `es`; el adaptador de
carga lo proyecta a `DatosDocumentoPresupuesto.idioma`):

- **Cabecera**: logo si `logoUrl` no es nulo (si no, solo-texto), razón social
  fiscal, NIF, dirección fiscal, email y web (de `identidadFiscal`).
- **Dades client** (del cliente de la reserva): nombre y apellidos, DNI/NIF,
  dirección, CP + población, provincia.
- **PRESSUPOST/PRESUPUESTO + número + Data/Fecha** (etiquetas en el idioma del
  cliente).
- **CONCEPTE/CONCEPTO · PREU/PRECIO**: el texto de `textos.plantillaConceptoFiscal`
  (bilingüe, elegido por el idioma del cliente) con el placeholder
  `{nombreComercial}` resuelto (expresa "espai", **nunca** "lloguer"); debajo, tres
  líneas legibles:
  - la **fecha del evento** como "D de <mes> de AAAA" (con año, mes en el idioma
    del cliente),
  - el **horario**: "De HH:MM a HH:MM (N <hores|horas>)" cuando `Reserva.horario`
    no es nulo (la hora de fin se calcula en memoria desde `horario` +
    `duracionHoras`, no se persiste), o el **fallback** "(N <hores|horas>)" sin
    rango cuando `Reserva.horario` es nulo,
  - el **nº de personas**, derivado del aforo:
    `numInvitadosFinal ?? (numAdultosNinosMayores4 + numNinosMenores4)` (fix de la
    derivación previa que solo tomaba `numAdultosNinosMayores4`),

  y los **extras** de la reserva como sub-conceptos con su precio.
- **Validesa/Validez** (`textos.validesaTexto`, bilingüe) | Base imp. | % IVA |
  Total.
- **Condicions/Condiciones**: 40% pago anticipado / 60% import restant / fiança "A
  l'arribada" (del desglose/reparto del presupuesto), con etiquetas en el idioma
  del cliente.
- **Pie bancario**: instrucciones de pago + IBAN (de `banca`).

(Fuente: Excel hoja "PRESSUPOST IVA"; `documentos` 6.1a
`ConfiguracionDocumentoTenant`; regla del épico "concepto nunca lloguer"; change
`pdf-presupuesto-horario-idioma` — fecha con año, rango horario y idioma del
cliente; fix `numPersonas` derivado del aforo, `aforo/personas es campo derivado`.)

#### Scenario: El concepto fiscal usa la plantilla bilingüe del tenant y nunca "lloguer"

- **GIVEN** una config con `plantillaConceptoFiscal = { ca: "Gestió de l'ús espai
  de {nombreComercial} per esdeveniment", es: "Gestión del uso del espacio de
  {nombreComercial} para evento" }` y `nombreComercial = "Masia l'Encís"`, y un
  presupuesto con `idioma = 'ca'`
- **WHEN** se renderiza el concepto del PDF
- **THEN** aparece "Gestió de l'ús espai de Masia l'Encís per esdeveniment"
- **AND** el documento no contiene la palabra "lloguer"

#### Scenario: El bloque de concepto muestra fecha con año y rango horario

- **GIVEN** una reserva con `fechaEvento = 2026-09-20`, `horario = '12:00'`,
  `duracionHoras = 8`, `numAdultosNinosMayores4 = 14`, `numNinosMenores4 = 0`,
  `numInvitadosFinal = null` e `idioma = 'ca'`
- **WHEN** se renderiza el bloque de concepto
- **THEN** aparecen tres líneas: "20 de setembre de 2026", "De 12:00 a 18:00
  (8 hores)" y "14 persones"

#### Scenario: Fallback sin hora de inicio muestra solo la duración

- **GIVEN** una reserva con `horario = null` y `duracionHoras = 8` e `idioma = 'ca'`
- **WHEN** se renderiza el bloque de concepto
- **THEN** la línea de horario es "(8 hores)" sin rango, y el PDF se genera sin
  error

#### Scenario: El nº de personas se deriva del aforo real

- **GIVEN** una reserva con `numInvitadosFinal = null`,
  `numAdultosNinosMayores4 = 30` y `numNinosMenores4 = 10`
- **WHEN** el adaptador carga los datos del documento
- **THEN** `numPersonas = 40` (`numAdultosNinosMayores4 + numNinosMenores4`), no 30
- **AND** si `numInvitadosFinal` estuviera informado, se usaría ese valor con
  prioridad

#### Scenario: Los extras aparecen como sub-conceptos con precio

- **GIVEN** una reserva con extras (p. ej. "Neteja" a 100 €)
- **WHEN** se renderiza el PDF
- **THEN** cada extra figura como sub-concepto del bloque CONCEPTE con su precio

#### Scenario: El PDF se genera en el idioma del cliente (es)

- **GIVEN** una reserva con `idioma = 'es'`
- **WHEN** el adaptador carga los datos y se renderiza el PDF
- **THEN** `DatosDocumentoPresupuesto.idioma = 'es'` y el documento usa las
  etiquetas fijas y los textos libres del tenant en castellano

# presupuestos Specification

## Purpose
TBD - created by archiving change us-014-generar-presupuesto-activar-prereserva. Update Purpose after archive.
## Requirements
### Requirement: Precondición — origen válido y sin presupuesto enviado/aceptado previo

El sistema SHALL (DEBE) validar en el servidor, **antes** de cualquier cálculo o mutación,
que la RESERVA está en `estado = 'consulta'` con `sub_estado ∈ {'2a','2b','2c','2v'}` y que
**no** existe ya un PRESUPUESTO en `estado = 'enviado'` o `'aceptado'` para esa RESERVA. Si
la RESERVA está en `sub_estado = '2d'` (cola), en un sub-estado terminal (`2.x`/`2.y`/`2.z`)
o en `estado = 'pre_reserva'` o posterior, o si ya existe un PRESUPUESTO
`enviado`/`aceptado`, el sistema DEBE **rechazar** la operación **sin ejecutar el motor de
tarifa** y **sin crear** ningún PRESUPUESTO; en el caso del presupuesto ya existente, DEBE
indicar que se use la edición (UC-15). La guarda de origen se modela en la **máquina de
estados declarativa** (no condicionales dispersos): solo `{consulta, 2a|2b|2c|2v}` es
origen válido para esta operación. (Fuente: `US-014 §Reglas de negocio`, `§Reglas de
Validación`, `§Consulta en sub-estado terminal`; UC-14; `CLAUDE.md §Máquina de estados`.)

#### Scenario: Consulta en sub-estado terminal no permite generar presupuesto

- **GIVEN** una RESERVA en `sub_estado = '2x'` (expirada, terminal)
- **WHEN** el gestor intenta generar el presupuesto
- **THEN** el sistema rechaza la operación con error de validación
- **AND** no ejecuta el motor de tarifa ni crea ningún PRESUPUESTO

#### Scenario: Consulta en cola (2.d) no permite generar presupuesto

- **GIVEN** una RESERVA en `sub_estado = '2d'` (en cola)
- **WHEN** el gestor intenta generar el presupuesto
- **THEN** el sistema rechaza la operación sin ejecutar el motor de tarifa ni mutar nada

#### Scenario: Presupuesto ya enviado remite a la edición (UC-15)

- **GIVEN** una RESERVA que ya tiene un PRESUPUESTO en `estado = 'enviado'` (o `'aceptado'`)
- **WHEN** el gestor intenta generar un presupuesto de nuevo
- **THEN** el sistema rechaza la operación e indica que debe usarse la edición (UC-15)
- **AND** no crea un segundo PRESUPUESTO

### Requirement: Validación síncrona de completitud de datos y datos fiscales antes del cálculo

El sistema SHALL (DEBE) validar, **antes** de llamar al motor de tarifa, que la RESERVA
tiene datos completos —`fecha_evento` (futura válida), `duracion_horas ∈ {4,8,12}`,
`num_adultos_ninos_mayores4 ≥ 1`, `tipo_evento ∈ {boda, corporativo, privado, otro}`— y que
el CLIENTE tiene **todos** los datos fiscales no nulos y no vacíos: `dni_nif`, `direccion`,
`codigo_postal`, `poblacion`, `provincia`. Si falta cualquiera de los datos fiscales, el
sistema DEBE devolver un error **enumerando los campos fiscales faltantes**, **no** llamar
al motor de tarifa, **no** crear PRESUPUESTO, y **no** mutar la RESERVA ni la
`FECHA_BLOQUEADA`. El campo `num_ninos_menores4` es **informativo** y no cuenta para el
cálculo (niños ≤4 años gratuitos). (Fuente: `US-014 §Reglas de negocio`, `§FA-01`,
`§Reglas de Validación`; UC-14.)

#### Scenario: Datos fiscales incompletos enumeran los campos faltantes sin efectos (FA-01)

- **GIVEN** una RESERVA en `2.b` con fecha y nº de invitados completos, pero
  `CLIENTE.dni_nif` es nulo
- **WHEN** el gestor hace clic en "Generar presupuesto"
- **THEN** el sistema muestra un error enumerando los campos fiscales faltantes
  (`dni_nif`, y cualquier otro de `direccion`/`codigo_postal`/`poblacion`/`provincia`)
- **AND** no crea ningún PRESUPUESTO, la RESERVA permanece en `sub_estado = '2b'` y
  `FECHA_BLOQUEADA` no se modifica

#### Scenario: num_ninos_menores4 no cuenta para el cálculo de tarifa

- **GIVEN** una RESERVA con `num_adultos_ninos_mayores4 = 30` y `num_ninos_menores4 = 10`
- **WHEN** el sistema calcula la tarifa
- **THEN** pasa únicamente `num_adultos_ninos_mayores4 = 30` al motor, ignorando los 10
  menores de 4 años para la determinación del tramo

### Requirement: Delegación del cálculo al motor de tarifa (US-016) y propagación de errores de configuración

El sistema SHALL (DEBE) delegar el cálculo del importe al **motor de la capability
`calculo-tarifa`** (US-016), invocándolo con `{ fecha_evento, duracion_horas,
num_adultos_ninos_mayores4, extras }` y recibiendo el esquema canónico `{ temporada,
tarifa_a_consultar, precio_tarifa_eur, extras_total_eur, total_eur, tarifa_id }`. El sistema
NO DEBE reimplementar la lógica de tarifario. Si el motor lanza `TARIFA_NO_CONFIGURADA`,
`TEMPORADA_NO_CONFIGURADA` o `EXTRA_NO_ENCONTRADO`, el sistema DEBE mostrar un error de
configuración legible (p. ej. "Tarifa no configurada para los parámetros indicados"), **no**
crear PRESUPUESTO y dejar la RESERVA en su sub_estado anterior sin tocar `FECHA_BLOQUEADA`.
(Fuente: `US-014 §Reglas de negocio`, `§Motor de tarifa sin tarifa vigente`, `§Supuestos`;
UC-14/UC-16; capability `calculo-tarifa`.)

#### Scenario: El motor sin tarifa vigente aborta la generación (error de configuración)

- **GIVEN** un tarifario del tenant sin `TARIFA` vigente para la combinación (temporada,
  duracion_horas, tramo de invitados) de la RESERVA
- **WHEN** el sistema delega el cálculo al motor de tarifa
- **THEN** el motor lanza `TARIFA_NO_CONFIGURADA` y el sistema muestra "Tarifa no
  configurada para los parámetros indicados"
- **AND** no crea ningún PRESUPUESTO y la RESERVA permanece en su sub_estado anterior

#### Scenario: El cálculo del borrador se delega íntegramente al motor

- **GIVEN** una RESERVA con datos completos y una `TARIFA` vigente
- **WHEN** el sistema genera el borrador
- **THEN** obtiene `precio_tarifa_eur`, `extras_total_eur`, `total_eur` y `tarifa_id` del
  motor de `calculo-tarifa` sin reimplementar la búsqueda de tarifario

### Requirement: Presupuesto como borrador editable sin efectos hasta la confirmación

El sistema SHALL (DEBE) presentar el resultado del cálculo como un **borrador editable**:
el desglose (base imponible, IVA 21%, extras, total y reparto 40%/60%/fianza) y la
posibilidad de que el Gestor ajuste **cantidades, extras y descuentos** antes de confirmar.
Durante la fase de borrador el sistema NO DEBE crear ningún PRESUPUESTO persistente, NO DEBE
mutar `RESERVA.estado`/`sub_estado`/`ttl_expiracion` ni la `FECHA_BLOQUEADA`, y NO DEBE
enviar ningún email. Los efectos (persistencia + transición + bloqueo + email) ocurren solo
al **confirmar** el borrador. (Fuente: `US-014 §Reglas de negocio` borrador editable,
`§FA-03`; UC-14.)

#### Scenario: El borrador no persiste ni muta estado

- **GIVEN** una RESERVA en `2.b` para la que el sistema ha calculado el borrador
- **WHEN** el gestor está revisando/ajustando el borrador (aún no confirma)
- **THEN** no existe ninguna fila de PRESUPUESTO persistida
- **AND** la RESERVA permanece en `sub_estado = '2b'` y `FECHA_BLOQUEADA` no se modifica

#### Scenario: Cancelar en fase de borrador no deja efectos (FA-03)

- **GIVEN** el sistema ha presentado el borrador editable del presupuesto
- **WHEN** el gestor pulsa "Cancelar"
- **THEN** no se crea ningún PRESUPUESTO
- **AND** la RESERVA permanece en su sub-estado anterior (`2a`/`2b`/`2c`/`2v`),
  `FECHA_BLOQUEADA` no se modifica y no se envía ningún email

### Requirement: Precio manual cuando el motor devuelve tarifa a consultar (>50 invitados)

El sistema SHALL (DEBE), cuando el motor de tarifa devuelve `tarifa_a_consultar = true`
(caso `num_adultos_ninos_mayores4 > 50`, con los importes a `null`), **habilitar un campo de
precio total manual** en el borrador y **esperar** a que el Gestor introduzca el precio antes
de permitir la confirmación y la generación del PDF. Al confirmar, el `PRESUPUESTO.total`
DEBE ser el precio introducido manualmente por el Gestor; el flujo **no se bloquea** por la
ausencia de tarifa en tarifario para el tramo +50. (Fuente: `US-014 §Reglas de negocio`
tarifa a consultar, `§FA-02`; UC-14/UC-16 FA-01; capability `calculo-tarifa` "tarifa a
consultar".)

#### Scenario: 60 invitados habilita precio manual y completa la transición (FA-02)

- **GIVEN** una RESERVA con `num_adultos_ninos_mayores4 = 60`
- **WHEN** el gestor inicia la generación del presupuesto
- **THEN** el motor devuelve `tarifa_a_consultar = true` con importes a `null` y el sistema
  muestra la tarifa como "A consultar" habilitando un campo de precio total manual
- **AND** el gestor introduce el precio, confirma, y el `PRESUPUESTO.total` es el precio
  manual introducido; la transición a `pre_reserva` se completa

#### Scenario: Sin precio manual no se puede confirmar el presupuesto a consultar

- **GIVEN** un borrador con `tarifa_a_consultar = true` y sin precio manual introducido
- **WHEN** el gestor intenta confirmar
- **THEN** el sistema no permite la confirmación hasta que se introduzca el precio total
  manual

### Requirement: Congelado de tarifa y desglose fiscal del PRESUPUESTO al confirmar

El sistema SHALL (DEBE), al confirmar el borrador, crear una fila de PRESUPUESTO con
`version = 1`, `tarifa_congelada = true`, `estado = 'enviado'`, `iva_porcentaje = 21`, y el
**desglose fiscal congelado**: `base_imponible`, `iva_importe`, `total` (y `descuento_eur`/
`descuento_motivo` si el Gestor aplicó descuento), calculados a partir del resultado del
motor de tarifa (o del precio manual del caso `tarifa_a_consultar`). Una vez congelado
(`tarifa_congelada = true`), si la `TARIFA` del tarifario cambia posteriormente, el
PRESUPUESTO existente **NO** se recalcula. El PRESUPUESTO se persiste en la **misma
transacción** que la transición de la RESERVA a `pre_reserva` (ver capability `consultas`).
(Fuente: `US-014 §Happy Path`, `§Reglas de negocio` tarifa congelada; UC-14; `er-diagram.md
§3.11 PRESUPUESTO`.)

#### Scenario: Confirmar crea el PRESUPUESTO congelado con IVA 21%

- **GIVEN** una RESERVA en `2.b` con datos completos, CLIENTE con datos fiscales y una
  `TARIFA` vigente (40 invitados, 8 horas, septiembre/alta, sin extras)
- **WHEN** el gestor confirma el borrador
- **THEN** se crea un PRESUPUESTO con `version = 1`, `tarifa_congelada = true`,
  `estado = 'enviado'`, `iva_porcentaje = 21`, y `base_imponible`, `iva_importe` y `total`
  derivados del cálculo del motor

#### Scenario: Un cambio posterior del tarifario no recalcula el presupuesto congelado

- **GIVEN** un PRESUPUESTO con `tarifa_congelada = true` para una RESERVA en `pre_reserva`
- **WHEN** la `TARIFA` del tarifario cambia después
- **THEN** el PRESUPUESTO existente conserva su `total` y su desglose sin recalcularse

### Requirement: Generación del PDF del presupuesto con el desglose de pago

El sistema SHALL (DEBE) generar, al confirmar, el **PDF del presupuesto** que incluye: el
desglose de tarifa (base imponible + IVA 21%), los extras seleccionados, el total, el
**reparto 40%/60%/fianza** y las **instrucciones de transferencia** de la señal (IBAN del
tenant, beneficiario, concepto), y almacenar su referencia en `PRESUPUESTO.pdf_url`. El PDF
es el documento que el email E2 adjunta por referencia a `pdf_url` (ver capability
`comunicaciones`, interfaz de adjuntos de US-045). El desglose 40%/60%/fianza y las
instrucciones de pago son **texto informativo** del PDF; la creación de la FACTURA de señal
queda fuera de este change. (Fuente: `US-014 §Reglas de negocio` PDF, `§Happy Path`; UC-14;
`er-diagram.md §3.11` `pdf_url`; US-045 interfaz de adjuntos.)

#### Scenario: El PDF incluye el desglose 40/60/fianza e instrucciones de transferencia

- **GIVEN** una confirmación de presupuesto exitosa con `total` calculado
- **WHEN** el sistema genera el PDF
- **THEN** el PDF contiene la base imponible, el IVA 21%, los extras, el total, el reparto
  40%/60%/fianza y las instrucciones de transferencia (IBAN, beneficiario, concepto) del
  tenant
- **AND** `PRESUPUESTO.pdf_url` referencia el documento generado, disponible para el
  adjunto de E2

### Requirement: Completar los datos fiscales del CLIENTE de una RESERVA

El sistema SHALL (DEBE) exponer una operación dedicada para **actualizar los datos
fiscales del CLIENTE** asociado a una RESERVA `{id}`, de modo que el gestor pueda
resolver la validación `DATOS_FISCALES_INCOMPLETOS` (US-014 §FA-01) sin abandonar el
flujo de presupuesto. La operación DEBE actualizar **únicamente** los campos fiscales
del CLIENTE: `dni_nif`, `direccion`, `codigo_postal`, `poblacion`, `provincia`
(todos opcionales/`nullable` en el modelo). La operación NO PUEDE modificar ningún
campo de la RESERVA (`fecha_evento`, `duracion_horas`, `num_adultos_ninos_mayores4`,
`tipo_evento`), ni el estado/sub_estado/`ttl_expiracion` de la RESERVA, ni la
`FECHA_BLOQUEADA`: esos campos tienen sus propios flujos (p. ej. la fecha se fija con
el flujo de bloqueo atómico dedicado). El `tenant_id` DEBE derivar SIEMPRE del JWT
(nunca del body); el CLIENTE se resuelve **a través de** la RESERVA `{id}` bajo el
contexto RLS del tenant. La operación es una acción del Gestor (rol `gestor`).
(Fuente: `US-014 §FA-01`, `§Reglas de Validación`, `§Reglas de negocio` datos
fiscales del CLIENTE; UC-14; plan `en-el-paso-de-zippy-dragon.md` #5; patrón
`PATCH /reservas/{id}/iban-devolucion` de US-035; `CLAUDE.md §Multi-tenancy`,
`§Regla crítica: bloqueo atómico de fecha`.)

#### Scenario: Completar datos fiscales faltantes desbloquea la generación de presupuesto

- **GIVEN** una RESERVA en `sub_estado = '2b'` cuyo CLIENTE tiene `dni_nif` nulo (y
  el resto de datos fiscales presentes)
- **WHEN** el gestor guarda el `dni_nif` que faltaba mediante la operación de datos
  fiscales del CLIENTE
- **THEN** el CLIENTE queda con `dni_nif` persistido y el resto de sus datos fiscales
  intactos
- **AND** una posterior generación/confirmación de presupuesto ya **no** falla por
  `DATOS_FISCALES_INCOMPLETOS` respecto a ese campo

#### Scenario: La operación solo toca campos fiscales del CLIENTE, nunca la RESERVA

- **GIVEN** una RESERVA en `sub_estado = '2b'` con `fecha_evento`, `duracion_horas`,
  `num_adultos_ninos_mayores4` y `tipo_evento` ya fijados, y una `FECHA_BLOQUEADA`
  activa para esa fecha
- **WHEN** el gestor actualiza los datos fiscales del CLIENTE (`direccion`,
  `codigo_postal`, `poblacion`, `provincia`, `dni_nif`)
- **THEN** solo cambian esos campos del CLIENTE
- **AND** la RESERVA conserva su `estado`/`sub_estado`/`ttl_expiracion` y sus campos
  de evento, y la `FECHA_BLOQUEADA` no se modifica

#### Scenario: El tenant se toma del JWT, no del body (aislamiento multi-tenant)

- **GIVEN** un gestor autenticado del tenant A y una RESERVA que pertenece al
  tenant B
- **WHEN** intenta actualizar los datos fiscales del CLIENTE de esa RESERVA
- **THEN** el sistema no encuentra la RESERVA bajo el contexto RLS del tenant A
  (RESERVA de otro tenant → no visible) y rechaza la operación como recurso
  inexistente
- **AND** ningún dato del CLIENTE del tenant B es leído ni modificado

#### Scenario: Actualización parcial no borra los campos fiscales ya presentes

- **GIVEN** un CLIENTE con `dni_nif`, `poblacion` y `provincia` ya informados y
  `direccion`/`codigo_postal` nulos
- **WHEN** el gestor envía únicamente `direccion` y `codigo_postal` para completarlos
- **THEN** se persisten `direccion` y `codigo_postal`
- **AND** `dni_nif`, `poblacion` y `provincia` conservan sus valores previos (la
  operación no los sobrescribe con nulos por omisión)

#### Scenario: Actor sin rol Gestor no puede editar datos fiscales

- **GIVEN** un usuario autenticado sin rol `gestor`
- **WHEN** intenta actualizar los datos fiscales del CLIENTE de una RESERVA
- **THEN** el sistema rechaza la operación por autorización insuficiente
- **AND** no modifica ningún dato del CLIENTE

### Requirement: PDF real del presupuesto CON IVA (sustituye al fake)

El sistema SHALL (DEBE) generar el PDF del presupuesto como un **documento real**
renderizado con `@react-pdf/renderer`, reemplazando al adaptador *fake*
(`PdfPresupuestoFakeAdapter`, URL sintética). El adaptador real implementa el
puerto de dominio **ya existente** `GenerarPdfPresupuestoPort`
(`(params:{tenantId,reservaId,idPresupuesto}) => Promise<string|null>`) y se
inyecta por el token **existente** `GENERAR_PDF_PRESUPUESTO_PORT` en
`PresupuestosModule`; el caso de uso `GenerarPresupuestoUseCase` **no cambia** (la
generación sigue siendo **post-commit**, fuera de la transacción crítica del
bloqueo de fecha). El adaptador DEBE:

1. cargar la **configuración del tenant** (`ObtenerConfiguracionDocumentoService`)
   y los datos del presupuesto/reserva/cliente/extras;
2. renderizar el PDF con la **capa de plantilla de documentos** (capability
   `documentos`);
3. **subir** los bytes por `AlmacenDocumentosPort.subir(...)`;
4. devolver la **URL real** (que el E2 §D-7 adjunta como `pdf_url`).

Esta rebanada cubre **solo la variante CON IVA** (pago por transferencia, hoja
"PRESSUPOST IVA"). Un fallo del render/subida NO revierte la pre_reserva ya
comprometida (comportamiento post-commit existente: devuelve `null`). (Fuente:
US-014/UC-14 §D-6/§D-7; `epico-6-documentos-pdf-roadmap` 6.1b; `documentos` 6.1a.)

#### Scenario: El presupuesto genera un PDF real y devuelve su URL

- **GIVEN** una reserva con datos fiscales completos y una
  `ConfiguracionDocumentoTenant` del tenant
- **WHEN** se confirma el presupuesto (US-014)
- **THEN** el PDF se renderiza con `@react-pdf/renderer`, se sube por
  `AlmacenDocumentosPort` y `pdf_url` apunta a la URL real del objeto subido
- **AND** NO es la URL sintética `https://storage.local/presupuestos/{id}.pdf` del
  fake

#### Scenario: El PDF es CON IVA (transferencia)

- **GIVEN** un presupuesto con base imponible, `% IVA` e importe de IVA
- **WHEN** se renderiza el PDF
- **THEN** el documento muestra Base imp., % IVA y Total (variante CON IVA), y el
  pie bancario con las instrucciones de transferencia e IBAN de la config del
  tenant

#### Scenario: Un fallo de render/subida no revierte la pre_reserva

- **GIVEN** una confirmación de presupuesto cuya pre_reserva ya se ha comprometido
- **WHEN** el render o la subida del PDF falla en el post-commit
- **THEN** la pre_reserva permanece comprometida y la operación devuelve el
  presupuesto (con `pdf_url` sin resolver), sin revertir la transacción

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

### Requirement: Método de pago del presupuesto determina el régimen fiscal

El sistema SHALL (DEBE) capturar, **al generar el presupuesto** (endpoints de
**preview** y **confirmar** de US-014), un método de pago **obligatorio**
`metodoPago ∈ {'transferencia', 'efectivo'}`, y derivar de él el **régimen
fiscal** del presupuesto mediante una función de **dominio pura**
(`regimenDesdeMetodoPago`) con la regla del Excel del tenant:
**`transferencia ⇒ CON IVA`** y **`efectivo ⇒ SIN IVA`**. La regla se modela
como estructura de datos declarativa (mapa), **no** como condicionales
dispersos. Tanto el `metodoPago` elegido como el `regimenIva` derivado SE
PERSISTEN en `Presupuesto` (campos nuevos, migración Prisma **aditiva y no
destructiva**: nullable + backfill de los presupuestos existentes a
`metodoPago = 'transferencia'` / `regimenIva = 'con_iva'`). El `tenant_id`
DERIVA del JWT; el `metodoPago` viaja en el body del request, nunca el régimen
(que es una consecuencia calculada, no una entrada). El régimen determina la
**variante del PDF** (capability `documentos`) y la **secuencia de numeración**.
(Fuente: `US-014`/UC-14; Excel hoja "PRESSUPOST SENSE IVA"; `design.md` D1;
`CLAUDE.md §Máquina de estados` reglas como datos, `§Multi-tenancy`.)

#### Scenario: Transferencia genera régimen CON IVA

- **GIVEN** una reserva válida para generar presupuesto
- **WHEN** el gestor confirma el presupuesto con `metodoPago = 'transferencia'`
- **THEN** el `Presupuesto` se persiste con `regimenIva = 'con_iva'` y
  `metodoPago = 'transferencia'`
- **AND** el PDF se emite en la variante CON IVA (con base imponible e IVA)

#### Scenario: Efectivo genera régimen SIN IVA

- **GIVEN** una reserva válida para generar presupuesto
- **WHEN** el gestor confirma el presupuesto con `metodoPago = 'efectivo'`
- **THEN** el `Presupuesto` se persiste con `regimenIva = 'sin_iva'` y
  `metodoPago = 'efectivo'`
- **AND** el PDF se emite en la variante SIN IVA (sin base imponible ni razón
  social fiscal en cabecera)

#### Scenario: El método de pago es obligatorio al generar el presupuesto

- **GIVEN** una petición de confirmar presupuesto sin `metodoPago`
- **WHEN** el sistema valida el request
- **THEN** rechaza la operación con error de validación (422/400 según contrato)
- **AND** no crea ningún PRESUPUESTO ni muta la RESERVA ni la `FECHA_BLOQUEADA`

#### Scenario: La derivación régimen←método es una función de dominio pura

- **WHEN** se inspecciona `regimenDesdeMetodoPago`
- **THEN** vive en `presupuestos/domain/`, es una arrow function sin imports de
  framework/infra, y mapea `transferencia→con_iva`, `efectivo→sin_iva` de forma
  declarativa

### Requirement: Total, IVA y reparto del presupuesto dependientes del régimen

El sistema SHALL (DEBE) calcular el **desglose fiscal** (`baseImponible`,
`ivaPorcentaje`, `ivaImporte`, `total`) y el **reparto de pago** (`senalEur`,
`liquidacionEur`, `fianzaEur`) del presupuesto **en función del régimen** derivado
del método de pago, mediante **funciones de dominio puras** (`calcularDesgloseFiscal`
y `calcularReparto`, parametrizadas por `RegimenIva`; sin `if` dispersos por la
capa de aplicación). La **base imponible** —derivada de la salida del motor de
tarifa/precio manual (que llega con IVA incluido) menos el descuento, dividida
entre 1.21— es la **MISMA** en ambos regímenes; lo que cambia es si se le suma el
IVA:

- **CON IVA** (transferencia): `total = base + IVA21`, `ivaPorcentaje = 21`,
  `ivaImporte = total − base` (comportamiento congelado de 6.1b, sin regresión).
- **SIN IVA** (efectivo): `total = base` (**importe MENOR**, sin el 21%),
  `ivaPorcentaje = 0` y `ivaImporte = 0`. Ejemplo: base 1000 → CON IVA total
  1210; SIN IVA total 1000.

El **reparto 40%/60%** se calcula sobre el **`total` del régimen** (para efectivo,
señal = 40% del total SIN IVA y liquidación = 60% del total SIN IVA). La **fiança**
(`fianzaEur`) sigue siendo el importe fijo del setting del tenant, **aparte del
total** e **igual en ambos regímenes**. El sistema NO DEBE reimplementar el motor
de tarifa (US-016): solo cambia la **derivación fiscal** a partir de su salida,
ahora dependiente del régimen. Los importes congelados se persisten en
`Presupuesto` (como hoy) y el PDF (capability `documentos`) refleja lo persistido.
Se mantiene la invariante contable a 2 decimales (`base + IVA = total` en CON IVA;
`IVA = 0`, `total = base` en SIN IVA). (Fuente: decisión del gate SDD 2026-07-14
"efectivo paga menos, sin 21%"; `design.md` §"Impacto en el cálculo fiscal por
régimen"; `presupuestos/domain/desglose-fiscal.ts` 6.1b; `CLAUDE.md
§Arquitectura` dominio puro.)

#### Scenario: CON IVA — el total suma el 21% a la base

- **GIVEN** un presupuesto cuyo motor/precio deriva una base imponible de 1000 €
- **WHEN** se confirma con `metodoPago = 'transferencia'` (régimen `con_iva`)
- **THEN** el `Presupuesto` congela `baseImponible = 1000.00`,
  `ivaPorcentaje = 21.00`, `ivaImporte = 210.00` y `total = 1210.00`

#### Scenario: SIN IVA — el total es la base, sin IVA (importe menor)

- **GIVEN** el mismo presupuesto con base imponible de 1000 €
- **WHEN** se confirma con `metodoPago = 'efectivo'` (régimen `sin_iva`)
- **THEN** el `Presupuesto` congela `baseImponible = 1000.00`,
  `ivaPorcentaje = 0.00`, `ivaImporte = 0.00` y `total = 1000.00`
- **AND** el total SIN IVA (1000) es **menor** que el total CON IVA (1210) del
  mismo presupuesto

#### Scenario: El reparto 40/60 se calcula sobre el total del régimen

- **GIVEN** un presupuesto SIN IVA con `total = 1000.00` y `pctSenal = 40`
- **WHEN** se calcula el reparto
- **THEN** `senalEur = 400.00` y `liquidacionEur = 600.00` (40/60 del total SIN
  IVA)
- **AND** la `fianzaEur` es el importe fijo del setting (p. ej. 500.00), aparte
  del total, igual que en CON IVA

#### Scenario: La derivación fiscal es una función de dominio pura por régimen

- **WHEN** se inspeccionan `calcularDesgloseFiscal` y `calcularReparto`
- **THEN** viven en `presupuestos/domain/`, reciben el `RegimenIva` como entrada,
  ramifican de forma declarativa y no importan framework/infra ni reimplementan
  el motor de tarifa

### Requirement: Migración aditiva de método de pago y régimen en Presupuesto

El sistema SHALL (DEBE) añadir a `Presupuesto`, mediante **migración Prisma no
destructiva**, los campos `metodo_pago` (enum `MetodoPago {transferencia,
efectivo}`) y `regimen_iva` (enum `RegimenIva {con_iva, sin_iva}`), ambos
inicialmente **nullable**, con **backfill** de las filas existentes a
`metodo_pago = 'transferencia'` y `regimen_iva = 'con_iva'` (en 6.1b todos los
presupuestos eran CON IVA por transferencia). La migración NO DEBE eliminar ni
alterar columnas existentes. Las columnas nuevas quedan protegidas por la RLS
**ya existente** de `presupuesto` (`tenant_isolation` por join desde la reserva;
**NO** se recrea la policy). Tras el backfill, la aplicación escribe siempre
ambos campos al crear un presupuesto (nunca `null` en filas nuevas). (Fuente:
`design.md` D1; `CLAUDE.md §Multi-tenancy`; nota 6.1b "presupuesto ya tenía
`tenant_isolation`, no recrear policy".)

#### Scenario: La migración añade los campos sin destruir datos

- **WHEN** se aplican las migraciones Prisma
- **THEN** `presupuesto` tiene `metodo_pago` y `regimen_iva`
- **AND** los presupuestos preexistentes quedan con `metodo_pago =
  'transferencia'` y `regimen_iva = 'con_iva'` (backfill), sin perder ninguna
  columna anterior

#### Scenario: Las columnas nuevas no recrean la policy RLS

- **WHEN** se revisa la migración
- **THEN** no crea una nueva `POLICY` para `presupuesto` (reutiliza
  `tenant_isolation` por join a la reserva), y `presupuesto` sigue con RLS
  habilitada

### Requirement: Numeración del presupuesto por tenant, año y régimen (doble secuencia)

El sistema SHALL (DEBE) asignar a cada presupuesto un **`numero_presupuesto`**
con formato **año + contador** (p. ej. `2026001`), con **dos secuencias
independientes por tenant y año según el régimen fiscal** (una para CON IVA y
otra para SIN IVA), de modo que **CON y SIN NO comparten contador**. Cada
secuencia tiene **reinicio anual** (el año va embebido en el número). El campo se
persiste en `Presupuesto` y su unicidad se garantiza a nivel de BD por **tenant +
régimen + número** (`@@unique([tenantId, regimenIva, numeroPresupuesto])`),
permitiendo que ambas secuencias arranquen en `AAAA001` sin colisionar. El
**cálculo** del siguiente número es una función de **dominio pura**
(`siguienteNumeroPresupuesto`, reutilizada de 6.1b, a partir del año y del último
número del tenant en ese año **para ese régimen**); la consulta `MAX`
(`ultimoNumeroDelAnio(tenantId, anio, regimen)`) y el **reintento ante colisión
`P2002`** (discriminado por `meta.target`, patrón de 6.1b) viven en infra. La
asignación ocurre en la **transacción de confirmación** del presupuesto (bajo RLS
del tenant), no en el post-commit del PDF. Los presupuestos CON IVA existentes de
6.1b (backfill `regimen_iva = 'con_iva'`) **son** la secuencia CON, que continúa
sin discontinuidad. Las **facturas** conservan su numeración `F-YYYY-NNNN` (NO se
migra en 6.2; su migración a este mecanismo es 6.3). (Fuente:
`epico-6-documentos-pdf-roadmap` 6.2 doble numeración; `design.md` D2; patrón
6.1b `siguienteNumeroPresupuesto` + reintento `P2002` por `meta.target`.)

#### Scenario: Cada régimen tiene su propia secuencia desde 001

- **GIVEN** un tenant sin presupuestos numerados en 2026
- **WHEN** confirma su primer presupuesto CON IVA (`transferencia`) y su primer
  presupuesto SIN IVA (`efectivo`) en 2026
- **THEN** el CON IVA recibe `numero_presupuesto = 2026001` (secuencia CON) y el
  SIN IVA recibe `numero_presupuesto = 2026001` (secuencia SIN)
- **AND** ambos coexisten sin colisión gracias a
  `@@unique([tenantId, regimenIva, numeroPresupuesto])`

#### Scenario: Cada secuencia se incrementa independientemente

- **GIVEN** un tenant con `2026001` CON IVA y `2026001` SIN IVA
- **WHEN** confirma otro presupuesto CON IVA en 2026
- **THEN** el nuevo CON IVA es `2026002` y la secuencia SIN IVA permanece en
  `2026001` (no se ve afectada)

#### Scenario: La secuencia CON IVA continúa la de 6.1b (reconciliación)

- **GIVEN** un tenant cuyos presupuestos de 6.1b (backfill `regimen_iva =
  'con_iva'`) llegan hasta `2026007`
- **WHEN** confirma un nuevo presupuesto CON IVA en 2026
- **THEN** `numero_presupuesto` es `2026008` (continúa la secuencia CON, sin
  reiniciar)

#### Scenario: Cada secuencia reinicia con el año

- **GIVEN** un tenant con presupuestos CON IVA hasta `2026005` y SIN IVA hasta
  `2026003`
- **WHEN** confirma en 2027 un presupuesto de cada régimen
- **THEN** el CON IVA es `2027001` y el SIN IVA es `2027001`

#### Scenario: Colisión concurrente de numeración se reintenta discriminando el P2002

- **GIVEN** dos confirmaciones concurrentes que calculan el mismo
  `numero_presupuesto` para el mismo tenant, año y régimen
- **WHEN** una gana y la otra viola
  `presupuesto_tenant_id_regimen_iva_numero_presupuesto_key` (`P2002`)
- **THEN** la perdedora **reintenta** recalculando el número (bucle acotado),
  discriminando el `P2002` por `meta.target`
- **AND** un `P2002` de la fecha D4 (`UNIQUE(tenant_id, fecha)`) NO se reintenta
  y propaga como "fecha no disponible" (409)

### Requirement: El email de presupuesto (E2) adjunta las Condicions particulars

El disparo del email de presupuesto (E2, US-014 §D-7) SHALL (DEBE) adjuntar,
además del PDF del presupuesto, el PDF de **"Condicions particulars"** del
tenant **en el idioma de la reserva** (`RESERVA.idioma`, normalizado a `'es' | 'ca'`).
El adaptador de disparo (`DispararE2Adapter`) DEBE obtener la URL del
documento de condiciones vía el puerto **`GenerarPdfCondicionesPort`** con
`{ tenantId, idioma }` (capability `documentos`) y, cuando la URL no sea `null`,
**añadir** el adjunto
`{ clave: 'condiciones', nombre: 'condicions-particulars.pdf', pdfUrl }` al array
de adjuntos del E2. El disparo es **fire-and-forget post-commit**: si el
documento de condiciones devuelve `null` post-commit (fallo transitorio — la guarda
pre-tx garantiza que la config existe), el adjunto de condiciones se **OMITE sin romper**
el despacho del E2. La **idempotencia** del E2 (índice UNIQUE parcial
`(reserva_id, codigo_email=E2)`) se mantiene. (Fuente:
`epico-6-documentos-pdf-roadmap` §6.4a Bloque B; `presupuestos` 6.1b
`DispararE2Adapter`; US-014 / UC-14 §D-7; change `condiciones-idioma-e2-firma-banner`
Mejora A+B.)

#### Scenario: E2 adjunta presupuesto y condiciones en el idioma de la reserva

- **GIVEN** un tenant con configuración de documento, una RESERVA con `idioma = 'es'`,
  un presupuesto con `pdf_url` válida y `numero_presupuesto = '2026019'`, y un cliente
  con nombre `Mercè` y apellidos `Escribano`
- **WHEN** se dispara el E2 post-commit
- **THEN** el motor de email recibe dos adjuntos: `presupuesto`
  (`P{numeroPresupuesto} {nombre} {apellidos}.pdf`, p. ej. `P2026019 Mercè Escribano.pdf`) y `condiciones` (`condicions-particulars.pdf`)
- **AND** el PDF de condiciones es el generado con `idioma = 'es'`

#### Scenario: El nombre del adjunto usa el número de presupuesto y el nombre del cliente

- **GIVEN** un presupuesto con `numero_presupuesto = '2026019'` y un cliente con
  nombre `Mercè` y apellidos `Escribano`
- **WHEN** se dispara el E2 post-commit
- **THEN** el adjunto del presupuesto tiene `nombre = 'P2026019 Mercè Escribano.pdf'`

#### Scenario: El nombre del adjunto usa fallback cuando no hay número de presupuesto

- **GIVEN** un presupuesto histórico sin `numero_presupuesto` (`null`) y un cliente con
  nombre `Mercè` y apellidos `Escribano`
- **WHEN** se dispara el E2 post-commit
- **THEN** el adjunto del presupuesto tiene `nombre = 'Presupuesto Mercè Escribano.pdf'`

#### Scenario: E2 omite condiciones si el documento devuelve null post-commit

- **GIVEN** un tenant cuyo documento de condiciones devuelve `null` (fallo transitorio post-commit)
- **WHEN** se dispara el E2 post-commit con un presupuesto válido
- **THEN** el motor de email recibe únicamente el adjunto `presupuesto`
- **AND** el despacho del E2 no falla

### Requirement: Precondición de edición — pre_reserva y presupuesto no aceptado

El sistema SHALL (DEBE) validar en el servidor, **antes** de cualquier cálculo o
mutación, que la RESERVA está en `estado = 'pre_reserva'` y que su **último**
PRESUPUESTO está en `estado ∈ {'borrador', 'enviado'}`. Si el PRESUPUESTO está en
`estado = 'aceptado'` (señal confirmada vía UC-17, RESERVA ya en
`reserva_confirmada`) o `'rechazado'`, o si la RESERVA **no** está en `pre_reserva`,
el sistema DEBE **rechazar** la operación **sin ejecutar el motor de tarifa** y **sin
crear** ninguna versión de PRESUPUESTO ni línea de `RESERVA_EXTRA`. La guarda de
origen se modela en la **máquina de estados declarativa** (no condicionales
dispersos): solo `{pre_reserva, presupuesto borrador|enviado}` es válido para la
edición. (Fuente: `US-015 §Reglas de negocio`, `§Estado inválido — PRESUPUESTO ya
aceptado`, `§Estado inválido — RESERVA fuera de pre_reserva`, `§Reglas de
Validación`; UC-15; `CLAUDE.md §Máquina de estados`.)

#### Scenario: PRESUPUESTO aceptado no puede editarse

- **GIVEN** una RESERVA cuyo último PRESUPUESTO está en `estado = 'aceptado'`
  (señal confirmada, RESERVA en `reserva_confirmada`)
- **WHEN** el gestor intenta editar el presupuesto
- **THEN** el sistema rechaza la operación con "El presupuesto está aceptado y no
  puede modificarse"
- **AND** no ejecuta el motor de tarifa ni crea una nueva versión de PRESUPUESTO

#### Scenario: RESERVA fuera de pre_reserva no permite editar

- **GIVEN** una RESERVA en `estado = 'consulta'` (`sub_estado = '2b'`)
- **WHEN** se intenta acceder a la edición de presupuesto vía UC-15
- **THEN** el sistema rechaza la operación sin efectos
- **AND** no crea ninguna versión de PRESUPUESTO ni línea de `RESERVA_EXTRA`

### Requirement: Recálculo del borrador de edición sin persistir

El sistema SHALL (DEBE) exponer un **preview de edición** que recalcula el borrador
del presupuesto con los cambios propuestos (`num_adultos_ninos_mayores4`,
`duracion_horas`, líneas de `RESERVA_EXTRA`, `descuento_eur`) **delegando en el motor
de tarifa** (US-016) cuando cambian invitados o duración, y derivando el desglose
fiscal (`base_imponible`, `iva_importe`, `total`) y el reparto con las **funciones de
dominio puras existentes** (`calcularDesgloseFiscal`, `calcularReparto`), según el
régimen del presupuesto. Durante el preview el sistema NO DEBE crear ninguna versión
de PRESUPUESTO, NO DEBE crear/modificar/eliminar filas de `RESERVA_EXTRA`, NO DEBE
mutar `RESERVA.estado`/`ttl_expiracion` ni la `FECHA_BLOQUEADA`, y NO DEBE enviar
ningún email. (Fuente: `US-015 §Reglas de negocio` borrador guardado, `§Cambio de nº
invitados`; UC-15/UC-16; patrón preview de US-014.)

#### Scenario: El preview de edición recalcula sin persistir

- **GIVEN** una RESERVA en `pre_reserva` con PRESUPUESTO `version = 1` (`total =
  3.200 €`)
- **WHEN** el gestor previsualiza un descuento de 200 € sin confirmar
- **THEN** el sistema devuelve el nuevo desglose (`total = 3.000 €`) delegando el
  cálculo en las funciones de dominio del régimen
- **AND** no existe una nueva fila de PRESUPUESTO ni cambia ninguna `RESERVA_EXTRA`,
  y `FECHA_BLOQUEADA` no se modifica

#### Scenario: Cambio de invitados delega en el motor de tarifa

- **GIVEN** un PRESUPUESTO `version = 1` calculado con 40 invitados (tramo 31–50)
- **WHEN** el gestor previsualiza `num_adultos_ninos_mayores4 = 25` (tramo 21–30)
- **THEN** el motor UC-16 recalcula con los nuevos parámetros y el preview refleja el
  nuevo `precio_tarifa_eur` del tramo 21–30
- **AND** no se persiste ninguna versión ni se muta la RESERVA

### Requirement: Nueva versión del PRESUPUESTO al confirmar la edición

El sistema SHALL (DEBE), al confirmar la edición, crear en **una transacción** un
PRESUPUESTO nuevo con `version = versión_anterior + 1`, `tarifa_congelada = true`,
`iva_porcentaje` según régimen (21% CON IVA / 0% SIN IVA), y el desglose fiscal
congelado (`base_imponible`, `iva_importe`, `total`, `descuento_eur`/
`descuento_motivo` si aplica) recalculado del motor de tarifa (o del precio manual
del caso `tarifa_a_consultar`). El PRESUPUESTO **anterior persiste como historial**
(no se borra ni se sobrescribe). La unicidad `(reservaId, version)` garantiza la
secuencia. Una vez congelada la nueva versión, un cambio posterior del tarifario NO
la recalcula. (Fuente: `US-015 §Happy Path`, `§Reglas de negocio` nueva versión;
UC-15; `er-diagram §3.11 PRESUPUESTO`; congelado de US-014.)

#### Scenario: Confirmar edición crea version=2 y conserva la version=1

- **GIVEN** una RESERVA en `pre_reserva` con PRESUPUESTO `version = 1` en `enviado`
  (`total = 3.200 €`, sin descuento)
- **WHEN** el gestor aplica `descuento_eur = 200`, confirma la edición y envía
- **THEN** se crea PRESUPUESTO `version = 2` con `total = 3.000 €`,
  `tarifa_congelada = true`, `estado = 'enviado'`
- **AND** el PRESUPUESTO `version = 1` persiste en la BD como historial (no eliminado)

#### Scenario: Recálculo de invitados congela la nueva versión

- **GIVEN** un PRESUPUESTO `version = 1` de 40 invitados
- **WHEN** el gestor cambia a 25 invitados y confirma
- **THEN** se crea PRESUPUESTO `version = 2` con el precio del tramo 21–30 congelado
- **AND** el `version = 1` se conserva como historial

### Requirement: Precio congelado de las líneas RESERVA_EXTRA al añadirlas

El sistema SHALL (DEBE), al añadir una línea de `RESERVA_EXTRA` en la edición,
**congelar** su `precio_unitario` con el precio **actual** del EXTRA del catálogo en
ese momento y fijar `subtotal = precio_unitario × cantidad`. Una línea `RESERVA_EXTRA`
**ya existente** conserva su `precio_unitario` congelado **aunque** el precio del
EXTRA del catálogo cambie después; solo las líneas **nuevas** de la edición toman el
precio actual. Cada línea persiste con `origen` (`anadido_post_confirmacion` para las
añadidas tras activar la pre_reserva) y `factura_id = null`. Modificar la cantidad de
una línea existente recalcula su `subtotal` **sin** cambiar su `precio_unitario`
congelado; eliminar una línea la retira del total de la nueva versión. (Fuente:
`US-015 §Reglas de negocio` precio congelado, `§Añadir extra`, `§Eliminar extra`;
UC-15; `er-diagram §RESERVA_EXTRA` `precio_unitario`/`origen`/`factura_id`.)

#### Scenario: Añadir un extra congela su precio actual

- **GIVEN** una RESERVA en `pre_reserva` y el EXTRA "barbacoa" a `precio_eur = 250 €`
- **WHEN** el gestor añade 1 unidad de "barbacoa" y confirma
- **THEN** se crea `RESERVA_EXTRA` con `precio_unitario = 250`, `subtotal = 250`,
  `origen = 'anadido_post_confirmacion'`, `factura_id = null` y el total crece 250 €

#### Scenario: El precio congelado no se recalcula si cambia el catálogo

- **GIVEN** una línea "barbacoa" congelada a `precio_unitario = 250` y el catálogo de
  "barbacoa" cambiado luego a 300 €
- **WHEN** el gestor edita otro campo (p. ej. el descuento) y confirma
- **THEN** la línea "barbacoa" existente conserva `precio_unitario = 250`
- **AND** solo una línea **nueva** añadida en esta edición tomaría el precio actual
  (300 €)

#### Scenario: Eliminar un extra lo retira del total de la nueva versión

- **GIVEN** un PRESUPUESTO con una `RESERVA_EXTRA` "paellero" de `subtotal = 400 €`
- **WHEN** el gestor elimina esa línea y confirma la edición
- **THEN** la nueva versión del PRESUPUESTO no incluye los 400 € y la línea queda
  eliminada (o inactiva) sin afectar a versiones históricas

### Requirement: Precio manual cuando el cambio de invitados supera el tramo de tarifa

El sistema SHALL (DEBE), cuando el cambio de `num_adultos_ninos_mayores4` (p. ej. a
>50) hace que el motor devuelva `tarifa_a_consultar = true` con importes a `null`,
**habilitar un campo de precio total manual** en el borrador de edición y **esperar**
a que el Gestor introduzca el precio antes de permitir confirmar la nueva versión. Al
confirmar, el `total` de la nueva versión DEBE ser el precio manual introducido. El
flujo **no se bloquea** por la ausencia de tarifa para el tramo +50. (Fuente:
`US-015 §Cambio de invitados a >50 — tarifa a consultar`, `§Supuestos`,
`§Reglas de Validación`; UC-15/UC-16; patrón precio manual de US-014.)

#### Scenario: 55 invitados habilita precio manual en la edición

- **GIVEN** una edición con `num_adultos_ninos_mayores4 = 55`
- **WHEN** el gestor recalcula el borrador
- **THEN** el motor devuelve `tarifa_a_consultar = true` con importes a `null` y el
  sistema habilita un campo de precio total manual
- **AND** al introducir el precio y confirmar, el `total` de la nueva versión es el
  precio manual introducido

#### Scenario: Sin precio manual no se puede confirmar la edición a consultar

- **GIVEN** un borrador de edición con `tarifa_a_consultar = true` y sin precio manual
- **WHEN** el gestor intenta confirmar
- **THEN** el sistema no permite crear la nueva versión hasta que se introduzca el
  precio total manual

### Requirement: Envío explícito de la edición registra COMUNICACION E2 y AUDIT_LOG

El sistema SHALL (DEBE), cuando el Gestor confirma la edición **con envío explícito**,
regenerar el PDF de la nueva versión y **enviar realmente** el email **E2** invocando el
proveedor de correo a través del camino de reenvío del motor
(`DespacharEmailService.despacharReenvio`), que **salta la idempotencia** — no como el
camino `despachar`, que al encontrar el E2 original (`es_reenvio = false`) por el índice
UNIQUE parcial `(reserva_id, codigo_email) WHERE es_reenvio = false` devolvía
`motivo = 'idempotente'` y **nunca invocaba al proveedor**. El envío DEBE persistir **una
única** `COMUNICACION` con `codigo_email = 'E2'`, `es_reenvio = true` y
`estado ∈ {'enviado', 'fallido'}` según el resultado real del proveedor (fuente única =
el motor post-commit; NO se registra además una fila "contable" duplicada dentro de la
transacción). El sistema DEBE fijar `PRESUPUESTO.estado = 'enviado'` en la nueva versión
y registrar en `AUDIT_LOG` con `accion = 'actualizar'` referenciando el nuevo
`id_presupuesto`. El envío es **best-effort post-commit**: un fallo del proveedor deja la
`COMUNICACION` en `estado = 'fallido'` y **NO** revierte la versión ya creada ni el
`AUDIT_LOG`. (Fuente: `US-015 §Happy Path`, `§Reglas de negocio` envío explícito; UC-15;
US-045 motor de email; `er-diagram §COMUNICACION`, `§AUDIT_LOG`; patrón `es_reenvio` de
US-028/US-023.)

#### Scenario: Confirmar con envío invoca al proveedor y registra una única COMUNICACION E2

- **GIVEN** una RESERVA en `pre_reserva` con PRESUPUESTO `version = 1` en `enviado`
  (ya existe la `COMUNICACION` E2 original con `es_reenvio = false`)
- **WHEN** el gestor confirma una edición y la envía
- **THEN** el proveedor de email se invoca realmente (transporte ejecutado) y NO se
  cortocircuita por idempotencia
- **AND** se registra **exactamente una** nueva `COMUNICACION` con `codigo_email = 'E2'`,
  `es_reenvio = true` y `estado = 'enviado'` (sin fila contable duplicada en la
  transacción)
- **AND** `PRESUPUESTO version = 2` queda en `estado = 'enviado'` y se registra un
  `AUDIT_LOG` con `accion = 'actualizar'` que referencia el nuevo `id_presupuesto`

#### Scenario: Fallo del proveedor no revierte la versión (best-effort post-commit)

- **GIVEN** una edición confirmada que crea PRESUPUESTO `version = 2`
- **WHEN** el envío post-commit del E2 falla en el proveedor
- **THEN** la `COMUNICACION` E2 queda en `estado = 'fallido'` (`es_reenvio = true`)
- **AND** `PRESUPUESTO version = 2` y el `AUDIT_LOG` `actualizar` persisten (no se
  revierten) y la versión puede reenviarse después

### Requirement: Guardar la edición como borrador sin enviar

El sistema SHALL (DEBE) permitir **guardar la edición sin enviar**: crea la nueva
versión de PRESUPUESTO con `estado = 'borrador'` y NO registra `COMUNICACION` ni
dispara email; el cliente no recibe nada. El borrador queda disponible para enviarlo
más tarde desde la ficha de pre_reserva. (Fuente: `US-015 §Guardar borrador sin
enviar`, `§Reglas de negocio` borrador guardado; UC-15.)

#### Scenario: Guardar borrador crea versión en borrador sin email

- **GIVEN** una RESERVA en `pre_reserva` con PRESUPUESTO `version = 1`
- **WHEN** el gestor modifica el descuento y **guarda sin enviar**
- **THEN** se crea PRESUPUESTO `version = 2` con `estado = 'borrador'`
- **AND** no se registra `COMUNICACION`, no se envía email y el gestor puede enviarlo
  más tarde

### Requirement: Reenvío sin cambios de la versión vigente

El sistema SHALL (DEBE), cuando el Gestor confirma el envío **sin modificar ningún
campo**, **NO** crear una versión nueva: reenvía el PDF de la versión vigente **enviando
realmente** el email E2 a través de `DespacharEmailService.despacharReenvio` (el
adaptador de reenvío NO debe ser un no-op / stub que omita el transporte), registra **una
única** nueva `COMUNICACION` E2 (`es_reenvio = true`, `estado ∈ {'enviado', 'fallido'}`
según el proveedor) y un `AUDIT_LOG`, y deja la versión vigente en `estado = 'enviado'`.
No se crea ni modifica ninguna `RESERVA_EXTRA` ni se recalcula el desglose. El reenvío
sin cambios usa el texto **E2 estándar** (no la marca de edición). (Fuente: `US-015 §Sin
cambios — reenvío de versión existente`; UC-15; US-045 motor de email; patrón reenvío de
US-023/US-028.)

#### Scenario: Reenvío sin cambios invoca al proveedor y no crea versión nueva

- **GIVEN** una RESERVA en `pre_reserva` con PRESUPUESTO `version = 2` en `enviado`
- **WHEN** el gestor abre el presupuesto, no modifica nada y confirma el envío
- **THEN** el proveedor de email se invoca realmente (transporte ejecutado) — el envío
  NO es un no-op
- **AND** no se crea una versión nueva; se reenvía el PDF de la `version = 2`
- **AND** se registra **una única** `COMUNICACION` E2 (`es_reenvio = true`,
  `estado = 'enviado'`) con el asunto/cuerpo estándar de E2 y un `AUDIT_LOG`, y la
  versión sigue en `estado = 'enviado'`

### Requirement: La edición no muta el estado de la RESERVA ni el bloqueo de fecha

El sistema SHALL (DEBE) garantizar que ninguna operación de esta historia (preview,
guardar borrador, confirmar con envío, reenvío) **modifica** `RESERVA.estado`
(permanece `pre_reserva`) ni `FECHA_BLOQUEADA.ttl_expiracion` (UC-15 **no extiende**
el bloqueo). La edición NO toca el bloqueo atómico de fecha (no inserta ni modifica
`FECHA_BLOQUEADA`); no hay carrera D4 en esta historia. La validación
`descuento_eur ≥ 0` y `≤ base_imponible` (total nunca negativo) y `duracion_horas ∈
{4,8,12}` se aplican en el servidor. (Fuente: `US-015 §Reglas de negocio` sin
extensión del bloqueo, `§Concurrencia / Race Conditions`, `§Reglas de Validación`;
UC-15; `CLAUDE.md §Regla crítica: bloqueo atómico de fecha`.)

#### Scenario: La edición conserva pre_reserva y el TTL del bloqueo

- **GIVEN** una RESERVA en `pre_reserva` con `FECHA_BLOQUEADA.ttl_expiracion = T`
- **WHEN** el gestor confirma una edición y la envía
- **THEN** `RESERVA.estado` permanece `pre_reserva`
- **AND** `FECHA_BLOQUEADA.ttl_expiracion` sigue siendo `T` (no se extiende ni se
  modifica)

#### Scenario: El descuento no puede superar la base imponible

- **GIVEN** una edición con `base_imponible` calculada
- **WHEN** el gestor introduce un `descuento_eur` mayor que la `base_imponible`
- **THEN** el sistema rechaza la operación con error de validación
- **AND** no crea ninguna nueva versión de PRESUPUESTO

### Requirement: "Generar presupuesto" requiere completitud de datos (fecha, invitados, duración, hora de inicio)

El sistema SHALL (DEBE), además de la guarda de origen por estado/sub-estado ya existente
(`estado='consulta'`, `subEstado ∈ {2a,2b,2c,2v}`, sin PRESUPUESTO `enviado`/`aceptado`
previo), **NO ofrecer ni habilitar** en la ficha la acción "Generar presupuesto" hasta que
la RESERVA tenga presentes **todos** estos datos mínimos: `fechaEvento` (no nula),
`numAdultosNinosMayores4` (≥ 1), `duracionHoras` (∈ {4, 8, 12}) y `horario` (`HH:MM`). Si
falta cualquiera, el botón DEBE quedar **deshabilitado** y la ficha DEBE **enumerar los
campos que faltan** y sugerir "Editar consulta" (que abre la edición de datos de la
RESERVA, US-051 §Punto 2). Esta es una guarda de **UI** que evita ofrecer un botón que el
servidor rechazaría; NO sustituye la validación de servidor: el backend sigue revalidando
la completitud (y los datos fiscales del CLIENTE) de forma defensiva antes de delegar en el
motor de tarifa. Los datos fiscales del CLIENTE **no** forman parte de este gate de UI (se
resuelven con el flujo de datos fiscales existente). (Fuente: `US-051 §Punto 3`; UC-14;
spec viva `presupuestos` "Validación síncrona de completitud de datos y datos fiscales
antes del cálculo".)

#### Scenario: Faltan datos → botón deshabilitado con la lista de lo que falta

- **GIVEN** una RESERVA en `2b` con `fechaEvento` definida y `numAdultosNinosMayores4=30`,
  pero sin `duracionHoras` ni `horario`
- **WHEN** el gestor abre la ficha
- **THEN** el botón "Generar presupuesto" aparece **deshabilitado**
- **AND** la ficha enumera que faltan la duración y la hora de inicio
- **AND** sugiere "Editar consulta" para completarlos

#### Scenario: Datos completos → el botón se ofrece habilitado

- **GIVEN** una RESERVA en `2b` con `fechaEvento`, `numAdultosNinosMayores4=30`,
  `duracionHoras=8` y `horario='11:00'`
- **WHEN** el gestor abre la ficha
- **THEN** el botón "Generar presupuesto" aparece **habilitado**

#### Scenario: Falta la hora de inicio → el botón queda deshabilitado

- **GIVEN** una RESERVA en `2b` con `fechaEvento`, `numAdultosNinosMayores4=30` y
  `duracionHoras=8`, pero **sin** `horario`
- **WHEN** el gestor abre la ficha
- **THEN** el botón "Generar presupuesto" aparece deshabilitado y la ficha indica que falta
  la hora de inicio

#### Scenario: La guarda de UI no reemplaza la validación de servidor

- **GIVEN** una RESERVA con todos los datos de evento completos pero con datos fiscales del
  CLIENTE incompletos
- **WHEN** el gestor pulsa "Generar presupuesto" (habilitado por el gate de UI)
- **THEN** el servidor revalida y rechaza enumerando los campos fiscales faltantes, sin
  crear PRESUPUESTO (comportamiento de la spec viva "Validación síncrona…" intacto)

### Requirement: Marca de edición en el email E2 (asunto y párrafo, ES/CA)

El sistema SHALL (DEBE) permitir que la plantilla **E2** reciba una variable `esEdicion`
(booleana, **derivada en servidor**, default `false`; NO entra por el contrato ni por el
body) y, cuando sea `true` (envío disparado por una **edición** del presupuesto),
renderizar la variante "presupuesto actualizado":

- **Asunto (ES)**: «Hemos actualizado tu presupuesto para el evento (reserva
  {codigoReserva})».
- **Asunto (CA)**: «Hem actualitzat el teu pressupost per a l'esdeveniment (reserva
  {codigoReserva})».
- **Párrafo inicial** insertado inmediatamente tras el saludo «Hola {nombre},» (ES):
  «Hemos actualizado el presupuesto que te enviamos con los cambios solicitados. Te
  adjuntamos la versión revisada.»; **CA** equivalente: «Hem actualitzat el pressupost
  que et vam enviar amb els canvis sol·licitats. T'adjuntem la versió revisada.».

El resto del texto de marca del tenant (pago anticipado del 40%, transferencia con
destinatario "Canoliart, SL" y concepto "Masia l'Encís", condiciones particulares a
firmar, firma "Ari — Masia l'Encís") se mantiene **idéntico** al E2 estándar. Cuando
`esEdicion` es `false` o está ausente (envío original de US-014 o reenvío sin cambios),
la plantilla E2 renderiza el **texto estándar** sin cambios. `variablesRequeridas` de E2
y E2-CA permanece `['nombre', 'codigoReserva']` (`esEdicion` NO es requerida). (Fuente:
`US-015 §Email relacionado`; UC-15; US-014/US-045 plantilla E2 `renderE2`/`renderE2Ca`;
`catalogo-plantillas.ts`.)

#### Scenario: Edición renderiza asunto y párrafo de "presupuesto actualizado" (ES)

- **GIVEN** un envío E2 en español con `esEdicion = true`, `nombre = 'Marta'`,
  `codigoReserva = '26-0001'`
- **WHEN** se renderiza la plantilla E2
- **THEN** el asunto es «Hemos actualizado tu presupuesto para el evento (reserva 26-0001)»
- **AND** tras el saludo «Hola Marta,» aparece el párrafo «Hemos actualizado el
  presupuesto que te enviamos con los cambios solicitados. Te adjuntamos la versión
  revisada.»
- **AND** el resto del texto de marca (pago 40%, transferencia Canoliart, firma Ari) se
  mantiene sin cambios

#### Scenario: Edición renderiza la marca de edición en catalán (CA)

- **GIVEN** un envío E2 en catalán con `esEdicion = true` y `codigoReserva = '26-0001'`
- **WHEN** se renderiza la plantilla E2-CA
- **THEN** el asunto es «Hem actualitzat el teu pressupost per a l'esdeveniment (reserva
  26-0001)»
- **AND** tras el saludo aparece el párrafo «Hem actualitzat el pressupost que et vam
  enviar amb els canvis sol·licitats. T'adjuntem la versió revisada.»

#### Scenario: Sin marca de edición se conserva el E2 estándar

- **GIVEN** un envío E2 con `esEdicion = false` o ausente (envío original / reenvío sin
  cambios)
- **WHEN** se renderiza la plantilla E2
- **THEN** el asunto es «Tu presupuesto para el evento (reserva {codigoReserva})» (o su
  variante CA) y NO se inserta el párrafo de "presupuesto actualizado"
- **AND** `variablesRequeridas` sigue siendo `['nombre', 'codigoReserva']`

### Requirement: Confirmar presupuesto requiere condicions particulars configuradas

El sistema SHALL (DEBE) verificar que el tenant tiene condicions particulars configuradas
**antes** de iniciar la transacción de BD al confirmar el presupuesto (`confirmar()` en
`GenerarPresupuestoUseCase`). Si `generarCondicionesPort.generar({ tenantId, idioma })`
devuelve `null` (tenant sin config o sin secciones), el sistema SHALL (DEBE) rechazar la
operación con error `CondicionesNoConfiguradasError` (HTTP 409 `CONDICIONES_NO_CONFIGURADAS`)
sin crear PRESUPUESTO ni transicionar la RESERVA.

La guarda pre-tx MUST (DEBE) ser solo un check de existencia (presencia de config y
secciones), no una generación definitiva del PDF: la generación real (render + subida)
ocurre post-commit en `DispararE2Adapter`.

#### Scenario: Confirmar presupuesto sin condicions configuradas falla con 409

- **GIVEN** un tenant sin condicions particulars configuradas (o con secciones vacías) y
  una RESERVA en estado origen válido
- **WHEN** el gestor intenta confirmar el presupuesto
- **THEN** el sistema responde 409 `CONDICIONES_NO_CONFIGURADAS`
- **AND** no se crea ningún PRESUPUESTO
- **AND** la RESERVA permanece en su estado original
- **AND** `cond_part_enviadas_fecha` sigue siendo NULL

#### Scenario: La guarda pre-tx no genera el PDF en el almacén

- **GIVEN** un tenant con condicions configuradas
- **WHEN** el sistema ejecuta la guarda pre-tx
- **THEN** solo verifica la existencia de config y secciones sin subir ningún PDF al almacén

---

### Requirement: Confirmar presupuesto fija cond_part_enviadas_fecha en la transacción

El sistema SHALL (DEBE) fijar `RESERVA.cond_part_enviadas_fecha = now()` y
`RESERVA.cond_part_firmadas = false` dentro de la transacción de `confirmar()` (misma
unidad de trabajo que crea el PRESUPUESTO y transiciona la RESERVA a `pre_reserva`). La
respuesta de `confirmar` MUST (DEBE) incluir `condPartFechaEnvio` (timestamp del envío
de condiciones) para que el frontend refleje inmediatamente que las condicions fueron
enviadas.

#### Scenario: Confirmar presupuesto con condicions configuradas fija cond_part_enviadas_fecha

- **GIVEN** un tenant con condicions configuradas y una RESERVA en estado origen válido
- **WHEN** el gestor confirma el presupuesto
- **THEN** el sistema crea el PRESUPUESTO, transiciona la RESERVA a `pre_reserva`
- **AND** `RESERVA.cond_part_enviadas_fecha` queda fijado con el timestamp de la operación
- **AND** `RESERVA.cond_part_firmadas = false`
- **AND** el E2 se dispara post-commit con el PDF de condicions en el idioma de la reserva

#### Scenario: cond_part_enviadas_fecha ya está fijado cuando llega E3

- **GIVEN** una RESERVA cuyo presupuesto ya fue confirmado (cond_part_enviadas_fecha fijado)
- **WHEN** el gestor envía la factura de señal (E3)
- **THEN** E3 no modifica `cond_part_enviadas_fecha`
- **AND** la tarjeta de firma de condicions en la ficha muestra estado "pendiente de firma"

### Requirement: Presupuesto de modificación tras confirmar (pago inicial fijo + liquidación restante)

El sistema SHALL (DEBE), cuando se recalcula el precio de una RESERVA dentro de la ventana viva
por un cambio de aforo o duración, crear una **nueva versión de PRESUPUESTO** (`version =
MAX(version) + 1`, fila inmutable; las versiones anteriores persisten como historial) marcada
como presupuesto **de modificación** y **reenviarla** al cliente (registro de la COMUNICACION de
reenvío + PDF), en la misma transacción del recálculo. El nuevo TOTAL se calcula con
`CalculadoraTarifaService` (temporada × duración × tramo por `numAdultosNinosMayores4` + extras
VIGENTES de RESERVA_EXTRA con `factura_id IS NULL`). A diferencia del presupuesto de
`pre_reserva`, el presupuesto de modificación **NO** reparte el nuevo total en 40 %/60 %: expone
dos importes: **"Pago inicial ya realizado"** = `RESERVA.importe_senal` congelado (importe FIJO,
NO recalculado sobre el nuevo total) y **"Liquidación restante"** = `nuevo_total −
importe_senal`. El caso `> 50` invitados o sin TARIFA configurada resuelve a
**`tarifa_a_consultar`** con TOTAL manual (mismo fallback del flujo de presupuesto), en cuyo caso
el restante se deriva del total manual introducido. El versionado usa el reintento acotado ante
`P2002` sobre `@@unique([reservaId, version])` (sin locks distribuidos). (Fuente: petición de
usuario; `US-015` versionado + reenvío; `US-016` `tarifa_a_consultar`; `editar-presupuesto.
use-case.ts`; `er-diagram.md §PRESUPUESTO`.)

#### Scenario: Aumentar invitados genera un presupuesto de modificación con restante actualizado

- **GIVEN** una RESERVA en la ventana viva con `importe_total = 3000,00`, `importe_senal =
  1200,00` (fijo) e `importe_liquidacion = 1800,00`, y una tarifa configurada
- **WHEN** el Gestor sube el aforo y el nuevo total calculado es `3600,00`
- **THEN** el sistema crea una nueva versión de PRESUPUESTO de modificación con total `3600,00`
- **AND** el presupuesto muestra "Pago inicial ya realizado" = `1200,00` (sin recalcular el
  40 %) y "Liquidación restante" = `2400,00` (= `3600,00 − 1200,00`)
- **AND** reenvía el presupuesto de modificación al cliente

#### Scenario: Reducir la duración baja el total y el restante

- **GIVEN** una RESERVA en la ventana viva con `importe_total = 3600,00` e `importe_senal =
  1200,00`
- **WHEN** el Gestor reduce `duracionHoras` y el nuevo total calculado es `3000,00`
- **THEN** la nueva versión de PRESUPUESTO muestra "Pago inicial ya realizado" = `1200,00` y
  "Liquidación restante" = `1800,00`

#### Scenario: Más de 50 invitados resuelve a tarifa a consultar con total manual

- **GIVEN** una RESERVA en la ventana viva
- **WHEN** el Gestor sube `numAdultosNinosMayores4` a `60` (> 50)
- **THEN** el motor de tarifa devuelve `tarifa_a_consultar` y el sistema exige un TOTAL manual
- **AND** con el total manual introducido, el restante = `total_manual − importe_senal` y se
  genera el presupuesto de modificación

#### Scenario: La señal NO se recalcula sobre el nuevo total

- **GIVEN** una RESERVA con `importe_senal = 1200,00` (40 % de un total original de `3000,00`)
- **WHEN** el nuevo total pasa a `3600,00`
- **THEN** "Pago inicial ya realizado" sigue siendo `1200,00` (NO se recalcula como 40 % de
  `3600,00`)


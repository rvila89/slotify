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
datos del tenant y de la reserva, sin valores de negocio hardcodeados:

- **Cabecera**: logo si `logoUrl` no es nulo (si no, solo-texto), razón social
  fiscal, NIF, dirección fiscal, email y web (de `identidadFiscal`).
- **Dades client** (del cliente de la reserva): nombre y apellidos, DNI/NIF,
  dirección, CP + población, provincia.
- **PRESSUPOST + número + Data**.
- **CONCEPTE/PREU**: el texto de `textos.plantillaConceptoFiscal` con el
  placeholder `{nombreComercial}` resuelto (expresa "espai", **nunca** "lloguer");
  debajo, la fecha del evento, la **duración** (enum `DuracionHoras` 4/8/12 →
  "(N hores)"; ver `design.md` N5 sobre el rango horario), el nº de personas
  (`num_adultos_ninos_mayores4`), y los **extras** de la reserva como
  sub-conceptos con su precio.
- **Validesa** (`textos.validesaTexto`, p. ej. "10 DIES") | Base imp. | % IVA |
  Total.
- **Condicions**: 40% pago anticipado / 60% import restant / fiança "A l'arribada"
  (del desglose/reparto del presupuesto).
- **Pie bancario**: instrucciones de pago + IBAN (de `banca`).

(Fuente: Excel hoja "PRESSUPOST IVA"; `documentos` 6.1a `ConfiguracionDocumentoTenant`;
regla del épico "concepto nunca lloguer".)

#### Scenario: El concepto fiscal usa la plantilla del tenant y nunca "lloguer"

- **GIVEN** una config con `plantillaConceptoFiscal = "Gestió de l'ús espai de
  {nombreComercial} per esdeveniment"` y `nombreComercial = "Masia l'Encís"`
- **WHEN** se renderiza el concepto del PDF
- **THEN** aparece "Gestió de l'ús espai de Masia l'Encís per esdeveniment"
- **AND** el documento no contiene la palabra "lloguer"

#### Scenario: Los extras aparecen como sub-conceptos con precio

- **GIVEN** una reserva con extras (p. ej. "Neteja" a 100 €)
- **WHEN** se renderiza el PDF
- **THEN** cada extra figura como sub-concepto del bloque CONCEPTE con su precio

### Requirement: Numeración del presupuesto CON IVA por tenant y año

El sistema SHALL (DEBE) asignar a cada presupuesto CON IVA un
**`numero_presupuesto`** con formato **año + contador** (p. ej. `2026001`),
**único por tenant** y con **reinicio anual** (el año va embebido en el número).
El campo se persiste en `Presupuesto` (**migración Prisma** no destructiva) y su
unicidad se garantiza a nivel de BD por tenant + número. El **cálculo** del
siguiente número es una función de **dominio pura** que reutiliza el patrón de
`facturacion/domain/numeracion-factura.ts` (a partir del año y del último número
del tenant en ese año), y la asignación ocurre en la **transacción de
confirmación** del presupuesto (bajo RLS del tenant), no en el post-commit del
PDF. En 6.1b existe **una única** secuencia (solo CON IVA); 6.2 la generaliza a
dos. (Fuente: `epico-6-documentos-pdf-roadmap` 6.1b numeración; patrón US-022
§D-3; `design.md` cuestiones abiertas N1/N2.)

#### Scenario: El primer presupuesto del tenant en el año recibe el contador inicial

- **GIVEN** un tenant sin presupuestos numerados en 2026
- **WHEN** se confirma su primer presupuesto CON IVA en 2026
- **THEN** `numero_presupuesto` es `2026001` (año 2026 + contador 001)

#### Scenario: El contador es único por tenant y se incrementa

- **GIVEN** un tenant con un presupuesto `2026001`
- **WHEN** se confirma otro presupuesto CON IVA para el mismo tenant en 2026
- **THEN** `numero_presupuesto` es `2026002`
- **AND** un intento concurrente de asignar el mismo número falla por la
  unicidad `(tenant, numero_presupuesto)` en BD

#### Scenario: El número reinicia con el año

- **GIVEN** un tenant con presupuestos hasta `2026007`
- **WHEN** se confirma su primer presupuesto CON IVA en 2027
- **THEN** `numero_presupuesto` es `2027001`


# Spec Delta — Capability `consultas`

> Este change ajusta el **comportamiento de email de la transición de fecha** (US-005):
> el correo E1 pasa de **auto-enviarse con texto hardcodeado** a quedar en **`borrador`**
> con **redacción dinámica** para revisión manual del gestor (flujo de US-046), y la
> rama de **cola** (`2.d`) pasa a generar también su borrador. Reemplaza el requisito
> "Email de confirmación de bloqueo provisional vía el motor de US-045" y añade los
> requisitos de las plantillas dinámicas y del placeholder.
> Fuente: US-005 §Email relacionado; US-046 (revisión/envío de borradores); UC-04;
> catálogo §9.3 E1; plan aprobado `email-transicion-fecha-borrador`.

## MODIFIED Requirements

### Requirement: Email de confirmación de bloqueo provisional vía el motor de US-045

El sistema SHALL (DEBE), tras una transición exitosa `2.a → 2.b` (fecha libre), registrar
una `COMUNICACION` E1 dirigida al cliente **en estado `borrador`** con la plantilla de
transición "fecha disponible" (asunto y cuerpo renderizados dinámicamente, ver
"Plantillas dinámicas de la transición de fecha") y **NO enviarla automáticamente**: el
correo queda pendiente de **revisión y envío manual por el gestor** mediante el flujo ya
existente de US-046 (`GET /reservas/:id/comunicaciones` → *"Revisar y enviar borrador"*
→ `POST /reservas/:id/comunicaciones/.../enviar`). La `COMUNICACION` se crea en la
**misma transacción** que la mutación de la RESERVA y el bloqueo (atomicidad), con
`codigo_email = 'E1'`, `estado = 'borrador'` y `fecha_envio = null`; la creación es
**idempotente** (upsert por `(reserva_id, codigo_email)`) para no colisionar con un E1
de alta previo. Este email es una **extensión de E1** para el caso de actualización de
fecha y **no tiene un código `E` propio** en el catálogo §9.3 (E1–E8). El sistema **NO
invoca ningún proveedor de email** en este flujo; en consecuencia, no existe ya el envío
post-commit ni su manejo de fallo. (Fuente: `US-005 §Email relacionado`; US-046 flujo de
revisión/envío de borradores; UC-04 paso 8; catálogo §9.3 E1.)

#### Scenario: Transición a 2.b crea el borrador E1 sin enviarlo

- **GIVEN** una transición `2.a → 2.b` que se completa con su bloqueo blando
- **WHEN** el sistema registra la comunicación de la transición
- **THEN** crea una `COMUNICACION` E1 con `estado = 'borrador'` y `fecha_envio = null`
  dirigida al cliente, con el asunto y cuerpo de la plantilla "fecha disponible"
  renderizados
- **AND** NO invoca ningún proveedor de email ni cambia el estado a `enviado`
- **AND** la `COMUNICACION` queda disponible para revisión/envío manual por el flujo de
  US-046

#### Scenario: La transición a 2.d (cola) crea un borrador E1 con la plantilla "fecha bloqueada"

- **GIVEN** una RESERVA propia en `sub_estado = '2a'` y una `fecha_evento` bloqueada por
  una consulta en `2.b`, y el gestor **acepta** entrar en cola (`aceptarCola = true`)
- **WHEN** la RESERVA transiciona a `sub_estado = '2d'`
- **THEN** el sistema crea, en la **misma transacción**, una `COMUNICACION` E1 con
  `estado = 'borrador'` y `fecha_envio = null`, con el asunto y cuerpo de la plantilla
  "fecha bloqueada" renderizados
- **AND** NO invoca ningún proveedor de email

#### Scenario: El caso no encolable no crea ninguna comunicación

- **GIVEN** una RESERVA propia en `sub_estado = '2a'` y una `fecha_evento` bloqueada por
  un estado no encolable (`2.c`/`2.v`/`pre_reserva`/`reserva_confirmada` o posterior), o
  bloqueada por `2.b` sin que el gestor acepte la cola
- **WHEN** el sistema rechaza la asignación inmediata (permanece en `2.a`, HTTP 409)
- **THEN** NO crea ninguna `COMUNICACION` ni muta la RESERVA

## ADDED Requirements

### Requirement: Plantillas dinámicas de la transición de fecha (disponible / cola)

El sistema SHALL (DEBE) renderizar el asunto y el cuerpo del borrador E1 de la transición
de fecha mediante un **módulo puro y testeable** (sin importar framework ni infra),
seleccionando **una de dos plantillas** según la rama de la transición: **"fecha
disponible"** (rama libre, `2.a → 2.b`) y **"fecha bloqueada"** (rama cola, `2.a → 2.d`).
El render interpola las variables: `nombre` (nombre de pila del cliente, `Cliente.nombre`),
`fechaEvento` (formateada según el idioma, estilo *"19 de juliol de 2026"* /
*"19 de julio de 2026"*, reutilizando el formateo del catálogo de US-045), `personas`
(= `Reserva.num_invitados_final`) y `horas` (= `Reserva.duracion_horas`). La firma es
**hardcodeada** *"Ari — Masia l'Encís"* (coherente con el catálogo E1/E3 actual;
parametrizar por tenant es deuda futura). El "40 %" del pago y la solicitud de datos
fiscales son **texto fijo** de la plantilla "disponible". (Fuente: US-005 §Email
relacionado; plan aprobado; catálogo §9.3 E1.)

#### Scenario: Rama libre renderiza la plantilla "fecha disponible"

- **GIVEN** una transición `2.a → 2.b` de una RESERVA con `nombre`, `fecha_evento`,
  `num_invitados_final` y `duracion_horas` conocidos
- **WHEN** el sistema renderiza el borrador E1
- **THEN** el asunto y el cuerpo corresponden a la plantilla "fecha disponible" con el
  `nombre`, la `fechaEvento` formateada, `personas` y `horas` interpolados, y la firma
  "Ari — Masia l'Encís"

#### Scenario: Rama cola renderiza la plantilla "fecha bloqueada"

- **GIVEN** una transición `2.a → 2.d` (cola aceptada) de una RESERVA con `nombre` y
  `fecha_evento` conocidos
- **WHEN** el sistema renderiza el borrador E1
- **THEN** el asunto y el cuerpo corresponden a la plantilla "fecha bloqueada" con el
  `nombre` y la `fechaEvento` formateada interpolados, y la firma "Ari — Masia l'Encís"

### Requirement: Selección de idioma de la plantilla por `reserva.idioma`

El sistema SHALL (DEBE) elegir el idioma de la plantilla de transición según
`Reserva.idioma`: si el valor es `'ca'`, renderiza en **catalán**; para **cualquier otro
valor** (incluido `'es'`, otro código o ausencia), renderiza en **castellano**. La
selección se aplica tanto al texto fijo de la plantilla como al formateo de la fecha
(nombres de mes en el idioma correspondiente). (Fuente: US-005; plan aprobado — decisión
de idiomas catalán/castellano.)

#### Scenario: idioma 'ca' renderiza en catalán

- **GIVEN** una RESERVA con `idioma = 'ca'` en una transición de fecha
- **WHEN** el sistema renderiza el borrador E1
- **THEN** el asunto, el cuerpo y el nombre del mes de la fecha están en catalán

#### Scenario: cualquier otro idioma renderiza en castellano

- **GIVEN** una RESERVA con `idioma = 'es'` (o cualquier valor distinto de `'ca'`) en una
  transición de fecha
- **WHEN** el sistema renderiza el borrador E1
- **THEN** el asunto, el cuerpo y el nombre del mes de la fecha están en castellano

### Requirement: Placeholder visible cuando faltan personas u horas

El sistema SHALL (DEBE), cuando `personas` (`num_invitados_final`) u `horas`
(`duracion_horas`) son `null` en la RESERVA (caso posible en una consulta exploratoria
que aún no los tiene), interpolar el **placeholder visible `___`** en el lugar del dato
faltante dentro del cuerpo del borrador, de modo que el gestor lo detecte y lo complete
al revisar el borrador antes de enviarlo (flujo US-046). El resto del texto se renderiza
normalmente. (Fuente: US-005; plan aprobado — decisión de placeholder.)

#### Scenario: personas nulo produce el placeholder ___

- **GIVEN** una transición de fecha de una RESERVA con `num_invitados_final = null` y
  `duracion_horas` conocido
- **WHEN** el sistema renderiza la plantilla "fecha disponible"
- **THEN** el cuerpo contiene `___` en el lugar de `personas` y el valor real de `horas`

#### Scenario: horas nulo produce el placeholder ___

- **GIVEN** una transición de fecha de una RESERVA con `duracion_horas = null` y
  `num_invitados_final` conocido
- **WHEN** el sistema renderiza la plantilla "fecha disponible"
- **THEN** el cuerpo contiene `___` en el lugar de `horas` y el valor real de `personas`

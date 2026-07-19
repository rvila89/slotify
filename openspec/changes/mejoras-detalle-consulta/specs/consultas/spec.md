# Spec Delta — Capability `consultas`

> **mejoras-detalle-consulta** (Mejora 1 y Mejora 2) — El detalle de la ficha de la RESERVA
> deja de pintar un desglose de invitados que el alta nunca captura (una sola fila
> "Invitados") y muestra en "Comentarios" el `comentarios` del alta (persistido en columna
> propia y expuesto en `ReservaDetalle`), no el campo `notas`. NO reimplementa la máquina de
> estados, el bloqueo atómico de fecha ni la lógica de decisión del email E1.
>
> Fuente: `US-051 §Punto 1`; `DetallesEvento.tsx`; `alta-consulta.use-case.ts §comentarios`;
> `CreateReservaRequest.comentarios`; `er-diagram §3.6 RESERVA`; spec viva `consultas`
> ("Visualización completa de los detalles del evento en la ficha"); `CLAUDE.md
> §Multi-tenancy`.

## MODIFIED Requirements

### Requirement: Visualización completa de los detalles del evento en la ficha

El sistema SHALL (DEBE) mostrar en la ficha de la RESERVA los datos del evento presentes en
la entidad: `tipoEvento`, `fechaEvento`, `duracionHoras`, **el nº de invitados en una única
fila "Invitados"** (`numAdultosNinosMayores4`), hora de inicio (`horario`), visita
programada (`visitaProgramadaFecha`/`visitaProgramadaHora`) y **comentarios
(`comentarios`)**. El detalle NO DEBE mostrar filas separadas para `numNinosMenores4`
("Niños ≤ 4") ni `numInvitadosFinal` ("Nº de invitados final"): al crear una consulta solo
se captura un número de invitados (persistido en `numAdultosNinosMayores4`), de modo que
esas dos filas mostrarían siempre el placeholder de ausente y confundirían al gestor. Esos
campos **siguen existiendo** en la RESERVA, en el editor de consulta y en el cálculo de
aforo del pipeline; solo se retiran de la **vista de detalle**. La fila "Comentarios" DEBE
mostrar el valor de `comentarios` de la RESERVA (lo que el cliente indicó al pedir la
consulta), **no** el campo `notas`. Para cada campo **opcional ausente** (NULL), el sistema
DEBE mostrar un placeholder legible tipo "De momento no se dispone de esta información" en
lugar de omitir el campo. Esta visualización es de **lectura**; no muta ninguna entidad.
(Fuente: `US-051 §Punto 1`; `er-diagram §3.6 RESERVA`; `DetallesEvento.tsx`; spec viva
`consultas` "Idioma y horario opcionales en el alta de consulta".)

#### Scenario: La ficha muestra los datos del evento con una sola fila de invitados

- **GIVEN** una RESERVA con `tipoEvento='boda'`, `fechaEvento` definida, `duracionHoras=8`,
  `numAdultosNinosMayores4=30`, `horario='11:00'` y `comentarios='Prefieren jardín'`
- **WHEN** el gestor abre la ficha de la consulta
- **THEN** la ficha muestra el tipo de evento, la fecha del evento, la duración (8 h), una
  única fila "Invitados" con 30, la hora de inicio (11:00) y los comentarios "Prefieren
  jardín"
- **AND** NO aparecen las filas "Niños ≤ 4" ni "Nº de invitados final"

#### Scenario: La fila Comentarios lee comentarios, no notas

- **GIVEN** una RESERVA con `comentarios='Boda íntima, sin música alta'` y `notas` distinto
  o nulo
- **WHEN** el gestor abre la ficha de la consulta
- **THEN** la fila "Comentarios" muestra "Boda íntima, sin música alta" (el valor de
  `comentarios`)
- **AND** no muestra el contenido de `notas`

#### Scenario: Los campos opcionales ausentes muestran un placeholder informativo

- **GIVEN** una RESERVA en `2a` sin `duracionHoras`, sin `numAdultosNinosMayores4`, sin
  `horario` y sin `comentarios`
- **WHEN** el gestor abre la ficha
- **THEN** cada uno de esos campos (incluida la fila "Invitados" y la fila "Comentarios") se
  muestra con un placeholder tipo "De momento no se dispone de esta información"
- **AND** no se oculta el campo ni se deja la ficha sin indicar qué falta

## ADDED Requirements

### Requirement: Persistencia y exposición del comentario del alta en el detalle de la RESERVA

El sistema SHALL (DEBE) **persistir** el `comentarios` recibido en el alta de consulta
(`CreateReservaRequest.comentarios`) en una columna propia de la RESERVA
(`comentarios String? @db.Text`), poblada dentro de la transacción del alta bajo el contexto
RLS del `tenant_id` del JWT. La **presencia** de `comentarios` SIGUE decidiendo el flujo del
email E1 (ausente/vacío → auto-envío; presente → borrador pendiente de revisión): esta
mejora NO cambia esa lógica, solo añade la persistencia. El sistema DEBE **exponer**
`comentarios` en la respuesta de detalle `GET /reservas/{id}` (schema `ReservaDetalle`),
**únicamente** en el detalle: NO DEBE incluirlo en el schema base `Reserva` ni en las filas
del listado de reservas/pipeline/histórico. `comentarios` es de **solo lectura** en el
detalle: no se edita vía `PATCH /reservas/{id}` (el editor sigue tocando `notas`). Si el
alta no trae `comentarios` (o viene en blanco), la columna queda `NULL`. (Fuente: `US-051
§Punto 1`; `alta-consulta.use-case.ts §comentarios`; `CreateReservaRequest.comentarios`;
`er-diagram §3.6 RESERVA`; `CLAUDE.md §Multi-tenancy`.)

#### Scenario: El alta con comentarios lo persiste en la columna de la RESERVA

- **GIVEN** un alta de consulta con `comentarios='Quieren carpa en el jardín'`
- **WHEN** el sistema crea la RESERVA
- **THEN** la RESERVA persiste `comentarios='Quieren carpa en el jardín'` en su columna
  propia
- **AND** la fila E1 se crea en `estado='borrador'` (comportamiento de decisión de E1 sin
  cambios por la presencia de comentarios)

#### Scenario: El alta sin comentarios deja la columna nula y auto-envía E1

- **GIVEN** un alta de consulta sin `comentarios` (omitido o en blanco)
- **WHEN** el sistema crea la RESERVA
- **THEN** la RESERVA persiste `comentarios = NULL`
- **AND** el E1 sigue el flujo de auto-envío (comportamiento de decisión de E1 sin cambios)

#### Scenario: El detalle expone comentarios pero el listado no

- **GIVEN** una RESERVA con `comentarios='Nota del cliente'`
- **WHEN** un gestor autenticado solicita `GET /reservas/{id}` de esa RESERVA
- **THEN** la respuesta `ReservaDetalle` incluye `comentarios='Nota del cliente'`
- **AND** las filas del listado de reservas (schema base `Reserva`) NO incluyen el campo
  `comentarios`

#### Scenario: El PATCH de la reserva no edita comentarios

- **GIVEN** una RESERVA con `comentarios='Original del cliente'`
- **WHEN** el gestor edita la consulta vía `PATCH /reservas/{id}`
- **THEN** el campo `comentarios` no es editable por ese endpoint y conserva su valor
  original
- **AND** el editor sigue operando sobre `notas`

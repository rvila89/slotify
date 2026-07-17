# Spec Delta — Capability `consultas`

> **US-047 / UC-35 / UC-36** — Refinamientos de comportamiento del borrador E1. Mientras
> el E1 de confirmación de consulta sigue en `borrador` (US-045 con comentarios) no se
> permite avanzar la consulta, y el gestor ve desde el dashboard qué reservas tienen un
> E1 pendiente de enviar. NO reimplementa la máquina de estados, el motor de email ni el
> bloqueo atómico de fecha.
>
> Fuente: `US-047`; UC-35; UC-36; `er-diagram §3.17 COMUNICACION`, `§3.6 RESERVA`; spec
> viva `consultas` ("Idioma y horario opcionales en el alta de consulta"); spec viva
> `comunicaciones` (US-045/US-046); `CLAUDE.md §Máquina de estados`, `§Multi-tenancy`.

## ADDED Requirements

### Requirement: Las acciones de la consulta se bloquean mientras el E1 sigue en borrador

El sistema SHALL (DEBE), mientras exista una `COMUNICACION` con `codigo_email = 'E1'` y
`estado = 'borrador'` asociada a la RESERVA, **no ofrecer ninguna acción de avance de la
consulta**: el bloque de acciones (`AccionesConsulta`) NO DEBE renderizarse y en su lugar
DEBE mostrarse un aviso "Revisa y envía el correo de confirmación antes de continuar." El
bloqueo cubre **todas** las acciones de la ficha de consulta, **incluida** "Marcar como
descartada", porque sin el email inicial enviado al cliente no tiene sentido avanzar la
consulta. En cuanto el borrador E1 pasa a `estado = 'enviado'` o `'fallido'` (deja de
haber E1 en `borrador`), el bloque de acciones vuelve a mostrarse. Este bloqueo es una
guarda de UI sobre la lectura de la existencia del borrador; las guardas de servidor de
las transiciones (US-046 y máquina de estados) permanecen intactas. (Fuente: `US-047`
bloqueo de acciones; spec viva `comunicaciones` "Confirmación de envío de un borrador".)

#### Scenario: Con un E1 en borrador, la ficha oculta las acciones y muestra el aviso

- **GIVEN** una RESERVA en sub-estado de consulta con una `COMUNICACION`
  `codigo_email = 'E1'`, `estado = 'borrador'`
- **WHEN** el gestor abre la ficha de la consulta
- **THEN** el bloque `AccionesConsulta` no se renderiza
- **AND** se muestra el aviso "Revisa y envía el correo de confirmación antes de continuar."
- **AND** no se ofrece ninguna acción de avance, incluida "Marcar como descartada"

#### Scenario: Al enviar el borrador E1, las acciones vuelven a estar disponibles

- **GIVEN** una RESERVA cuya `COMUNICACION` E1 estaba en `borrador` y las acciones estaban
  ocultas
- **WHEN** el gestor revisa y envía el borrador E1 (pasa a `estado = 'enviado'`) y la ficha
  se recarga
- **THEN** ya no existe ninguna `COMUNICACION` E1 en `borrador` para la RESERVA
- **AND** el bloque `AccionesConsulta` vuelve a renderizarse con sus acciones

#### Scenario: Sin borrador E1, la ficha muestra las acciones con normalidad

- **GIVEN** una RESERVA en sub-estado de consulta sin ninguna `COMUNICACION` E1 en
  `borrador` (E1 ya enviado, o alta sin comentarios)
- **WHEN** el gestor abre la ficha de la consulta
- **THEN** el bloque `AccionesConsulta` se renderiza normalmente y no aparece el aviso

### Requirement: El ítem del pipeline expone si la reserva tiene un borrador E1 pendiente

El sistema SHALL (DEBE) incluir en cada ítem del pipeline devuelto por `GET /reservas`
(`ReservaPipelineItemDto`) el flag booleano `tieneBorradorE1Pendiente`, `true` cuando
existe una `COMUNICACION` con `codigo_email = 'E1'` y `estado = 'borrador'` asociada a esa
RESERVA, y `false` en caso contrario. El flag se **calcula en el mismo query del pipeline**
bajo el contexto RLS del `tenant_id` del JWT (nunca considera comunicaciones de otro
tenant) y se **recalcula en cada fetch**, de modo que al pasar el borrador a `enviado` o
`fallido` el flag vale `false` sin ninguna acción adicional. (Fuente: `US-047` dashboard
alert; `er-diagram §3.17 COMUNICACION`; `CLAUDE.md §Multi-tenancy`.)

#### Scenario: Una reserva con E1 en borrador reporta el flag en true

- **GIVEN** una RESERVA del tenant del gestor con una `COMUNICACION` `codigo_email = 'E1'`,
  `estado = 'borrador'`
- **WHEN** el gestor solicita el pipeline `GET /reservas`
- **THEN** el ítem de esa RESERVA incluye `tieneBorradorE1Pendiente = true`

#### Scenario: Una reserva sin borrador E1 reporta el flag en false

- **GIVEN** una RESERVA sin ninguna `COMUNICACION` E1 en `borrador` (E1 enviado/fallido o
  inexistente)
- **WHEN** el gestor solicita el pipeline
- **THEN** el ítem de esa RESERVA incluye `tieneBorradorE1Pendiente = false`

#### Scenario: El flag no considera comunicaciones de otro tenant

- **GIVEN** una RESERVA cuyo E1 en `borrador` pertenece a otro tenant
- **WHEN** el gestor de un tenant distinto solicita el pipeline
- **THEN** el cálculo del flag se limita al `tenant_id` del JWT y no se ve afectado por la
  comunicación cross-tenant

### Requirement: El kanban y el listado señalan la reserva con un badge de E1 pendiente

El sistema SHALL (DEBE) mostrar en las **cards del kanban** y en las filas del **listado**
del pipeline un **badge ámbar** con el texto "Borrador E1 pendiente" cuando el ítem tiene
`tieneBorradorE1Pendiente === true`, y NO DEBE mostrarlo cuando el flag es `false`. El
badge es una señal visual de dashboard que dirige al gestor a las reservas cuyo primer
email aún no se ha enviado al cliente. (Fuente: `US-047` dashboard alert; `CLAUDE.md
§Web responsive`.)

#### Scenario: La kanban card muestra el badge ámbar con E1 pendiente

- **GIVEN** un ítem del pipeline con `tieneBorradorE1Pendiente = true`
- **WHEN** el gestor visualiza la card de esa RESERVA en el kanban
- **THEN** la card muestra el badge ámbar "Borrador E1 pendiente"

#### Scenario: La fila del listado muestra el badge ámbar con E1 pendiente

- **GIVEN** un ítem del pipeline con `tieneBorradorE1Pendiente = true`
- **WHEN** el gestor visualiza la fila de esa RESERVA en el listado
- **THEN** la fila muestra el badge ámbar "Borrador E1 pendiente"

#### Scenario: Sin E1 pendiente no se muestra el badge

- **GIVEN** un ítem del pipeline con `tieneBorradorE1Pendiente = false`
- **WHEN** el gestor visualiza la card en el kanban o la fila en el listado
- **THEN** no aparece el badge "Borrador E1 pendiente"

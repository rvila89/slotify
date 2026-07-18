# Spec Delta — Capability `consultas`

> **US-051** — Ficha de consulta: ver detalles, editar, y sanear acciones. La ficha de la
> RESERVA muestra **todos** los datos del evento, permite **editar** los campos simples de
> la consulta/reserva (sin tocar la fecha por vías no atómicas) y deja de ofrecer acciones
> en las consultas cerradas (terminales). NO reimplementa la máquina de estados ni el
> bloqueo atómico de fecha: lo **reutiliza** para asignar/cambiar la fecha.
>
> Fuente: `US-051 §Puntos 1, 2, 4`; UC-05/UC-12/UC-18 (bloqueo/cola); `er-diagram §3.6
> RESERVA`, `§FECHA_BLOQUEADA`, `§AUDIT_LOG`; spec viva `consultas` ("Idioma y horario
> opcionales en el alta de consulta"); `CLAUDE.md §Regla crítica: bloqueo atómico de
> fecha`, `§Multi-tenancy`.

## ADDED Requirements

### Requirement: Visualización completa de los detalles del evento en la ficha

El sistema SHALL (DEBE) mostrar en la ficha de la RESERVA **todos** los datos del evento
presentes en la entidad: `tipoEvento`, `fechaEvento`, `duracionHoras`, número de invitados
(`numAdultosNinosMayores4`, `numNinosMenores4`, `numInvitadosFinal`), hora de inicio
(`horario`), visita programada (`visitaProgramadaFecha`/`visitaProgramadaHora`) y
comentarios (`notas`). Para cada campo **opcional ausente** (NULL), el sistema DEBE mostrar
un placeholder legible tipo "De momento no se dispone de esta información" en lugar de
omitir el campo, de modo que el gestor vea qué información falta. Esta visualización es de
**lectura**; no muta ninguna entidad. (Fuente: `US-051 §Punto 1`; `er-diagram §3.6
RESERVA`; spec viva `consultas` "Idioma y horario opcionales en el alta de consulta".)

#### Scenario: La ficha muestra todos los datos del evento cuando están presentes

- **GIVEN** una RESERVA con `tipoEvento='boda'`, `fechaEvento` definida,
  `duracionHoras=8`, `numAdultosNinosMayores4=30`, `numNinosMenores4=5`, `horario='11:00'`
  y `notas='Prefieren jardín'`
- **WHEN** el gestor abre la ficha de la consulta
- **THEN** la ficha muestra el tipo de evento, la fecha del evento, la duración (8 h), el
  nº de invitados (30 adultos/niños > 4 y 5 niños ≤ 4), la hora de inicio (11:00) y los
  comentarios

#### Scenario: Los campos opcionales ausentes muestran un placeholder informativo

- **GIVEN** una RESERVA en `2a` sin `duracionHoras`, sin `numAdultosNinosMayores4`, sin
  `horario` y sin `notas`
- **WHEN** el gestor abre la ficha
- **THEN** cada uno de esos campos se muestra con un placeholder tipo "De momento no se
  dispone de esta información"
- **AND** no se oculta el campo ni se deja la ficha sin indicar qué falta

### Requirement: Edición de los datos de una consulta/reserva

El sistema SHALL (DEBE) permitir a un gestor autenticado editar, desde la ficha, los
**campos simples** de la RESERVA mediante `PATCH /reservas/{id}`: `tipoEvento`,
`duracionHoras`, `numAdultosNinosMayores4`, `numNinosMenores4`, `numInvitadosFinal`,
`notas` y `horario`. La edición se ejecuta bajo el contexto RLS del tenant, escribe
`AUDIT_LOG` (`accion='actualizar'`, `entidad='RESERVA'`) y **NO cambia el estado ni el
sub-estado** de la RESERVA. El PATCH **NO DEBE** mutar `fechaEvento` ni el bloqueo de
fecha: toda mutación de fecha pasa por el bloqueo atómico (`bloquearFecha()`/
`liberarFecha()`), nunca por este endpoint. La validación de `horario` (`HH:MM`) es
**cruzada**: solo es válido si la RESERVA tiene `duracionHoras` (ya presente o fijada en el
mismo PATCH); en caso contrario el servidor rechaza con error de validación en `horario` y
no persiste nada. (Fuente: `US-051 §Punto 2`; `api-spec.yml PATCH /reservas/{id}`,
`UpdateReservaRequest`; `CLAUDE.md §Regla crítica: bloqueo atómico de fecha`; spec viva
`consultas` "Idioma y horario opcionales en el alta de consulta".)

#### Scenario: Editar el nº de invitados actualiza la RESERVA sin cambiar de estado

- **GIVEN** una RESERVA en `2b` con `numAdultosNinosMayores4=30`
- **WHEN** el gestor edita el nº de invitados a 20 y confirma
- **THEN** el sistema persiste `numAdultosNinosMayores4=20`
- **AND** la RESERVA permanece en `estado='consulta'` y `subEstado='2b'`
- **AND** no se modifica `FECHA_BLOQUEADA`
- **AND** se registra `AUDIT_LOG` `accion='actualizar'`, `entidad='RESERVA'`

#### Scenario: El PATCH no muta la fecha del evento aunque se intente

- **GIVEN** una RESERVA en `2b` con una `fechaEvento` bloqueada
- **WHEN** el gestor envía un `PATCH /reservas/{id}` con `duracionHoras=12` (y, si el
  cliente incluyera `fechaEvento`, ese campo)
- **THEN** el sistema persiste `duracionHoras=12`
- **AND** NO altera `fechaEvento` ni `FECHA_BLOQUEADA` por la vía del PATCH

#### Scenario: horario sin duracionHoras se rechaza en servidor

- **GIVEN** una RESERVA sin `duracionHoras`
- **WHEN** el gestor envía un `PATCH /reservas/{id}` con `horario='10:00'` y sin
  `duracionHoras`
- **THEN** el servidor retorna un error de validación en el campo `horario`
- **AND** no persiste ningún cambio en la RESERVA

#### Scenario: Asignar la fecha en 2.a reutiliza el flujo atómico existente

- **GIVEN** una RESERVA exploratoria en `2a` (sin fecha, `ttl_expiracion = NULL`)
- **WHEN** el gestor asigna una fecha del evento desde la ficha
- **THEN** el sistema NO usa el `PATCH /reservas/{id}` para la fecha, sino el flujo
  `POST /reservas/{id}/fecha` (transición `2a → 2b/2d` con bloqueo atómico y cola)

### Requirement: Cambio atómico de una fecha ya bloqueada

El sistema SHALL (DEBE), cuando el gestor cambia la **fecha del evento** de una RESERVA que
YA tiene una fecha bloqueada (sub-estados `2b`/`2c`/`2v`), ejecutar una **única
transacción atómica** que libere la fecha antigua y bloquee la nueva, con
`SELECT … FOR UPDATE` sobre la RESERVA y sobre `FECHA_BLOQUEADA(tenant_id, fecha_nueva)`,
respetando `UNIQUE(tenant_id, fecha)`. Si la fecha nueva está libre, el sistema DEBE
bloquearla (`bloquearFecha`), actualizar `RESERVA.fecha_evento`, liberar la fecha antigua
(`liberarFecha`) y, si la fecha antigua tenía cola de espera, disparar la **promoción FIFO**
del primero en cola (mecánica A15). Si la fecha nueva NO puede bloquearse (ocupada por otra
RESERVA), el sistema DEBE rechazar el cambio con conflicto **sin** tocar la RESERVA ni la
fecha antigua (rollback total). El sistema NO DEBE usar locks distribuidos (Redis/Redlock):
la serialización la da PostgreSQL. Toda la operación registra `AUDIT_LOG`
(`accion='actualizar'`, `entidad='RESERVA'`) con la fecha anterior y la nueva. (Fuente:
`US-051 §Punto 2`; UC-05/UC-12/UC-18; `er-diagram §FECHA_BLOQUEADA`; `CLAUDE.md §Regla
crítica: bloqueo atómico de fecha`. **Alcance sujeto al gate**: puede diferirse a un change
propio dejando la fecha editable solo en `2a` — ver `design.md §D-2.3`.)

#### Scenario: Cambiar a una fecha libre libera la antigua y bloquea la nueva atómicamente

- **GIVEN** una RESERVA en `2b` con la fecha `F1` bloqueada y la fecha `F2` libre
- **WHEN** el gestor cambia la fecha del evento de `F1` a `F2`
- **THEN** en una única transacción el sistema bloquea `F2`, actualiza
  `RESERVA.fecha_evento = F2` y libera `F1`
- **AND** la RESERVA permanece en `estado='consulta'`, `subEstado='2b'`
- **AND** registra `AUDIT_LOG` `accion='actualizar'` con `F1` (anterior) y `F2` (nueva)

#### Scenario: Dos cambios concurrentes a la misma fecha nueva solo dejan pasar a uno

- **GIVEN** dos RESERVAS del mismo tenant, cada una con su fecha bloqueada, que solicitan a
  la vez cambiar a la **misma** fecha nueva `F2` (libre)
- **WHEN** ambas transacciones se ejecutan concurrentemente
- **THEN** exactamente una bloquea `F2` (respetando `UNIQUE(tenant_id, fecha)`) y completa
  el cambio
- **AND** la otra recibe conflicto y su RESERVA y su fecha antigua quedan intactas

#### Scenario: Liberar una fecha con cola promueve al primero en cola

- **GIVEN** una RESERVA en `2b` con la fecha `F1` bloqueada y **una consulta en cola** sobre
  `F1`, y una fecha `F2` libre
- **WHEN** el gestor cambia la fecha del evento de `F1` a `F2`
- **THEN** al liberar `F1` el sistema promueve (FIFO, A15) al primero en cola de `F1`
  exactamente una vez, sin estado intermedio observable

#### Scenario: La fecha nueva ocupada aborta el cambio sin efectos

- **GIVEN** una RESERVA en `2b` con la fecha `F1` bloqueada y una fecha `F2` **ya
  bloqueada** por otra RESERVA
- **WHEN** el gestor intenta cambiar la fecha del evento de `F1` a `F2`
- **THEN** el sistema rechaza el cambio con conflicto
- **AND** la RESERVA conserva `fecha_evento = F1` y `F1` sigue bloqueada (rollback total)

### Requirement: Sin acciones en consultas cerradas (estados y sub-estados terminales)

El sistema SHALL (DEBE), cuando la RESERVA está en un **sub-estado terminal de consulta**
(`2x`/`2y`/`2z`) o en un **estado terminal** (`reserva_cancelada`, `reserva_completada`),
NO ofrecer **ninguna** acción en la ficha —**ni siquiera deshabilitada**—: el sistema NO
DEBE renderizar los botones "Generar presupuesto" ni "Marcar como descartada" (ni ningún
otro), y en su lugar DEBE mostrar únicamente el fallback "No hay acciones disponibles para
esta consulta en su estado actual." Esta es una guarda de **UI** sobre el estado de la
RESERVA; las guardas de servidor de las transiciones permanecen intactas y revalidan de
forma defensiva. (Fuente: `US-051 §Punto 4`; `CLAUDE.md §Máquina de estados`; spec viva
`consultas`.)

#### Scenario: Una consulta descartada (2.z) no muestra ninguna acción

- **GIVEN** una RESERVA en `estado='consulta'`, `subEstado='2z'` (descartada)
- **WHEN** el gestor abre la ficha
- **THEN** la ficha NO renderiza ningún botón de acción (ni deshabilitado)
- **AND** muestra únicamente "No hay acciones disponibles para esta consulta en su estado
  actual."

#### Scenario: Una reserva cancelada no muestra ninguna acción

- **GIVEN** una RESERVA en `estado='reserva_cancelada'`
- **WHEN** el gestor abre la ficha
- **THEN** la ficha muestra únicamente el fallback "No hay acciones disponibles" y ningún
  botón

#### Scenario: Un sub-estado terminal no pinta "Generar presupuesto" ni "Descartar" deshabilitados

- **GIVEN** una RESERVA en `estado='consulta'`, `subEstado='2x'` (expirada)
- **WHEN** el gestor abre la ficha
- **THEN** NO aparecen los botones "Generar presupuesto" ni "Marcar como descartada" (ni
  siquiera deshabilitados con motivo)

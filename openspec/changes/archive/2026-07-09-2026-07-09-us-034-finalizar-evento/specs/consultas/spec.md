# consultas Specification

## ADDED Requirements

### Requirement: Finalización manual del evento — transición evento_en_curso → post_evento

El sistema SHALL (DEBE) permitir al **gestor** ejecutar la acción "Marcar evento como
finalizado" sobre una RESERVA, que transiciona `RESERVA.estado` de `evento_en_curso` a
`post_evento`. La transición SHALL (DEBE) modelarse como **guarda de origen declarativa** en la
máquina de estados del agregado RESERVA (`maquina-estados.ts`), como **estructura de datos** (NO
`if` dispersos), consistente con `resolverInicioEvento` (US-031) y `resolverExpiracionTtl`
(US-012). La acción SHALL (DEBE) autenticarse con **JWT de usuario** (no `X-Cron-Token`: es una
acción manual del gestor, no un barrido de Sistema) y ejecutarse bajo el **contexto RLS del
tenant** del gestor. La transición es **incondicional respecto a la fianza y al email**: solo
depende de que el estado de origen sea `evento_en_curso`. (Fuente: `US-034 §Historia`, `§Reglas
de negocio`, `§Reglas de Validación`; `use-cases.md` UC-25; `CLAUDE.md §Máquina de estados`.)

#### Scenario: El gestor finaliza un evento en curso y la reserva pasa a post_evento

- **GIVEN** una RESERVA en `estado = 'evento_en_curso'` en el tenant del gestor autenticado
- **WHEN** el gestor selecciona "Marcar evento como finalizado" y confirma
- **THEN** el sistema fija `RESERVA.estado = post_evento` bajo el contexto RLS de su tenant
- **AND** la RESERVA queda en `post_evento`, que arranca el sub-proceso post-evento

### Requirement: La acción de finalizar solo está disponible en estado evento_en_curso

El sistema SHALL (DEBE) permitir la finalización del evento **únicamente** cuando
`RESERVA.estado = 'evento_en_curso'`. Si la RESERVA está en cualquier otro estado (`consulta`,
`pre_reserva`, `reserva_confirmada`, `post_evento`, `reserva_completada`, `reserva_cancelada`),
la acción SHALL (DEBE) rechazarse con un **conflicto de estado** y NO DEBE modificar la RESERVA
ni disparar E5 ni escribir en `AUDIT_LOG` una transición. La disponibilidad de la acción es una
guarda de origen de la máquina de estados, no una validación dispersa. (Fuente: `US-034 §Reglas
de negocio`, `§Reglas de Validación`; UC-25.)

#### Scenario: Intento de finalizar una reserva que no está en evento_en_curso

- **GIVEN** una RESERVA en `estado = 'reserva_confirmada'` (o cualquier estado distinto de
  `evento_en_curso`)
- **WHEN** el gestor intenta "Marcar evento como finalizado"
- **THEN** el sistema rechaza la acción con un conflicto de estado
- **AND** `RESERVA.estado` no cambia, no se dispara E5 y no se registra transición en `AUDIT_LOG`

### Requirement: La transición evento_en_curso → post_evento es irreversible

El sistema SHALL (DEBE) tratar la transición `evento_en_curso → post_evento` como
**irreversible**: no existe transición de retorno `post_evento → evento_en_curso` en la máquina
de estados del agregado RESERVA, y la máquina de estados NO DEBE ofrecer ningún camino que
devuelva la RESERVA a `evento_en_curso` una vez en `post_evento`. Una segunda ejecución de la
acción de finalizar sobre una RESERVA ya en `post_evento` DEBE rechazarse como conflicto de
estado (no re-ejecuta la transición ni re-dispara E5). (Fuente: `US-034 §Reglas de negocio`,
`§Reglas de Validación`.)

#### Scenario: No hay camino de retorno desde post_evento a evento_en_curso

- **GIVEN** una RESERVA que ya transicionó a `estado = 'post_evento'`
- **WHEN** se consulta la máquina de estados por las transiciones válidas desde `post_evento`
- **THEN** ninguna transición válida devuelve la RESERVA a `evento_en_curso`
- **AND** un segundo intento de "Marcar evento como finalizado" se rechaza como conflicto de
  estado sin re-disparar efectos

### Requirement: La transición se registra en AUDIT_LOG con origen Usuario

El sistema SHALL (DEBE) registrar cada finalización efectiva del evento en `AUDIT_LOG` con
`accion = 'transicion'`, `entidad = 'RESERVA'`, `datos_anteriores = {estado: evento_en_curso}` y
`datos_nuevos = {estado: post_evento}`, con origen **Usuario** (el gestor autenticado, con su
`usuario_id` poblado — a diferencia del barrido de Sistema de US-031, que no puebla usuario). El
`AUDIT_LOG` es **obligatorio** para toda transición de estado. El registro de la transición NO
DEBE depender del resultado del envío de E5 (la transición se audita aunque E5 falle). (Fuente:
`US-034 §Happy Path`, `§Reglas de Validación`; `er-diagram.md` AUDIT_LOG.)

#### Scenario: La finalización del evento se audita como acción de Usuario

- **GIVEN** una RESERVA en `evento_en_curso` que el gestor finaliza
- **WHEN** el sistema ejecuta la transición a `post_evento`
- **THEN** registra en `AUDIT_LOG` una entrada con `accion = 'transicion'`, `entidad =
  'RESERVA'`, `datos_anteriores = {estado: evento_en_curso}`, `datos_nuevos = {estado:
  post_evento}` y el `usuario_id` del gestor (origen Usuario)
- **AND** la entrada se registra aunque el posterior envío de E5 falle

### Requirement: Advertencia no bloqueante si el checklist de documentación está incompleto

El sistema SHALL (DEBE), al iniciar la acción de finalizar el evento, **consultar** la
completitud del checklist de documentación del evento (superficie de US-033); si tiene ítems
pendientes (p. ej. cláusula de responsabilidad no subida), DEBE mostrar una **advertencia
informativa** que enumere los ítems sin subir ("Documentación pendiente: [lista de ítems sin
subir]. Puedes continuar igualmente."). La advertencia NO DEBE bloquear la finalización: si el
gestor confirma, la transición a `post_evento` se ejecuta igualmente, y el checklist permanece
accesible para subidas tardías en `post_evento`. US-034 solo **consulta** la completitud; NO
construye el checklist. (Fuente: `US-034 §FA-01 — Documentación del evento incompleta al
finalizar`; UC-25.)

#### Scenario: Documentación incompleta al finalizar — advierte pero no bloquea

- **GIVEN** una RESERVA en `evento_en_curso` cuyo checklist de documentación tiene ítems
  pendientes
- **WHEN** el gestor selecciona "Marcar evento como finalizado"
- **THEN** el sistema muestra una advertencia informativa que enumera los ítems pendientes
- **AND** si el gestor confirma, la transición a `post_evento` se ejecuta igualmente
- **AND** el checklist sigue accesible para subidas tardías en `post_evento`

### Requirement: Doble finalización concurrente — exactamente una transición gana sin doble efecto

El sistema SHALL (DEBE) garantizar que, ante dos peticiones concurrentes de finalización de la
**misma** RESERVA (doble click / doble request), **exactamente una** transiciona `estado =
post_evento`; la segunda detecta bajo el lock que el estado ya no es `evento_en_curso` y termina
como **conflicto de estado**, sin doble transición, sin doble entrada de transición en
`AUDIT_LOG` y sin doble disparo de E5. La guarda de origen se **re-evalúa dentro de la
transacción bajo `SELECT … FOR UPDATE`** de la fila RESERVA; la serialización la da PostgreSQL
sobre la fila, sin locks distribuidos (Redis/Redlock prohibidos). (Fuente: `US-034 §Reglas de
Validación`; `CLAUDE.md §Regla crítica: bloqueo atómico`.)

#### Scenario: Dos peticiones simultáneas finalizan la misma reserva

- **GIVEN** una RESERVA en `estado = 'evento_en_curso'` sobre la que llegan dos peticiones de
  finalización en la misma ventana temporal
- **WHEN** ambas leen `estado = evento_en_curso` y ejecutan la transición bajo el lock de la fila
- **THEN** exactamente una tiene éxito y fija `estado = post_evento`
- **AND** la segunda observa que el estado ya no es `evento_en_curso` y termina como conflicto de
  estado (0 filas afectadas)
- **AND** `AUDIT_LOG` contiene exactamente una entrada de transición y E5 se dispara a lo sumo
  una vez

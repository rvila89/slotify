# consultas Specification

## ADDED Requirements

### Requirement: Forzado manual del inicio de evento por el Gestor — transición reserva_confirmada → evento_en_curso

El sistema SHALL (DEBE) permitir al **gestor** ejecutar la acción "Forzar inicio del evento"
sobre una RESERVA, que transiciona `RESERVA.estado` de `reserva_confirmada` a `evento_en_curso`
**aunque alguna precondición del inicio de evento esté incumplida** (`pre_evento_status ≠
'cerrado'` O `liquidacion_status ≠ 'cobrada'` O `fianza_status ≠ 'cobrada'`). La transición SHALL
(DEBE) reutilizar la **misma guarda de origen declarativa** que el inicio automático de US-031
(`reserva_confirmada → evento_en_curso`, `resolverInicioEvento` en `maquina-estados.ts`); la
única diferencia es que US-032 **fuerza** la transición con independencia de si las tres
precondiciones se cumplen (US-031 solo transiciona si `preconditionesEventoCumplidas().cumple ===
true`). La acción SHALL (DEBE) autenticarse con **JWT de usuario** (rol gestor; NO `X-Cron-Token`:
no es un barrido de Sistema) y ejecutarse bajo el **contexto RLS del tenant** del gestor; el
`tenant_id` y el `usuario_id` derivan del JWT, NUNCA del path/body. (Fuente: `US-032 §Historia`,
`§Happy Path`, `§Reglas de negocio`; `use-cases.md` UC-23 FA-01; `CLAUDE.md §Máquina de estados`.)

#### Scenario: El gestor fuerza el inicio con una precondición incumplida el día del evento

- **GIVEN** una RESERVA en `estado = 'reserva_confirmada'`, `fecha_evento = hoy` y al menos una
  precondición incumplida (p. ej. `liquidacion_status = facturada` en lugar de `cobrada`), en el
  tenant del gestor autenticado
- **WHEN** el gestor selecciona "Forzar inicio del evento" y confirma la doble confirmación
- **THEN** el sistema fija `RESERVA.estado = evento_en_curso` bajo el contexto RLS de su tenant
- **AND** la RESERVA queda en `evento_en_curso`, estado que habilita la vista móvil "evento en
  curso" y el checklist de documentación pendiente (superficie de US-033/US-034)

#### Scenario: El forzado es válido con múltiples precondiciones incumplidas

- **GIVEN** una RESERVA en `estado = 'reserva_confirmada'`, `fecha_evento = hoy`, con
  `pre_evento_status ≠ cerrado`, `liquidacion_status ≠ cobrada` y `fianza_status ≠ cobrada`
  simultáneamente
- **WHEN** el gestor fuerza el inicio y confirma la doble confirmación
- **THEN** la transición a `evento_en_curso` se ejecuta igualmente (el forzado es válido con
  independencia del número de precondiciones incumplidas)
- **AND** las tres precondiciones incumplidas se registran en `AUDIT_LOG.datos_nuevos.
  precondiciones_incumplidas`

### Requirement: El forzado solo está disponible el día del evento (fecha_evento = hoy)

El sistema SHALL (DEBE) permitir el forzado del inicio de evento **únicamente** cuando la RESERVA
esté en `estado = 'reserva_confirmada'` **AND** `date(fecha_evento) = date(hoy)`. La comparación
es por **fecha de calendario del evento** (no por instante ni por un `ttl_expiracion`) usando una
**única definición de "hoy"** en la zona horaria de negocio del servidor/tenant, calculada en el
backend (la guarda NO depende de ningún string formateado; blinda el off-by-one de zona horaria),
coherente con la selección de candidatas de US-031. La guarda de fecha SHALL (DEBE) modelarse
como **función de dominio pura** (`esDiaDelEvento(fechaEvento, hoy)` en `maquina-estados.ts`), NO
como un `if` de fecha disperso. Si `estado = 'reserva_confirmada'` pero `fecha_evento ≠ hoy`, el
forzado SHALL (DEBE) rechazarse **sin efectos** con un error de precondición de negocio
(HTTP 422, `code: 'fecha_evento_no_es_hoy'`), distinto del conflicto de estado. (Fuente: `US-032
§Intento de forzar fuera del día del evento`, `§Reglas de negocio`, `§Reglas de Validación`;
UC-23 FA-01.)

#### Scenario: Intento de forzar antes del día del evento se rechaza sin efectos

- **GIVEN** una RESERVA en `estado = 'reserva_confirmada'` con `fecha_evento ≠ hoy` (p. ej.
  mañana, el gestor abre la ficha el día anterior)
- **WHEN** se invoca el forzado del inicio de evento sobre esa RESERVA
- **THEN** el sistema rechaza la acción sin efectos con un error de precondición de negocio
  (HTTP 422, `fecha_evento_no_es_hoy`)
- **AND** `RESERVA.estado` permanece `reserva_confirmada` y no se registra transición en
  `AUDIT_LOG`

### Requirement: La lista de precondiciones incumplidas se calcula bajo el lock y se persiste en la auditoría

El sistema SHALL (DEBE), en el momento del forzado y **bajo el lock de la fila** (`SELECT … FOR
UPDATE`), calcular las precondiciones incumplidas con la **guarda pura reutilizada**
`preconditionesEventoCumplidas({ preEventoStatus, liquidacionStatus, fianzaStatus })` (US-031),
leyendo los tres `*_status` de la RESERVA en una única lectura, y persistir la lista `faltantes`
en `AUDIT_LOG.datos_nuevos.precondiciones_incumplidas`. El forzado SHALL (DEBE) ejecutarse con
independencia del resultado de la guarda (`cumple` puede ser `false`): a diferencia de US-031, el
resultado de la guarda **no veta** la transición, solo alimenta la evidencia de auditoría. Si en
el momento del forzado las tres precondiciones estuvieran cumplidas (caso borde),
`precondiciones_incumplidas` DEBE ser `[]` y el forzado se ejecuta igualmente. (Fuente: `US-032
§Happy Path`, `§Múltiples precondiciones incumplidas simultáneamente`, `§Reglas de Validación`.)

#### Scenario: Se registran exactamente las precondiciones incumplidas en el momento del forzado

- **GIVEN** una RESERVA en `estado = 'reserva_confirmada'`, `fecha_evento = hoy`, con
  `pre_evento_status = cerrado`, `fianza_status = cobrada` pero `liquidacion_status = facturada`
- **WHEN** el gestor fuerza el inicio del evento
- **THEN** el sistema calcula bajo el lock las precondiciones incumplidas (`[liquidacion_status]`)
- **AND** registra `AUDIT_LOG.datos_nuevos.precondiciones_incumplidas = [liquidacion_status]` y
  transiciona la RESERVA a `evento_en_curso`

### Requirement: La transición forzada se registra en AUDIT_LOG con origen Usuario y forzado_por_gestor = true

El sistema SHALL (DEBE) registrar cada forzado efectivo del inicio de evento en `AUDIT_LOG` con
`accion = 'transicion'`, `entidad = 'RESERVA'`, origen **Usuario** (el gestor autenticado, con su
`usuario_id` poblado — a diferencia del barrido de Sistema de US-031, que no puebla usuario),
`datos_anteriores = {estado: reserva_confirmada}` y `datos_nuevos = {estado: evento_en_curso,
forzado_por_gestor: true, precondiciones_incumplidas: [lista]}`. El campo `forzado_por_gestor =
true` es **evidencia de auditoría OBLIGATORIA**: distingue un inicio forzado de un inicio
automático de US-031 (que nunca lleva `forzado_por_gestor`). La escritura del `AUDIT_LOG` SHALL
(DEBE) formar parte de la **misma transacción** que la UPDATE del estado (all-or-nothing): si la
UPDATE afecta 0 filas, NO se escribe auditoría. (Fuente: `US-032 §Happy Path`, `§Reglas de
Validación`, `§Impacto de Negocio`; `er-diagram.md` AUDIT_LOG.)

#### Scenario: El forzado se audita como acción de Usuario con la marca de override

- **GIVEN** una RESERVA en `evento_en_curso` que el gestor acaba de forzar desde
  `reserva_confirmada`
- **WHEN** el sistema registra la transición en `AUDIT_LOG`
- **THEN** la entrada tiene `accion = 'transicion'`, `entidad = 'RESERVA'`, el `usuario_id` del
  gestor (origen Usuario), `datos_anteriores = {estado: reserva_confirmada}` y `datos_nuevos =
  {estado: evento_en_curso, forzado_por_gestor: true, precondiciones_incumplidas: [lista]}`
- **AND** la entrada permite distinguir este inicio forzado de un inicio automático de US-031

### Requirement: El forzado no resuelve ni modifica los sub-procesos incumplidos

El sistema SHALL (DEBE) tratar el forzado como una operación que muta **exclusivamente**
`RESERVA.estado`: los sub-procesos incumplidos en el momento del forzado (`pre_evento_status`,
`liquidacion_status`, `fianza_status`) **NO** se resuelven automáticamente y **conservan su
valor** tras el forzado, quedando pendientes para gestión posterior. El forzado NO DEBE producir
side-effects sobre `FICHA_OPERATIVA`, los cobros, `FECHA_BLOQUEADA` ni la cola. (Fuente: `US-032
§Reglas de negocio`, `§Reglas de Validación`.)

#### Scenario: Tras el forzado, los sub-procesos incumplidos siguen pendientes

- **GIVEN** una RESERVA en `estado = 'reserva_confirmada'`, `fecha_evento = hoy`, con
  `liquidacion_status = facturada` (no cobrada)
- **WHEN** el gestor fuerza el inicio del evento
- **THEN** `RESERVA.estado = evento_en_curso`
- **AND** `liquidacion_status` sigue siendo `facturada` (y los demás `*_status` conservan su
  valor); ningún sub-proceso se resuelve automáticamente

### Requirement: Cron llegó primero — el forzado es idempotente y no genera doble efecto

El sistema SHALL (DEBE) tratar el forzado como **idempotente** respecto al inicio automático de
US-031 y a otras sesiones del gestor: si la RESERVA **ya no está en `reserva_confirmada`** cuando
se ejecuta el forzado (p. ej. el cron de US-031 la transicionó a `evento_en_curso` mientras el
gestor tenía la pantalla abierta), la acción SHALL (DEBE) detectar el conflicto de estado y
terminar como **no-op sin efectos**, respondiendo con un **conflicto de estado** (HTTP 409,
`code: 'conflicto_estado'`) y el mensaje "El evento ya está en curso (iniciado automáticamente o
por otro usuario). No es necesaria ninguna acción." NO DEBE ejecutar una segunda transición ni
registrar una segunda entrada en `AUDIT_LOG`. La guarda de origen (`resolverInicioEvento`) se
evalúa antes de la transacción y **se re-evalúa dentro de ella bajo el lock** (`SELECT … FOR
UPDATE`), de modo que la RESERVA ya en `evento_en_curso` no produce candidatura. (Fuente: `US-032
§Cron llegó primero — reserva ya en evento_en_curso`, `§Reglas de Validación`.)

#### Scenario: El gestor fuerza pero el cron ya inició el evento

- **GIVEN** una RESERVA que el cron de US-031 ya transicionó a `estado = 'evento_en_curso'`
  mientras el gestor tenía la pantalla de alerta abierta
- **WHEN** el gestor pulsa "Forzar inicio del evento"
- **THEN** el sistema detecta que `estado ≠ reserva_confirmada` y responde con un conflicto de
  estado (HTTP 409) con el mensaje "El evento ya está en curso…"
- **AND** no ejecuta ninguna transición adicional ni registra una segunda entrada en `AUDIT_LOG`

### Requirement: Concurrencia — cron vs gestor (o doble sesión) exactamente una transición gana sin error

El sistema SHALL (DEBE) garantizar que, cuando el barrido de Sistema (US-031) y el gestor
(US-032), o **dos sesiones del gestor**, intentan transicionar **simultáneamente** la misma
RESERVA de `reserva_confirmada` a `evento_en_curso`, **exactamente una** operación tiene éxito y
actualiza `RESERVA.estado = evento_en_curso`; la segunda operación detecta bajo el lock que el
estado ya no es `reserva_confirmada` (la UPDATE condicional `WHERE estado='reserva_confirmada'`
afecta **0 filas**) y termina como **no-op** traducido a conflicto de estado (HTTP 409), sin doble
transición ni doble auditoría. El `AUDIT_LOG` DEBE contener **exactamente una** entrada de
transición para esa RESERVA. La serialización la da PostgreSQL sobre la fila RESERVA (`SELECT …
FOR UPDATE`), **sin locks distribuidos** (Redis/Redlock prohibidos). (Fuente: `US-032
§Concurrencia / Race Conditions`; `CLAUDE.md §Regla crítica: bloqueo atómico` y `§Jobs
asíncronos`.)

#### Scenario: Dos operaciones compiten por forzar la misma reserva

- **GIVEN** una RESERVA en `estado = 'reserva_confirmada'` con `fecha_evento = hoy`, sobre la que
  el cron (US-031) y el gestor (US-032) —o dos sesiones del gestor— ejecutan la transición en la
  misma ventana temporal
- **WHEN** ambas operaciones leen `estado = reserva_confirmada` y ejecutan la UPDATE condicional
  bajo el lock de la fila
- **THEN** exactamente una tiene éxito y fija `estado = evento_en_curso`
- **AND** la segunda observa 0 filas afectadas y termina como no-op / conflicto de estado sin error
- **AND** `AUDIT_LOG` contiene exactamente una entrada de transición para esa RESERVA

### Requirement: Doble confirmación obligatoria en la UI como guardarraíl no eludible

El sistema SHALL (DEBE) exponer en la ficha de la reserva la **lista de precondiciones
incumplidas** (derivable de los `*_status` que ya expone `GET /reservas/{id}`) y un botón "Forzar
inicio del evento" **visible SOLO** cuando `estado = 'reserva_confirmada'` **AND** `fecha_evento =
hoy`. El disparo del forzado SHALL (DEBE) requerir una **doble confirmación** explícita del gestor
(diálogo de dos pasos que enumera las precondiciones incumplidas antes de confirmar); la
cancelación en cualquier paso es un **no-op sin efectos** (sin transición, sin `AUDIT_LOG`). La
doble confirmación es un guardarraíl UX y NO DEBE poder eludirse mediante parámetros de URL ni
shortcuts: la **defensa definitiva** es la validación de servidor (estado ≠ reserva_confirmada →
409; fecha_evento ≠ hoy → 422), no la UI. (Fuente: `US-032 §Reglas de negocio`, `§Gestor cancela
en el diálogo de doble confirmación`, `§Reglas de Validación`.)

#### Scenario: El gestor cancela en el segundo paso del diálogo

- **GIVEN** el gestor ve la alerta de precondiciones incumplidas y pulsa "Forzar inicio del
  evento"
- **WHEN** el gestor cancela en el segundo paso del diálogo de confirmación
- **THEN** `RESERVA.estado` permanece `reserva_confirmada` y no se registra ninguna transición en
  `AUDIT_LOG`
- **AND** el gestor puede reintentar el forzado o resolver las precondiciones pendientes

#### Scenario: El botón no aparece fuera del día del evento

- **GIVEN** una RESERVA en `estado = 'reserva_confirmada'` con `fecha_evento ≠ hoy`
- **WHEN** el gestor navega a la ficha de la reserva
- **THEN** el botón "Forzar inicio del evento" no se renderiza en la UI
- **AND** aunque se invocara el endpoint directamente, el servidor rechazaría el forzado con
  HTTP 422 (`fecha_evento_no_es_hoy`)

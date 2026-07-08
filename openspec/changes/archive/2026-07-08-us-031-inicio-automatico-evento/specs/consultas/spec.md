# consultas Specification

## ADDED Requirements

### Requirement: Barrido periódico protegido de inicio automático de evento en T-0

El sistema SHALL (DEBE) exponer un **barrido interno protegido** que, al ser invocado,
seleccione todas las RESERVA con `estado = 'reserva_confirmada'` **AND** cuya `fecha_evento`
sea **hoy** (día T-0, es decir `date(fecha_evento) = date(hoy)`) y, para cada una que cumpla
las **tres precondiciones** (`pre_evento_status = 'cerrado'` **AND** `liquidacion_status =
'cobrada'` **AND** `fianza_status = 'cobrada'`), transicione automáticamente `RESERVA.estado`
de `reserva_confirmada` a `evento_en_curso`. El barrido SHALL (DEBE) autenticarse
**service-to-service** mediante la cabecera `X-Cron-Token` (comparada con `CRON_TOKEN` del
entorno vía `CronTokenGuard`); NO DEBE ser accesible con JWT de usuario ni desde el exterior.
Un **cron scheduler** (`@nestjs/schedule`) lo invoca **una vez al día a las 00:00 del día del
evento** siguiendo el patrón obligatorio "estado en fila + barrido periódico" (nunca
Lambda/EventBridge ni timers exactos); el trabajo pendiente es estado en la BBDD
(`RESERVA.estado` + `fecha_evento` + los tres `*_status`). El barrido DEBE procesar **todas
las candidatas del mismo pase** y devolver un **resumen** (candidatas evaluadas, eventos
iniciados, candidatas con precondiciones incumplidas, fallos aislados). (Fuente: `US-031
§Historia`, `§Reglas de negocio`, `§Reglas de Validación`; `CLAUDE.md §Jobs asíncronos`;
`architecture.md §2.5`; skill `async-jobs`; patrón de US-012/US-026; `use-cases.md` UC-23.)

#### Scenario: El cron invoca el barrido con token válido e inicia los eventos elegibles

- **GIVEN** una o más RESERVA en `estado = 'reserva_confirmada'` con `fecha_evento = hoy` y
  las tres precondiciones cumplidas (`pre_evento_status = cerrado`, `liquidacion_status =
  cobrada`, `fianza_status = cobrada`), en uno o varios tenants
- **WHEN** el cron invoca el barrido de eventos con la cabecera `X-Cron-Token` válida
- **THEN** el sistema transiciona cada candidata cumplidora a `estado = evento_en_curso` bajo
  el contexto RLS de su tenant
- **AND** devuelve un resumen con el nº de candidatas evaluadas, eventos iniciados, candidatas
  con precondiciones incumplidas y fallos aislados

#### Scenario: Llamada sin token o con token inválido se rechaza

- **GIVEN** una petición al barrido de eventos sin `X-Cron-Token` o con un valor que no
  coincide con `CRON_TOKEN`
- **WHEN** el sistema recibe la petición
- **THEN** la rechaza con error de autorización (401)
- **AND** no transiciona ninguna RESERVA

### Requirement: Transición atómica a evento_en_curso solo con las tres precondiciones cumplidas

El sistema SHALL (DEBE), por cada RESERVA candidata (`estado = 'reserva_confirmada'`,
`fecha_evento = hoy`), evaluar las **tres precondiciones en una única lectura de la fila**
dentro de una **transacción atómica** bajo el contexto RLS de su tenant: si `pre_evento_status
= 'cerrado'` **AND** `liquidacion_status = 'cobrada'` **AND** `fianza_status = 'cobrada'`,
transicionar `RESERVA.estado` de `reserva_confirmada` a `evento_en_curso` y registrar en
`AUDIT_LOG` una entrada con `accion = 'transicion'`, `entidad = 'RESERVA'`, `datos_anteriores
= {estado: reserva_confirmada}` y `datos_nuevos = {estado: evento_en_curso}`, con origen
**Sistema**. La transición se modela en la **máquina de estados declarativa** del agregado
RESERVA (guarda de origen `reserva_confirmada → evento_en_curso` como estructura de datos, NO
`if` dispersos), y la guarda de las tres precondiciones se **re-evalúa dentro de la
transacción bajo el lock de la fila** (`SELECT … FOR UPDATE`). (Fuente: `US-031 §Happy Path`,
`§Reglas de negocio`, `§Reglas de Validación`; `CLAUDE.md §Máquina de estados`; UC-23.)

#### Scenario: RESERVA confirmada con las tres precondiciones y fecha_evento hoy transiciona

- **GIVEN** una RESERVA en `estado = 'reserva_confirmada'`, `fecha_evento = hoy`,
  `pre_evento_status = cerrado`, `liquidacion_status = cobrada` y `fianza_status = cobrada`
- **WHEN** el barrido de T-0 se ejecuta
- **THEN** en una transacción atómica el sistema fija `RESERVA.estado = evento_en_curso`
- **AND** registra en `AUDIT_LOG` `accion = 'transicion'`, `entidad = 'RESERVA'`,
  `datos_anteriores = {estado: reserva_confirmada}`, `datos_nuevos = {estado: evento_en_curso}`
  con origen Sistema
- **AND** la RESERVA queda en el estado que habilita la vista móvil "evento en curso" y el
  checklist de documentación pendiente (superficie de US-033/US-034)

### Requirement: Precondiciones incumplidas — no transiciona y alerta crítica al gestor

El sistema SHALL (DEBE), cuando una RESERVA candidata (`estado = 'reserva_confirmada'`,
`fecha_evento = hoy`) NO cumpla las tres precondiciones (alguna de `pre_evento_status`,
`liquidacion_status`, `fianza_status` distinta de su valor requerido), **NO** transicionar la
RESERVA (permanece en `reserva_confirmada`) y generar una **alerta crítica al gestor** que
enumere las precondiciones incumplidas (p. ej. "El evento de hoy [código reserva] tiene
precondiciones incumplidas: [lista]. Puedes forzar el inicio manualmente."). El **forzado
manual** de la transición corresponde a **US-032** y queda fuera de este alcance. El resumen
del barrido DEBE contabilizar estas candidatas como precondiciones incumplidas. (Fuente:
`US-031 §Precondiciones incumplidas — cron no transiciona`, `§Reglas de negocio`; UC-23 FA-01
→ US-032.)

#### Scenario: Liquidación no cobrada el día del evento — no transiciona y alerta

- **GIVEN** una RESERVA en `estado = 'reserva_confirmada'`, `fecha_evento = hoy`,
  `pre_evento_status = cerrado`, `fianza_status = cobrada` pero `liquidacion_status =
  facturada` (no `cobrada`)
- **WHEN** el barrido de T-0 evalúa la RESERVA
- **THEN** el sistema no transiciona: `RESERVA.estado` permanece `reserva_confirmada`
- **AND** genera una alerta crítica al gestor enumerando la precondición incumplida
  (`liquidacion_status`)
- **AND** no registra ninguna entrada de transición en `AUDIT_LOG` para esa RESERVA

### Requirement: A29 — alerta no bloqueante si las condiciones particulares no están firmadas

El sistema SHALL (DEBE), como **efecto colateral no bloqueante** (automatización A29),
generar una **alerta al gestor** cuando `RESERVA.cond_part_firmadas = false` el día del evento
("Las condiciones particulares de esta reserva no están firmadas. El cliente puede firmarlas
presencialmente."). A29 NO DEBE impedir la transición: si las tres precondiciones se cumplen,
la RESERVA transiciona a `evento_en_curso` **igualmente**. A29 se evalúa con **independencia**
del resultado de la transición (se dispara aunque la transición se ejecute). (Fuente: `US-031
§A29 — Condiciones particulares no firmadas el día del evento`, `§Contexto de Negocio` A29.)

#### Scenario: Tres precondiciones cumplidas pero condiciones particulares no firmadas

- **GIVEN** una RESERVA en `estado = 'reserva_confirmada'`, `fecha_evento = hoy`, las tres
  precondiciones cumplidas y `cond_part_firmadas = false`
- **WHEN** el barrido de T-0 ejecuta la transición
- **THEN** `RESERVA.estado = evento_en_curso` (la transición se ejecuta igualmente)
- **AND** el gestor recibe una alerta NO bloqueante sobre las condiciones particulares no
  firmadas (A29), sin que impida ni revierta el inicio del evento

### Requirement: Filtro estricto por estado y fecha — solo reserva_confirmada con fecha_evento hoy

El sistema SHALL (DEBE) aplicar el inicio automático **únicamente** a RESERVA en `estado =
'reserva_confirmada'` cuya `fecha_evento` sea **hoy** (`date(fecha_evento) = date(hoy)`).
Cualquier RESERVA en otro estado (`consulta`, `pre_reserva`, `reserva_cancelada`,
`reserva_completada`, `evento_en_curso`, `post_evento`) NO DEBE ser transicionada por este
barrido, **aunque** su `fecha_evento = hoy`; y ninguna RESERVA con `fecha_evento` distinta de
hoy (pasado o futuro) DEBE entrar en el pase. La comparación es por **fecha de calendario del
evento** (no por instante ni por un `ttl_expiracion`) usando una definición única de "hoy" por
pase, blindando el off-by-one de zona horaria (la selección NO depende de ningún string
formateado). El filtro por estado forma parte de la selección de candidatas (cero falsos
positivos sobre otros estados). (Fuente: `US-031 §Reglas de negocio`, `§Reglas de Validación`;
UC-23.)

#### Scenario: RESERVA en otro estado con fecha_evento hoy no se transiciona

- **GIVEN** una RESERVA en `estado = 'pre_reserva'` (o `consulta`, `reserva_cancelada`,
  `reserva_completada`, `post_evento`) con `fecha_evento = hoy`
- **WHEN** el barrido de T-0 se ejecuta
- **THEN** el sistema no aplica el inicio automático a esa RESERVA (el filtro incluye solo
  `estado = 'reserva_confirmada'`)
- **AND** la RESERVA no se modifica

#### Scenario: Solo los eventos de hoy entran en el pase

- **GIVEN** RESERVA confirmadas con las tres precondiciones cumplidas: una con `fecha_evento =
  hoy`, otra con `fecha_evento = mañana`, otra con `fecha_evento = ayer`
- **WHEN** el barrido de T-0 se ejecuta hoy
- **THEN** solo se transiciona la RESERVA con `fecha_evento = hoy`
- **AND** las de mañana y ayer no se modifican en este pase

### Requirement: Idempotencia del barrido — reserva ya en evento_en_curso no se re-transiciona

El sistema SHALL (DEBE) ser idempotente: una RESERVA con `estado = 'evento_en_curso'`
(transicionada por un pase anterior o por el gestor vía US-032) **no** es candidata (el filtro
`estado = 'reserva_confirmada'` la excluye) y NO DEBE ser modificada ni generar entrada
duplicada en `AUDIT_LOG`. N ejecuciones del barrido sobre la misma RESERVA = **1 sola**
transición y **1 sola** entrada de transición. La guarda de origen se **re-evalúa dentro** de
la transacción de cada RESERVA (bajo `SELECT … FOR UPDATE`) para que un reintento o un pase
concurrente re-lea el `estado` ya actualizado y termine como no-op. (Fuente: `US-031
§Idempotencia — reserva ya en evento_en_curso`, `§Reglas de Validación`.)

#### Scenario: Segunda ejecución del barrido no re-transiciona un evento ya en curso

- **GIVEN** una RESERVA que ya fue transicionada por un pase anterior del barrido (`estado =
  evento_en_curso`) con `fecha_evento = hoy`
- **WHEN** el barrido se ejecuta de nuevo y la evalúa
- **THEN** la RESERVA no está entre las candidatas y no se modifica
- **AND** no se genera ninguna entrada nueva ni duplicada en `AUDIT_LOG`

### Requirement: Concurrencia cron vs gestor — exactamente una transición gana sin error

El sistema SHALL (DEBE) garantizar que, cuando el barrido de Sistema y el gestor (US-032)
intentan transicionar **simultáneamente** la misma RESERVA de `reserva_confirmada` a
`evento_en_curso`, **exactamente una** operación tiene éxito y actualiza `RESERVA.estado =
evento_en_curso`; la segunda operación detecta bajo el lock que el estado ya no es
`reserva_confirmada` (la UPDATE afecta **0 filas**) y termina como **no-op sin error**. El
`AUDIT_LOG` DEBE contener **exactamente una** entrada de transición. La serialización la da
PostgreSQL sobre la fila RESERVA (`SELECT … FOR UPDATE`), sin locks distribuidos (Redis/Redlock
prohibidos). (Fuente: `US-031 §Concurrencia / Race Conditions`; `CLAUDE.md §Regla crítica:
bloqueo atómico` y `§Jobs asíncronos`.)

#### Scenario: Cron y gestor compiten por la misma RESERVA

- **GIVEN** una RESERVA en `estado = 'reserva_confirmada'` con las tres precondiciones
  cumplidas y `fecha_evento = hoy`, sobre la que el cron y el gestor (US-032) ejecutan la
  transición en la misma ventana temporal
- **WHEN** ambas operaciones leen `estado = reserva_confirmada` y ejecutan la UPDATE bajo el
  lock de la fila
- **THEN** exactamente una tiene éxito y fija `estado = evento_en_curso`
- **AND** la segunda observa que el estado ya no es `reserva_confirmada` (0 filas afectadas) y
  termina como no-op sin error
- **AND** `AUDIT_LOG` contiene exactamente una entrada de transición para esa RESERVA

### Requirement: Procesa todas las elegibles con aislamiento de fallos por RESERVA

El sistema SHALL (DEBE) procesar **todas** las RESERVA elegibles del mismo pase, cada una en
su **propia transacción independiente**: el fallo de una transición (excepción, conflicto,
guarda) NO DEBE abortar ni revertir las transiciones de las demás candidatas; el resumen del
barrido registra los fallos aislados. Cuando existen varias RESERVA con `fecha_evento = hoy`,
el sistema transiciona todas las que están en `reserva_confirmada` con las tres precondiciones
cumplidas (una entrada de transición independiente por cada inicio efectivo), omite las que ya
están en `evento_en_curso` y alerta las que tienen precondiciones incumplidas. (Fuente:
`US-031 §Impacto de Negocio`; patrón de fallo aislado de US-012/US-026.)

#### Scenario: Varias reservas de hoy — cumplidoras inician, incumplidoras alertan, ya iniciada se omite

- **GIVEN** cuatro RESERVA distintas con `fecha_evento = hoy`: dos en `reserva_confirmada` con
  las tres precondiciones cumplidas, una en `reserva_confirmada` con una precondición
  incumplida, y una ya en `evento_en_curso`
- **WHEN** el barrido de T-0 se ejecuta
- **THEN** el sistema transiciona las dos cumplidoras a `evento_en_curso` (dos entradas de
  transición en `AUDIT_LOG`), no transiciona la incumplidora (alerta crítica) y omite la que ya
  estaba en `evento_en_curso` (cero acción)
- **AND** el resumen refleja dos eventos iniciados y una candidata con precondiciones
  incumplidas

#### Scenario: Un fallo parcial en una candidata no revierte las demás

- **GIVEN** un barrido con N candidatas donde la transición de una falla
- **WHEN** el sistema procesa el pase
- **THEN** cada candidata se procesa en su propia transacción independiente
- **AND** el fallo de una no revierte ni impide la transición de las demás
- **AND** el resumen del barrido refleja la candidata fallida como fallo aislado

### Requirement: La auditoría del inicio automático registra el origen Sistema

El sistema SHALL (DEBE) registrar cada transición automática a `evento_en_curso` en
`AUDIT_LOG` con origen **Sistema** (no un `USUARIO`): `accion = 'transicion'`, `entidad =
'RESERVA'`, sin `usuario_id` de usuario (nulo/no-usuario), `datos_anteriores = {estado:
reserva_confirmada}`, `datos_nuevos = {estado: evento_en_curso}` (con la causa de la
automatización reflejada en `datos_nuevos`). Esta convención es la misma que usan los barridos
de Sistema de US-012 (expiración) y US-026 (cierre de fichas). El `AUDIT_LOG` es **obligatorio**
en toda transición de estado ejecutada por el cron. (Fuente: `US-031 §Happy Path`, `§Reglas de
Validación`; `er-diagram.md` AUDIT_LOG; convención de auditoría de Sistema de US-012/US-026.)

#### Scenario: El inicio automático se audita como acción de Sistema

- **GIVEN** una RESERVA candidata que el barrido transiciona a `evento_en_curso`
- **WHEN** el sistema registra la transición en `AUDIT_LOG`
- **THEN** la entrada tiene `accion = 'transicion'`, `entidad = 'RESERVA'`, `datos_anteriores =
  {estado: reserva_confirmada}`, `datos_nuevos = {estado: evento_en_curso}` y **no** un
  `usuario_id` de usuario final (origen Sistema)
- **AND** refleja la causa de la automatización de inicio de evento en `datos_nuevos`

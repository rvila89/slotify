# consultas Specification

## ADDED Requirements

### Requirement: Barrido periódico protegido de archivado automático a reserva_completada en T+7d

El sistema SHALL (DEBE) exponer un **barrido interno protegido** que, al ser invocado, seleccione
todas las RESERVA con `estado = 'post_evento'` cuyo **tiempo en `post_evento` sea ≥ 7 días
naturales** (T+7d) y, para cada una que cumpla la **guarda de fianza resuelta** (`fianza_status ∈
{devuelta, retenida_parcial}` **O** `fianza_eur <= 0` **O** `fianza_eur IS NULL`), transicione
automáticamente `RESERVA.estado` de `post_evento` a `reserva_completada` (estado **terminal e
inmutable**). El barrido SHALL (DEBE) autenticarse **service-to-service** mediante la cabecera
`X-Cron-Token` (comparada con `CRON_TOKEN` del entorno vía `CronTokenGuard`); NO DEBE ser accesible
con JWT de usuario ni desde el exterior. Un **cron scheduler** (`@nestjs/schedule`) lo invoca **una
vez al día** siguiendo el patrón obligatorio "estado en fila + barrido periódico" (nunca
Lambda/EventBridge ni timers exactos); el trabajo pendiente es estado en la BBDD (`RESERVA.estado
= post_evento` + el momento de entrada a `post_evento` + la guarda de fianza). El barrido se expone
como **endpoint DEDICADO** `POST /cron/barrido-completadas` (gemelo de `POST /cron/barrido-eventos`
de US-031 y `POST /cron/barrido-expiracion` de US-012), y NO DEBE reutilizar `POST /cron/barrido` ni
un dispatch por `?tarea=` (ese dispatch no está implementado en el repo). El barrido DEBE procesar
**todas las candidatas del mismo pase** y devolver un **resumen** (candidatas evaluadas, reservas
archivadas, candidatas con fianza pendiente, fallos aislados). (Fuente: `US-037 §Historia`, `§Reglas
de negocio`, `§Reglas de Validación`; `CLAUDE.md §Jobs asíncronos`; `architecture.md §2.5`; skill
`async-jobs`; patrón de US-012/US-026/US-031; `use-cases.md` UC-28.)

#### Scenario: El cron invoca el barrido con token válido y archiva las reservas elegibles

- **GIVEN** una o más RESERVA en `estado = 'post_evento'` con ≥ 7 días naturales en ese estado y la
  guarda de fianza resuelta, en uno o varios tenants
- **WHEN** el cron invoca el barrido con la cabecera `X-Cron-Token` válida
- **THEN** el sistema transiciona cada candidata cumplidora a `estado = reserva_completada` bajo el
  contexto RLS de su tenant
- **AND** devuelve un resumen con el nº de candidatas evaluadas, reservas archivadas, candidatas con
  fianza pendiente y fallos aislados

#### Scenario: Llamada sin token o con token inválido se rechaza

- **GIVEN** una petición al barrido de archivado sin `X-Cron-Token` o con un valor que no coincide
  con `CRON_TOKEN`
- **WHEN** el sistema recibe la petición
- **THEN** la rechaza con error de autorización (401)
- **AND** no transiciona ninguna RESERVA

### Requirement: Transición atómica a reserva_completada solo con la guarda de fianza resuelta

El sistema SHALL (DEBE), por cada RESERVA candidata (`estado = 'post_evento'`, ≥ 7 días naturales en
`post_evento`), evaluar la **guarda de fianza resuelta en una única lectura de la fila** dentro de
una **transacción atómica** bajo el contexto RLS de su tenant: si `fianza_status ∈ {devuelta,
retenida_parcial}` **O** `fianza_eur <= 0` **O** `fianza_eur IS NULL`, transicionar `RESERVA.estado`
de `post_evento` a `reserva_completada` y registrar en `AUDIT_LOG` una entrada con `accion =
'transicion'`, `entidad = 'RESERVA'`, `datos_anteriores = {estado: post_evento}` y `datos_nuevos =
{estado: reserva_completada, causa: 'T+7d'}`, con origen **Sistema** (`usuario_id` nulo). La
transición se modela en la **máquina de estados declarativa** del agregado RESERVA (arista
`post_evento → reserva_completada` como estructura de datos, NO `if` dispersos, misma forma que
`MAPA_FINALIZACION_EVENTO` de US-034 y `MAPA_INICIO_EVENTO` de US-031); `reserva_completada` es
**terminal** (sin arista de salida). La guarda de origen y la guarda de fianza se **re-evalúan
dentro de la transacción bajo el lock de la fila** (`SELECT … FOR UPDATE`). (Fuente: `US-037 §Happy
Path`, `§Reglas de negocio`, `§Reglas de Validación`; `CLAUDE.md §Máquina de estados`; UC-28;
guarda de fianza de US-036.)

#### Scenario: Fianza devuelta y T+7d cumplido — archiva

- **GIVEN** una RESERVA en `estado = 'post_evento'`, `fianza_status = devuelta` y ≥ 7 días naturales
  en `post_evento`
- **WHEN** el barrido se ejecuta
- **THEN** en una transacción atómica el sistema fija `RESERVA.estado = reserva_completada`
- **AND** registra en `AUDIT_LOG` `accion = 'transicion'`, `entidad = 'RESERVA'`, `datos_anteriores
  = {estado: post_evento}`, `datos_nuevos = {estado: reserva_completada, causa: 'T+7d'}` con origen
  Sistema
- **AND** la RESERVA queda visible y filtrable en el módulo Histórico y no se envía ningún email al
  cliente ni al gestor

#### Scenario: Sin fianza (fianza_eur = 0 o NULL) — archiva sin evaluar fianza_status

- **GIVEN** una RESERVA en `estado = 'post_evento'`, `fianza_eur = 0` (tenant sin fianza) o
  `fianza_eur IS NULL`, y ≥ 7 días naturales en `post_evento`
- **WHEN** el barrido se ejecuta
- **THEN** la guarda de fianza se satisface por ausencia de fianza (no se evalúa `fianza_status`) y
  el sistema fija `RESERVA.estado = reserva_completada`
- **AND** la RESERVA queda visible y filtrable en el módulo Histórico

#### Scenario: Retención total (retenida_parcial con importe devuelto 0) — es estado resuelto válido

- **GIVEN** una RESERVA en `estado = 'post_evento'`, `fianza_status = retenida_parcial`,
  `fianza_devuelta_eur = 0.00` (retención del 100%) y ≥ 7 días naturales en `post_evento`
- **WHEN** el barrido se ejecuta
- **THEN** el sistema trata `retenida_parcial` (con cualquier importe devuelto, incluido 0) como
  fianza resuelta y fija `RESERVA.estado = reserva_completada`

### Requirement: Fianza no resuelta en T+7d — no archiva y emite alerta interna al gestor sin duplicar

El sistema SHALL (DEBE), cuando una RESERVA candidata (`estado = 'post_evento'`, ≥ 7 días naturales
en `post_evento`) NO cumpla la guarda de fianza resuelta (p. ej. `fianza_status = cobrada` con
`fianza_eur > 0`, o `pendiente`/`recibo_enviado` con importe), **NO** transicionar la RESERVA
(permanece en `post_evento`) y emitir una **alerta interna al gestor**: "⚠️ La reserva [código]
lleva más de 7 días en post_evento con fianza pendiente de resolución. Registra la devolución o
retención (US-036) para poder archivarla." La alerta NO DEBE **duplicarse** en cada ejecución del
cron mientras el estado no cambie (anti-duplicación por flag/idempotencia; el mecanismo concreto es
decisión de diseño). El resumen del barrido DEBE contabilizar estas candidatas como fianza
pendiente. La operación NO DEBE registrar entrada de transición en `AUDIT_LOG` para estas RESERVA.
(Fuente: `US-037 §FA-01 — Fianza no resuelta en T+7d`, `§Reglas de negocio`; UC-28; US-036.)

#### Scenario: Fianza cobrada pero sin resolver en T+7d — no archiva y alerta

- **GIVEN** una RESERVA en `estado = 'post_evento'`, `fianza_status = cobrada`, `fianza_eur > 0`
  (sin devolución ni retención registradas) y ≥ 7 días naturales en `post_evento`
- **WHEN** el barrido evalúa la RESERVA
- **THEN** el sistema no transiciona: `RESERVA.estado` permanece `post_evento`
- **AND** emite una alerta interna al gestor con el código de la reserva remitiendo a US-036
- **AND** no registra ninguna entrada de transición en `AUDIT_LOG` para esa RESERVA

#### Scenario: La alerta de fianza pendiente no se duplica en barridos sucesivos

- **GIVEN** una RESERVA en `post_evento` con fianza no resuelta que ya generó la alerta en un pase
  anterior y cuyo estado y estado de fianza no han cambiado
- **WHEN** el barrido se ejecuta de nuevo
- **THEN** el sistema no vuelve a emitir una alerta duplicada para esa RESERVA
- **AND** la RESERVA sigue sin archivarse (permanece en `post_evento`)

### Requirement: Filtro estricto por estado y antigüedad — solo post_evento con ≥ 7 días naturales

El sistema SHALL (DEBE) aplicar el archivado automático **únicamente** a RESERVA en `estado =
'post_evento'` cuyo tiempo en ese estado sea **≥ 7 días naturales** (T+7d). Cualquier RESERVA en
otro estado (`consulta`, `pre_reserva`, `reserva_confirmada`, `evento_en_curso`,
`reserva_completada`, `reserva_cancelada`) NO DEBE ser transicionada por este barrido; y ninguna
RESERVA que lleve menos de 7 días en `post_evento` DEBE entrar en el pase. La comparación de
antigüedad se hace sobre el **momento de entrada a `post_evento`** determinado por el mecanismo
elegido en el gate (nuevo campo `fechaPostEvento`, derivación de `AUDIT_LOG`, o `fechaActualizacion`
— ver `design.md §D-2`); NO DEBE depender de un string formateado (blindaje del off-by-one de TZ
conocido en presentación). El filtro por estado forma parte de la selección de candidatas (cero
falsos positivos sobre otros estados). (Fuente: `US-037 §Reglas de negocio`, `§Reglas de
Validación`; UC-28.)

#### Scenario: RESERVA en otro estado no se archiva

- **GIVEN** una RESERVA en `estado = 'reserva_confirmada'` (o `consulta`, `pre_reserva`,
  `evento_en_curso`, `reserva_cancelada`)
- **WHEN** el barrido se ejecuta
- **THEN** el sistema no aplica el archivado automático a esa RESERVA (el filtro incluye solo
  `estado = 'post_evento'`)
- **AND** la RESERVA no se modifica

#### Scenario: RESERVA con menos de 7 días en post_evento no entra en el pase

- **GIVEN** una RESERVA en `estado = 'post_evento'` con la fianza resuelta pero solo 3 días
  naturales en `post_evento`
- **WHEN** el barrido se ejecuta
- **THEN** el sistema no la archiva (no cumple T+7d)
- **AND** la RESERVA permanece en `post_evento`

### Requirement: Idempotencia del barrido — reserva ya en reserva_completada no se re-archiva

El sistema SHALL (DEBE) ser idempotente: una RESERVA con `estado = 'reserva_completada'` (archivada
por un pase anterior del cron o por el archivado manual de US-038) **no** es candidata (el filtro
`estado = 'post_evento'` la excluye) y NO DEBE ser modificada ni generar entrada en `AUDIT_LOG`.
Leer `estado = reserva_completada` es suficiente para saltar la RESERVA. N ejecuciones del barrido
sobre la misma RESERVA = **1 sola** transición y **1 sola** entrada de transición. La guarda de
origen se **re-evalúa dentro** de la transacción de cada RESERVA (bajo `SELECT … FOR UPDATE`) para
que un reintento o un pase concurrente re-lea el `estado` ya actualizado y termine como no-op.
(Fuente: `US-037 §FA-02 — Idempotencia (reserva ya archivada)`, `§Reglas de Validación`.)

#### Scenario: Segunda ejecución del barrido no re-archiva una reserva ya completada

- **GIVEN** una RESERVA que ya fue archivada por un pase anterior o por US-038 (`estado =
  reserva_completada`)
- **WHEN** el barrido se ejecuta de nuevo y la evalúa
- **THEN** la RESERVA no está entre las candidatas y no se modifica
- **AND** no se genera ninguna entrada nueva ni duplicada en `AUDIT_LOG`

### Requirement: Concurrencia cron vs archivado manual (US-038) — exactamente una transición gana sin error

El sistema SHALL (DEBE) garantizar que, cuando el barrido de Sistema (US-037) y el gestor mediante
el archivado manual (US-038) intentan transicionar **simultáneamente** la misma RESERVA de
`post_evento` a `reserva_completada`, **exactamente una** operación tiene éxito y actualiza
`RESERVA.estado = reserva_completada`; la segunda detecta bajo el lock que el estado ya no es
`post_evento` (la UPDATE afecta **0 filas**) y termina como **no-op sin error**, sin duplicar el
registro en `AUDIT_LOG` ni generar estado inconsistente. El chequeo del estado actual dentro de la
transacción (patrón "leer-verificar-actualizar" en una única transacción con `SELECT … FOR UPDATE`)
evita la ventana de carrera. La serialización la da PostgreSQL sobre la fila RESERVA, sin locks
distribuidos (Redis/Redlock prohibidos). (Fuente: `US-037 §Concurrencia / Race Conditions`;
`CLAUDE.md §Regla crítica: bloqueo atómico` y `§Jobs asíncronos`.)

#### Scenario: Cron y archivado manual compiten por la misma RESERVA

- **GIVEN** una RESERVA en `estado = 'post_evento'` con la fianza resuelta y ≥ 7 días en
  `post_evento`, sobre la que el cron (US-037) y el gestor (US-038) ejecutan la transición en la
  misma ventana temporal
- **WHEN** ambas operaciones leen `estado = post_evento` y ejecutan la UPDATE bajo el lock de la
  fila
- **THEN** exactamente una tiene éxito y fija `estado = reserva_completada`
- **AND** la segunda observa que el estado ya no es `post_evento` (0 filas afectadas) y termina como
  no-op sin error
- **AND** `AUDIT_LOG` contiene exactamente una entrada de transición para esa RESERVA

### Requirement: El barrido de archivado procesa todas las elegibles con aislamiento de fallos por RESERVA

El sistema SHALL (DEBE) procesar **todas** las RESERVA elegibles del mismo pase, cada una en su
**propia transacción independiente**: el fallo de una transición (excepción, conflicto, guarda) NO
DEBE abortar ni revertir las transiciones de las demás candidatas; el resumen del barrido registra
los fallos aislados. Cuando existen varias RESERVA en `post_evento` con ≥ 7 días, el sistema archiva
todas las que cumplen la guarda de fianza (una entrada de transición independiente por cada
archivado), omite las que ya están en `reserva_completada` y alerta las que tienen fianza pendiente.
(Fuente: `US-037 §Impacto de Negocio`; patrón de fallo aislado de US-012/US-026/US-031.)

#### Scenario: Varias reservas — resueltas archivan, pendientes alertan, ya completada se omite

- **GIVEN** cuatro RESERVA distintas con ≥ 7 días en su estado: dos en `post_evento` con la fianza
  resuelta, una en `post_evento` con fianza no resuelta (`cobrada`, importe > 0), y una ya en
  `reserva_completada`
- **WHEN** el barrido se ejecuta
- **THEN** el sistema archiva las dos resueltas a `reserva_completada` (dos entradas de transición
  en `AUDIT_LOG`), no archiva la de fianza pendiente (alerta interna) y omite la ya completada (cero
  acción)
- **AND** el resumen refleja dos reservas archivadas y una candidata con fianza pendiente

#### Scenario: Un fallo parcial en una candidata no revierte las demás

- **GIVEN** un barrido con N candidatas donde la transición de una falla
- **WHEN** el sistema procesa el pase
- **THEN** cada candidata se procesa en su propia transacción independiente
- **AND** el fallo de una no revierte ni impide la transición de las demás
- **AND** el resumen del barrido refleja la candidata fallida como fallo aislado

### Requirement: La auditoría del archivado automático registra el origen Sistema

El sistema SHALL (DEBE) registrar cada transición automática a `reserva_completada` en `AUDIT_LOG`
con origen **Sistema** (no un `USUARIO`): `accion = 'transicion'`, `entidad = 'RESERVA'`, sin
`usuario_id` de usuario (nulo), `datos_anteriores = {estado: post_evento}`, `datos_nuevos = {estado:
reserva_completada, causa: 'T+7d'}`. Esta convención es la misma que usan los barridos de Sistema de
US-012 (expiración), US-026 (cierre de fichas) y US-031 (inicio de evento). El `AUDIT_LOG` es
**obligatorio** en toda transición ejecutada por el cron y NO se escribe cuando la RESERVA ya está
en `reserva_completada` (idempotencia). (Fuente: `US-037 §Happy Path`, `§Reglas de Validación`;
`er-diagram.md` AUDIT_LOG; convención de auditoría de Sistema de US-012/US-026/US-031.)

#### Scenario: El archivado automático se audita como acción de Sistema

- **GIVEN** una RESERVA candidata que el barrido archiva a `reserva_completada`
- **WHEN** el sistema registra la transición en `AUDIT_LOG`
- **THEN** la entrada tiene `accion = 'transicion'`, `entidad = 'RESERVA'`, `datos_anteriores =
  {estado: post_evento}`, `datos_nuevos = {estado: reserva_completada, causa: 'T+7d'}` y **no** un
  `usuario_id` de usuario final (origen Sistema)

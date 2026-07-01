# consultas Specification

## ADDED Requirements

### Requirement: Barrido periódico protegido de expiración por TTL agotado (A4/A5/A21/A21b)

El sistema SHALL (DEBE) exponer un **endpoint interno protegido de barrido** que, al
ser invocado, seleccione todas las RESERVA con `ttl_expiracion < now()` **AND**
(`sub_estado ∈ {'2b','2c','2v'}` **OR** `estado = 'pre_reserva'`) y procese la
expiración de cada una. El endpoint SHALL (DEBE) autenticarse **service-to-service**
mediante la cabecera `X-Cron-Token` (comparada con `CRON_TOKEN` del entorno); NO DEBE
ser accesible con JWT de usuario ni desde el exterior. Un **cron scheduler**
(`@nestjs/schedule`) lo invoca periódicamente siguiendo el patrón obligatorio "estado
en fila + barrido periódico" (nunca Lambda/EventBridge ni timers exactos). La
selección de candidatas SHALL (DEBE) comparar **instantes** (`timestamptz`), nunca
fechas formateadas. El endpoint DEBE devolver un **resumen** del barrido (candidatas,
expiradas, promociones disparadas, fallos aislados). (Fuente: `US-012 §Trigger`,
`§Reglas de negocio`, `§Reglas de Validación`; `CLAUDE.md §Jobs asíncronos`; skill
`async-jobs`; `us-041 design.md §D-9`.)

#### Scenario: El cron invoca el endpoint con token válido y barre las candidatas

- **GIVEN** una o más RESERVA con `ttl_expiracion < now()` en `sub_estado ∈
  {'2b','2c','2v'}` o `estado = 'pre_reserva'` para uno o varios tenants
- **WHEN** el cron invoca el endpoint de barrido con la cabecera `X-Cron-Token` válida
- **THEN** el sistema procesa la expiración de cada candidata bajo el contexto RLS de
  su tenant
- **AND** devuelve un resumen con el nº de candidatas, expiradas, promociones
  disparadas y fallos aislados

#### Scenario: Llamada sin token o con token inválido se rechaza

- **GIVEN** una petición al endpoint de barrido sin `X-Cron-Token` o con un valor que
  no coincide con `CRON_TOKEN`
- **WHEN** el sistema recibe la petición
- **THEN** la rechaza con error de autorización (401)
- **AND** no procesa ninguna expiración

#### Scenario: La selección compara instantes, no fechas formateadas

- **GIVEN** una RESERVA cuyo `ttl_expiracion` es un instante anterior a `now()` pero
  cuya fecha formateada podría diferir por zona horaria
- **WHEN** el barrido evalúa las candidatas
- **THEN** la inclusión se decide por el instante `ttl_expiracion < now()`
  (`timestamptz`), sin depender de ningún formateo de fecha

### Requirement: Expiración en 2.b sin cola transiciona a 2.x y libera la fecha (A4)

El sistema SHALL (DEBE), por cada RESERVA candidata en `sub_estado = '2b'` sin ninguna
RESERVA en `sub_estado = '2d'` apuntándola, ejecutar en una **transacción atómica**:
transicionar la RESERVA a `sub_estado = '2x'`, **liberar** la fila de `FECHA_BLOQUEADA`
de esa RESERVA reutilizando `liberarFecha()` (US-041) con causa `TTL`, y registrar en
`AUDIT_LOG` una entrada con `accion = 'transicion'`, `entidad = 'RESERVA'`,
`datos_anteriores.sub_estado = '2b'` y `datos_nuevos.sub_estado = '2x'`. La transición
se modela en la **máquina de estados declarativa** (no `if` dispersos). Tras la
expiración, el sistema DEBE dejar constancia para una **alerta interna** al gestor
("Consulta [código] expirada. Fecha [fecha] liberada."), sin enviar email al cliente
(fuera de MVP). (Fuente: `US-012 §Happy Path — 2.b sin cola`, `§Email relacionado`;
UC-09; A4.)

#### Scenario: Consulta en 2.b sin cola expira a 2.x y libera la fecha

- **GIVEN** una RESERVA en `sub_estado = '2b'`, `ttl_expiracion < now()`, sin ninguna
  RESERVA en `sub_estado = '2d'` apuntándola
- **WHEN** el barrido procesa la expiración de esa RESERVA
- **THEN** en una transacción atómica la RESERVA pasa a `sub_estado = '2x'` y la fila
  de `FECHA_BLOQUEADA` con `reserva_id` de esa RESERVA se elimina
- **AND** se registra en `AUDIT_LOG` `accion = 'transicion'`, `entidad = 'RESERVA'`,
  `datos_anteriores.sub_estado = '2b'`, `datos_nuevos.sub_estado = '2x'`
- **AND** el sistema deja constancia para la alerta interna al gestor, sin email al
  cliente

### Requirement: Expiración en 2.b con cola transiciona a 2.x y dispara la promoción (A4 + A15/US-018)

El sistema SHALL (DEBE), por cada RESERVA candidata en `sub_estado = '2b'` que es
`consulta_bloqueante` de una o más RESERVA en `sub_estado = '2d'`, ejecutar la misma
expiración atómica (RESERVA → `2x`, `FECHA_BLOQUEADA` liberada, auditoría) y, tras
liberar, **disparar exactamente una vez** el seam de promoción de cola
(`PromocionColaPort.promoverPrimeroEnCola()`, US-041) para esa `(tenant, fecha)`. La
**reordenación FIFO de la cola, el re-bloqueo de la promovida (nueva fila en
`FECHA_BLOQUEADA` con `tipo_bloqueo = 'blando'` y su TTL) y el decremento de
`posicion_cola` (mecánica A15/UC-12) son responsabilidad de US-018** y quedan **fuera
de alcance** de este change; hasta que US-018 se implemente, el seam es un stub no-op
documentado que deja la cola intacta en `2.d` (deuda técnica ligada a US-018). US-012
solo **garantiza el trigger** exactamente-una-vez. (Fuente: `US-012 §Happy Path — 2.b
con cola`, `§Notas`; A4, A15; `us-041 design.md §D-2`.)

#### Scenario: Expiración en 2.b con cola libera la fecha y dispara la promoción una vez

- **GIVEN** una RESERVA en `sub_estado = '2b'`, `ttl_expiracion < now()`, que es
  `consulta_bloqueante` de N RESERVA en `sub_estado = '2d'`
- **WHEN** el barrido procesa la expiración de esa RESERVA
- **THEN** la RESERVA pasa a `sub_estado = '2x'` y su fila de `FECHA_BLOQUEADA` se
  elimina en la misma transacción
- **AND** el seam `PromocionColaPort.promoverPrimeroEnCola()` se invoca exactamente una
  vez para esa `(tenant, fecha)`
- **AND** la reordenación real de la cola y el re-bloqueo de la promovida quedan
  delegados a US-018 (no los ejecuta este change)

### Requirement: Expiración en 2.c transiciona a 2.x y libera la fecha (A4, sin cola posible)

El sistema SHALL (DEBE), por cada RESERVA candidata en `sub_estado = '2c'`, ejecutar la
expiración atómica: RESERVA → `sub_estado = '2x'`, `FECHA_BLOQUEADA` liberada (causa
`TTL`) y auditoría. El sistema NO DEBE disparar promoción de cola para `2.c`: la cola
se vació de forma irreversible al transicionar a `2.c` (mecánica A16/US-007), por lo
que no puede existir cola activa. (Fuente: `US-012 §Happy Path — 2.c`; US-007 vaciado
A16.)

#### Scenario: Consulta en 2.c expira a 2.x sin promoción de cola

- **GIVEN** una RESERVA en `sub_estado = '2c'` con `ttl_expiracion < now()`
- **WHEN** el barrido procesa su expiración
- **THEN** la RESERVA pasa a `sub_estado = '2x'`, su fila de `FECHA_BLOQUEADA` se
  elimina y se registra la auditoría de la transición
- **AND** el seam de promoción de cola NO se invoca (no hay cola posible en `2.c`)

### Requirement: Expiración en 2.v transiciona a 2.x y libera la fecha, con promoción si hereda cola (A21)

El sistema SHALL (DEBE), por cada RESERVA candidata en `sub_estado = '2v'` (bloqueo
hasta el día post-visita agotado), ejecutar la expiración atómica: RESERVA →
`sub_estado = '2x'`, `FECHA_BLOQUEADA` liberada (causa `TTL`) y auditoría. Si la
RESERVA **heredó cola** desde `2.b` (posible cuando llegó a `2.v` sin vaciarla) —esto
es, existe una o más RESERVA en `sub_estado = '2d'` apuntándola—, el sistema DEBE
disparar el seam de promoción (US-018) exactamente una vez; en caso contrario NO lo
dispara. (Fuente: `US-012 §Happy Path — 2.v`; A21.)

#### Scenario: Consulta en 2.v sin cola heredada expira a 2.x sin promoción

- **GIVEN** una RESERVA en `sub_estado = '2v'` con `ttl_expiracion < now()` sin ninguna
  RESERVA en `2.d` apuntándola
- **WHEN** el barrido procesa su expiración
- **THEN** la RESERVA pasa a `sub_estado = '2x'`, la fila de `FECHA_BLOQUEADA` se
  elimina y no se dispara promoción

#### Scenario: Consulta en 2.v con cola heredada expira a 2.x y dispara la promoción

- **GIVEN** una RESERVA en `sub_estado = '2v'` con `ttl_expiracion < now()` que es
  `consulta_bloqueante` de al menos una RESERVA en `2.d`
- **WHEN** el barrido procesa su expiración
- **THEN** la RESERVA pasa a `sub_estado = '2x'`, la fila de `FECHA_BLOQUEADA` se
  elimina y el seam de promoción se invoca exactamente una vez

### Requirement: Expiración en pre_reserva cancela la reserva y libera la fecha (A5)

El sistema SHALL (DEBE), por cada RESERVA candidata en `estado = 'pre_reserva'` (p. ej.
7 días sin justificante de señal), ejecutar en una **transacción atómica**: actualizar
`estado = 'reserva_cancelada'` y `sub_estado = NULL`, **liberar** la fila de
`FECHA_BLOQUEADA` de esa RESERVA (causa `TTL`) y registrar en `AUDIT_LOG` `accion =
'transicion'`, `datos_anteriores.estado = 'pre_reserva'`, `datos_nuevos.estado =
'reserva_cancelada'`. El sistema NO DEBE disparar promoción de cola: al pasar a
`pre_reserva` la cola se vació (A16/US-007 o UC-14), por lo que es imposible tener cola
activa. (Fuente: `US-012 §Happy Path — pre_reserva`, `§FA pre_reserva expirada sin
cola`; A5.)

#### Scenario: Pre-reserva expira a reserva_cancelada y libera la fecha sin promoción

- **GIVEN** una RESERVA en `estado = 'pre_reserva'` con `ttl_expiracion < now()`
- **WHEN** el barrido procesa su expiración
- **THEN** en una transacción atómica la RESERVA pasa a `estado = 'reserva_cancelada'`,
  `sub_estado = NULL`, y su fila de `FECHA_BLOQUEADA` se elimina
- **AND** se registra en `AUDIT_LOG` `accion = 'transicion'`,
  `datos_anteriores.estado = 'pre_reserva'`, `datos_nuevos.estado = 'reserva_cancelada'`
- **AND** el seam de promoción de cola NO se invoca (imposible tener cola en
  `pre_reserva`)

### Requirement: Guarda de origen declarativa — solo estados candidatos expiran; los terminales son inmutables

El sistema SHALL (DEBE) determinar el estado terminal de cada expiración mediante una
**estructura de datos declarativa** (mapa de transiciones por TTL, no condicionales
dispersos): `{consulta, 2b} → {consulta, 2x}`, `{consulta, 2c} → {consulta, 2x}`,
`{consulta, 2v} → {consulta, 2x}`, `{pre_reserva} → {reserva_cancelada, NULL}`.
Cualquier RESERVA que **no** esté en un estado candidato —incluidos los terminales
`2x`, `2y`, `2z`, `reserva_cancelada`, `reserva_completada` (inmutables), o cualquier
otro estado activo— NO DEBE ser expirada aunque su `ttl_expiracion < now()`. La guarda
de origen se evalúa **dentro** de la transacción de cada RESERVA para que un reintento
re-evalúe con el estado ya actualizado. (Fuente: `US-012 §Reglas de negocio`, `§Reglas
de Validación`; `CLAUDE.md §Máquina de estados`; skill `state-machine`.)

#### Scenario: El mapa declarativo resuelve el estado terminal de cada origen

- **GIVEN** una RESERVA candidata en `2b`, `2c`, `2v` o `pre_reserva`
- **WHEN** el barrido determina su estado terminal
- **THEN** devuelve `2x` para `2b`/`2c`/`2v` y `reserva_cancelada` (sub_estado NULL)
  para `pre_reserva`, consultando la tabla declarativa (no `if` dispersos)

#### Scenario: Una RESERVA en estado terminal no se expira aunque su TTL esté vencido

- **GIVEN** una RESERVA en un estado terminal (`2x`, `2y`, `2z`, `reserva_cancelada` o
  `reserva_completada`) con `ttl_expiracion < now()`
- **WHEN** el barrido evalúa las candidatas
- **THEN** la RESERVA no es seleccionada ni modificada (la guarda de origen la excluye)

### Requirement: Atomicidad por RESERVA y aislamiento de fallos en el lote

El sistema SHALL (DEBE) ejecutar, por cada RESERVA procesada, la transición de estado +
la liberación de `FECHA_BLOQUEADA` + (si aplica) el disparo de promoción como una
operación **all-or-nothing** dentro de una transacción serializada por `SELECT … FOR
UPDATE` sobre la fila bloqueante, bajo el contexto RLS del tenant. El barrido SHALL
(DEBE) procesar **cada RESERVA en su propia transacción independiente**: el fallo de
una expiración (excepción, guarda, conflicto) NO DEBE abortar ni revertir las demás; el
resumen del barrido registra los fallos aislados. Reutiliza la semántica de lote de
`LiberarFechasEnLoteService` (US-041). (Fuente: `US-012 §Reglas de negocio`, `§FA doble
expiración parcial`; `CLAUDE.md §Regla crítica`; `us-041 §Barrido en lote`.)

#### Scenario: Un fallo parcial en una candidata no revierte las demás

- **GIVEN** un barrido con N candidatas donde la expiración de una falla
- **WHEN** el sistema procesa el lote
- **THEN** cada candidata se procesa en su propia transacción independiente
- **AND** el fallo de una no revierte ni impide la expiración de las demás
- **AND** el resumen del barrido refleja la candidata fallida como fallo aislado

#### Scenario: Un fallo dentro de la transacción de una RESERVA revierte solo esa

- **GIVEN** una candidata cuya liberación de `FECHA_BLOQUEADA` falla tras actualizar el
  sub_estado en la misma transacción
- **WHEN** ocurre el fallo antes del commit
- **THEN** la transacción de esa RESERVA hace rollback completo (sub_estado y
  `FECHA_BLOQUEADA` sin cambios)
- **AND** las demás candidatas del lote no se ven afectadas

### Requirement: Idempotencia del barrido — N ejecuciones = 1 sola transición

El sistema SHALL (DEBE) ser idempotente: si el barrido se ejecuta varias veces sobre la
misma RESERVA, solo la primera la transiciona (mientras es candidata); las siguientes
no la encuentran en un estado candidato (ya está en el terminal) y NO producen ninguna
modificación ni entradas duplicadas en `AUDIT_LOG`. El `DELETE` de `FECHA_BLOQUEADA`
con 0 filas afectadas es **éxito silencioso** (US-041), de modo que la ausencia de la
fila no genera error. (Fuente: `US-012 §FA Idempotencia`, `§FA doble expiración
parcial`, `§Reglas de Validación`; US-041 idempotencia.)

#### Scenario: Segunda ejecución del barrido sobre una RESERVA ya expirada no hace nada

- **GIVEN** una RESERVA que ya fue expirada a `2x` en una ejecución anterior del barrido
- **WHEN** el barrido se ejecuta de nuevo y la evalúa
- **THEN** la RESERVA no está en un estado candidato y no se modifica
- **AND** no se generan registros duplicados en `AUDIT_LOG`

#### Scenario: RESERVA candidata con FECHA_BLOQUEADA ya eliminada se expira sin error

- **GIVEN** una RESERVA todavía en `sub_estado = '2b'` con `ttl_expiracion < now()`
  cuya fila de `FECHA_BLOQUEADA` fue eliminada por un fallo previo (expiración parcial)
- **WHEN** el barrido procesa su expiración
- **THEN** la RESERVA pasa a `sub_estado = '2x'`
- **AND** el `DELETE` de `FECHA_BLOQUEADA` afecta a 0 filas y es éxito silencioso, sin
  lanzar error (operación idempotente respecto a la ausencia de la fila)

### Requirement: El TTL extendido manualmente antes del barrido prevalece sobre la expiración

El sistema SHALL (DEBE), cuando el gestor ha extendido el `ttl_expiracion` de una
RESERVA (US-006) antes de que el barrido la evalúe, **no** expirarla si tras la
extensión `ttl_expiracion` ya no es `< now()`: la RESERVA deja de ser candidata y no se
modifica. La extensión manual prevalece sobre la expiración automática. (Fuente:
`US-012 §FA TTL extendido manualmente antes del barrido`, `§RC-2`; US-006.)

#### Scenario: TTL extendido saca la RESERVA del conjunto de candidatas

- **GIVEN** una RESERVA cuyo `ttl_expiracion` fue extendido por el gestor de modo que
  ahora es `> now()`
- **WHEN** el barrido evalúa las candidatas
- **THEN** la RESERVA no es seleccionada y no se modifica (la extensión prevalece)

### Requirement: Concurrencia — doble ejecución del cron sobre la misma RESERVA (RC-1)

El sistema SHALL (DEBE) garantizar que, ante dos ejecuciones concurrentes del barrido
que intentan expirar simultáneamente la misma RESERVA (p. ej. por reinicio del
proceso), **exactamente una** aplique la transición: la primera transacción actualiza
`sub_estado = '2x'` (o `estado = 'reserva_cancelada'`); la segunda, dentro de su propia
transacción, no encuentra la RESERVA en un estado candidato y **no actúa**, sin efectos
duplicados. La garantía es determinista y reside en el motor de PostgreSQL (`SELECT …
FOR UPDATE` + re-evaluación de la guarda dentro de la transacción), no en lógica
aplicativa ni locks distribuidos. Esta zona crítica se cubre con **TDD primero** (skill
`concurrency-locking`). (Fuente: `US-012 §RC-1`; `CLAUDE.md §Testing`, `§Regla
crítica`.)

#### Scenario: Dos barridos simultáneos — una transición, cero duplicados

- **GIVEN** dos ejecuciones concurrentes del barrido sobre la misma RESERVA en `2b` con
  `ttl_expiracion < now()`
- **WHEN** ambas intentan actualizar su `sub_estado` de `2b` a `2x` en la misma ventana
- **THEN** exactamente una transacción tiene éxito y deja la RESERVA en `2x`
- **AND** la otra, al re-evaluar la guarda de origen dentro de su transacción, no
  encuentra la RESERVA en `2b` y no realiza ninguna modificación ni auditoría duplicada

### Requirement: Concurrencia — expiración vs extensión manual concurrente (RC-2)

El sistema SHALL (DEBE) garantizar que, ante una expiración del barrido y una extensión
manual del TTL (US-006) sobre la misma RESERVA ejecutándose al mismo instante,
**exactamente una** tenga éxito y **nunca** quede un estado intermedio inconsistente: si
la expiración commitea primero, la extensión falla de forma controlada (la RESERVA ya
está en `2x`/`reserva_cancelada`, inmutable); si la extensión commitea primero, la
expiración no encuentra la RESERVA como candidata (`ttl_expiracion` ya no `< now()`) y
no actúa. La serialización la provee `SELECT … FOR UPDATE` sobre la fila bloqueante.
Zona crítica cubierta con **TDD primero**. (Fuente: `US-012 §RC-2`; US-006
concurrencia; `CLAUDE.md §Testing`.)

#### Scenario: Expiración y extensión compiten — resultado coherente sin estado intermedio

- **GIVEN** una RESERVA en `2b` en el límite de su vencimiento, con una expiración del
  barrido y una extensión manual (US-006) compitiendo por la misma fila bloqueante
- **WHEN** ambas transacciones se ejecutan concurrentemente
- **THEN** o bien la expiración gana (RESERVA en `2x`, fecha liberada) y la extensión se
  rechaza porque la RESERVA ya no está en un estado extensible
- **AND** o bien la extensión gana (TTL extendido, bloqueo vigente) y la expiración no
  selecciona la RESERVA porque `ttl_expiracion` ya no es `< now()`
- **AND** en ningún caso queda un estado intermedio observable

### Requirement: Concurrencia — expiración vs nuevo bloqueo de la misma fecha (RC-3)

El sistema SHALL (DEBE) garantizar que, cuando la expiración elimina la fila de
`FECHA_BLOQUEADA` liberando una fecha y, concurrentemente, un nuevo lead solicita
bloquear esa misma `(tenant_id, fecha)`, ambas operaciones sean correctas y **nunca**
coexistan dos bloqueos activos: o la expiración commitea primero (la fecha queda libre
y el nuevo lead puede bloquearla), o el nuevo bloqueo no puede insertar hasta que la
expiración commitea. La restricción `UNIQUE(tenant_id, fecha)` (US-040) previene
duplicados y la serialización la provee el motor de PostgreSQL. Zona crítica cubierta
con **TDD primero**. (Fuente: `US-012 §RC-3`; US-040 `UNIQUE(tenant_id, fecha)`;
`er-diagram.md §5.3`.)

#### Scenario: Liberación por expiración y nuevo bloqueo no producen doble bloqueo

- **GIVEN** una expiración que libera la fila de `FECHA_BLOQUEADA` de `(T, D)` y,
  simultáneamente, un nuevo lead que solicita bloquear `(T, D)`
- **WHEN** ambas operaciones ocurren en una ventana solapada
- **THEN** o la expiración completa primero y el nuevo bloqueo hace INSERT exitoso, o el
  nuevo bloqueo espera hasta que la expiración commitea
- **AND** en ningún momento existen dos bloqueos activos para `(T, D)` (lo previene
  `UNIQUE(tenant_id, fecha)`)

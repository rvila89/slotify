# Spec Delta — Capability `bloqueo-fecha` (US-041 / UC-31)

> Operación atómica de **liberación** de fecha (`liberarFecha()`), complemento de
> `bloquearFecha()` (US-040) sobre la misma primitiva `FECHA_BLOQUEADA` y el mismo
> agregado raíz `Reserva`. Fuente: US-041, UC-31 (`use-cases.md`), `er-diagram.md §3.6`,
> `§3.17 AUDIT_LOG`, `§5.2 Cola`, `§5.3 Bloqueo atómico`, `AGENTS.md §Regla crítica`,
> `schema.prisma model FechaBloqueada`. Dispara —pero **no** redefine— la promoción de
> cola de US-018; **no** muta el estado de la `RESERVA`; **no** introduce el cron de
> barrido (difiere su wiring, ver `design.md` D-9).

## ADDED Requirements

### Requirement: Liberación atómica vía DELETE serializado en transacción
La operación `liberarFecha()` SHALL (DEBE) eliminar la fila de `FECHA_BLOQUEADA` para
`(tenant_id, fecha)` **dentro de una única transacción** (`DELETE` serializado por el
motor PostgreSQL), dejando la fecha disponible (sin ningún bloqueo activo para ese
`tenant_id`). La operación NO PUEDE usar Redis, Redlock ni ningún lock distribuido; la
exclusión mutua y la atomicidad residen **exclusivamente** en la base de datos. Toda
liberación de bloqueo (por TTL, descarte o cancelación) DEBE pasar por esta función
transaccional única; no se implementa un DELETE inline por cada flujo invocante.
(Fuente: US-041 §Historia, §Reglas de negocio; UC-31 Flujo Básico 2–6; `er-diagram.md §5.3`;
`AGENTS.md §Regla crítica`.)

#### Scenario: Liberación por TTL agotado de un bloqueo blando sin cola
- **GIVEN** una fila en `FECHA_BLOQUEADA` con `tipo_bloqueo = 'blando'`, `ttl_expiracion < now()`,
  `tenant_id = T`, `fecha = D`, y ninguna `RESERVA` con `sub_estado = '2d'` apuntando a la reserva bloqueante
- **WHEN** el Sistema ejecuta `liberarFecha()` para `(T, D)`
- **THEN** la fila se elimina de `FECHA_BLOQUEADA` dentro de una transacción
- **AND** la fecha `D` queda disponible (sin ningún bloqueo activo para `T`)
- **AND** no se dispara ninguna promoción de cola

#### Scenario: Liberación al cancelar una reserva confirmada (bloqueo firme)
- **GIVEN** una fila en `FECHA_BLOQUEADA` con `tipo_bloqueo = 'firme'` para `(T, D)` cuya
  `RESERVA` ha transitado a `estado = 'reserva_cancelada'`
- **WHEN** el Sistema ejecuta `liberarFecha()` para `(T, D)`
- **THEN** la fila firme se elimina dentro de la transacción y la fecha `D` queda disponible

### Requirement: Idempotencia — DELETE de 0 filas es éxito silencioso
La operación SHALL (DEBE) ser idempotente: si no existe ningún registro en
`FECHA_BLOQUEADA` para `(tenant_id, fecha)` (ya liberado antes o nunca bloqueado), el
DELETE afecta **0 filas** y la operación termina **sin lanzar excepción** (éxito
silencioso), de modo que los retries del cron de barrido no producen errores. La tentativa
idempotente DEBE registrarse en `AUDIT_LOG`. Un DELETE de 0 filas NO dispara promoción de
cola.
(Fuente: US-041 §Edge Cases idempotencia, §Reglas de Validación; UC-31.)

#### Scenario: Liberación de fecha sin bloqueo activo no lanza error
- **GIVEN** que no existe ningún registro en `FECHA_BLOQUEADA` para `(T, D)`
- **WHEN** el Sistema ejecuta `liberarFecha()` para `(T, D)`
- **THEN** la operación termina con éxito (0 filas afectadas) sin lanzar excepción
- **AND** se registra en `AUDIT_LOG` la tentativa idempotente
- **AND** no se dispara ninguna promoción de cola

### Requirement: Guarda de liberación del bloqueo firme
La operación SHALL (DEBE) rechazar la liberación de un `tipo_bloqueo = 'firme'` salvo que
la `RESERVA` referenciada tenga `estado = 'reserva_cancelada'`. La validación es de
**dominio** y **previa** al DELETE: ante cualquier otro estado de la reserva, la operación
se rechaza, el bloqueo firme permanece **intacto** y el intento se registra en `AUDIT_LOG`.
La guarda se apoya en la estructura declarativa de transiciones (la máquina de estados como
estructura de datos), no en lógica dispersa.
(Fuente: US-041 §Edge Cases intento de liberar bloqueo firme, §Reglas de Validación;
`CLAUDE.md §Máquina de estados`.)

#### Scenario: Liberar bloqueo firme de reserva activa es rechazado
- **GIVEN** un bloqueo `firme` para `(T, D)` cuya `RESERVA` sigue en `estado = 'reserva_confirmada'`
- **WHEN** algún flujo intenta `liberarFecha()` para `(T, D)` sin haber transitado la reserva a `reserva_cancelada`
- **THEN** la operación se rechaza con un error de dominio
- **AND** la fila firme permanece intacta en `FECHA_BLOQUEADA`
- **AND** el intento queda registrado en `AUDIT_LOG`

#### Scenario: Liberar bloqueo firme de reserva cancelada es permitido
- **GIVEN** un bloqueo `firme` para `(T, D)` cuya `RESERVA` está en `estado = 'reserva_cancelada'`
- **WHEN** el Sistema ejecuta `liberarFecha()` para `(T, D)`
- **THEN** la guarda pasa y la fila se elimina dentro de la transacción

### Requirement: Disparo de la promoción de cola tras liberar (seam US-018)
La operación SHALL (DEBE), tras eliminar la fila, verificar si existe **cola activa** para
la fecha (al menos una `RESERVA` con `sub_estado = '2d'` y `consulta_bloqueante_id`
apuntando a la reserva liberada) y, en tal caso, **disparar** la mecánica de promoción de
US-018 a través de un **puerto/seam** (`PromocionColaPort`). US-041 solo garantiza el
**trigger**; NO redefine la reordenación de cola ni el email al lead promovido (eso es
US-018). La promoción se ejecuta en la misma transacción de la liberación o como paso
inmediato y atómico post-commit; no puede quedar un estado intermedio donde la fecha está
libre pero la cola no ha sido procesada (consistencia eventual aceptable si la cola
permanece en `2.d` hasta completar la promoción).
(Fuente: US-041 §Reglas de negocio, §Notas de alcance, §Reglas de Validación;
`er-diagram.md §5.2`; UC-31 Flujo Básico 4–5.)

#### Scenario: Liberación con cola activa dispara la promoción
- **GIVEN** un bloqueo blando expirado para `(T, D)` y 2 `RESERVA` en `sub_estado = '2d'`
  con `consulta_bloqueante_id` apuntando a la reserva bloqueante
- **WHEN** el Sistema ejecuta `liberarFecha()` para `(T, D)`
- **THEN** la fila se elimina
- **AND** se invoca el `PromocionColaPort` para la fecha `D` exactamente una vez
- **AND** la reordenación de cola y la notificación quedan delegadas a la mecánica de US-018

#### Scenario: Liberación sin cola no invoca el seam de promoción
- **GIVEN** un bloqueo liberable para `(T, D)` sin ninguna `RESERVA` en `2.d` que lo apunte
- **WHEN** el Sistema ejecuta `liberarFecha()` para `(T, D)`
- **THEN** la fila se elimina y el `PromocionColaPort` NO es invocado

### Requirement: Exactamente-una-vez en la promoción ante liberaciones concurrentes
La operación SHALL (DEBE) garantizar que, ante dos liberaciones concurrentes de la misma
`(tenant_id, fecha)`, **exactamente una** elimina la fila (1 row affected) y la otra obtiene
**0 filas** sin error; el estado final no contiene registro para `(T, D)`. La promoción de
cola se dispara **exactamente una vez**: solo el worker que realmente eliminó la fila (1 row
affected) invoca `PromocionColaPort`; el worker de 0 filas NO la dispara. Esta es zona
crítica y se cubre con **TDD primero** (dos workers simultáneos → 1 DELETE + 1 no-op, 1 sola
promoción).
(Fuente: US-041 §Concurrencia race condition dos liberaciones, §Criterio de éxito;
`CLAUDE.md §Testing`.)

#### Scenario: Dos liberaciones simultáneas — 1 DELETE, 0 dobles promociones
- **GIVEN** dos ejecuciones concurrentes `TX-1` y `TX-2` que liberan la misma `(T, D)` con cola activa
- **WHEN** ambas ejecutan el DELETE en la misma ventana temporal
- **THEN** exactamente una elimina la fila (1 row affected) y la otra obtiene 0 row affected sin error
- **AND** el estado final de `FECHA_BLOQUEADA` no contiene registro para `(T, D)`
- **AND** `PromocionColaPort` se invoca exactamente una vez (la del worker que eliminó la fila)

### Requirement: Liberación concurrente con un nuevo intento de bloqueo
La operación SHALL (DEBE) garantizar que, ante una liberación de `(tenant_id, fecha)` que
solapa con un nuevo intento de bloqueo de la misma fecha, la transacción de liberación
completa primero (DELETE + posible promoción) y el nuevo bloqueo se resuelve con éxito
(INSERT) o entra en cola si la promoción ya volvió a bloquear la fecha; **nunca** existe un
estado intermedio donde `(T, D)` quede doble-bloqueada. La garantía la provee la
serialización del motor más el `UNIQUE(tenant_id, fecha)` de US-040.
(Fuente: US-041 §Concurrencia race condition liberación vs bloqueo; `er-diagram.md §5.3`.)

#### Scenario: Liberación gana la carrera y el nuevo bloqueo se resuelve sin doble-bloqueo
- **GIVEN** una `liberarFecha()` en curso para `(T, D)` y, simultáneamente, un nuevo intento de bloquear `(T, D)`
- **WHEN** ambas operaciones ocurren en una ventana solapada
- **THEN** la liberación completa primero (DELETE + posible promoción)
- **AND** el nuevo bloqueo se resuelve con un INSERT exitoso o entra en cola si la promoción ya bloqueó `D`
- **AND** en ningún momento `(T, D)` queda con dos bloqueos activos

### Requirement: Barrido en lote con transacciones independientes por fecha
La operación de **liberación en lote** SHALL (DEBE) procesar N fechas expiradas de modo que
**cada fecha se libere en su propia transacción independiente**: el fallo de una liberación
NO bloquea ni revierte las demás, y cada liberación exitosa dispara su promoción de cola si
corresponde. Esta semántica de aislamiento de fallos parciales es responsabilidad de US-041;
el **wiring** del cron/endpoint protegido que la invoca periódicamente se difiere (ver
`design.md` D-9).
(Fuente: US-041 §Edge Cases barrido de TTLs; `AGENTS.md §Jobs asíncronos`.)

#### Scenario: Una liberación fallida no impide las demás del barrido
- **GIVEN** un barrido con N fechas `ttl_expiracion < now()` donde la liberación de una fecha falla
- **WHEN** el Sistema ejecuta la liberación en lote
- **THEN** cada fecha se libera en una transacción independiente
- **AND** el fallo de una no revierte ni bloquea las liberaciones de las demás fechas
- **AND** cada liberación exitosa dispara la promoción de cola si corresponde

### Requirement: La liberación no muta el estado de la RESERVA
La operación SHALL (DEBE) limitar su efecto a `FECHA_BLOQUEADA` (y al registro de auditoría):
NO modifica `estado` ni `sub_estado` de la `RESERVA` referenciada. La transición de estado
de la reserva (a `2.z`, `reserva_cancelada`, etc.) la ejecuta el flujo invocante (US-012,
US-013, US-011, cancelación), no `liberarFecha()`.
(Fuente: US-041 §Reglas de Validación; simetría con US-040 "solo muta FECHA_BLOQUEADA".)

#### Scenario: Liberar no cambia el estado de la reserva
- **WHEN** `liberarFecha()` se ejecuta con éxito sobre `(T, D)`
- **THEN** únicamente se elimina la fila de `FECHA_BLOQUEADA` (y se registra la auditoría)
- **AND** ningún campo `estado`/`sub_estado` de la `RESERVA` referenciada es modificado por esta operación

### Requirement: Registro en AUDIT_LOG de toda liberación con su causa
La operación SHALL (DEBE) registrar en `AUDIT_LOG` cada liberación exitosa, cada tentativa
idempotente (0 filas) y cada intento rechazado de bloqueo firme, con `accion = 'eliminar'`,
`entidad = 'FECHA_BLOQUEADA'` y la **causa** de la liberación (TTL / descarte / cancelación)
en los datos del registro.
(Fuente: US-041 §Reglas de Validación; `er-diagram.md §3.17 AUDIT_LOG`.)

#### Scenario: Liberación exitosa registra la causa en AUDIT_LOG
- **GIVEN** una liberación por TTL agotado de `(T, D)`
- **WHEN** el Sistema ejecuta `liberarFecha()` con éxito
- **THEN** se crea un registro en `AUDIT_LOG` con `accion = 'eliminar'`, `entidad = 'FECHA_BLOQUEADA'`
  y la causa `TTL`

# bloqueo-fecha Specification

## Purpose
TBD - created by archiving change us-040-bloquear-fecha-atomicamente. Update Purpose after archive.
## Requirements
### Requirement: Bloqueo atómico vía transacción con SELECT … FOR UPDATE
La operación `bloquearFecha()` SHALL (DEBE) insertar o actualizar la fila de
`FECHA_BLOQUEADA` para `(tenant_id, fecha)` **dentro de una única transacción** que
serializa el acceso mediante `SELECT … FOR UPDATE`, apoyándose en la restricción
`UNIQUE(tenant_id, fecha)` del motor PostgreSQL como garantía de no-doble-reserva.
La operación NO PUEDE usar Redis, Redlock ni ningún lock distribuido; el bloqueo es
exclusivamente de base de datos. Toda mutación de bloqueo (crear, extender TTL,
promover a firme) DEBE pasar por esta función transaccional única; no se implementa
inline por cada transición.
(Fuente: US-040 §Historia, §Reglas de negocio, §Supuestos; UC-30 Flujo Básico 2–7;
`er-diagram.md §5.3`; `AGENTS.md §Regla crítica`.)

#### Scenario: Bloqueo blando en transición a 2.b
- **GIVEN** una `RESERVA` en sub_estado `2.b` con `fecha_evento = D`, `tenant_id = T`,
  y sin ningún registro en `FECHA_BLOQUEADA` para `(T, D)`
- **WHEN** el Sistema ejecuta `bloquearFecha()` con fase `2.b`
- **THEN** se inserta una fila en `FECHA_BLOQUEADA` con `tenant_id = T`, `fecha = D`,
  `reserva_id` apuntando a la reserva, `tipo_bloqueo = 'blando'` y
  `ttl_expiracion = now() + TENANT_SETTINGS.ttl_consulta_dias` (3 días por defecto)

#### Scenario: La operación solo muta FECHA_BLOQUEADA
- **WHEN** `bloquearFecha()` se ejecuta con éxito
- **THEN** únicamente se inserta/actualiza la fila de `FECHA_BLOQUEADA`
- **AND** ningún campo de la `RESERVA` referenciada es modificado por esta operación
  (la transición de estado es responsabilidad del flujo invocante)

### Requirement: Mapa canónico fase → tipo de bloqueo y TTL
La operación SHALL (DEBE) derivar `tipo_bloqueo` y `ttl_expiracion` de la fase
(estado/sub-estado) de la `RESERVA` según el **mapa canónico**, leyendo los días de
TTL de `TENANT_SETTINGS` (nunca hardcodeados): `2.b` → `blando`,
`now() + ttl_consulta_dias`; `2.c` → extensión (ver requisito propio); `2.v` →
`blando`, `visita_programada_fecha + 1 día`; `pre_reserva` → `blando`,
`now() + ttl_prereserva_dias`; `reserva_confirmada` → `firme`, `NULL`. El mapa se
modela como **estructura de datos declarativa**, no como código disperso.
(Fuente: US-040 §Reglas de negocio mapa canónico, §Happy Path; UC-30 Flujo Básico 4;
`er-diagram.md §3.6`, `§3.16 TENANT_SETTINGS`.)

#### Scenario: Bloqueo en 2.v usa la fecha de visita + 1 día
- **GIVEN** una `RESERVA` con `visita_programada_fecha = V` que transiciona a `2.v`
- **WHEN** el Sistema ejecuta `bloquearFecha()` con fase `2.v`
- **THEN** la fila queda con `tipo_bloqueo = 'blando'` y `ttl_expiracion = V + 1 día`

#### Scenario: TTL leído de TENANT_SETTINGS, no hardcodeado
- **GIVEN** `TENANT_SETTINGS.ttl_consulta_dias = 5` (valor no por defecto)
- **WHEN** el Sistema ejecuta un bloqueo de fase `2.b`
- **THEN** `ttl_expiracion = now() + 5 días` (no 3)

#### Scenario: Pre-reserva usa ttl_prereserva_dias
- **GIVEN** `TENANT_SETTINGS.ttl_prereserva_dias = 7`
- **WHEN** el Sistema ejecuta un bloqueo de fase `pre_reserva` sobre una fecha libre
- **THEN** la fila queda con `tipo_bloqueo = 'blando'` y
  `ttl_expiracion = now() + 7 días`

### Requirement: Upgrade de bloqueo blando a firme al confirmar
La operación SHALL (DEBE) promover un bloqueo `blando` existente a `firme` mediante un
**UPDATE** de la fila existente (nunca DELETE+INSERT, para preservar la atomicidad),
fijando `tipo_bloqueo = 'firme'` y `ttl_expiracion = NULL`, sin alterar `reserva_id`.
(Fuente: US-040 §Happy Path bloqueo firme, §Supuestos upgrade; UC-30 Flujo Básico 4.)

#### Scenario: Confirmar reserva promueve el bloqueo a firme
- **GIVEN** una fila en `FECHA_BLOQUEADA` con `tipo_bloqueo = 'blando'` para la fecha D
  de la reserva
- **WHEN** la reserva transiciona a `reserva_confirmada` y el Sistema ejecuta el upgrade
- **THEN** la fila queda con `tipo_bloqueo = 'firme'` y `ttl_expiracion = NULL`
- **AND** el campo `reserva_id` permanece inalterado

### Requirement: Extensión de TTL en 2.c sin cambiar el tipo
La operación SHALL (DEBE), en la transición a sub_estado `2.c`, **extender** el TTL del
bloqueo blando existente con `ttl_expiracion = ttl_expiracion_actual +
TENANT_SETTINGS.ttl_consulta_dias`, manteniendo `tipo_bloqueo = 'blando'`. El nuevo TTL
DEBE ser ≥ al actual. Es un UPDATE dentro de la misma transacción serializada.
(Fuente: US-040 §Extensión de TTL en 2.c, mapa canónico `2.c`.)

#### Scenario: 2.c extiende el TTL existente sin tocar el tipo
- **GIVEN** un bloqueo blando para `(T, D)` con `ttl_expiracion = now() + 1 día`
- **WHEN** la reserva transiciona a sub_estado `2.c` (pendiente invitados)
- **THEN** la fila se actualiza con
  `ttl_expiracion = (now() + 1 día) + TENANT_SETTINGS.ttl_consulta_dias`
- **AND** `tipo_bloqueo` permanece `'blando'`

### Requirement: Rechazo atómico determinista si la fecha ya está bloqueada
La operación SHALL (DEBE) rechazar de forma determinista el intento de bloquear una
`(tenant_id, fecha)` que ya tiene un bloqueo activo de **otra** `reserva_id`: el
`INSERT` falla por violación de `UNIQUE(tenant_id, fecha)` (Prisma `P2002`), la
transacción hace `ROLLBACK`, ningún registro adicional se inserta, y el error se
propaga al flujo invocante para que decida (p. ej. ofrecer cola). La oferta de cola NO
es responsabilidad de esta operación.
(Fuente: US-040 FA-01, §Notas de alcance; UC-30 FA-01.)

#### Scenario: Fecha ya bloqueada por otra reserva se rechaza con unicidad
- **GIVEN** un registro en `FECHA_BLOQUEADA` para `(T, D)` con una `reserva_id` distinta
- **WHEN** el Sistema intenta insertar un nuevo bloqueo para `(T, D)`
- **THEN** la transacción falla con violación de `UNIQUE(tenant_id, fecha)` (`P2002`)
- **AND** no se inserta ningún registro adicional
- **AND** el error se propaga al servicio de dominio invocante

### Requirement: Serialización de solicitudes concurrentes sobre la misma fecha
La operación SHALL (DEBE) garantizar que, ante dos transacciones concurrentes que
intentan bloquear la misma `(tenant_id, fecha)`, **exactamente una** confirme su
inserción (`COMMIT`, 1 fila) y la otra reciba una violación de `UNIQUE(tenant_id,
fecha)` con `ROLLBACK` automático; el estado final contiene exactamente un registro
para `(T, D)`. Esta es la zona crítica y se cubre con **TDD primero** (dos workers
simultáneos → siempre 1 éxito + 1 error de unicidad).
(Fuente: US-040 §Concurrencia race condition, §Criterio de éxito; `er-diagram.md §5.3`;
`CLAUDE.md §Testing`.)

#### Scenario: Dos transacciones simultáneas — una gana, otra falla
- **GIVEN** dos transacciones concurrentes `TX-1` y `TX-2` que bloquean la misma fecha
  `D` para el mismo `tenant_id = T`
- **WHEN** ambas ejecutan `SELECT … FOR UPDATE` + `INSERT` en la misma ventana temporal
- **THEN** exactamente una tiene éxito (1 fila, `COMMIT`)
- **AND** la otra recibe una excepción de violación de `UNIQUE(tenant_id, fecha)` con
  `ROLLBACK`
- **AND** el estado final de `FECHA_BLOQUEADA` contiene exactamente un registro para
  `(T, D)`

### Requirement: Idempotencia del bloqueo firme por reserva_id
La operación SHALL (DEBE) ser idempotente ante un segundo bloqueo firme para la misma
`(T, D)`: si el `reserva_id` coincide con el del bloqueo existente, el UPDATE aplica los
mismos valores sin error; si el `reserva_id` es distinto, se rechaza por violación de
unicidad. El `reservaId @unique` del esquema refuerza la relación 1:1 reserva↔bloqueo.
(Fuente: US-040 §Idempotencia del bloqueo firme; `schema.prisma` `reservaId @unique`.)

#### Scenario: Retry de bloqueo firme con el mismo reserva_id es idempotente
- **GIVEN** un bloqueo `firme` para `(T, D)` con `reserva_id = R`
- **WHEN** llega otra solicitud de bloqueo firme para `(T, D)` con el mismo `reserva_id = R`
- **THEN** la operación aplica un UPDATE con los mismos valores sin lanzar error

#### Scenario: Bloqueo firme con reserva_id distinto se rechaza
- **GIVEN** un bloqueo `firme` para `(T, D)` con `reserva_id = R1`
- **WHEN** llega una solicitud de bloqueo firme para `(T, D)` con `reserva_id = R2 ≠ R1`
- **THEN** se rechaza con violación de `UNIQUE(tenant_id, fecha)`

### Requirement: Validaciones de dominio previas a la transacción
La operación SHALL (DEBE) validar antes de abrir la transacción: la `fecha` no puede ser
anterior a la fecha actual ("fecha en el pasado" → rechazo sin tocar `FECHA_BLOQUEADA`);
el `tenant_id` del bloqueo DEBE coincidir con el `tenant_id` de la `RESERVA` referenciada
(no se puede bloquear en nombre de otro tenant); y `tipo_bloqueo` solo admite `'blando'`
o `'firme'`.
(Fuente: US-040 §Bloqueo sobre fecha pasada, §Reglas de Validación.)

#### Scenario: Fecha en el pasado es rechazada antes de la transacción
- **GIVEN** una solicitud de bloqueo cuya `fecha` es anterior a la fecha actual
- **WHEN** el Sistema recibe la solicitud
- **THEN** el bloqueo se rechaza con error "fecha en el pasado"
- **AND** no se abre la transacción ni se toca `FECHA_BLOQUEADA`

#### Scenario: tenant_id del bloqueo distinto al de la reserva es rechazado
- **GIVEN** una solicitud cuyo `tenant_id` no coincide con el `tenant_id` de la
  `RESERVA` referenciada
- **WHEN** el Sistema valida la solicitud
- **THEN** el bloqueo se rechaza y no se inserta ningún registro

### Requirement: Invariantes de coherencia tipo↔TTL impuestas en BD
El motor de base de datos SHALL (DEBE) imponer, además de la validación de dominio, que
`tipo_bloqueo = 'firme' ⟹ ttl_expiracion IS NULL` y que
`tipo_bloqueo = 'blando' ⟹ ttl_expiracion IS NOT NULL` y `ttl_expiracion > now()` en el
momento de la escritura, mediante check constraints sobre `fecha_bloqueada`. Una fila
que viole estas invariantes DEBE ser rechazada por la BD.
(Fuente: US-040 §Reglas de Validación; `design.md` D-3.)

#### Scenario: Bloqueo firme con TTL no nulo es rechazado por la BD
- **GIVEN** un intento de escribir una fila con `tipo_bloqueo = 'firme'` y
  `ttl_expiracion` no nulo
- **THEN** la BD rechaza la escritura por violación del check constraint

#### Scenario: Bloqueo blando sin TTL es rechazado por la BD
- **GIVEN** un intento de escribir una fila con `tipo_bloqueo = 'blando'` y
  `ttl_expiracion` nulo
- **THEN** la BD rechaza la escritura por violación del check constraint

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

### Requirement: El descarte manual de una pre-reserva libera su fecha por la única función canónica

El sistema SHALL (DEBE), cuando el Gestor descarta manualmente una RESERVA en `pre_reserva`
(capability `consultas`), liberar su `FECHA_BLOQUEADA` invocando **exclusivamente** la función
canónica `liberarFecha()` —la **única** vía de mutación de liberación (regla dura: nunca inline
ni por otra vía)— **dentro de la misma transacción atómica** del descarte, que serializa el
acceso con `SELECT … FOR UPDATE` y NO usa Redis/Redlock ni ningún lock distribuido. Esa
liberación DEBE reutilizar el comportamiento vivo de US-041: el DELETE serializado idempotente y
el **disparo del seam de promoción de cola** (`PromocionColaPort`, US-018) **exactamente una
vez** cuando existe cola activa para la fecha. El descarte NO introduce una segunda forma de
liberar ni de promover: reutiliza el mismo seam que el descarte de consulta (US-013) y el
barrido de TTL. (Fuente: workstream B; `descartar-consulta-uow.prisma.adapter.ts`; spec viva
`bloqueo-fecha` "Liberación atómica…", "Disparo de la promoción de cola tras liberar";
`CLAUDE.md §Regla crítica`.)

#### Scenario: El descarte de pre-reserva libera vía liberarFecha() en la misma transacción

- **GIVEN** una RESERVA en `pre_reserva` con su `FECHA_BLOQUEADA` firme para `(T, D)`
- **WHEN** el Gestor descarta la pre-reserva
- **THEN** la fila de `FECHA_BLOQUEADA` de `(T, D)` se elimina invocando `liberarFecha()` dentro
  de la misma transacción del descarte
- **AND** la liberación no usa ningún lock distribuido (solo `SELECT … FOR UPDATE` de PostgreSQL)

#### Scenario: El descarte con cola dispara la promoción exactamente una vez

- **GIVEN** una RESERVA en `pre_reserva` cuya fecha tiene cola activa (`RESERVA` en `2.d`)
- **WHEN** el Gestor descarta la pre-reserva y `liberarFecha()` elimina la fila
- **THEN** el `PromocionColaPort` (seam US-018) se invoca exactamente una vez para esa fecha
- **AND** la reordenación y la notificación quedan delegadas a la mecánica de US-018 (no se
  reimplementan aquí)


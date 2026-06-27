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


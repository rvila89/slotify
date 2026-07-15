# consultas Specification

## ADDED Requirements

### Requirement: Transición de descarte por cliente de sub_estado no terminal a 2.z

El sistema SHALL (DEBE) permitir a un Gestor autenticado marcar una RESERVA en
`estado = 'consulta'` y `sub_estado ∈ {2a, 2b, 2c, 2d, 2v}` como **descartada por el
cliente**, transicionándola a `sub_estado = '2z'` (estado **terminal e inmutable**). La
transición modela la variante manual de **UC-10 / A17** ("Salir de la cola") ejecutada
por el Gestor en nombre del cliente que ha comunicado su desistimiento; en el MVP no hay
portal de cliente. La transición `{consulta, 2a|2b|2c|2d|2v} → {consulta, 2z}` DEBE
modelarse en la **máquina de estados declarativa** (`maquina-estados.ts`, tabla de datos,
NO condicionales dispersos), NO como una expiración por TTL (`2.x`, US-012) ni como un
vaciado de cola por activación de pre-reserva (`2.y`, US-014): `2.z` es un terminal
distinto que significa "descartada por cliente". La transición y **todas** sus
consecuencias (liberación de FECHA_BLOQUEADA + promoción/reordenación de cola +
auditoría) son **atómicas en una única transacción** bajo el contexto RLS del tenant.
(Fuente: `US-013 §Historia`, `§Reglas de negocio`, `§Reglas de Validación`; UC-10; A17;
`CLAUDE.md §Máquina de estados`.)

#### Scenario: Descarte desde 2.a solo marca 2.z sin tocar fecha ni cola

- **GIVEN** una RESERVA en `sub_estado = '2a'` (sin fila en `FECHA_BLOQUEADA`, sin cola)
- **WHEN** el Gestor la marca como "descartada por cliente" (con o sin motivo)
- **THEN** la RESERVA pasa a `sub_estado = '2z'`
- **AND** no se busca ni se elimina ninguna fila en `FECHA_BLOQUEADA`
- **AND** no se ejecuta ninguna acción sobre cola

#### Scenario: 2.z es terminal e inmutable

- **GIVEN** una RESERVA que acaba de transicionar a `sub_estado = '2z'`
- **WHEN** se intenta cualquier transición posterior sobre ella
- **THEN** el sistema la rechaza por ser un estado terminal inmutable

### Requirement: Guarda de origen — el descarte por cliente solo es válido desde un sub_estado no terminal

El sistema SHALL (DEBE) validar en el servidor, **antes** de cualquier mutación, que la
RESERVA está en `estado = 'consulta'` con `sub_estado ∈ {2a, 2b, 2c, 2d, 2v}`. Si la
RESERVA está en un sub-estado terminal (`2x`, `2y`, `2z`) o en un estado terminal
(`reserva_cancelada`, `reserva_completada`), el sistema DEBE **rechazar** la petición con
el error "Esta consulta ya está en un estado terminal y no puede modificarse" y **no
modificar** la RESERVA, `FECHA_BLOQUEADA` ni la cola. La guarda se modela en la **máquina
de estados declarativa** (mismo criterio que US-005 §"Guarda de origen"), reutilizando el
patrón ya existente de rechazo desde/hacia estados terminales. En la UI, el botón "Marcar
como descartada" DEBE estar **deshabilitado** para RESERVA en estado terminal; la
validación de servidor es defensiva e independiente de la UI. (Fuente: `US-013 §FA
RESERVA en estado terminal`, `§Reglas de Validación`; patrón US-005 guarda de origen;
`CLAUDE.md §Máquina de estados`.)

#### Scenario: Descarte sobre una RESERVA en estado terminal se rechaza sin efectos

- **GIVEN** una RESERVA en `sub_estado = '2x'`, `2y` o `2z`, o en estado
  `reserva_cancelada`/`reserva_completada`
- **WHEN** el Gestor intenta marcarla como descartada por cliente
- **THEN** el sistema retorna el error "Esta consulta ya está en un estado terminal y no
  puede modificarse"
- **AND** no modifica la RESERVA, `FECHA_BLOQUEADA` ni ninguna posición de cola

### Requirement: Liberación de la fecha bloqueada al descartar desde 2.b, 2.c o 2.v

El sistema SHALL (DEBE), cuando el descarte por cliente parte de un sub_estado con bloqueo
asociado (`2b`, `2c`, `2v`), **liberar la fecha** eliminando la fila de `FECHA_BLOQUEADA`
de la RESERVA descartada mediante la primitiva atómica existente `liberarFecha()`
(US-040/US-041), dentro de la misma transacción de la transición a `2z`. El sistema NO
DEBE usar Redis, Redlock ni locks distribuidos: la atomicidad y la serialización las provee
**exclusivamente PostgreSQL** (`SELECT … FOR UPDATE` sobre la fila de `FECHA_BLOQUEADA`
vía Prisma `$queryRaw` + `UNIQUE(tenant_id, fecha)`). Cuando el origen es `2a` (sin
bloqueo), el sistema NO DEBE buscar ni intentar eliminar ninguna fila en `FECHA_BLOQUEADA`.
La auditoría de la liberación la registra `liberarFecha()` (`entidad = 'FECHA_BLOQUEADA'`,
causa `descarte`); esta transición NO DEBE duplicarla. (Fuente: `US-013 §Happy Path 2.b`,
`§2.c`, `§2.v`, `§Reglas de Validación`; US-040 `liberarFecha()`/`UNIQUE(tenant_id,
fecha)`; `CLAUDE.md §Regla crítica: bloqueo atómico`.)

#### Scenario: Descarte desde 2.b sin cola libera la fecha sin acción de cola

- **GIVEN** una RESERVA en `sub_estado = '2b'` con fila activa en `FECHA_BLOQUEADA` y sin
  ninguna RESERVA en `2d` apuntando a ella
- **WHEN** el Gestor la marca como descartada
- **THEN** en la misma transacción la RESERVA pasa a `2z` y `liberarFecha()` elimina su
  fila de `FECHA_BLOQUEADA`; la fecha queda disponible
- **AND** la búsqueda de cola devuelve 0 resultados y no dispara ninguna acción adicional

#### Scenario: Descarte desde 2.c libera la fecha sin cola posible

- **GIVEN** una RESERVA en `sub_estado = '2c'` (la cola ya se vació al entrar en `2c`)
- **WHEN** el Gestor la marca como descartada
- **THEN** la RESERVA pasa a `2z` y `liberarFecha()` elimina su fila de `FECHA_BLOQUEADA`
- **AND** no se ejecuta ninguna promoción ni reordenación (operación vacía sobre cola,
  válida y sin error)

### Requirement: Promoción FIFO al liberar la fecha si la consulta descartada era bloqueante (2.b/2.v con cola)

El sistema SHALL (DEBE), cuando el descarte parte de `2b` o `2v` y la RESERVA descartada
es `consulta_bloqueante` de una o más RESERVA en `sub_estado = '2d'`, disparar **una única
vez** el seam existente `PromocionColaPort.promoverPrimeroEnCola({ tenantId, fecha })`
(US-018/US-041, mecánica A15/UC-12) como parte indivisible de la liberación de la fecha.
El sistema NO DEBE redefinir la mecánica de promoción: reutiliza el seam tal cual, que
promueve la primera en cola (`posicion_cola = 1`) a `2b`, re-crea la fila de
`FECHA_BLOQUEADA` para la promovida vía `bloquearFecha()` (`tipo_bloqueo = 'blando'`,
`ttl_expiracion = now() + tenant_settings.ttl_consulta_dias`, instante `timestamptz`) y
reordena el resto de la cola re-apuntando a la nueva bloqueante. Si la cola está vacía, el
seam NO se dispara y la operación completa sin error. El caso `2v` con cola heredada (por
haber llegado a `2v` desde `2b`) se trata **idénticamente** al caso `2b` con cola. (Fuente:
`US-013 §Happy Path 2.b con cola`, `§2.v`, `§FA Cola vacía`; seam US-018/US-041 "Promoción
automática FIFO"; A15; UC-12.)

#### Scenario: Descarte desde 2.b con cola dispara la promoción A15 una vez

- **GIVEN** una RESERVA R1 en `2b` que es `consulta_bloqueante` de R2 (`posicion_cola = 1`),
  R3 (`posicion_cola = 2`) en `sub_estado = '2d'`
- **WHEN** el Gestor marca R1 como descartada por cliente
- **THEN** en la misma transacción R1 pasa a `2z`, `liberarFecha()` libera su fecha y
  dispara `promoverPrimeroEnCola` **una vez**
- **AND** R2 pasa a `2b` (nueva bloqueante, `posicion_cola → NULL`,
  `consulta_bloqueante_id → NULL`, `ttl_expiracion → now() + ttl_consulta_dias`) con su
  fila de `FECHA_BLOQUEADA` re-creada vía `bloquearFecha()`
- **AND** R3 queda con `posicion_cola → 1` y `consulta_bloqueante_id → R2.id`

#### Scenario: Descarte desde 2.v con cola heredada dispara la promoción igual que 2.b

- **GIVEN** una RESERVA en `sub_estado = '2v'` que heredó cola activa desde `2b`
- **WHEN** el Gestor la marca como descartada
- **THEN** pasa a `2z`, `liberarFecha()` libera su fecha y dispara la promoción A15 una
  vez, con la misma mecánica que el descarte desde `2b` con cola

#### Scenario: Descarte desde 2.b sin cola no dispara promoción

- **GIVEN** una RESERVA en `2b` sin ninguna RESERVA en `2d` apuntándola
- **WHEN** el Gestor la marca como descartada
- **THEN** libera la fecha y NO dispara `promoverPrimeroEnCola`; la operación completa sin
  error

### Requirement: Salida de cola con reordenación al descartar desde 2.d

El sistema SHALL (DEBE), cuando el descarte por cliente parte de `sub_estado = '2d'` con
`posicion_cola = P` y `consulta_bloqueante_id = B`, ejecutar en la misma transacción
atómica: (1) transicionar la RESERVA a `2z` con `posicion_cola → NULL` y
`consulta_bloqueante_id → NULL` (sale de la cola); (2) **decrementar en 1 la
`posicion_cola`** de **todas** las RESERVA en `sub_estado = '2d'` con el mismo
`consulta_bloqueante_id = B` y `posicion_cola > P`, cerrando el hueco. El sistema NO DEBE
modificar la RESERVA bloqueante (`B`), NO DEBE liberar ninguna `FECHA_BLOQUEADA` (la
RESERVA en `2d` no tiene bloqueo propio) y NO DEBE disparar promoción. La reordenación se
limita a la cola de `B` (mismo `consulta_bloqueante_id`); no afecta a otras colas de otras
fechas. El sistema DEBE preservar la unicidad `UNIQUE(tenant_id, consulta_bloqueante_id,
posicion_cola) WHERE posicion_cola IS NOT NULL` (US-004): tras la reordenación las
posiciones DEBEN ser contiguas empezando en 1. (Fuente: `US-013 §Happy Path 2.d`, `§Reglas
de Validación`; US-004 índice de cola; patrón de reordenación US-018/US-019.)

#### Scenario: Descarte de una posición intermedia de la cola cierra el hueco

- **GIVEN** R1 bloqueante y R2 (`posicion_cola = 1`), R3 (`posicion_cola = 2`), R4
  (`posicion_cola = 3`) en `sub_estado = '2d'` con `consulta_bloqueante_id = R1.id`
- **WHEN** el Gestor marca R3 como descartada por cliente
- **THEN** R3 pasa a `2z` con `posicion_cola → NULL` y `consulta_bloqueante_id → NULL`
- **AND** R4 decrementa a `posicion_cola → 2`; R2 permanece en `posicion_cola = 1`
- **AND** R1 (bloqueante) no se modifica y no se libera ninguna `FECHA_BLOQUEADA`
- **AND** las posiciones de la cola quedan contiguas empezando en 1

#### Scenario: Descarte del último en cola no altera al resto

- **GIVEN** R1 bloqueante y R2 (`posicion_cola = 1`), R3 (`posicion_cola = 2`) en `2d`
- **WHEN** el Gestor marca R3 (última) como descartada
- **THEN** R3 pasa a `2z` (`posicion_cola → NULL`, `consulta_bloqueante_id → NULL`)
- **AND** R2 permanece en `posicion_cola = 1` sin cambios

### Requirement: Motivo de descarte opcional en RESERVA.notas

El sistema SHALL (DEBE) permitir al Gestor registrar **opcionalmente** un motivo de
descarte que se persiste en `RESERVA.notas`. Si el Gestor proporciona motivo, el sistema
DEBE actualizar `RESERVA.notas` con él dentro de la misma transacción de la transición a
`2z`. Si el Gestor **no** proporciona motivo, la transición DEBE completar normalmente y
`RESERVA.notas` DEBE permanecer **sin cambios** (o vacío/`NULL` si ya lo era): la ausencia
de motivo NO DEBE bloquear ni retrasar la transición. (Fuente: `US-013 §Reglas de
negocio`, `§FA Motivo de descarte no proporcionado`, `§Reglas de Validación`.)

#### Scenario: Descarte con motivo actualiza notas

- **GIVEN** un Gestor que marca una RESERVA como descartada e introduce un motivo
- **WHEN** confirma la acción
- **THEN** la transición completa y `RESERVA.notas` queda actualizado con el motivo

#### Scenario: Descarte sin motivo deja notas sin cambios

- **GIVEN** un Gestor que marca una RESERVA como descartada sin introducir motivo
- **WHEN** confirma la acción
- **THEN** la transición completa normalmente y `RESERVA.notas` permanece sin cambios

### Requirement: Auditoría de la transición a 2.z sin duplicar la liberación de fecha

El sistema SHALL (DEBE) registrar en `AUDIT_LOG` la transición de descarte con
`accion = 'transicion'`, `entidad = 'RESERVA'`, `datos_anteriores.sub_estado =
<sub_estado origen>` y `datos_nuevos.sub_estado = '2z'`, dentro de la misma transacción.
Cuando el descarte parte de `2d`, la salida de cola de la RESERVA descartada DEBE quedar
reflejada de forma coherente con el criterio de US-014/US-018 para salidas de cola
(cambio de `posicion_cola`/`consulta_bloqueante_id` en `datos_nuevos`). El sistema NO DEBE
duplicar la auditoría de la liberación de `FECHA_BLOQUEADA` (la registra `liberarFecha()`
con `entidad = 'FECHA_BLOQUEADA'`, causa `descarte`) ni la de la promoción de cola (la
registra el seam `promoverPrimeroEnCola`). El sistema NO DEBE generar ningún email
automático al cliente: esta acción no está mapeada a ningún código E1-E8 del catálogo.
(Fuente: `US-013 §Happy Path 2.a` auditoría, `§Contexto de Negocio` email/AUDIT_LOG;
US-041 auditoría de `liberarFecha()`; US-018 auditoría de promoción.)

#### Scenario: La transición a 2.z deja un registro de auditoría de la RESERVA

- **GIVEN** un descarte por cliente que completa desde `sub_estado = '2a'`
- **WHEN** la transacción confirma
- **THEN** `AUDIT_LOG` contiene una entrada `accion='transicion'`, `entidad='RESERVA'` con
  `datos_anteriores.sub_estado = '2a'` y `datos_nuevos.sub_estado = '2z'`

#### Scenario: El descarte no genera email al cliente

- **GIVEN** cualquier descarte por cliente que completa la transición a `2z`
- **WHEN** la transacción confirma
- **THEN** el sistema NO crea ninguna COMUNICACION ni dispara ningún envío de email al
  cliente

### Requirement: Atomicidad y serialización de la transición de descarte

El sistema SHALL (DEBE) ejecutar la transición de descarte completa —cambio de
`sub_estado` a `2z` + (según origen) liberación de `FECHA_BLOQUEADA` vía `liberarFecha()`
+ promoción de cola vía `promoverPrimeroEnCola` **o** reordenación de la cola de `2d` +
actualización opcional de `RESERVA.notas` + auditoría— como una operación
**all-or-nothing** dentro de **una única transacción** serializada por `SELECT … FOR
UPDATE` sobre la fila de `FECHA_BLOQUEADA` (cuando el origen tiene bloqueo) y/o sobre la
RESERVA, bajo el contexto RLS del tenant. Si cualquier paso falla, la transacción hace
rollback completo: NO DEBE existir un instante observable con la RESERVA en `2z` y una
fila activa de `FECHA_BLOQUEADA` apuntándola, ni con la cola con un hueco de posición. El
sistema NO DEBE usar Redis, Redlock ni locks distribuidos. Este núcleo crítico
(concurrencia del bloqueo y máquina de estados) DEBE cubrirse con **TDD primero**.
(Fuente: `US-013 §Reglas de negocio` — atomicidad, `§Criterio de éxito`; `CLAUDE.md
§Regla crítica: bloqueo atómico`, `§Testing`.)

#### Scenario: Fallo en cualquier paso hace rollback completo

- **GIVEN** un descarte desde `2b` con cola en el que la promoción falla
- **WHEN** la transacción intenta confirmar
- **THEN** hace rollback completo: la RESERVA permanece en `2b`, su `FECHA_BLOQUEADA`
  intacta y la cola sin cambios

#### Scenario: No hay estado intermedio observable de 2.z con fecha bloqueada apuntándola

- **GIVEN** un descarte desde `2b` sin cola en curso
- **WHEN** cualquier lectura concurrente observa la RESERVA
- **THEN** la ve en `2b` con su bloqueo, o en `2z` sin fila de `FECHA_BLOQUEADA`
  apuntándola; nunca en `2z` con un bloqueo activo propio

### Requirement: Concurrencia — descarte vs barrido de TTL, doble descarte y re-bloqueo de fecha

El sistema SHALL (DEBE) garantizar la coherencia del descarte bajo concurrencia mediante
la serialización de PostgreSQL, sin locks distribuidos. **(RC-1)** Si el descarte compite
con el barrido de expiración de TTL (US-012) sobre la misma RESERVA, la primera
transacción en commitear tiene éxito y la segunda, al releer bajo lock, encuentra la
RESERVA fuera de un sub_estado activo y **no actúa**: el resultado final es `2z` **o**
`2x`, nunca ambos ni un estado inconsistente. **(RC-2)** Si la liberación de
`FECHA_BLOQUEADA` compite con una nueva solicitud de bloqueo de la misma `(tenant_id,
fecha)`, la restricción `UNIQUE(tenant_id, fecha)` garantiza que nunca coexistan dos
bloqueos activos: la eliminación ocurre dentro de la transacción de descarte y solo
después puede insertarse la nueva fila. **(RC-3)** Si dos Gestores descartan la misma
RESERVA a la vez, la primera transacción la pasa a `2z` y la segunda recibe un **error
controlado** (RESERVA ya en estado terminal inmutable) que la UI muestra como mensaje
informativo. Esta zona crítica DEBE cubrirse con **TDD primero**. (Fuente: `US-013 §RC-1`,
`§RC-2`, `§RC-3`; US-012 barrido TTL; US-040 `UNIQUE(tenant_id, fecha)`; `CLAUDE.md §Regla
crítica`, `§Testing`.)

#### Scenario: RC-1 — descarte vs expiración TTL nunca deja doble estado

- **GIVEN** un descarte y el barrido de TTL de US-012 compitiendo sobre la misma RESERVA
  cuyo `ttl_expiracion` acaba de vencer
- **WHEN** ambas transacciones se solapan
- **THEN** la primera en commitear tiene éxito; la segunda relee bajo lock, no encuentra la
  RESERVA en sub_estado activo y no actúa
- **AND** el resultado final es `2z` o `2x`, nunca ambos

#### Scenario: RC-2 — liberación vs nuevo bloqueo no produce doble bloqueo

- **GIVEN** la liberación de `FECHA_BLOQUEADA` de `(T, D)` por descarte y, a la vez, un
  nuevo lead que solicita bloquear `(T, D)`
- **WHEN** ambas operaciones se solapan
- **THEN** el descarte elimina la fila dentro de su transacción y solo después la nueva
  solicitud puede insertar; `UNIQUE(tenant_id, fecha)` impide dos bloqueos activos

#### Scenario: RC-3 — doble descarte concurrente: el segundo recibe error controlado

- **GIVEN** dos Gestores que marcan la misma RESERVA como descartada a la vez
- **WHEN** ambas transacciones compiten
- **THEN** la primera pasa la RESERVA a `2z` y la segunda recibe un error controlado
  "estado terminal inmutable" que la UI muestra como mensaje informativo

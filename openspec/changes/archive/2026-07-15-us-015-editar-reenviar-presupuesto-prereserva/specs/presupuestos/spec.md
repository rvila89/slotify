# Spec Delta — Capability `presupuestos`

> **US-015 / UC-15** — Editar y Reenviar Presupuesto en Pre-reserva. Añade a la
> capability `presupuestos` la **edición versionada** de un presupuesto cuya RESERVA
> está en `pre_reserva`, y el **reenvío sin cambios**. Reutiliza el motor de tarifa
> (US-016), el desglose fiscal por régimen y la numeración `AAAANNN` de doble
> secuencia (6.1b/6.2), y el disparo del email E2 (US-014/US-045). NO reimplementa el
> tarifario ni el envío de email.
>
> Fuente: `US-015`; UC-15; `er-diagram §3.11 PRESUPUESTO`, `§RESERVA_EXTRA`,
> `§COMUNICACION`, `§AUDIT_LOG`; specs vivas `presupuestos` (US-014/6.1b/6.2);
> `CLAUDE.md §Máquina de estados`, `§Multi-tenancy`.

## ADDED Requirements

### Requirement: Precondición de edición — pre_reserva y presupuesto no aceptado

El sistema SHALL (DEBE) validar en el servidor, **antes** de cualquier cálculo o
mutación, que la RESERVA está en `estado = 'pre_reserva'` y que su **último**
PRESUPUESTO está en `estado ∈ {'borrador', 'enviado'}`. Si el PRESUPUESTO está en
`estado = 'aceptado'` (señal confirmada vía UC-17, RESERVA ya en
`reserva_confirmada`) o `'rechazado'`, o si la RESERVA **no** está en `pre_reserva`,
el sistema DEBE **rechazar** la operación **sin ejecutar el motor de tarifa** y **sin
crear** ninguna versión de PRESUPUESTO ni línea de `RESERVA_EXTRA`. La guarda de
origen se modela en la **máquina de estados declarativa** (no condicionales
dispersos): solo `{pre_reserva, presupuesto borrador|enviado}` es válido para la
edición. (Fuente: `US-015 §Reglas de negocio`, `§Estado inválido — PRESUPUESTO ya
aceptado`, `§Estado inválido — RESERVA fuera de pre_reserva`, `§Reglas de
Validación`; UC-15; `CLAUDE.md §Máquina de estados`.)

#### Scenario: PRESUPUESTO aceptado no puede editarse

- **GIVEN** una RESERVA cuyo último PRESUPUESTO está en `estado = 'aceptado'`
  (señal confirmada, RESERVA en `reserva_confirmada`)
- **WHEN** el gestor intenta editar el presupuesto
- **THEN** el sistema rechaza la operación con "El presupuesto está aceptado y no
  puede modificarse"
- **AND** no ejecuta el motor de tarifa ni crea una nueva versión de PRESUPUESTO

#### Scenario: RESERVA fuera de pre_reserva no permite editar

- **GIVEN** una RESERVA en `estado = 'consulta'` (`sub_estado = '2b'`)
- **WHEN** se intenta acceder a la edición de presupuesto vía UC-15
- **THEN** el sistema rechaza la operación sin efectos
- **AND** no crea ninguna versión de PRESUPUESTO ni línea de `RESERVA_EXTRA`

### Requirement: Recálculo del borrador de edición sin persistir

El sistema SHALL (DEBE) exponer un **preview de edición** que recalcula el borrador
del presupuesto con los cambios propuestos (`num_adultos_ninos_mayores4`,
`duracion_horas`, líneas de `RESERVA_EXTRA`, `descuento_eur`) **delegando en el motor
de tarifa** (US-016) cuando cambian invitados o duración, y derivando el desglose
fiscal (`base_imponible`, `iva_importe`, `total`) y el reparto con las **funciones de
dominio puras existentes** (`calcularDesgloseFiscal`, `calcularReparto`), según el
régimen del presupuesto. Durante el preview el sistema NO DEBE crear ninguna versión
de PRESUPUESTO, NO DEBE crear/modificar/eliminar filas de `RESERVA_EXTRA`, NO DEBE
mutar `RESERVA.estado`/`ttl_expiracion` ni la `FECHA_BLOQUEADA`, y NO DEBE enviar
ningún email. (Fuente: `US-015 §Reglas de negocio` borrador guardado, `§Cambio de nº
invitados`; UC-15/UC-16; patrón preview de US-014.)

#### Scenario: El preview de edición recalcula sin persistir

- **GIVEN** una RESERVA en `pre_reserva` con PRESUPUESTO `version = 1` (`total =
  3.200 €`)
- **WHEN** el gestor previsualiza un descuento de 200 € sin confirmar
- **THEN** el sistema devuelve el nuevo desglose (`total = 3.000 €`) delegando el
  cálculo en las funciones de dominio del régimen
- **AND** no existe una nueva fila de PRESUPUESTO ni cambia ninguna `RESERVA_EXTRA`,
  y `FECHA_BLOQUEADA` no se modifica

#### Scenario: Cambio de invitados delega en el motor de tarifa

- **GIVEN** un PRESUPUESTO `version = 1` calculado con 40 invitados (tramo 31–50)
- **WHEN** el gestor previsualiza `num_adultos_ninos_mayores4 = 25` (tramo 21–30)
- **THEN** el motor UC-16 recalcula con los nuevos parámetros y el preview refleja el
  nuevo `precio_tarifa_eur` del tramo 21–30
- **AND** no se persiste ninguna versión ni se muta la RESERVA

### Requirement: Nueva versión del PRESUPUESTO al confirmar la edición

El sistema SHALL (DEBE), al confirmar la edición, crear en **una transacción** un
PRESUPUESTO nuevo con `version = versión_anterior + 1`, `tarifa_congelada = true`,
`iva_porcentaje` según régimen (21% CON IVA / 0% SIN IVA), y el desglose fiscal
congelado (`base_imponible`, `iva_importe`, `total`, `descuento_eur`/
`descuento_motivo` si aplica) recalculado del motor de tarifa (o del precio manual
del caso `tarifa_a_consultar`). El PRESUPUESTO **anterior persiste como historial**
(no se borra ni se sobrescribe). La unicidad `(reservaId, version)` garantiza la
secuencia. Una vez congelada la nueva versión, un cambio posterior del tarifario NO
la recalcula. (Fuente: `US-015 §Happy Path`, `§Reglas de negocio` nueva versión;
UC-15; `er-diagram §3.11 PRESUPUESTO`; congelado de US-014.)

#### Scenario: Confirmar edición crea version=2 y conserva la version=1

- **GIVEN** una RESERVA en `pre_reserva` con PRESUPUESTO `version = 1` en `enviado`
  (`total = 3.200 €`, sin descuento)
- **WHEN** el gestor aplica `descuento_eur = 200`, confirma la edición y envía
- **THEN** se crea PRESUPUESTO `version = 2` con `total = 3.000 €`,
  `tarifa_congelada = true`, `estado = 'enviado'`
- **AND** el PRESUPUESTO `version = 1` persiste en la BD como historial (no eliminado)

#### Scenario: Recálculo de invitados congela la nueva versión

- **GIVEN** un PRESUPUESTO `version = 1` de 40 invitados
- **WHEN** el gestor cambia a 25 invitados y confirma
- **THEN** se crea PRESUPUESTO `version = 2` con el precio del tramo 21–30 congelado
- **AND** el `version = 1` se conserva como historial

### Requirement: Precio congelado de las líneas RESERVA_EXTRA al añadirlas

El sistema SHALL (DEBE), al añadir una línea de `RESERVA_EXTRA` en la edición,
**congelar** su `precio_unitario` con el precio **actual** del EXTRA del catálogo en
ese momento y fijar `subtotal = precio_unitario × cantidad`. Una línea `RESERVA_EXTRA`
**ya existente** conserva su `precio_unitario` congelado **aunque** el precio del
EXTRA del catálogo cambie después; solo las líneas **nuevas** de la edición toman el
precio actual. Cada línea persiste con `origen` (`anadido_post_confirmacion` para las
añadidas tras activar la pre_reserva) y `factura_id = null`. Modificar la cantidad de
una línea existente recalcula su `subtotal` **sin** cambiar su `precio_unitario`
congelado; eliminar una línea la retira del total de la nueva versión. (Fuente:
`US-015 §Reglas de negocio` precio congelado, `§Añadir extra`, `§Eliminar extra`;
UC-15; `er-diagram §RESERVA_EXTRA` `precio_unitario`/`origen`/`factura_id`.)

#### Scenario: Añadir un extra congela su precio actual

- **GIVEN** una RESERVA en `pre_reserva` y el EXTRA "barbacoa" a `precio_eur = 250 €`
- **WHEN** el gestor añade 1 unidad de "barbacoa" y confirma
- **THEN** se crea `RESERVA_EXTRA` con `precio_unitario = 250`, `subtotal = 250`,
  `origen = 'anadido_post_confirmacion'`, `factura_id = null` y el total crece 250 €

#### Scenario: El precio congelado no se recalcula si cambia el catálogo

- **GIVEN** una línea "barbacoa" congelada a `precio_unitario = 250` y el catálogo de
  "barbacoa" cambiado luego a 300 €
- **WHEN** el gestor edita otro campo (p. ej. el descuento) y confirma
- **THEN** la línea "barbacoa" existente conserva `precio_unitario = 250`
- **AND** solo una línea **nueva** añadida en esta edición tomaría el precio actual
  (300 €)

#### Scenario: Eliminar un extra lo retira del total de la nueva versión

- **GIVEN** un PRESUPUESTO con una `RESERVA_EXTRA` "paellero" de `subtotal = 400 €`
- **WHEN** el gestor elimina esa línea y confirma la edición
- **THEN** la nueva versión del PRESUPUESTO no incluye los 400 € y la línea queda
  eliminada (o inactiva) sin afectar a versiones históricas

### Requirement: Precio manual cuando el cambio de invitados supera el tramo de tarifa

El sistema SHALL (DEBE), cuando el cambio de `num_adultos_ninos_mayores4` (p. ej. a
>50) hace que el motor devuelva `tarifa_a_consultar = true` con importes a `null`,
**habilitar un campo de precio total manual** en el borrador de edición y **esperar**
a que el Gestor introduzca el precio antes de permitir confirmar la nueva versión. Al
confirmar, el `total` de la nueva versión DEBE ser el precio manual introducido. El
flujo **no se bloquea** por la ausencia de tarifa para el tramo +50. (Fuente:
`US-015 §Cambio de invitados a >50 — tarifa a consultar`, `§Supuestos`,
`§Reglas de Validación`; UC-15/UC-16; patrón precio manual de US-014.)

#### Scenario: 55 invitados habilita precio manual en la edición

- **GIVEN** una edición con `num_adultos_ninos_mayores4 = 55`
- **WHEN** el gestor recalcula el borrador
- **THEN** el motor devuelve `tarifa_a_consultar = true` con importes a `null` y el
  sistema habilita un campo de precio total manual
- **AND** al introducir el precio y confirmar, el `total` de la nueva versión es el
  precio manual introducido

#### Scenario: Sin precio manual no se puede confirmar la edición a consultar

- **GIVEN** un borrador de edición con `tarifa_a_consultar = true` y sin precio manual
- **WHEN** el gestor intenta confirmar
- **THEN** el sistema no permite crear la nueva versión hasta que se introduzca el
  precio total manual

### Requirement: Envío explícito de la edición registra COMUNICACION E2 y AUDIT_LOG

El sistema SHALL (DEBE), cuando el Gestor confirma la edición **con envío explícito**,
regenerar el PDF de la nueva versión, disparar el email **E2** (reenvío del
presupuesto actualizado; **gap de spec E2 documentado en `design.md` D1**), registrar
una nueva `COMUNICACION` con `codigo_email = 'E2'`, `estado = 'enviado'` y
`es_reenvio = true` (para esquivar el índice UNIQUE parcial `(reserva_id,
codigo_email) WHERE es_reenvio = false`, patrón US-028/US-023), fijar
`PRESUPUESTO.estado = 'enviado'` en la nueva versión, y registrar en `AUDIT_LOG` con
`accion = 'actualizar'` referenciando el nuevo `id_presupuesto`. (Fuente: `US-015
§Happy Path`, `§Reglas de negocio` envío explícito; UC-15; `er-diagram
§COMUNICACION`, `§AUDIT_LOG`; patrón `es_reenvio` de US-028/US-023.)

#### Scenario: Confirmar con envío registra E2 (reenvío) y AUDIT_LOG actualizar

- **GIVEN** una edición confirmada que crea PRESUPUESTO `version = 2`
- **WHEN** el gestor envía la versión actualizada
- **THEN** se registra una `COMUNICACION` con `codigo_email = 'E2'`,
  `estado = 'enviado'` y `es_reenvio = true`
- **AND** se registra un `AUDIT_LOG` con `accion = 'actualizar'` que referencia el
  nuevo `id_presupuesto`, y `PRESUPUESTO version=2` queda en `estado = 'enviado'`

### Requirement: Guardar la edición como borrador sin enviar

El sistema SHALL (DEBE) permitir **guardar la edición sin enviar**: crea la nueva
versión de PRESUPUESTO con `estado = 'borrador'` y NO registra `COMUNICACION` ni
dispara email; el cliente no recibe nada. El borrador queda disponible para enviarlo
más tarde desde la ficha de pre_reserva. (Fuente: `US-015 §Guardar borrador sin
enviar`, `§Reglas de negocio` borrador guardado; UC-15.)

#### Scenario: Guardar borrador crea versión en borrador sin email

- **GIVEN** una RESERVA en `pre_reserva` con PRESUPUESTO `version = 1`
- **WHEN** el gestor modifica el descuento y **guarda sin enviar**
- **THEN** se crea PRESUPUESTO `version = 2` con `estado = 'borrador'`
- **AND** no se registra `COMUNICACION`, no se envía email y el gestor puede enviarlo
  más tarde

### Requirement: Reenvío sin cambios de la versión vigente

El sistema SHALL (DEBE), cuando el Gestor confirma el envío **sin modificar ningún
campo**, **NO** crear una versión nueva: reenvía el PDF de la versión vigente,
registra una nueva `COMUNICACION` E2 (`es_reenvio = true`, `estado = 'enviado'`) y un
`AUDIT_LOG`, y deja la versión vigente en `estado = 'enviado'`. No se crea ni modifica
ninguna `RESERVA_EXTRA` ni se recalcula el desglose. (Fuente: `US-015 §Sin cambios —
reenvío de versión existente`; UC-15; patrón reenvío de US-023/US-028.)

#### Scenario: Reenvío sin cambios no crea versión nueva

- **GIVEN** una RESERVA en `pre_reserva` con PRESUPUESTO `version = 2` en `enviado`
- **WHEN** el gestor abre el presupuesto, no modifica nada y confirma el envío
- **THEN** no se crea una versión nueva; se reenvía el PDF de la `version = 2`
- **AND** se registra una `COMUNICACION` E2 (`es_reenvio = true`) y un `AUDIT_LOG`, y
  la versión sigue en `estado = 'enviado'`

### Requirement: La edición no muta el estado de la RESERVA ni el bloqueo de fecha

El sistema SHALL (DEBE) garantizar que ninguna operación de esta historia (preview,
guardar borrador, confirmar con envío, reenvío) **modifica** `RESERVA.estado`
(permanece `pre_reserva`) ni `FECHA_BLOQUEADA.ttl_expiracion` (UC-15 **no extiende**
el bloqueo). La edición NO toca el bloqueo atómico de fecha (no inserta ni modifica
`FECHA_BLOQUEADA`); no hay carrera D4 en esta historia. La validación
`descuento_eur ≥ 0` y `≤ base_imponible` (total nunca negativo) y `duracion_horas ∈
{4,8,12}` se aplican en el servidor. (Fuente: `US-015 §Reglas de negocio` sin
extensión del bloqueo, `§Concurrencia / Race Conditions`, `§Reglas de Validación`;
UC-15; `CLAUDE.md §Regla crítica: bloqueo atómico de fecha`.)

#### Scenario: La edición conserva pre_reserva y el TTL del bloqueo

- **GIVEN** una RESERVA en `pre_reserva` con `FECHA_BLOQUEADA.ttl_expiracion = T`
- **WHEN** el gestor confirma una edición y la envía
- **THEN** `RESERVA.estado` permanece `pre_reserva`
- **AND** `FECHA_BLOQUEADA.ttl_expiracion` sigue siendo `T` (no se extiende ni se
  modifica)

#### Scenario: El descuento no puede superar la base imponible

- **GIVEN** una edición con `base_imponible` calculada
- **WHEN** el gestor introduce un `descuento_eur` mayor que la `base_imponible`
- **THEN** el sistema rechaza la operación con error de validación
- **AND** no crea ninguna nueva versión de PRESUPUESTO

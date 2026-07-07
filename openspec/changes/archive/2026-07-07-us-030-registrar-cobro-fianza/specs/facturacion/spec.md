# Spec Delta — Capability `facturacion` (MODIFICADA)

> US-030 **extiende** la capability `facturacion` (US-022 + US-027 + US-028 + US-029) aplicando la fase
> de **cobro** —introducida por US-029 para la liquidación— al **recibo de la fianza** (depósito
> reembolsable). Tras la emisión del recibo (US-028: `FACTURA(fianza).estado = 'enviada'`,
> `RESERVA.fianza_status = 'recibo_enviado'`), el Gestor **registra el cobro** de la fianza antes o el
> mismo día del evento: se crea un registro `PAGO` conciliado contra el recibo de fianza, opcionalmente
> con un `DOCUMENTO (tipo = justificante_pago)`, y en la misma transacción atómica se avanza a `cobrada`
> (`FACTURA(fianza).estado: enviada → cobrada`, `RESERVA.fianza_status: recibo_enviado → cobrada`) y se
> registran `RESERVA.fianza_eur = importe` y `RESERVA.fianza_cobrada_fecha = fecha_cobro`. El justificante
> es **opcional**; el doble cobro **bloquea**; a diferencia de la liquidación, `fianza_status =
> 'pendiente'` **NO bloquea de forma dura** sino que aplica la política **"Negociable"** (aviso con
> confirmación del Gestor y traza en AUDIT_LOG). `fianza_status = cobrada` habilita la **tercera** de las
> tres precondiciones de la futura transición a `evento_en_curso` (US-031, fuera de alcance). El endpoint
> de cobro de fianza se especifica en el contrato OpenAPI.
> Fuente: US-030, UC-22 (pasos 5–9); `er-diagram.md §3.13 PAGO`, `§3.15 DOCUMENTO`, `§3.12 FACTURA
> (estado cobrada)`, `§RESERVA fianza_status / fianza_eur / fianza_cobrada_fecha`.

## ADDED Requirements

### Requirement: Registro del cobro de la fianza (creación de PAGO y transición a cobrada)

El sistema SHALL (DEBE), cuando el Gestor registra el cobro de la fianza sobre una RESERVA con
`fianza_status = 'recibo_enviado'` y su `FACTURA (tipo = 'fianza')` en `estado = 'enviada'`, en una
**única unidad transaccional atómica**: crear un registro `PAGO` con `factura_id` del recibo de fianza,
`importe` (el importe real cobrado), `fecha_cobro` y, si el Gestor adjunta un justificante,
`justificante_doc_id`; establecer `RESERVA.fianza_eur = importe` cobrado y `RESERVA.fianza_cobrada_fecha
= fecha_cobro`; transicionar `FACTURA (fianza).estado = 'cobrada'`; y transicionar `RESERVA.fianza_status
= 'cobrada'`. El sistema DEBE registrar `AUDIT_LOG` con `accion = 'crear'` para el `PAGO` (y para el
`DOCUMENTO` del justificante si se adjunta) y con `accion = 'actualizar'` para la transición de estados
de la FACTURA y de la RESERVA (incluidos `fianza_eur` y `fianza_cobrada_fecha`). El `PAGO` NO recalcula
el desglose fiscal de la factura (inmutable desde la emisión). (Fuente: `US-030 §Happy Path`, `§Reglas de
negocio`; UC-22 pasos 5–9; `er-diagram.md §3.13 PAGO`, `§3.12 FACTURA`.)

#### Scenario: Registrar el cobro con justificante deja la fianza cobrada

- **GIVEN** una RESERVA con `fianza_status = 'recibo_enviado'`, `fecha_evento = 2026-07-12` y una
  `FACTURA (tipo = 'fianza')` en `estado = 'enviada'`
- **WHEN** el Gestor registra el cobro con `fecha_cobro = 2026-07-10` (dos días antes del evento),
  `importe = 1.000,00 €` y adjunta el justificante de transferencia (PDF)
- **THEN** se crea un `PAGO` con `factura_id` del recibo de fianza, `importe = 1.000,00 €`, `fecha_cobro
  = 2026-07-10`
- **AND** el justificante se almacena como `DOCUMENTO (tipo = 'justificante_pago')` y
  `PAGO.justificante_doc_id` referencia su `id_documento`
- **AND** `RESERVA.fianza_eur = 1000.00` y `RESERVA.fianza_cobrada_fecha = 2026-07-10`
- **AND** `FACTURA (fianza).estado = 'cobrada'` y `RESERVA.fianza_status = 'cobrada'`
- **AND** `AUDIT_LOG` registra la creación del `PAGO` y la transición de estados

### Requirement: El justificante de pago de la fianza es opcional

El sistema SHALL (DEBE) permitir registrar el cobro de la fianza **sin** adjuntar justificante (por
ejemplo, cuando el Gestor recibe la fianza en efectivo el día del evento). En ese caso el `PAGO` se crea
con `justificante_doc_id = NULL` y el estado avanza igualmente a `cobrada` (`FACTURA (fianza).estado =
'cobrada'`, `RESERVA.fianza_status = 'cobrada'`, con `fianza_eur` y `fianza_cobrada_fecha` actualizados).
El cobro es válido sin justificante. (Fuente: `US-030 §Cobro sin justificante`, `§Reglas de negocio`.)

#### Scenario: Cobro de fianza sin justificante avanza igualmente a cobrada

- **GIVEN** una RESERVA con `fianza_status = 'recibo_enviado'` y su recibo de fianza en `enviada`, y el
  Gestor recibe la fianza en efectivo sin justificante digital
- **WHEN** el Gestor registra el cobro sin adjuntar ningún documento
- **THEN** se crea el `PAGO` con `justificante_doc_id = NULL`
- **AND** `FACTURA (fianza).estado = 'cobrada'`, `RESERVA.fianza_status = 'cobrada'`, y `fianza_eur` /
  `fianza_cobrada_fecha` quedan registrados

### Requirement: El cobro de la fianza se admite en cualquier fecha hasta el día del evento

El sistema SHALL (DEBE) admitir el registro del cobro de la fianza en cualquier momento **antes o el
mismo día del evento**, sin fecha mínima: cualquier `fecha_cobro ≤ RESERVA.fecha_evento` es válida,
incluida `fecha_cobro = fecha_evento` (cobro en T-0), que se procesa **sin diferencia** respecto al
happy path. (Fuente: `US-030 §Cobro el mismo día del evento (T-0)`, `§Reglas de Validación`.)

#### Scenario: Cobro el mismo día del evento (T-0) se acepta como el happy path

- **GIVEN** una RESERVA con `fianza_status = 'recibo_enviado'` y `fecha_evento = hoy`
- **WHEN** el Gestor registra el cobro con `fecha_cobro = hoy` (T-0)
- **THEN** el sistema acepta el cobro sin diferencia respecto al happy path
- **AND** `FACTURA (fianza).estado = 'cobrada'` y `RESERVA.fianza_status = 'cobrada'`

### Requirement: Guarda contra el doble cobro de la fianza

El sistema SHALL (DEBE), si `RESERVA.fianza_status = 'cobrada'` (el cobro ya fue registrado), **rechazar**
un nuevo intento de registrar el cobro de fianza con un error informativo ("La fianza ya está marcada como
cobrada") y **NO crear ningún `PAGO` adicional**. La guarda se evalúa **dentro de la transacción**
releyendo el estado de la RESERVA con bloqueo de fila (`SELECT ... FOR UPDATE`) de PostgreSQL, de modo que
dos peticiones concurrentes se serializan y solo la primera registra el cobro; la segunda ve `cobrada` y
aborta. La serialización es del motor SQL (lock de fila), **nunca** mediante locks distribuidos
(Redis/Redlock). (Fuente: `US-030 §Intento de doble cobro`, `§Reglas de Validación`; `CLAUDE.md §Regla
crítica: bloqueo atómico`; `design.md §D-1`.)

#### Scenario: Segundo intento de cobro sobre fianza ya cobrada se rechaza

- **GIVEN** una RESERVA con `fianza_status = 'cobrada'` (el cobro ya fue registrado con su `PAGO`)
- **WHEN** el Gestor intenta registrar otro cobro de fianza
- **THEN** el sistema rechaza la acción con "La fianza ya está marcada como cobrada"
- **AND** no se crea ningún `PAGO` adicional

#### Scenario: Dos registros de cobro de fianza concurrentes solo crean un PAGO

- **GIVEN** una RESERVA con `fianza_status = 'recibo_enviado'` sobre la que llegan dos peticiones de
  registro de cobro de fianza concurrentes
- **WHEN** ambas transacciones intentan registrar el cobro a la vez
- **THEN** el bloqueo de fila (`SELECT ... FOR UPDATE`) serializa las transacciones: la primera crea el
  `PAGO` y deja `fianza_status = 'cobrada'`; la segunda ve `cobrada` y aborta
- **AND** existe **un único** `PAGO` para la fianza, sin doble cobro

### Requirement: Política "Negociable" — el cobro con fianza pendiente avisa pero no bloquea

El sistema SHALL (DEBE), si `RESERVA.fianza_status = 'pendiente'` (el recibo de fianza nunca fue enviado
al cliente), **NO bloquear de forma dura** el registro del cobro, sino aplicar la política **"Negociable"**:
emitir un **aviso** ("El recibo de fianza no ha sido enviado al cliente. ¿Desea registrar el cobro
igualmente?") y requerir una **confirmación explícita** del Gestor. Si el Gestor **confirma**, el cobro se
registra igualmente (crea el `PAGO`, avanza `FACTURA (fianza).estado = 'cobrada'` y `RESERVA.fianza_status
= 'cobrada'`, actualiza `fianza_eur`/`fianza_cobrada_fecha`) y el flujo excepcional queda **trazado en
`AUDIT_LOG`** (cobro registrado sobre fianza no enviada). Si el Gestor **cancela**, el sistema **no
realiza ninguna acción** (no crea `PAGO` ni cambia el estado). Este comportamiento **diverge** del de la
liquidación (US-029), donde el estado `pendiente` bloquea de forma dura.

En el flujo "Negociable" confirmado (`confirmarSinRecibo = true` sobre `fianza_status = 'pendiente'`), el
tratamiento de la `FACTURA (tipo = 'fianza')` queda **RESUELTO por la decisión humana D-2(b)** (Gate SDD
aprobado), sin depender de que el recibo se haya emitido:

1. **Si existe una `FACTURA (fianza)` en `estado = 'borrador'`** (recibo generado pero nunca emitido,
   `fianza_status = 'pendiente'`): el cobro confirmado la lleva **DIRECTAMENTE a `cobrada`**
   (`borrador → cobrada`, sin pasar por `enviada`), y el sistema DEBE documentar en `AUDIT_LOG` el **salto
   de estado** de la FACTURA (`borrador → cobrada`) además de la traza del cobro sobre fianza no enviada.
2. **Si NO existe ninguna `FACTURA (fianza)`** (fianza omitida porque `RESERVA.fianza_default_eur = 0`):
   el sistema DEBE **crear al vuelo** una `FACTURA (tipo = 'fianza')` para la reserva y marcarla
   directamente `estado = 'cobrada'`, dejando la correspondiente traza de **creación** de la FACTURA en
   `AUDIT_LOG` (además de la del cobro sobre fianza no enviada).

En ambos casos el resto del cobro es idéntico al happy path (se crea el `PAGO` conciliado contra esa
FACTURA(fianza), `RESERVA.fianza_status = 'cobrada'`, `fianza_eur = importe`, `fianza_cobrada_fecha =
fecha_cobro`). La ausencia del flag (`confirmarSinRecibo` no presente o `false`) sobre `pendiente` sigue
devolviendo "confirmación requerida" y **NO** crea `PAGO` ni FACTURA. (Fuente: `US-030 §Cobro con
fianza_status = pendiente`; `design.md §D-2` — **decisión D-2(b) aprobada en el Gate SDD**.)

#### Scenario: Cobro con fianza pendiente confirmado por el Gestor se registra con traza

- **GIVEN** una RESERVA con `fianza_status = 'pendiente'` (el recibo de fianza nunca fue enviado)
- **WHEN** el Gestor intenta registrar el cobro y **confirma** el aviso "El recibo de fianza no ha sido
  enviado al cliente. ¿Desea registrar el cobro igualmente?"
- **THEN** el cobro se registra: se crea el `PAGO`, `FACTURA (fianza).estado = 'cobrada'`,
  `RESERVA.fianza_status = 'cobrada'` y `fianza_eur` / `fianza_cobrada_fecha` quedan actualizados
- **AND** `AUDIT_LOG` registra el flujo excepcional (cobro sobre fianza no enviada)

#### Scenario: Cobro con fianza pendiente cancelado por el Gestor no realiza ninguna acción

- **GIVEN** una RESERVA con `fianza_status = 'pendiente'`
- **WHEN** el Gestor recibe el aviso "Negociable" y **cancela** en lugar de confirmar
- **THEN** el sistema no crea ningún `PAGO` y el `fianza_status` permanece `'pendiente'`

#### Scenario: Cobro confirmado con FACTURA(fianza) en borrador salta directamente a cobrada (D-2b)

- **GIVEN** una RESERVA con `fianza_status = 'pendiente'` cuya `FACTURA (tipo = 'fianza')` existe en
  `estado = 'borrador'` (recibo generado pero nunca emitido)
- **WHEN** el Gestor registra el cobro con `confirmarSinRecibo = true`
- **THEN** la `FACTURA (fianza)` transiciona **directamente** `borrador → cobrada` (sin pasar por
  `enviada`), se crea el `PAGO` conciliado contra ella, `RESERVA.fianza_status = 'cobrada'` y
  `fianza_eur` / `fianza_cobrada_fecha` quedan actualizados
- **AND** `AUDIT_LOG` documenta el **salto de estado** de la FACTURA (`borrador → cobrada`) además de la
  traza del cobro sobre fianza no enviada

#### Scenario: Cobro confirmado sin FACTURA(fianza) crea la factura al vuelo y la marca cobrada (D-2b)

- **GIVEN** una RESERVA con `fianza_status = 'pendiente'` y **sin** `FACTURA (tipo = 'fianza')` porque la
  fianza se omitió (`RESERVA.fianza_default_eur = 0`)
- **WHEN** el Gestor registra el cobro con `confirmarSinRecibo = true`
- **THEN** el sistema **crea al vuelo** una `FACTURA (tipo = 'fianza')` para la reserva y la marca
  directamente `estado = 'cobrada'`, crea el `PAGO` conciliado contra ella, `RESERVA.fianza_status =
  'cobrada'` y `fianza_eur` / `fianza_cobrada_fecha` quedan actualizados
- **AND** `AUDIT_LOG` registra la **creación** de la `FACTURA (fianza)` (`accion = 'crear'`) además de la
  traza del cobro sobre fianza no enviada

### Requirement: Validación de fecha de cobro no posterior al evento e importe positivo

El sistema SHALL (DEBE) validar, antes de crear el `PAGO`, que `PAGO.fecha_cobro` sea una fecha válida
**≤ `RESERVA.fecha_evento`** (no se puede registrar el cobro de la fianza después del evento) y que
`PAGO.importe` sea **> 0**. Si alguna validación falla, el sistema DEBE **rechazar** el registro sin crear
`PAGO` ni cambiar el estado, devolviendo un error de validación. `RESERVA.fianza_eur` y
`RESERVA.fianza_cobrada_fecha` se actualizan **simultáneamente** con el `PAGO`; `FACTURA (fianza).estado`
solo pasa a `cobrada` cuando se crea el `PAGO` correspondiente (en la misma transacción). Estas
validaciones son lógica de **dominio puro**. (Fuente: `US-030 §Reglas de Validación`; `design.md §D-1`.)

#### Scenario: Fecha de cobro posterior al evento se rechaza

- **GIVEN** una RESERVA con `fianza_status = 'recibo_enviado'` y `fecha_evento = 2026-07-12`
- **WHEN** el Gestor introduce una `fecha_cobro = 2026-07-13` (posterior al evento)
- **THEN** el sistema rechaza el registro con un error de validación y no crea `PAGO` ni cambia el estado

#### Scenario: Importe de fianza no positivo se rechaza

- **GIVEN** una RESERVA con `fianza_status = 'recibo_enviado'`
- **WHEN** el Gestor introduce `importe = 0` (o negativo)
- **THEN** el sistema rechaza el registro con un error de validación y no crea `PAGO` ni cambia el estado

### Requirement: El cobro de la fianza habilita la tercera precondición del inicio del evento sin transicionar la reserva

El sistema SHALL (DEBE), al dejar `RESERVA.fianza_status = 'cobrada'`, habilitar la **tercera de las tres
precondiciones** de la futura transición `reserva_confirmada → evento_en_curso` (las otras dos son
`pre_evento_status = 'cerrado'` y `liquidacion_status = 'cobrada'`, US-031). Este requisito **NO**
transiciona por sí mismo el `RESERVA.estado` a `evento_en_curso` ni evalúa las otras precondiciones: la
transición se modela en US-031. Adicionalmente, si en el día del evento `fianza_status ≠ 'cobrada'`, la
política hardcoded "Negociable" implica que la verificación de precondiciones del inicio del evento genera
una **alerta crítica no bloqueante** ("⚠️ Fianza pendiente de cobro. Puede registrarla ahora o proceder
sin ella"): el inicio del evento **no se bloquea** por fianza impagada; el Gestor decide manualmente. La
integración de esa alerta en el flujo de transición pertenece a US-031. (Fuente: `US-030 §Reglas de
negocio`, `§Evento en T-0 con fianza sin cobrar (FA-01)`; `er-diagram.md §guarda evento_en_curso`.)

#### Scenario: Tras el cobro de la fianza, el estado de la reserva no avanza a evento_en_curso

- **GIVEN** una RESERVA `reserva_confirmada` cuyo cobro de fianza se acaba de registrar (`fianza_status =
  'cobrada'`)
- **WHEN** el sistema completa el registro del cobro
- **THEN** `RESERVA.fianza_status = 'cobrada'` queda disponible como la tercera precondición del inicio
  del evento
- **AND** `RESERVA.estado` permanece `reserva_confirmada` (la transición a `evento_en_curso` es de US-031)

#### Scenario: Evento en T-0 con fianza sin cobrar genera alerta no bloqueante (FA-01)

- **GIVEN** una RESERVA con `fecha_evento = hoy` y `fianza_status = 'recibo_enviado'` (fianza no cobrada)
- **WHEN** el sistema verifica las precondiciones para el inicio del evento
- **THEN** el sistema muestra una alerta crítica **no bloqueante** ("⚠️ Fianza pendiente de cobro. Puede
  registrarla ahora o proceder sin ella (política Negociable)")
- **AND** el inicio del evento no se bloquea por la fianza impagada; el Gestor decide manualmente

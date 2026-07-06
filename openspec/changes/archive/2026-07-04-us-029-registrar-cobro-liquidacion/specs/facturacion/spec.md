# Spec Delta — Capability `facturacion` (MODIFICADA)

> US-029 **extiende** la capability `facturacion` (US-022 + US-027 + US-028) con la fase de **cobro**
> de la factura de liquidación. Tras el envío de la factura (US-028: `FACTURA(liquidacion).estado =
> 'enviada'`, `RESERVA.liquidacion_status = 'facturada'`), el Gestor **registra el cobro** del 60 %
> restante cuando recibe la transferencia bancaria externa: se crea un registro `PAGO` conciliado
> contra la factura, opcionalmente con un `DOCUMENTO (tipo = justificante_pago)`, y ambos documentos
> avanzan a `cobrada` (`FACTURA.estado: enviada → cobrada`, `RESERVA.liquidacion_status: facturada →
> cobrada`) de forma atómica. El justificante es **opcional**; una discrepancia de importe **alerta
> pero no bloquea**; el doble cobro y la precondición `pendiente` **bloquean**. `liquidacion_status =
> cobrada` habilita una de las tres precondiciones de la futura transición a `evento_en_curso`
> (US-031, fuera de alcance). El endpoint de cobro se especifica en el contrato OpenAPI.
> Fuente: US-029, UC-21 (pasos 7–10); `er-diagram.md §3.13 PAGO`, `§3.15 DOCUMENTO`, `§3.12 FACTURA
> (estado cobrada)`, `§RESERVA liquidacion_status`.

## ADDED Requirements

### Requirement: Registro del cobro de la liquidación (creación de PAGO y transición a cobrada)

El sistema SHALL (DEBE), cuando el Gestor registra el cobro de la liquidación sobre una RESERVA con
`liquidacion_status = 'facturada'` y su `FACTURA (tipo = 'liquidacion')` en `estado = 'enviada'`, en una
**única unidad transaccional atómica**: crear un registro `PAGO` con `factura_id` de la factura de
liquidación, `importe` (el importe real cobrado), `fecha_cobro` y, si el Gestor adjunta un justificante,
`justificante_doc_id`; transicionar `FACTURA (liquidacion).estado = 'cobrada'`; y transicionar
`RESERVA.liquidacion_status = 'cobrada'`. El sistema DEBE registrar `AUDIT_LOG` con `accion = 'crear'`
para el `PAGO` (y para el `DOCUMENTO` del justificante si se adjunta) y con `accion = 'actualizar'` para
la transición de estados de la FACTURA y de la RESERVA. El `PAGO` NO recalcula el desglose fiscal de la
factura (inmutable desde la emisión). (Fuente: `US-029 §Happy Path`, `§Reglas de negocio`; UC-21 pasos
7–10; `er-diagram.md §3.13 PAGO`, `§3.12 FACTURA`.)

#### Scenario: Registrar el cobro con justificante deja la liquidación cobrada

- **GIVEN** una RESERVA con `liquidacion_status = 'facturada'` y una `FACTURA (tipo = 'liquidacion')` en
  `estado = 'enviada'` con `total = 4.100,00 €`
- **WHEN** el Gestor registra el cobro con `fecha_cobro = 2026-06-15`, `importe = 4.100,00 €` y adjunta el
  justificante de transferencia (PDF)
- **THEN** se crea un `PAGO` con `factura_id` de la factura de liquidación, `importe = 4.100,00 €`,
  `fecha_cobro = 2026-06-15`
- **AND** el justificante se almacena como `DOCUMENTO (tipo = 'justificante_pago')` y
  `PAGO.justificante_doc_id` referencia su `id_documento`
- **AND** `FACTURA (liquidacion).estado = 'cobrada'` y `RESERVA.liquidacion_status = 'cobrada'`
- **AND** `AUDIT_LOG` registra la creación del `PAGO` y la transición de estados

### Requirement: El justificante de pago es opcional

El sistema SHALL (DEBE) permitir registrar el cobro **sin** adjuntar justificante. En ese caso el `PAGO`
se crea con `justificante_doc_id = NULL` y el estado avanza igualmente a `cobrada`
(`FACTURA (liquidacion).estado = 'cobrada'`, `RESERVA.liquidacion_status = 'cobrada'`). El cobro es
válido sin justificante; el Gestor podrá adjuntar el justificante en un momento posterior (funcionalidad
diferida a una US posterior). (Fuente: `US-029 §Cobro registrado sin justificante`, `§Reglas de negocio`.)

#### Scenario: Cobro sin justificante avanza igualmente a cobrada

- **GIVEN** una RESERVA con `liquidacion_status = 'facturada'` y su factura de liquidación en `enviada`,
  y el Gestor no dispone del justificante en este momento
- **WHEN** el Gestor registra el cobro sin adjuntar ningún documento
- **THEN** se crea el `PAGO` con `justificante_doc_id = NULL`
- **AND** `FACTURA (liquidacion).estado = 'cobrada'` y `RESERVA.liquidacion_status = 'cobrada'`

### Requirement: Discrepancia de importe alerta pero no bloquea el cobro

El sistema SHALL (DEBE), si el `importe` introducido difiere del `FACTURA (liquidacion).total`,
**crear igualmente el `PAGO`** con el importe real introducido y **avanzar** el estado a `cobrada`, sin
bloquear el registro. El sistema DEBE devolver una **alerta informativa de discrepancia** (importe
facturado, importe cobrado y diferencia) para que el Gestor la concilie, y DEBE registrar la discrepancia
en `AUDIT_LOG`. El sistema NO ajusta la factura ni genera nota de crédito: la conciliación se **delega al
Gestor**. (Fuente: `US-029 §Importe cobrado diferente al facturado`, `§Reglas de negocio`.)

#### Scenario: Importe cobrado menor al facturado crea el PAGO y alerta sin bloquear

- **GIVEN** una `FACTURA (liquidacion)` por `4.100,00 €` con `RESERVA.liquidacion_status = 'facturada'`
- **WHEN** el Gestor registra el cobro con `importe = 4.000,00 €` y confirma
- **THEN** se crea el `PAGO` con `importe = 4.000,00 €` (el importe real) y el estado avanza a `cobrada`
- **AND** el sistema devuelve una alerta de discrepancia (facturado `4.100,00 €`, cobrado `4.000,00 €`,
  diferencia `100,00 €`) sin bloquear el registro
- **AND** la discrepancia queda registrada en `AUDIT_LOG`

### Requirement: Guarda contra el doble cobro de la liquidación

El sistema SHALL (DEBE), si `RESERVA.liquidacion_status = 'cobrada'` (el cobro ya fue registrado),
**rechazar** un nuevo intento de registrar el cobro con un error informativo ("La liquidación ya está
marcada como cobrada") y **NO crear ningún `PAGO` adicional**. La guarda se evalúa **dentro de la
transacción** releyendo el estado de la RESERVA con bloqueo de fila (`SELECT ... FOR UPDATE`) de
PostgreSQL, de modo que dos peticiones concurrentes se serializan y solo la primera registra el cobro; la
segunda ve `cobrada` y aborta. La serialización es del motor SQL (lock de fila), **nunca** mediante locks
distribuidos (Redis/Redlock). (Fuente: `US-029 §Intento de doble cobro`, `§Reglas de Validación`;
`CLAUDE.md §Regla crítica: bloqueo atómico`; `design.md §D-2`.)

#### Scenario: Segundo intento de cobro sobre liquidación ya cobrada se rechaza

- **GIVEN** una RESERVA con `liquidacion_status = 'cobrada'` (el cobro ya fue registrado con su `PAGO`)
- **WHEN** el Gestor intenta registrar otro cobro de liquidación
- **THEN** el sistema rechaza la acción con "La liquidación ya está marcada como cobrada"
- **AND** no se crea ningún `PAGO` adicional

#### Scenario: Dos registros de cobro concurrentes solo crean un PAGO

- **GIVEN** una RESERVA con `liquidacion_status = 'facturada'` sobre la que llegan dos peticiones de
  registro de cobro concurrentes
- **WHEN** ambas transacciones intentan registrar el cobro a la vez
- **THEN** el bloqueo de fila (`SELECT ... FOR UPDATE`) serializa las transacciones: la primera crea el
  `PAGO` y deja `liquidacion_status = 'cobrada'`; la segunda ve `cobrada` y aborta
- **AND** existe **un único** `PAGO` para la liquidación, sin doble cobro

### Requirement: Precondición de estado — solo se cobra desde facturada

El sistema SHALL (DEBE) permitir el registro del cobro **solo si** `RESERVA.liquidacion_status =
'facturada'`. Si `liquidacion_status = 'pendiente'` (la factura de liquidación aún no fue enviada,
US-028 no ejecutada), el sistema DEBE **bloquear** la acción con el mensaje "La factura de liquidación
debe estar enviada antes de registrar su cobro" y NO crear `PAGO`. `FACTURA (liquidacion).estado` solo
pasa a `cobrada` cuando se crea el `PAGO` correspondiente (en la misma transacción). (Fuente: `US-029
§liquidacion_status = pendiente`, `§Reglas de Validación`.)

#### Scenario: Registrar cobro con liquidacion_status pendiente se bloquea

- **GIVEN** una RESERVA con `liquidacion_status = 'pendiente'` (la factura de liquidación aún no fue
  enviada)
- **WHEN** el Gestor intenta registrar el cobro de liquidación
- **THEN** el sistema bloquea la acción con "La factura de liquidación debe estar enviada antes de
  registrar su cobro"
- **AND** no se crea ningún `PAGO` y el estado no cambia

### Requirement: Validación de fecha de cobro no futura e importe positivo

El sistema SHALL (DEBE) validar, antes de crear el `PAGO`, que `PAGO.fecha_cobro` sea una fecha válida
**≤ hoy** (no futura) y que `PAGO.importe` sea **> 0**. Si alguna validación falla, el sistema DEBE
**rechazar** el registro sin crear `PAGO` ni cambiar el estado, devolviendo un error de validación. Estas
validaciones son lógica de **dominio puro**. (Fuente: `US-029 §Reglas de Validación`; `design.md §D-2`.)

#### Scenario: Fecha de cobro futura se rechaza

- **GIVEN** una RESERVA con `liquidacion_status = 'facturada'`
- **WHEN** el Gestor introduce una `fecha_cobro` posterior a hoy
- **THEN** el sistema rechaza el registro con un error de validación y no crea `PAGO` ni cambia el estado

#### Scenario: Importe no positivo se rechaza

- **GIVEN** una RESERVA con `liquidacion_status = 'facturada'`
- **WHEN** el Gestor introduce `importe = 0` (o negativo)
- **THEN** el sistema rechaza el registro con un error de validación y no crea `PAGO` ni cambia el estado

### Requirement: El cobro habilita una precondición del inicio del evento sin transicionar la reserva

El sistema SHALL (DEBE), al dejar `RESERVA.liquidacion_status = 'cobrada'`, habilitar **una de las tres
precondiciones** de la futura transición `reserva_confirmada → evento_en_curso` (las otras dos son
`pre_evento_status = 'cerrado'` y `fianza_status = 'cobrada'`, US-031). Este requisito **NO** transiciona
por sí mismo el `RESERVA.estado` a `evento_en_curso` ni evalúa las otras precondiciones: la transición se
modela en US-031. (Fuente: `US-029 §Reglas de negocio`; `er-diagram.md §guarda evento_en_curso`.)

#### Scenario: Tras el cobro, el estado de la reserva no avanza a evento_en_curso

- **GIVEN** una RESERVA `reserva_confirmada` cuyo cobro de liquidación se acaba de registrar
  (`liquidacion_status = 'cobrada'`)
- **WHEN** el sistema completa el registro del cobro
- **THEN** `RESERVA.liquidacion_status = 'cobrada'` queda disponible como precondición del inicio del
  evento
- **AND** `RESERVA.estado` permanece `reserva_confirmada` (la transición a `evento_en_curso` es de US-031)

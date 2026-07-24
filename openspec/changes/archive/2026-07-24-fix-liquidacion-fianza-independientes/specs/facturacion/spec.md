# Spec Delta — Capability `facturacion` (MODIFICADA)

> Desacopla liquidación y fianza. La **liquidación** pasa a un flujo standalone espejo de la señal
> (aprobar + enviar, banner permanente, reenvío dedicado, E4 = solo liquidación). La **fianza**
> deja de ser una FACTURA que se emite: se **elimina** su borrador, su recibo, su acoplamiento en
> E4, su envío separado, su cobro por PAGO y la política "Negociable"; pasa a un flujo **pasivo**
> de subida de comprobante (espejo de `condiciones_particulares`). La **devolución** se simplifica
> a una devolución **completa** con email de confirmación, eliminando la retención parcial y las
> guardas de IBAN. Fuente: plan `fix-liquidacion-fianza-independientes`; US-027, US-028, US-029,
> US-030, US-036; UC-21, UC-22, UC-26, UC-27; `er-diagram.md §3.12 FACTURA`, `§RESERVA fianza_*`,
> `§3.15 DOCUMENTO`, `§3.16 COMUNICACION`.

## ADDED Requirements

### Requirement: Subida pasiva del comprobante de la fianza recibida

El sistema SHALL (DEBE) permitir al Gestor **subir el comprobante** de la transferencia de fianza
recibida del cliente sobre una RESERVA en `estado ∈ {reserva_confirmada, evento_en_curso,
post_evento}`, siguiendo el patrón pasivo de `condiciones_particulares` (capability `confirmacion`):
en una **única transacción atómica** (bajo contexto RLS del tenant del JWT), el sistema DEBE subir
el fichero al almacén de documentos y **crear una fila `DOCUMENTO`** con `tipo =
'comprobante_fianza'`, `reserva_id`, `tenant_id`, `url`, `mime_type`, `nombre_archivo` y
`tamano_bytes`; establecer `RESERVA.fianza_status = 'cobrada'` (comprobante recibido),
`RESERVA.fianza_cobrada_fecha = now()` y la referencia al comprobante
(`RESERVA.fianza_comprobante_fecha`, análoga a `cond_part_firmadas_fecha`); y registrar `AUDIT_LOG`
con `accion = 'actualizar'`. La subida es **opcional** (no requerida para ningún avance de estado),
acepta `mime_type ∈ {image/jpeg, image/png, application/pdf}` y tamaño ≤ 10 MB, y **NO** genera
ninguna FACTURA, recibo, numeración ni email. La subida **no es una transición** de la máquina de
estados. Es **re-subible** conservando el histórico de `DOCUMENTO` (la fila más reciente es la de
referencia). (Fuente: plan §Fianza pasiva; patrón `US-024 condiciones-firmadas`; `er-diagram.md
§3.15 DOCUMENTO`, `§RESERVA fianza_*`.)

#### Scenario: Subir el comprobante crea el DOCUMENTO y marca la fianza como cobrada

- **GIVEN** una RESERVA en `reserva_confirmada` con `fianza_status = 'pendiente'` bajo el tenant
  del JWT
- **WHEN** el Gestor sube el comprobante de la transferencia (PDF ≤ 10 MB)
- **THEN** se crea una fila `DOCUMENTO` con `tipo = 'comprobante_fianza'`, `reserva_id`, `tenant_id`,
  `url` y `mime_type`
- **AND** `RESERVA.fianza_status = 'cobrada'`, `RESERVA.fianza_cobrada_fecha` y
  `RESERVA.fianza_comprobante_fecha` quedan con el timestamp actual
- **AND** no se crea ninguna FACTURA de fianza ni se envía ningún email
- **AND** `AUDIT_LOG` registra `accion = 'actualizar'`

#### Scenario: La subida del comprobante es opcional y no bloquea el avance del evento

- **GIVEN** una RESERVA en `reserva_confirmada` con `fianza_status = 'pendiente'` sin comprobante
- **WHEN** se evalúa el avance del evento (ver capability `ficha-operativa`)
- **THEN** la ausencia del comprobante de fianza **no** bloquea la transición a `evento_en_curso`

#### Scenario: Re-subir el comprobante conserva el histórico

- **GIVEN** una RESERVA con `fianza_status = 'cobrada'` y un comprobante ya subido
- **WHEN** el Gestor sube una versión más legible del comprobante
- **THEN** se crea una **nueva** fila `DOCUMENTO` `tipo = 'comprobante_fianza'` (la anterior
  permanece) y `RESERVA.fianza_comprobante_fecha` se actualiza al nuevo timestamp

### Requirement: Emisión standalone de la factura de liquidación (flujo espejo de la señal)

El sistema SHALL (DEBE) permitir al Gestor **aprobar y enviar** la factura de liquidación como un
flujo **independiente** de la fianza y **espejo del flujo de la señal** (US-023), sobre una FACTURA
`tipo = 'liquidacion'` en `estado = 'borrador'`: pasar `FACTURA(liquidacion).estado = 'enviada'`,
asignar `numero_factura` `F-YYYY-NNNN` **en la emisión** (secuencial y único por `tenant_id` + año,
reutilizando la numeración de US-022 con `UNIQUE(tenant_id, numero_factura)` + reintento ante
`P2002`, **nunca** locks distribuidos), fijar `fecha_emision = now()`, marcar los `RESERVA_EXTRA`
sumados al borrador con el `factura_id` de la liquidación, y transicionar
`RESERVA.liquidacion_status = 'facturada'`, **solo si el envío del email E4 se confirma** (E4 = solo
liquidación; ver capability `comunicaciones`). El sistema DEBE registrar `AUDIT_LOG` con `accion =
'actualizar'`, `datos_anteriores.estado = 'borrador'`, `datos_nuevos.estado = 'enviada'`. Este flujo
**NO** emite ningún recibo de fianza, **NO** toca `RESERVA.fianza_status` y **NO** adjunta ningún PDF
de fianza. La ficha DEBE mostrar un **banner permanente** "Liquidación enviada el {fecha/hora}"
(derivado de `fecha_emision`), espejo del banner de la señal. (Fuente: plan §Liquidación standalone;
patrón `US-023 §Emisión y envío de la factura de señal`; `er-diagram.md §3.12 FACTURA`.)

#### Scenario: Aprobar y enviar la liquidación la emite con número y la deja enviada (solo liquidación)

- **GIVEN** una FACTURA `tipo = 'liquidacion'` en `estado = 'borrador'` con `numero_factura = NULL`,
  PDF disponible y datos fiscales válidos
- **WHEN** el Gestor aprueba y envía la liquidación y el envío de E4 se confirma
- **THEN** `FACTURA(liquidacion).estado = 'enviada'`, `numero_factura = 'F-{año}-NNNN'` y
  `fecha_emision` con el timestamp actual
- **AND** `RESERVA.liquidacion_status = 'facturada'` y los `RESERVA_EXTRA` sumados quedan marcados
  con el `factura_id`
- **AND** `RESERVA.fianza_status` no cambia y no se emite ningún recibo ni PDF de fianza
- **AND** `AUDIT_LOG` registra `accion = 'actualizar'` con `datos_anteriores.estado = 'borrador'` y
  `datos_nuevos.estado = 'enviada'`

#### Scenario: El banner permanente muestra la fecha y hora de envío de la liquidación

- **GIVEN** una FACTURA `tipo = 'liquidacion'` en `estado = 'enviada'` con `fecha_emision` informado
- **WHEN** se lee la ficha de la reserva
- **THEN** la sección de liquidación muestra un banner permanente "Liquidación enviada el
  {fecha/hora}" derivado de `fecha_emision`

### Requirement: Registro de la devolución completa de la fianza con email de confirmación

El sistema SHALL (DEBE) permitir al Gestor registrar la **devolución completa** de la fianza sobre
una RESERVA en `estado = 'post_evento'` con `fianza_status = 'cobrada'`, con una **única acción**
("Devolver fianza") **sin** pedir IBAN, importe ni motivo. En una **única transacción atómica** (bajo
contexto RLS del tenant del JWT), el sistema DEBE: establecer `RESERVA.fianza_status = 'devuelta'` y
`RESERVA.fianza_devuelta_fecha = now()` (la devolución es siempre por el importe completo
`fianza_eur`, no se persiste un importe devuelto parcial); y registrar `AUDIT_LOG` con `accion =
'actualizar'`, `entidad = 'RESERVA'`, `datos_anteriores = {fianza_status: 'cobrada',
fianza_devuelta_fecha: null}`, `datos_nuevos = {fianza_status: 'devuelta', fianza_devuelta_fecha}`.
Como efecto **posterior al commit** y **best-effort** (patrón `disparar-e8.adapter.ts`), el sistema
DEBE disparar el **email nuevo de "fianza devuelta"** al `CLIENTE.email` (capability
`comunicaciones`): su fallo **no revierte** el registro de la devolución (la RESERVA permanece en
`devuelta`) y es **reintentable**. La acción **no** genera ninguna FACTURA. El estado `devuelta` es
**final e irreversible** en MVP. (Fuente: plan §Devolución simplificada; UC-27; patrón post-commit
best-effort `US-035 disparar-e8`; `er-diagram.md §RESERVA fianza_*`, `§3.16 COMUNICACION`.)

#### Scenario: Devolver fianza deja la fianza en devuelta y dispara el email de confirmación

- **GIVEN** una RESERVA en `post_evento` con `fianza_status = 'cobrada'`, `fianza_eur = 500.00` y
  `fianza_cobrada_fecha` informado
- **WHEN** el Gestor pulsa "Devolver fianza"
- **THEN** `RESERVA.fianza_status = 'devuelta'` y `RESERVA.fianza_devuelta_fecha` queda con el
  timestamp actual
- **AND** el sistema dispara, post-commit, el email de "fianza devuelta" al `CLIENTE.email` con el
  importe `fianza_eur`
- **AND** `AUDIT_LOG` registra `accion = 'actualizar'` con `datos_anteriores.fianza_status =
  'cobrada'` y `datos_nuevos.fianza_status = 'devuelta'`
- **AND** no se genera ninguna FACTURA y no se pide IBAN, importe ni motivo

#### Scenario: El fallo del email post-commit no revierte la devolución

- **GIVEN** una RESERVA cuya devolución de fianza acaba de registrarse (`fianza_status = 'devuelta'`,
  commit realizado)
- **WHEN** el envío del email de "fianza devuelta" falla en el proveedor
- **THEN** la RESERVA permanece en `fianza_status = 'devuelta'` (el registro no se revierte)
- **AND** la `COMUNICACION` queda en `fallido` y el email es reintentable desde la ficha

#### Scenario: Segundo intento de devolución sobre fianza ya devuelta se rechaza

- **GIVEN** una RESERVA con `fianza_status = 'devuelta'` (la devolución ya fue registrada)
- **WHEN** el Gestor intenta registrar otra devolución
- **THEN** el sistema rechaza la acción ("La devolución de la fianza ya está registrada") sin
  modificar `RESERVA` (la guarda se evalúa dentro de la transacción con `SELECT ... FOR UPDATE`,
  nunca con locks distribuidos)

## MODIFIED Requirements

### Requirement: Generación automática de la factura de liquidación en borrador al activar los sub-procesos

El sistema SHALL (DEBE), como efecto **posterior al commit** de la transición de la RESERVA a
`reserva_confirmada` y de la activación de sus sub-procesos (US-021), cuando `RESERVA.estado =
'reserva_confirmada'` Y `RESERVA.liquidacion_status = 'pendiente'`, crear **una** FACTURA con
`tipo = 'liquidacion'`, `estado = 'borrador'`, `reserva_id` de la RESERVA, `tenant_id` correcto,
`numero_factura = NULL` y `total = RESERVA.importe_liquidacion + Σ(RESERVA_EXTRA.subtotal WHERE
factura_id IS NULL)` de esa reserva. `RESERVA.importe_liquidacion` viene **congelado** de US-021
(`importe_total − importe_senal`, 60 % MVP): el sistema NO recalcula el porcentaje ni la tarifa,
y **suma** los `subtotal` ya congelados por línea sin recalcularlos. El sistema NO marca los
`RESERVA_EXTRA` con `factura_id` en la fase de borrador (ese marcado ocurre al emitir). El sistema
**NO genera** ningún borrador ni recibo de fianza (la fianza deja de ser una FACTURA que se emite;
ver requisitos de fianza pasiva). El fallo de esta generación NO revierte la confirmación ya
realizada. (Fuente: plan §Liquidación standalone / §Fianza pasiva; `US-027 §Historia`, `§Happy Path`;
UC-21; `er-diagram.md §3.12 FACTURA`, `§3.10 RESERVA_EXTRA`.)

#### Scenario: Liquidación con extras pendientes suma el 60 % y los extras con factura_id nulo

- **GIVEN** una RESERVA que ha transitado a `reserva_confirmada` con `importe_liquidacion =
  3.600,00 €` y dos `RESERVA_EXTRA` con `factura_id IS NULL` de subtotales `300,00 €` y `200,00 €`
- **WHEN** el sistema genera la factura de liquidación al activar los sub-procesos
- **THEN** se crea una FACTURA con `tipo = 'liquidacion'`, `estado = 'borrador'`, `numero_factura
  = NULL`, `total = 4.100,00 €`, `reserva_id` de la RESERVA y `tenant_id` correcto

#### Scenario: La activación de los sub-procesos no genera ningún borrador de fianza

- **GIVEN** una RESERVA que ha transitado a `reserva_confirmada` con `fianza_status = 'pendiente'`
- **WHEN** el sistema activa los sub-procesos tras el commit
- **THEN** se genera únicamente el borrador de la factura de liquidación
- **AND** no se crea ninguna FACTURA de tipo `fianza` ni ningún recibo

### Requirement: Idempotencia — una única liquidación y un único recibo de fianza por reserva

El sistema SHALL (DEBE) garantizar que exista **como máximo una** FACTURA con `tipo =
'liquidacion'` por `reserva_id` en estado `borrador` o `enviada`. Antes de crear el borrador de
liquidación, el sistema comprueba si ya existe una FACTURA con ese `reserva_id` y `tipo =
'liquidacion'`; si existe, **NO crea un duplicado** (operación idempotente, sin efecto secundario).
La unicidad la refuerza en BD la restricción `UNIQUE(reserva_id, tipo)` ya introducida en US-022
(cubre `senal` y `liquidacion`; el tipo `fianza` **deja de existir**): una reinvocación concurrente
del trigger que sortee la guarda aborta por `P2002` y recupera la existente. **Ya no existe recibo de
fianza** cuya unicidad garantizar (la fianza pasa a un flujo pasivo de comprobante). (Fuente: plan
§Fianza pasiva; `US-027 §Idempotencia — trigger duplicado`, `§Reglas de Validación`.)

#### Scenario: Reinvocación del trigger no duplica el borrador de liquidación

- **GIVEN** una RESERVA que ya tiene una FACTURA `tipo = 'liquidacion'` en `borrador`
- **WHEN** el trigger de activación de sub-procesos se ejecuta de nuevo para esa RESERVA
- **THEN** el sistema detecta el borrador existente y **no** crea un documento duplicado
- **AND** la operación no tiene efecto secundario (idempotente) y no crea ninguna FACTURA de fianza

### Requirement: Numeración diferida a la emisión — numero_factura nulo en borrador

El sistema SHALL (DEBE) crear el borrador de liquidación con `numero_factura = NULL`. La asignación
del `numero_factura` con formato `F-YYYY-NNNN` (secuencial y único por `tenant_id` + año) se produce
**solo al emitir/enviar** la liquidación, reutilizando la numeración ya definida en `facturacion`
(US-022). En borrador, la ausencia de `numero_factura` NO viola la unicidad `UNIQUE(tenant_id,
numero_factura)`, que solo aplica a valores no nulos. (Fuente: plan §Liquidación standalone; `US-027
§Reglas de negocio` `numero_factura` no se asigna en borrador.)

#### Scenario: El borrador de liquidación no lleva número de factura

- **GIVEN** una RESERVA `reserva_confirmada` para la que se genera el borrador de liquidación
- **WHEN** el sistema crea la FACTURA en `borrador`
- **THEN** tiene `numero_factura = NULL` y solo recibirá `F-YYYY-NNNN` al emitirse

### Requirement: Alerta al Gestor de documentos pendientes de revisión

El sistema SHALL (DEBE), tras generar el borrador de liquidación, alertar al Gestor en la UI con el
texto "Factura de liquidación pendiente de revisión". La alerta menciona **solo** la factura de
liquidación (la fianza deja de generar documento y por tanto no aparece en la alerta). La alerta es
una señal de UI (no un email: E4 se dispara tras la aprobación del Gestor). (Fuente: plan §Fianza
pasiva; `US-027 §Happy Path`, `§Email relacionado`.)

#### Scenario: La alerta cita solo la factura de liquidación

- **GIVEN** una RESERVA para la que se ha generado el borrador de liquidación
- **WHEN** el sistema completa la generación
- **THEN** el Gestor recibe la alerta "Factura de liquidación pendiente de revisión" (sin mención a
  la fianza)

### Requirement: Auditoría de la creación de los borradores de liquidación y fianza

El sistema SHALL (DEBE) registrar en `AUDIT_LOG` una entrada con `accion = 'crear'`, `entidad =
'FACTURA'` y el `entidad_id` de la FACTURA de liquidación creada. **No** se registra ninguna creación
de FACTURA de fianza: la fianza deja de generarse como FACTURA (pasa a un flujo pasivo de comprobante),
por lo que solo se audita la creación de la liquidación. (Fuente: plan §Fianza pasiva; `US-027 §Happy
Path`.)

#### Scenario: Crear el borrador de liquidación registra un AUDIT_LOG de creación

- **GIVEN** una RESERVA para la que se genera el borrador de liquidación
- **WHEN** el sistema crea la FACTURA
- **THEN** `AUDIT_LOG` registra una única entrada con `accion = 'crear'`, `entidad = 'FACTURA'` con
  el `entidad_id` de la liquidación

## REMOVED Requirements

### Requirement: Generación automática del recibo de fianza en borrador

**Motivo:** la fianza deja de ser una FACTURA que se emite. No se genera ningún borrador de recibo
de fianza; la fianza pasa a un flujo pasivo de subida de comprobante (ver ADDED "Subida pasiva del
comprobante de la fianza recibida"). **Migración:** dejar de crear FACTURA `tipo = 'fianza'` al
activar los sub-procesos.

### Requirement: Omisión del recibo de fianza cuando el importe por defecto es cero

**Motivo:** ya no se genera ningún recibo de fianza en ningún caso, por lo que la lógica de omisión
condicional por `fianza_default_eur = 0` queda sin objeto.

### Requirement: Emisión de la factura de liquidación al aprobar y enviar (borrador → enviada con número asignado)

**Motivo:** reemplazada por la nueva "Emisión standalone de la factura de liquidación (flujo espejo
de la señal)". La emisión deja de ser la acción combinada acoplada a la fianza con atomicidad
estado↔E4; pasa a un flujo standalone espejo de la señal con E4 = solo liquidación.

### Requirement: Nomenclatura personalizada de los adjuntos PDF de factura (E4 y envío separado)

**Motivo:** desaparece el adjunto de recibo de fianza en E4 y el envío separado. La nomenclatura del
adjunto de liquidación (`{numeroFactura} {clienteNombre} {clienteApellidos}.pdf`) se conserva como
parte del flujo standalone de liquidación (ver ADDED "Emisión standalone…") y del patrón ya vivo de
la señal; este requisito específico —que mezclaba liquidación y fianza en E4/envío separado— se
retira.

### Requirement: Atomicidad entre la transición de estado y el envío de E4 (rollback ante fallo)

**Motivo:** la atomicidad combinada liquidación+fianza (que emitía el recibo de fianza y avanzaba
`fianza_status = 'recibo_enviado'` en la misma operación) desaparece con el desacoplamiento. La
liquidación standalone conserva su propia condición "solo si E4 se confirma" (ver ADDED "Emisión
standalone…"), pero E4 = solo liquidación y no toca la fianza.

### Requirement: Emisión del recibo de fianza como efecto del envío de E4

**Motivo:** E4 = solo liquidación. El recibo de fianza deja de existir y de emitirse como efecto de
E4.

### Requirement: Envío del recibo de fianza por separado (sin la liquidación)

**Motivo:** desaparece el recibo de fianza y por tanto su envío separado al cliente. La fianza pasa
a subida pasiva de comprobante, sin envíos al cliente.

### Requirement: Registro del cobro de la fianza (creación de PAGO y transición a cobrada)

**Motivo:** el cobro de la fianza deja de modelarse como PAGO contra una FACTURA de fianza.
`fianza_status = 'cobrada'` pasa a significar "comprobante recibido" y se establece al subir el
comprobante (ver ADDED "Subida pasiva del comprobante de la fianza recibida").

### Requirement: El justificante de pago de la fianza es opcional

**Motivo:** ligado al cobro de la fianza por PAGO, que se elimina. El comprobante de la fianza es su
sustituto (documento opcional en el flujo pasivo).

### Requirement: El cobro de la fianza se admite en cualquier fecha hasta el día del evento

**Motivo:** ligado al cobro de la fianza por PAGO, que se elimina.

### Requirement: Guarda contra el doble cobro de la fianza

**Motivo:** ligado al cobro de la fianza por PAGO, que se elimina.

### Requirement: Política "Negociable" — el cobro con fianza pendiente avisa pero no bloquea

**Motivo:** la política "Negociable" (avisar y permitir cobrar sin recibo enviado, crear FACTURA de
fianza al vuelo, saltos de estado `borrador → cobrada`) queda sin objeto: la fianza deja de ser una
FACTURA y su cobro por PAGO se elimina.

### Requirement: Validación de fecha de cobro no posterior al evento e importe positivo

**Motivo:** ligado al cobro de la fianza por PAGO, que se elimina.

### Requirement: El cobro de la fianza habilita la tercera precondición del inicio del evento sin transicionar la reserva

**Motivo:** la fianza deja de ser precondición de `reserva_confirmada → evento_en_curso` (ver delta
`ficha-operativa`). La transición pasa a depender solo de `pre_evento_status = 'cerrado'` y
`liquidacion_status = 'cobrada'`.

### Requirement: Registro de la devolución de la fianza con derivación del estado final y auditoría

**Motivo:** reemplazada por la nueva "Registro de la devolución completa de la fianza con email de
confirmación". La devolución deja de derivar el estado final por importe (devuelta vs.
retenida_parcial), deja de exigir IBAN y deja de indicar importe/fecha; pasa a ser una devolución
**completa** con email de confirmación nuevo.

### Requirement: Devolución parcial o retención total deja la fianza en retenida_parcial con motivo

**Motivo:** se elimina la retención parcial (`fianza_status = 'retenida_parcial'`,
`motivo_retencion`, `fianza_devuelta_eur`). Toda devolución es completa. **Migración:** eliminar el
enum `retenida_parcial` y los campos `RESERVA.motivo_retencion` / `fianza_devuelta_eur`.

### Requirement: Validación del importe devuelto no superior a la fianza cobrada

**Motivo:** la devolución es completa (importe = `fianza_eur`); el Gestor no introduce importe, por
lo que la validación queda sin objeto.

### Requirement: Validación de la fecha de devolución no anterior a la fecha de cobro de la fianza

**Motivo:** el Gestor no introduce fecha de devolución (`fianza_devuelta_fecha = now()` al registrar);
la validación queda sin objeto.

### Requirement: El justificante de la devolución es un DOCUMENTO opcional (tipo justificante_pago)

**Motivo:** el flujo de devolución se simplifica a una sola acción "Devolver fianza" con email de
confirmación; no se adjunta justificante de la devolución en MVP.

### Requirement: Precondición triple de disponibilidad del registro de devolución

**Motivo:** reemplazada por la precondición de la nueva "Registro de la devolución completa…"
(`post_evento` + `fianza_status = 'cobrada'`). Se **elimina** la condición `CLIENTE.iban_devolucion
IS NOT NULL` (se retira la captura de IBAN). **Migración:** eliminar `CLIENTE.iban_devolucion`.

### Requirement: Guarda contra el doble registro de la devolución e irreversibilidad del estado final

**Motivo:** la guarda contra doble registro y la irreversibilidad se conservan en la nueva "Registro
de la devolución completa…" pero solo sobre el estado `devuelta` (desaparece `retenida_parcial`);
este requisito, que referenciaba `{devuelta, retenida_parcial}`, se retira y se reemplaza.

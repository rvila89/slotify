# Spec Delta — Capability `comunicaciones`

> US-014 amplía la capability `comunicaciones` cableando el **trigger del email E2**
> (presupuesto PDF adjunto con el desglose 40%/60%/fianza + instrucciones de transferencia),
> que US-045 dejó **declarado como diseñado/inactivo**. El email E2 se dispara **tras el
> commit** de la activación de `pre_reserva` (capabilities `presupuestos` + `consultas`),
> reutilizando el motor de email E1–E8 de US-045 y su **interfaz de adjuntos por referencia
> a `pdf_url`** del PRESUPUESTO. Este delta **no redefine** el motor: solo activa E2 y su
> registro en `COMUNICACION`/`AUDIT_LOG`.
> Fuente: US-014, UC-14; E2 §9.3; US-045 (motor de email, interfaz de adjuntos).

## ADDED Requirements

### Requirement: La activación de pre_reserva dispara el email E2 con el PDF del presupuesto

El sistema SHALL (DEBE), tras la activación exitosa de la pre-reserva (creación del
PRESUPUESTO + transición de la RESERVA a `pre_reserva`), disparar el envío del email **E2**
al cliente de la RESERVA, adjuntando por referencia el **PDF del presupuesto**
(`PRESUPUESTO.pdf_url`) con el desglose de tarifa (base + IVA 21%), extras, total, reparto
40%/60%/fianza e instrucciones de transferencia, reutilizando el **motor de email de US-045**
y su **interfaz de adjuntos**. El sistema DEBE registrar el resultado en `COMUNICACION` con
`codigo_email = 'E2'`, `estado = 'enviado'`, `reserva_id` = la RESERVA, `cliente_id` = el
CLIENTE de esa RESERVA y el `tenant_id` correspondiente, y registrar la operación en
`AUDIT_LOG`. La idempotencia por `(reserva_id, codigo_email)` del motor de US-045 garantiza
**una sola** E2 por RESERVA. (Fuente: `US-014 §Email relacionado E2`, `§Happy Path`; UC-14;
E2 §9.3; US-045 §Catálogo de plantillas, §Interfaz de adjuntos, §Idempotencia.)

#### Scenario: Confirmar el presupuesto envía E2 y crea la fila de COMUNICACION

- **GIVEN** una activación de `pre_reserva` que acaba de crear el PRESUPUESTO con su
  `pdf_url` disponible
- **WHEN** el sistema completa la operación tras el commit
- **THEN** el motor de email envía E2 al cliente con el PDF del presupuesto adjunto
- **AND** se crea una fila en `COMUNICACION` con `codigo_email = 'E2'`, `estado = 'enviado'`,
  `reserva_id` = esta RESERVA, `cliente_id` = el CLIENTE de la reserva y el `tenant_id`
  correcto

#### Scenario: E2 no se duplica ante un segundo disparo sobre la misma RESERVA

- **GIVEN** una RESERVA que ya tiene una `COMUNICACION` con `codigo_email = 'E2'`
- **WHEN** el trigger E2 se vuelve a disparar para esa RESERVA
- **THEN** el motor detecta la entrada existente y no crea una segunda `COMUNICACION` E2 ni
  reenvía el email (idempotencia por `(reserva_id, codigo_email)` de US-045)

### Requirement: El envío de E2 es posterior al commit y su fallo no revierte la pre_reserva

El sistema SHALL (DEBE) disparar el envío de E2 **después** del commit de la transacción que
crea el PRESUPUESTO, deja la RESERVA en `pre_reserva`, actualiza/crea `FECHA_BLOQUEADA` y
vacía la cola, de modo que un fallo del proveedor de email **NO** revierta la activación de
la pre-reserva (la transición y el bloqueo son válidos e inmutables por el fallo de envío).
Un fallo o reintento del envío DEBE quedar **trazado en `COMUNICACION`** (con un `estado`
distinto de `'enviado'`, p. ej. `'fallido'`) para su seguimiento/reintento, coherente con el
motor de US-045. Si el `PRESUPUESTO.pdf_url` requerido por el adjunto no está disponible, el
motor NO DEBE enviar E2 y DEBE registrar el error (interfaz de adjuntos de US-045). En
entornos `test`/CI el transporte DEBE operar en **modo fake** (sin envíos reales por red).
(Fuente: `US-014 §Email relacionado`; US-045 §Fallo del proveedor, §Interfaz de adjuntos,
§Transporte real / modo sandbox.)

#### Scenario: Un fallo del proveedor de email no saca la RESERVA de pre_reserva

- **GIVEN** una activación de `pre_reserva` cuyo commit (PRESUPUESTO + RESERVA +
  `FECHA_BLOQUEADA` + cola) ya ha tenido éxito
- **WHEN** el envío posterior de E2 falla en el proveedor
- **THEN** la RESERVA permanece en `estado = 'pre_reserva'` con su bloqueo a 7 días (el
  estado no se revierte)
- **AND** el fallo del envío queda trazado en `COMUNICACION` para reintento/seguimiento

#### Scenario: En test/CI E2 no envía correos reales

- **GIVEN** el entorno de test o CI con el transporte de email en modo fake
- **WHEN** una activación de `pre_reserva` dispara E2
- **THEN** no se realiza ninguna llamada de red al proveedor externo
- **AND** el disparo de E2 y su registro en `COMUNICACION` quedan verificables para las
  aserciones de los tests

# Spec Delta — Capability `comunicaciones`

> US-008 amplía la capability `comunicaciones` con el **disparo automático del email E6**
> (confirmación de visita programada con fecha/hora) al transicionar una RESERVA a `2.v`, y
> su **registro en `COMUNICACION`**. Reutiliza el motor de email E1–E8 de US-045 (selección
> de plantilla, sustitución de variables, envío por el puerto de dominio, trazado en
> `COMUNICACION` + `AUDIT_LOG`), **sin reinventarlo**. El envío es **posterior al commit**
> del estado de la visita (la atomicidad de RESERVA + `FECHA_BLOQUEADA` se especifica en el
> delta de `consultas`); un fallo del proveedor no revierte la transición y queda trazado en
> `COMUNICACION` para reintento/seguimiento.
> Fuente: US-008, UC-07; A18; E6 (§9.3); `design.md §D-6`; `US-045` (motor de email).

## ADDED Requirements

### Requirement: La transición a 2.v dispara el email E6 al cliente y lo registra en COMUNICACION

El sistema SHALL (DEBE), en **toda transición exitosa** de una RESERVA a `sub_estado = '2v'`
(programación de visita), disparar el envío del email **E6** (confirmación de visita
programada con su fecha y hora) al cliente de la RESERVA, reutilizando el motor de email de
US-045. El sistema DEBE registrar el resultado en `COMUNICACION` con `codigo_email = 'E6'`,
`estado = 'enviado'`, `reserva_id` = la RESERVA que transiciona, `cliente_id` = el CLIENTE de
esa RESERVA y el `tenant_id` correspondiente. El registro en `COMUNICACION` se realiza con
independencia de si el bloqueo de `FECHA_BLOQUEADA` fue **creado** (origen `2.a`) o
**actualizado** (origen `2.b`/`2.c`). (Fuente: `US-008 §Happy Path`, `§Reglas de negocio`,
`§Reglas de Validación`; A18; E6 §9.3.)

#### Scenario: Transición a 2.v envía E6 y crea la fila de COMUNICACION

- **GIVEN** una RESERVA que acaba de transicionar correctamente a `sub_estado = '2v'` con su
  `visita_programada_fecha` y `visita_programada_hora`
- **WHEN** el sistema completa la transición
- **THEN** el motor de email envía E6 al cliente con la fecha y la hora de visita confirmadas
- **AND** se crea una fila en `COMUNICACION` con `codigo_email = 'E6'`, `estado = 'enviado'`,
  `reserva_id` = esta RESERVA, `cliente_id` = el CLIENTE de la reserva y el `tenant_id` correcto

#### Scenario: E6 se registra tanto si el bloqueo es nuevo como si se actualiza

- **GIVEN** dos transiciones a `2.v`: una desde `2.a` (crea fila en `FECHA_BLOQUEADA`) y otra
  desde `2.b` (actualiza la fila existente)
- **WHEN** ambas transiciones se completan
- **THEN** en ambos casos se envía E6 y se registra en `COMUNICACION` con `codigo_email = 'E6'`

### Requirement: El envío de E6 es posterior al commit y su fallo no revierte la transición a 2.v

El sistema SHALL (DEBE) disparar el envío de E6 **después** del commit de la transacción que
deja la RESERVA en `2.v` y actualiza/crea `FECHA_BLOQUEADA`, de modo que un fallo del
proveedor de email **NO** revierta el estado de la visita (la transición es válida e
inmutable por el fallo de envío). Un fallo o reintento del envío DEBE quedar **trazado en
`COMUNICACION`** (con un `estado` distinto de `'enviado'`) para su seguimiento/reintento,
coherente con el motor de US-045. En entornos `test`/CI, el transporte de email DEBE operar
en **modo fake** (sin envíos reales por red), de modo que las pruebas verifiquen el disparo de
E6 y su registro en `COMUNICACION` sin enviar correos a destinatarios reales. (Fuente:
`design.md §D-6`; `US-045 §Transporte real / modo sandbox`.)

#### Scenario: Un fallo del proveedor de email no deja la RESERVA fuera de 2.v

- **GIVEN** una transición a `2.v` cuyo commit de estado (RESERVA + `FECHA_BLOQUEADA`) ya ha
  tenido éxito
- **WHEN** el envío posterior de E6 falla en el proveedor
- **THEN** la RESERVA permanece en `sub_estado = '2v'` con su bloqueo correcto (el estado no
  se revierte)
- **AND** el fallo del envío queda trazado en `COMUNICACION` para reintento/seguimiento

#### Scenario: En test/CI E6 no envía correos reales

- **GIVEN** el entorno de test o CI con el transporte de email en modo fake
- **WHEN** una transición a `2.v` dispara E6
- **THEN** no se realiza ninguna llamada de red al proveedor externo
- **AND** el disparo de E6 y el registro en `COMUNICACION` quedan verificables para las
  aserciones de los tests

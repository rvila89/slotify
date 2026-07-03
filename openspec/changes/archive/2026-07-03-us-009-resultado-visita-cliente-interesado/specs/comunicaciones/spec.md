# Spec Delta — Capability `comunicaciones`

> US-009 amplía la capability `comunicaciones` con el **disparo automático del email E7**
> (confirmación de bloqueo post-visita, 3 días) al transicionar una RESERVA de `2.v` a `2.b`
> por resultado "cliente interesado", y su **registro en `COMUNICACION`**. Reutiliza el motor
> de email E1–E8 de US-045 (selección de plantilla, sustitución de variables, envío por el
> puerto de dominio, trazado en `COMUNICACION` + `AUDIT_LOG`, idempotencia
> `(reserva_id, codigo_email)`), **sin reinventarlo**. El envío es **posterior al commit** del
> estado (la atomicidad de RESERVA + `FECHA_BLOQUEADA` se especifica en el delta de
> `consultas`); un fallo del proveedor no revierte la transición y queda trazado en
> `COMUNICACION` con `estado = 'fallido'` para reintento/seguimiento.
> Fuente: US-009, UC-08; E7; `design.md §D-4`; `US-045` (motor de email); `api-spec.yml`
> (`CodigoEmail` enum incluye `E7`).

## ADDED Requirements

### Requirement: La transición 2.v → 2.b (cliente interesado) dispara el email E7 y lo registra en COMUNICACION

El sistema SHALL (DEBE), en **toda transición exitosa** de una RESERVA de `2.v` a `2.b` por
resultado "cliente interesado", disparar el envío del email **E7** (confirmación de bloqueo
post-visita, con el plazo de 3 días para decidir) al cliente de la RESERVA, reutilizando el
motor de email de US-045. El sistema DEBE registrar el resultado en `COMUNICACION` con
`codigo_email = 'E7'`, `estado = 'enviado'`, `reserva_id` = la RESERVA que transiciona,
`cliente_id` = el CLIENTE de esa RESERVA y el `tenant_id` correspondiente. La idempotencia
`(reserva_id, codigo_email)` de US-045 garantiza a lo sumo una fila E7 por RESERVA. (Fuente:
`US-009 §Happy Path`, `§Reglas de negocio`, `§Reglas de Validación`; E7.)

#### Scenario: La transición a 2.b envía E7 y crea la fila de COMUNICACION

- **GIVEN** una RESERVA que acaba de transicionar correctamente de `2v` a `2b` por "cliente
  interesado"
- **WHEN** el sistema completa la transición
- **THEN** el motor de email envía E7 al cliente confirmando el bloqueo post-visita (3 días)
- **AND** se crea una fila en `COMUNICACION` con `codigo_email = 'E7'`, `estado = 'enviado'`,
  `reserva_id` = esta RESERVA, `cliente_id` = el CLIENTE de la reserva y el `tenant_id` correcto

### Requirement: El envío de E7 es posterior al commit y su fallo no revierte la transición a 2.b

El sistema SHALL (DEBE) disparar el envío de E7 **después** del commit de la transacción que
deja la RESERVA en `2.b` (`visita_realizada = true`, TTL fresco) y actualiza `FECHA_BLOQUEADA`,
de modo que un fallo del proveedor de email **NO** revierta el estado (la transición es válida
e inmutable por el fallo de envío). Un fallo o reintento del envío DEBE quedar **trazado en
`COMUNICACION`** con `estado = 'fallido'` (distinto de `'enviado'`) para su
seguimiento/reintento, coherente con el motor de US-045. En entornos `test`/CI, el transporte
de email DEBE operar en **modo fake** (sin envíos reales por red), de modo que las pruebas
verifiquen el disparo de E7 y su registro en `COMUNICACION` sin enviar correos a destinatarios
reales. (Fuente: `US-009 §Reglas de Validación`; `design.md §D-4`; `US-045 §Transporte real /
modo sandbox`.)

#### Scenario: Un fallo del proveedor de email no deja la RESERVA fuera de 2.b

- **GIVEN** una transición a `2.b` cuyo commit de estado (RESERVA + `FECHA_BLOQUEADA`) ya ha
  tenido éxito
- **WHEN** el envío posterior de E7 falla en el proveedor
- **THEN** la RESERVA permanece en `sub_estado = '2b'` con `visita_realizada = true` y su TTL
  fresco (el estado no se revierte)
- **AND** el fallo del envío queda trazado en `COMUNICACION` con `estado = 'fallido'` para
  reintento/seguimiento

#### Scenario: En test/CI E7 no envía correos reales

- **GIVEN** el entorno de test o CI con el transporte de email en modo fake
- **WHEN** una transición `2v → 2b` por "cliente interesado" dispara E7
- **THEN** no se realiza ninguna llamada de red al proveedor externo
- **AND** el disparo de E7 y el registro en `COMUNICACION` quedan verificables para las
  aserciones de los tests

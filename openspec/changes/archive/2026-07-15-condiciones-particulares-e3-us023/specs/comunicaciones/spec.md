# Spec Delta — Capability `comunicaciones` (MODIFICADA)

> US-023 habilita el **reenvío manual de E3** en la capa de comunicaciones (GAP 3): cada reenvío
> crea una **nueva** `COMUNICACION` E3 con `es_reenvio = true`, que **esquiva** el índice UNIQUE
> parcial `(reserva_id, codigo_email) WHERE ... es_reenvio = false`. Espejo del reenvío de E4
> (US-028). 6.4b había dejado el reenvío de E3 **fuera de alcance** dentro del requisito de
> idempotencia; este delta lo **MODIFICA** para acotar ese requisito al primer disparo y remitir el
> reenvío al nuevo requisito. Fuente: US-023 (§E3 ya enviado previamente — reenvío); patrón US-028
> §Reenvío de E4; US-045 §Idempotencia índice parcial + `es_reenvio`; `design.md §D-reenvio-e3`.

## ADDED Requirements

### Requirement: El reenvío manual de E3 crea una nueva COMUNICACION con es_reenvio marcado

El sistema SHALL (DEBE), cuando el Gestor reenvía E3 (delta `facturacion`), crear una **nueva**
`COMUNICACION` con `codigo_email = 'E3'`, `estado = 'enviado'`, `es_reenvio = true`,
`fecha_envio = now()`, `reserva_id`, `cliente_id` y `tenant_id` correctos, por cada reenvío. Al
llevar `es_reenvio = true`, la fila queda **fuera** del índice UNIQUE parcial
`(reserva_id, codigo_email) WHERE reserva_id IS NOT NULL AND es_reenvio = false` (US-045), de modo
que **no colisiona** (`P2002`) con la COMUNICACION E3 original (`es_reenvio = false`) ni entre
reenvíos sucesivos. El reenvío reutiliza los adjuntos ya existentes (PDF de la factura de señal y
`DOCUMENTO` de condiciones) y es una **excepción explícita y auditada** a la idempotencia: el
reenvío manual del Gestor es intencionado y DEBE quedar trazado como una nueva comunicación. El
envío usa el **puerto directo** (`EnviarEmailPort`, `codigo_email = 'E3'`) y ocurre **antes** de
crear la COMUNICACION (espejo del reenvío de E4); si el proveedor falla, propaga el error recuperable
y **no queda** ninguna COMUNICACION de reenvío (no se llegó a escribir en BD). (Fuente: `US-023 §E3 ya
enviado previamente (reenvío)`; patrón US-028 §Reenvío de E4; US-045 §Idempotencia índice parcial;
`design.md §D-reenvio-e3`.)

#### Scenario: Cada reenvío de E3 deja su propia COMUNICACION es_reenvio

- **GIVEN** una RESERVA con una `COMUNICACION` E3 `enviado` original (`es_reenvio = false`)
- **WHEN** el Gestor reenvía E3
- **THEN** se crea una nueva `COMUNICACION` `codigo_email = 'E3'`, `estado = 'enviado'`,
  `es_reenvio = true`, `fecha_envio` no nulo
- **AND** la inserción no colisiona con la COMUNICACION E3 original por el índice UNIQUE parcial

#### Scenario: Un segundo reenvío tampoco colisiona

- **GIVEN** una RESERVA que ya tuvo un primer reenvío de E3 (`es_reenvio = true`)
- **WHEN** el Gestor reenvía E3 de nuevo
- **THEN** se crea otra `COMUNICACION` E3 `es_reenvio = true` sin error de unicidad

#### Scenario: El fallo del proveedor en el reenvío no deja COMUNICACION

- **GIVEN** una RESERVA con E3 ya enviado
- **WHEN** el Gestor reenvía E3 pero el proveedor falla
- **THEN** no se crea ninguna `COMUNICACION` E3 de reenvío (el email va primero: al fallar no se
  escribe en BD) y el sistema devuelve un error recuperable

## MODIFIED Requirements

### Requirement: Idempotencia del disparo de E3 (no re-enviar si ya se envió)

El sistema SHALL (DEBE), antes de disparar E3 por la acción de **primer envío**
(`.../senal/enviar`), comprobar si ya existe una `COMUNICACION` con `reserva_id` de la RESERVA,
`codigo_email = 'E3'`, `es_reenvio = false` en `estado = 'enviado'`. Si existe, NO DEBE re-enviar el
email ni crear una segunda `COMUNICACION` E3 `enviado` con `es_reenvio = false`; la acción de primer
envío se rechaza (ver delta `facturacion`, `E3_YA_ENVIADO`). El **reenvío explícito** de E3 (nueva
`COMUNICACION` con `es_reenvio = true`) **YA NO está fuera de alcance**: se realiza por la acción
dedicada de reenvío (`.../senal/reenviar`, ver el requisito de reenvío y el delta `facturacion`),
que es una excepción explícita y auditada a esta idempotencia. Una `COMUNICACION` E3 previa en
`estado = 'fallido'` NO bloquea el reintento. (Fuente: `US-023 §E3 ya enviado previamente`,
`§Reglas de Validación`; `design.md §D-reenvio-e3`; reemplaza la acotación "reenvío fuera de
alcance" de 6.4b.)

> US-023 **acota** este requisito al **primer disparo** de E3 (acción `.../senal/enviar`) y remite
> el **reenvío manual** al nuevo requisito "El reenvío manual de E3 crea una nueva COMUNICACION con
> es_reenvio marcado". 6.4b dejaba el reenvío fuera de alcance; ya no lo está.

#### Scenario: El primer disparo repetido de E3 se sigue rechazando

- **GIVEN** una RESERVA con una `COMUNICACION` E3 `enviado` (`es_reenvio = false`)
- **WHEN** el Gestor vuelve a usar la acción de primer envío `.../senal/enviar`
- **THEN** no se dispara un nuevo E3 con `es_reenvio = false` ni se crea una segunda COMUNICACION de
  ese tipo
- **AND** la acción de primer envío se rechaza (`E3_YA_ENVIADO`, ver delta `facturacion`)

#### Scenario: El reenvío explícito ya no está bloqueado

- **GIVEN** una RESERVA con E3 ya enviado (`es_reenvio = false`)
- **WHEN** el Gestor usa la acción dedicada de reenvío `.../senal/reenviar`
- **THEN** el sistema crea una nueva `COMUNICACION` E3 con `es_reenvio = true` (no aplica el bloqueo
  de idempotencia del primer disparo)

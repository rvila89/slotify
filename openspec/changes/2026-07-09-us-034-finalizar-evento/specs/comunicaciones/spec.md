# comunicaciones Specification

## ADDED Requirements

### Requirement: E5 (solicitud de IBAN) se dispara al finalizar el evento solo si fianza_eur > 0

El sistema SHALL (DEBE), al finalizar el evento (transición `evento_en_curso → post_evento`,
US-034), disparar el trigger de email **E5** (agradecimiento + solicitud de IBAN para la
devolución de fianza + enlace NPS) a través del **motor de email** de `comunicaciones` (US-045)
**únicamente cuando `RESERVA.fianza_eur > 0`**. El motor SHALL (DEBE) enviar E5 al
`CLIENTE.email` (nunca al gestor) y crear una `COMUNICACION` con `codigo_email = 'E5'`,
`reserva_id`, `cliente_id` y `tenant_id` correctos. Cuando `RESERVA.fianza_eur = 0`, el sistema
NO DEBE enviar E5 **ni** crear `COMUNICACION` para E5 (no hay IBAN que solicitar); la transición
de estado se ejecuta igualmente. E5 está **condicionado** a `fianza_eur > 0` mientras que la
transición es **incondicional**. (Fuente: `US-034 §Historia`, `§Reglas de negocio`,
`§Email relacionado` E5, `§Finalización sin fianza`, `§Reglas de Validación`; `comunicaciones`
Requirement "Motor de email reutilizable".)

#### Scenario: Finalización con fianza cobrada envía E5 al cliente

- **GIVEN** una RESERVA en `evento_en_curso` con `fianza_eur = 1000.00` y un `CLIENTE.email`
- **WHEN** el gestor finaliza el evento
- **THEN** el motor envía E5 al `CLIENTE.email` (agradecimiento + solicitud de IBAN + enlace NPS)
- **AND** crea `COMUNICACION` con `codigo_email = 'E5'`, `reserva_id`, `cliente_id`, `tenant_id`
  y `estado = enviado` (si el envío tiene éxito)

#### Scenario: Finalización sin fianza (fianza_eur = 0) no envía E5

- **GIVEN** una RESERVA en `evento_en_curso` con `fianza_eur = 0`
- **WHEN** el gestor finaliza el evento
- **THEN** la RESERVA transiciona a `post_evento` igualmente
- **AND** no se envía E5 ni se crea ninguna `COMUNICACION` con `codigo_email = 'E5'`

### Requirement: fianza_eur IS NULL se trata como sin fianza y alerta de dato anómalo

El sistema SHALL (DEBE) tratar `RESERVA.fianza_eur IS NULL` como **"sin fianza"** (equivalente a
`0`) a efectos de E5: NO DEBE enviar E5 ni crear `COMUNICACION` para E5, **aunque**
`RESERVA.fianza_status = 'cobrada'`. Cuando concurren `fianza_status = 'cobrada'` y `fianza_eur
IS NULL` (dato inconsistente de integridad), el sistema DEBE registrar la inconsistencia en
`AUDIT_LOG` como **alerta de dato anómalo**. `fianza_eur IS NULL` NUNCA DEBE provocar un envío
de E5 con IBAN pendiente. (Fuente: `US-034 §fianza_status = cobrada pero fianza_eur IS NULL`,
`§Finalización sin fianza`, `§Reglas de Validación`.)

#### Scenario: fianza_status cobrada pero fianza_eur IS NULL — sin E5 y alerta

- **GIVEN** una RESERVA en `evento_en_curso` con `fianza_status = 'cobrada'` pero `fianza_eur IS
  NULL`
- **WHEN** el gestor finaliza el evento
- **THEN** la RESERVA transiciona a `post_evento`
- **AND** el sistema trata la condición como "sin fianza": no envía E5 ni crea `COMUNICACION`
  para E5
- **AND** registra la inconsistencia en `AUDIT_LOG` como alerta de dato anómalo

### Requirement: La transición no depende del éxito de E5 — fallo deja COMUNICACION fallido y reintento

El sistema SHALL (DEBE) tratar la **transición de estado** y el **envío de E5** como operaciones
**separadas**: si `fianza_eur > 0` y el envío de E5 falla (proveedor de email no disponible), la
transición `evento_en_curso → post_evento` NO DEBE revertirse. En ese caso el sistema DEBE dejar
`COMUNICACION.estado = 'fallido'` (la `COMUNICACION` para E5 se crea **tanto** en envío exitoso
—`estado = enviado`— **como** fallido —`estado = fallido`) y presentar al gestor una alerta ("La
reserva ha pasado a post-evento, pero el email E5 no pudo enviarse. Puedes reenviarlo desde la
ficha."). El gestor SHALL (DEBE) poder **reintentar** el envío de E5 desde la ficha de la
RESERVA. El `AUDIT_LOG` de la transición DEBE reflejar el fallo de E5. (Fuente: `US-034 §Fallo
en el envío de E5`, `§Reglas de negocio`, `§Reglas de Validación`.)

#### Scenario: E5 falla pero la reserva queda en post_evento y se puede reintentar

- **GIVEN** una RESERVA en `evento_en_curso` con `fianza_eur > 0` y el proveedor de email no
  disponible
- **WHEN** el gestor finaliza el evento y el envío de E5 falla
- **THEN** la transición `evento_en_curso → post_evento` se ejecuta igualmente (no se revierte)
- **AND** `COMUNICACION.estado = 'fallido'` para E5
- **AND** el gestor ve una alerta indicando que puede reenviar E5 desde la ficha
- **AND** el `AUDIT_LOG` de la transición refleja el fallo de E5

#### Scenario: El gestor reintenta el envío de E5 desde la ficha

- **GIVEN** una RESERVA en `post_evento` con una `COMUNICACION` E5 en `estado = 'fallido'`
- **WHEN** el gestor reintenta el envío de E5 desde la ficha
- **THEN** el motor de `comunicaciones` reintenta el envío al `CLIENTE.email`
- **AND** actualiza el resultado del reintento en la `COMUNICACION` E5

### Requirement: La NPS queda programada (T+3d) al finalizar el evento

El sistema SHALL (DEBE), al finalizar el evento, dejar la **NPS marcada como programada** para
T+3d, **con independencia** del valor de `fianza_eur` (también cuando `fianza_eur = 0` o `IS
NULL`). "Programada" significa marcada para envío futuro; el **envío real** de la NPS a T+3d
está **fuera de alcance MVP** (📐 recordatorios automáticos extendidos): el sistema NO DEBE
enviar automáticamente la NPS a T+3d en este alcance. (Fuente: `US-034 §Happy Path`,
`§Finalización sin fianza`, `§Supuestos`, `§Notas de alcance`.)

#### Scenario: La NPS se marca como programada aunque no haya fianza

- **GIVEN** una RESERVA en `evento_en_curso` con `fianza_eur = 0` (o `IS NULL`)
- **WHEN** el gestor finaliza el evento
- **THEN** la NPS queda marcada como programada (T+3d)
- **AND** no se realiza ningún envío automático de la NPS en este alcance (fuera de MVP)

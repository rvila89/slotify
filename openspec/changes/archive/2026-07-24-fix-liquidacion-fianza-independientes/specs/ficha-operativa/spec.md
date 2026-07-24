# Spec Delta — Capability `ficha-operativa` (MODIFICADA)

> Elimina la **fianza** como precondición de la transición `reserva_confirmada → evento_en_curso`.
> La transición pasa a depender de **dos** precondiciones: `pre_evento_status = 'cerrado'` **y**
> `liquidacion_status = 'cobrada'`. Las dos referencias existentes a la "precondición triple" (una
> por la vía manual de cierre de ficha, otra por el cierre automático T-1d) se actualizan a
> "precondición doble". Fuente: plan `fix-liquidacion-fianza-independientes` §Máquina de estados;
> US-025, US-026; UC-20; `er-diagram.md §guarda evento_en_curso`.

## MODIFIED Requirements

### Requirement: pre_evento_status = cerrado como precondición de la transición a evento_en_curso

El sistema SHALL (DEBE) dejar `RESERVA.pre_evento_status = cerrado` disponible como **una de las dos
precondiciones** de la futura transición de la RESERVA a `evento_en_curso` (junto con
`liquidacion_status = cobrada`). La **fianza deja de ser precondición** del inicio del evento (flujo
pasivo, no bloqueante). Este change **solo** produce el valor `cerrado`; la comprobación conjunta de
las dos precondiciones y la transición a `evento_en_curso` corresponden a **US-031** y quedan fuera de
este alcance. (Fuente: plan §Máquina de estados; `US-025 §Reglas de negocio`, `§Contexto de Negocio`;
UC-20.)

#### Scenario: Cerrar la ficha deja cubierta su precondición para evento_en_curso

- **GIVEN** una RESERVA confirmada cuya ficha se cierra (`pre_evento_status = cerrado`)
- **WHEN** en el futuro se evalúe la transición a `evento_en_curso` (US-031)
- **THEN** la precondición `pre_evento_status = cerrado` queda cubierta (la otra —liquidación
  cobrada— se evalúa fuera de este change; la fianza ya no es precondición)

### Requirement: El cierre automático deja cubierta la precondición de evento_en_curso (US-031)

El sistema SHALL (DEBE) dejar `RESERVA.pre_evento_status = cerrado` tras el cierre automático,
cubriendo **una de las dos precondiciones** de la futura transición de la RESERVA a `evento_en_curso`
(junto con `liquidacion_status = cobrada`). La **fianza deja de ser precondición** del inicio del
evento. Este change **solo** produce el valor `cerrado` por la vía automática; la comprobación
conjunta de las dos precondiciones y la transición a `evento_en_curso` corresponden a **US-031** y
quedan fuera de este alcance. (Fuente: plan §Máquina de estados; `US-026 §Contexto de Negocio`;
`US-025` misma precondición; UC-20.)

#### Scenario: El cierre automático cubre su precondición para evento_en_curso

- **GIVEN** una RESERVA confirmada cuya ficha se cierra automáticamente en T-1d
  (`pre_evento_status = cerrado`)
- **WHEN** en el futuro se evalúe la transición a `evento_en_curso` (US-031)
- **THEN** la precondición `pre_evento_status = cerrado` queda cubierta (la otra —liquidación
  cobrada— se evalúa fuera de este change; la fianza ya no es precondición)

# ficha-operativa Specification

## ADDED Requirements

### Requirement: Barrido periódico protegido de cierre automático de fichas en T-1d (A10)

El sistema SHALL (DEBE) exponer un **barrido interno protegido** que, al ser invocado,
seleccione todas las RESERVA con `estado = 'reserva_confirmada'` **AND** `pre_evento_status
!= 'cerrado'` **AND** cuya `fecha_evento` sea **mañana** (día T-1d = hoy, es decir
`date(fecha_evento) = date(hoy) + 1 día`) y cierre automáticamente la FICHA_OPERATIVA de
cada una. El barrido SHALL (DEBE) autenticarse **service-to-service** mediante la cabecera
`X-Cron-Token` (comparada con `CRON_TOKEN` del entorno vía `CronTokenGuard`); NO DEBE ser
accesible con JWT de usuario ni desde el exterior. Un **cron scheduler**
(`@nestjs/schedule`) lo invoca **una vez al día** siguiendo el patrón obligatorio "estado en
fila + barrido periódico" (nunca Lambda/EventBridge ni timers exactos); el trabajo pendiente
es estado en la BBDD (`RESERVA.fecha_evento` + `pre_evento_status`). El barrido DEBE
procesar **todas las candidatas del mismo pase** y devolver un **resumen** (candidatas
evaluadas, fichas cerradas, fallos aislados). (Fuente: `US-026 §Reglas de negocio`,
`§Múltiples reservas con fecha_evento = mañana`; `CLAUDE.md §Jobs asíncronos`;
`architecture.md §2.5`; skill `async-jobs`; patrón de US-012.)

#### Scenario: El cron invoca el barrido con token válido y cierra las fichas elegibles

- **GIVEN** una o más RESERVA en `estado = 'reserva_confirmada'` con `pre_evento_status !=
  'cerrado'` y `fecha_evento = mañana`, en uno o varios tenants
- **WHEN** el cron invoca el barrido de fichas con la cabecera `X-Cron-Token` válida
- **THEN** el sistema cierra la FICHA_OPERATIVA de cada candidata bajo el contexto RLS de su
  tenant
- **AND** devuelve un resumen con el nº de candidatas evaluadas, fichas cerradas y fallos
  aislados

#### Scenario: Llamada sin token o con token inválido se rechaza

- **GIVEN** una petición al barrido de fichas sin `X-Cron-Token` o con un valor que no
  coincide con `CRON_TOKEN`
- **WHEN** el sistema recibe la petición
- **THEN** la rechaza con error de autorización (401)
- **AND** no cierra ninguna ficha

### Requirement: Cierre automático de la ficha en T-1d con los datos disponibles (A10)

El sistema SHALL (DEBE), por cada RESERVA candidata, ejecutar en una **transacción atómica**
bajo el contexto RLS de su tenant: fijar `FICHA_OPERATIVA.ficha_cerrada = true`,
`FICHA_OPERATIVA.fecha_cierre = now()`, transicionar `RESERVA.pre_evento_status` de su valor
actual (`pendiente` o `en_curso`) a `cerrado`, y registrar en `AUDIT_LOG` una entrada con
`accion = 'transicion'`, `entidad = 'RESERVA'`, `datos_anteriores.pre_evento_status` = el
valor previo y `datos_nuevos.pre_evento_status = 'cerrado'`. La transición se modela en la
**máquina de estados declarativa** (no `if` dispersos). El cierre automático usa el **mismo
triplete de mutación** que el cierre manual de US-025, pero **forzado por Sistema**. (Fuente:
`US-026 §Happy Path`, `§Reglas de negocio`; `US-025` mutación de cierre; UC-20 FA-01; A10.)

#### Scenario: RESERVA confirmada con ficha en_curso cierra en el barrido

- **GIVEN** una RESERVA en `estado = 'reserva_confirmada'`, `fecha_evento = mañana` y
  `pre_evento_status = en_curso` (ficha parcialmente rellenada)
- **WHEN** el barrido de T-1d se ejecuta
- **THEN** en una transacción atómica el sistema fija `FICHA_OPERATIVA.ficha_cerrada = true`,
  `FICHA_OPERATIVA.fecha_cierre = now()` y `RESERVA.pre_evento_status = cerrado`
- **AND** registra en `AUDIT_LOG` `accion = 'transicion'`, `entidad = 'RESERVA'`,
  `datos_anteriores.pre_evento_status = 'en_curso'`, `datos_nuevos.pre_evento_status =
  'cerrado'` con origen Sistema

### Requirement: El cierre forzado no depende del contenido de la ficha (ficha vacía)

El sistema SHALL (DEBE) cerrar la FICHA_OPERATIVA de una RESERVA candidata **aunque la
ficha esté vacía** (`pre_evento_status = pendiente`, sin ningún campo relleno): el cierre
NO DEBE estar bloqueado por campos faltantes ni requerir campos completos, garantizando el
avance del estado a `cerrado` con los campos en su estado actual. A diferencia del cierre
manual de US-025 (que devuelve un aviso informativo sobre campos vacíos), el cierre
automático por Sistema **no** es interactivo y **no** produce aviso. (Fuente: `US-026 §Ficha
vacía (pre_evento_status = pendiente)`, `§Reglas de negocio`; `US-025` cierre no bloqueado
por campos vacíos.)

#### Scenario: Ficha vacía en pendiente se cierra igualmente

- **GIVEN** una RESERVA en `estado = 'reserva_confirmada'`, `fecha_evento = mañana` y
  `pre_evento_status = pendiente` (el gestor nunca actualizó la ficha)
- **WHEN** el barrido de T-1d se ejecuta
- **THEN** el sistema cierra la ficha con los campos en su estado actual (vacíos),
  `ficha_cerrada = true`, `fecha_cierre = now()`, `pre_evento_status = cerrado`
- **AND** registra la transición en `AUDIT_LOG` (`datos_anteriores.pre_evento_status =
  'pendiente'`), sin ningún aviso ni error por campos vacíos

### Requirement: Filtro estricto por estado — solo reserva_confirmada se cierra

El sistema SHALL (DEBE) aplicar el cierre automático **únicamente** a RESERVA en `estado =
'reserva_confirmada'`. Cualquier RESERVA en otro estado (`consulta`, `pre_reserva`,
`reserva_cancelada`, `reserva_completada`, `evento_en_curso`, `post_evento`) NO DEBE ser
cerrada por este barrido, **aunque** su `fecha_evento = mañana`. El filtro por estado forma
parte de la selección de candidatas (cero efectos secundarios sobre reservas no
confirmadas). (Fuente: `US-026 §Reserva en estado distinto de reserva_confirmada`, `§Reglas
de Validación`.)

#### Scenario: RESERVA cancelada con fecha_evento mañana no se cierra

- **GIVEN** una RESERVA en `estado = 'reserva_cancelada'` (o `pre_reserva`,
  `reserva_completada`) con `fecha_evento = mañana`
- **WHEN** el barrido de T-1d se ejecuta
- **THEN** el sistema no aplica el cierre automático a esa RESERVA (el filtro incluye solo
  `estado = 'reserva_confirmada'`)
- **AND** ni la RESERVA ni su FICHA_OPERATIVA se modifican

### Requirement: El trigger se evalúa solo contra fecha_evento - 1 día = hoy

El sistema SHALL (DEBE) seleccionar candidatas comparando la **fecha de calendario** del
evento: incluye únicamente las RESERVA cuya `fecha_evento` sea **mañana**
(`date(fecha_evento) = date(hoy) + 1 día`). RESERVA con `fecha_evento` en cualquier otro día
(hoy, pasado mañana o más adelante) NO DEBEN ser cerradas por el pase actual. La comparación
es por fecha de calendario del evento (no por instante ni por un `ttl_expiracion`),
consistente con la semántica "T-1d anterior al `fecha_evento`". (Fuente: `US-026 §Reglas de
negocio`, `§Reglas de Validación`; UC-20 FA-01.)

#### Scenario: Solo las fichas de eventos de mañana entran en el pase

- **GIVEN** RESERVA confirmadas con `pre_evento_status != 'cerrado'`: una con `fecha_evento =
  mañana`, otra con `fecha_evento = hoy`, otra con `fecha_evento = pasado mañana`
- **WHEN** el barrido de T-1d se ejecuta hoy
- **THEN** solo se cierra la ficha de la RESERVA con `fecha_evento = mañana`
- **AND** las de hoy y pasado mañana no se modifican en este pase

### Requirement: Idempotencia del barrido — ficha ya cerrada no se re-cierra

El sistema SHALL (DEBE) ser idempotente: una RESERVA con `pre_evento_status = 'cerrado'`
(cerrada manualmente por el gestor en US-025 antes de T-1d, o ya cerrada por un pase
anterior) **no** es candidata (el filtro `pre_evento_status != 'cerrado'` la excluye) y NO
DEBE ser modificada, ni generar entrada duplicada en `AUDIT_LOG`. N ejecuciones del barrido
sobre la misma RESERVA = **1 solo cierre** y **1 sola** entrada de transición. La condición
se re-evalúa **dentro** de la transacción de cada RESERVA para que un reintento/segunda
ejecución concurrente re-evalúe con el `pre_evento_status` ya actualizado. (Fuente: `US-026
§Ficha ya cerrada manualmente por el gestor (idempotencia)`, `§Reglas de Validación`; `US-025`
cierre manual.)

#### Scenario: Ficha cerrada manualmente antes de T-1d no se toca

- **GIVEN** una RESERVA con `pre_evento_status = 'cerrado'` (el gestor la cerró via US-025) y
  `fecha_evento = mañana`
- **WHEN** el barrido de T-1d se ejecuta
- **THEN** el sistema no ejecuta ninguna acción sobre esa RESERVA; no modifica ningún campo
- **AND** no genera ninguna entrada nueva en `AUDIT_LOG`

#### Scenario: Segunda ejecución del barrido no re-cierra fichas ya cerradas

- **GIVEN** una RESERVA que ya fue cerrada por un pase anterior del barrido
  (`pre_evento_status = 'cerrado'`)
- **WHEN** el barrido se ejecuta de nuevo y la evalúa
- **THEN** la RESERVA no está entre las candidatas y no se modifica
- **AND** no se generan registros duplicados en `AUDIT_LOG`

### Requirement: Procesa todas las elegibles con aislamiento de fallos por RESERVA

El sistema SHALL (DEBE) procesar **todas** las RESERVA elegibles del mismo pase, cada una en
su **propia transacción independiente**: el fallo de un cierre (excepción, conflicto,
guarda) NO DEBE abortar ni revertir los cierres de las demás candidatas; el resumen del
barrido registra los fallos aislados. Cuando existen varias RESERVA con `fecha_evento =
mañana`, el sistema cierra todas las que tienen `pre_evento_status != 'cerrado'` y omite las
ya cerradas, produciendo una entrada de transición independiente por cada cierre efectivo.
(Fuente: `US-026 §Múltiples reservas con fecha_evento = mañana`, `§Impacto de Negocio`;
patrón de fallo aislado de US-012.)

#### Scenario: Tres reservas de mañana — dos abiertas se cierran, una cerrada se omite

- **GIVEN** tres RESERVA distintas con `fecha_evento = mañana` en `estado =
  'reserva_confirmada'`: dos con `pre_evento_status = en_curso` y una con `pre_evento_status
  = cerrado`
- **WHEN** el barrido de T-1d se ejecuta
- **THEN** el sistema cierra las dos fichas con `pre_evento_status = en_curso` (dos entradas
  de transición en `AUDIT_LOG`) y omite la que ya estaba `cerrado` (cero acción)
- **AND** el resumen refleja dos fichas cerradas

#### Scenario: Un fallo parcial en una candidata no revierte las demás

- **GIVEN** un barrido con N candidatas donde el cierre de una falla
- **WHEN** el sistema procesa el pase
- **THEN** cada candidata se procesa en su propia transacción independiente
- **AND** el fallo de una no revierte ni impide el cierre de las demás
- **AND** el resumen del barrido refleja la candidata fallida como fallo aislado

### Requirement: La auditoría del cierre automático registra el origen Sistema

El sistema SHALL (DEBE) registrar cada cierre automático en `AUDIT_LOG` con origen
**Sistema** (no un `USUARIO`): `accion = 'transicion'`, `entidad = 'RESERVA'`, sin
`usuario_id` de usuario (nulo/no-usuario), y con la causa de la automatización (`A10`)
reflejada en `datos_nuevos` (p. ej. `causa = 'A10'`). Esta convención es la misma que usa el
barrido de expiración de Sistema de US-012 (auditoría con `usuario_id` no poblado por un
usuario). (Fuente: `US-026 §Happy Path`, `§Reglas de Validación`; `er-diagram.md` AUDIT_LOG;
convención de auditoría de Sistema de US-012.)

#### Scenario: El cierre automático se audita como acción de Sistema

- **GIVEN** una RESERVA candidata que el barrido cierra
- **WHEN** el sistema registra la transición en `AUDIT_LOG`
- **THEN** la entrada tiene `accion = 'transicion'`, `entidad = 'RESERVA'` y **no** un
  `usuario_id` de usuario final (origen Sistema)
- **AND** refleja la causa de la automatización A10 en `datos_nuevos`

### Requirement: El cierre automático deja cubierta la precondición de evento_en_curso (US-031)

El sistema SHALL (DEBE) dejar `RESERVA.pre_evento_status = cerrado` tras el cierre
automático, cubriendo **una de las tres precondiciones** de la futura transición de la
RESERVA a `evento_en_curso` (junto con `liquidacion_status = cobrada` y `fianza_status =
cobrada`). Este change **solo** produce el valor `cerrado` por la vía automática; la
comprobación conjunta de las tres precondiciones y la transición a `evento_en_curso`
corresponden a **US-031** y quedan fuera de este alcance. (Fuente: `US-026 §Contexto de
Negocio`; `US-025` misma precondición; UC-20.)

#### Scenario: El cierre automático cubre su precondición para evento_en_curso

- **GIVEN** una RESERVA confirmada cuya ficha se cierra automáticamente en T-1d
  (`pre_evento_status = cerrado`)
- **WHEN** en el futuro se evalúe la transición a `evento_en_curso` (US-031)
- **THEN** la precondición `pre_evento_status = cerrado` queda cubierta (las otras dos —
  liquidación y fianza cobradas — se evalúan fuera de este change)

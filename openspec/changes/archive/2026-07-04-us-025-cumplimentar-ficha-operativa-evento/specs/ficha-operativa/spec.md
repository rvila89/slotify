# Spec Delta — Capability `ficha-operativa` (NUEVA)

> US-025 **crea** la capability `ficha-operativa`: la cumplimentación progresiva y el cierre
> de la FICHA_OPERATIVA de una RESERVA confirmada, junto con las transiciones del sub-proceso
> `RESERVA.pre_evento_status` (`pendiente → en_curso → cerrado`). La **creación** de la
> FICHA_OPERATIVA vacía la aporta la capability viva `confirmacion` (US-021) al confirmar el
> pago de la señal y **se reutiliza** (no se redefine aquí). Este delta cubre: leer la ficha,
> guardar campos parcialmente, transicionar `pendiente → en_curso` al primer guardado con
> datos, cerrar la ficha (no bloqueado por campos vacíos, con aviso informativo), editar tras
> el cierre (actualiza `fecha_cierre`, no reabre el estado), la guarda de acceso por
> `RESERVA.estado` y la auditoría de todos los cambios. NO envía email (A8/A9 son 📐), NO
> cierra la ficha automáticamente (US-026) y NO transiciona a `evento_en_curso` (US-031).
> Fuente: US-025, UC-20, Módulo M7; `er-diagram.md §3.14 FICHA_OPERATIVA`,
> `§RESERVA pre_evento_status`; `CLAUDE.md` (máquina de estados como estructura de datos,
> multi-tenancy/RLS).

## ADDED Requirements

### Requirement: Guarda de acceso a la ficha operativa por estado de la RESERVA

El sistema SHALL (DEBE) permitir leer y editar la FICHA_OPERATIVA de una RESERVA **solo**
cuando `RESERVA.estado ∈ {reserva_confirmada, evento_en_curso, post_evento}`. Si la RESERVA
está en un estado **anterior** a `reserva_confirmada` (p. ej. `consulta`, `pre_reserva`), el
sistema **no expone** ninguna FICHA_OPERATIVA (la entidad no existe aún, se crea al confirmar
—US-021) y DEBE devolver un mensaje contextual **"La ficha operativa estará disponible una
vez confirmada la reserva"**, sin crear ninguna entidad prematuramente. Toda operación filtra
por el `tenant_id` del JWT (multi-tenancy/RLS): la ficha de una RESERVA de otro tenant no es
visible ni editable. (Fuente: `US-025 §Acceso a la ficha operativa antes de reserva_confirmada`,
`§Reglas de Validación`; `CLAUDE.md` multi-tenancy.)

#### Scenario: RESERVA anterior a reserva_confirmada devuelve mensaje contextual sin entidad

- **GIVEN** una RESERVA en `estado = pre_reserva` sin FICHA_OPERATIVA
- **WHEN** el Gestor intenta acceder a la ficha operativa
- **THEN** el sistema muestra "La ficha operativa estará disponible una vez confirmada la
  reserva"
- **AND** no existe ni se crea ninguna FICHA_OPERATIVA

#### Scenario: RESERVA confirmada expone su ficha operativa

- **GIVEN** una RESERVA en `estado = reserva_confirmada` con su FICHA_OPERATIVA asociada
- **WHEN** el Gestor abre la ficha operativa
- **THEN** el sistema devuelve los campos de contenido, `ficha_cerrada`, `fecha_cierre` y el
  `pre_evento_status` de la RESERVA

#### Scenario: La ficha de otra tenant no es accesible

- **GIVEN** una RESERVA confirmada perteneciente a otro `tenant_id` distinto al del JWT
- **WHEN** el Gestor intenta leer o editar su ficha operativa
- **THEN** el sistema no la expone (filtrado por `tenant_id`, RLS activo)

### Requirement: Lectura de la ficha operativa de una RESERVA confirmada

El sistema SHALL (DEBE) devolver la FICHA_OPERATIVA asociada a una RESERVA accesible (ver
guarda de acceso), incluyendo los campos de contenido (`num_invitados_confirmado`,
`menu_seleccionado`, `timing_detallado`, `contacto_evento_nombre`, `contacto_evento_telefono`,
`notas_operativas`, `briefing_equipo`), el flag `ficha_cerrada`, la `fecha_cierre` (nullable
mientras no se haya cerrado) y el `RESERVA.pre_evento_status` vigente, sin mutar ningún estado.
La relación es **1:1** (`FICHA_OPERATIVA.reserva_id @unique`). (Fuente: `US-025 §Historia`,
`§Reglas de Validación`; `er-diagram.md §3.14 FICHA_OPERATIVA`.)

#### Scenario: Leer la ficha no muta ningún estado

- **GIVEN** una RESERVA confirmada con `pre_evento_status = pendiente` y su FICHA_OPERATIVA
  vacía
- **WHEN** el Gestor lee la ficha operativa
- **THEN** el sistema devuelve los campos (todos `NULL`), `ficha_cerrada = false`,
  `fecha_cierre = NULL` y `pre_evento_status = pendiente`
- **AND** `pre_evento_status` permanece `pendiente` (leer no dispara la transición)

### Requirement: Guardado parcial de campos de la ficha operativa

El sistema SHALL (DEBE) permitir al Gestor persistir en la FICHA_OPERATIVA cualquier
subconjunto de los campos `num_invitados_confirmado`, `menu_seleccionado`, `timing_detallado`,
`contacto_evento_nombre`, `contacto_evento_telefono`, `notas_operativas`, `briefing_equipo`.
Todos los campos son **opcionales**: el guardado es **parcial/progresivo** (varias pasadas),
ningún campo es bloqueante para guardar. El sistema registra el guardado en `AUDIT_LOG`.
(Fuente: `US-025 §Happy Path`, `§Reglas de Validación`; `er-diagram.md §3.14 FICHA_OPERATIVA`.)

#### Scenario: Guardar un subconjunto de campos persiste solo esos campos

- **GIVEN** una RESERVA confirmada con su FICHA_OPERATIVA vacía
- **WHEN** el Gestor guarda `num_invitados_confirmado = 85`, `timing_detallado = "18h llegada,
  19h cena, 00h fin"`, `contacto_evento_nombre = "María López"` y `notas_operativas = "Alergia
  a los frutos secos"`
- **THEN** el sistema persiste esos campos en la FICHA_OPERATIVA
- **AND** registra el cambio en `AUDIT_LOG`

### Requirement: Transición pre_evento_status pendiente → en_curso al primer guardado con datos

El sistema SHALL (DEBE), cuando persiste un guardado de la ficha con `RESERVA.pre_evento_status
= pendiente` y el guardado deja **al menos un campo con dato** (no nulo/no vacío), transicionar
`RESERVA.pre_evento_status` de `pendiente` a `en_curso` en la **misma transacción** que el
guardado. Esta transición **no requiere confirmación explícita** del Gestor y ocurre una única
vez (guardados posteriores con la ficha ya en `en_curso` no la repiten). Un guardado que no
aporte ningún dato (todos los campos vacíos/nulos) **no** dispara la transición. El sistema
registra la transición en `AUDIT_LOG`. (Fuente: `US-025 §Happy Path`, `§Reglas de negocio`,
`§Reglas de Validación`; `CLAUDE.md` máquina de estados.)

#### Scenario: El primer guardado con datos pasa pendiente → en_curso

- **GIVEN** una RESERVA confirmada con `pre_evento_status = pendiente` y FICHA_OPERATIVA vacía
- **WHEN** el Gestor guarda por primera vez datos válidos en la ficha
- **THEN** el sistema persiste los campos y `RESERVA.pre_evento_status` pasa a `en_curso`
- **AND** registra la transición en `AUDIT_LOG`

#### Scenario: Un guardado sin datos no dispara la transición

- **GIVEN** una RESERVA confirmada con `pre_evento_status = pendiente` y FICHA_OPERATIVA vacía
- **WHEN** el Gestor guarda un formulario sin ningún campo con dato
- **THEN** `pre_evento_status` permanece `pendiente`

### Requirement: Cierre de la ficha no bloqueado por campos vacíos

El sistema SHALL (DEBE), cuando el Gestor activa "Cerrar ficha" sobre una FICHA_OPERATIVA
accesible con `RESERVA.pre_evento_status = en_curso`, fijar en la misma transacción
`FICHA_OPERATIVA.ficha_cerrada = true`, `FICHA_OPERATIVA.fecha_cierre = now()` y transicionar
`RESERVA.pre_evento_status: en_curso → cerrado`, registrando la transición en `AUDIT_LOG`. El
cierre **NO** está bloqueado por campos vacíos: si faltan campos opcionales (p. ej.
`menu_seleccionado`, `briefing_equipo`), el sistema **permite** el cierre y devuelve un **aviso
puramente informativo** sobre los campos vacíos; ese aviso **no es un error** (no impide el
cierre ni devuelve un 4xx por ese motivo). Ningún campo de la ficha es obligatorio para cerrar.
(Fuente: `US-025 §Happy Path`, `§Cierre con campos opcionales vacíos`, `§Reglas de negocio`.)

#### Scenario: Cerrar con datos completos transiciona a cerrado

- **GIVEN** una FICHA_OPERATIVA con datos y `RESERVA.pre_evento_status = en_curso`
- **WHEN** el Gestor hace clic en "Cerrar ficha" y confirma
- **THEN** el sistema fija `ficha_cerrada = true`, `fecha_cierre = now()` y
  `RESERVA.pre_evento_status = cerrado`
- **AND** registra la transición en `AUDIT_LOG`

#### Scenario: Cerrar con campos opcionales vacíos se permite con aviso informativo

- **GIVEN** una FICHA_OPERATIVA con `num_invitados_confirmado` relleno pero `menu_seleccionado`
  y `briefing_equipo` vacíos, y `pre_evento_status = en_curso`
- **WHEN** el Gestor hace clic en "Cerrar ficha"
- **THEN** el sistema permite el cierre sin bloqueo, `pre_evento_status` pasa a `cerrado` y
  muestra un aviso informativo sobre los campos vacíos (no es error)

### Requirement: Edición de la ficha tras el cierre sin reabrir el estado

El sistema SHALL (DEBE), cuando el Gestor modifica campos de una FICHA_OPERATIVA con
`ficha_cerrada = true` y `RESERVA.pre_evento_status = cerrado`, permitir la edición, persistir
el cambio, **actualizar `FICHA_OPERATIVA.fecha_cierre = now()`** y **mantener**
`RESERVA.pre_evento_status = cerrado` (la edición **no** reabre el estado ni lo devuelve a
`en_curso` de forma automática). El sistema registra el cambio en `AUDIT_LOG`. La ficha es
editable incluso cerrada. (Fuente: `US-025 §Edición de la ficha tras cerrarla`, `§Reglas de
negocio`.)

#### Scenario: Editar una ficha cerrada persiste el cambio y no reabre el estado

- **GIVEN** una FICHA_OPERATIVA con `ficha_cerrada = true` y `RESERVA.pre_evento_status =
  cerrado`
- **WHEN** el Gestor actualiza el número de invitados confirmados
- **THEN** el sistema persiste el cambio, actualiza `fecha_cierre = now()` y registra el cambio
  en `AUDIT_LOG`
- **AND** `pre_evento_status` permanece `cerrado`

### Requirement: pre_evento_status = cerrado como precondición de la transición a evento_en_curso

El sistema SHALL (DEBE) dejar `RESERVA.pre_evento_status = cerrado` disponible como **una de
las tres precondiciones** de la futura transición de la RESERVA a `evento_en_curso` (junto con
`liquidacion_status = cobrada` y `fianza_status = cobrada`). Este change **solo** produce el
valor `cerrado`; la comprobación conjunta de las tres precondiciones y la transición a
`evento_en_curso` corresponden a **US-031** y quedan fuera de este alcance. (Fuente: `US-025
§Reglas de negocio`, `§Contexto de Negocio`; UC-20.)

#### Scenario: Cerrar la ficha deja cubierta su precondición para evento_en_curso

- **GIVEN** una RESERVA confirmada cuya ficha se cierra (`pre_evento_status = cerrado`)
- **WHEN** en el futuro se evalúe la transición a `evento_en_curso` (US-031)
- **THEN** la precondición `pre_evento_status = cerrado` queda cubierta (las otras dos —
  liquidación y fianza cobradas — se evalúan fuera de este change)

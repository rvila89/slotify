# Spec-delta: historial-completo-comunicaciones (capability `comunicaciones`)

## MODIFIED Requirements

### Requirement: Idempotencia de un email por reserva y código

El sistema SHALL (DEBE) crear una `COMUNICACION` propia por cada **evento** de ciclo de vida que genera un email, etiquetándola con su `subtipo`. Un mismo `codigo_email = 'E1'` cubre emails **semánticamente distintos** según el evento que lo dispara (respuesta a una **consulta exploratoria** sin fecha, asignación de una **fecha disponible**, **confirmación** de fecha, entrada en **cola de espera**, **cambio de fecha**). Por ello el sistema DEBE **persistir un `subtipo` explícito** en `COMUNICACION` (enum nullable `SubtipoEmail`; `NULL` para E2–E8, `manual` y filas legadas) con los valores:
`consulta_exploratoria`, `fecha_disponible`, `fecha_confirmada`, `cola_espera`,
`cambio_fecha`. El sistema **NO DEBE** sobrescribir la fila anterior de ese código
(fin del upsert `findFirst` + `update`); DEBE **INSERTAR** una fila nueva por evento,
conservando el **historial completo**: es válido y esperado que una misma RESERVA
tenga **varias** filas E1 `borrador` de subtipos distintos, cada una con su propio
`subtipo`, `asunto` y `fecha_creacion`.

El anti-duplicado se **clava sobre la terna `(reserva_id, codigo_email, subtipo)`**:
dos filas con **distinto** `subtipo` pueden **ambas** llegar a `estado = 'enviado'`
porque son emails legítimos y distintos (NO son reenvíos). Solo un **segundo envío**
del **mismo** `(reserva_id, codigo_email, subtipo)` constituye una repetición, y ese
SÍ es un **reenvío genuino** que se marca `es_reenvio = true` (consistente con el
patrón de reenvío E3/E4/E8), quedando fuera del constraint. El sistema **NO DEBE
auto-enviar** una terna `(reserva_id, codigo_email, subtipo)` que **ya tiene** una
fila en `estado = 'enviado'`: la trata como **idempotente** sin crear otra fila
enviada ni reenviar. Los E1 de transición y de cambio de fecha son siempre `borrador`
y **NO se auto-envían** (los revisa y envía el gestor, US-046).

La garantía se DEBE reforzar con el **índice UNIQUE parcial** en BD sobre la terna,
con predicado restringido a envíos consumados:
`(reserva_id, codigo_email, subtipo) WHERE reserva_id IS NOT NULL AND es_reenvio =
false AND codigo_email <> 'manual' AND estado = 'enviado'`. Actúa como **backstop** de
la carrera de doble envío idéntico (dos `enviado` concurrentes de la misma terna
colisionan con `P2002`), mientras que varios `borrador` (de cualquier subtipo) y
subtipos distintos en `enviado` **no** colisionan. Los **reenvíos**
(`es_reenvio = true`, E3/E4/E8) y los emails **`manual`** siguen **fuera** del
constraint por su predicado. (Fuente: `US-045 §Reglas de Validación` idempotencia;
`US-046` revisión de borradores; requirement vivo *"Listado de las comunicaciones de
una RESERVA…"*; `design.md §D-subtipo`, `§D-indice-terna`, `§D-manual-2o-borrador`,
`§D-regenera-en-sitio`.)

#### Scenario: Un segundo auto-envío de la misma terna no crea otra fila enviada

- **GIVEN** una `RESERVA` que ya tiene una `COMUNICACION` con `codigo_email = 'E1'`,
  `subtipo = 'fecha_disponible'` y `estado = 'enviado'`
- **WHEN** el motor de auto-envío se vuelve a disparar para esa misma terna
- **THEN** el sistema detecta la fila `enviado` existente
- **AND** trata la operación como idempotente: no crea una segunda `COMUNICACION` de
  esa terna en `enviado` ni reenvía el email

#### Scenario: Dos subtipos distintos pueden ambos estar enviados sin colisión

- **GIVEN** una `RESERVA` con una `COMUNICACION` E1 `subtipo = 'consulta_exploratoria'`
  ya `enviado`
- **WHEN** más tarde se envía otra `COMUNICACION` E1 `subtipo = 'cambio_fecha'`
- **THEN** ambas filas coexisten en `estado = 'enviado'` sin colisión del índice
- **AND** ninguna se marca `es_reenvio` (son emails semánticamente distintos, no
  reenvíos)

#### Scenario: Una carrera de doble envío idéntico la frena el índice sobre la terna

- **GIVEN** dos disparos concurrentes del envío de la **misma** terna
  `(reserva, codigo, subtipo)`
- **WHEN** ambos intentan insertar/actualizar la `COMUNICACION` a `estado = 'enviado'`
- **THEN** el índice UNIQUE parcial (terna, predicado `estado = 'enviado'`) impide la
  segunda con `P2002`
- **AND** el sistema trata el conflicto como "ya enviado" sin error de usuario

#### Scenario: Alta exploratoria + añadir fecha + cambiar fecha deja tres E1 con subtipos distintos

- **GIVEN** una consulta que se da de **alta** exploratoria (sin fecha), luego se le
  **añade** una fecha disponible y después se **cambia** la fecha, generando en cada
  evento un email E1 en `borrador`
- **WHEN** se inspecciona `COMUNICACION` para esa RESERVA
- **THEN** existen **tres** filas E1 en `estado = 'borrador'` con `subtipo`
  `consulta_exploratoria`, `fecha_disponible` y `cambio_fecha` respectivamente, cada
  una con su propio `asunto` y `fecha_creacion`, sin que ninguna sobrescriba a otra
- **AND** el índice UNIQUE parcial (predicado `estado = 'enviado'`) no las bloquea por
  seguir en `borrador`

#### Scenario: Reeditar los datos de la consulta sin cambio de estado no añade fila al historial

- **GIVEN** una RESERVA con un borrador E1 pendiente de un `subtipo` dado y el gestor
  edita **datos** de la consulta (p. ej. nº de personas) **sin** cambio de estado
- **WHEN** el sistema re-renderiza el contenido del borrador
- **THEN** **ACTUALIZA en sitio** el borrador pendiente (mismo `subtipo`, mismo evento,
  contenido corregido)
- **AND** **NO** inserta una fila nueva en el historial (no es un evento de ciclo de
  vida)

### Requirement: Listado de las comunicaciones de una RESERVA para la ficha del gestor

El sistema SHALL (DEBE) exponer un listado de todas las `COMUNICACION` asociadas a una
RESERVA (sección "Comunicaciones" de la ficha), devolviendo por cada fila al menos
`id`, `codigo_email`, `subtipo`, `estado`, `asunto`, `destinatario_email`,
`fecha_creacion`, `fecha_envio` y `es_reenvio`. El campo `subtipo` es **nullable**
(`NULL` para E2–E8, `manual` y filas legadas) y, cuando está presente, el frontend
DEBE renderizar una **etiqueta humana** por subtipo
(`consulta_exploratoria` → "Respuesta a consulta (sin fecha)"; `fecha_disponible` →
"Fecha disponible / asignada"; `fecha_confirmada` → "Fecha confirmada"; `cola_espera`
→ "En cola de espera"; `cambio_fecha` → "Cambio de fecha"). El listado DEBE devolver
**todas** las filas de esa RESERVA **sin deduplicar por código ni por subtipo**: si
hay varias E1 `borrador` de subtipos distintos (historial completo, por
alta/añadir/cambiar fecha) el listado las devuelve **todas**. El listado DEBE
ejecutarse bajo el **contexto RLS del `tenant_id` del JWT** del gestor autenticado y
devolver **únicamente** comunicaciones cuyo `reserva_id` es la RESERVA solicitada y
cuyo `tenant_id` coincide con el del JWT (nunca cross-tenant). Las comunicaciones en
`estado = 'enviado'` o `'fallido'` se presentan como **solo lectura**; las de
`estado = 'borrador'` son accionables (enviar / descartar). (Fuente: `US-046
§Supuestos` sección Comunicaciones de la ficha, `§Happy Path`; UC-36; `CLAUDE.md
§Multi-tenancy`; requirement vivo *"Idempotencia de un email por reserva y código"*;
`design.md §D-subtipo`.)

#### Scenario: El gestor lista las comunicaciones de su reserva

- **GIVEN** una RESERVA del tenant del gestor con varias `COMUNICACION`
  (p. ej. una E1 en `borrador`, una E2 `enviado`)
- **WHEN** el gestor solicita el listado de comunicaciones de esa RESERVA
- **THEN** el sistema devuelve todas las filas de esa RESERVA con su `codigo_email`,
  `subtipo`, `estado`, `asunto`, `destinatario_email`, `fecha_creacion`, `fecha_envio`
  y `es_reenvio`
- **AND** las de `estado = 'enviado'`/`'fallido'` se marcan de solo lectura y las de
  `'borrador'` como accionables

#### Scenario: El listado no expone comunicaciones de otro tenant

- **GIVEN** una RESERVA cuyo `tenant_id` no coincide con el `tenant_id` del JWT del
  gestor
- **WHEN** el gestor solicita el listado de comunicaciones de esa RESERVA
- **THEN** el sistema no devuelve comunicaciones de esa RESERVA (aislamiento RLS por
  tenant)

#### Scenario: El listado devuelve varias E1 etiquetadas por subtipo

- **GIVEN** una RESERVA del tenant del gestor cuyo ciclo de vida ha generado tres
  emails E1 en `borrador` con subtipos `consulta_exploratoria`, `fecha_disponible` y
  `cambio_fecha`
- **WHEN** el gestor solicita el listado de comunicaciones de esa RESERVA
- **THEN** el sistema devuelve las **tres** filas E1 (una por evento), no una sola
  sobrescrita, cada una con su `subtipo`, `asunto` y `fecha_creacion`
- **AND** el frontend muestra una etiqueta humana por subtipo ("Respuesta a consulta
  (sin fecha)", "Fecha disponible / asignada", "Cambio de fecha")

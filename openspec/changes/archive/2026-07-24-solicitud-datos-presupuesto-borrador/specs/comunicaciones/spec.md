# Spec Delta — Capability `comunicaciones`

> **solicitud-datos-presupuesto-borrador** — Cuando el cliente aporta la fecha ya en la
> primera consulta y el gestor la anota **sin** pasar por la transición `2a → 2b`, nunca se
> genera el borrador E1 "disponible" que pide los datos fiscales, y al ir a **generar el
> presupuesto** faltan esos datos sin que ningún email los haya solicitado. Este change añade
> una acción del gestor —desde el modal "Generar presupuesto"— que deja **EN BORRADOR** un
> email solicitando los datos fiscales del cliente, **reutilizando el mismo texto** del E1
> disponible y clasificándolo con un `subtipo` NUEVO (`solicitud_datos`) bajo
> `codigo_email = 'E1'`, de modo que no colisione con el E1 de transición.
>
> Fuente: petición de producto (visibilidad condicionada a datos fiscales incompletos;
> idempotencia una-sola-vez); `apps/api/src/reservas/application/plantilla-transicion-fecha.ts`
> (`renderMensajeTransicionFecha`, `renderDisponibleES` 89-115, `renderDisponibleCA` 61-87);
> `apps/api/prisma/schema.prisma` (`enum SubtipoEmail` 173-179; índice UNIQUE parcial de
> `COMUNICACION` ~682-695); spec viva `comunicaciones` "Idempotencia de un email por reserva y
> código" e "Interfaz de adjuntos por referencia documental"; `DespacharEmailService.despachar`.

## ADDED Requirements

### Requirement: Solicitud de datos de presupuesto — borrador E1 (subtipo solicitud_datos) reutilizando la plantilla del E1 disponible

El sistema SHALL (DEBE) exponer una acción del gestor —endpoint
`POST /reservas/{id}/comunicaciones/solicitar-datos-presupuesto`— que, para una RESERVA cuyo
**cliente tiene los datos fiscales incompletos**, deje **EN BORRADOR** un email que solicita
esos datos al cliente. El email SHALL (DEBE) reutilizar **verbatim** el cuerpo y el asunto de
la plantilla del **E1 "disponible"** (`renderMensajeTransicionFecha({ tipo: 'disponible',
idioma, nombre, fechaEvento, personas, horas })`), cuyo texto ya incluye la petición literal
*"Para poder prepararte el presupuesto, necesitaría los siguientes datos: Nombre y apellidos
/ DNI / Dirección y población"* (y su equivalente en catalán). El **idioma** se toma de
`Reserva.idioma`: `'ca'` → catalán, cualquier otro valor (`'es'`) → castellano. La
comunicación se crea con el patrón estándar de borrador
(`DespacharEmailService.despachar({ autoenviar: false })`): `estado = 'borrador'`,
`fecha_envio = null`, `codigo_email = 'E1'` y `subtipo = 'solicitud_datos'` (subtipo NUEVO,
distinto de `fecha_disponible` y `cola_espera`, para no colisionar con el E1 de transición).
La acción SHALL (DEBE) correr bajo el `tenant_id` y `rol` del JWT (RLS + filtro `tenant_id`),
sobre el cliente de la reserva, y quedar registrada en `AUDIT_LOG`. El borrador creado
aparece en el **listado de comunicaciones** de la RESERVA y el gestor lo revisa y envía con
el flujo de envío de borradores existente (US-046), fuera de este change. (Fuente: petición
de producto; `plantilla-transicion-fecha.ts` `renderMensajeTransicionFecha` /
`renderDisponibleES` 89-115 / `renderDisponibleCA` 61-87; `Reserva.idioma` `schema.prisma`
~378; `DespacharEmailService.despachar`; spec viva `comunicaciones` "Registro en COMUNICACION
con estado y fecha de envío coherentes".)

#### Scenario: Solicitud en castellano crea un borrador E1 solicitud_datos

- **GIVEN** una RESERVA con `idioma = 'es'` cuyo cliente tiene datos fiscales **incompletos**
  y **sin** ninguna COMUNICACION previa de la terna `('E1', 'solicitud_datos')`
- **WHEN** el gestor invoca
  `POST /reservas/{id}/comunicaciones/solicitar-datos-presupuesto`
- **THEN** se crea una `COMUNICACION` con `codigo_email = 'E1'`, `subtipo = 'solicitud_datos'`,
  `estado = 'borrador'` y `fecha_envio = null`
- **AND** el cuerpo y el asunto son los de la plantilla del E1 "disponible" en **castellano**
  (incluye "Para poder prepararte el presupuesto, necesitaría los siguientes datos: Nombre y
  apellidos / DNI / Dirección y población")
- **AND** la operación queda registrada en `AUDIT_LOG` bajo el tenant del JWT

#### Scenario: Solicitud en catalán usa el texto catalán de la plantilla

- **GIVEN** una RESERVA con `idioma = 'ca'` cuyo cliente tiene datos fiscales **incompletos**
- **WHEN** el gestor invoca el endpoint de solicitud de datos
- **THEN** se crea el borrador E1 `solicitud_datos` con el cuerpo y asunto de la plantilla en
  **catalán** (incluye "Per poder-te preparar el pressupost, necessitaria les següents dades:
  Nom i cognoms / DNI / Adreça i població")

#### Scenario: Segunda solicitud tras un envío consumado se rechaza con 409 (una sola vez)

- **GIVEN** una RESERVA que ya tiene una `COMUNICACION` de la terna
  `(reserva_id, 'E1', 'solicitud_datos')` en `estado = 'enviado'`
- **WHEN** el gestor vuelve a invocar el endpoint de solicitud de datos
- **THEN** el sistema responde `409` (`ComunicacionDuplicadaError`), respaldado por el índice
  UNIQUE parcial sobre la terna con predicado `estado = 'enviado'`
- **AND** NO crea una segunda fila enviada ni un nuevo borrador

#### Scenario: Solicitud con un borrador pendiente reutiliza el borrador existente

- **GIVEN** una RESERVA que ya tiene una `COMUNICACION` de la terna
  `(reserva_id, 'E1', 'solicitud_datos')` en `estado = 'borrador'` (sin enviar)
- **WHEN** el gestor vuelve a invocar el endpoint de solicitud de datos
- **THEN** el sistema **reutiliza** el borrador pendiente (no crea una fila duplicada)
- **AND** responde con el borrador existente para que el gestor lo revise y envíe

#### Scenario: Solicitud con datos fiscales completos se rechaza con 422

- **GIVEN** una RESERVA cuyo cliente ya tiene **completos** los datos fiscales
  (`dniNif`, `direccion`, `codigoPostal`, `poblacion`, `provincia`)
- **WHEN** el gestor invoca el endpoint de solicitud de datos
- **THEN** el sistema responde `422` (no hay datos que solicitar; defensa en profundidad, el
  botón ya no debería mostrarse en el frontend)
- **AND** NO se crea ninguna `COMUNICACION`

#### Scenario: Solicitud sobre una reserva inexistente devuelve 404

- **GIVEN** un `id` de reserva que no existe para el tenant del JWT
- **WHEN** el gestor invoca el endpoint de solicitud de datos
- **THEN** el sistema responde `404`
- **AND** NO se crea ninguna `COMUNICACION`

## MODIFIED Requirements

### Requirement: Idempotencia de un email por reserva y código

El sistema SHALL (DEBE) crear una `COMUNICACION` propia por cada **evento** de ciclo de vida que genera un email, etiquetándola con su `subtipo`. Un mismo `codigo_email = 'E1'` cubre emails **semánticamente distintos** según el evento que lo dispara (respuesta a una **consulta exploratoria** sin fecha, asignación de una **fecha disponible**, **confirmación** de fecha, entrada en **cola de espera**, **cambio de fecha**, y **solicitud de datos de presupuesto** cuando el cliente aportó la fecha en la primera consulta sin pasar por la transición `2a → 2b`). Por ello el sistema DEBE **persistir un `subtipo` explícito** en `COMUNICACION` (enum nullable `SubtipoEmail`; `NULL` para E2–E8, `manual` y filas legadas) con los valores:
`consulta_exploratoria`, `fecha_disponible`, `fecha_confirmada`, `cola_espera`,
`cambio_fecha`, `solicitud_datos`. El sistema **NO DEBE** sobrescribir la fila anterior de ese código
(fin del upsert `findFirst` + `update`); DEBE **INSERTAR** una fila nueva por evento,
conservando el **historial completo**: es válido y esperado que una misma RESERVA
tenga **varias** filas E1 `borrador` de subtipos distintos, cada una con su propio
`subtipo`, `asunto` y `fecha_creacion`.

El anti-duplicado se **clava sobre la terna `(reserva_id, codigo_email, subtipo)`**:
dos filas con **distinto** `subtipo` pueden **ambas** llegar a `estado = 'enviado'`
porque son emails legítimos y distintos (NO son reenvíos). En particular, la terna
`(reserva_id, 'E1', 'solicitud_datos')` es **independiente** de
`(reserva_id, 'E1', 'fecha_disponible')` y de `(reserva_id, 'E1', 'cola_espera')`: la
solicitud de datos de presupuesto puede coexistir con esos E1 de transición sin colisionar.
Solo un **segundo envío**
del **mismo** `(reserva_id, codigo_email, subtipo)` constituye una repetición, y ese
SÍ es un **reenvío genuino** que se marca `es_reenvio = true` (consistente con el
patrón de reenvío E3/E4/E8), quedando fuera del constraint. El sistema **NO DEBE
auto-enviar** una terna `(reserva_id, codigo_email, subtipo)` que **ya tiene** una
fila en `estado = 'enviado'`: la trata como **idempotente** sin crear otra fila
enviada ni reenviar. Los E1 de transición, de cambio de fecha y de **solicitud de datos**
son siempre `borrador` y **NO se auto-envían** (los revisa y envía el gestor, US-046). En
concreto, un **segundo intento** de solicitar datos cuando la terna
`(reserva_id, 'E1', 'solicitud_datos')` ya está en `enviado` se resuelve como conflicto
`409` para el gestor (una sola vez); si la fila sigue en `borrador`, la acción **reutiliza**
ese borrador en lugar de duplicarlo.

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
`§D-regenera-en-sitio`; petición de producto de la **solicitud de datos de presupuesto** —
subtipo `solicitud_datos`.)

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

#### Scenario: La solicitud de datos coexiste con un E1 de transición sin colisión

- **GIVEN** una `RESERVA` con una `COMUNICACION` E1 `subtipo = 'fecha_disponible'`
- **WHEN** el gestor genera además un borrador E1 `subtipo = 'solicitud_datos'`
- **THEN** ambas filas coexisten (ternas distintas) sin colisión del índice UNIQUE parcial
- **AND** la terna `('E1', 'solicitud_datos')` mantiene su propia idempotencia (una sola vez
  en `enviado`)

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

# consultas Specification

## ADDED Requirements

### Requirement: Visualización de la cola de espera de una fecha (bloqueante + cola FIFO, UC-11)

El sistema SHALL (DEBE) ofrecer al Gestor autenticado una vista de **solo lectura** que,
dada la RESERVA **bloqueante** de una fecha (la que posee la `FECHA_BLOQUEADA` activa),
proyecte en una sola respuesta: (a) la **sección bloqueante** con su cliente, `sub_estado`
(uno de `2b`, `2c`, `2v`), TTL restante y código; y (b) la **cola de espera**: las RESERVA
en `sub_estado = '2d'` cuyo `consulta_bloqueante_id` apunta a la bloqueante, con su cliente,
código, posición y tiempo en cola. La vista NO muta estado (no promueve, no saca de cola,
no registra AUDIT_LOG). La lectura SHALL (DEBE) exponerse como `GET /reservas/{id}/cola`,
donde `{id}` es el `reservaId` de la bloqueante. (Fuente: `US-017 §Historia`, `§Happy Path`;
`use-cases.md` UC-11; `docs/api-spec.yml` `GET /reservas/{id}/cola`.)

#### Scenario: Fecha con bloqueante en 2.b y dos consultas en cola

- **GIVEN** una `FECHA_BLOQUEADA` para `2026-09-12` con bloqueante R1 en `sub_estado = '2b'`
  y `ttl_expiracion` mañana a las 10:00, y dos RESERVA en `sub_estado = '2d'`: R2
  (`posicion_cola = 1`, `consulta_bloqueante_id = R1.id`, creada hace 2 h) y R3
  (`posicion_cola = 2`, `consulta_bloqueante_id = R1.id`, creada hace 30 min)
- **WHEN** el Gestor solicita la cola de la fecha (a través de R1)
- **THEN** la respuesta incluye la sección bloqueante con el cliente de R1, `subEstado = '2b'`,
  el TTL restante (≈ 22 h) y el código de R1
- **AND** incluye la cola con R2 en posición 1 (tiempo en cola ≈ 2 h) y R3 en posición 2
  (tiempo en cola ≈ 30 min), cada una con nombre de cliente y código
- **AND** no se produce ninguna mutación de estado ni registro en AUDIT_LOG

### Requirement: Ordenación FIFO estricta y filtrado de la cola

El sistema SHALL (DEBE) devolver la cola **ordenada ascendentemente por `posicion_cola`**
(orden FIFO), NO por `fecha_creacion`. SHALL (DEBE) incluir en la cola **únicamente** las
RESERVA con `sub_estado = '2d'` **y** `consulta_bloqueante_id` igual al id de la bloqueante
activa de esa fecha; cualquier otro sub_estado (la propia bloqueante, terminales
`2x`/`2y`/`2z`, o consultas de otras fechas) SHALL (DEBE) quedar **excluido** de la lista.
(Fuente: `US-017 §Reglas de negocio`, `§Reglas de Validación`.)

#### Scenario: Solo se listan RESERVA en 2.d apuntando a la bloqueante, ordenadas por posición

- **GIVEN** una bloqueante R1 con RESERVA R2 (`2d`, `posicion_cola = 2`) y R3 (`2d`,
  `posicion_cola = 1`) apuntando a R1, más una RESERVA R4 en sub_estado terminal `2y`
  que antes estuvo en la cola
- **WHEN** el Gestor solicita la cola
- **THEN** la lista contiene exactamente R3 (posición 1) y luego R2 (posición 2), en ese
  orden ascendente
- **AND** R4 (sub_estado `2y`) NO aparece en la lista

### Requirement: Cálculo de TTL restante y tiempo en cola como instantes

El sistema SHALL (DEBE) calcular el **TTL restante** de la bloqueante como
`ttl_expiracion − now()` y el **tiempo en cola** de cada RESERVA en `2d` como
`now() − fecha_creacion`, operando sobre instantes `timestamptz` en el backend, NUNCA sobre
fechas formateadas (para no arrastrar el off-by-one de zona horaria conocido). El TTL restante
SHALL (DEBE) ser `null` cuando la bloqueante no tiene `ttl_expiracion`. (Fuente:
`US-017 §Reglas de negocio`, `§Reglas de Validación`; deuda TZ documentada.)

#### Scenario: El TTL restante y el tiempo en cola se derivan de instantes vigentes

- **GIVEN** una bloqueante con `ttl_expiracion` dentro de 22 h y una RESERVA en cola creada
  hace 30 min
- **WHEN** el Gestor solicita la cola
- **THEN** el TTL restante refleja ≈ 22 h calculado como `ttl_expiracion − now()`
- **AND** el tiempo en cola de esa RESERVA refleja ≈ 30 min calculado como
  `now() − fecha_creacion`

### Requirement: Fecha con bloqueante sin consultas en cola

El sistema SHALL (DEBE), cuando existe una bloqueante activa pero **ninguna** RESERVA en
`sub_estado = '2d'` apunta a ella, devolver la sección bloqueante y una cola **vacía**, de
modo que la vista muestre "Sin consultas en espera para esta fecha". (Fuente: `US-017 FA-01`.)

#### Scenario: FA-01 — bloqueante sin cola

- **GIVEN** una `FECHA_BLOQUEADA` con bloqueante R1 y ninguna RESERVA con
  `consulta_bloqueante_id = R1.id` en `sub_estado = '2d'`
- **WHEN** el Gestor solicita la cola
- **THEN** la respuesta incluye la sección bloqueante con los datos de R1
- **AND** la cola está vacía (la vista muestra "Sin consultas en espera para esta fecha")

### Requirement: Bloqueante en sub_estado 2.c o 2.v se proyecta correctamente

El sistema SHALL (DEBE) proyectar la sección bloqueante cuando esté en `sub_estado = '2c'`
(pendiente de invitados) o `sub_estado = '2v'` (visita programada), mostrando su
`sub_estado` real y su TTL vigente. Cuando la bloqueante está en `2v`, la respuesta SHALL
(DEBE) incluir además la `visita_programada_fecha`. La cola asociada se proyecta con el
mismo formato en todos los sub_estados de bloqueante. (Fuente: `US-017 FA-02`, `FA-03`,
`§Reglas de negocio`.)

#### Scenario: FA-02 — bloqueante en 2.c con una consulta en cola

- **GIVEN** una bloqueante R1 en `sub_estado = '2c'` con una RESERVA en cola
- **WHEN** el Gestor solicita la cola
- **THEN** la sección bloqueante muestra `subEstado = '2c'` y el TTL correcto
- **AND** la consulta en cola se muestra con el mismo formato (cliente, código, posición,
  tiempo en cola)

#### Scenario: FA-03 — bloqueante en 2.v con visita programada

- **GIVEN** una bloqueante R1 en `sub_estado = '2v'` con `visita_programada_fecha` definida
  y una consulta en cola
- **WHEN** el Gestor solicita la cola
- **THEN** la sección bloqueante muestra `subEstado = '2v'`, la `visitaProgramadaFecha` y el
  TTL vigente
- **AND** las consultas en cola se muestran ordenadas por posición igualmente

### Requirement: Fecha sin FECHA_BLOQUEADA activa (fecha disponible)

El sistema SHALL (DEBE), cuando la reserva `{id}` **no** posee una `FECHA_BLOQUEADA` activa
(no es bloqueante de ninguna fecha), responder de modo que la vista muestre "Fecha
disponible" sin sección de cola ni de bloqueante. La forma concreta de respuesta (200 con
indicador de "no bloqueada" vs. 404) la fija el contrato OpenAPI (ver `design.md D-3`);
en cualquier caso NO se muta estado. (Fuente: `US-017 FA-04`.)

#### Scenario: FA-04 — la reserva no bloquea ninguna fecha activa

- **GIVEN** una reserva cuya fecha no tiene registro activo en `FECHA_BLOQUEADA`
- **WHEN** el Gestor solicita la cola de esa fecha/reserva
- **THEN** la respuesta indica "Fecha disponible" (sin sección de cola ni de bloqueante),
  conforme al shape definido por el contrato
- **AND** no se produce ninguna mutación de estado

### Requirement: Cola con un único elemento

El sistema SHALL (DEBE) proyectar correctamente el caso de una cola con **un solo**
elemento: la bloqueante R1 y una única RESERVA en `2d` con `posicion_cola = 1`. (Fuente:
`US-017 FA-05`.)

#### Scenario: FA-05 — cola de un único elemento

- **GIVEN** una bloqueante R1 y una única RESERVA R2 en `sub_estado = '2d'`,
  `posicion_cola = 1`, `consulta_bloqueante_id = R1.id`
- **WHEN** el Gestor solicita la cola
- **THEN** la sección bloqueante muestra R1
- **AND** la cola contiene exactamente R2 en posición 1

### Requirement: Aislamiento multi-tenant en la lectura de la cola

La lectura de la cola SHALL (DEBE) filtrar **siempre** por el `tenant_id` del JWT activo,
reforzada por Row-Level Security (RLS). Una RESERVA bloqueante o una consulta en cola de otro
tenant SHALL (DEBE) ser **invisible** (la reserva `{id}` de otro tenant no se resuelve →
tratada como no encontrada). (Fuente: `US-017 §Contexto`; `CLAUDE.md` Multi-tenancy/RLS;
patrón de `ColaQueryPrismaAdapter` y `ReservaDetalleQueryPort`.)

#### Scenario: La cola de otro tenant no es alcanzable

- **GIVEN** una bloqueante y su cola pertenecientes al tenant "T-002"
- **WHEN** un Gestor con JWT del tenant "T-001" solicita esa cola
- **THEN** el sistema no expone ningún dato de "T-002" (la reserva se trata como no
  encontrada bajo RLS)

### Requirement: Acceso a la ficha de cada RESERVA de la cola

La vista de cola SHALL (DEBE) permitir al Gestor **acceder a la ficha completa** de la
bloqueante y de cualquier RESERVA de la cola, reutilizando la ficha existente
(`GET /reservas/{id}`, US-005). La respuesta de la cola SHALL (DEBE) incluir el `idReserva`
de cada elemento para habilitar ese enlace. (Fuente: `US-017 §Happy Path`.)

#### Scenario: Cada elemento de la cola enlaza a su ficha

- **GIVEN** una cola con R2 y R3
- **WHEN** el Gestor visualiza la cola
- **THEN** dispone del `idReserva` de R1, R2 y R3 para navegar a la ficha de cada una

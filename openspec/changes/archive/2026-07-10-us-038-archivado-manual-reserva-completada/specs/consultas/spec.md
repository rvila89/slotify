# consultas Specification

## ADDED Requirements

### Requirement: Archivado manual de la reserva a reserva_completada por el gestor desde la ficha

El sistema SHALL (DEBE) permitir al **Gestor** archivar **manualmente** una RESERVA en `estado =
'post_evento'`, transicionándola a `reserva_completada` (estado **terminal e inmutable**) **sin esperar**
al archivado automático de T+7d (US-037), **cuando la fianza esté resuelta**. La acción se expone como un
**endpoint de usuario dedicado** `POST /reservas/{id}/archivar` (actor Gestor), autenticado con **JWT de
usuario** y **rol gestor** (NUNCA `X-Cron-Token`: no es un barrido de Sistema); el `tenant_id` y el
`usuario_id` DERIVAN SIEMPRE del JWT, nunca del path ni del body. El `{id}` del path identifica la ÚNICA
RESERVA a archivar (no es un barrido). La transición reutiliza la **máquina de estados declarativa** del
agregado RESERVA (guarda de origen `resolverArchivadoAutomatico`: `post_evento → reserva_completada`,
terminal, la misma que introdujo US-037; NO se añade arista nueva). Al éxito, la RESERVA queda visible y
filtrable en el módulo Histórico y no se envía ningún email. (Fuente: `US-038 §Historia`, `§Reglas de
negocio`, `§Reglas de Validación`; `use-cases.md` UC-28 flujo alternativo manual; guarda de origen de
US-037; `CLAUDE.md §Máquina de estados`.)

#### Scenario: El gestor archiva una reserva en post_evento con la fianza resuelta

- **GIVEN** una RESERVA en `estado = 'post_evento'` con la fianza resuelta (p. ej. `fianza_status =
  devuelta`), aunque solo lleve 3 días en `post_evento`
- **WHEN** el gestor invoca `POST /reservas/{id}/archivar` con su JWT (rol gestor) y confirma la acción
- **THEN** en una transacción atómica bajo el contexto RLS de su tenant el sistema fija `RESERVA.estado =
  reserva_completada`
- **AND** la RESERVA queda visible y filtrable en el módulo Histórico y sale del pipeline activo
- **AND** no se aplica ningún filtro de antigüedad T+7d (el archivado manual no requiere que hayan
  transcurrido 7 días)

#### Scenario: Solo el gestor autenticado puede archivar

- **GIVEN** una petición a `POST /reservas/{id}/archivar`
- **WHEN** la petición no lleva JWT válido
- **THEN** el sistema la rechaza con 401 y no transiciona ninguna RESERVA
- **AND** si el JWT es válido pero el rol no es gestor, la rechaza con 403 sin ejecutar la transición

#### Scenario: Reserva inexistente o de otro tenant

- **GIVEN** un `{id}` que no corresponde a ninguna RESERVA del tenant del JWT (inexistente o de otro
  tenant, invisible bajo RLS)
- **WHEN** el gestor invoca el archivado manual
- **THEN** el sistema responde 404 y no transiciona ni audita nada

### Requirement: La condición de fianza resuelta del archivado manual es idéntica a la del automático (US-037)

El sistema SHALL (DEBE), en el archivado manual, evaluar la **misma guarda de fianza resuelta** que el
archivado automático de US-037 (`fianzaResuelta`): la fianza está resuelta si `fianza_status ∈ {devuelta,
retenida_parcial}` **O** `fianza_eur ≤ 0` **O** `fianza_eur IS NULL`. La guarda se evalúa **en una única
lectura de la fila** dentro de la transacción atómica, bajo el `SELECT … FOR UPDATE` de la RESERVA. La
AUSENCIA de fianza (`fianza_eur ≤ 0` o `NULL`) satisface la guarda sin evaluar `fianza_status`;
`retenida_parcial` con `fianza_devuelta_eur = 0` (retención del 100%) es un estado resuelto válido.
(Fuente: `US-038 §Reglas de negocio`, `§Happy Path — Sin fianza`, `§Happy Path — Con fianza totalmente
retenida`; guarda de fianza de US-037/US-036.)

#### Scenario: Sin fianza (fianza_eur = 0 o NULL) — archiva sin evaluar fianza_status

- **GIVEN** una RESERVA en `estado = 'post_evento'` con `fianza_eur = 0` (tenant sin fianza) o `fianza_eur
  IS NULL`
- **WHEN** el gestor invoca el archivado manual y confirma
- **THEN** la guarda de fianza se satisface por ausencia de fianza (no se evalúa `fianza_status`) y el
  sistema fija `RESERVA.estado = reserva_completada` sin restricciones adicionales

#### Scenario: Retención total (retenida_parcial con importe devuelto 0) — es estado resuelto válido

- **GIVEN** una RESERVA en `estado = 'post_evento'`, `fianza_status = retenida_parcial`,
  `fianza_devuelta_eur = 0.00` (retención del 100%)
- **WHEN** el gestor invoca el archivado manual y confirma
- **THEN** el sistema trata `retenida_parcial` (con cualquier importe devuelto, incluido 0) como fianza
  resuelta y fija `RESERVA.estado = reserva_completada`

### Requirement: Bloqueo del archivado manual con fianza no resuelta y mensaje específico

El sistema SHALL (DEBE), cuando el gestor intente archivar una RESERVA en `estado = 'post_evento'` cuya
fianza NO esté resuelta (`fianza_status ∈ {cobrada, recibo_enviado, pendiente}` con `fianza_eur > 0`),
**BLOQUEAR** el archivado: NO transicionar (la RESERVA permanece en `post_evento`), NO registrar entrada
de transición en `AUDIT_LOG`, y devolver un error con el mensaje específico "No se puede archivar la
reserva: la fianza está pendiente de resolución. Registra la devolución o retención de fianza antes de
archivar." El bloqueo es una **respuesta de error síncrona** al gestor (NO una alerta interna diferida
como en US-037); el frontend puede además **deshabilitar** el botón "Archivar reserva" cuando la fianza no
está resuelta (defensa en UI), pero el backend valida siempre (defensa en profundidad). El código HTTP
concreto del bloqueo por fianza no resuelta (409 conflicto vs. 422 precondición de negocio) es decisión de
diseño resuelta en el gate (design.md §D-3). (Fuente: `US-038 §FA-01`, `§FA-02`, `§Reglas de Validación`;
guarda de fianza de US-036/US-037.)

#### Scenario: Fianza cobrada sin resolver (FA-01) — bloquea

- **GIVEN** una RESERVA en `estado = 'post_evento'`, `fianza_status = cobrada` y `fianza_eur > 0` (fianza
  cobrada pero sin devolución ni retención registradas)
- **WHEN** el gestor intenta archivar la reserva
- **THEN** el sistema bloquea la acción y devuelve el mensaje "No se puede archivar la reserva: la fianza
  está pendiente de resolución. Registra la devolución o retención de fianza antes de archivar."
- **AND** `RESERVA.estado` permanece `post_evento` y no se registra ninguna entrada de transición en
  `AUDIT_LOG`

#### Scenario: Fianza en estado intermedio recibo_enviado (FA-02) — bloquea con el mismo mensaje

- **GIVEN** una RESERVA en `estado = 'post_evento'`, `fianza_status = recibo_enviado` y `fianza_eur > 0`
- **WHEN** el gestor intenta archivar la reserva
- **THEN** el sistema bloquea con el mismo mensaje que FA-01 (cualquier `fianza_status ∉ {devuelta,
  retenida_parcial}` con `fianza_eur > 0` es "fianza no resuelta")
- **AND** `RESERVA.estado` permanece `post_evento`

### Requirement: La auditoría del archivado manual registra el origen Gestor con usuario_id

El sistema SHALL (DEBE) registrar cada transición manual a `reserva_completada` en `AUDIT_LOG` con origen
**Gestor** (a diferencia del archivado automático de US-037, que es de Sistema con `usuario_id` nulo):
`accion = 'transicion'`, `entidad = 'RESERVA'`, `entidad_id = <id de la RESERVA>`, `usuario_id = <id del
gestor del JWT>` (NO nulo), `datos_anteriores = {estado: post_evento}`, `datos_nuevos = {estado:
reserva_completada}`. La auditoría es **obligatoria** en toda transición manual efectiva y NO se escribe
cuando el archivado se bloquea (fianza no resuelta) ni cuando la RESERVA ya no está en `post_evento`.
(Fuente: `US-038 §Happy Path`, `§Reglas de Validación` — "AUDIT_LOG obligatorio con usuario_id del
gestor"; `er-diagram.md` AUDIT_LOG.)

#### Scenario: El archivado manual se audita como acción del gestor

- **GIVEN** una RESERVA que el gestor archiva a `reserva_completada`
- **WHEN** el sistema registra la transición en `AUDIT_LOG`
- **THEN** la entrada tiene `accion = 'transicion'`, `entidad = 'RESERVA'`, `datos_anteriores = {estado:
  post_evento}`, `datos_nuevos = {estado: reserva_completada}` y `usuario_id = <id del gestor>` (origen
  Gestor, NO Sistema)

### Requirement: Idempotencia y concurrencia del archivado manual frente al cron de US-037

El sistema SHALL (DEBE) garantizar que el archivado manual es idempotente y coordina con el archivado
automático (US-037) sobre la misma RESERVA: la guarda de origen (`resolverArchivadoAutomatico`) se
**re-evalúa dentro de la transacción bajo el `SELECT … FOR UPDATE`** de la fila RESERVA. Si bajo el lock
la RESERVA ya NO está en `post_evento` (porque un pase del cron de US-037, un doble clic del gestor u otra
acción ya la dejó en `reserva_completada` o en otro estado), la guarda devuelve `null` y el sistema NO
transiciona ni audita, devolviendo un conflicto de estado (409 `code: 'transicion_no_permitida'`). Cuando
el barrido de Sistema (US-037) y el gestor (US-038) intentan transicionar **simultáneamente** la misma
RESERVA de `post_evento` a `reserva_completada`, **exactamente una** operación tiene éxito; la segunda
detecta bajo el lock que el estado ya no es `post_evento` y termina sin error (no-op para el cron; 409
para el gestor), sin duplicar el registro en `AUDIT_LOG` ni generar estado inconsistente. La serialización
la da PostgreSQL sobre la fila RESERVA, sin locks distribuidos (Redis/Redlock prohibidos). (Fuente:
`US-038 §Concurrencia / Race Conditions`, `§Reglas de Validación` — `reserva_completada` terminal e
inmutable; `CLAUDE.md §Regla crítica: bloqueo atómico`; US-037 §D-7.)

#### Scenario: Cron (US-037) y archivado manual (US-038) compiten por la misma RESERVA

- **GIVEN** una RESERVA en `estado = 'post_evento'` con la fianza resuelta, sobre la que el cron (US-037)
  y el gestor (US-038) ejecutan la transición en la misma ventana temporal
- **WHEN** ambas operaciones leen `estado = post_evento` bajo el lock de la fila y ejecutan la UPDATE
- **THEN** exactamente una tiene éxito y fija `estado = reserva_completada`
- **AND** la segunda observa que el estado ya no es `post_evento` y termina sin error (no-op para el cron;
  409 `transicion_no_permitida` para el gestor)
- **AND** `AUDIT_LOG` contiene exactamente una entrada de transición para esa RESERVA

#### Scenario: Doble clic del gestor sobre archivar — la segunda petición no re-archiva

- **GIVEN** una RESERVA en `estado = 'post_evento'` con la fianza resuelta sobre la que el gestor lanza
  dos peticiones `POST /reservas/{id}/archivar` concurrentes
- **WHEN** ambas se procesan
- **THEN** una archiva la RESERVA (200) y la otra observa bajo el lock que el estado ya no es
  `post_evento` y responde 409 `transicion_no_permitida`
- **AND** no se genera ninguna entrada duplicada en `AUDIT_LOG`

#### Scenario: Intento de archivar una reserva que no está en post_evento

- **GIVEN** una RESERVA en un estado distinto de `post_evento` (p. ej. `reserva_confirmada`,
  `evento_en_curso`, o ya `reserva_completada`)
- **WHEN** el gestor invoca `POST /reservas/{id}/archivar`
- **THEN** el sistema no transiciona (la guarda de origen devuelve `null`) y responde 409 `code:
  'transicion_no_permitida'`
- **AND** la RESERVA no se modifica y no se registra nada en `AUDIT_LOG`

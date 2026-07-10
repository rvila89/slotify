# Design — us-038-archivado-manual-reserva-completada

## Context

US-038 (UC-28, **flujo alternativo manual**, actor **Gestor**) es la variante **manual** del cierre de
la RESERVA: el gestor transiciona `RESERVA.estado: post_evento → reserva_completada` (terminal,
inmutable) **desde la ficha**, sin esperar al T+7d automático de US-037, **cuando la fianza está
resuelta**. Reutiliza dominio e infraestructura ya presentes (US-034 dejó `post_evento`; US-036 produce
la fianza resuelta; **US-037** dejó las guardas puras y el patrón transaccional):

- **US-034** (`finalizar-evento`) es la **plantilla del endpoint de usuario**: `POST
  /reservas/{id}/finalizar-evento`, `@Roles('gestor')` + `RolesGuard` sobre `JwtAuthGuard` global,
  `tenant_id`/`usuario_id` del JWT (`@CurrentUser`), mapeo de errores de dominio a códigos HTTP
  (`ReservaNoEncontradaError` → 404, `TransicionNoPermitidaError` → 409 `code:
  'transicion_no_permitida'`). US-038 replica esta forma para `POST /reservas/{id}/archivar`.
- **US-037** dejó en `apps/api/src/reservas/domain/maquina-estados.ts` las piezas **reutilizables**:
  - `resolverArchivadoAutomatico(estado, subEstado)`: guarda de ORIGEN declarativa
    (`MAPA_ARCHIVADO_AUTOMATICO`: `post_evento → reserva_completada`, terminal). Devuelve `null` para todo
    origen distinto de `post_evento` (incluido `reserva_completada`) → base de idempotencia y de la race.
  - `fianzaResuelta({ fianzaStatus, fianzaEur })`: guarda de FIANZA pura (resuelta si `fianzaStatus ∈
    {devuelta, retenida_parcial}` O `fianzaEur ≤ 0` O `fianzaEur == null`; devuelve `{ resuelta,
    pendiente }`).
  - El patrón transaccional canónico en `archivado-uow.prisma.adapter.ts`: `$transaction` +
    `fijarTenant(tx, tenantId)` como PRIMERA operación + `SELECT … FOR UPDATE` sobre la fila RESERVA +
    reevaluar ambas guardas bajo el lock + update + AUDIT_LOG.
  - US-037 §D-7 dejó **nota de coordinación explícita**: "US-038 DEBE usar la misma guarda
    `resolverArchivadoAutomatico` + `SELECT … FOR UPDATE` para heredar la garantía [de concurrencia]".
    US-038 la honra.

Este documento fija las decisiones no triviales. **Tres** son **decisiones abiertas que requieren
elección en el gate humano**: D-1 (grado de reutilización: guardas puras vs. UoW compartida), D-2
(alcance de la UI de la ficha en esta US), y D-3 (código HTTP del bloqueo por fianza no resuelta:
409 vs. 422).

## D-1. Grado de reutilización del mecanismo de US-037 — ✅ RESUELTA en gate: **Opción 1.A**

> **Resolución humana (gate 1)**: se adopta **1.A** — compartir solo las guardas puras de dominio
> (`resolverArchivadoAutomatico` + `fianzaResuelta`) y mantener una UoW manual propia delgada
> (`ArchivarReservaManualUoW`), SIN refactorizar US-037 ni extraer helper transaccional común.


**Contexto de la instrucción**: la US y el brief piden explícitamente "reutilizar el mecanismo ya
implementado en US-037 (guarda de fianza + transición de estado) y no duplicar lógica".

**Lo que ya está compartido sin discusión** (regla dura anti-duplicación): las **guardas puras de
dominio** `resolverArchivadoAutomatico` y `fianzaResuelta` de `maquina-estados.ts`. US-038 las importa y
usa tal cual; NO crea guardas nuevas ni añade aristas a `MAPA_ARCHIVADO_AUTOMATICO`. Esto NO es objeto de
decisión: es obligatorio.

**Lo que SÍ es decisión**: cómo compartir el **patrón transaccional** (`SELECT … FOR UPDATE` +
reevaluación de guardas + update + AUDIT_LOG), dado que la UoW de US-037
(`ArchivadoUoWPrismaAdapter.archivarReserva`) difiere de la de US-038 en cuatro puntos:

| Aspecto | US-037 (barrido, Sistema) | US-038 (manual, Gestor) |
|---|---|---|
| Alcance | N candidatas cross-tenant | 1 RESERVA por `{id}` |
| Tenant | del row (cross-tenant read) | del JWT (tenant fijo) |
| Autoría auditoría | Sistema (`usuario_id` NULL), `causa:'T+7d'` | Gestor (`usuario_id` del JWT), sin `causa` |
| "No aplica" | no-op / alerta interna diferida | **error HTTP síncrono** (409/422) al gestor |
| Filtro antigüedad | `fechaPostEvento ≤ hoy − 7` | **ninguno** (cualquier momento) |

**Opciones**:

- **Opción 1.A (RECOMENDADA) — compartir SOLO las guardas puras de dominio; UoW manual propia y
  delgada.** US-038 tiene su `ArchivarReservaManualUseCase` + su UoW (`ArchivarReservaManualUoW`) que
  replica el patrón `SELECT … FOR UPDATE` de US-037 pero (a) sobre una sola RESERVA con tenant del JWT,
  (b) audita origen Gestor, (c) traduce el "no candidato / fianza no resuelta" en **errores de dominio**
  (que el controller mapea a HTTP), no en alerta. **Ventaja**: cero acoplamiento entre el barrido de
  Sistema y la acción de usuario, que difieren en semántica de tenant, autoría y manejo del "no aplica";
  la anti-duplicación de lógica se satisface donde importa (las guardas puras). **Coste**: una UoW
  pequeña "parecida" a la de US-037 (misma forma, distinta autoría/scope). Es el mismo grado de
  reutilización que ya existe entre `finalizar-evento` (US-034) y los barridos (comparten guardas, no
  UoW).
- **Opción 1.B — extraer un helper transaccional compartido** (p. ej.
  `transicionarPostEventoAReservaCompletada(tx, reservaId, tenantId, { autoria })`) reutilizado por US-037
  y US-038. **Ventaja**: una sola implementación del `SELECT … FOR UPDATE` + update + AUDIT_LOG.
  **Inconveniente**: obliga a **tocar US-037 (ya archivado)** para refactorizarlo hacia el helper, o a
  dejar dos caminos (el helper nuevo + el de US-037), lo que **contradice** el objetivo de no duplicar; y
  el helper debe parametrizar autoría (Sistema vs. Gestor), scope (cross-tenant vs. JWT) y `causa`, lo que
  reintroduce ramas. Riesgo de abstracción prematura y de regresión sobre un change ya cerrado.

**Recomendación del autor: Opción 1.A** — reutilizar las guardas puras (obligatorio, ya hecho) y
mantener una UoW manual delgada propia, sin refactorizar US-037. **Pregunta para el humano**: ¿se
acepta 1.A (guardas puras compartidas + UoW manual propia), o se prefiere 1.B (extraer un helper
transaccional común, con el coste de tocar el change ya archivado de US-037)?

## D-2. Alcance de la UI de la ficha en esta US — ✅ RESUELTA en gate: **Opción 2.B**

> **Resolución humana (gate 1)**: se adopta **2.B** — UI completa en la ficha existente
> (`FichaConsulta`): botón "Archivar reserva" (visible solo en `post_evento`), diálogo de confirmación
> (patrón `FinalizarEventoDialog` de US-034), toast de éxito, y botón deshabilitado cuando la fianza no
> está resuelta. Responsive obligatorio (3 viewports). El step E2E Playwright **APLICA**.


**Problema**: los criterios de aceptación de US-038 describen interacción de UI (botón "Archivar
reserva" en la ficha, diálogo de confirmación, toast de éxito, botón deshabilitado cuando `fianza_status
= cobrada`). Hay que decidir qué construye ESTA US y qué asume/coordina.

**Opciones**:

- **Opción 2.A — backend + contrato + SDK, sin UI en esta US.** US-038 entrega el endpoint, el contrato
  OpenAPI y el SDK regenerado; la acción "Archivar reserva" en la ficha se difiere/coordina con la US
  dueña de la ficha de reserva. **Ventaja**: alcance acotado, contrato como frontera. **Inconveniente**:
  los criterios de UI de la US quedan cubiertos por otra US.
- **Opción 2.B — backend + contrato + UI completa (botón + diálogo + toast) en la ficha existente.**
  US-038 construye también la acción en la ficha (responsive obligatorio, 3 viewports). **Ventaja**:
  cierra los criterios de aceptación end-to-end (habilita E2E Playwright en step-N+3). **Inconveniente**:
  depende de que la ficha de reserva ya exista y exponga un punto de extensión; mayor alcance.
- **Opción 2.C — intermedia**: backend + contrato + un componente de acción mínimo reutilizable
  (botón + confirmación) integrable en la ficha cuando exista, con la lógica de deshabilitado por
  `fianza_status`.

**Recomendación del autor**: depende de si la ficha de reserva ya está construida en `apps/web`. Si
existe, **Opción 2.B** (cierra los AC y habilita E2E); si no, **Opción 2.A** (backend/contrato ahora,
UI cuando aterrice la ficha). **Pregunta para el humano**: ¿existe ya la ficha de reserva en el
frontend, y US-038 debe construir la UI (2.B/2.C) o limitarse a backend + contrato (2.A)? La respuesta
determina si el step-N+3 (E2E Playwright) aplica o es N/A justificado.

## D-3. Código HTTP del bloqueo por fianza no resuelta — ✅ RESUELTA en gate: **Opción 3.B**

> **Resolución humana (gate 1)**: se adopta **3.B** — **422** `code: 'fianza_no_resuelta'` para la
> precondición de fianza incumplida (origen `post_evento` válido pero fianza sin resolver con
> `fianza_eur > 0`), distinto del **409** `code: 'transicion_no_permitida'` para el conflicto de estado
> (origen ≠ `post_evento`). El contrato OpenAPI y el frontend distinguen ambos mensajes.


**Problema**: FA-01/FA-02 exigen **bloquear** el archivado cuando la fianza no está resuelta, con un
mensaje específico. Hay dos naturalezas de bloqueo con códigos distintos:

- Origen inválido (`estado ≠ post_evento`, incluido ya `reserva_completada`): es un **conflicto de estado
  del agregado** → **409** `code: 'transicion_no_permitida'`, exactamente como `FinalizarEventoConflictError`
  de US-034. Esto NO es objeto de decisión (se alinea con el contrato existente).
- Fianza no resuelta (origen `post_evento` válido, pero `fianzaResuelta = false` con `fianza_eur > 0`):
  **decisión de código**:
  - **Opción 3.A — 409 Conflict** `code: 'fianza_no_resuelta'`: se trata como un conflicto de estado del
    agregado (no se puede archivar en el estado actual de la fianza), coherente con el 409 de
    `finalizar-evento`. **Ventaja**: un único código de "no se puede transicionar ahora"; simplicidad de
    contrato.
  - **Opción 3.B — 422 Unprocessable Entity** `code: 'fianza_no_resuelta'`: se trata como una
    **precondición de negocio incumplida** (la petición es válida pero una regla de negocio la rechaza),
    distinguiéndola del conflicto de estado puro. **Ventaja**: distingue semánticamente "estado
    incorrecto" (409) de "regla de fianza incumplida" (422), útil para que el frontend muestre el mensaje
    de FA-01 diferenciado. Es el criterio que otras transiciones del proyecto usan para precondiciones
    (p. ej. 422 en guardas de origen de otras US).

**Recomendación del autor: Opción 3.B (422 para fianza no resuelta, 409 para origen inválido)** —
distingue el conflicto de estado (`transicion_no_permitida`, 409) de la precondición de negocio de fianza
(`fianza_no_resuelta`, 422), lo que da al frontend dos mensajes claros (el de FA-01 vs. el de "reserva ya
no está en post_evento"). **Pregunta para el humano**: ¿unificamos ambos bloqueos en 409 (3.A) o
distinguimos la fianza no resuelta como 422 (3.B, recomendada)? La respuesta fija el contrato del
step 2.

## D-4. Transición como reutilización de la máquina de estados declarativa (sin aristas nuevas)

- US-038 **NO añade ninguna arista** a `maquina-estados.ts`: `MAPA_ARCHIVADO_AUTOMATICO` ya modela
  `post_evento → reserva_completada` (terminal). US-038 consume `resolverArchivadoAutomatico` como guarda
  de origen. `reserva_completada` es TERMINAL (sin arista de salida): resolver desde `reserva_completada`
  devuelve `null` → 409 `transicion_no_permitida` (base de idempotencia y de la race con el cron).
- La guarda de fianza es **exactamente** `fianzaResuelta` de US-037 (sin variación): `retenida_parcial`
  con `fianza_devuelta_eur = 0` (retención 100%) es resuelto; `fianza_eur ≤ 0` o `NULL` es resuelto sin
  evaluar `fianza_status`.
- La mutación acompañante es mínima: `estado = reserva_completada` + AUDIT_LOG **origen Gestor**. Sin
  side-effects sobre `FECHA_BLOQUEADA`, cola, FICHA_OPERATIVA ni facturación. Sin email.

## D-5. Auditoría origen GESTOR (diferencia clave con US-037)

`AUDIT_LOG`: `accion = 'transicion'`, `entidad = 'RESERVA'`, `entidad_id = reservaId`, `usuario_id = <id
del gestor del JWT>` (NO nulo — a diferencia de US-037, que audita Sistema con `usuario_id` nulo y `causa:
'T+7d'`), `datos_anteriores = {estado: post_evento}`, `datos_nuevos = {estado: reserva_completada}` (sin
`causa: 'T+7d'`; opcionalmente `causa: 'manual'` — decisión menor de implementación). Es el requisito D1
de trazabilidad con autoría explícita.

## D-6. Concurrencia — race con el cron de US-037 (ya blindada) + doble clic del gestor

- **RC-1 (cron US-037 vs. gestor US-038)**: ambos intentan `post_evento → reserva_completada` a la vez.
  La transacción de cada uno re-evalúa `estado` bajo `SELECT … FOR UPDATE`; el segundo encuentra `estado
  ≠ post_evento` → `resolverArchivadoAutomatico` devuelve `null` → para el cron es no-op (0 filas), para
  el gestor es 409 `transicion_no_permitida`. Exactamente una transición y **una sola** entrada de
  AUDIT_LOG. Sin locks distribuidos (hook `no-distributed-lock`); serialización por PostgreSQL sobre la
  fila RESERVA. US-037 §D-7 ya verificó esta invariante simulando el "segundo actor"; US-038 la hace real
  reutilizando la misma guarda.
- **RC-2 (doble clic del gestor)**: dos peticiones `POST /reservas/{id}/archivar` concurrentes → una
  archiva (200), la otra 409 `transicion_no_permitida` (idempotencia). Sin doble auditoría.
- **Tests de concurrencia** (skill `concurrency-locking`, `Promise.allSettled`): RC-1 (cron vs. manual) y
  RC-2 (doble clic). Se lanzan **desde la sesión principal con Postgres real** (los subagentes QA no
  tienen BD, memoria del proyecto). El flaky de US-004 (`40P01`) es ajeno.

## D-7. Hexagonal: dominio puro (reutilizado) + caso de uso + adaptadores

- **Dominio** (`reservas/domain`): NADA nuevo — se reutilizan `resolverArchivadoAutomatico` y
  `fianzaResuelta` (US-037). Sin `@nestjs`/Prisma (hook `no-infra-in-domain`).
- **Aplicación**: `ArchivarReservaManualUseCase.ejecutar({ tenantId, usuarioId, reservaId })` que delega
  en un puerto de UoW (`ArchivarReservaManualPort.archivar(...)`); traduce el resultado a `reserva
  archivada` o lanza `TransicionNoPermitidaError` / `FianzaNoResueltaError` / `ReservaNoEncontradaError`.
- **Infraestructura**: `ArchivarReservaManualUoWPrismaAdapter` — `$transaction` + `fijarTenant(tx,
  tenantId)` (tenant del JWT) como PRIMERA operación + `SELECT … FOR UPDATE` sobre la RESERVA por `{id}`
  + reevaluar `resolverArchivadoAutomatico` y `fianzaResuelta` bajo el lock + update + AUDIT_LOG origen
  Gestor. Gemelo delgado de `ArchivadoUoWPrismaAdapter` (US-037), scoped a una RESERVA del tenant del JWT.
  `ArchivarReservaManualController` (`POST /reservas/{id}/archivar`, `@Roles('gestor')` + `RolesGuard`,
  `@HttpCode(200)`, `@ApiTags('Reservas')`), calcado de `FinalizarEventoController` (US-034). Registrado
  en `ReservasModule`.
- **AUDIT_LOG**: vía el mismo puerto/mecanismo de auditoría; origen Gestor (D-5). No se duplica.

## D-8. Sin email, sin cron, sin barrido, sin migración (out-of-scope)

US-038 NO envía email (`§Email relacionado: ninguno`), NO toca el cron ni el barrido de US-037
(`/cron/barrido-completadas`), NO añade migración (usa campos existentes), NO emite alerta interna (el
bloqueo es error HTTP síncrono), NO construye el módulo Histórico (UC-32). El único efecto observable
tras el éxito es que la RESERVA pasa a `reserva_completada` (sale del pipeline activo de US-049, entra en
Histórico).

## Riesgos / Trade-offs

- **Duplicación aparente de la UoW** (D-1): mitigada compartiendo las guardas puras; extraer un helper
  común obligaría a tocar US-037 ya archivado. Decisión de gate.
- **Dependencia de la ficha de reserva en frontend** (D-2): el alcance de la UI depende de si la ficha ya
  existe; condiciona el step-N+3 (E2E). Decisión de gate.
- **Código HTTP del bloqueo de fianza** (D-3): 409 vs. 422; afecta al contrato y al mensaje del frontend.
  Decisión de gate.
- **Race con el cron de US-037**: ya blindada por su §D-7 al reutilizar la misma guarda bajo el lock; el
  riesgo real es que US-038 se desvíe del patrón (mitigado por TDD de concurrencia RC-1).

## Pendiente / fuera de alcance

- **Archivado automático T+7d** → US-037 (ya archivado); US-038 solo hereda la coordinación de la race.
- **Módulo Histórico (UC-32)** y su UI de consulta/filtrado → otra US.
- **Superficie de notificaciones del gestor** → US-044; US-038 NO emite alerta.
- **Email** → ninguno.
- **E2E de navegador**: aplica solo si el gate elige construir UI (D-2 = 2.B/2.C); si no, step-N+3 es N/A
  justificado (backend puro + contrato).

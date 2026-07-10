# Change: us-038-archivado-manual-reserva-completada

## Why

Una RESERVA en `post_evento` con todos los trámites resueltos hoy solo puede cerrarse esperando al
**archivado automático a T+7d** (US-037, actor Sistema). US-038 (UC-28, **flujo alternativo manual**,
actor **Gestor**) da al gestor una **acción manual** para transicionar `post_evento →
reserva_completada` (estado **terminal e inmutable**) **desde la ficha de la reserva**, sin esperar 7
días, cuando la fianza ya está resuelta. Así el gestor **limpia activamente** el pipeline de reservas
activas (dolor **D5**) y el cierre queda registrado con **autoría explícita del gestor** (dolor
**D1**). (Fuente: `US-038 §Historia`, `§Contexto de Negocio`, `§Impacto de Negocio`; `use-cases.md`
UC-28 flujo alternativo manual; `CLAUDE.md §Máquina de estados`.)

- Es la **acción gemela MANUAL** de US-037: **misma transición** `post_evento → reserva_completada` y
  **misma guarda de fianza resuelta**, pero disparada por el **Gestor** vía un **endpoint de usuario
  dedicado** (JWT + rol gestor, RLS del tenant del JWT), **NO por el cron**. US-037 dejó el mecanismo
  reutilizable listo en dominio: la guarda de origen declarativa `resolverArchivadoAutomatico`
  (`post_evento → reserva_completada`, terminal, en `apps/api/src/reservas/domain/maquina-estados.ts`)
  y la guarda de fianza pura `fianzaResuelta`. US-038 **reutiliza AMBAS** (no duplica lógica), tal como
  la nota de coordinación de US-037 §D-7 pidió ("US-038 DEBE usar la misma guarda + `SELECT … FOR
  UPDATE` para heredar la garantía de concurrencia").
- **Endpoint de USUARIO dedicado NUEVO** `POST /reservas/{id}/archivar` (actor Gestor), calcado del
  patrón de `POST /reservas/{id}/finalizar-evento` (US-034): `@Roles('gestor')` + `RolesGuard` sobre el
  `JwtAuthGuard` global, `tenant_id`/`usuario_id` **siempre del JWT** (`@CurrentUser`), nunca del
  path/body. **NO** es un barrido: opera sobre **una única** RESERVA identificada por `{id}` del path.
  **PROHIBIDO** reutilizar el barrido `POST /cron/barrido-completadas` de US-037 (ese es del cron con
  `X-Cron-Token`; esta es acción de usuario con JWT).
- La transición reutiliza la **máquina de estados declarativa** ya existente (`maquina-estados.ts`):
  US-038 **NO añade ninguna arista nueva** a la tabla `MAPA_ARCHIVADO_AUTOMATICO` ni al tipo
  `EstadoReserva`; consume `resolverArchivadoAutomatico` (que devuelve `null` para todo origen distinto
  de `post_evento`, incluido `reserva_completada` — base de la idempotencia). `reserva_completada` ya es
  terminal (sin arista de salida).
- La **guarda de fianza resuelta** es **idéntica a US-037** (consume la resolución de US-036): fianza
  resuelta si `fianza_status ∈ {devuelta, retenida_parcial}` **O** `fianza_eur ≤ 0` **O** `fianza_eur IS
  NULL`. `retenida_parcial` con `fianza_devuelta_eur = 0` (retención 100%) es un estado resuelto válido.
  Si NO se cumple (p. ej. `fianza_status ∈ {cobrada, recibo_enviado, pendiente}` con `fianza_eur > 0`) →
  el sistema **bloquea el archivado** y devuelve el motivo específico (FA-01/FA-02) sin transicionar.
- **Diferencia clave con US-037**: US-038 **NO** aplica el filtro de antigüedad **T+7d** (`fechaPostEvento
  ≤ hoy − 7`). El gestor puede archivar en cualquier momento tras entrar en `post_evento` (el happy path
  de la US lo ejemplifica con 3 días). El único filtro de estado es `estado = post_evento`. Tampoco emite
  la **alerta interna** FA-01 de US-037 (esa es del barrido periódico): aquí el bloqueo es una **respuesta
  de error síncrona** al gestor.

## What Changes

- **Extiende la capability existente `consultas`** (NO crea una nueva): `consultas` es dueña del ciclo de
  vida y las transiciones del agregado RESERVA (US-034, US-031 y US-037 añadieron sus transiciones a
  `consultas`). Se añade el **archivado MANUAL por el gestor** de `post_evento → reserva_completada` como
  acción de usuario. No se crea capability nueva ni se toca `pipeline` (lectura pura), `facturacion`,
  `ficha-operativa`, `foundation`, `calendario`, `comunicaciones`, `confirmacion` ni `app-shell`.
  (`spec-delta` en `specs/consultas/spec.md`.)
- **Endpoint de usuario DEDICADO NUEVO** `POST /reservas/{id}/archivar` (actor **Gestor**): `@Public()`
  NO — usa el `JwtAuthGuard` GLOBAL (401 sin token) + `RolesGuard` + `@Roles('gestor')` (403 sin rol),
  `@HttpCode(200)`, `@ApiTags('Reservas')`. Traduce el contrato HTTP ↔ comando de aplicación; el
  `tenant_id` y el `usuario_id` **derivan SIEMPRE del JWT**, nunca del path/body. El `{id}` del path es
  la RESERVA en `post_evento` que el gestor archiva. Sin cuerpo de negocio (objeto vacío opcional, como
  `FinalizarEventoRequest` de US-034, dejando hueco a una confirmación futura sin romper el contrato).
- **Caso de uso de aplicación NUEVO** `ArchivarReservaManualUseCase.ejecutar({ tenantId, usuarioId,
  reservaId })` (hexagonal, depende solo de puertos): abre **una** transacción atómica bajo el contexto
  RLS del tenant del JWT (`fijarTenant(tx, tenantId)` como PRIMERA operación), toma `SELECT … FOR UPDATE`
  sobre la fila RESERVA, **re-evalúa bajo el lock** la guarda de origen (`resolverArchivadoAutomatico`) y
  la guarda de fianza (`fianzaResuelta`), y:
  - si origen válido (`post_evento`) **Y** fianza resuelta → transiciona `estado = reserva_completada` +
    `AUDIT_LOG` con `accion = 'transicion'`, `entidad = 'RESERVA'`, `datos_anteriores = {estado:
    post_evento}`, `datos_nuevos = {estado: reserva_completada}`, **origen Gestor** (`usuario_id = <id del
    JWT>`, NO Sistema — diferencia clave con US-037, que audita `usuario_id` nulo);
  - si la fianza **no está resuelta** (guarda de fianza `false` con `fianza_eur > 0`) → **NO** transiciona
    y devuelve un error de dominio `FianzaNoResueltaError` (→ HTTP 409/422, ver §Impact) con el mensaje de
    FA-01/FA-02: "No se puede archivar la reserva: la fianza está pendiente de resolución. Registra la
    devolución o retención de fianza antes de archivar."; `RESERVA.estado` permanece `post_evento`;
  - si el origen **no es válido** (`estado ≠ post_evento`, p. ej. ya `reserva_completada` por un pase del
    cron US-037 o por otra acción, o cualquier otro estado) → `resolverArchivadoAutomatico` devuelve
    `null` → error de dominio `TransicionNoPermitidaError` (→ HTTP 409, `code:
    'transicion_no_permitida'`), sin mutar ni auditar. Esto cubre la **idempotencia** y la
    **concurrencia con el cron** (RC).
- **Reutilización de dominio (regla dura anti-duplicación)**: NO se crea una guarda nueva. Se importan y
  usan `resolverArchivadoAutomatico` y `fianzaResuelta` de `maquina-estados.ts` (introducidas por US-037).
  El use-case y su UoW son **el gemelo manual** de `ArchivadoUoWPrismaAdapter` (US-037): mismo
  `SELECT … FOR UPDATE` + reevaluación de ambas guardas bajo el lock; la ÚNICA diferencia funcional es
  (a) actúa sobre **una** RESERVA (por `{id}`, no cross-tenant), (b) audita **origen Gestor** (con
  `usuario_id`, sin `causa: 'T+7d'`), (c) **no** aplica el filtro T+7d, y (d) el "no resuelto/no
  candidato" se traduce en **error HTTP síncrono**, no en alerta interna. **Decisión de diseño abierta
  para el gate (design §D-1)**: ¿extraer el patrón compartido a un helper/servicio de dominio-aplicación
  reutilizado por ambos (US-037 barrido y US-038 manual), o mantener dos UoW gemelas que comparten solo
  las guardas de dominio puras? Recomendación del autor: **compartir solo las guardas puras de dominio**
  (ya compartidas) y **no** forzar una abstracción prematura de la UoW, porque difieren en tenant-scope,
  autoría de auditoría y manejo del "no aplica" (síncrono vs. alerta). Ver design.
- **Concurrencia cron (US-037) vs archivado manual (US-038)**: si el barrido y el gestor intentan
  transicionar la misma RESERVA `post_evento → reserva_completada` a la vez, **exactamente una** UPDATE
  gana; la segunda, bajo el `SELECT … FOR UPDATE`, re-lee `estado` y `resolverArchivadoAutomatico` le
  devuelve `null` (0 filas / no-op para el cron; error `transicion_no_permitida` → 409 para el gestor).
  Nunca hay doble auditoría ni estado inconsistente. Patrón "leer-verificar-actualizar" en una única
  transacción sobre la fila RESERVA; **sin locks distribuidos** (Redis/Redlock prohibidos, hook
  `no-distributed-lock`). US-037 §D-7 **ya blindó** esta race con la guarda re-evaluada bajo el lock; US-038
  la hereda por reutilizar la misma guarda.
- **Frontend (ficha de reserva)**: botón/acción "Archivar reserva" en la ficha (visible solo cuando
  `estado = post_evento`), con **diálogo de confirmación**; al éxito, mensaje "Reserva [código] archivada
  correctamente. Ya está disponible en el Histórico." y la RESERVA sale del pipeline activo (US-049 ya
  excluye `reserva_completada`). Cuando `fianza_status = cobrada` (o fianza no resuelta con importe), el
  botón **puede mostrarse deshabilitado** con la razón; el backend valida igualmente (defensa en
  profundidad). **Decisión de diseño abierta para el gate (design §D-2)**: alcance exacto de la UI
  (¿construir el botón + diálogo + toast en esta US, o solo el backend + contrato y diferir la UI?), y si
  US-038 asume la existencia de la ficha de reserva o coordina con la US que la construye. Responsive
  obligatorio (regla dura del proyecto) si se construye UI.

## Impact

- Specs afectadas: **se extiende `consultas`** con `ADDED Requirements` para el **archivado manual por el
  gestor** (transición atómica con guarda de fianza resuelta idéntica a US-037, auditoría origen Gestor
  con `usuario_id`, bloqueo con mensaje específico si la fianza no está resuelta, idempotencia y
  concurrencia cron↔manual, solo desde `post_evento`, terminalidad de `reserva_completada`). NO se crea
  capability nueva; NO se modifican otras capabilities. (`spec-delta` en `specs/consultas/spec.md`.)
- Datos: **sin migración de esquema**. Se usan campos ya existentes: `estado`, `fianza_status` (enum
  `FianzaStatus`), `fianza_eur` (`Decimal?`), `fianza_devuelta_eur` (`Decimal?`), y `AUDIT_LOG`. El
  estado `reserva_completada` y el campo `fecha_post_evento` (poblado por US-034 desde US-037) ya existen.
  US-038 **NO** lee `fecha_post_evento` para decidir (no hay filtro T+7d). La auditoría del archivado
  manual **SÍ** lleva `usuario_id` (Gestor), a diferencia de US-037 (Sistema, `usuario_id` nulo).
- Contrato OpenAPI: **endpoint de usuario DEDICADO NUEVO** `POST /reservas/{id}/archivar` (`operationId:
  archivarReservaManual`; `ApiBearerAuth`; 200 con la RESERVA archivada — patrón `allOf(Reserva)` o
  `ReservaDetalle` como `finalizarEvento`; **409** `code: 'transicion_no_permitida'` si `estado ≠
  post_evento` — calcado de `FinalizarEventoConflictError`; **409 o 422** `code: 'fianza_no_resuelta'` si
  la fianza no está resuelta; **404** si la RESERVA no existe / otro tenant bajo RLS; **401** sin JWT;
  **403** sin rol gestor). El **código HTTP exacto del bloqueo de fianza** (409 conflicto de estado del
  agregado vs. 422 precondición de negocio incumplida) es **decisión de diseño abierta para el gate**
  (design §D-3). El `contract-engineer` lo materializa TRAS el gate; luego se regenera el SDK del
  frontend (nunca a mano, hook `protect-generated-client`).
- Multi-tenancy/RLS: acción de **usuario** (Gestor); `tenant_id` y `usuario_id` **del JWT**, RLS del
  tenant del JWT (`SET LOCAL app.tenant_id` como PRIMERA operación de la transacción). A diferencia de
  US-037, **NO** es cross-tenant: opera solo sobre la RESERVA del tenant del gestor; una RESERVA de otro
  tenant es invisible bajo RLS → 404.
- Concurrencia: **TDD primero** en (a) la coordinación cron US-037 ↔ manual US-038 sobre la misma RESERVA
  (exactamente una transición gana; la 2.ª observa `estado ≠ post_evento` bajo el lock → error/no-op sin
  doble auditoría), (b) doble clic del gestor (idempotencia: la 2.ª archivación → 409
  `transicion_no_permitida`), (c) el bloqueo por fianza no resuelta (sin mutación ni auditoría). La
  serialización la da PostgreSQL sobre la fila RESERVA (`SELECT … FOR UPDATE`); no hay `FECHA_BLOQUEADA`
  ni cola implicados. Recordatorio de entorno: los tests de integración/concurrencia se lanzan desde la
  sesión principal (con Postgres real), no desde subagentes (memoria del proyecto). Se vigila el flaky
  conocido de US-004 (`40P01`) al leer la suite global, ajeno a este change.
- Trazabilidad: **US-038**, **UC-28** (flujo alternativo manual, pasos 1–5), dolores **D5**/**D1**.
  Reutiliza US-034 (`post_evento` como origen; `finalizar-evento` como plantilla del endpoint de usuario),
  US-036 (fianza resuelta: `devuelta`/`retenida_parcial`) y **US-037** (guarda de origen
  `resolverArchivadoAutomatico` + guarda de fianza `fianzaResuelta` + patrón `SELECT … FOR UPDATE`).
  Coordina con US-037 (archivado automático — misma transición, race condition ya blindada por su §D-7).
- **Fuera de alcance (out-of-scope explícito)**:
  - El **archivado automático** en T+7d (barrido de Sistema) → **US-037** (ya archivado). US-038 solo hace
    la variante manual y hereda la coordinación de la race condition.
  - La **construcción del módulo Histórico** (UC-32) y su UI de consulta/filtrado: US-038 solo deja la
    RESERVA en `reserva_completada`, estado que la hace visible/filtrable en Histórico.
  - La **superficie de notificaciones/alertas del gestor** (US-044): US-038 NO emite alerta interna (el
    bloqueo es una respuesta de error síncrona al gestor, no una alerta diferida).
  - **Ningún email** al cliente ni al gestor (`US-038 §Email relacionado`: ninguno).
  - Cualquier cambio en el **cron de US-037** (`POST /cron/barrido-completadas`): US-038 no lo toca.

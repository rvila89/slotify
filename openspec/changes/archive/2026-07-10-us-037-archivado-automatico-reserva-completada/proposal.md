# Change: us-037-archivado-automatico-reserva-completada

## Why

Una RESERVA que ha finalizado su evento y lleva en `post_evento` **7 días naturales** sin
acciones pendientes (fianza resuelta o sin fianza) debe **archivarse automáticamente**:
transicionar `post_evento → reserva_completada` (estado terminal, inmutable) sin que el gestor
tenga que actuar, y quedar visible y filtrable en el módulo Histórico. Hoy ese cierre
administrativo dependería de una acción manual (US-038) que **se olvidaría**, dejando
expedientes acumulados en `post_evento` y el histórico desactualizado (dolores **D5** —histórico
centralizado y consultable siempre al día—, **D9** —automatización del cierre administrativo,
elimina la tarea repetitiva—, **D1** —estado terminal registrado con trazabilidad de Sistema).
**US-037 (UC-28, flujo básico automático, actor Sistema)** es el mecanismo automático que, en
T+7d, evalúa la guarda de fianza y archiva la RESERVA cuando (y solo cuando) la fianza está
resuelta. (Fuente: `US-037 §Historia`, `§Contexto de Negocio`, `§Impacto de Negocio`;
`use-cases.md` UC-28; `CLAUDE.md §Máquina de estados`, `§Jobs asíncronos`.)

- US-037 se apoya en el **patrón obligatorio "estado en fila + barrido periódico"** (`CLAUDE.md
  §Jobs asíncronos`; `architecture.md §2.5`; skill `async-jobs`): un cron scheduler invoca un
  **endpoint interno protegido** (`X-Cron-Token`) idempotente que barre las RESERVA elegibles y
  transiciona las que cumplen la guarda de fianza. El "estado en fila" es `RESERVA.estado =
  post_evento` + el momento de entrada a `post_evento` (comparado con hoy − 7 días) + la guarda
  de fianza (`fianza_status`/`fianza_eur`). **PROHIBIDO** Lambda/EventBridge ni timers exactos.
  Mismo estilo que **US-012** (barrido de expiración por TTL, `POST /cron/barrido-expiracion`),
  **US-026** (barrido de cierre de fichas en T-1d) y **US-031** (inicio automático de evento en
  T-0, `POST /cron/barrido-eventos`), ya archivados: endpoint protegido idempotente que devuelve
  un resumen del barrido, con fallo aislado por RESERVA y contexto RLS por tenant.
- **Endpoint/controller DEDICADO NUEVO** `POST /cron/barrido-completadas` (regla dura del
  proyecto): gemelo de `POST /cron/barrido-expiracion` (US-012) y `POST /cron/barrido-eventos`
  (US-031), en el módulo `reservas`, `@Public()` + `@UseGuards(CronTokenGuard)` con `X-Cron-Token`,
  `@ApiTags('Cron')`, que invoca un servicio de aplicación `ejecutar()` y devuelve un resumen JSON
  (`{ candidatas, archivadas, fianzaPendiente, fallos }`). **PROHIBIDO** reutilizar `/cron/barrido`
  ni el dispatch por `?tarea=`: ese patrón de dispatch **nunca se implementó** en este repo
  (`POST /cron/barrido` lo sirve un único controller que ignora `tarea`); añadir un segundo
  controller sobre esa ruta colisiona y provoca regresión silenciosa. (Memoria del proyecto:
  "Cron ?tarea= dispatch es ficticio"; resolución de gate de US-031 §D-2.)
- El actor es el **Sistema**, no un usuario: US-037 **no aporta pantalla ni endpoint de usuario
  nuevos**. El único efecto observable en UI es que, tras el barrido, la RESERVA deja de aparecer
  en el pipeline activo (`GET /reservas` excluye `reserva_completada`, US-049) y pasa a ser
  consultable/filtrable en el módulo Histórico (UC-32; su construcción es de otra US). US-037
  solo deja la RESERVA en `reserva_completada`, estado que la habilita en Histórico.
- La transición reutiliza la **máquina de estados declarativa** del agregado RESERVA
  (`apps/api/src/reservas/domain/maquina-estados.ts`), añadiendo la transición
  `post_evento → reserva_completada` como **estructura de datos** (misma forma que
  `MAPA_FINALIZACION_EVENTO` de US-034 y `MAPA_INICIO_EVENTO` de US-031), con su **guarda de
  fianza** como función de dominio pura. `reserva_completada` ya está en `EstadoReserva` (tipo y
  enum Prisma) y es **terminal**: no se añade arista de salida.
- La **guarda de fianza resuelta** consume lo que dejó **US-036** (registro de devolución/
  retención): fianza resuelta si `fianza_status ∈ {devuelta, retenida_parcial}` **O** `fianza_eur
  ≤ 0` **O** `fianza_eur IS NULL`. `retenida_parcial` con `fianza_devuelta_eur = 0` (retención
  100%) es un estado resuelto válido. (`US-037 §Reglas de negocio`, `§Dependencias`.)

## What Changes

- **Extiende la capability existente `consultas`** (NO crea una nueva): `consultas` es dueña del
  ciclo de vida y las transiciones del agregado RESERVA (así lo declara la spec viva de
  `pipeline`: "`consultas` sigue siendo dueña del ciclo de vida y las transiciones del agregado
  RESERVA"; US-034 y US-031 añadieron sus transiciones a `consultas`). Se añade la **transición
  automática a `reserva_completada` en T+7d** como efecto del barrido periódico (archivado
  automático). No se crea capability nueva ni se toca `pipeline` (lectura pura), `facturacion`,
  `ficha-operativa`, `foundation`, `calendario`, `comunicaciones`, `confirmacion` ni `app-shell`.
  (`spec-delta` en `specs/consultas/spec.md`.)
- **Barrido interno protegido de archivado**, autenticado **service-to-service** con la cabecera
  `X-Cron-Token` (nunca JWT de usuario; `CRON_TOKEN` ya en `env.validation.ts` y `CronTokenGuard`
  reutilizable de US-012/US-026/US-031). Idempotente: re-ejecutarlo no re-transiciona reservas ya
  en `reserva_completada` ni duplica `AUDIT_LOG`. Devuelve un **resumen** del barrido (candidatas
  evaluadas, reservas archivadas, candidatas con fianza pendiente, fallos aislados).
  **Endpoint DEDICADO NUEVO** `POST /cron/barrido-completadas` (ver §Why; regla dura).
- **Cron scheduler** (`@nestjs/schedule`) que invoca el endpoint **una vez al día** con el token.
  El scheduler no ejecuta lógica de negocio: solo dispara el endpoint (invocable manualmente y
  testeable por HTTP). El filtro por antigüedad (T+7d) tolera que el pase corra a cualquier hora.
- **Selección de candidatas** (filtro estricto): `RESERVA.estado = 'post_evento'` **AND** el
  momento de entrada a `post_evento` es ≥ 7 días naturales antes de hoy. El filtro por estado
  garantiza la **idempotencia** (una RESERVA ya en `reserva_completada` no es candidata). El
  **cómo se determina el momento de entrada a `post_evento`** es una **decisión de diseño abierta
  para el gate humano** (design.md §D-2): hoy `RESERVA.fecha_actualizacion` es `@updatedAt` y NO
  marca fielmente la entrada a `post_evento` (cambia en cualquier update de la fila). Opciones:
  (A) nuevo campo `fechaPostEvento` seteado en la transición de US-034; (B) derivar de
  `AUDIT_LOG`; (C) usar `fechaActualizacion` (frágil). **Recomendación del autor: Opción A**
  (migración Prisma). No se implementa nada hasta el gate.
- **Guarda de fianza resuelta en una única lectura de la fila**, dentro de la transacción de cada
  RESERVA: `fianza_status ∈ {devuelta, retenida_parcial}` **O** `fianza_eur ≤ 0` **O** `fianza_eur
  IS NULL`. Modelada como **guarda de dominio pura** (no `if` dispersos), que además indica si la
  fianza está resuelta o pendiente para poder emitir la alerta (FA-01).
- **Acción por candidata con la guarda de fianza satisfecha**, en una **transacción atómica** bajo
  el contexto RLS del tenant: re-evaluar la guarda de origen (`post_evento`) y la de fianza bajo
  `SELECT … FOR UPDATE` de la fila RESERVA, transicionar `RESERVA.estado: post_evento →
  reserva_completada`, y registrar en `AUDIT_LOG` una entrada con `accion = 'transicion'`, `entidad
  = 'RESERVA'`, `datos_anteriores = {estado: post_evento}`, `datos_nuevos = {estado:
  reserva_completada, causa: 'T+7d'}`, origen **Sistema** (`usuario_id` nulo).
- **Fianza no resuelta en T+7d → NO archiva + alerta interna al gestor (FA-01)**: si en T+7d la
  fianza no está resuelta (p. ej. `fianza_status = cobrada` con `fianza_eur > 0`), el barrido **no**
  transiciona (la RESERVA permanece en `post_evento`) y emite una **alerta interna al gestor** ("⚠️
  La reserva [código] lleva más de 7 días en post_evento con fianza pendiente de resolución.
  Registra la devolución o retención (US-036) para poder archivarla."). La alerta **no se duplica**
  en cada barrido mientras el estado no cambie. El **mecanismo de la alerta y su anti-duplicación**
  son **decisiones de diseño abiertas para el gate humano** (design.md §D-3 y §D-4): ¿canal in-app,
  flag en la reserva, entrada de auditoría de tipo alerta, tabla de notificaciones? US-037 dice
  "ningún email al cliente/gestor" en el happy path, pero FA-01 pide esta alerta interna.
- **Idempotencia (FA-02)**: una RESERVA ya en `reserva_completada` (por un pase anterior o por el
  archivado manual de US-038) **no** es candidata (el filtro `estado = 'post_evento'` la excluye);
  leer `estado = reserva_completada` es suficiente para saltarla, sin efecto ni registro en
  `AUDIT_LOG`. N ejecuciones del barrido sobre la misma RESERVA = **1 sola** transición y **1 sola**
  entrada en `AUDIT_LOG`.
- **Concurrencia cron (US-037) vs archivado manual (US-038)**: si ambos intentan transicionar la
  misma RESERVA `post_evento → reserva_completada` a la vez, **exactamente una** UPDATE gana; la
  segunda observa bajo el lock que el estado ya no es `post_evento` (0 filas afectadas) y termina
  como no-op sin error, sin doble auditoría ni estado inconsistente. Patrón "leer-verificar-
  actualizar" en una única transacción (`SELECT … FOR UPDATE`), sin locks distribuidos.
- **Procesa todas las elegibles en el mismo pase** con **fallo aislado por RESERVA**: el fallo de
  una transición no aborta ni revierte las demás; el resumen registra el fallo aislado. Mismo
  aislamiento que el lote de US-012/US-026/US-031.

## Impact

- Specs afectadas: **se extiende `consultas`** con `ADDED Requirements` para la transición
  automática a `reserva_completada` en T+7d (barrido periódico protegido, guarda de fianza
  resuelta, idempotencia, concurrencia cron↔US-038, alerta interna por fianza pendiente con
  anti-duplicación, auditoría de Sistema, selección por antigüedad en `post_evento`). NO se crea
  capability nueva; NO se modifican `pipeline`, `facturacion`, `ficha-operativa`, `foundation`,
  `calendario`, `comunicaciones`, `confirmacion` ni `app-shell`. (`spec-delta` en
  `specs/consultas/spec.md`.)
- Datos: **posible migración de esquema NUEVA sujeta al gate** — si se aprueba la **Opción A** de
  §D-2 (recomendada), se añade `RESERVA.fechaPostEvento` (`DateTime?`, `@map("fecha_post_evento")`)
  y **US-034 debe poblarlo en la transición a `post_evento`** (nota de coordinación, design §D-2).
  Si el gate elige B o C, no hay migración. Se usan campos ya existentes: `estado`,
  `fianza_status` (enum `FianzaStatus`: `pendiente`/`recibo_enviado`/`cobrada`/`devuelta`/
  `retenida_parcial`), `fianza_eur` (`Decimal?`), `fianza_devuelta_eur` (`Decimal?`),
  `fianza_devuelta_fecha`, y `AUDIT_LOG`. El estado `reserva_completada` ya existe en el enum de
  estados (`maquina-estados.ts`, `EstadoReserva`; enum Prisma; contrato `EstadoReserva`).
- Contrato OpenAPI: **endpoint DEDICADO NUEVO** `POST /cron/barrido-completadas` (`operationId:
  barridoCompletadas`; seguridad `cronToken` `X-Cron-Token`; 200 con `BarridoCompletadasResponse`
  = `{ candidatas, archivadas, fianzaPendiente, fallos }`, todos `required`; 401 sin token/inválido),
  calcado de `POST /cron/barrido-eventos` (US-031) y `POST /cron/barrido-expiracion` (US-012). El
  `contract-engineer` lo materializa TRAS el gate. **No hay endpoint ni SDK de usuario nuevos**: la
  UI de pipeline (US-049/US-050) ya excluye `reserva_completada`; el Histórico (UC-32) es otra US.
- Infra transversal: reutiliza `@nestjs/schedule` (activado en US-012) para el `@Cron` diario;
  consume `CRON_TOKEN` (ya declarado) y `CronTokenGuard` (US-012/US-026/US-031). Documentar el
  barrido de archivado en `architecture.md §2.5` junto a los de expiración (US-012), cierre de
  fichas (US-026) e inicio de eventos (US-031).
- Multi-tenancy/RLS: el barrido es un proceso de **Sistema**; opera **cross-tenant** (una pasada
  evalúa candidatas de todos los tenants) pero **cada** transición se ejecuta bajo el **contexto
  RLS del tenant** de la RESERVA (`SET LOCAL app.tenant_id` como PRIMERA operación de la
  transacción), como en US-012/US-026/US-031. El `tenant_id` proviene de la fila candidata, nunca
  de input externo.
- Concurrencia: **TDD primero** en (a) la idempotencia (doble pase del cron, FA-02), (b) la
  coordinación cron vs US-038 (archivado manual) sobre la misma RESERVA (exactamente una UPDATE
  gana, 0 filas la segunda), (c) el aislamiento de fallos por RESERVA y (d) la anti-duplicación de
  la alerta de fianza pendiente. La serialización la da PostgreSQL sobre la fila RESERVA (`SELECT …
  FOR UPDATE`); no hay `FECHA_BLOQUEADA` ni cola implicados. Se vigila el flaky conocido de US-004
  (`40P01`) al leer la suite global, ajeno a este change.
- Trazabilidad: **US-037**, **UC-28** (flujo básico, pasos 1–5), **UC-32** (Histórico,
  visibilidad/filtrabilidad), dolores **D5**/**D9**/**D1**; automatización **A12** (T+7d
  post-evento → archivo). Reutiliza US-034 (`post_evento`), US-036 (fianza resuelta:
  `devuelta`/`retenida_parcial`) y el patrón de cron de US-012/US-026/US-031. Coordina con US-038
  (archivado manual — misma transición, race condition) y US-044 (superficie de notificaciones).
- **Fuera de alcance (out-of-scope explícito)**:
  - El **archivado manual** de la RESERVA por el gestor → **US-038** (misma transición, disparada
    por el usuario; US-037 solo hace la automática y coordina la race condition).
  - La **propuesta proactiva de cierre al gestor en T+5d** (spec §8 dentro de `post_evento`):
    marcada `📐 Solo diseñado`, **NO implementada** en este change (`US-037 §Notas de alcance`).
  - La **construcción del módulo Histórico** (UC-32) y su UI de consulta/filtrado: US-037 solo deja
    la RESERVA en `reserva_completada`, estado que la hace visible/filtrable en Histórico.
  - La **indexación full-text técnica** (índice Postgres/TSVECTOR): la "indexación" de la US es
    **visibilidad/filtrabilidad** en Histórico, no un índice técnico obligatorio; queda fuera de
    alcance salvo que ya exista (`US-037 §Notas de alcance`; design §D-5).
  - La **superficie de notificaciones/alertas del gestor** (dashboard de notificaciones, US-044):
    US-037 **produce** la alerta de FA-01 pero su **materialización/entrega** (canal, UI) es
    decisión abierta del gate (design §D-3) y no construye una superficie de notificaciones nueva.
  - **Ningún email** al cliente ni al gestor en el happy path (`US-037 §Email relacionado`).

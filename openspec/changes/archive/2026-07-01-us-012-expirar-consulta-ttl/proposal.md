# Change: us-012-expirar-consulta-ttl

## Why

Una fecha que queda **bloqueada indefinidamente** sin justificación es el peor de los
riesgos comerciales: la fecha desaparece del mercado (dolor **D4**), el pipeline se
llena de **leads zombi** que nadie resuelve (dolor **D1**) y las oportunidades de la
**cola de espera** se pierden porque nadie promueve al siguiente (dolor **D13**).
US-004/005/006/007/008 crean RESERVA con `ttl_expiracion`, y US-041 aportó la
operación de dominio `liberarFecha()` (elimina el bloqueo + dispara el seam de cola),
pero **nadie invoca ese barrido periódicamente ni transiciona la RESERVA a su estado
terminal**. US-041 dejó ese wiring **explícitamente diferido a US-012**
(`us-041 design.md §D-9`) y aclaró que `liberarFecha()` **no muta** la RESERVA (§3.7):
la transición de estado es responsabilidad del flujo invocante. **US-012 (UC-09)** es
ese flujo. (`US-012 §Historia`, `§Contexto`; `use-cases.md` UC-09; `er-diagram.md §3.6`,
`§5.3`; `us-041 design.md §D-9`.)

- US-012 cierra el ciclo del **patrón obligatorio "estado en fila + barrido periódico"**
  (`CLAUDE.md §Jobs asíncronos`; skill `async-jobs`): un cron que invoca un **endpoint
  interno protegido** (`X-Cron-Token`) idempotente, el cual barre las RESERVA con
  `ttl_expiracion < now()` en los estados candidatos y, por cada una y en transacción,
  **transiciona al estado terminal por TTL**, **libera la fecha** (`liberarFecha()`,
  US-041) y **dispara la promoción de cola** (seam US-018). PROHIBIDO Lambda/EventBridge
  ni timers exactos.
- El actor es el **Sistema**, no un usuario: US-012 no aporta pantalla propia; su único
  efecto observable en UI es que la fecha liberada vuelve a estar disponible en el
  Calendario (US-039) y una alerta interna al gestor. (`US-012 §Historia`, `§Email
  relacionado`.)

## What Changes

- **Extiende la capability existente `consultas`** (NO crea una nueva): añade el
  **flujo de expiración por TTL agotado** como efecto de la automatización A4/A5/A21/A21b,
  modelado sobre el agregado RESERVA y su máquina de estados declarativa. (`US-012
  §Reglas de negocio`; `CLAUDE.md §Máquina de estados`.)
- **Endpoint interno protegido `POST /cron/barrido-expiracion`** (o nombre equivalente
  fijado en el contrato), autenticado **service-to-service** con cabecera `X-Cron-Token`
  (nunca JWT de usuario; `CRON_TOKEN` ya está en `env.validation.ts`). Idempotente:
  re-ejecutarlo no produce transiciones ni auditorías duplicadas. Devuelve un **resumen
  del barrido** (nº de candidatas, expiradas, promociones disparadas, fallos aislados).
  (`US-012 §Trigger`, `§Reglas de Validación`; skill `async-jobs`.)
- **Cron scheduler** (`@nestjs/schedule`) que invoca el endpoint periódicamente con el
  token; el wiring que US-041 §D-9 difirió. El barrido reutiliza el caso de uso de
  **liberación en lote** `LiberarFechasEnLoteService` (US-041) con fallo aislado por
  fecha, envolviéndolo con la **transición de estado** de cada RESERVA.
- **Selección de candidatas**: `RESERVA.ttl_expiracion < now()` **AND** (`sub_estado ∈
  {'2b','2c','2v'}` **OR** `estado = 'pre_reserva'`). Comparación de **instantes**
  (`timestamptz`), nunca de fechas formateadas (evita el off-by-one de TZ conocido en
  `formatearFechaHora`; deuda técnica ajena a este change). (`US-012 §Reglas de negocio`.)
- **Mapa de transiciones terminales** (estructura declarativa, no `if` dispersos):
  `2b → 2x` (A4), `2c → 2x` (A4), `2v → 2x` (A21), `pre_reserva → reserva_cancelada`
  (sub_estado = NULL, A5). `2x` y `reserva_cancelada` son **terminales inmutables**.
  (`US-012 §Reglas de negocio`, `§Reglas de Validación`.)
- **Atomicidad por RESERVA**: por cada candidata, transición de estado + eliminación de
  `FECHA_BLOQUEADA` (vía `liberarFecha()`) + (si aplica) disparo de promoción de cola se
  ejecutan de forma **all-or-nothing** dentro de una transacción serializada con
  `SELECT … FOR UPDATE`; el fallo de una candidata **no** aborta el resto del lote.
- **Promoción de cola vía seam US-018**: si la RESERVA expirada (típicamente en `2.b`,
  posiblemente `2.v` con cola heredada) tenía cola activa (`RESERVA` en `2.d` apuntando a
  ella), se dispara `PromocionColaPort.promoverPrimeroEnCola()` **exactamente una vez**
  (el mismo seam de US-041). US-012 **no** reimplementa la reordenación FIFO ni el
  re-bloqueo de la promovida (mecánica A15/UC-12): eso es US-018; hasta entonces el stub
  no-op deja la cola intacta en `2.d` (deuda documentada). `2.c` y `pre_reserva` no tienen
  cola posible. (`US-012 §Reglas de negocio`, `§Notas`; `us-041 design.md §D-2`.)
- **Idempotencia**: una RESERVA ya en estado terminal **no** es candidata (la guarda de
  origen la excluye); el `DELETE` de `FECHA_BLOQUEADA` con 0 filas es éxito silencioso
  (US-041); N ejecuciones del cron sobre la misma RESERVA = **1 sola transición** en
  `AUDIT_LOG`. (`US-012 §FA Idempotencia`, `§RC-1`.)
- **AUDIT_LOG**: cada expiración registra `accion = 'transicion'`, `entidad = 'RESERVA'`,
  con `datos_anteriores`/`datos_nuevos` del estado/sub_estado; la liberación de fecha se
  audita con `entidad = 'FECHA_BLOQUEADA'` y causa `TTL` (US-041). (`US-012 §Happy Path`.)
- **Alerta interna al gestor** (no email al cliente): la expiración deja constancia para
  que el dashboard/notificaciones muestre "Consulta [código] expirada. Fecha [fecha]
  liberada." Los emails al cliente notificando la expiración **NO están en MVP** (sin
  código E en §9.3). (`US-012 §Email relacionado`, `§Notas de alcance`.)

## Impact

- Specs afectadas: **se extiende `consultas`** con `ADDED Requirements` para el flujo de
  expiración por TTL. NO se crea capability nueva; NO se modifican `bloqueo-fecha` (se
  **reutiliza** `liberarFecha()` tal cual), `calendario`, `foundation`, `calculo-tarifa`
  ni `app-shell`. (`spec-delta` en `specs/consultas/spec.md`.)
- Datos: **ninguna entidad ni migración de esquema nueva**. Usa `RESERVA`
  (`ttl_expiracion`, `estado`, `sub_estado`, campos de cola), `FECHA_BLOQUEADA` y
  `AUDIT_LOG`, todas ya provisionadas. El campo `ttl_expiracion` existe desde US-004/006.
- Contrato OpenAPI: **SÍ** se añade un endpoint — el **endpoint interno protegido de
  barrido** (`X-Cron-Token`), a fijar por `contract-engineer` tras el gate. Es la
  divergencia deliberada frente a US-041 (que no expuso endpoint): aquí el wiring del cron
  es el objeto de la US. No hay superficie de usuario final.
- Infra transversal: se activa `@nestjs/schedule` (si no estaba) para el cron; se consume
  `CRON_TOKEN` (ya declarado en `env.validation.ts`). Documentar en `architecture.md §2.5`.
- Multi-tenancy/RLS: el barrido es un proceso de **Sistema**; opera **cross-tenant** pero
  cada liberación/transición se ejecuta bajo el **contexto RLS del tenant** de la RESERVA
  (`SET LOCAL app.tenant_id`), como en US-041. Ver `design.md §D-6`.
- Concurrencia: **zona crítica — TDD primero**. Tests de doble ejecución del cron (RC-1),
  expiración vs extensión manual concurrente (RC-2, coordina con US-006), expiración vs
  nuevo bloqueo de la misma fecha (RC-3), idempotencia y fallo aislado por fecha.
  (`US-012 §Concurrencia`, `CLAUDE.md §Testing`.)
- Deuda técnica considerada (no se arregla aquí): (a) off-by-one de TZ en
  `formatearFechaHora` — la selección de candidatas compara **instantes**, no fechas
  formateadas; (b) el test de concurrencia de US-004 es flaky (deadlock `40P01`) — ajeno
  a este change, solo se tiene en cuenta al leer la suite global.
- Trazabilidad: **US-012**, **UC-09**, dolores **D4**/**D1**/**D13**; automatizaciones
  A4/A5/A21/A21b; reutiliza US-041 (`liberarFecha()` + lote) y US-006 (extensión de TTL);
  dispara el seam de **US-018** (promoción real, aún no implementada).
- Fuera de alcance: la **reordenación de cola** y el **re-bloqueo de la promovida** (A15,
  US-018); los **emails al cliente** de expiración (sin código E en MVP); A3 (recordatorio
  amable día +2, solo diseñado); la **UI del dashboard de notificaciones** (US-044).

# Change: us-018-promocion-automatica-cola

## Why

Hoy, cuando una consulta bloqueante expira por TTL (US-012, UC-09) o se libera su
fecha por descarte/cancelación (US-041, UC-31), el sistema **libera la
`FECHA_BLOQUEADA` pero NO promueve al siguiente en cola**: la mecánica de promoción
(A15/UC-12) es un **seam `PromocionColaPort.promoverPrimeroEnCola()`** cuyo adaptador
es un **stub no-op** (`promocion-cola.stub.adapter.ts`). Consecuencia: hasta esta US
la cola queda **intacta en `2.d`** tras la liberación —la fecha vuelve a estar libre
pero **nadie hereda el lead FIFO**—, deuda técnica explícita ligada a US-018 y
documentada en `us-041 §D-2`, `us-012 §D-8` y `er-diagram.md §5.3` /
`§Índices de cola`. Es el peor riesgo comercial (dolores **D4** — fecha sin protección
tras expiración; **D13** — pérdida de lead en cola por inacción del sistema): la fecha
podría re-bloquearla un tercero mientras un candidato en espera pierde su turno.
(`US-018 §Historia`, `§Contexto`; `use-cases.md` UC-12; `er-diagram.md §5.3`;
`us-041 design.md §D-2`; `us-012 design.md §D-8`.)

- **US-012 dejó el terreno preparado y este change lo COMPLETA, no lo reinventa**: el
  seam `PromocionColaPort` ya existe en `liberar-fecha.service.ts` (~L113-115), el
  disparo ya está cableado (~L269-277) y se invoca **exactamente una vez** cuando el
  DELETE de `FECHA_BLOQUEADA` afecta 1 fila y hay cola activa (`hayColaActiva`).
  US-018 **hereda ese contrato de trigger tal cual**: NO re-dispara, NO reimplementa la
  detección de cola, NO toca `liberarFecha()`. Solo **sustituye el stub no-op por el
  adaptador real** que ejecuta la mecánica A15.
- El actor es el **Sistema**: US-018 no aporta pantalla propia; su efecto observable es
  que el primero en cola pasa a bloquear la fecha (visible en el Calendario US-039 y su
  ficha) sin intervención del Gestor, y el resto de la cola conserva su orden FIFO.

## What Changes

- **Sustituye el stub `PromocionColaStubAdapter` por el adaptador real** que implementa
  `PromocionColaPort.promoverPrimeroEnCola({ tenantId, fecha })`. El binding en
  `reservas.module.ts` (`{ provide: PROMOCION_COLA_PORT, useClass: … }`, ~L298) pasa del
  stub al adaptador real; `PROMOCION_COLA_PORT` y `PromocionColaPort` ya existen en
  `reservas.tokens.ts` (~L16) y no cambian. (`US-018 §Contexto técnico`.)
- **Mecánica A15 (dominio puro)** de la promoción FIFO, como caso de uso de aplicación +
  operación de dominio pura, modelada con la **máquina de estados declarativa** (skill
  `state-machine`, NO `if` dispersos): promover la RESERVA con `posicion_cola = 1`
  (`consulta_bloqueante_id = <bloqueante liberada>`) de `2.d → 2.b`. (`US-018 §Reglas de
  negocio`; `CLAUDE.md §Máquina de estados`; `maquina-estados.ts`.)
- **Re-creación atómica de `FECHA_BLOQUEADA`** para la promovida reutilizando la
  primitiva atómica existente `bloquearFecha()` (US-040): `tipo_bloqueo = 'blando'`,
  `reserva_id = <promovida>`, `ttl_expiracion = now() + tenant_settings.ttl_consulta_dias`
  (default 3 días). Regla crítica del proyecto: `UNIQUE(tenant_id, fecha)` +
  `SELECT … FOR UPDATE` vía Prisma `$queryRaw`; **NUNCA Redis/locks distribuidos** (hook
  `no-distributed-lock`). (`US-018 §Reglas de negocio`; `CLAUDE.md §Regla crítica`;
  `er-diagram.md §5.3`.)
- **Mutación de la RESERVA promovida** (US-018 posee ahora un puerto de ESCRITURA de
  RESERVA de cola, que US-041 §3.7 explícitamente NO tenía): `sub_estado → '2b'`,
  `posicion_cola → NULL`, `consulta_bloqueante_id → NULL`, `ttl_expiracion → now() +
  ttl_consulta_dias`. (`US-018 §Reglas de negocio`.)
- **Reordenación FIFO del resto de la cola**: cada RESERVA en `2.d` restante decrementa
  `posicion_cola` en 1 y re-apunta `consulta_bloqueante_id` a la nueva bloqueante
  (la promovida). Se preserva la unicidad `UNIQUE(tenant_id, consulta_bloqueante_id,
  posicion_cola) WHERE posicion_cola IS NOT NULL` (US-004). (`US-018 §Happy Path`, FA-03;
  `er-diagram.md §Índices de cola`.)
- **Todo en una única transacción** serializada por `SELECT … FOR UPDATE` sobre la fila
  de `FECHA_BLOQUEADA` (y las RESERVA de cola): promoción + re-bloqueo + reordenación son
  **all-or-nothing**, bajo el contexto RLS del tenant. No existe estado observable
  intermedio (no hay instante en que la fecha quede sin protección ni la cola con hueco).
  (`US-018 §Reglas de Validación`, `§Concurrencia`; `CLAUDE.md §Regla crítica`.)
- **Guarda "ya promovida" (idempotencia + coordinación con US-019)**: dentro de la
  transacción, tras adquirir el lock, se **re-verifica** que la fecha sigue sin bloqueante
  viva pendiente de promover y que sigue existiendo un `posicion_cola = 1`. Si otra
  ejecución (segunda instancia del cron, o la futura promoción manual US-019) ya promovió,
  la transacción **aborta sin cambios** (no-op idempotente, sin error). (`US-018 §FA-04`,
  `§RC doble job`, `§RC job vs US-019`.)
- **Email de promoción (⚠ decisión de alcance — ver `design.md` D-5)**: la ficha US-018
  marca el email "¡La fecha está disponible!" (UC-12 paso 8) como `📐 Solo diseñado`,
  **fuera del MVP**. El disparo del email (trigger de comunicaciones US-045, ya
  implementado) queda pendiente de decisión humana: (a) no enviarlo en MVP; (b) registrar
  COMUNICACION en `borrador` sin envío; (c) enviarlo inmediato. Propuesta por defecto: NO
  enviar en MVP, dejando solo la mecánica de promoción/reordenación en scope, alineado con
  la ficha. (`US-018 §Notas de alcance`, `§Email relacionado`.)
- **Consistencia eventual — cierre de la deuda de US-012/US-041**: hasta este change, la
  cola quedaba en `2.d` tras liberar (deuda documentada). US-018 la **cierra**: el mismo
  seam, ya con el adaptador real, promueve inmediatamente tras cada liberación con cola.
  Se documenta que la promoción es síncrona al post-commit de `liberarFecha()`.
  (`us-041 §D-2 Riesgos`; `us-012 §D-8`.)
- **AUDIT_LOG**: se registra `accion = 'transicion'`, `entidad = 'RESERVA'` por la
  promovida (`datos_anteriores.sub_estado = '2d'`, `datos_nuevos = {sub_estado: '2b',
  origen: 'promocion_automatica'}`) y por cada RESERVA reordenada; si se detecta cola con
  `posicion_cola` no contigua (anomalía de datos), se registra la inconsistencia y se
  **aborta sin promover** (no corrección silenciosa). (`US-018 §Happy Path`, `§Reglas de
  Validación`.)

## Impact

- Specs afectadas: **se extiende `consultas`** con `ADDED Requirements` para la promoción
  automática de cola. NO se crea capability nueva (la mecánica de cola, sub-estados y
  bloqueo blando ya viven en `consultas`, que US-012 ya extendió). NO se modifican
  `bloqueo-fecha` (se **reutiliza** `bloquearFecha()`/`liberarFecha()` tal cual),
  `calendario`, `foundation`, `calculo-tarifa` ni `app-shell`. (`spec-delta` en
  `specs/consultas/spec.md`.)
- Datos: **ninguna entidad ni migración de esquema nueva**. Usa `RESERVA`
  (`posicion_cola`, `consulta_bloqueante_id`, `sub_estado`, `ttl_expiracion`),
  `FECHA_BLOQUEADA` y `AUDIT_LOG`, todo provisionado; el índice UNIQUE parcial de cola
  (`reserva_cola_posicion_key`, US-004) ya existe y se respeta.
- Contrato OpenAPI: **sin endpoint nuevo**. La promoción es un efecto de Sistema disparado
  post-commit por `liberarFecha()` (US-012/US-041); no hay superficie HTTP de usuario. El
  endpoint de barrido (`POST /cron/barrido-expiracion`, US-012) ya existe y no cambia; su
  resumen ya expone `promocionesDisparadas`. `contract-engineer` confirma que no hay delta
  de contrato (se validará en el step de contrato; probablemente NO-OP).
- Código: sustituye `promocion-cola.stub.adapter.ts` (stub no-op) por el adaptador Prisma
  real + un caso de uso de aplicación (`PromoverPrimeroEnColaService` o equivalente) + una
  operación/guarda de dominio pura (`resolverPromocionCola`, tabla declarativa) en
  `maquina-estados.ts`. Re-binding en `reservas.module.ts`.
- Multi-tenancy/RLS: la promoción se ejecuta bajo el **contexto RLS del tenant** de la
  fecha liberada (`SET LOCAL app.tenant_id`, mismo patrón que US-041); el `tenant_id`
  proviene del comando del seam, nunca de input externo.
- Concurrencia: **zona crítica — TDD primero** (skill `concurrency-locking`). 6 edge cases
  y 3 escenarios de carrera: doble promoción por doble job (RC-1), race barrido TTL
  (US-012) vs promoción (RC-2), y coordinación anti-doble-promoción con la futura promoción
  manual US-019 (RC-3, guarda "ya promovida"). Tests reales de Postgres con workers
  simultáneos, no mocks.
- Deuda técnica considerada (no se arregla aquí): (a) off-by-one de TZ en
  `formatearFechaHora` — el nuevo `ttl_expiracion` se calcula/compara como **instante
  `timestamptz`**, nunca fecha formateada; (b) el test de concurrencia de US-004 es flaky
  (deadlock `40P01`) — ajeno; solo se vigila al leer la suite global.
- Trazabilidad: **US-018**, **UC-12** (encadenado desde UC-09), dolores **D4**/**D13**;
  automatización A15; reutiliza US-040 (`bloquearFecha()`), US-041 (`liberarFecha()` +
  seam), US-012 (trigger post-commit). Coordina con **US-019** (promoción manual, futura).
- Fuera de alcance: el **email al cliente** de promoción ("¡La fecha está disponible!",
  UC-12 paso 8, `📐 Solo diseñado` — ⚠ D-5); la **promoción manual por el Gestor**
  (US-019, solo se deja la guarda de coordinación); la UI del dashboard.

# Design — us-031-inicio-automatico-evento

## Context

US-031 (UC-23 flujo básico, actor **Sistema**) es el **flujo invocante** que cierra el patrón
"estado en fila + barrido periódico" para el **inicio automático del evento en T-0**: a las
00:00 del día de `fecha_evento`, transiciona `RESERVA.estado: reserva_confirmada →
evento_en_curso` cuando las **tres precondiciones** están cumplidas. La infraestructura y las
mutaciones de dominio que necesita ya existen y **se reutilizan sin redefinir**:

- **US-021** dejó la RESERVA en `reserva_confirmada` (con `FICHA_OPERATIVA` 1:1) al confirmar
  el pago de la señal.
- **US-025 / US-026** producen `pre_evento_status = 'cerrado'` (cierre manual y automático en
  T-1d respectivamente): **1.ª precondición**.
- **US-029** produce `liquidacion_status = 'cobrada'` (registro del cobro de la liquidación):
  **2.ª precondición**.
- **US-030** produce `fianza_status = 'cobrada'` (registro del cobro de la fianza), además de
  `fianza_eur`/`fianza_cobrada_fecha`: **3.ª precondición**. US-030 y US-029 **explícitamente
  NO transicionan `RESERVA.estado`** y dejan documentado que habilitan las precondiciones de
  `evento_en_curso` (US-031) — así lo dice el contrato (`/facturacion` cobros: "habilita … de
  las 3 precondiciones de `evento_en_curso`, US-031; NO transiciona `RESERVA.estado`").
- **US-012** (archivado) aportó el **patrón de cron de barrido**: `@Cron` (`@nestjs/schedule`)
  → endpoint interno protegido `X-Cron-Token` (`CronTokenGuard`) → caso de uso de barrido con
  **fallo aislado por RESERVA** y **contexto RLS por tenant** (`SET LOCAL app.tenant_id`), más
  la **convención de auditoría de Sistema** (`usuario_id` no poblado). US-026 replicó esta
  forma para el cierre de fichas. US-031 la replica de nuevo para el inicio de eventos.
- **`maquina-estados.ts`** (dominio de `reservas`) ya modela las transiciones del agregado
  RESERVA como **tablas declarativas** (`resolverExpiracionTtl`, `resolverPromocionCola`,
  `resolverExpiracionForzosaBloqueante`, guardas de origen `esOrigenValidoPara…`). `evento_en_curso`
  ya está en el tipo `EstadoReserva`. US-031 añade una guarda/mapa análogo para
  `reserva_confirmada → evento_en_curso`.
- `CRON_TOKEN` ya en `apps/api/src/config/env.validation.ts`; `@nestjs/schedule` y
  `CronTokenGuard` ya activados por US-012/US-026. `AuditLogPort` compartido con `usuarioId`
  opcional (acción de Sistema).

Este documento fija las decisiones no triviales. **Una** es **decisión de alcance de contrato
que requiere aprobación en el gate humano**: D-2 (reutilizar `POST /cron/barrido?tarea=eventos`
vs. endpoint dedicado `POST /cron/barrido-eventos`).

## D-1. Patrón obligatorio "estado en fila + barrido periódico" (regla dura)

- El trabajo pendiente es **estado en la BBDD** (`RESERVA.estado` + `fecha_evento` +
  `pre_evento_status` + `liquidacion_status` + `fianza_status`), nunca un timer en memoria.
  PROHIBIDO Lambda/EventBridge ni timers exactos (skill `async-jobs`; `CLAUDE.md §Jobs
  asíncronos`; `architecture.md §2.5`).
- Un `@Cron` diario (`@nestjs/schedule`) invoca el **endpoint interno protegido** con la
  cabecera `X-Cron-Token`. Frecuencia **una vez al día a las 00:00 del día del evento** (T-0);
  no se depende de precisión de timer (el filtro `fecha_evento = hoy` tolera que el pase corra
  a cualquier hora del día). El scheduler no ejecuta lógica de negocio: solo dispara el
  endpoint (invocable manualmente/por scheduler externo y testeable por HTTP).
- El barrido es **idempotente** (D-4): re-ejecutarlo no re-transiciona reservas ya en
  `evento_en_curso` ni duplica auditorías.

## D-2. Superficie del barrido en el contrato — DECISIÓN DE ALCANCE (gate)

**Contexto**: el contrato ya declara `POST /cron/barrido` con un parámetro `tarea` cuyo enum
**ya incluye `eventos`**, y su comentario `[DECISIÓN granularidad]` **ya nombra US-031** como
una de las dueñas de un barrido aislado (`docs/api-spec.yml`, `/cron/barrido`: `tarea:
[expiracion, cola, fichas, eventos, archivado, recordatorios, all]`; comentario "aislar tests
de concurrencia (US-012/018/026/031/037)"). US-026 resolvió su gate reutilizando el endpoint
genérico y ampliando `BarridoResponse` con un subobjeto `fichas: BarridoFichasResumen`. US-012,
en cambio, añadió un endpoint **dedicado** `POST /cron/barrido-expiracion`.

**Decisión propuesta (a aprobar en el gate)** — dos opciones válidas; el `contract-engineer`
la materializa tras el gate:

- **Opción A (preferida, coherente con US-026): reutilizar el endpoint genérico** `POST
  /cron/barrido?tarea=eventos` con auth `cronToken` (`X-Cron-Token`), ampliando
  `BarridoResponse` con un subobjeto `eventos: BarridoEventosResumen` (`{ candidatas,
  eventosIniciados, precondicionesIncumplidas, fallos }`), siguiendo la granularidad de
  `BarridoResponse.fichas` (US-026) y `BarridoExpiracionResponse` (US-012): recuentos agregados
  de un proceso de Sistema, sin exponer datos de negocio ni identificadores de RESERVA.
  Ventaja: el contrato **ya lo prevé** para US-031; simetría con la decisión de US-026; menos
  superficie nueva. Compatibilidad: `eventos` opcional, presente solo con `tarea=eventos` (o
  `all`).
- **Opción B: endpoint dedicado** `POST /cron/barrido-eventos` con `CronTokenGuard` y un
  `BarridoEventosResponse` propio (`candidatas`, `eventosIniciados`, `precondicionesIncumplidas`,
  `fallos`), por **simetría con US-012** (`/cron/barrido-expiracion`). Ventaja: resumen tipado
  específico, tests por HTTP aislados. Inconveniente: añade superficie y diverge de la enum
  `tarea` ya prevista y de la decisión reciente de US-026.

**Recomendación inicial del autor**: Opción A. **RESUELTO EN IMPLEMENTACIÓN → OPCIÓN B**
(decisión humana 2026-07-07, ver nota abajo).

> **⚠️ RESOLUCIÓN DE GATE (2026-07-07) — se elige OPCIÓN B (endpoint dedicado
> `POST /cron/barrido-eventos`).** Al implementar se comprobó que el **dispatch por `?tarea=`
> que promete el contrato NUNCA se implementó**: `POST /cron/barrido` lo sirve un único
> controller dedicado (`BarridoFichasController`, módulo `ficha-evento`) que **ignora `tarea`**
> y siempre devuelve `{ fichas }`. Añadir un segundo controller de US-031 sobre `POST
> /cron/barrido` **colisiona** (Express resuelve por método+ruta, no por query string) y
> ensombrecería el barrido de US-026 → regresión silenciosa de código ya mergeado. La Opción A
> "pura" exigiría un refactor cross-módulo (un dispatcher único que inyecte los use-cases de
> `reservas` Y `ficha-evento`), scope y riesgo ajenos a US-031. Por tanto US-031 usa un
> **endpoint dedicado `POST /cron/barrido-eventos`** con su propio `BarridoEventosResponse`
> (`{ candidatas, eventosIniciados, precondicionesIncumplidas, fallos }`), **gemelo del
> `POST /cron/barrido-expiracion` de US-012, en el MISMO módulo `reservas`/interface**. US-026
> (`POST /cron/barrido?tarea=fichas`) queda **intacto**. Auth `X-Cron-Token` (no JWT),
> idempotencia y resumen con recuentos se mantienen. **No hay endpoint ni SDK de usuario
> nuevos**: la vista móvil consume `RESERVA.estado` de `GET /reservas` (US-049).

## D-3. Transición de inicio como estructura de datos declarativa + guarda de precondiciones

La transición se modela como **tabla de datos** en `maquina-estados.ts` (skill `state-machine`,
NO `if` dispersos), consistente con `resolverExpiracionTtl`/`resolverPromocionCola`:

```
Inicio automático de evento (guarda de ORIGEN):
  { reserva_confirmada, subEstado null } → { evento_en_curso, null }
  (cualquier otro estado/sub-estado → no candidato: null, no-op)
```

- El **filtro de candidatas** ya restringe a `estado = 'reserva_confirmada'` +
  `date(fecha_evento) = date(hoy)`; la guarda de origen declarativa (p. ej.
  `resolverInicioEvento(estado, subEstado)`) se re-evalúa dentro de la transacción de cada
  RESERVA (base de la idempotencia y de la concurrencia cron↔gestor, D-6).
- **Guarda de las tres precondiciones**: función de dominio **pura** (p. ej.
  `preconditionesEventoCumplidas({ preEventoStatus, liquidacionStatus, fianzaStatus })`) que
  evalúa `pre_evento_status = 'cerrado'` **AND** `liquidacion_status = 'cobrada'` **AND**
  `fianza_status = 'cobrada'` en una única lectura de la fila. Devuelve además **qué
  precondiciones faltan**, para poblar la alerta crítica (D-8) sin lógica dispersa. Vive en
  dominio (sin `@nestjs`/Prisma).
- La mutación acompañante es mínima: `RESERVA.estado = evento_en_curso` + `AUDIT_LOG`. No hay
  side-effects sobre `FECHA_BLOQUEADA`, cola ni FICHA_OPERATIVA.

## D-4. Selección de candidatas e idempotencia

- **Selección** = `estado = 'reserva_confirmada'` **AND** `date(fecha_evento) = date(hoy)`. Las
  reservas ya en `evento_en_curso` quedan fuera por construcción → 2.ª ejecución no las
  re-transiciona. El filtro por estado es **estricto**: solo `reserva_confirmada`.
- **Comparación por fecha de calendario** (no por instante ni `ttl_expiracion`): la semántica de
  T-0 es "el día de `fecha_evento`", una fecha de calendario. El "día de hoy" se calcula sobre
  la zona horaria de negocio del tenant/aplicación de forma **consistente en toda la query**
  (una sola definición de "hoy" por pase), evitando el off-by-one de TZ conocido en presentación
  (`formatearFechaHora`, deuda técnica en memoria, **ajena a este change**): la lógica de
  selección **no** depende de ningún string formateado, sino de `date(fecha_evento) =
  CURRENT_DATE` calculado en el backend. Se añade un test que fija esta invariante.
- **Re-evaluación bajo transacción**: tras abrir la transacción de la RESERVA y hacer `SELECT …
  FOR UPDATE` de su fila, se re-leen `estado` y los tres `*_status`; si `estado` ya no es
  `reserva_confirmada` (otro pase o el gestor US-032 concurrente), la transacción no muta nada
  (UPDATE 0 filas). Esto da idempotencia y la coordinación con US-032 sin locks distribuidos.

## D-5. Multi-tenancy / RLS en un proceso de Sistema

- El barrido es **cross-tenant** (una sola pasada evalúa candidatas de todos los tenants), pero
  **cada** transición se ejecuta bajo el **contexto RLS del tenant** de la RESERVA (`SET LOCAL
  app.tenant_id` vía `set_config`, mismo patrón que los adaptadores de barrido de
  US-012/US-026). El `tenant_id` proviene de la fila candidata, nunca de input externo.
- La lectura inicial de candidatas cross-tenant usa el rol técnico del proceso de Sistema (como
  US-012/US-026); las escrituras siempre reponen el `tenant_id` correcto. Se documenta en
  `architecture.md §2.5` que es un punto legítimo cross-tenant y que las mutaciones respetan RLS
  por tenant.

## D-6. Concurrencia — TDD primero en idempotencia y coordinación cron↔gestor

A diferencia de US-012, US-031 **NO** toca `FECHA_BLOQUEADA`, cola ni bloqueo atómico de fecha:
no hay `UNIQUE(tenant_id, fecha)` ni promoción implicados. La zona crítica se reduce a la
idempotencia y a la coordinación con el forzado manual de US-032:

- **RC-1 (doble ejecución del cron)**: dos pases concurrentes sobre la misma RESERVA →
  exactamente una transición. La transacción por RESERVA re-evalúa `estado` bajo `SELECT … FOR
  UPDATE`; el segundo lo encuentra ya `evento_en_curso` y no muta nada. Sin locks distribuidos
  (hook `no-distributed-lock`); la serialización la da PostgreSQL sobre la fila RESERVA.
- **RC-2 (cron vs gestor US-032)**: cron y gestor intentan transicionar la misma RESERVA a la
  vez → **exactamente uno** aplica `→ evento_en_curso`; el otro re-evalúa bajo el lock, la
  UPDATE afecta **0 filas** y termina como **no-op sin error**. Nunca hay estado intermedio ni
  doble auditoría. **US-032 aún no está implementado**: RC-2 se testea simulando el "segundo
  actor" (dos transacciones concurrentes con la misma guarda de origen sobre la fila RESERVA),
  dejando la coordinación real verificada cuando US-032 aterrice sobre esta misma guarda.
- Tests de concurrencia **reales** en la medida en que la infraestructura de tests lo permita
  (skill `concurrency-locking`, `Promise.allSettled`); como mínimo, tests deterministas de la
  idempotencia (2.ª ejecución no muta) y del aislamiento de fallos. El test de US-004 flaky
  (`40P01`) es ajeno; solo se vigila al leer la suite global.

## D-7. Hexagonal: dominio puro + caso de uso de aplicación + adaptadores

- **Dominio** (`reservas/domain`): la guarda/mapa de inicio de evento (`resolverInicioEvento` o
  la tabla `MAPA_INICIO_EVENTO`) en `maquina-estados.ts`, más la guarda pura de las tres
  precondiciones (`preconditionesEventoCumplidas`, que además devuelve las faltantes). Nada de
  `@nestjs` ni Prisma (hook `no-infra-in-domain`).
- **Aplicación**: un caso de uso `IniciarEventosDelDiaService` (o `BarridoInicioEventosUseCase`)
  que (1) lista candidatas (puerto de lectura), (2) por cada una abre una transacción, hace
  `SELECT … FOR UPDATE`, re-evalúa la guarda de origen + precondiciones, transiciona y audita
  como Sistema si procede, o marca precondiciones incumplidas + emite alerta crítica si no, y
  emite A29 si `cond_part_firmadas = false`; y (3) agrega el resumen con **fallo aislado por
  RESERVA**. Mismo aislamiento de lote que US-012/US-026.
- **Infraestructura**: adaptador Prisma para listar candidatas cross-tenant y para la UoW de
  transición (`$transaction` + `SET LOCAL app.tenant_id` + `SELECT … FOR UPDATE` sobre RESERVA);
  reuso del `CronTokenGuard` y del controller de cron (según la opción de contrato D-2);
  provider del `@Cron` diario a las 00:00. Registrar en el módulo correspondiente
  (`reservas`/`cron` compartido).
- **AUDIT_LOG**: la transición se audita con `accion = 'transicion'`, `entidad = 'RESERVA'`,
  `datos_anteriores = {estado: reserva_confirmada}`, `datos_nuevos = {estado: evento_en_curso}`,
  origen Sistema (`usuarioId` no poblado), causa de la automatización en `datos_nuevos`, vía el
  `AuditLogPort` compartido; no se duplica auditoría.

## D-8. Alertas: crítica (precondiciones incumplidas) y A29 (no bloqueante)

- **Alerta crítica** por precondiciones incumplidas: se emite cuando una candidata (T-0,
  `reserva_confirmada`) NO cumple las tres. Enumera las precondiciones faltantes (derivadas de
  `preconditionesEventoCumplidas`) y remite al forzado manual (US-032). La RESERVA **no**
  transiciona.
- **A29 (no bloqueante)**: se emite cuando `cond_part_firmadas = false` el día del evento, con
  **independencia** del resultado de la transición (se dispara aunque la transición se ejecute).
- **Materialización de las alertas**: US-031 **produce** las alertas siguiendo la convención de
  alertas de Sistema del proyecto; **NO** construye una superficie de notificaciones nueva (esa
  es US-044). El rastro auditable de la transición efectiva es `AUDIT_LOG`. La forma concreta de
  entrega (canal/persistencia) se alinea con lo que ya exista para alertas de Sistema en el
  código; si no existe un canal formal en MVP, la alerta se registra de forma trazable sin
  bloquear el barrido (decisión de implementación menor, no de alcance).

## D-9. Sin email, sin briefing, sin UI nueva (out-of-scope)

US-031 **NO** envía ningún email (ninguno de E1–E8 activo en esta acción). El **briefing
operativo PDF al equipo** (UC-23 paso 5) es 📐 **diseñado pero no implementado en MVP TFM** y
**A9** (briefing en T-3d) es 📐 **lista negra**: US-031 **NO** genera ni envía briefing. La
**vista móvil "evento en curso"** y su **checklist de documentación** (DNI anverso/reverso,
cláusula de responsabilidad) son la superficie de **US-033/US-034**; US-031 solo deja la RESERVA
en `evento_en_curso`, estado que las habilita. (`US-031 §Notas de alcance`, `§Email
relacionado`.)

## Riesgos / Trade-offs

- **Definición de "hoy" y TZ** (D-4): el cálculo del día objetivo debe ser consistente con la
  zona horaria de negocio para no iniciar un día antes/después. Se fija una sola definición por
  pase y se testea; no se toca la deuda de `formatearFechaHora` (presentación).
- **Cross-tenant read + RLS write** (D-5): punto cross-tenant legítimo; se documenta y se testea
  que las escrituras nunca cruzan tenant.
- **Coordinación con US-032 aún no implementado** (D-6): RC-2 se blinda con la guarda de origen
  re-evaluada bajo el lock, de modo que US-032 herede la misma garantía sin cambios en US-031.
- **Materialización de alertas sin superficie de notificaciones** (D-8): se emite/registra de
  forma trazable sin bloquear el barrido; la UI de notificaciones es US-044.
- **Contrato reutilizado vs dedicado** (D-2): decisión de gate; ambas opciones son
  funcionalmente equivalentes en cuanto a auth e idempotencia.

## Pendiente / fuera de alcance

- **Forzado manual** de la transición ante precondiciones incumplidas → **US-032** (US-031 solo
  alerta).
- **Vista móvil "evento en curso" + checklist de documentación** → **US-033/US-034**.
- **Briefing operativo PDF al equipo** (UC-23 paso 5) → 📐 diseñado, no implementado en MVP.
- **A9 (briefing en T-3d)** → 📐 lista negra, sin código.
- **UI del dashboard de notificaciones** → **US-044** (US-031 solo produce las alertas y deja
  rastro de la transición en `AUDIT_LOG`).
- **Arreglo del off-by-one de TZ** en `formatearFechaHora` → change aparte (D-4 solo se blinda
  de no depender de fechas formateadas).
- **E2E de navegador**: US-031 no introduce UI propia (actor Sistema) → step-N+3 marcado N/A
  justificado (ver tasks.md).

# Design — us-037-archivado-automatico-reserva-completada

## Context

US-037 (UC-28, flujo básico automático, actor **Sistema**) cierra el ciclo de vida de la RESERVA:
a T+7d de la entrada en `post_evento`, transiciona `RESERVA.estado: post_evento →
reserva_completada` (terminal, inmutable) cuando la **fianza está resuelta**, y deja la RESERVA
consultable en Histórico. Reutiliza infraestructura y dominio ya presentes:

- **US-034** dejó la RESERVA en `post_evento` (transición `evento_en_curso → post_evento`,
  `MAPA_FINALIZACION_EVENTO` en `maquina-estados.ts`). `post_evento` es el origen de US-037.
- **US-036** produce la fianza resuelta: `fianza_status ∈ {devuelta, retenida_parcial}` (registro de
  devolución total/parcial/retención), además de `fianza_devuelta_eur`/`fianza_devuelta_fecha`. Es
  la dependencia que habilita la guarda de fianza de US-037.
- **US-012** (archivado) aportó el **patrón de cron de barrido**: `@Cron` (`@nestjs/schedule`) →
  endpoint interno protegido `X-Cron-Token` (`CronTokenGuard`) → caso de uso de barrido con **fallo
  aislado por RESERVA** y **contexto RLS por tenant** (`SET LOCAL app.tenant_id`), más la
  **convención de auditoría de Sistema** (`usuario_id` no poblado). **US-026** (cierre de fichas) y
  **US-031** (inicio de evento, `POST /cron/barrido-eventos`, gemelo de `barrido-expiracion`)
  replican esta forma. US-037 la replica de nuevo para el archivado.
- **`maquina-estados.ts`** (dominio de `reservas`) modela las transiciones del agregado RESERVA como
  **tablas declarativas** (`MAPA_FINALIZACION_EVENTO`, `MAPA_INICIO_EVENTO`, `resolver…`).
  `reserva_completada` ya está en el tipo `EstadoReserva` y en el enum Prisma. US-037 añade una
  arista/guarda análoga `post_evento → reserva_completada` (terminal, sin salida).
- `CRON_TOKEN` ya en `apps/api/src/config/env.validation.ts`; `@nestjs/schedule` y `CronTokenGuard`
  ya activados por US-012/US-026/US-031. `AuditLogPort` compartido con `usuarioId` opcional (Sistema).
- El patrón canónico de idempotencia/concurrencia sobre la fila RESERVA (`$transaction` + `SELECT …
  FOR UPDATE` + reevaluar guarda bajo el lock + update, con `fijarTenant(tx, tenantId)` como PRIMERA
  operación) está vivo en `facturacion/infrastructure/devolucion-fianza-repository.prisma.adapter.ts`
  y `devolucion-fianza-uow.prisma.adapter.ts` (US-036). US-037 lo replica.

Este documento fija las decisiones no triviales. **Cuatro** son **decisiones abiertas que requieren
aprobación/elección en el gate humano**: D-2 (cómo medir la antigüedad en `post_evento`), D-3
(mecanismo de la alerta interna FA-01), D-4 (anti-duplicación de la alerta) y D-5 (alcance de la
"indexación" en Histórico).

## D-1. Patrón obligatorio "estado en fila + barrido periódico" + endpoint DEDICADO (regla dura)

- El trabajo pendiente es **estado en la BBDD** (`RESERVA.estado = post_evento` + el momento de
  entrada a `post_evento` + `fianza_status`/`fianza_eur`), nunca un timer en memoria. PROHIBIDO
  Lambda/EventBridge ni timers exactos (skill `async-jobs`; `CLAUDE.md §Jobs asíncronos`;
  `architecture.md §2.5`).
- Un `@Cron` diario (`@nestjs/schedule`) invoca el **endpoint interno protegido** con la cabecera
  `X-Cron-Token`. Frecuencia **una vez al día**; no se depende de precisión de timer (el filtro T+7d
  tolera que el pase corra a cualquier hora del día). El scheduler no ejecuta lógica de negocio:
  solo dispara el endpoint (invocable manualmente/por scheduler externo y testeable por HTTP).
- **Endpoint DEDICADO NUEVO** `POST /cron/barrido-completadas` (regla dura del usuario + memoria del
  proyecto). **PROHIBIDO** reutilizar `POST /cron/barrido` ni el dispatch por `?tarea=`: ese
  dispatch **nunca se implementó** en el repo (`POST /cron/barrido` lo sirve un único controller que
  ignora `tarea` y devuelve siempre su propio resumen); añadir un segundo controller sobre esa ruta
  colisiona (Express resuelve por método+ruta, no por query string) y provoca **regresión
  silenciosa** de barridos ya mergeados. Es exactamente la lección de la **resolución de gate de
  US-031 §D-2** y de la memoria "Cron ?tarea= dispatch es ficticio". El nuevo endpoint es **gemelo**
  de `POST /cron/barrido-eventos` (US-031) y `POST /cron/barrido-expiracion` (US-012), en el mismo
  módulo `reservas`/interface, con su propio `BarridoCompletadasResponse` (`{ candidatas, archivadas,
  fianzaPendiente, fallos }`).
- El barrido es **idempotente** (D-6): re-ejecutarlo no re-archiva reservas ya en
  `reserva_completada` ni duplica auditorías, y no re-emite la alerta de fianza pendiente (D-4).

## D-2. Cómo medir la antigüedad en post_evento (T+7d) — DECISIÓN ABIERTA (gate) ⚠️

**Problema**: para seleccionar "≥ 7 días naturales desde que la RESERVA entró en `post_evento`"
hace falta un timestamp fiable de **esa entrada**. Hoy en el esquema **NO existe** `fechaPostEvento`;
`RESERVA.fechaActualizacion` es `@updatedAt` (`@map("fecha_actualizacion")`), por lo que **cambia en
CUALQUIER update de la fila** (p. ej. una devolución de fianza de US-036, o el archivado manual de
US-038). Usarla equivaldría a reiniciar el reloj de los 7 días con cada modificación → **frágil e
incorrecto**.

**Opciones**:

- **Opción A (RECOMENDADA) — nuevo campo `fechaPostEvento`.** Añadir `RESERVA.fechaPostEvento`
  (`DateTime?`, `@map("fecha_post_evento")`) y **poblarlo en la transición a `post_evento`** (US-034,
  en la misma transacción que fija `estado = post_evento`). El barrido selecciona
  `date(fechaPostEvento) <= date(hoy) - 7`. **Ventajas**: fuente de verdad explícita, inmune a
  `@updatedAt`, consulta trivial e indexable, semántica clara. **Coste**: migración Prisma **no
  destructiva** (columna nullable) + **modificar US-034** para poblar el campo (coordinación
  cross-US; las RESERVA que ya estén en `post_evento` antes de la migración tendrán
  `fechaPostEvento = NULL` → **backfill** desde `AUDIT_LOG` de la transición a `post_evento`, o
  `fallback` a `fechaActualizacion` solo para ese conjunto residual — a decidir en el gate).
- **Opción B — derivar de `AUDIT_LOG`.** Buscar la última entrada de transición a `post_evento`
  (`datos_nuevos.estado = post_evento`) y usar su `fecha`. **Ventajas**: sin migración, sin tocar
  US-034; reutiliza el rastro auditable ya obligatorio. **Inconvenientes**: consulta más costosa
  (join/subselect sobre `AUDIT_LOG` por candidata), acopla la selección al formato del log, y
  depende de que TODA entrada a `post_evento` esté auditada (lo está por US-034, pero es un contrato
  implícito). Menos robusto para indexar/filtrar.
- **Opción C — usar `fechaActualizacion` (frágil, desaconsejada).** Aproximar la entrada con el
  `@updatedAt`. **Riesgo alto**: cualquier update de la fila (devolución de fianza US-036, etc.)
  reinicia el reloj y **retrasa o impide** el archivado; incumple la semántica "7 días desde la
  entrada a `post_evento`". Solo aceptable como stopgap si el gate prohíbe migración.

**Recomendación del autor: Opción A** (nuevo campo `fechaPostEvento`), por ser la única fiel a la
semántica de la US y la más robusta/indexable, al coste de una migración no destructiva y de
coordinar el `SET` con US-034 (+ backfill del residual). **Pregunta para el humano**: ¿se aprueba la
migración + modificación de US-034 (Opción A), o se prefiere B (sin migración, derivar de
`AUDIT_LOG`) por evitar tocar US-034? La respuesta condiciona la migración de las tasks.

## D-3. Mecanismo de la alerta interna al gestor (FA-01) — DECISIÓN ABIERTA (gate) ⚠️

**Problema**: la US dice "ningún email al cliente/gestor" en el happy path, pero **FA-01 exige una
alerta interna** al gestor cuando la fianza sigue sin resolverse en T+7d. Hay que decidir el
**canal**, y hoy **no existe una infraestructura de notificaciones formal** en el backend (no hay
tabla de notificaciones ni servicio in-app; las "alertas" de US-031 se resolvieron como decisión de
implementación menor, alineadas con lo que existiera). US-044 (dashboard operativo) es la superficie
de notificaciones pero su alcance no incluye construir un canal genérico de alertas.

**Opciones (de menor a mayor coste)**:

- **Opción 3.1 — entrada de `AUDIT_LOG` de tipo alerta** (`accion` dedicada, p. ej. `alerta`, o
  `datos_nuevos.tipo = 'fianza_pendiente_t7d'`, con `usuario_id` nulo/Sistema y el código de la
  reserva). **Ventaja**: reutiliza infra existente y obligatoria, trazable, cero esquema nuevo. Es
  la más alineada con cómo US-031 dejó sus alertas. La UI de US-044 puede leerlas.
- **Opción 3.2 — flag/campo en la RESERVA** (p. ej. `alertaFianzaPendienteEnviada: Boolean`), que
  además resuelve la anti-duplicación (D-4). **Ventaja**: consulta directa desde la ficha/pipeline.
  **Coste**: migración; mezcla estado de negocio con estado de notificación.
- **Opción 3.3 — tabla de notificaciones nueva** (canal in-app formal). **Ventaja**: canal genérico
  reutilizable. **Inconveniente**: es construir infraestructura de notificaciones (alcance de US-044,
  no de US-037) → **fuera de alcance** aquí.

**Recomendación del autor: Opción 3.1** (alerta como entrada de `AUDIT_LOG`/rastro trazable de
Sistema, sin construir superficie nueva), complementada con el flag de D-4 solo si el gate quiere
anti-duplicación por columna. US-037 **produce** la alerta; su **materialización visual** (dónde la
ve el gestor) se alinea con US-044 y queda fuera de este change. **Pregunta para el humano**: ¿alerta
como rastro en `AUDIT_LOG` (3.1, recomendada), flag en la reserva (3.2), o se pospone a una
infraestructura de notificaciones (3.3, fuera de alcance)?

## D-4. Anti-duplicación de la alerta — DECISIÓN ABIERTA (gate) ⚠️

**Problema**: el barrido corre a diario; sin protección, una RESERVA con fianza pendiente generaría
una alerta idéntica **cada día** hasta que el gestor resuelva la fianza → ruido.

**Opciones**:

- **Opción 4.1 — flag `alertaFianzaPendienteEnviada: Boolean`** en la RESERVA, que se pone a `true`
  al emitir la alerta y se **resetea** cuando `fianza_status`/`fianza_eur` cambian (o cuando la
  RESERVA sale de `post_evento`). El barrido solo alerta si el flag es `false`. **Ventaja**: simple,
  determinista, consulta directa. **Coste**: migración (misma que D-3 Opción 3.2 si se comparte
  columna). Riesgo: hay que resetear el flag correctamente al resolver la fianza (US-036) o al
  cambiar de estado, o la alerta no se re-emitiría tras una regresión de estado (poco probable dado
  que `post_evento` no retrocede).
- **Opción 4.2 — idempotencia por `AUDIT_LOG`** (si D-3 = 3.1): antes de emitir, comprobar si ya
  existe una entrada de alerta `fianza_pendiente_t7d` para esa RESERVA **posterior** al último cambio
  de `fianza_status`. **Ventaja**: sin migración; consistente con D-3.1. **Inconveniente**: consulta
  extra por candidata; define "posterior al último cambio de fianza" con cuidado.

**Recomendación del autor: Opción 4.2** si se elige D-3 = 3.1 (coherencia, sin migración extra); u
**Opción 4.1** (flag) si el gate ya aprueba una migración por D-2/D-3 y prefiere una consulta
directa. **Pregunta para el humano**: ¿anti-duplicación por rastro en `AUDIT_LOG` (4.2) o por flag en
la reserva (4.1)? (Ligada a la respuesta de D-3.)

## D-5. Alcance de la "indexación" en Histórico (UC-32) — DECISIÓN ABIERTA (gate) ⚠️

**Problema**: la US habla de "indexar la reserva para búsqueda en el módulo Histórico". La propia US
aclara (Notas de alcance) que la "indexación" implica **visibilidad y filtrabilidad**, no un índice
técnico obligatorio; el mecanismo interno (índice Postgres full-text, TSVECTOR) es "decisión de
implementación, no requisito de esta historia".

**Recomendación del autor**: tratar la "indexación" como **visibilidad/filtrabilidad** — la RESERVA
en `reserva_completada` queda automáticamente consultable/filtrable en Histórico por el hecho de
estar en ese estado terminal (el pipeline activo, US-049, ya la excluye; el Histórico la incluye).
**Dejar FUERA DE ALCANCE el índice técnico full-text** salvo que ya exista uno. **Pregunta para el
humano**: ¿confirmamos que no se implementa índice full-text/TSVECTOR en este change (solo se
garantiza que el estado terminal la hace visible/filtrable en Histórico)? La **construcción de la UI
del Histórico** (UC-32) es de otra US.

## D-6. Transición de archivado como estructura de datos + guarda de fianza pura

La transición se modela como **tabla de datos** en `maquina-estados.ts` (skill `state-machine`, NO
`if` dispersos), consistente con `MAPA_FINALIZACION_EVENTO` (US-034) y `MAPA_INICIO_EVENTO` (US-031):

```
Archivado automático (guarda de ORIGEN):
  { post_evento, subEstado null } → { reserva_completada, null }
  (cualquier otro estado/sub-estado → no candidato: null, no-op)
reserva_completada es TERMINAL: no se añade arista de salida.
```

- El **filtro de candidatas** restringe a `estado = 'post_evento'` + antigüedad ≥ 7 días (D-2). La
  guarda de origen declarativa (p. ej. `resolverArchivadoAutomatico(estado, subEstado)`) se
  re-evalúa dentro de la transacción de cada RESERVA (base de la idempotencia y de la concurrencia
  cron↔US-038, D-6/D-7).
- **Guarda de fianza resuelta**: función de dominio **pura** (p. ej. `fianzaResuelta({ fianzaStatus,
  fianzaEur })`) que devuelve `true` si `fianzaStatus ∈ {devuelta, retenida_parcial}` **O** `fianzaEur
  <= 0` **O** `fianzaEur == null`; y devuelve además si está **pendiente** (para poblar la alerta de
  FA-01, D-3) sin lógica dispersa. Vive en dominio (sin `@nestjs`/Prisma). `retenida_parcial` con
  `fianza_devuelta_eur = 0` (retención 100%) es resuelto (no se distingue del importe > 0).
- La mutación acompañante es mínima: `RESERVA.estado = reserva_completada` + `AUDIT_LOG`. No hay
  side-effects sobre `FECHA_BLOQUEADA`, cola, FICHA_OPERATIVA ni facturación.

## D-7. Concurrencia — análisis de la race condition con US-038 (archivado manual)

A diferencia de US-012, US-037 **NO** toca `FECHA_BLOQUEADA`, cola ni bloqueo atómico de fecha: no
hay `UNIQUE(tenant_id, fecha)` ni promoción implicados. La zona crítica es la idempotencia y la
coordinación con el **archivado manual de US-038** (misma transición `post_evento →
reserva_completada`, disparada por el gestor):

- **RC-1 (doble ejecución del cron)**: dos pases concurrentes sobre la misma RESERVA → exactamente
  una transición. La transacción por RESERVA re-evalúa `estado` bajo `SELECT … FOR UPDATE`; el
  segundo lo encuentra ya `reserva_completada` y no muta nada (UPDATE 0 filas). Sin locks
  distribuidos (hook `no-distributed-lock`); la serialización la da PostgreSQL sobre la fila RESERVA.
- **RC-2 (cron US-037 vs gestor US-038)**: ambos intentan `post_evento → reserva_completada` a la vez
  → **exactamente uno** aplica la transición; el otro re-evalúa bajo el lock, la UPDATE afecta **0
  filas** y termina como **no-op sin error**. Nunca hay estado intermedio ni doble auditoría. El
  patrón "leer-verificar-actualizar" en una única transacción (idéntico al de US-031↔US-032 y al de
  la devolución de fianza de US-036) garantiza la invariante. **US-038 puede no estar implementado
  aún cuando se desarrolle US-037**: RC-2 se testea simulando el "segundo actor" (dos transacciones
  concurrentes con la misma guarda de origen sobre la fila RESERVA), dejando la coordinación real
  verificada cuando US-038 aterrice sobre esta misma guarda declarativa. **Nota de coordinación**:
  US-038 DEBE usar la misma guarda `resolverArchivadoAutomatico`/`SELECT … FOR UPDATE` para heredar
  la garantía; conviene que US-038 reutilice el helper de dominio que introduce US-037.
- Tests de concurrencia **reales** en la medida en que la infraestructura de tests lo permita (skill
  `concurrency-locking`, `Promise.allSettled`); como mínimo, tests deterministas de la idempotencia
  (2.ª ejecución no muta) y del aislamiento de fallos. **Recordatorio de entorno**: los subagentes QA
  corren sin Postgres real; los tests de integración/concurrencia se lanzan desde la sesión principal
  (memoria del proyecto). El flaky de US-004 (`40P01`) es ajeno; solo se vigila al leer la suite
  global.

## D-8. Hexagonal: dominio puro + caso de uso de aplicación + adaptadores

- **Dominio** (`reservas/domain`): la guarda/mapa de archivado (`resolverArchivadoAutomatico` o la
  tabla `MAPA_ARCHIVADO_AUTOMATICO`: `post_evento → reserva_completada`, terminal) en
  `maquina-estados.ts`, más la guarda pura de fianza (`fianzaResuelta`, que además indica si está
  pendiente). Nada de `@nestjs` ni Prisma (hook `no-infra-in-domain`).
- **Aplicación**: un caso de uso `ArchivarReservasCompletadasService` (o similar) con `ejecutar()`
  que (1) lista candidatas (`estado = 'post_evento'` AND antigüedad ≥ 7 días, según D-2), (2) por
  cada una abre una transacción, hace `SELECT … FOR UPDATE`, re-evalúa la guarda de origen + la de
  fianza, y: si cumple → transiciona a `reserva_completada` + audita como Sistema (`causa: 'T+7d'`);
  si la fianza está pendiente → emite alerta interna (D-3) con anti-duplicación (D-4), sin
  transicionar; (3) agrega el resumen con **fallo aislado por RESERVA**. Mismo aislamiento de lote
  que US-012/US-026/US-031.
- **Infraestructura**: adaptador Prisma para listar candidatas cross-tenant (selección por
  antigüedad según D-2) + UoW de transición (`$transaction` + `fijarTenant(tx, tenantId)` como
  PRIMERA operación + `SELECT … FOR UPDATE` sobre RESERVA, cross-tenant read / RLS write, patrón de
  `devolucion-fianza-uow.prisma.adapter.ts`); `AuditLogPort` compartido para la transición sin
  duplicar auditoría; `BarridoCompletadasController` (`POST /cron/barrido-completadas`, `@Public()` +
  `@UseGuards(CronTokenGuard)` + `@HttpCode(200)`) + `BarridoCompletadasScheduler` (`@Cron` diario).
  Registrado en `ReservasModule`, gemelo del `barrido-eventos` de US-031.
- **AUDIT_LOG**: `accion = 'transicion'`, `entidad = 'RESERVA'`, `datos_anteriores = {estado:
  post_evento}`, `datos_nuevos = {estado: reserva_completada, causa: 'T+7d'}`, origen Sistema
  (`usuarioId` nulo), vía el `AuditLogPort` compartido; no se duplica.

## D-9. Sin email, sin UI nueva (out-of-scope)

US-037 **NO** envía ningún email al cliente ni al gestor (`§Email relacionado`). NO construye la UI
del Histórico (UC-32), ni la superficie de notificaciones (US-044), ni la propuesta proactiva de
cierre en T+5d (`📐 solo diseñado`). El único efecto observable en UI es indirecto: la RESERVA sale
del pipeline activo (`GET /reservas` de US-049 ya excluye `reserva_completada`) y queda consultable
en Histórico. (`US-037 §Notas de alcance`, `§Email relacionado`.)

## Riesgos / Trade-offs

- **Medición de antigüedad en post_evento** (D-2): `fechaActualizacion` (`@updatedAt`) NO sirve;
  Opción A (nuevo campo) exige migración + tocar US-034 + backfill del residual; Opción B (AUDIT_LOG)
  evita migración pero acopla la selección al log. Decisión de gate.
- **Alerta interna sin infra de notificaciones** (D-3/D-4): se emite/registra de forma trazable sin
  bloquear el barrido; la UI de notificaciones es US-044. Decisión de gate sobre canal y
  anti-duplicación.
- **Coordinación con US-038 aún no implementado** (D-7): RC-2 se blinda con la guarda de origen
  re-evaluada bajo el lock, de modo que US-038 herede la misma garantía; conviene que US-038 reutilice
  el helper de dominio de US-037.
- **Definición de "hoy"/TZ** (D-2): el cálculo del umbral de 7 días naturales debe ser consistente
  con la zona horaria de negocio y NO depender de strings formateados (deuda de `formatearFechaHora`,
  ajena a este change).
- **Cross-tenant read + RLS write** (D-8): punto cross-tenant legítimo; se documenta y se testea que
  las escrituras nunca cruzan tenant.

## Pendiente / fuera de alcance

- **Archivado manual** por el gestor → **US-038** (misma transición; US-037 coordina la race
  condition y le presta la guarda de dominio).
- **Propuesta proactiva de cierre en T+5d** → `📐 solo diseñado`, sin código.
- **Módulo Histórico (UC-32)** y su UI de consulta/filtrado → otra US; US-037 solo deja la RESERVA en
  `reserva_completada`.
- **Índice técnico full-text/TSVECTOR** → fuera de alcance (D-5) salvo que ya exista.
- **Superficie de notificaciones del gestor** → **US-044** (US-037 solo produce la alerta y deja
  rastro).
- **Arreglo del off-by-one de TZ** en `formatearFechaHora` → change aparte.
- **E2E de navegador**: US-037 no introduce UI propia (actor Sistema) → step-N+3 marcado N/A
  justificado (ver tasks.md).

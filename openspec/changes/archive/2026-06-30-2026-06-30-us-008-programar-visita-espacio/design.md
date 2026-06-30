# Design — us-008-programar-visita-espacio

> Decisiones técnicas para la **transición de una consulta activa (`2.a`/`2.b`/`2.c`)
> a "visita programada" (`2.v`)** (US-008 / UC-07). Todo se apoya en código real ya
> en `master`; se prioriza **DRY + hexagonal** y la garantía de **atomicidad** de la
> mutación de RESERVA + `FECHA_BLOQUEADA` en el motor PostgreSQL. Este documento es el
> corazón del **Gate de revisión humana SDD**: las decisiones quedan abiertas a tu OK
> antes de tocar contrato/TDD/código. En especial **D-2** (insert-o-update del bloqueo),
> **D-6** (E6 post-commit) y **D-8** (A19/A20 dentro o fuera) requieren decisión humana.

Rutas reales citadas (todas en `apps/api/src/`, ya en `master` tras US-004/005/007/040/045):
- `reservas/domain/maquina-estados.ts` — máquina declarativa (`ORIGENES_TRANSICION_*`
  + tablas de reglas; US-004/005/007)
- `reservas/domain/bloquear-fecha.service.ts` — `resolverPlanBloqueo` + puerto (US-040)
- `reservas/infrastructure/fecha-bloqueada.prisma.adapter.ts` — `bloquearEnTx(tx, …)`
  reutilizable (US-040/004)
- `reservas/infrastructure/transicion-fecha-uow.prisma.adapter.ts` — UoW de transición
  con `SELECT … FOR UPDATE` sobre la fila bloqueante + retry-on-conflict (US-005/007)
- `reservas/infrastructure/tenant-settings.prisma.adapter.ts` — `obtener()`
- `reservas/infrastructure/sub-estado-consulta.mapper.ts` — `2a/2b/2c/2d/2y ↔ s…`
  (a extender con `2v ↔ s2v` si aún no está cableado)
- `reservas/application/obtener-reserva.query.ts` — read-model `GET /reservas/{id}` (US-005)
- el motor de email E1–E8 de US-045 (capability `comunicaciones`) — disparo de E6
- `prisma/schema.prisma` — columnas/enums de visita (`2v`, `visita_programada_*`,
  `visita_realizada`) y `TENANT_SETTINGS.max_dias_programar_visita` (US-000)

**Diferencia esencial con US-007**: US-007 opera siempre desde `2.b` (fila de
`FECHA_BLOQUEADA` ya existe → **UPDATE/extend** del TTL desde el setting de consulta) y
**vacía la cola**. US-008 admite **tres orígenes** (`2.a`/`2.b`/`2.c`), calcula el TTL
desde la **fecha de la visita** (`visita_programada_fecha + 1 día`), hace
**INSERT-o-UPDATE** de `FECHA_BLOQUEADA` según el origen, **no toca la cola** y **sí
envía un email catalogado (E6)**. El motor atómico (transacción + `FOR UPDATE` sobre la
fila bloqueante / `UNIQUE(tenant_id, fecha)` en el INSERT) es **el mismo y se reutiliza**.

---

## D-1. Guarda de origen multi-estado — extender la máquina declarativa

**Decisión**: añadir a `maquina-estados.ts`, **como dato** (tabla declarativa, no
condicionales dispersos), las transiciones permitidas
`{consulta,2a} → {consulta,2v}`, `{consulta,2b} → {consulta,2v}` y
`{consulta,2c} → {consulta,2v}`, modeladas como un conjunto de orígenes válidos
(`ORIGENES_TRANSICION_PROGRAMAR_VISITA = {2a,2b,2c}`). Todo origen distinto —`2.d`
(cola), `2.v`, los terminales `2.x`/`2.y`/`2.z`/`reserva_cancelada`/`reserva_completada`
(inmutables)— se rechaza **antes** de entrar en la transacción. Mismo patrón que
`esOrigenValidoParaAnadirFecha` + `ORIGENES_TRANSICION_*` de US-005/007. Skill
`state-machine`.

- **`2.d` → mensaje específico**: "No es posible programar una visita para una consulta
  en cola. La consulta debe ser promovida primero (UC-12)" (US-008 FA-01), distinto del
  rechazo genérico de terminal.
- **`2.a` → guarda adicional `fecha_evento IS NOT NULL`**: la guarda de origen para `2.a`
  incluye que `fecha_evento` esté definida; si es NULL, se informa de que debe
  introducirse primero (la acción queda bloqueada). Para `2.b`/`2.c` la fecha ya está
  fijada por definición.

`2.v` es un sub-estado ya presente en el enum de Prisma (`er-diagram.md §RESERVA`); el
mapper se extiende `2v ↔ s2v` si aún no está cableado. **Sin migración de enum** (D-7).

---

## D-2. Bloqueo `FECHA_BLOQUEADA` — INSERT-o-UPDATE según origen (refina la primitiva `fase '2.v'`) — PENDIENTE de Gate

**Tensión**: `er-diagram.md §3.16` mapea `fase '2.v' → {blando, ttl =
visita_programada_fecha + 1 día, modo: insert}`. Pero la US es explícita: si la RESERVA
**ya tenía** fila en `FECHA_BLOQUEADA` (origen `2.b`/`2.c`) **se actualiza** la
`ttl_expiracion` de la fila existente (no se crea otra); solo si venía de `2.a` **sin
bloqueo** se **crea** una fila nueva con `tipo_bloqueo = 'blando'`.

**Recomendación**: refinar `resolverPlanBloqueo({ fase: '2.v', ... })` para que devuelva
`accion: 'insert'` cuando el origen es `2.a` (sin fila) y `accion: 'update'` cuando el
origen es `2.b`/`2.c` (fila existente), conservando **una sola fuente de verdad** del
cálculo del TTL (`ttl = visita_programada_fecha + 1 día 23:59:59`). En la práctica la
distinción es robusta vía el `UNIQUE(tenant_id, fecha)`: un `INSERT … ON CONFLICT
(tenant_id, fecha) DO UPDATE SET ttl_expiracion = …` (upsert) cubre ambos casos de forma
atómica y sin race entre "comprobar si existe" e "insertar". `tipo_bloqueo` se fija/queda
en `'blando'`.

- **Cálculo del TTL**: `visita_programada_fecha + 1 día` con hora `23:59:59` (fin del día
  posterior a la visita). El "+1 día 23:59:59" se modela en la función pura del dominio
  (no en SQL disperso), reutilizando el patrón de `resolverPlanBloqueo`.
- **No se usa `max_dias_programar_visita` para el TTL**: ese setting acota la **ventana de
  entrada** (validación de `fecha_visita`), no el TTL del bloqueo. El TTL deriva de la
  fecha de visita elegida. Distinción importante frente a `2.b`/`2.c`, que usan
  `ttl_consulta_dias`.

**Decisión: PENDIENTE de aprobación humana en el Gate SDD.** El spec-delta refleja la
recomendación (insert-o-update / upsert según origen, TTL = visita +1 día). Si el humano
prefiere mantener literal el `modo: insert` del er-diagram y manejar el update fuera de la
primitiva, se ajusta; la semántica observable (fila única con el TTL correcto) es la misma.

---

## D-3. Nuevos campos de RESERVA y su inicialización

**Decisión**: la mutación de la RESERVA fija, en la misma transacción:
- `sub_estado = '2v'`,
- `visita_programada_fecha = fecha_visita` (DATE),
- `visita_programada_hora = hora_visita` (TIME),
- `visita_realizada = false` (se mantiene `false` hasta US-009/010/011).

Todas las columnas existen en el modelo (`er-diagram.md §RESERVA`: `visita_programada_fecha
DATE`, `visita_programada_hora TIME`, `visita_realizada BOOLEAN`). El read-model
`GET /reservas/{id}` se extiende para exponer estos campos en la respuesta (para el
feedback de la UI), reutilizando `obtener-reserva.query.ts`.

---

## D-4. Atomicidad e integración con el motor atómico de transición

**Decisión**: reutilizar el UoW de transición de US-005/007
(`transicion-fecha-uow.prisma.adapter.ts`). El use-case de transición a `2.v`:
1. Lee `TENANT_SETTINGS.max_dias_programar_visita` (vía `TenantSettingsPort`) para validar
   la ventana de la fecha.
2. Valida la guarda de origen declarativa (`{2a,2b,2c}` + `fecha_evento` si `2.a`) y la
   ventana de fecha (`[hoy+1, hoy+N]`) **antes** de abrir la transacción.
3. Resuelve el plan con `resolverPlanBloqueo({ fase: '2.v', visitaFecha, ahora })`
   (D-2) → `{ ttl = visita +1 día, accion: insert|update }`.
4. **En una única transacción** bajo contexto RLS del tenant:
   - `SELECT … FOR UPDATE` sobre la fila bloqueante de `FECHA_BLOQUEADA` para esa
     `(tenant_id, fecha_evento)` (serializa con el barrido A4 y con cualquier mutación
     concurrente del bloqueo).
   - UPDATE de la RESERVA (`sub_estado` + campos de visita, D-3).
   - INSERT-o-UPDATE (upsert) de `FECHA_BLOQUEADA` con el nuevo `ttl_expiracion` (D-2).
   - `AUDIT_LOG accion='transicion'` (`datos_anteriores.sub_estado`,
     `datos_nuevos.sub_estado='2v'`, `datos_nuevos.visita_programada_fecha`).
5. Tras el **commit**, dispara E6 (D-6).

**Atomicidad**: UPDATE de RESERVA + upsert de `FECHA_BLOQUEADA` + AUDIT_LOG son
**all-or-nothing**. Un fallo parcial hace rollback completo: nunca `2.v` sin
`FECHA_BLOQUEADA` actualizada/creada, ni viceversa. (`CLAUDE.md §Regla crítica`.)

---

## D-5. Endpoint de transición — acción sobre la RESERVA existente

**Decisión (recomendada): endpoint nuevo `POST /reservas/{id}/visita`** (acción de
transición sobre el agregado existente), siguiendo el precedente de US-005
(`POST /reservas/{id}/fecha`) y US-007 (`POST /reservas/{id}/pendiente-invitados`),
**no** un `PATCH /reservas/{id}` genérico.

Razones: es una **transición de máquina de estados** con guardas y efectos colaterales
(bloqueo de fecha, envío de E6, auditoría), no un update parcial arbitrario.

**Contrato previsto (input para la fase de contrato — NO se toca `docs/api-spec.yml` aquí)**:
```
POST /reservas/{id}/visita
Body:    { "fecha": "YYYY-MM-DD", "hora": "HH:mm" }   // fecha y hora de la visita
200:     RESERVA con subEstado='2v', visitaProgramadaFecha, visitaProgramadaHora,
         visitaRealizada=false, ttlExpiracion (nuevo)
409:     RESERVA en 2.d (cola): { motivo: "promover primero (UC-12)" }
422:     guarda de origen (no en 2a/2b/2c) o terminal (inmutable);
         o 2.a sin fecha_evento;
         o fecha fuera de [hoy+1, hoy+max_dias_programar_visita] (futura y dentro de N días)
404:     RESERVA inexistente para el tenant
401/403: sin sesión / rol insuficiente
```

> El `contract-engineer` (post-gate) afinará nombres/códigos. La asignación `409` (cola)
> vs `422` (validación) es semántica; aquí solo se fija la intención. Alternativa
> descartada: `PATCH /reservas/{id}` (menos expresiva para una transición con efectos).

---

## D-6. Envío de E6 — efecto posterior al commit (reuso del motor de US-045) — PENDIENTE de Gate

**Tensión**: la US exige que E6 se envíe y se registre en `COMUNICACION` "en todos los
casos de transición exitosa". Pero meter el envío de red (proveedor externo) **dentro**
de la transacción de BD acoplaría el commit del estado a la latencia/disponibilidad del
proveedor y podría revertir un estado correcto por un fallo de email.

**Recomendación**: separar **commit de estado** (RESERVA + FECHA_BLOQUEADA + AUDIT_LOG,
atómico, D-4) del **disparo de E6**, que se ejecuta **tras el commit** reutilizando el
motor de email de US-045. El registro en `COMUNICACION` (con `codigo_email='E6'`,
`estado='enviado'`, `reserva_id`, `cliente_id`, `tenant_id`) lo realiza el propio motor,
que ya traza el resultado y registra en `AUDIT_LOG`. Si el proveedor falla, el estado de
la visita NO se revierte (la transición es válida); el fallo de envío queda trazado en
`COMUNICACION` (estado distinto de `'enviado'`) para reintento/seguimiento, coherente con
el patrón de US-045.

- En `test`/CI el transporte de email está en **modo fake** (US-045): los tests verifican
  el disparo de E6 y el registro en `COMUNICACION` sin enviar correos reales.

**Decisión: PENDIENTE de Gate.** Si el humano exige E6 estrictamente dentro de la misma
transacción (registro de `COMUNICACION` transaccional con el envío diferido), se ajusta:
se inserta la fila `COMUNICACION` en la tx y el envío se hace post-commit (outbox-like).
La recomendación por defecto es: estado atómico + E6 post-commit trazado.

---

## D-7. Migración Prisma — confirmar NINGUNA — PENDIENTE de Gate (verificación)

Según `er-diagram.md`, todo lo necesario existe en el modelo:
- `Reserva`: `sub_estado` enum incluye `2v`; `visita_programada_fecha` (DATE),
  `visita_programada_hora` (TIME), `visita_realizada` (BOOLEAN).
- `FechaBloqueada`: `ttl_expiracion`, `tipo_bloqueo` (`blando`), `UNIQUE(tenant_id, fecha)`.
- `TenantSettings.max_dias_programar_visita` (INT, default 7).
- `AuditLog`: `accion='transicion'` ya usado por US-005/007.

**Recomendación: sin migración.** **Verificación pendiente** en la fase de implementación:
confirmar en `prisma/schema.prisma` de `master` que el enum incluye `s2v`, que las tres
columnas de visita existen y que `max_dias_programar_visita` está en el modelo y sembrado
(seed) con default 7. **Si faltara el seed/columna del setting, esa sería la única
migración** del change. (PENDIENTE de confirmación humana en el Gate.)

---

## D-8. Recordatorios A19/A20 — slice de jobs separado (recomendado) — PENDIENTE de Gate

**Tensión**: la US lista A19 (recordatorio el día de la visita) y A20 (alerta el día
posterior sin marcar resultado) en el alcance ✅ de la mecánica de visita. Pero son
**jobs de barrido** (patrón estado en fila + cron, idempotente, como A4), no parte de la
**transición** que esta US implementa.

**Recomendación**: este change entrega la **transición** (estado + campos de visita +
bloqueo + E6 + auditoría), que es lo que **habilita** A19/A20 (dejan los datos
`visita_programada_fecha`/`visita_realizada` sobre los que barren). A19/A20 se implementan
en un **slice de jobs separado** (mismo patrón que el barrido de TTLs A4/US-012),
manteniendo este change cohesionado y testeable. **Decisión: PENDIENTE de Gate.** Si el
humano prefiere incluir A19/A20 aquí, se amplían el spec-delta y `tasks.md` con el job de
barrido y sus tests de idempotencia.

---

## D-9. Concurrencia con el barrido de TTLs (A4 / US-012) — cobertura TDD-RED con tests reales

**Riesgo**: el barrido periódico de expiración (A4) podría intentar expirar la misma
RESERVA (su `ttl_expiracion` de `2.b`/`2.c` acaba de vencer) en el mismo instante en que
el gestor la transiciona a `2.v`.

**Decisión**: el `SELECT … FOR UPDATE` sobre la fila bloqueante de `FECHA_BLOQUEADA`
(D-4) actúa como punto de serialización. La transacción que commitea primero gana:
- Si gana la transición a `2.v`: la RESERVA queda en `2.v` con el TTL extendido a
  `visita +1 día`; el barrido opera después sobre un `ttl_expiracion` ya futuro y no
  expira nada.
- Si gana el barrido (expira `2.b`/`2.c` → `2.x`): la transición a `2.v` opera sobre una
  RESERVA ya en terminal y recibe la **guarda de origen** (rechazo), sin dejar estado
  inconsistente.

**Cobertura TDD-RED (skill `concurrency-locking`, tests reales contra PostgreSQL)**:
- Transición a `2.v` concurrente con el barrido A4 sobre la misma RESERVA → estado final
  coherente (o `2.v` con FECHA_BLOQUEADA actualizada, o terminal por barrido + transición
  rechazada), nunca `2.v` sin `FECHA_BLOQUEADA` actualizada ni viceversa.
- Dos transiciones simultáneas a `2.v` sobre la misma RESERVA → exactamente una aplica;
  la otra observa que ya no está en `{2a,2b,2c}` y recibe la guarda.
- Transición desde `2.a` (INSERT de `FECHA_BLOQUEADA`) concurrente con otro bloqueo de la
  misma fecha → el `UNIQUE(tenant_id, fecha)` serializa; una gana, la otra se reordena/
  resuelve sin duplicar fila.

---

## Resumen de decisiones para el Gate

| # | Decisión | Resolución propuesta | ¿Migración? |
|---|----------|----------------------|-------------|
| D-1 | Guarda de origen | Tabla declarativa `{2a,2b,2c}→2v`; `2.d` mensaje UC-12; `2.a` exige `fecha_evento`; terminales inmutables | No |
| D-2 | Bloqueo `FECHA_BLOQUEADA` | INSERT-o-UPDATE (upsert) según origen, TTL = visita +1 día 23:59:59 — refina `fase '2.v'` — **PENDIENTE de Gate** | No |
| D-3 | Campos de RESERVA | `2v` + `visita_programada_fecha/hora` + `visita_realizada=false`; read-model los expone | No |
| D-4 | Atomicidad | Reusar UoW de transición; RESERVA + FECHA_BLOQUEADA + AUDIT_LOG en una tx con `FOR UPDATE` | No |
| D-5 | Endpoint | `POST /reservas/{id}/visita` con `{fecha,hora}`; 200/409/422/404 | No |
| D-6 | Envío de E6 | Reuso motor US-045, **post-commit** trazado en `COMUNICACION` — **PENDIENTE de Gate** | No |
| D-7 | Migración | Ninguna (campos de visita + setting ya en `master`) — **verificar en impl** | No (a confirmar) |
| D-8 | Recordatorios A19/A20 | **Slice de jobs separado** (este change = transición) — **PENDIENTE de Gate** | No |
| D-9 | Concurrencia con barrido A4 | Serialización por `FOR UPDATE` sobre la fila bloqueante; TDD-RED real | No |

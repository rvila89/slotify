# Design — us-007-transicion-pendiente-invitados

> Decisiones técnicas para la **transición de una consulta con fecha bloqueada
> (`2.b`) a "pendiente de número de invitados" (`2.c`)** (US-007 / UC-06). Todo se
> apoya en código real ya en `master`; se prioriza **DRY + hexagonal** y la garantía
> de **atomicidad de las 4 operaciones** (sub_estado + TTL en RESERVA + TTL en
> FECHA_BLOQUEADA + vaciado de cola) en el motor PostgreSQL. Este documento es el
> corazón del **Gate de revisión humana SDD**: las decisiones quedan abiertas a tu OK
> antes de tocar contrato/TDD/código. En especial **D-1** (origen) y **D-7** (email
> de invitados sin E-code) requieren decisión humana explícita.

Rutas reales citadas (todas en `apps/api/src/`, ya en `master` tras US-004/005/040/045):
- `reservas/domain/maquina-estados.ts` — máquina declarativa
  (`ORIGENES_TRANSICION_ANADIR_FECHA` + tablas de reglas; US-004/005)
- `reservas/domain/bloquear-fecha.service.ts` — `resolverPlanBloqueo` + puerto (US-040)
- `reservas/infrastructure/fecha-bloqueada.prisma.adapter.ts` — `bloquearEnTx(tx, …)`
  reutilizable (US-040/004)
- `reservas/infrastructure/transicion-fecha-uow.prisma.adapter.ts` — UoW de
  transición con `SELECT … FOR UPDATE` sobre la fila bloqueante + retry-on-conflict
  (US-005)
- `reservas/infrastructure/tenant-settings.prisma.adapter.ts` — `obtener()`
- `reservas/infrastructure/sub-estado-consulta.mapper.ts` — `2a/2b/2d ↔ s2a/s2b/s2d`
  (a extender con `2c/2y ↔ s2c/s2y`)
- `reservas/application/obtener-reserva.query.ts` — read-model `GET /reservas/{id}`
  (US-005)
- `prisma/schema.prisma` — columnas e índices de cola/bloqueo/TTL y sub-estados
  (incluye `2c`, `2y`) (US-000/US-040/US-004)

**Diferencia esencial con US-005**: US-005 **fija** una fecha sobre un `2.a`
(INSERT en `FECHA_BLOQUEADA` + posible **entrada** en cola). US-007 opera sobre un
agregado que **ya tiene** fecha bloqueada (`2.b`): **no** inserta `FECHA_BLOQUEADA`
(la actualiza), y en lugar de **entrar** en cola, **vacía** la cola que apuntaba a
esta RESERVA. El motor atómico (transacción + `FOR UPDATE` sobre la fila bloqueante)
es **el mismo y se reutiliza**; lo nuevo es la guarda `2.b`, la **extensión** del TTL
(`fase '2.c'`) y el **vaciado** de la cola (`2.d → 2.y`).

---

## D-1. Origen de la transición — `2.b` estricto (recomendado) vs admitir `2.a`-con-bloqueo — PENDIENTE de Gate

**Tensión**: la ficha US-007 dice que el happy path canónico es `2.b → 2.c`, pero
añade entre paréntesis "(o `2.a` con fecha bloqueada activa, según UC-06
precondición)". UC-06 §Precondiciones lista "Consulta en sub-estado 2.a o 2.b".

**Recomendación: exigir `sub_estado = '2b'` como única origen del happy path**, y que
la condición real que se valida sea la **presencia de una fila activa en
`FECHA_BLOQUEADA`** con `ttl_expiracion > ahora`. En el modelo del proyecto, un `2.a`
**no tiene** fecha bloqueada (un `2.a` con bloqueo no es un estado alcanzable: en
cuanto se bloquea una fecha la RESERVA está en `2.b`, US-005). Por tanto "`2.a` con
bloqueo activo" es, en la práctica, equivalente a `2.b`. Modelar la guarda como
"origen `2.b` + bloqueo vigente" evita un estado fantasma y mantiene **una sola
fuente de verdad** sobre qué significa "tener fecha bloqueada".

**Decisión: PENDIENTE de aprobación humana en el Gate SDD.** El spec-delta refleja la
recomendación (origen `2.b`). Si el humano confirma que debe admitirse explícitamente
`2.a` con fila activa en `FECHA_BLOQUEADA`, se añadirá esa transición a la tabla
declarativa y a los escenarios.

---

## D-2. Endpoint de transición — recurso hijo / acción sobre la RESERVA existente

**Decisión (recomendada): endpoint nuevo `POST /reservas/{id}/pendiente-invitados`**
(acción de transición sobre el agregado existente), siguiendo el precedente de US-005
(`POST /reservas/{id}/fecha`), **no** un `PATCH /reservas/{id}` genérico.

Razones:
- Es una **transición de máquina de estados** con guardas y efectos colaterales
  (extensión de TTL en dos tablas, vaciado de cola, auditoría múltiple), no un update
  parcial arbitrario. Un verbo de acción dedicado lo modela con claridad.
- Coherencia con la convención ya aprobada en US-005 para transiciones de la consulta.

**Contrato previsto (input para la fase de contrato — NO se toca `docs/api-spec.yml`
aquí)**:
- `POST /reservas/{id}/pendiente-invitados`
- Body: vacío o `{}` (la acción no requiere parámetros; el TTL se deriva del setting).
- Respuestas:
  - `200 OK` — transición aplicada → devuelve la RESERVA con `subEstado = '2c'`,
    `ttlExpiracion` (nuevo) y, opcionalmente, `consultasDescartadas` (recuento de
    RESERVA de cola pasadas a `2.y`) para el feedback de la UI.
  - `409 Conflict` — RESERVA sin fila activa en `FECHA_BLOQUEADA`, o `ttl_expiracion <
    ahora` (bloqueo expirado): `{ motivo }`; la RESERVA no se modifica.
  - `422` — RESERVA no está en `2.b` (guarda de origen) o en estado terminal
    (inmutable).
  - `404` — RESERVA inexistente para el tenant; `401/403` — sin sesión/rol.

> El `contract-engineer` (post-gate) afinará nombres/códigos. Códigos `409` vs `422`
> se asignan a criterio del dueño del contrato; aquí solo se fija la semántica.

---

## D-3. Guarda de origen y destino — extender la máquina declarativa de US-004/005

**Decisión**: añadir a `maquina-estados.ts`, **como dato** (tabla declarativa, no
condicionales dispersos), la transición permitida `{consulta, 2b} → {consulta, 2c}`,
con la guarda de **bloqueo vigente** (`ttl_expiracion > ahora` + fila activa en
`FECHA_BLOQUEADA`). Cualquier origen distinto de `2.b` —incluidos `2.a`, `2.c`, `2.v`,
y los terminales `2.x`/`2.y`/`2.z`/`reserva_cancelada`/`reserva_completada`
(inmutables)— se rechaza **antes** de entrar en la transacción. Mismo patrón que
`esOrigenValidoParaAnadirFecha` + `ORIGENES_TRANSICION_ANADIR_FECHA` de US-005. Skill
`state-machine`.

`2.y` (destino del vaciado de cola) y `2.c` son sub-estados ya presentes en el enum
de Prisma y en el mapper (a extender `2c/2y ↔ s2c/s2y` si aún no está cableado en el
adapter). **Sin migración de enum.**

---

## D-4. Extensión atómica del TTL — reusar `resolverPlanBloqueo({ fase: '2.c' })`

**Decisión (recomendada): reutilización real, cero SQL nuevo de bloqueo.** La
primitiva ya está modelada (`er-diagram.md §3.16`):

| fase | tipo | nuevo ttl | acción |
|------|------|-----------|--------|
| `2.c` | blando | `ttl_actual + ttl_consulta_dias` | `extend` |

El use-case de transición:
1. Lee `TENANT_SETTINGS.ttl_consulta_dias` (vía `TenantSettingsPort`).
2. Llama a `resolverPlanBloqueo({ fase: '2.c', ahora, settings })` → plan con
   `accion: 'extend'` y `ttl = ttl_actual + ttl_consulta_dias` (la base es el
   `ttl_expiracion` **actual** de la RESERVA, no `now()`).
3. **En la misma transacción** que la mutación de la RESERVA (`2b → 2c` + nuevo
   `ttl_expiracion`) hace `SELECT … FOR UPDATE` sobre la fila de `FECHA_BLOQUEADA` de
   esta RESERVA y **actualiza** su `ttl_expiracion` al nuevo valor.
4. Escribe el `AUDIT_LOG` (`accion='transicion'`) de la principal en la misma
   transacción.

> Si `resolverPlanBloqueo` aún no contempla la rama `extend` con base en el TTL
> actual, se añade esa rama **a la función pura existente** (una sola fuente de
> verdad), no un cálculo nuevo en el use-case. **No se reinventa el bloqueo** (regla
> dura: PostgreSQL `SELECT … FOR UPDATE` + `UNIQUE(tenant_id, fecha)`; nada de
> Redis/Redlock).

A diferencia de US-005, aquí **no se inserta** `FECHA_BLOQUEADA` (ya existe): se hace
un **UPDATE** del `ttl_expiracion` de la fila bloqueante.

---

## D-5. Vaciado atómico de la cola (A16) — `2.d → 2.y` en la misma transacción

**Decisión**: dentro de la misma transacción de la transición, ejecutar un **UPDATE
masivo** sobre todas las RESERVA con `consulta_bloqueante_id = id de esta RESERVA` y
`sub_estado = '2d'`:
- `sub_estado = '2y'` (descartada por cola, **terminal**),
- `posicion_cola = NULL`,
- `consulta_bloqueante_id = NULL`.

Detalles:
- **Serialización**: el `SELECT … FOR UPDATE` sobre la fila bloqueante de
  `FECHA_BLOQUEADA` (D-4) actúa como punto de serialización; una promoción/salida de
  cola concurrente (UC-12/13) sobre la misma fecha espera o se reordena, de modo que
  el vaciado opera sobre un conjunto coherente. (Mismo lock que US-005 usa para
  serializar `posicion_cola`.)
- **Cola vacía**: si no hay filas en `2.d` apuntando a esta RESERVA, el UPDATE afecta
  a **0 filas** y la transición se completa sin error (no es condición de fallo).
- **Irreversibilidad**: `2.y` es terminal; el vaciado no se deshace.
- **Auditoría**: se registra en `AUDIT_LOG` la transición de la RESERVA principal
  (`2b → 2c`) **y** las actualizaciones de cada RESERVA descartada (`2d → 2y`), en la
  misma transacción.

**Atomicidad de las 4 operaciones**: sub_estado RESERVA + TTL RESERVA + TTL
`FECHA_BLOQUEADA` + vaciado de cola son **una única transacción**. Un fallo parcial
hace rollback completo: nunca `2.c` con cola sin vaciar ni viceversa.

---

## D-5b. Concurrencia D13/D4 — cobertura TDD-RED con tests reales

**Cobertura TDD-RED (skill `concurrency-locking`, tests reales contra PostgreSQL)**:
- RESERVA en `2.b` bloqueante de N consultas en `2.d`; transición a `2.c` concurrente
  con una operación de cola (p. ej. UC-13 salida voluntaria) sobre la misma fecha →
  estado final coherente: RESERVA en `2.c` + TTL extendido en ambas tablas + **0**
  consultas en `2.d` apuntando a esta RESERVA (todas en `2.y` o las que salieron por
  su vía), sin estados intermedios observables.
- Dos transiciones simultáneas a `2.c` sobre la misma RESERVA → **idempotencia /
  exactamente-una**: una aplica el cambio, la otra observa que ya no está en `2.b` y
  recibe la guarda de origen (sin doble extensión de TTL, sin doble vaciado).
- Transición a `2.c` con cola vacía → 0 filas afectadas, sin error.

---

## D-6. Endpoint API previsto (input para la fase de contrato)

**Resumen para el `contract-engineer`** (NO se toca `docs/api-spec.yml` en este change):

```
POST /reservas/{id}/pendiente-invitados
Body:    {}  (sin parámetros; TTL desde TENANT_SETTINGS.ttl_consulta_dias)
200:     RESERVA con subEstado='2c', ttlExpiracion (nuevo), consultasDescartadas?
409:     { motivo }  // sin FECHA_BLOQUEADA activa o ttl_expiracion < ahora (bloqueo expirado)
422:     RESERVA no en 2b (guarda de origen) o en estado terminal (inmutable)
404:     RESERVA inexistente para el tenant
401/403: sin sesión / rol insuficiente
```

Alternativa considerada y descartada: `PATCH /reservas/{id}` con `subEstado` — menos
expresiva para una transición con efectos colaterales (extensión de TTL en dos tablas,
vaciado de cola), igual que en US-005 (D-2).

---

## D-7. Email al cliente solicitando nº de invitados (UC-06 paso 7) — GAP de spec, PENDIENTE de Gate

**Tensión**: UC-06 paso 7 describe un email al cliente solicitando el número de
invitados, pero §9.3 **no le asigna un código `E` (E1–E8)**. La regla del proyecto
**prohíbe referenciar emails fuera de E1–E8**.

**Recomendación**: tratar este email como **gap de spec** y **NO implementarlo** en
este change. Se documenta como fuera de alcance hasta que el product owner decida:
(a) catalogarlo como un nuevo E-code, o (b) gestionarlo manualmente desde el log de
comunicaciones en MVP. La **mecánica** de la transición (estado, TTL, vaciado de cola,
auditoría) es completa y entregable sin este email.

**Decisión: PENDIENTE de confirmación del product owner en el Gate SDD.** El spec-delta
lo marca explícitamente como fuera de alcance.

> **Emails de vaciado de cola (A16)**: los emails automáticos a los clientes en `2.d`
> notificando el descarte son **📐 solo diseñados en MVP**. La **mecánica** del vaciado
> (`2.d → 2.y`) sí se implementa; los emails de cola **no**. El gestor ve el resultado
> en la UI de cola (UC-11).

---

## D-8. Migración Prisma — NINGUNA

Todas las columnas, enums e índices necesarios existen en `master`:
- `Reserva`: `sub_estado` (enum con `s2c`, `s2y`), `ttl_expiracion`, `posicion_cola`,
  `consulta_bloqueante_id` (+ self-relation `ColaEspera`).
- `FechaBloqueada`: `ttl_expiracion`, `UNIQUE(tenant_id, fecha)`.
- `TenantSettings.ttl_consulta_dias` (NOT NULL; default 3 vía seed).
- `AuditLog`: `accion='transicion'` ya usado por US-005.

**Conclusión: sin migración.** US-007 es puramente una nueva operación sobre el modelo
ya existente.

---

## Resumen de decisiones para el Gate

| # | Decisión | Resolución propuesta | ¿Migración? |
|---|----------|----------------------|-------------|
| D-1 | Origen de la transición | **`2.b` estricto + bloqueo vigente** ("2.a con bloqueo" ≡ 2.b); admitir 2.a explícito — **PENDIENTE de Gate** | No |
| D-2 | Endpoint | `POST /reservas/{id}/pendiente-invitados` (acción de transición) | No |
| D-3 | Guarda de origen/destino | Tabla declarativa `{2b}→{2c}`; terminales inmutables | No |
| D-4 | Extensión TTL | Reusar `resolverPlanBloqueo({fase:'2.c'})` (extend, base ttl actual) + UPDATE FECHA_BLOQUEADA en la tx | No |
| D-5 | Vaciado de cola A16 | UPDATE masivo `2d→2y` + NULL en la misma tx; serializado por `FOR UPDATE` de la fila bloqueante | No |
| D-6 | Contrato | Endpoint de transición sin body; 200/409/422/404 | No |
| D-7 | Email invitados (UC-06 p7) | **Gap de spec, fuera de alcance** — confirmar con PO — **PENDIENTE de Gate** | No |
| D-8 | Migración | Ninguna (sub-estados `2c`/`2y` y campos de cola/TTL ya en `master`) | No |

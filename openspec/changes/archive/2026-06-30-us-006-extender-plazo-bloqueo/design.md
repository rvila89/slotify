# Design — us-006-extender-plazo-bloqueo

> Decisiones técnicas para el **override manual del Gestor que extiende el TTL del
> bloqueo blando activo** de una RESERVA antes de que expire (US-006 / UC-05). Todo
> se apoya en código real ya en `master`; se prioriza **DRY + hexagonal** y la
> garantía de **atomicidad de las 3 operaciones** (TTL en RESERVA + TTL en
> FECHA_BLOQUEADA + AUDIT_LOG) y la **serialización frente al barrido de expiración**
> (US-012) en el motor PostgreSQL. Este documento es el corazón del **Gate de
> revisión humana SDD**: las decisiones quedan abiertas a tu OK antes de tocar
> contrato/TDD/código. En especial **D-1** (guarda multi-estado) y **D-3** (códigos
> HTTP) conviene confirmarlos.

Rutas reales citadas (todas en `apps/api/src/`, ya en `master` tras
US-004/005/007/008/040/041/045):
- `reservas/domain/maquina-estados.ts` — máquina declarativa
  (`ORIGENES_TRANSICION_*` + tablas de reglas; US-004/005/007/008)
- `reservas/domain/bloquear-fecha.service.ts` — `resolverPlanBloqueo` + puerto;
  fase `2.c → extend` ya modelada (US-040/007)
- `reservas/infrastructure/fecha-bloqueada.prisma.adapter.ts` — `bloquearEnTx(tx, …)`
  reutilizable (US-040/004)
- `reservas/infrastructure/transicion-fecha-uow.prisma.adapter.ts` — UoW con
  `SELECT … FOR UPDATE` sobre la fila bloqueante + retry-on-conflict (US-005/007/008)
- `reservas/infrastructure/tenant-settings.prisma.adapter.ts` — `obtener()`
- `reservas/application/obtener-reserva.query.ts` — read-model `GET /reservas/{id}`
  (US-005)
- `shared/audit/` — `AuditLogPort` (`accion='actualizar'` ya soportada)
- `prisma/schema.prisma` — `ttl_expiracion` (RESERVA y FechaBloqueada),
  `tipo_bloqueo`, sub-estados/estados (todos ya presentes)

**Diferencia esencial con US-005/007/008**: aquéllas son **transiciones de máquina de
estados** (cambian `sub_estado`/`estado` + efectos colaterales). US-006 **NO es una
transición**: es una **prórroga pura del TTL** sobre un bloqueo blando ya existente,
que **conserva** estado/sub_estado/tipo_bloqueo/fecha. Por eso **no entra en
`maquina-estados.ts` como transición**; lo que sí se modela como dato es la **guarda
de precondición** ("¿este estado tiene bloqueo blando extensible?"). El motor atómico
(transacción + `FOR UPDATE` sobre la fila bloqueante) es **el mismo y se reutiliza**.

---

## D-1. Guarda de "bloqueo activo extensible" — dato declarativo multi-estado — recomendado

**Tensión**: la condición de US-006 abarca varios estados:
`sub_estado ∈ {2b, 2c, 2v}` O `estado = 'pre_reserva'`, y excluye `2a`, los
terminales y `reserva_confirmada` (firme). No es una transición origen→destino sino
una **precondición** sobre el estado actual.

**Recomendación**: modelar la guarda como **predicado declarativo**
`esEstadoConBloqueoBlandoExtensible(estado, subEstado)` respaldado por una tabla de
datos en `maquina-estados.ts` (mismo estilo que `ORIGENES_TRANSICION_*`), **no** como
condicionales dispersos. La condición **real** que se valida en runtime es la
**presencia de una fila activa en `FECHA_BLOQUEADA` con `tipo_bloqueo = 'blando'` y
`ttl_expiracion > ahora`** para `(tenant_id, fecha_evento)`; el predicado de estado es
la defensa rápida previa (rechaza `2a`/terminales/`reserva_confirmada` antes de tocar
la BD). Esto evita un estado fantasma y mantiene **una sola fuente de verdad** sobre
qué significa "tener bloqueo blando vigente".

**Decisión: PENDIENTE de aprobación humana en el Gate SDD.** El spec-delta refleja la
recomendación (predicado declarativo + precondición de fila blanda vigente).

---

## D-2. Endpoint — acción sobre la RESERVA existente, con body `{ dias }`

**Decisión (recomendada): endpoint nuevo `POST /reservas/{id}/extender-bloqueo`**
(acción sobre el agregado existente), siguiendo el precedente de US-005
(`POST /reservas/{id}/fecha`), US-007 (`/pendiente-invitados`) y US-008 (`/visita`),
**no** un `PATCH /reservas/{id}` genérico.

Razones:
- Es una **acción de override con efectos colaterales** (extensión de TTL en dos
  tablas, auditoría, reprogramación implícita de recordatorios), no un update parcial
  arbitrario. Un verbo de acción dedicado lo modela con claridad.
- Coherencia con la convención ya aprobada para acciones sobre la consulta.

**Contrato previsto (input para la fase de contrato — NO se toca `docs/api-spec.yml`
aquí)**:
- `POST /reservas/{id}/extender-bloqueo`
- Body: `{ "dias": <integer ≥ 1> }` (entero positivo; la validación de tipo/rango la
  hace el DTO y, de nuevo, el dominio).
- Respuestas:
  - `200 OK` — extensión aplicada → devuelve la RESERVA con `ttlExpiracion` (nuevo) y
    `estado`/`subEstado` sin cambios, para el feedback de la UI.
  - `409 Conflict` — RESERVA sin fila activa en `FECHA_BLOQUEADA`, o `ttl_expiracion <
    ahora` (bloqueo expirado), o `tipo_bloqueo = 'firme'` (reserva_confirmada, sin
    TTL): `{ motivo }`; la RESERVA no se modifica.
  - `422 Unprocessable Entity` — estado sin bloqueo activo extensible
    (`2a`/terminal) — guarda de precondición; o `dias` inválido (0/negativo/no
    entero) — validación de cuerpo.
  - `404` — RESERVA inexistente para el tenant; `401/403` — sin sesión/rol.

> El `contract-engineer` (post-gate) afinará nombres/códigos. La asignación exacta
> `409` vs `422` para cada edge case se decide en D-3; aquí solo se fija la
> semántica.

---

## D-3. Códigos HTTP de los edge cases — PENDIENTE de confirmación en el Gate

**Tensión**: hay cuatro condiciones de rechazo con naturaleza distinta:

| Edge case | Naturaleza | Código propuesto |
|-----------|-----------|------------------|
| TTL ya expirado (`ttl < ahora`) | conflicto de estado en el tiempo | `409` |
| `reserva_confirmada` (bloqueo firme sin TTL) | conflicto de estado | `409` |
| Estado sin bloqueo (`2a`/terminal) | precondición de estado no satisfecha | `422` |
| `dias` 0/negativo/no entero | validación de cuerpo | `422` |

**Recomendación**: seguir el precedente de US-007/008 — `409` para condiciones de
**conflicto con el estado del bloqueo en BD** (expirado / firme / sin fila bloqueante)
y `422` para **guarda de precondición de estado** y **validación de cuerpo**. El
mensaje de error es explícito en español en todos los casos.

**Decisión: PENDIENTE de confirmación humana en el Gate SDD.** El spec-delta describe
la **semántica** (qué se rechaza y por qué) sin acoplarse a un código HTTP concreto;
el `contract-engineer` fija los códigos finales tras el OK.

---

## D-4. Extensión atómica del TTL — generalizar la base de días sin tocar `bloqueo-fecha`

**Decisión (recomendada): reutilización real, cero SQL nuevo de bloqueo.** La
capability `bloqueo-fecha` ya modela la **extensión** de un bloqueo blando (fase
`2.c → extend`, `er-diagram.md §3.6`), pero con base fija `ttl_consulta_dias`. US-006
necesita una base **arbitraria `N` días** indicada por el gestor.

El use-case de extensión (`extender-bloqueo.use-case.ts`):
1. Carga la RESERVA bajo RLS y valida la **guarda de precondición** (D-1):
   `esEstadoConBloqueoBlandoExtensible` + fila blanda vigente (`ttl_expiracion >
   ahora`). Si no aplica → error tipado (TTL expirado / sin bloqueo / firme).
2. Valida `dias` como **entero ≥ 1** en dominio (defensa además del DTO).
3. Calcula `nuevoTtl = ttl_expiracion_actual + dias` (base = TTL **actual**, no
   `now()`). **No** se usa `ttl_consulta_dias`; la base de días es el parámetro `N`.
4. **En la misma transacción** (UoW reutilizada de US-005/007/008): `SELECT … FOR
   UPDATE` sobre la fila de `FECHA_BLOQUEADA` de esta RESERVA →
   - UPDATE `RESERVA.ttl_expiracion = nuevoTtl` (sin tocar estado/sub_estado),
   - UPDATE `FECHA_BLOQUEADA.ttl_expiracion = nuevoTtl` (sin tocar
     tipo_bloqueo/fecha),
   - INSERT `AUDIT_LOG` (`accion='actualizar'`, `datos_anteriores/nuevos.ttl_expiracion`).

**No se reinventa el bloqueo** (regla dura: PostgreSQL `SELECT … FOR UPDATE` +
`UNIQUE(tenant_id, fecha)`; nada de Redis/Redlock). La capability `bloqueo-fecha`
**no necesita delta**: la "extensión de TTL de un bloqueo blando" ya está en su
modelo; lo único nuevo (base `N` arbitraria) vive en el **use-case invocante**, no en
la primitiva. Si se prefiere, puede ofrecerse `resolverPlanBloqueo({ fase: '2.c',
diasExtension: N })` como pequeña generalización de la función pura existente (una
sola fuente de verdad) — a decidir en implementación, sin cambiar el contrato externo.

---

## D-5. Reprogramación de recordatorios A3/A4/A5 — implícita vía el barrido, sin scheduler

**Decisión**: **no se programa ni cancela ningún job**. Por el patrón
**estado-en-fila + barrido periódico** (`architecture.md §2.5`), los recordatorios y
la expiración (A3/A4/A5) **se derivan de `ttl_expiracion`**: un cron (US-012,
pendiente) barre periódicamente las filas y decide qué disparar comparando contra el
`ttl_expiracion` **actual**. Por tanto, **extender `ttl_expiracion` reprograma
A3/A4/A5 automáticamente**: la siguiente pasada del barrido ya usa el nuevo valor.

Implicaciones:
- US-006 **no** introduce una tabla de jobs, ni timers, ni cancelación de
  recordatorios. La "reprogramación" es un **efecto emergente** de cambiar el dato.
- El spec-delta lo expresa como requisito de comportamiento observable (los
  recordatorios se evalúan contra la nueva fecha), no como un mecanismo a implementar.
- A3 (recordatorio intermedio a día+2 desde la base, si el estado lo contempla) y
  A4/A5 (expiración al vencimiento) se benefician del mismo cambio de dato.

---

## D-6. Endpoint API previsto (input para la fase de contrato)

**Resumen para el `contract-engineer`** (NO se toca `docs/api-spec.yml` en este change):

```
POST /reservas/{id}/extender-bloqueo
Body:    { "dias": <integer ≥ 1> }
200:     RESERVA con ttlExpiracion (nuevo); estado/subEstado sin cambios
409:     { motivo }  // sin FECHA_BLOQUEADA activa, ttl_expiracion < ahora (expirado), o tipo_bloqueo='firme'
422:     estado sin bloqueo activo extensible (2a/terminal) | dias inválido (0/negativo/no entero)
404:     RESERVA inexistente para el tenant
401/403: sin sesión / rol insuficiente
```

Alternativa considerada y descartada: `PATCH /reservas/{id}` con `ttlExpiracion` —
menos expresiva para una acción de override con efectos colaterales y permitiría
fijar TTL arbitrarios (incluido acortar), fuera de alcance. (Mismo criterio que
US-005 D-2.)

---

## D-7. Concurrencia frente al barrido de expiración (US-012) — TDD-RED con tests reales

**Riesgo**: la extensión y el barrido de expiración (A4/A5, US-012) pueden competir
por la misma fila bloqueante en el límite del vencimiento. Una extensión **no debe
resucitar** un bloqueo ya expirado-y-procesado, ni dejar el bloqueo medio extendido.

**Decisión**: la extensión hace `SELECT … FOR UPDATE` sobre la fila bloqueante de
`FECHA_BLOQUEADA` **dentro de la transacción** (mismo punto de serialización que
US-005/007/008). El barrido (cuando exista, US-012) tomará el mismo lock. Resultados
deterministas:
- Si la extensión commitea primero: el barrido ve el TTL ya extendido y no expira.
- Si el barrido commitea primero (ya expiró el bloqueo): la extensión, al leer bajo el
  lock, observa `ttl_expiracion < ahora` (o la RESERVA ya transicionada por A4/A5) y se
  **rechaza** sin mutar.

**Cobertura TDD-RED (skill `concurrency-locking`, tests reales contra PostgreSQL)**:
- Extensión en el límite del vencimiento concurrente con una expiración simulada del
  barrido sobre la misma fila → estado final coherente (extensión aplicada y bloqueo
  vigente, **o** bloqueo expirado y extensión rechazada), sin estados intermedios.
- Dos extensiones simultáneas sobre la misma RESERVA → serialización determinista, sin
  lost-update.
- Como el barrido US-012 aún no existe, los tests **simulan** su acción (UPDATE/DELETE
  sobre la fila bloqueante bajo lock) para verificar la serialización; quedan listos
  para acoplarse al barrido real cuando se implemente.

---

## D-8. Invariancia de estado/sub_estado/tipo_bloqueo/fecha

**Decisión**: el use-case **no** escribe `estado`, `sub_estado`, `tipo_bloqueo` ni
`fecha` (de FECHA_BLOQUEADA). Solo toca `ttl_expiracion` en ambas tablas y
`AUDIT_LOG`. Esto es **invariante de la operación** y se cubre con asserts explícitos
en los tests (RED): tras la extensión, todos esos campos son idénticos a los previos.
Los check constraints existentes (`chk_blando_con_ttl`) siguen satisfechos (un blando
con TTL extendido sigue siendo un blando con TTL no nulo).

---

## D-9. Migración Prisma — NINGUNA

Todas las columnas, enums e índices necesarios existen en `master`:
- `Reserva`: `ttl_expiracion`, `estado`, `sub_estado` (enum completo).
- `FechaBloqueada`: `ttl_expiracion`, `tipo_bloqueo`, `UNIQUE(tenant_id, fecha)`,
  check constraints `chk_firme_sin_ttl`/`chk_blando_con_ttl`.
- `AuditLog`: `accion = 'actualizar'` ya en el enum (usado por otras US).

**Conclusión: sin migración.** US-006 es puramente una nueva operación (override de
TTL) sobre el modelo ya existente.

---

## Resumen de decisiones para el Gate

| # | Decisión | Resolución propuesta | ¿Migración? |
|---|----------|----------------------|-------------|
| D-1 | Guarda de bloqueo extensible | Predicado declarativo multi-estado (`2b/2c/2v`+`pre_reserva`) + precondición de fila blanda vigente — **PENDIENTE de Gate** | No |
| D-2 | Endpoint | `POST /reservas/{id}/extender-bloqueo` body `{ dias }` (acción de override) | No |
| D-3 | Códigos HTTP edge cases | `409` (expirado/firme/sin fila) vs `422` (precondición estado / dias inválido) — **PENDIENTE de Gate** | No |
| D-4 | Extensión TTL | Reusar primitiva de bloqueo; base de días `N` arbitraria en el use-case; UPDATE RESERVA + FECHA_BLOQUEADA en la tx | No |
| D-5 | Recordatorios A3/A4/A5 | Reprogramación **implícita** vía barrido (estado-en-fila); sin scheduler | No |
| D-6 | Contrato | Endpoint con `{ dias }`; 200/409/422/404 | No |
| D-7 | Concurrencia vs barrido US-012 | `SELECT … FOR UPDATE` sobre fila bloqueante; tests reales que simulan el barrido | No |
| D-8 | Invariancia estado/tipo/fecha | Solo se toca `ttl_expiracion` + AUDIT_LOG; asserts en TDD | No |
| D-9 | Migración | Ninguna (`ttl_expiracion`, `tipo_bloqueo`, `accion='actualizar'` ya en `master`) | No |

# Design — us-005-transicion-exploratoria-a-con-fecha

> Decisiones técnicas para la **transición de una consulta exploratoria existente
> (`2.a`) a consulta con fecha (`2.b`)** (US-005 / UC-04). Todo se apoya en código real
> ya en `master`; se prioriza **DRY + hexagonal** y la garantía D4 (anti-doble-reserva)
> en el motor PostgreSQL. Este documento es el corazón del **Gate de revisión humana
> SDD**: las decisiones quedan abiertas a tu OK antes de tocar contrato/TDD/código. En
> especial **D-1** (regla de fecha) requiere decisión humana explícita.

Rutas reales citadas (todas en `apps/api/src/`, ya en `master` tras US-004/040/045):
- `reservas/domain/maquina-estados.ts` — máquina declarativa con
  `determinarAltaConFecha` + `REGLAS_ALTA_CON_FECHA` + `ENTRADAS_INICIALES` (US-004)
- `reservas/domain/bloquear-fecha.service.ts` — `resolverPlanBloqueo` + puerto (US-040)
- `reservas/infrastructure/fecha-bloqueada.prisma.adapter.ts` — `bloquearEnTx(tx, …)`
  reutilizable + `bloquear()` wrapper (US-040, extraído en US-004)
- `reservas/infrastructure/unidad-de-trabajo.prisma.adapter.ts` — UoW + retry-on-conflict
  (generalizado a `codigo`/`posicion_cola` en US-004)
- `reservas/infrastructure/tenant-settings.prisma.adapter.ts` — `obtener()`
- `reservas/infrastructure/sub-estado-consulta.mapper.ts` — `2a/2b/2d ↔ s2a/s2b/s2d`
- `comunicaciones/**` — motor de email real (US-045)
- `prisma/schema.prisma` — columnas e índices de cola/bloqueo (US-000/US-040/US-004)

**Diferencia esencial con US-004**: US-004 **crea** un lead nuevo (`POST /reservas`);
US-005 **muta un agregado RESERVA existente** que ya está en `2.a`. El núcleo
(determinación de sub-estado, bloqueo atómico, cola, D4) es **idéntico y se reutiliza**;
lo nuevo es la **guarda de origen `2.a`**, el **endpoint de transición** y el **flujo
interactivo de la cola** (el gestor acepta/rechaza, no es automático como en el alta).

---

## D-1. Regla de fecha — `≥ hoy` (ficha) vs `> hoy` (recomendado) — PENDIENTE de Gate

**Tensión**: la ficha US-005 dice `fecha_evento ≥ hoy` (admite **hoy**). Pero esta US
**reutiliza la primitiva de bloqueo de US-040**, cuya `validarFechaFutura` exige
**estrictamente futura (`> hoy`)**, y US-004 ya fijó por decisión humana (Gate 1,
decisión A) la regla unificada `> hoy` en todo el alta-con-fecha.

**Recomendación**: implementar `> hoy` (estrictamente futura), rechazando **hoy y
pasado** con error de validación sin efectos, para mantener **una sola regla de "fecha
válida"** en el proyecto, coherente con US-040 (bloqueo), US-016 (tarifa) y US-004
(alta). Si se reutiliza `bloquearEnTx`/`validarFechaFutura` tal cual, el servidor
**rechazaría hoy de todos modos**; mantener `≥ hoy` exigiría bifurcar la regla de fecha
solo para esta transición (más código, divergencia con el resto).

**Decisión: PENDIENTE de aprobación humana en el Gate SDD.** El spec-delta refleja la
recomendación (`> hoy`) con nota de divergencia explícita. Si el humano prefiere honrar
la ficha (`≥ hoy`), se ajustará el spec-delta y la implementación bifurcará la validación
de fecha para esta US.

---

## D-2. Endpoint de transición — recurso hijo sobre la RESERVA existente

**Decisión (recomendada): endpoint nuevo `POST /reservas/{id}/fecha`** (acción de
transición sobre el agregado existente), **no** un `PATCH /reservas/{id}` genérico.

Razones:
- US-005 no es un "update parcial" arbitrario: es una **transición de máquina de
  estados** con guardas, efectos colaterales (bloqueo, cola, auditoría, email) y un
  flujo interactivo (oferta de cola). Un verbo de acción dedicado lo modela con más
  claridad que un PATCH genérico que invitaría a editar otros campos.
- Mantiene `POST /reservas` (US-003/004, alta) separado de la **transición** de un lead
  existente: distinta semántica, distinto cuerpo, distinta autorización.

**Contrato previsto (input para la fase de contrato — NO se toca `docs/api-spec.yml`
aquí)**:
- `POST /reservas/{id}/fecha`
- Body: `{ "fechaEvento": "YYYY-MM-DD", "aceptarCola"?: boolean }`
- Respuestas:
  - `200 OK` — transición a `2.b` aplicada (RESERVA + bloqueo) → devuelve la RESERVA con
    `subEstado='2b'`, `ttlExpiracion`, `fechaEvento`.
  - `200 OK` — transición a `2.d` aplicada (cuando `aceptarCola=true` y la fecha está/
    queda bloqueada por `2.b`) → RESERVA con `subEstado='2d'`, `posicionCola`,
    `consultaBloqueanteId`.
  - `409 Conflict` (`colaDisponible: true`) — fecha bloqueada por `2.b` y `aceptarCola`
    ausente/false: el servidor **informa y ofrece cola**; la RESERVA permanece en `2.a`.
    El cliente re-envía con `aceptarCola=true` para confirmar la entrada en cola.
  - `409 Conflict` (`colaDisponible: false`) — fecha bloqueada por `2.c`/`2.v`/
    `pre_reserva`/`confirmada`+: no disponible, sin cola; RESERVA permanece en `2.a`.
  - `409 Conflict` (`colaDisponible: true`) — **carrera D4**: la fecha estaba libre pero
    otra transición ganó el bloqueo (`P2002`); se re-deriva a oferta de cola (igual que
    el caso anterior). Con `aceptarCola=true` el reintento entra directo a `2.d`.
  - `422`/`400` — `fecha_evento` no válida (ver D-1) o RESERVA no en `2.a` (guarda).
  - `404` — RESERVA inexistente para el tenant; `401/403` — sin sesión/rol.

> El `aceptarCola` resuelve el **flujo interactivo de FA-01** (el gestor acepta/rechaza)
> sin estado servidor intermedio: primera llamada informa (409 + `colaDisponible`),
> segunda llamada con `aceptarCola=true` confirma `2.d`. El dueño del contrato
> (`contract-engineer`) afinará nombres/códigos en la fase post-gate.

---

## D-3. Determinación del sub-estado destino — reusar la máquina declarativa de US-004

**Decisión**: reutilizar `determinarAltaConFecha(estadoFecha)` y la tabla
`REGLAS_ALTA_CON_FECHA` de `maquina-estados.ts` (US-004), que ya mapea:
- `libre` → `{ subEstado: '2b', accion: 'bloquear' }`
- `bloqueada-por-2b` → `{ subEstado: '2d', accion: 'encolar' }`
- `bloqueada-por-2c|2v|pre|conf+` → `{ subEstado: '2a', accion: 'sin-cambios' }`

En la transición, `accion: 'sin-cambios'` significa **permanecer en `2.a`** (la RESERVA
ya estaba en `2.a`), no "crear exploratoria" como en el alta. La función es la misma; el
significado de "quedarse en 2.a" se interpreta en el use-case de transición. Si conviene
desambiguar nombres (`exploratoria` vs `sin-cambios`), se hará como refactor menor sin
duplicar la tabla — **una sola fuente de verdad** para alta (US-004) y transición
(US-005).

**Guarda de origen (nuevo en US-005)**: añadir a la máquina declarativa las transiciones
permitidas `{consulta,2a} → {consulta,2b}` y `{consulta,2a} → {consulta,2d}`, y validar
que el origen es `2.a` **antes** de entrar en la transacción. Estados terminales
(`2x/2y/2z/cancelada/completada`) y cualquier no-`2a` se rechazan con error de
validación, modelado como dato (no `if` disperso). Skill `state-machine`.

---

## D-4. Bloqueo atómico — reusar `bloquearEnTx(tx, …)` dentro de la transacción de la transición

**Decisión (recomendada): reutilización real, cero SQL nuevo.** US-004 ya extrajo el
núcleo atómico a `FechaBloqueadaPrismaAdapter.bloquearEnTx(tx, { tenantId, fecha,
reservaId, plan })` (con `SELECT … FOR UPDATE` + INSERT + traducción
`P2002 → FechaYaBloqueadaError`). El use-case de transición:
1. Reutiliza la **función pura** `resolverPlanBloqueo({ fase: '2.b', ahora, settings })`
   → `{ insert, blando, ttl = now()+ttlConsultaDias }` (settings vía
   `TenantSettingsPort`).
2. **En la misma transacción** que la mutación de la RESERVA (`2a → 2b`) llama a
   `bloquearEnTx(tx, …)`, garantizando atomicidad RESERVA `2.b` + `FECHA_BLOQUEADA` bajo
   el mismo `fijarTenant` (RLS).
3. Escribe el `AUDIT_LOG` (`accion='transicion'`) en la **misma transacción**.

**No se reinventa el bloqueo** (regla dura del proyecto: nada de Redis/Redlock; PostgreSQL
`SELECT … FOR UPDATE` + `UNIQUE(tenant_id, fecha)`). El `bloquear()` público de US-040 y
su contrato quedan **intactos** (US-005 solo consume `bloquearEnTx`, ya existente).

A diferencia de US-004, aquí la RESERVA ya existe: la transacción hace un **UPDATE** del
sub-estado/`fecha_evento`/`ttl_expiracion` (no un INSERT de RESERVA), más el INSERT de
`FECHA_BLOQUEADA`.

---

## D-5. Concurrencia D4 — catch `UNIQUE` → ofrecer/entrar en cola `2.d`

**Estrategia (idéntica a US-004 D-6, reutilizada)**: ante dos transiciones simultáneas de
dos RESERVA distintas hacia la misma `(tenant, fecha)` **libre**:
1. Ambas determinan `libre` → ambas intentan la rama `2.b` (UPDATE RESERVA + INSERT
   `FECHA_BLOQUEADA`).
2. El motor serializa el INSERT: **una** hace COMMIT (`2.b` + bloqueo). La otra recibe
   `P2002` → PostgreSQL aborta su transacción.
3. La perdedora **re-deriva** el destino (D-3): la fecha ya está `bloqueada-por-2b` →
   resultado `2.d`/`encolar`. Comportamiento según `aceptarCola`:
   - Si la petición traía `aceptarCola=true` → **reabre la transacción** y entra en
     `2.d` (`posicion_cola` serializada por la fila bloqueante, `consulta_bloqueante_id`
     = la ganadora).
   - Si no → responde `409 colaDisponible:true` y la RESERVA **permanece en `2.a`** (el
     gestor decidirá). Honra el flujo interactivo de FA-01 sin doble bloqueo.

**Serialización de `posicion_cola`** (reuso de US-004 D-5): `SELECT … FOR UPDATE` sobre
la fila `FECHA_BLOQUEADA` bloqueante + `MAX(posicion_cola)+1`, con el índice **UNIQUE
parcial** `reserva_cola_posicion_key` (ya en `master`) como defensa en profundidad y el
retry-on-conflict de la UoW. **Sin migración** (todo presente desde US-004).

**Cobertura TDD-RED (skill `concurrency-locking`, tests reales contra PostgreSQL)**:
- 2 RESERVA en `2.a`, transición concurrente a la misma fecha libre → exactamente 1 en
  `2.b` + 1 `FECHA_BLOQUEADA`; la otra ofrecida a cola (o en `2.d`/pos=1 si
  `aceptarCola`). 0 dobles bloqueos.
- N transiciones concurrentes con `aceptarCola=true` → 1×`2b` + (N-1)×`2d` con posiciones
  `1..N-1` únicas y contiguas.

---

## D-6. Email de confirmación de bloqueo provisional — extensión de E1 vía motor US-045

**Decisión**: tras el COMMIT de la transición `2.a → 2.b`, registrar la `COMUNICACION` de
confirmación de bloqueo provisional y enviarla con el **motor real de US-045** (ya en
`master`), mediante el puerto de email del dominio (hexagonal intacto: el use-case
depende del puerto, no del adaptador de transporte).

- **Sin código `E` propio**: es una extensión de E1 para el caso de actualización de
  fecha (la ficha lo marca explícitamente; §9.3 no le asigna E-code). Se reutiliza la
  plantilla/estructura de E1 adaptando el copy a "bloqueo provisional confirmado".
- **No bloqueante**: el email es **posterior al commit** de la transición; un fallo de
  envío no revierte RESERVA `2.b` ni `FECHA_BLOQUEADA` (se gestiona como en US-045:
  estado de la COMUNICACION refleja el resultado, sin tocar el agregado).
- **No se reinventa el envío**: se consume el motor de US-045 tal cual.

---

## D-7. Endpoint API previsto (input para la fase de contrato)

**Resumen para el `contract-engineer`** (NO se toca `docs/api-spec.yml` en este change):

```
POST /reservas/{id}/fecha
Body:    { "fechaEvento": "YYYY-MM-DD", "aceptarCola"?: boolean }
200:     RESERVA con subEstado ∈ {2b, 2d}, ttlExpiracion, fechaEvento, posicionCola?, consultaBloqueanteId?
409:     { colaDisponible: boolean, motivo }  // bloqueada por 2b (cola) o por 2c/2v/pre+ (no disponible) o carrera D4
400/422: fecha no válida (D-1) o RESERVA no en 2.a (guarda de origen)
404:     RESERVA inexistente para el tenant
401/403: sin sesión / rol insuficiente
```

Alternativa considerada y descartada: `PATCH /reservas/{id}` con `fechaEvento` — menos
expresiva para una transición de máquina de estados con efectos colaterales y flujo
interactivo de cola (D-2).

---

## D-8. Migración Prisma — NINGUNA

Todas las columnas e índices necesarios existen en `master`:
- `Reserva`: `sub_estado` (enum `s2a/s2b/s2d`), `fecha_evento`, `ttl_expiracion`,
  `posicion_cola`, `consulta_bloqueante_id` (+ self-relation `ColaEspera`), índice
  `reserva_cola_posicion_key` (UNIQUE parcial, creado en US-004).
- `FechaBloqueada`: `tipo_bloqueo`, `UNIQUE(tenant_id, fecha)`.
- `TenantSettings.ttl_consulta_dias` (NOT NULL; default 3 vía seed).

**Conclusión: sin migración.** US-005 es puramente una nueva operación sobre el modelo ya
existente.

---

## Resumen de decisiones para el Gate

| # | Decisión | Resolución propuesta | ¿Migración? |
|---|----------|----------------------|-------------|
| D-1 | Regla de fecha | **`> hoy` recomendado** (unifica con US-040/016/004); ficha dice `≥ hoy` — **PENDIENTE de Gate** | No |
| D-2 | Endpoint | `POST /reservas/{id}/fecha` (acción de transición) | No |
| D-3 | Sub-estado destino | Reusar `determinarAltaConFecha` + guarda de origen `2.a` declarativa | No |
| D-4 | Bloqueo | Reusar `bloquearEnTx(tx,…)` + `resolverPlanBloqueo` en la tx de la transición | No |
| D-5 | Concurrencia D4 | catch `UNIQUE(tenant,fecha)` → ofrecer/entrar en cola `2.d`; tests reales | No |
| D-6 | Email | Extensión de E1 vía motor US-045, no bloqueante, post-commit | No |
| D-7 | Contrato | Endpoint de transición con `aceptarCola` para el flujo de cola | No |
| D-8 | Migración | Ninguna (todo el modelo de cola/bloqueo ya en `master`) | No |

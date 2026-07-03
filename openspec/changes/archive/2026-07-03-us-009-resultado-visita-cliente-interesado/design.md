# Design — us-009-resultado-visita-cliente-interesado

> Decisiones técnicas para la **transición de salida de "visita programada" (`2.v`) a
> "consulta con fecha" (`2.b`)** por resultado de visita "cliente interesado" (US-009 /
> UC-08). Todo se apoya en código real ya en `master`; se prioriza **DRY + hexagonal** y la
> garantía de **atomicidad** de la mutación de RESERVA + `FECHA_BLOQUEADA` + `AUDIT_LOG` en
> el motor PostgreSQL. Este documento es el corazón del **Gate de revisión humana SDD**: las
> decisiones quedan abiertas a tu OK antes de tocar contrato/TDD/código. En especial **D-4**
> (E7 post-commit), **D-5** (superficie de API) y **D-7** (A20 dentro o fuera) requieren
> decisión humana.

Rutas reales citadas (todas en `apps/api/src/`, ya en `master` tras US-004/005/007/008/040/045):
- `reservas/domain/maquina-estados.ts` — máquina declarativa (`ORIGENES_TRANSICION_*`
  + tablas de reglas; US-004/005/007/008)
- `reservas/domain/bloquear-fecha.service.ts` — `resolverPlanBloqueo` + puerto (US-040)
- `reservas/infrastructure/transicion-fecha-uow.prisma.adapter.ts` — UoW de transición con
  `SELECT … FOR UPDATE` sobre la fila bloqueante + retry-on-conflict (US-005/007/008)
- `reservas/infrastructure/tenant-settings.prisma.adapter.ts` — `obtener()` (lee
  `ttl_consulta_dias`)
- `reservas/infrastructure/sub-estado-consulta.mapper.ts` — `2a/2b/2c/2d/2v ↔ s…`
- `reservas/application/obtener-reserva.query.ts` — read-model `GET /reservas/{id}` (US-005)
- el motor de email E1–E8 de US-045 (capability `comunicaciones`) — disparo de E7
- `prisma/schema.prisma` — enum de sub-estados (`2b`/`2v`), `visita_realizada` (BOOLEAN),
  `ttl_expiracion`, `TENANT_SETTINGS.ttl_consulta_dias` (default 3), `codigo_email='E7'`

**Simetría con US-008 (transición hermana)**: US-008 es la **entrada** a `2.v`
(`{2a,2b,2c} → 2v`, bloqueo `hasta día post-visita`, E6, insert-o-update de
`FECHA_BLOQUEADA`); US-009 es una de las tres **salidas** de `2.v`. La salida "cliente
interesado" devuelve la consulta a `2.b` con TTL fresco (`now + ttl_consulta_dias`) — el
mismo cálculo que la `fase '2.b'` de US-004/US-007, y el mismo patrón de **UPDATE** del
`ttl_expiracion` sobre la fila bloqueante existente que US-006/US-007. El motor atómico
(transacción + `FOR UPDATE`) es **el mismo y se reutiliza**.

---

## D-1. Guarda de origen mono-estado — extender la máquina declarativa

**Decisión**: añadir a `maquina-estados.ts`, **como dato** (tabla declarativa, no
condicionales dispersos), la transición permitida `{consulta,2v} → {consulta,2b}` para el
resultado "cliente interesado", modelada como un conjunto de orígenes válidos
(`ORIGENES_TRANSICION_RESULTADO_VISITA_INTERESADO = {2v}`). A diferencia de US-008 (origen
multi-estado `{2a,2b,2c}`), esta es **mono-estado**: **solo** `2v`. Todo origen distinto
—`2a`, `2b`, `2c`, `2d`, y los terminales `2x`/`2y`/`2z`/`reserva_cancelada`/
`reserva_completada`— se rechaza **antes** de entrar en la transacción, con error de
validación y sin efectos. Mismo patrón que `esOrigenValidoParaProgramarVisita` +
`ORIGENES_TRANSICION_*` de US-005/007/008. Skill `state-machine`.

- **Sin submensaje especial para cola**: a diferencia de US-008 (que trata `2.d` con un
  mensaje UC-12 dedicado), aquí `2.d` es simplemente un origen inválido más (una consulta en
  cola nunca ha tenido visita programada). No hay ramas de guarda diferenciadas.
- `2v` y `2b` son sub-estados ya presentes en el enum de Prisma; **sin migración de enum**
  (D-6). El mapper `2v/2b ↔ s2v/s2b` ya está cableado desde US-004/US-008.

---

## D-2. Bloqueo `FECHA_BLOQUEADA` — UPDATE del TTL fresco (fase `2.b`), nunca INSERT/DELETE

**Decisión**: reutilizar `resolverPlanBloqueo({ fase: '2.b', ahora })` para obtener
`ttl = now + ttl_consulta_dias` (misma primitiva y cálculo que US-004/US-007). Como la
RESERVA proviene de `2.v`, la fila de `FECHA_BLOQUEADA` con `reserva_id` = esta reserva
**siempre existe** (fue creada/actualizada por US-008): la operación es un **UPDATE** puro
del `ttl_expiracion` de esa fila, al **mismo valor** que `RESERVA.ttl_expiracion`, sin crear
ni eliminar filas. `tipo_bloqueo` **permanece** `'blando'` (no se toca).

- **Una sola fuente de verdad del TTL**: el `ttl_expiracion` se calcula **una vez**
  (`now + ttl_consulta_dias`) y se escribe **idéntico** en RESERVA y en `FECHA_BLOQUEADA`
  dentro de la misma transacción. No hay dos cálculos divergentes.
- **`er-diagram.md §3.6` `fase '2.b'`** mapea `{blando, now + ttl_consulta_dias, insert}`;
  aquí el modo efectivo es **UPDATE** (la fila ya existe), análogo a la prórroga de US-006 /
  la extensión de US-007. Es una aplicación de la misma fase con la fila preexistente, no una
  fase nueva → **no se crea delta de `bloqueo-fecha`**.
- **No se usa `visita_programada_fecha` para el TTL**: el TTL es fresco desde `now`. La fecha
  de visita fue relevante para el bloqueo de `2.v` (US-008), no para el de `2.b`.

---

## D-3. Atomicidad e integración con el motor atómico de transición + concurrencia commit-first

**Decisión**: reutilizar el UoW de transición de US-005/007/008
(`transicion-fecha-uow.prisma.adapter.ts`). El use-case `2v → 2b`:
1. Lee `TENANT_SETTINGS.ttl_consulta_dias` (vía `TenantSettingsPort`) para el TTL fresco.
2. Valida la guarda de origen declarativa (`{2v}`, D-1) **antes** de abrir la transacción.
   No hay validación de ventana de fecha (el resultado se registra sin importar si la visita
   ya llegó — FA de la US; `visita_programada_fecha` es informativa).
3. Resuelve el plan con `resolverPlanBloqueo({ fase: '2.b', ahora })` (D-2) →
   `{ ttl = now + ttl_consulta_dias }`.
4. **En una única transacción** bajo contexto RLS del tenant:
   - `SELECT … FOR UPDATE` sobre la fila bloqueante de `FECHA_BLOQUEADA` para esa
     `(tenant_id, fecha)` (serializa con el barrido A21/US-012 y con cualquier mutación
     concurrente del bloqueo).
   - UPDATE de la RESERVA (`sub_estado='2b'`, `visita_realizada=true`,
     `ttl_expiracion = now + ttl_consulta_dias`).
   - UPDATE del `ttl_expiracion` de `FECHA_BLOQUEADA` al mismo valor (D-2).
   - `AUDIT_LOG accion='transicion'` (`datos_anteriores.sub_estado='2v'`,
     `datos_anteriores.visita_realizada=false`, `datos_nuevos.sub_estado='2b'`,
     `datos_nuevos.visita_realizada=true`).
5. Tras el **commit**, dispara E7 (D-4).

**Atomicidad**: UPDATE de RESERVA + UPDATE de `FECHA_BLOQUEADA` + AUDIT_LOG son
**all-or-nothing**. Un fallo parcial hace rollback completo: nunca `2.b` sin
`FECHA_BLOQUEADA` actualizada, ni viceversa. (`CLAUDE.md §Regla crítica`.)

**Concurrencia commit-first con el barrido A21/US-012**: el `SELECT … FOR UPDATE` sobre la
fila bloqueante es el punto de serialización. La transacción que commitea primero gana:
- **Registro gana**: la RESERVA queda en `2b` con TTL fresco; el barrido opera después sobre
  un `ttl_expiracion` ya futuro y no expira nada (la RESERVA ya no es candidata en `2v`).
- **Barrido gana**: expira la RESERVA de `2v` a `2x`; la transición `2v → 2b` opera sobre una
  RESERVA ya terminal y recibe la **guarda de origen** (rechazo), sin dejar estado
  inconsistente. **Nunca** hay estado intermedio (`2b` sin `FECHA_BLOQUEADA` actualizada).
- **Cobertura TDD-RED (skill `concurrency-locking`, tests reales contra PostgreSQL)**:
  registro concurrente con el barrido A21 sobre la misma RESERVA (estado final coherente); y
  dos registros simultáneos de "interesado" (exactamente uno aplica, el otro recibe la guarda).

---

## D-4. Envío de E7 — efecto posterior al commit (reuso del motor de US-045) — PENDIENTE de Gate

**Tensión**: la US exige enviar E7 y registrarlo en `COMUNICACION` en toda transición
exitosa. Meter el envío de red (proveedor externo) **dentro** de la transacción de BD
acoplaría el commit del estado a la latencia/disponibilidad del proveedor y podría revertir
un estado correcto por un fallo de email.

**Recomendación**: separar **commit de estado** (RESERVA + FECHA_BLOQUEADA + AUDIT_LOG,
atómico, D-3) del **disparo de E7**, que se ejecuta **tras el commit** reutilizando el motor
de email de US-045. El registro en `COMUNICACION` (con `codigo_email='E7'`, `estado='enviado'`,
`reserva_id`, `cliente_id`, `tenant_id`) lo realiza el propio motor, que ya traza el resultado
y aplica la idempotencia `(reserva_id, codigo_email)`. Si el proveedor falla, el estado NO se
revierte (la transición es válida); el fallo queda trazado en `COMUNICACION` con
`estado='fallido'` para reintento/seguimiento, coherente con US-045. Esto casa literalmente
con la regla de la US: *"si falla el envío (proveedor externo), el error se registra en
COMUNICACION.estado = 'fallido' sin revertir la transición de estado"*.

- En `test`/CI el transporte de email está en **modo fake** (US-045): los tests verifican el
  disparo de E7 y el registro en `COMUNICACION` sin enviar correos reales.

**Decisión: PENDIENTE de Gate.** Si el humano exige E7 estrictamente dentro de la misma
transacción (registro de `COMUNICACION` transaccional con envío diferido, outbox-like), se
ajusta. La recomendación por defecto es: estado atómico + E7 post-commit trazado.

---

## D-5. Superficie de API — evolucionar el contrato (esta US toca la API) — PENDIENTE de Gate

**Contexto**: US-008 ya expuso `POST /reservas/{id}/visita` (programar visita). En
`docs/api-spec.yml` existe además un **stub** `PATCH /reservas/{id}/visita` con
`summary: "Registrar resultado de visita (UC-08)"` y un schema `ResultadoVisitaRequest`
(placeholder). US-009 es exactamente el flujo básico de UC-08.

**Decisión (recomendada)**: exponer el resultado de visita como **endpoint de transición**
sobre el agregado existente, coherente con el precedente de transiciones con efectos
colaterales (US-005 `POST /reservas/{id}/fecha`, US-008 `POST /reservas/{id}/visita`). Dos
opciones abiertas para el `contract-engineer`:

- **(A) endpoint hermano `POST /reservas/{id}/resultado-visita`** con payload que indica el
  resultado, p. ej. `{ "resultado": "interesado" }` (extensible a `"reserva"`/`"descarte"`
  en US-010/US-011).
- **(B) evolucionar el stub existente `PATCH /reservas/{id}/visita`** (`ResultadoVisitaRequest`)
  hacia el mismo payload `{ resultado: "interesado" }`.

**Contrato previsto (input para la fase de contrato — NO se toca `docs/api-spec.yml` aquí)**:
```
POST /reservas/{id}/resultado-visita        (o PATCH /reservas/{id}/visita)
Body:    { "resultado": "interesado" }
200:     RESERVA con subEstado='2b', visitaRealizada=true, ttlExpiracion (nuevo, fresco)
422:     guarda de origen (RESERVA no en 2v) o terminal (inmutable)
404:     RESERVA inexistente para el tenant
401/403: sin sesión / rol insuficiente
```

> El `contract-engineer` (post-gate) elige A vs B, afina nombres/códigos y decide si el
> endpoint es "polimórfico" por `resultado` (habilitando US-010/US-011) o específico de esta
> US. Aquí solo se fija la intención: **la API se evoluciona** (nuevo endpoint o evolución del
> stub) y el resultado "interesado" produce `2b + visita_realizada=true + TTL fresco`.
> **Decisión de forma exacta: PENDIENTE de Gate / contract-engineer.**

---

## D-6. Migración Prisma — confirmar NINGUNA — PENDIENTE de Gate (verificación)

Según `er-diagram.md` y `api-spec.yml`, todo lo necesario existe en el modelo:
- `Reserva`: `sub_estado` enum incluye `2b` y `2v`; `visita_realizada` (BOOLEAN);
  `ttl_expiracion` (TIMESTAMP).
- `FechaBloqueada`: `ttl_expiracion`, `tipo_bloqueo` (`blando`), `UNIQUE(tenant_id, fecha)`.
- `TenantSettings.ttl_consulta_dias` (INT, default 3).
- `AuditLog`: `accion='transicion'` ya usado por US-005/007/008.
- `Comunicacion.codigo_email` enum incluye `E7` (`api-spec.yml` `CodigoEmail`), con la
  plantilla E7 del motor de US-045.

**Recomendación: sin migración.** **Verificación pendiente** en la fase de implementación:
confirmar en `prisma/schema.prisma` de `master` que la plantilla E7 existe/está sembrada para
el motor de US-045; si faltara la plantilla/seed de E7, esa sería la única tarea de datos del
change. (PENDIENTE de confirmación humana en el Gate.)

---

## D-7. Recordatorio A20 — slice de jobs separado (recomendado) — PENDIENTE de Gate

**Tensión**: la US lista A20 (alerta al gestor el día posterior a la visita sin marcar
resultado) en su contexto. Pero es un **job de barrido** (patrón estado en fila + cron,
idempotente, como A4/A21), no parte de la **transición** que esta US implementa.

**Recomendación**: este change entrega la **transición** (`2v → 2b` + TTL fresco + E7 +
auditoría), que es precisamente lo que **apaga** la alerta A20 (deja `visita_realizada=true`).
A20 se implementa en un **slice de jobs separado** (mismo patrón que el barrido de TTLs
A4/A21/US-012), manteniendo este change cohesionado y testeable. **Decisión: PENDIENTE de
Gate.** Si el humano prefiere incluir A20 aquí, se amplían el spec-delta y `tasks.md` con el
job de barrido y sus tests de idempotencia.

---

## Resumen de decisiones para el Gate

| # | Decisión | Resolución propuesta | ¿Migración? |
|---|----------|----------------------|-------------|
| D-1 | Guarda de origen | Tabla declarativa **mono-estado** `{2v} → 2b`; todo lo demás inválido; terminales inmutables | No |
| D-2 | Bloqueo `FECHA_BLOQUEADA` | **UPDATE** del `ttl_expiracion` de la fila existente a `now + ttl_consulta_dias`; `tipo_bloqueo` permanece `blando`; reutiliza `fase '2.b'` | No |
| D-3 | Atomicidad + concurrencia | Reusar UoW; RESERVA + FECHA_BLOQUEADA + AUDIT_LOG en una tx con `FOR UPDATE`; commit-first vs barrido A21/US-012 | No |
| D-4 | Envío de E7 | Reuso motor US-045, **post-commit** trazado en `COMUNICACION` (`enviado`/`fallido`) — **PENDIENTE de Gate** | No |
| D-5 | Superficie de API | Evolucionar contrato: `POST /reservas/{id}/resultado-visita {resultado:"interesado"}` **o** stub `PATCH /reservas/{id}/visita` — **PENDIENTE de Gate / contract-engineer** | No |
| D-6 | Migración | Ninguna (enum, `visita_realizada`, `ttl_consulta_dias`, `E7` ya en `master`) — **verificar plantilla E7 en impl** | No (a confirmar) |
| D-7 | Recordatorio A20 | **Slice de jobs separado** (este change = transición) — **PENDIENTE de Gate** | No |

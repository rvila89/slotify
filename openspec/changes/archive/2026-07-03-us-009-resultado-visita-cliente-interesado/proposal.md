# Change: us-009-resultado-visita-cliente-interesado

## Why

US-009 cubre la **transición de salida de una consulta con visita programada (`2.v`)
de vuelta al sub-estado "consulta con fecha" (`2.b`)** cuando el Gestor registra que
la visita se ha realizado y el **cliente ha confirmado su interés**. La transición
marca `visita_realizada = true`, devuelve la consulta a `2.b` con un **TTL fresco**
(`ttl_expiracion = now + TENANT_SETTINGS.ttl_consulta_dias`, default 3 días, calculado
desde el instante de la transición, **no** acumulado sobre el anterior ni derivado de
`visita_programada_fecha`), actualiza la fila de `FECHA_BLOQUEADA` al mismo TTL
(manteniendo `tipo_bloqueo = 'blando'`) y **envía automáticamente el email E7** de
confirmación de bloqueo post-visita. Resuelve **D2** (pipeline actualizado tras la
visita), **D3** (transición clara `2.v → 2.b` con TTL fresco que da al cliente un
plazo explícito para decidir) y **D9** (E7 automático elimina la comunicación manual
post-visita). (Fuente: `US-009 §Historia`, `§Contexto de Negocio`, `§Happy Path`;
UC-08 flujo básico; E7; A20.)

Es la **transición de salida hermana** de la entrada a `2.v` (US-008). Donde US-008
programa la visita (`{2a,2b,2c} → 2v`, bloqueo `hasta día post-visita`, email E6),
US-009 registra el resultado "cliente interesado" (`2v → 2b`, bloqueo `now + 3 días`,
email E7). Los otros dos resultados de visita —reserva inmediata (US-010) y descarte
(US-011)— quedan **fuera de alcance**.

El cimiento ya existe en `master` y **se reutiliza, no se recrea**:

- **Máquina de estados declarativa (US-004/005/007/008)** (`maquina-estados.ts`,
  `ORIGENES_TRANSICION_*` + tablas de reglas): se **extiende** con la guarda de origen
  **mono-estado** `2v → 2b` (solo desde `2.v`), modelada como dato, no como
  condicionales dispersos. (Skill `state-machine`.)
- **UoW de transición con `SELECT … FOR UPDATE` + retry-on-conflict de US-005/007/008**
  (`transicion-fecha-uow.prisma.adapter.ts`): mismo motor atómico; se reutiliza para
  la mutación de RESERVA + `FECHA_BLOQUEADA` + `AUDIT_LOG` en una sola transacción.
- **Bloqueo atómico de fecha (US-040/041)** y la primitiva `resolverPlanBloqueo` (fase
  `2.b`, `er-diagram.md §3.6`): el TTL fresco reutiliza el patrón `now + ttl_consulta_dias`
  ya empleado por `fase '2.b'` (la fila ya existe → **UPDATE** de `ttl_expiracion`, como
  en US-006/US-007). Regla dura: PostgreSQL + Prisma, **nunca Redis/Redlock**.
- **Motor de email E1–E8 de US-045** (`comunicaciones`): se **reutiliza** para disparar
  E7 y registrar en `COMUNICACION` (`codigo_email='E7'`) + `AUDIT_LOG`, sin reinventar
  el envío ni el trazado. Idempotencia `(reserva_id, codigo_email)` de US-045.
- **TENANT_SETTINGS.ttl_consulta_dias** (default 3, `er-diagram.md §TENANT_SETTINGS`):
  el TTL fresco se lee del setting, **nunca hardcodeado**.
- **AUDIT_LOG (US-003+)**: `accion = 'transicion'` se registra en la misma transacción.

(Fuente: ver `design.md` para firmas previstas, rutas reales y decisiones de reuso.)

## What Changes

> Slice vertical (backend + contrato + porción de frontend "ficha de reserva" con
> acción "Registrar resultado de visita" → "Cliente interesado"). Sujeto al **Gate de
> revisión humana SDD** (decisiones en `design.md`).

- **Nueva acción de transición sobre una RESERVA existente en `2.v`**: el Gestor
  registra el resultado "cliente interesado". El servidor **valida el sub_estado de
  origen** (solo `2v`; **excluye** todos los demás, incluidos los terminales), muta la
  RESERVA a `sub_estado = '2b'`, fija `visita_realizada = true` y recalcula
  `ttl_expiracion = now + TENANT_SETTINGS.ttl_consulta_dias`. (Fuente: `US-009 §Happy
  Path`, `§Reglas de Validación`; UC-08.)
- **Bloqueo `FECHA_BLOQUEADA` — UPDATE del TTL fresco (fase `2.b`)**: la fila activa de
  `FECHA_BLOQUEADA` con `reserva_id` = esta RESERVA (que existe desde `2.v`) actualiza su
  `ttl_expiracion` al **mismo valor** que la RESERVA (`now + ttl_consulta_dias`);
  `tipo_bloqueo` permanece `'blando'`. No se crea ni elimina fila. (Fuente: `US-009
  §Happy Path`, `§Reglas de negocio`; `er-diagram.md §3.6` `fase '2.b'`.)
- **Email E7 + registro en COMUNICACION**: en toda transición exitosa se envía el email
  **E7** (confirmación de bloqueo post-visita, 3 días) al cliente y se registra en
  `COMUNICACION` con `codigo_email = 'E7'`, `estado = 'enviado'`, `reserva_id` y
  `cliente_id` de la RESERVA. El envío se reutiliza del motor de email de US-045 y es
  **posterior al commit** (un fallo del proveedor no revierte la transición; queda
  trazado con `estado = 'fallido'`). (Fuente: `US-009 §Happy Path`, `§Reglas de
  Validación`; E7; `design.md §D-4`.)
- **AUDIT_LOG de la transición**: `accion = 'transicion'`, `entidad = 'RESERVA'`,
  `datos_anteriores.sub_estado = '2v'`, `datos_anteriores.visita_realizada = false`,
  `datos_nuevos.sub_estado = '2b'`, `datos_nuevos.visita_realizada = true`, en la misma
  transacción. (Fuente: `US-009 §Happy Path`.)
- **Atomicidad de la transición**: actualizar `sub_estado` + `visita_realizada` +
  `ttl_expiracion` en RESERVA, actualizar el `ttl_expiracion` de `FECHA_BLOQUEADA` y
  registrar `AUDIT_LOG` ocurren **all-or-nothing** en una única transacción de BD bajo
  el contexto RLS del tenant. Un fallo parcial revierte todo (rollback): **nunca** `2.b`
  sin `FECHA_BLOQUEADA` actualizada, ni viceversa. (El envío de E7 es efecto posterior
  al commit — `design.md §D-4`.) (Fuente: `US-009 §Reglas de negocio`, `§Concurrencia`.)
- **Guarda de origen y estados inmutables**: si la petición llega sobre una RESERVA que
  **no** está en `2.v` → rechazo con error de validación (la RESERVA no se modifica);
  sobre un terminal (`2.x`/`2.y`/`2.z`, `reserva_cancelada`/`reserva_completada`) →
  rechazo (los terminales son inmutables). (Fuente: `US-009 §FA RESERVA no en 2.v`,
  `§FA RESERVA en estado terminal`.)
- **`visita_programada_fecha` es informativa (FA registro antes de la fecha)**: el
  registro del resultado se permite aunque `visita_programada_fecha > hoy` (la visita
  aún no ha llegado en el calendario). La fecha de visita **no** es precondición estricta
  de validación; el TTL fresco se calcula desde `now`, no desde `visita_programada_fecha`.
  (Fuente: `US-009 §FA Gestor registra resultado antes de la fecha de visita`.)
- **Concurrencia con el barrido de TTLs (US-012/A21)**: la transición `2v → 2b` se
  serializa con el barrido periódico de expiración (que podría intentar expirar la misma
  RESERVA cuando su `ttl_expiracion` de `2.v` = día post-visita ha vencido) mediante
  `SELECT … FOR UPDATE` sobre la fila bloqueante. **Commit-first gana**: si US-012 llega
  primero, la RESERVA pasa a `2x` y el registro del resultado falla controladamente por
  la guarda de origen (ya no está en `2.v`); si el registro llega primero, US-012 no
  encuentra la RESERVA candidata en `2.v` y no actúa. **Nunca** hay estado intermedio
  (`2.b` sin `FECHA_BLOQUEADA` actualizada). Cubierto con **tests de concurrencia reales**
  en TDD-RED (skill `concurrency-locking`). (Fuente: `US-009 §Concurrencia / Race
  Conditions`.)
- **Porción de frontend "ficha de reserva"**: acción "Registrar resultado de visita" →
  opción "Cliente interesado" (visible solo en `2.v`), confirmación y feedback (nuevo
  sub-estado `2.b`, nuevo TTL del bloqueo). Responsive mobile-first (390/768/1280).

## Impact

- Specs: **modifica la capability `consultas`** (añade los requisitos de la transición
  `2v → 2b`, la guarda de origen mono-estado, `visita_realizada=true`, el TTL fresco
  `now + ttl_consulta_dias`, el UPDATE del TTL de `FECHA_BLOQUEADA`, la atomicidad, la
  concurrencia commit-first con el barrido A21/US-012 y la auditoría `accion='transicion'`
  con `datos_anteriores/nuevos`). **Modifica la capability `comunicaciones`** (añade el
  requisito del **disparo de E7** al transicionar a `2.b` + su registro en
  `COMUNICACION`/`AUDIT_LOG`, reutilizando el motor de US-045). **Reutiliza sin modificar**
  la capability `bloqueo-fecha` (la primitiva `fase '2.b'` `now + ttl_consulta_dias` /
  UPDATE ya está descrita en su modelo) — **no se crea delta de `bloqueo-fecha`**.
- Contrato OpenAPI (`docs/api-spec.yml`): **esta US toca la API — hay que evolucionar el
  contrato**. Existe ya un stub `PATCH /reservas/{id}/visita` "Registrar resultado de
  visita (UC-08)" con `ResultadoVisitaRequest` (input para el `contract-engineer`). Se
  prevé un endpoint que registre el resultado "interesado" (evolucionar ese stub, o el
  endpoint hermano de US-008 `POST /reservas/{id}/visita`, hacia p. ej.
  `POST /reservas/{id}/resultado-visita` con payload `{ resultado: "interesado" }`; ver
  `design.md §D-5`). El `contract-engineer` (post-gate) definirá el detalle exacto;
  **no se toca `docs/api-spec.yml` en este change de spec**. No se edita el cliente
  generado a mano.
- Código (implementación posterior, fuera de este change de spec):
  `apps/api/src/reservas/{domain,application,infrastructure,interface}/**` (use-case de
  transición `2v → 2b`, guarda de origen declarativa, reuso de
  `resolverPlanBloqueo({fase:'2.b'})` + UPDATE de `FECHA_BLOQUEADA` en la UoW, disparo del
  motor E7, AUDIT_LOG), `apps/web/src/features/reservas/**` (acción "Registrar resultado
  de visita" → "Cliente interesado" + confirmación + feedback). Read-model
  `GET /reservas/{id}` ya existe (US-005).
- **Migración**: **no**. El sub-estado `2b`/`2v` (enum), `visita_realizada` (BOOLEAN),
  `ttl_expiracion`, `TENANT_SETTINGS.ttl_consulta_dias` (default 3) y `codigo_email='E7'`
  ya están en el modelo desde US-000/US-045 (`er-diagram.md §RESERVA`, `§TENANT_SETTINGS`,
  `§FECHA_BLOQUEADA`; `api-spec.yml` `CodigoEmail` enum). A confirmar en `design.md §D-6`.
- Trazabilidad: **US-009**, **UC-08** (flujo básico — cliente confirma interés);
  entidades RESERVA, FECHA_BLOQUEADA, COMUNICACION, AUDIT_LOG, TENANT_SETTINGS; email
  **E7**; automatización **A20** (recordatorio al gestor — fuera de alcance, ver abajo);
  concurrencia con el barrido **A21/US-012**.
- Dependencias (todas en `master`): US-001 (sesión activa), US-008 (existe una RESERVA en
  `2.v` con `visita_programada_fecha` y fila activa en `FECHA_BLOQUEADA`), US-040/US-041
  (bloqueo atómico/liberación), US-045 (motor de email E1–E8 para E7), US-006
  (patrón de UPDATE del `ttl_expiracion` sobre la fila bloqueante).

## Lo que NO entra (anti-scope)

- **Otros resultados de visita**: "reserva inmediata" (US-010, `2v → pre_reserva`) y
  "descarte" (US-011, `2v → 2z`). US-009 cubre **exclusivamente** el resultado "cliente
  interesado" (`2v → 2b`).
- **Reprogramación de visita (FA-03 parcial)**: si la visita no se celebró y el gestor
  quiere reprogramar, reutiliza el flujo de US-008 desde `2.v`; US-009 no implementa la
  reprogramación (solo se referencia como salida alternativa en la ficha).
- **Recordatorio A20 (job de alerta al gestor)**: el día posterior a la visita sin marcar
  resultado es una automatización interna (job de barrido, patrón estado en fila + cron,
  como A4/A21), **no** la transición de esta US. US-009 entrega la **transición** que
  habilita/consume ese recordatorio (deja `visita_realizada = true` que apaga la alerta).
  **Recomendación (PENDIENTE de Gate, `design.md §D-7`)**: A20 como slice de jobs separado.
- **Extensión manual del TTL (US-006)** y **expiración por barrido (US-012)**: son sus
  propias US; aquí solo se referencia la concurrencia commit-first con el barrido A21.

## Decisiones de alcance pendientes de aprobación humana

Las decisiones de diseño están **razonadas con recomendación** en `design.md` y quedan
**abiertas hasta el OK del Gate SDD**. En particular:
- **D-4**: envío de E7 como **efecto posterior al commit** (la atomicidad cubre RESERVA +
  FECHA_BLOQUEADA + AUDIT_LOG; el email no revierte el estado si el proveedor falla, se
  traza en `COMUNICACION.estado='fallido'`).
- **D-5**: superficie de API — evolucionar el stub `PATCH /reservas/{id}/visita` vs
  endpoint hermano `POST /reservas/{id}/resultado-visita` con `{ resultado: "interesado" }`
  (lo afina el `contract-engineer` post-gate).
- **D-6**: confirmar que no hace falta migración (enum, `visita_realizada`,
  `ttl_consulta_dias`, `E7` ya en `master`).
- **D-7**: A20 en este change vs slice de jobs separado.

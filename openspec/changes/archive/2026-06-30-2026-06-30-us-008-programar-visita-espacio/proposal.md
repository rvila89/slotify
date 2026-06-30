# Change: us-008-programar-visita-espacio

## Why

US-008 cubre la **transición de una consulta activa (`2.a` / `2.b` / `2.c`) al
sub-estado "visita programada" (`2.v`)**: el Gestor programa una visita presencial
al espacio para un lead interesado, dando tiempo formal al cliente para decidir. La
transición **bloquea la fecha del evento hasta el día posterior a la visita**
(`ttl_expiracion = visita_programada_fecha + 1 día 23:59:59`) y **envía
automáticamente el email E6** de confirmación al cliente. A diferencia de US-007
(`2.b → 2.c`, que extiende el TTL y vacía la cola), aquí el TTL del bloqueo se fija
a partir de la **fecha de la visita** (no del setting de consulta), el origen es
**multi-estado** (`2.a`/`2.b`/`2.c`) y **sí se envía un email catalogado (E6)**.
Resuelve **D2** (visibilidad del pipeline: estado diferenciado `2.v` para leads en
fase de decisión presencial, visible en calendario), **D3** (estado claro de la
reserva) y **D9** (E6 + recordatorios A19/A20 automáticos eliminan el seguimiento
manual de visitas). (Fuente: `US-008 §Historia`, `§Contexto de Negocio`; UC-07;
A18; E6.)

El cimiento ya existe en `master` y **se reutiliza, no se recrea**:

- **Bloqueo atómico de fecha (US-040/041)**: la primitiva
  `resolverPlanBloqueo({ fase: '2.v', ... })` está modelada en `er-diagram.md §3.16`
  como `fase '2.v' → {blando, ttl = visita_programada_fecha + 1 día}`. La creación
  o actualización del TTL de `FECHA_BLOQUEADA` se hace **dentro de la misma
  transacción** que la mutación de la RESERVA, vía `SELECT … FOR UPDATE` / `INSERT`
  con `UNIQUE(tenant_id, fecha)` (regla dura: PostgreSQL, nunca Redis/Redlock).
- **Máquina de estados declarativa de US-004/005/007** (`maquina-estados.ts`,
  `ORIGENES_TRANSICION_*` + tablas de reglas): se **extiende** con la guarda de
  origen multi-estado `{2a,2b,2c} → 2v`, modelada como dato, no como condicionales
  dispersos.
- **UoW de transición con `SELECT … FOR UPDATE` + retry-on-conflict** de US-005/007
  (`transicion-fecha-uow.prisma.adapter.ts`): mismo motor atómico; lo nuevo es el
  cálculo del TTL desde la fecha de visita y la rama **insert-o-update** de
  `FECHA_BLOQUEADA`.
- **Motor de email E1–E8 de US-045** (`comunicaciones`): se **reutiliza** para
  disparar E6 y registrar en `COMUNICACION` + `AUDIT_LOG`, sin reinventar el envío
  ni el trazado.
- **TENANT_SETTINGS.max_dias_programar_visita** (default 7, `er-diagram.md §3.16`):
  la ventana máxima de la fecha de visita se lee del setting, **nunca hardcodeada**.
- **AUDIT_LOG (US-003+)**: `accion = 'transicion'` se registra para la RESERVA en la
  misma transacción.

(Fuente: ver `design.md` para firmas previstas, rutas reales y decisiones de reuso.)

## What Changes

> Slice vertical (backend + contrato + frontend "ficha de consulta" con acción
> "Programar visita"). Sujeto al **Gate de revisión humana SDD** (decisiones en
> `design.md`).

- **Nueva acción de transición sobre una RESERVA existente en `2.a`/`2.b`/`2.c`**: el
  Gestor programa una visita introduciendo `fecha_visita` y `hora_visita`. El servidor
  **valida el sub_estado de origen** (`2a`, `2b` o `2c`; **excluye `2d` y todos los
  terminales**), que la `fecha_visita ∈ [hoy + 1 día, hoy +
  TENANT_SETTINGS.max_dias_programar_visita]`, y —si el origen es `2.a`— que
  `fecha_evento` esté definida. (Fuente: `US-008 §Happy Path`, `§Reglas de
  Validación`; UC-07.)
- **Transición `{2a,2b,2c} → 2v` + nuevos campos de RESERVA**: actualiza
  `sub_estado = '2v'`, `visita_programada_fecha = fecha_visita`,
  `visita_programada_hora = hora_visita` y `visita_realizada = false` (se mantiene
  `false` hasta que el gestor registre el resultado en US-009/010/011). (Fuente:
  `US-008 §Happy Path`; `er-diagram.md §RESERVA`.)
- **Bloqueo `FECHA_BLOQUEADA` insert-o-update (`fase '2.v'`)**: el nuevo
  `ttl_expiracion = visita_programada_fecha + 1 día (23:59:59)`. Si la RESERVA venía
  de `2.b`/`2.c` (ya tiene fila activa en `FECHA_BLOQUEADA`), se **actualiza** el
  `ttl_expiracion` de la fila existente (no se crea otra). Si venía de `2.a` sin
  bloqueo, se **crea** una nueva fila con `tipo_bloqueo = 'blando'`. En ambos casos
  `tipo_bloqueo` permanece/es `'blando'`. (Fuente: `US-008 §Happy Path — 2.a / 2.b /
  2.c`, `§Reglas de negocio`; `er-diagram.md §3.16` `fase '2.v'`.)
- **Email E6 + registro en COMUNICACION (A18)**: en toda transición exitosa se envía
  el email **E6** (confirmación de visita con fecha/hora) al cliente y se registra en
  `COMUNICACION` con `codigo_email = 'E6'`, `estado = 'enviado'`, `reserva_id` y
  `cliente_id` de la RESERVA. El envío se reutiliza del motor de email de US-045.
  (Fuente: `US-008 §Happy Path`, `§Reglas de negocio`, `§Reglas de Validación`; A18;
  E6 §9.3.)
- **AUDIT_LOG de la transición**: `accion = 'transicion'`, `entidad = 'RESERVA'`,
  `datos_anteriores.sub_estado = '2a'|'2b'|'2c'`, `datos_nuevos.sub_estado = '2v'`,
  `datos_nuevos.visita_programada_fecha`, en la misma transacción. (Fuente: `US-008
  §Happy Path`.)
- **Atomicidad de la transición**: actualizar `sub_estado` + campos de visita en
  RESERVA, e insertar/actualizar el `ttl_expiracion` de `FECHA_BLOQUEADA` ocurren
  **all-or-nothing** en una única transacción de BD bajo el contexto RLS del tenant.
  Un fallo parcial revierte todo (rollback): nunca `2.v` sin `FECHA_BLOQUEADA`
  actualizada, ni viceversa. (El envío de E6 se trata como efecto posterior al commit
  — ver `design.md §D-6`.) (Fuente: `US-008 §Reglas de negocio`, `§Concurrencia`.)
- **Guarda de origen y estados inmutables**: si la petición llega sobre una RESERVA en
  `2.d` (cola) → error "la consulta debe ser promovida primero (UC-12)"; sobre un
  terminal (`2.x`/`2.y`/`2.z`, `reserva_cancelada`/`reserva_completada`) → rechazo (los
  terminales son inmutables); sobre `2.a` sin `fecha_evento` → se informa de que debe
  introducirse la fecha del evento primero. En todos los casos **sin modificar** nada.
  (Fuente: `US-008 §FA-01`, `§FA Estado terminal`, `§FA 2.a sin fecha_evento`.)
- **Validación de la ventana de la visita**: `fecha_visita ≤ hoy` → error "la fecha de
  visita debe ser un día futuro"; `fecha_visita > hoy + max_dias_programar_visita` →
  error "la visita debe programarse dentro de los próximos {N} días". La UI limita el
  selector de fecha; la validación es también **defensiva en servidor**. (Fuente:
  `US-008 §FA Fecha superior al límite`, `§FA Fecha igual a hoy o pasado`.)
- **Concurrencia con el barrido de TTLs (US-012/A4)**: la transición a `2.v` se
  serializa con el barrido periódico de expiración sobre la misma RESERVA/fecha
  mediante `SELECT … FOR UPDATE` sobre la fila bloqueante, de modo que no pueda quedar
  `sub_estado = '2v'` sin `FECHA_BLOQUEADA` actualizada (ni viceversa). La que commitea
  primero gana; la otra opera sobre una RESERVA ya modificada y respeta la guarda.
  Cubierto con **tests de concurrencia reales** en TDD-RED (skill `concurrency-locking`).
  (Fuente: `US-008 §Concurrencia / Race Conditions`.)
- **Frontend "ficha de consulta"**: acción "Programar visita" (deshabilitada/oculta en
  `2.d` y terminales, y en `2.a` sin `fecha_evento`), formulario con selector de fecha
  limitado a la ventana `[mañana, hoy + N]` + hora, confirmación y feedback (nueva fecha
  de visita, nuevo TTL del bloqueo). Responsive mobile-first (390/768/1280).

## Impact

- Specs: **modifica la capability `consultas`** (añade los requisitos de la transición
  `{2a,2b,2c} → 2v`, los nuevos campos de RESERVA `visita_programada_fecha`/
  `visita_programada_hora`/`visita_realizada`, el bloqueo insert-o-update `fase '2.v'`,
  la ventana `max_dias_programar_visita`, la guarda de origen multi-estado, la
  precondición de `fecha_evento` para `2.a`, la atomicidad, la concurrencia con el
  barrido A4 y la auditoría `accion='transicion'`). **Modifica la capability
  `comunicaciones`** (añade el requisito del **disparo de E6** al transicionar a `2.v`
  + su registro en `COMUNICACION`/`AUDIT_LOG`, reutilizando el motor de US-045).
  **Reutiliza sin modificar** la capability `bloqueo-fecha` (la primitiva `fase '2.v'`
  ya está descrita en su modelo) — **no se crea delta de `bloqueo-fecha`**.
- Contrato OpenAPI (`docs/api-spec.yml`): se prevé un **endpoint nuevo de transición**
  — `POST /reservas/{id}/visita` con body `{ fecha, hora }` (ver `design.md §D-5`,
  input para la fase de contrato). El `contract-engineer` (post-gate) lo definirá;
  **no se toca `docs/api-spec.yml` en este change de spec**. No se edita el cliente
  generado a mano.
- Código (implementación posterior, fuera de este change de spec):
  `apps/api/src/reservas/{domain,application,infrastructure,interface}/**` (use-case de
  transición a `2.v`, guarda de origen declarativa, reuso de `resolverPlanBloqueo({fase:'2.v'})`
  + rama insert-o-update de `FECHA_BLOQUEADA` en la UoW, disparo del motor E6, AUDIT_LOG),
  `apps/web/src/features/reservas/**` (acción "Programar visita" + formulario + feedback).
  Read-model `GET /reservas/{id}` ya existe (US-005).
- **Migración**: **no**. Los campos `visita_programada_fecha`, `visita_programada_hora`,
  `visita_realizada`, el sub-estado `2v` (enum) y `TENANT_SETTINGS.max_dias_programar_visita`
  ya están en el modelo desde US-000 (`er-diagram.md §RESERVA`, `§TENANT_SETTINGS`). A
  confirmar en `design.md §D-7` que la columna/enum/seed existen en `prisma/schema.prisma`
  de `master`; si faltara `max_dias_programar_visita` en el seed, será la única migración.
- Trazabilidad: **US-008**, **UC-07**; entidades RESERVA, FECHA_BLOQUEADA, COMUNICACION,
  AUDIT_LOG, TENANT_SETTINGS; automatización **A18** (mecánica de la transición + E6);
  recordatorios **A19/A20** (fuera de alcance, ver abajo); concurrencia con el barrido
  **A4/US-012**.
- Dependencias (todas en `master`): US-001 (sesión), US-004/US-005/US-007 (existe una
  RESERVA en `2.a`/`2.b`/`2.c`; para `2.b`/`2.c` hay fila activa en `FECHA_BLOQUEADA`
  que se actualiza), US-040/US-041 (bloqueo atómico/liberación), US-045 (motor de email
  E1–E8 para E6).

## Lo que NO entra (anti-scope)

- **Recordatorios A19/A20 (jobs de recordatorio/alerta al gestor)**: el día de la visita
  (A19) y el día posterior sin marcar resultado (A20) son automatizaciones internas
  (recordatorios al gestor, no E-codes al cliente). La US los lista en alcance ✅ de la
  mecánica de visita, pero su implementación es un **job de barrido** (patrón estado en
  fila + cron, como A4) que **no es la transición** de esta US. **Recomendación
  (PENDIENTE de Gate, `design.md §D-8`)**: implementar A19/A20 como un slice separado
  de jobs; este change entrega la **transición** (estado + bloqueo + E6 + auditoría),
  que es lo que habilita esos recordatorios. Si el humano lo decide, A19/A20 se incluyen
  aquí.
- **Registro del resultado de la visita (US-009/010/011)**: `visita_realizada`
  permanece `false`; las transiciones de salida de `2.v` (visita realizada/no realizada)
  son otras US.
- **A21b (expiración día +7 sin programar visita)**: parte de la lógica de expiración,
  se cubre en US-012 (UC-09).
- **Otras transiciones de la máquina de estados** (`2.v → pre_reserva`, `2.v → terminal`,
  etc.): fuera de esta US, que cubre exclusivamente la **entrada** a `2.v`.

## Decisiones de alcance pendientes de aprobación humana

Las decisiones de diseño están **razonadas con recomendación** en `design.md` y quedan
**abiertas hasta el OK del Gate SDD**. En particular:
- **D-2**: rama insert-o-update de `FECHA_BLOQUEADA` (el `er-diagram.md §3.16` marca
  `fase '2.v' → insert`, pero la US exige **update** cuando se viene de `2.b`/`2.c`); se
  recomienda refinar la primitiva a insert-o-update según el origen.
- **D-6**: el envío de E6 como **efecto posterior al commit** (la atomicidad cubre
  RESERVA + FECHA_BLOQUEADA; el email no debe revertir el estado si el proveedor falla,
  se reintenta vía el trazado de `COMUNICACION`).
- **D-7**: confirmar que no hace falta migración (campos de visita + setting ya en
  `master`).
- **D-8**: A19/A20 en este change vs slice de jobs separado.

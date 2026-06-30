# Change: us-007-transicion-pendiente-invitados

## Why

US-007 cubre la **transición de una consulta con fecha bloqueada (`2.b`) al
sub-estado "pendiente de número de invitados" (`2.c`)**: el Gestor marca un lead
en `2.b` como pendiente de aforo cuando el cliente ya tiene intención firme sobre
la fecha pero aún no ha confirmado el número de invitados. La transición **extiende
el bloqueo de la fecha** y **vacía atómicamente la cola de espera** de esa fecha
(automatización A16). A diferencia de US-005 (`2.a → 2.b`, que **fija** una fecha y
crea/oferta cola), aquí el agregado RESERVA **ya tiene fecha bloqueada activa** y la
operación **señala intención firme**, prolonga el TTL y **descarta** a quienes
esperaban en cola por esa misma fecha. Resuelve **D2** (visibilidad del pipeline:
un estado diferenciado que refleja intención firme y madura el lead), **D3**
(estados claros de la reserva), **D4** (el bloqueo de fecha se extiende con
intención firme, sin doble reserva) y **D13** (la cola se vacía porque la consulta
bloqueante tiene intención real de continuar, liberando expectativas falsas).
(Fuente: `US-007 §Historia`, `§Contexto de Negocio`; UC-06; A16.)

El cimiento ya existe en `master` y **se reutiliza, no se recrea**:

- **Bloqueo atómico de fecha (US-040/US-041)**: la primitiva
  `resolverPlanBloqueo({ fase: '2.c', ahora, settings })` ya está modelada en
  `er-diagram.md §3.16` como `fase '2.c' → {blando, ttl_actual + ttl_consulta_dias,
  accion: 'extend'}`. La extensión del TTL de `FECHA_BLOQUEADA` se hace **dentro de
  la misma transacción** que la mutación de la RESERVA, vía `SELECT … FOR UPDATE`
  sobre la fila bloqueante (regla dura del proyecto: nada de Redis/Redlock).
- **Modelo de cola de US-004/US-005** (mismos campos `posicion_cola`,
  `consulta_bloqueante_id`, self-relation `ColaEspera`): el vaciado lee todas las
  RESERVA con `consulta_bloqueante_id = id de la bloqueante` y `sub_estado = '2d'` y
  las pasa a `2.y` con `posicion_cola = NULL` y `consulta_bloqueante_id = NULL`,
  **en la misma transacción**. **Sin tabla auxiliar de cola** (`er-diagram.md §3.4,
  §7.3`).
- **Máquina de estados declarativa de US-004/US-005** (`maquina-estados.ts`,
  `ORIGENES_TRANSICION_*` + tablas de reglas): se **extiende** con la guarda de
  origen `2.b → 2.c`, modelada como dato, no como condicionales dispersos.
- **TENANT_SETTINGS.ttl_consulta_dias** (default 3): la extensión usa el setting,
  **nunca un valor hardcodeado** (`er-diagram.md §3.16`).
- **AUDIT_LOG (US-003+)**: `accion = 'transicion'` se registra para la RESERVA
  principal y para cada RESERVA descartada de la cola, en la misma transacción.

(Fuente: ver `design.md` para firmas previstas, rutas reales y decisiones de reutilización.)

## What Changes

> Slice vertical (backend + contrato + frontend "ficha de consulta 2.b" con acción
> "Marcar como pendiente de invitados"). Sujeto al **Gate de revisión humana SDD**
> (decisiones en `design.md`).

- **Nueva acción de transición sobre una RESERVA existente en `2.b`**: el Gestor
  marca el lead como "pendiente de número de invitados". El servidor **valida que la
  RESERVA está en `sub_estado = '2b'`** (única origen legal del happy path), que
  tiene una **fila activa en `FECHA_BLOQUEADA`** y que `ttl_expiracion > ahora`
  (bloqueo vigente). (Fuente: `US-007 §Happy Path`, `§Reglas de Validación`; UC-06.)
- **Transición `2.b → 2.c` + extensión de TTL**: actualiza la RESERVA a
  `sub_estado = '2c'`, fija
  `ttl_expiracion = ttl_expiracion_actual + TENANT_SETTINGS.ttl_consulta_dias`
  (+3 por defecto) y **actualiza en la misma transacción** la fila de
  `FECHA_BLOQUEADA` de esa RESERVA al mismo nuevo `ttl_expiracion`. Reprograma el TTL
  de expiración (A4) reutilizando la liberación de US-041. (Fuente: `US-007 §Happy
  Path`; `er-diagram.md §3.16` `fase '2.c' → extend`.)
- **Vaciado atómico de la cola (mecánica A16)**: en la **misma transacción**, todas
  las RESERVA con `consulta_bloqueante_id = id de esta RESERVA` y `sub_estado = '2d'`
  pasan a `sub_estado = '2y'` (descartada por cola, terminal), con `posicion_cola =
  NULL` y `consulta_bloqueante_id = NULL`. Si la cola está vacía, la operación afecta
  a 0 filas y la transición se completa igualmente sin error. El vaciado es
  **irreversible** (`2.y` es terminal). (Fuente: `US-007 §Happy Path con cola`,
  `§Reglas de negocio`; A16; `er-diagram.md §7.3`.)
- **Atomicidad de las 4 operaciones**: actualizar `sub_estado`, extender TTL en
  RESERVA, extender TTL en `FECHA_BLOQUEADA` y vaciar la cola (`2.d → 2.y`) ocurren
  **all-or-nothing** en una única transacción de BD bajo el contexto RLS del tenant.
  Un fallo parcial revierte toda la transacción (rollback): el sistema nunca queda en
  un estado intermedio (`2.c` con cola sin vaciar, o viceversa). (Fuente: `US-007
  §Concurrencia`, `§Reglas de Validación`.)
- **Guarda de origen y estados inmutables**: si la petición llega sobre una RESERVA
  que **no** está en `2.b` —incluidos `2.a` sin bloqueo, los terminales `2.x`/`2.y`/
  `2.z`, `reserva_cancelada`/`reserva_completada`, o cualquier otro— el servidor
  responde error de validación **sin modificar** nada. Los terminales son inmutables.
  (Fuente: `US-007 §FA Estado terminal`, `§Reglas de Validación`.)
- **TTL expirado → transición no permitida**: si la RESERVA en `2.b` tiene
  `ttl_expiracion < ahora` (el bloqueo ya expiró; A4 debería haberla pasado a `2.x`),
  el servidor informa de que el bloqueo ha expirado y **no** permite la transición;
  la RESERVA no se modifica. (Fuente: `US-007 §FA TTL expirado`.)
- **Sin fecha bloqueada → transición no permitida**: si la RESERVA no tiene fila
  activa en `FECHA_BLOQUEADA` (p. ej. un `2.a` sin bloqueo), el servidor rechaza la
  transición a `2.c` con error de validación; la RESERVA permanece sin cambios. La UI
  puede deshabilitar la acción cuando no hay bloqueo activo; la validación es también
  **defensiva en servidor**. (Fuente: `US-007 §FA-01`; UC-06 FA-01.)
- **Concurrencia D13/D4**: la transición a `2.c` y el vaciado de cola se serializan
  en una única transacción con `SELECT … FOR UPDATE` sobre la fila bloqueante de
  `FECHA_BLOQUEADA`, de modo que una operación concurrente sobre la misma fecha (p.
  ej. promoción/salida de cola UC-12/UC-13) **no** puede dejar la cola medio vaciada
  ni el bloqueo en estado inconsistente. Cubierto con **tests de concurrencia
  reales** en TDD-RED (skill `concurrency-locking`). (Fuente: `US-007 §Concurrencia`.)
- **Frontend "ficha de consulta 2.b"**: acción "Marcar como pendiente de invitados"
  (visible/habilitada solo con bloqueo activo en `2.b`), confirmación, y feedback del
  resultado (nuevo TTL, recuento de consultas de cola descartadas). Responsive
  mobile-first (390/768/1280).

## Impact

- Specs: **modifica la capability `consultas`** (añade los requisitos de la
  transición `2.b → 2.c`, la extensión atómica del TTL en RESERVA + `FECHA_BLOQUEADA`,
  el vaciado atómico de la cola `2.d → 2.y` (A16), la guarda de origen `2.b`, las
  precondiciones de bloqueo vigente/fecha bloqueada, la concurrencia D13/D4 de la
  transición y la auditoría `accion='transicion'` de la principal y de cada RESERVA
  descartada). **Reutiliza sin modificar** la capability `bloqueo-fecha`
  (US-040/041): la primitiva de extensión `fase '2.c'` ya está descrita en su modelo
  — **no se crea delta de `bloqueo-fecha`**.
- Contrato OpenAPI (`docs/api-spec.yml`): se prevé un **endpoint nuevo de transición**
  sobre la RESERVA existente — `POST /reservas/{id}/pendiente-invitados` (ver
  `design.md §D-6`, input para la fase de contrato). El `contract-engineer`
  (post-gate) lo definirá; **no se toca `docs/api-spec.yml` en este change de spec**.
  No se edita el cliente generado a mano.
- Código (implementación posterior, fuera de este change de spec):
  `apps/api/src/reservas/{domain,application,infrastructure,interface}/**` (use-case
  de transición a `2.c`, guarda de origen `2.b` declarativa, reuso de
  `resolverPlanBloqueo({fase:'2.c'})` + extensión de `FECHA_BLOQUEADA` en la UoW,
  vaciado de cola, AUDIT_LOG), `apps/web/src/**` (acción "Marcar como pendiente de
  invitados" + feedback). Read-model `GET /reservas/{id}` ya existe (US-005).
- **Migración**: **no** (todas las columnas e índices de cola/bloqueo/TTL existen
  desde US-000/US-040/US-004; el sub-estado `2y` y los campos `posicion_cola`/
  `consulta_bloqueante_id` ya están en `master`).
- Trazabilidad: **US-007**, **UC-06**; entidades RESERVA, FECHA_BLOQUEADA,
  COMUNICACION, AUDIT_LOG, TENANT_SETTINGS; automatización **A16** (mecánica del
  vaciado); reprogramación de TTL **A4** (vía US-041).
- Dependencias (todas en `master`): US-001 (sesión), US-004/US-005 (debe existir una
  RESERVA en `2.b` con fecha bloqueada activa + reglas de estado/cola), US-040/US-041
  (bloqueo atómico/liberación/extensión de TTL).

## Lo que NO entra (anti-scope)

- **Email al cliente solicitando nº de invitados (UC-06 paso 7)**: la ficha lo
  describe pero §9.3 **no le asigna un código `E` (E1–E8)**. Se identifica como **gap
  de spec**, abierto a decisión del product owner (¿nuevo E-code o gestión manual
  desde el log de comunicaciones en MVP?). **No se implementa envío** en este change;
  el spec-delta lo marca explícitamente como fuera de alcance. (Fuente: `US-007 §Email
  relacionado`, `§Notas de alcance`.)
- **Emails automáticos de vaciado de cola a los clientes en `2.d` (A16)**: son **📐
  solo diseñados en MVP, no implementados**. Se implementa la **mecánica** del vaciado
  (`2.d → 2.y`); el gestor ve el resultado en la UI de cola (UC-11). **No se envían
  emails de cola.** (Fuente: `US-007 §Notas de alcance`.)
- **Gestión de cola UC-11/12/13** (promoción, reordenación, salida voluntaria): fuera
  de alcance; aquí solo el **vaciado** (`2.d → 2.y`) provocado por la transición a
  `2.c`.
- **Otras transiciones de la máquina de estados** (`2.c → pre_reserva`, `2.c → 2.x`
  por TTL, `2.v`, etc.): fuera de esta US, que cubre exclusivamente `2.b → 2.c` con su
  vaciado de cola.
- **Caso de origen `2.a` con bloqueo activo (UC-06 precondición secundaria)**: el
  happy path canónico de la ficha es `2.b → 2.c`. Si el humano confirma admitir
  `2.a` con fila activa en `FECHA_BLOQUEADA` como origen, se ajustará la guarda; por
  defecto el spec-delta exige `2.b` (ver `design.md §D-1`, abierto al Gate SDD).

## Decisiones de alcance pendientes de aprobación humana

Las decisiones de diseño (origen `2.b` estricto vs admitir `2.a`-con-bloqueo;
endpoint de transición; reuso de `resolverPlanBloqueo({fase:'2.c'})`; vaciado de cola
en la misma UoW con `SELECT … FOR UPDATE`; tratamiento del email de UC-06 paso 7 como
gap de spec) están **razonadas con recomendación** en `design.md`. Quedan **abiertas
hasta el OK del Gate SDD**. En particular, **D-1** (origen `2.b` estricto) y **D-7**
(email de invitados sin E-code: gap a confirmar con el product owner) requieren
decisión humana explícita.

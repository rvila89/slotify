# Change: us-005-transicion-exploratoria-a-con-fecha

## Why

US-005 cubre la **transición de una consulta exploratoria existente (`2.a`) a
consulta con fecha (`2.b`)**: el Gestor añade una `fecha_evento` concreta a una
RESERVA que **ya existe** en `sub_estado = '2a'`, sin crear un lead nuevo. A
diferencia de US-004 (alta de un lead **nuevo** con fecha sobre `POST /reservas`),
aquí **el agregado RESERVA ya existe** y lo que cambia es su sub-estado y su
disponibilidad de fecha. Resuelve **D2** (visibilidad del pipeline: la consulta
avanza de estado sin duplicarse), **D3** (estados claros de reserva), **D4**
(bloqueo atómico anti-doble-reserva desde que se fija la fecha) y **D5**
(trazabilidad completa del lead en un único registro). (Fuente: `US-005 §Historia`,
`§Contexto de Negocio`, UC-04; A1, A4.)

El cimiento ya existe en `master` y **se reutiliza, no se recrea**:

- **Bloqueo atómico de US-040/US-041** (`bloquearEnTx(tx, …)` / `resolverPlanBloqueo`
  con `fase '2.b' → {insert, blando, now()+ttl_consulta_dias}`): transacción con
  `SELECT … FOR UPDATE` + INSERT, traducción `P2002 → FechaYaBloqueadaError`, garantía
  `UNIQUE(tenant_id, fecha)`, validación `validarFechaFutura`. **Sin reinventar el
  bloqueo** (regla dura del proyecto).
- **Reglas de estado y cola de US-004** (mismo edge `2.d`): la máquina de estados
  declarativa `maquina-estados.ts` (`determinarAltaConFecha` + tabla
  `REGLAS_ALTA_CON_FECHA`), la serialización de `posicion_cola` por la fila bloqueante
  (`SELECT … FOR UPDATE`) y el índice UNIQUE parcial `reserva_cola_posicion_key`.
- **Motor de email de US-045**: el email de confirmación de bloqueo provisional es una
  **extensión de E1** (sin código `E` propio); se persiste la COMUNICACION y se envía
  con el motor real de US-045 ya en `master`. **No se reinventa el envío.**
- **Schema Prisma (US-000/US-040)**: `Reserva.sub_estado` (enum con `s2a/s2b/s2d`),
  `fecha_evento`, `ttl_expiracion`, `posicion_cola`, `consulta_bloqueante_id`
  (+ self-relation `ColaEspera`); `FechaBloqueada.tipo_bloqueo`, `UNIQUE(tenant_id,
  fecha)`; `TenantSettings.ttl_consulta_dias`. Todo presente: **sin migración de
  columnas**.

(Fuente: ver `design.md` para firmas, rutas reales y decisiones de reutilización.)

## What Changes

> Slice vertical (backend + contrato + frontend "ficha de consulta 2.a" con acción
> "Añadir fecha"). Sujeto al **Gate de revisión humana SDD** (decisiones en
> `design.md`, en especial D-1 sobre la regla de fecha).

- **Nueva acción de transición sobre una RESERVA existente en `2.a`**: el Gestor
  introduce una `fecha_evento` desde la ficha del lead. El servidor **valida que la
  RESERVA está en `sub_estado = '2a'`** (única origen legal) y que la fecha es válida,
  y ramifica el sub-estado destino según el estado de disponibilidad de la fecha para
  el tenant. (Fuente: `US-005 §Happy Path`, `§Reglas de Validación`.)
- **Fecha libre → `2.a → 2.b` + bloqueo blando**: actualiza la RESERVA a
  `sub_estado='2b'`, almacena `fecha_evento`, fija
  `ttl_expiracion = now()+ttl_consulta_dias` (3 por defecto), e **inserta** en la
  **misma transacción** `FECHA_BLOQUEADA` con `tipo_bloqueo='blando'`, `reserva_id` y
  el mismo `ttl_expiracion`. Programa el TTL de expiración (A4) y registra
  `AUDIT_LOG` (`accion='transicion'`, `datos_anteriores.sub_estado='2a'`,
  `datos_nuevos.sub_estado='2b'`). (Fuente: `US-005 §Happy Path`.)
- **Fecha bloqueada por una consulta en `2.b` → oferta de cola (`2.a → 2.d`)**: el
  sistema **informa** al gestor y ofrece entrar en cola. Si **acepta**, transiciona a
  `2.d` con `posicion_cola = MAX(de esa fecha)+1` y `consulta_bloqueante_id`; **NO**
  inserta `FECHA_BLOQUEADA`. Si **rechaza**, la RESERVA **permanece en `2.a`** sin
  cambios. Comportamiento equivalente al edge `2.d` de US-004. (Fuente:
  `US-005 §FA-01`, A14.)
- **Fecha bloqueada por `2.c`/`2.v`/`pre_reserva`/`reserva_confirmada` o posterior →
  sin cola**: el sistema informa que la fecha no está disponible y **no ofrece cola**;
  la RESERVA **permanece en `2.a`** sin ningún cambio (ni RESERVA ni `FECHA_BLOQUEADA`).
  (Fuente: `US-005 §FA-02`.)
- **Guarda de origen `2.a`**: si la petición llega sobre una RESERVA que **no** está
  en `2.a` (p. ej. ya `2.b`/`2.c` o estados terminales `2.x`/`2.y`/`2.z`/
  `reserva_cancelada`/`reserva_completada`), el servidor responde error de validación
  **sin modificar** la RESERVA. (Fuente: `US-005 §FA RESERVA no está en 2.a`,
  `§Reglas de Validación`.)
- **Concurrencia D4**: dos transiciones simultáneas de **dos RESERVA distintas**
  (mismo tenant, ambas en `2.a`) hacia la **misma `fecha_evento`** libre → **una gana**
  (`2.b` + `FECHA_BLOQUEADA`), la otra recibe la violación `UNIQUE(tenant_id, fecha)`
  (`P2002`) y el sistema **le ofrece entrar en cola (`2.d`)** sin doble bloqueo.
  Cubierto con **tests de concurrencia reales** en TDD-RED. (Fuente:
  `US-005 §Concurrencia`.)
- **Email de confirmación de bloqueo provisional (extensión de E1)**: tras una
  transición exitosa `2.a → 2.b`, se registra la COMUNICACION y se **envía con el motor
  de US-045**. No tiene código `E` propio (§9.3 E1–E8); es una extensión de E1 para el
  caso de actualización de fecha. (Fuente: `US-005 §Email relacionado`,
  `§Notas de alcance`.)
- **Frontend "ficha de consulta"**: acción "Añadir fecha" sobre un lead en `2.a`, con
  selector de fecha (bloquea fechas no válidas) y los avisos de resultado (confirmación
  `2.b`, oferta de cola con confirmar/rechazar, no disponible). Responsive
  mobile-first.

## Impact

- Specs: **modifica la capability `consultas`** (añade los requisitos de la transición
  `2.a → 2.b`/`2.d`/sin cambios, la guarda de origen `2.a`, la concurrencia D4 de la
  transición, la auditoría `accion='transicion'` y el email de confirmación de bloqueo
  provisional). **Reutiliza sin modificar** la capability `bloqueo-fecha` (US-040/041):
  su requisito "Bloqueo atómico vía transacción … Scenario: Bloqueo blando en
  transición a 2.b" ya describe exactamente la primitiva invocada aquí — **no se crea
  delta de `bloqueo-fecha`**.
- Contrato OpenAPI (`docs/api-spec.yml`): se prevé un **endpoint nuevo de transición**
  sobre la RESERVA existente — `POST /reservas/{id}/fecha` (ver `design.md §D-7`,
  input para la fase de contrato). El `contract-engineer` (post-gate) lo definirá; **no
  se toca `docs/api-spec.yml` en este change de spec**. No se edita el cliente generado
  a mano.
- Código (implementación posterior, fuera de este change de spec):
  `apps/api/src/reservas/{domain,application,infrastructure,interface}/**` (use-case de
  transición, guarda de origen `2.a`, reuso de `bloquearEnTx` en la UoW de la
  transición, cola, COMUNICACION + envío US-045), `apps/web/src/**` (acción "Añadir
  fecha" + avisos).
- **Migración**: **no** (todas las columnas e índices de cola/bloqueo existen desde
  US-000/US-040/US-004; el índice `reserva_cola_posicion_key` ya está en `master`).
- Trazabilidad: **US-005**, **UC-04**; entidades RESERVA, FECHA_BLOQUEADA,
  COMUNICACION, AUDIT_LOG, TENANT_SETTINGS; automatizaciones **A1**, **A4**; email
  extensión de **E1** vía motor **US-045**.
- Dependencias (todas en `master`): US-001 (sesión), US-004 (alta con fecha + reglas de
  estado/cola), US-040/US-041 (bloqueo atómico/liberación), US-045 (motor email).

## Lo que NO entra (anti-scope)

- **Gestión posterior de la cola (UC-11/12/13)**: promoción, reordenación, vaciado,
  notificación al promovido. Aquí solo la **entrada** a la cola (`2.d` + posición +
  bloqueante) cuando el gestor acepta. (Fuente: `US-005 §Dependencias`,
  `§Notas de alcance`.)
- **Otras transiciones de la máquina de estados** (`2.b → 2.c`, `2.b → pre_reserva`,
  `2.v`, terminales, etc.): fuera de esta US, que cubre exclusivamente `2.a → 2.b/2.d`.
- **Liberación/expiración del bloqueo (US-041)**: ya existe; el TTL programado (A4) se
  apoya en ella. No se toca aquí.
- **Código `E` nuevo para el email**: el email es extensión de E1, sin código propio en
  §9.3; reutiliza el motor de US-045.

## Decisiones de alcance pendientes de aprobación humana

Las decisiones de diseño (regla de fecha `≥ hoy` vs `> hoy`; endpoint de transición;
contrato de la oferta de cola con `aceptarCola`; reuso de `bloquearEnTx` en la UoW de
la transición; concurrencia D4 con re-derivación a `2.d`; reuso del motor de email
US-045) están **razonadas con recomendación** en `design.md`. Quedan **abiertas hasta
el OK del Gate SDD**. En particular, **D-1** (divergencia recomendada de la ficha
`≥ hoy` hacia `> hoy` para unificar la regla con US-040/US-016/US-004) requiere
decisión humana explícita.

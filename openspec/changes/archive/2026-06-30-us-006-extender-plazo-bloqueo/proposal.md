# Change: us-006-extender-plazo-bloqueo

## Why

US-006 cubre el **override manual del Gestor para extender el plazo (TTL) del
bloqueo activo** de una RESERVA antes de que expire: el Gestor gana tiempo
adicional mientras el cliente decide, **sin liberar la fecha** ni disparar la
promoción de cola de forma prematura. Aplica cuando existe un **bloqueo blando
vigente**: `sub_estado ∈ {2b, 2c, 2v}` O `estado = 'pre_reserva'`, con
`ttl_expiracion > ahora`. Es la acción descrita en UC-05 y en §6.3
SlotifyGeneralSpecs (override manual). Resuelve **D4** (evitar liberar una fecha
por expiración no gestionada cuando el gestor tiene intención de mantener el
bloqueo) y **D11** (los recordatorios automáticos se reprograman a la nueva fecha
de expiración, evitando notificaciones prematuras). (Fuente: `US-006 §Historia`,
`§Contexto de Negocio`; UC-05.)

A diferencia de US-005/US-007/US-008 —que son **transiciones de máquina de
estados** (cambian `sub_estado`)— US-006 **NO cambia estado, sub_estado,
tipo_bloqueo ni fecha**: es una **prórroga pura del TTL** del bloqueo ya existente.
La operación reutiliza el cimiento ya en `master`, **no lo recrea**:

- **Bloqueo atómico de fecha (US-040/US-041)**: la fila de `FECHA_BLOQUEADA`
  (`tipo_bloqueo = 'blando'`) y su `ttl_expiracion` se actualizan **dentro de la
  misma transacción** que la mutación de la RESERVA, vía `SELECT … FOR UPDATE`
  sobre la fila bloqueante (regla dura del proyecto: nada de Redis/Redlock).
- **Patrón estado-en-fila + barrido periódico (`architecture.md §2.5`)**: los
  recordatorios automáticos (A3/A4/A5) **no son timers exactos** ni una tabla de
  jobs programados; se derivan de `ttl_expiracion` y los dispara el cron de
  barrido (US-012, aún no implementado). Por tanto, **extender `ttl_expiracion`
  reprograma A3/A4/A5 implícitamente**: el barrido los reevalúa contra el nuevo
  valor. No hay "scheduler" que tocar. (Fuente: `architecture.md §2.5`;
  `US-006 §Reglas de negocio`.)
- **Concurrencia frente al barrido de expiración (US-012)**: la extensión y el
  barrido pueden competir por la misma fila bloqueante. La operación es
  transaccional y se serializa con `SELECT … FOR UPDATE`, de modo que **no puede
  resucitar** un bloqueo ya expirado-y-procesado por el barrido ni dejar estado
  intermedio. (Fuente: `US-006 §Notas`, `concurrencia_critica`;
  `architecture.md §2.4`, `§2.5`.)
- **AUDIT_LOG (US-003+)**: la extensión se registra con `accion = 'actualizar'`,
  `entidad = 'RESERVA'`, `datos_anteriores.ttl_expiracion` y
  `datos_nuevos.ttl_expiracion`, en la misma transacción.

(Fuente: ver `design.md` para firmas previstas, rutas reales y decisiones de
reutilización.)

## What Changes

> Slice vertical (backend + contrato + frontend "ficha de consulta/pre-reserva"
> con la acción "Extender bloqueo"). Sujeto al **Gate de revisión humana SDD**
> (decisiones en `design.md`).

- **Nueva acción de extensión sobre una RESERVA existente con bloqueo activo**: el
  Gestor selecciona "Extender bloqueo", introduce **N días enteros ≥ 1** y
  confirma. El servidor **valida la precondición de bloqueo activo**
  (`sub_estado ∈ {2b, 2c, 2v}` O `estado = 'pre_reserva'`), que existe una **fila
  activa en `FECHA_BLOQUEADA`** y que `ttl_expiracion > ahora` (bloqueo vigente).
  (Fuente: `US-006 §Happy Path`, `§Reglas de Validación`; UC-05.)
- **Extensión del TTL en días enteros**: actualiza
  `RESERVA.ttl_expiracion = ttl_expiracion_actual + N días` (la base es el
  `ttl_expiracion` **actual**, no `now()`). Si `FECHA_BLOQUEADA.tipo_bloqueo =
  'blando'` (siempre lo es para estos estados), **actualiza en la misma
  transacción** la fila de `FECHA_BLOQUEADA` de esa RESERVA al **mismo nuevo
  valor**. (Fuente: `US-006 §Happy Path`, `§Reglas de Validación`.)
- **NO muta estado/sub_estado/tipo_bloqueo/fecha**: la operación es una prórroga
  pura del TTL. La RESERVA permanece en su mismo `estado`/`sub_estado`, el
  `tipo_bloqueo` sigue `'blando'` y la `fecha` de `FECHA_BLOQUEADA` no cambia.
  (Fuente: `US-006 §Reglas de Validación`.)
- **Reprogramación implícita de recordatorios (A3/A4/A5)**: como los recordatorios
  se derivan de `ttl_expiracion` y los dispara el barrido periódico (US-012), la
  extensión del TTL **los reprograma sin acción adicional**: A3 (día+2 desde la
  nueva base, si aplica al estado) y A4/A5 (día del nuevo vencimiento) se
  reevalúan contra el nuevo `ttl_expiracion`. No se introduce ni se toca un
  scheduler. (Fuente: `US-006 §Happy Path`, `§Automatización relacionada`;
  `architecture.md §2.5`; `design.md §D-5`.)
- **Auditoría `accion = 'actualizar'`**: se registra una fila en `AUDIT_LOG` con
  `entidad = 'RESERVA'`, `datos_anteriores.ttl_expiracion = valor previo`,
  `datos_nuevos.ttl_expiracion = nuevo valor`, en la misma transacción.
  (Fuente: `US-006 §Happy Path`, `§Reglas de Validación`.)
- **Atomicidad de las tres operaciones**: actualizar `ttl_expiracion` en RESERVA,
  actualizar `ttl_expiracion` en `FECHA_BLOQUEADA` y escribir `AUDIT_LOG` ocurren
  **all-or-nothing** en una única transacción de BD bajo el contexto RLS del
  tenant. Un fallo parcial revierte toda la transacción (rollback): nunca el TTL
  de RESERVA extendido con `FECHA_BLOQUEADA` sin extender, ni viceversa. (Fuente:
  `US-006 §Reglas de Validación`; `CLAUDE.md §Regla crítica: bloqueo atómico`.)
- **TTL ya expirado → extensión no permitida**: si `RESERVA.ttl_expiracion <
  ahora`, el servidor informa de que el bloqueo ha expirado y **no** permite la
  extensión; ni RESERVA ni `FECHA_BLOQUEADA` se modifican. Una extensión **no
  puede "deshacer"** una expiración ya ejecutada por el barrido (A4/A5 ya habrían
  pasado la RESERVA a `2.x`/`reserva_cancelada`). (Fuente: `US-006 §FA TTL ya
  expirado`.)
- **Estado sin bloqueo activo → extensión no permitida**: si la RESERVA está en
  `2.a` (sin fecha bloqueada), en un estado terminal (`2.x`, `2.y`, `2.z`,
  `reserva_completada`, `reserva_cancelada`) o en `reserva_confirmada` (bloqueo
  **firme**, sin TTL), no hay TTL extensible. La UI no muestra la acción para
  esos estados; si la petición llega por otra vía, el servidor responde error de
  validación indicando que no hay bloqueo activo extensible, sin mutar nada.
  (Fuente: `US-006 §FA estado sin bloqueo activo`, `§Reglas de Validación`.)
- **Valor de extensión inválido (0, negativo o no entero) → rechazo**: el servidor
  rechaza con error de validación ("El número de días de extensión debe ser un
  entero positivo (≥ 1)"); no se modifica ningún registro. (Fuente: `US-006 §FA
  valor inválido`, `§Reglas de Validación`.)
- **Concurrencia frente al barrido de expiración (US-012)**: la extensión se
  serializa con `SELECT … FOR UPDATE` sobre la fila bloqueante de
  `FECHA_BLOQUEADA`, de modo que una ejecución concurrente del barrido sobre la
  misma fecha **no** puede dejar el bloqueo medio extendido ni resucitar uno ya
  expirado. Cubierto con **tests de concurrencia reales** en TDD-RED (skill
  `concurrency-locking`). (Fuente: `US-006 §concurrencia_critica`;
  `architecture.md §2.4`, `§2.5`.)
- **Frontend "ficha de consulta/pre-reserva"**: acción "Extender bloqueo"
  (visible/habilitada solo con bloqueo activo en `2b/2c/2v/pre_reserva` y TTL
  vigente), input de N días con validación de entero ≥ 1, confirmación y feedback
  del nuevo `ttlExpiracion`. Responsive mobile-first (390/768/1280).

## Impact

- Specs: **modifica la capability `consultas`** (añade los requisitos de la
  extensión manual del TTL: precondición de bloqueo activo multi-estado, extensión
  atómica de `RESERVA.ttl_expiracion` + `FECHA_BLOQUEADA.ttl_expiracion` por N
  días, invariancia de estado/sub_estado/tipo_bloqueo/fecha, reprogramación
  implícita de recordatorios A3/A4/A5 vía el barrido, auditoría
  `accion='actualizar'`, edge cases TTL expirado / sin bloqueo activo /
  reserva_confirmada / valor inválido, atomicidad y concurrencia frente al
  barrido). **Reutiliza sin modificar** la capability `bloqueo-fecha`
  (US-040/041): la extensión del TTL de un bloqueo blando ya está dentro de su
  modelo (fase `2.c` → `extend`); US-006 generaliza la **base de días** (N
  arbitrario en lugar de `ttl_consulta_dias`) en el use-case invocante — **no se
  crea delta de `bloqueo-fecha`**. (Ver `design.md §D-4`.)
- Contrato OpenAPI (`docs/api-spec.yml`): se prevé un **endpoint nuevo de acción**
  sobre la RESERVA existente — `POST /reservas/{id}/extender-bloqueo` con body
  `{ dias: integer ≥ 1 }` (ver `design.md §D-2` y `§D-6`). El `contract-engineer`
  (post-gate) lo definirá; **no se toca `docs/api-spec.yml` en este change de
  spec**. No se edita el cliente generado a mano.
- Código (implementación posterior, fuera de este change de spec):
  `apps/api/src/reservas/{domain,application,infrastructure,interface}/**`
  (use-case de extensión de TTL, guarda de precondición declarativa de "bloqueo
  activo extensible", UPDATE de `ttl_expiracion` en RESERVA + `FECHA_BLOQUEADA` en
  la UoW serializada, AUDIT_LOG `accion='actualizar'`), `apps/web/src/**` (acción
  "Extender bloqueo" + input de días + feedback). Read-model `GET /reservas/{id}`
  ya existe (US-005).
- **Migración**: **no** (la columna `ttl_expiracion` en RESERVA y en
  `FECHA_BLOQUEADA`, el `tipo_bloqueo` y los sub-estados/estados implicados ya
  existen en `master` desde US-000/US-040/US-004). `accion='actualizar'` ya está
  en el enum de `AUDIT_LOG`.
- Trazabilidad: **US-006**, **UC-05**; entidades RESERVA, FECHA_BLOQUEADA,
  AUDIT_LOG, TENANT_SETTINGS; automatizaciones reprogramadas A3/A4/A5 (override
  manual sobre A4/A5); patrón de barrido de `architecture.md §2.5`.
- Dependencias (todas en `master`, archivadas): US-001 (sesión), US-004/US-005
  (debe existir una RESERVA con bloqueo activo), US-040/US-041 (bloqueo
  atómico/liberación). Interacción con el barrido de expiración US-012
  (concurrencia) — US-012 **aún no implementado**; la operación se diseña segura
  ante carrera con un futuro barrido.

## Lo que NO entra (anti-scope)

- **Cambio de estado/sub_estado/tipo_bloqueo/fecha**: US-006 es prórroga pura del
  TTL. Cualquier transición de máquina de estados queda fuera (US-005/007/008
  cubren las suyas).
- **Implementación del barrido de expiración (A4/A5) ni el cron (US-012)**: US-006
  **no** implementa el job de expiración; solo garantiza que la extensión es segura
  ante una futura ejecución concurrente del barrido. El barrido es US-012.
- **Envío de email al cliente al extender el plazo**: UC-05 **no** describe ningún
  email al extender, y §9.3 no asigna E-code a esta acción. **No se envía ningún
  email automático**; el gestor puede comunicarlo manualmente si lo considera.
  (Fuente: `US-006 §Email relacionado`.)
- **Extensión sobre bloqueo firme (`reserva_confirmada`)**: el bloqueo firme no
  tiene TTL; la extensión no aplica ni tiene sentido. Se rechaza explícitamente.
- **Reducir/acortar el TTL o fijarlo a una fecha absoluta**: solo se contempla
  **extender** en días enteros ≥ 1 sobre el valor actual.
- **Gestión de cola (promoción/reordenación/salida)**: la extensión no toca la cola;
  al no liberar la fecha, no hay promoción. Fuera de alcance (UC-11/12/13).

## Decisiones de alcance pendientes de aprobación humana

Las decisiones de diseño (endpoint `POST /reservas/{id}/extender-bloqueo` con body
`{ dias }`; guarda de "bloqueo activo extensible" como dato declarativo vs.
precondición de presencia de fila en `FECHA_BLOQUEADA`; generalización de la base
de días en el use-case sin tocar la capability `bloqueo-fecha`; reprogramación
implícita de A3/A4/A5 vía barrido sin scheduler; tratamiento del `reserva_confirmada`
como no extensible) están **razonadas con recomendación** en `design.md`. Quedan
**abiertas hasta el OK del Gate SDD**. En particular, **D-1** (modelo de la guarda
multi-estado de bloqueo activo) y **D-3** (códigos HTTP 409 vs 422 para los edge
cases) conviene confirmarlos en el Gate.

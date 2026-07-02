# Change: us-017-visualizar-cola-espera

## Why

Hoy el Gestor **no tiene una vista dedicada** que muestre, para una fecha concreta, la
**consulta bloqueante + la cola FIFO de consultas en espera**. El calendario (US-039,
UC-29) ya superpone el indicador `🔁 N en cola` sobre la celda de una fecha con cola y su
diseño **delega explícitamente en US-017 / UC-11** la visualización de la cola al hacer
clic sobre el indicador (`calendario/spec.md` → *"Clic en el indicador de cola abre la
vista de cola"*: *"La visualización de la cola se delega en US-017 / UC-11 (fuera del
alcance de esta capability)"*). Ese clic hoy **no lleva a ningún sitio útil**: falta el
endpoint de lectura y la vista que lo consume. Es el dolor **D2** (leads sin seguimiento
unificado) y **D4** (conflicto de fechas sin visibilidad): el Gestor gestiona la
competencia por una fecha "de memoria" o en herramientas externas.
(`US-017 §Historia`, `§Contexto`, `§Impacto`; `use-cases.md` UC-11; `calendario/spec.md`
Requirement *"Clic en el indicador de cola abre la vista de cola"*.)

- **Es una vista de SOLO LECTURA** (`US-017 §Notas de alcance`: *"es lectura pura"*;
  `use-cases.md` UC-11 postcondición: *"Información de cola mostrada"*). NO muta estado, NO
  promueve (eso es US-018, ya mergeada), NO saca de cola (US-019/US-020). Su única
  responsabilidad es proyectar el estado actual de la cola de una fecha.
- **La infraestructura de cola YA EXISTE** y se reutiliza sin duplicar: los campos de cola
  (`posicion_cola`, `consulta_bloqueante_id` auto-ref) viven en `RESERVA` desde
  US-004/US-000; US-018 (promoción automática, mergeada) dejó el puerto de lectura de cola
  `ColaQueryPort` / `ColaQueryPrismaAdapter` (`hayColaActiva`) y la operación de dominio
  pura `planificarPromocionCola` (`promocion-cola.ts`). US-017 **extiende la lectura**, no
  reinventa el modelo de cola. (`US-018` archivado; `cola-query.prisma.adapter.ts`;
  `promocion-cola.ts`; `er-diagram.md §5.3`, `§Índices de cola`.)
- **El contrato OpenAPI ya reserva el path** `GET /reservas/{id}/cola` (tag `Cola`,
  *"Visualizar cola de espera de la fecha de una reserva bloqueante (UC-11)"*) con un
  esquema `ColaItem` mínimo (`idReserva`, `codigo`, `posicionCola`, `clienteNombre`).
  US-017 **madura ese placeholder** al DTO completo que la vista necesita (bloqueante +
  cola + TTL + tiempos), lo cual el `contract-engineer` cierra en el step de contrato.
  (`docs/api-spec.yml` L666-679, L1814-1820.)

## What Changes

- **Nuevo endpoint de lectura agregado por la reserva bloqueante**:
  `GET /reservas/{id}/cola` donde `{id}` es el `reservaId` de la **consulta bloqueante**
  (la que tiene la `FECHA_BLOQUEADA` activa). Devuelve un **read-model único** con dos
  secciones: la **bloqueante** (cliente, sub_estado `2.b`/`2.c`/`2.v`, TTL restante,
  código, y `visitaProgramadaFecha` si `2.v`) y la **cola** (lista de RESERVA en `2.d`
  apuntando a la bloqueante, ordenada ASC por `posicion_cola`, con cliente, código,
  posición y tiempo en cola). Se elige el path por-reserva ya presente en el contrato (el
  calendario navega desde la celda cuya `reservaId` bloqueante ya conoce por la respuesta
  de `GET /calendario`), evitando resolver fecha→bloqueante en un segundo salto.
  (`US-017 §Happy Path`; `use-cases.md` UC-11; `docs/api-spec.yml` L666-679;
  `calendario/spec.md` Requirement *"Detalle resumido al hacer clic"* — el popover ya
  expone `reservaId`.)
- **Read-model `ColaEsperaLectura` (dominio ↔ aplicación) + `ColaEsperaResponseDto`
  (HTTP)**, madurando `ColaItem` del contrato:
  - `bloqueante`: `{ idReserva, codigo, clienteNombre, subEstado (2b|2c|2v), ttlExpiracion
    (date-time|null), ttlRestante (legible|null), visitaProgramadaFecha (date|null,
    solo 2.v) }`.
  - `cola`: `ColaItem[]` ordenado ASC por `posicionCola`, cada uno
    `{ idReserva, codigo, clienteNombre, posicionCola, fechaCreacion, tiempoEnCola }`.
    (superset del `ColaItem` actual: añade `fechaCreacion`/`tiempoEnCola` para el "tiempo
    en cola").
  Las derivaciones temporales (`ttlRestante = ttl_expiracion − now()`; `tiempoEnCola =
  now() − fecha_creacion`) se calculan en el **backend** como instantes `timestamptz`,
  nunca formateando fechas (mitiga el off-by-one de TZ documentado en memoria/US-012 §D-7).
  (`US-017 §Happy Path`, `§Reglas de negocio`, `§Reglas de Validación`.)
- **Caso de uso de lectura `ObtenerColaEsperaUseCase`** (CQRS-lite, sin transacción de
  escritura, sin máquina de estados), análogo a `ObtenerReservaUseCase`: recibe
  `{ tenantId, reservaId }`, lee la bloqueante + su cola vía un **puerto de lectura**
  (`ColaEsperaQueryPort`) implementado por un adaptador Prisma. El adaptador **reutiliza el
  patrón** del `ColaQueryPrismaAdapter` de US-018 (misma tabla, mismo filtro `sub_estado =
  '2d'` + `consulta_bloqueante_id`, mismo contexto RLS); no se duplica la lógica de cola,
  se extiende con la proyección de lectura. (`cola-query.prisma.adapter.ts`;
  `obtener-reserva.query.ts`; `CLAUDE.md` hexagonal.)
- **Ordenación FIFO estricta**: la cola se devuelve ordenada **ASC por `posicion_cola`**
  (no por `fecha_creacion`), coherente con el modelo FIFO de US-004/US-018.
  (`US-017 §Reglas de negocio`.)
- **Filtrado estricto de la cola**: solo entran RESERVA con `sub_estado = '2d'` **y**
  `consulta_bloqueante_id` = id de la bloqueante activa de esa fecha; cualquier otro
  sub_estado (terminales `2x/2y/2z`, la propia bloqueante, etc.) queda excluido de la
  lista. (`US-017 §Reglas de Validación`.)
- **Edge cases del endpoint** (5 FA de la US, sin mutación en ninguno):
  - **FA-01** — fecha con bloqueante y **sin cola**: `bloqueante` presente, `cola: []`
    (la vista muestra "Sin consultas en espera para esta fecha").
  - **FA-02** — bloqueante en `2.c`: se proyecta `subEstado = '2c'` + TTL; la cola con el
    mismo formato.
  - **FA-03** — bloqueante en `2.v`: se proyecta `subEstado = '2v'` +
    `visitaProgramadaFecha` + TTL vigente.
  - **FA-04** — la reserva `{id}` **no bloquea ninguna fecha activa** (no hay
    `FECHA_BLOQUEADA` con `reserva_id = {id}`): el endpoint responde de forma que la UI
    muestre "Fecha disponible" sin secciones. El **shape exacto de FA-04** (200 con
    `bloqueante: null` / `estaBloqueada: false`, vs. 404) es una **decisión de contrato**
    (ver `design.md D-3`) que el `contract-engineer` cierra en el step de contrato.
  - **FA-05** — cola con **un único elemento** (posición 1): `cola` con un solo `ColaItem`.
  (`US-017 §Flujos Alternativos y Edge Cases`.)
- **Indicador de cola en el calendario — SIN cambio de contrato** (ver `design.md D-4`):
  el indicador `🔁 N en cola` **ya existe** y se computa en `GET /calendario` (US-039:
  `enCola = COUNT(RESERVA WHERE sub_estado='2d' AND consulta_bloqueante_id = <bloqueante>)`,
  visible solo si `enCola ≥ 1`). US-017 **NO amplía** la respuesta de `GET /calendario`: se
  reutiliza tal cual. Lo único que US-017 aporta en el frontend es **cablear el clic del
  indicador** (hoy delegado) a la nueva vista de cola. La regla de negocio de US-017 *"el
  indicador solo es visible con ≥1 RESERVA en 2.d"* **ya está satisfecha** por la spec viva
  de `calendario`. (`calendario/spec.md`; `US-039 §D-3`; `US-017 §Reglas de Validación`.)
- **Frontend — vista de cola de solo lectura**: nueva feature `features/cola-espera/`
  (estilo Bulletproof React) o pantalla dentro de `features/calendario`/`features/reservas`
  (decisión de ubicación en `design.md D-5`), responsive mobile-first (390/768/1280), que
  consume el cliente HTTP **generado** desde el contrato (nunca editado a mano). Muestra la
  sección bloqueante, la lista FIFO con "tiempo en cola" por elemento y **enlaces a la
  ficha** de cada RESERVA (`GET /reservas/{id}`, US-005 ya existente). (`US-017 §Happy
  Path`: *"Acceso a la ficha de cualquier RESERVA"*; `CLAUDE.md` frontend por dominio +
  responsive.)
- **AUDIT_LOG**: **ninguna escritura**. Es lectura pura; no se registra transición ni
  mutación. (`US-017 §Notas de alcance`.)

## Impact

- Specs afectadas: **se extiende `consultas`** con `ADDED Requirements` para la
  visualización de la cola de espera (proyección de lectura del par bloqueante+cola). NO se
  crea capability nueva (la cola vive en `consultas`, extendida por US-004/US-012/US-018).
  **NO se modifica `calendario`**: el indicador y la delegación del clic ya están en su spec
  viva; US-017 solo la consume. NO se tocan `bloqueo-fecha`, `foundation`, `calculo-tarifa`,
  `comunicaciones` ni `app-shell`. (`spec-delta` en `specs/consultas/spec.md`.)
- Datos: **ninguna entidad ni migración de esquema nueva**. Lee `RESERVA`
  (`posicion_cola`, `consulta_bloqueante_id`, `sub_estado`, `ttl_expiracion`,
  `fecha_creacion`, `visita_programada_fecha`), `FECHA_BLOQUEADA` y `CLIENTE`, todo
  provisionado. El índice de cola (`reserva_cola_posicion_key`, US-004) se **aprovecha** para
  la ordenación FIFO.
- Contrato OpenAPI: **madura un path ya existente**, no crea uno nuevo. `GET
  /reservas/{id}/cola` ya está reservado con `ColaItem`; US-017 lo evoluciona al DTO
  completo (bloqueante + cola + TTL + tiempos) y define los códigos de respuesta de FA-04.
  El `contract-engineer` cierra el delta de contrato en su step (probablemente:
  ampliar `ColaItem`, añadir `ColaEsperaResponse`, tipar 200/404).
- Multi-tenancy/RLS: la lectura filtra **siempre** por `tenant_id` del JWT + RLS activo
  (`SET LOCAL app.tenant_id`, mismo patrón que `ColaQueryPrismaAdapter` y
  `ReservaDetalleQueryPort`). Una bloqueante o cola de otro tenant es **invisible**.
- Concurrencia: **NO hay tests de race condition propios** (misma justificación que US-039
  §D-7): es lectura pura, no muta estado; las garantías de concurrencia de la cola residen
  en US-004/US-018 (escritura). Un stale-read de milisegundos no es riesgo operativo para
  una vista. El bloque TDD-RED cubre: la **derivación pura** de `ttlRestante`/`tiempoEnCola`
  y el filtrado/orden FIFO; el **use-case** de proyección (bloqueante + cola, exclusión de
  sub_estados no `2d`, aislamiento por tenant); y los **5 FA** (sin cola, 2.c, 2.v con visita,
  sin FECHA_BLOQUEADA, cola de 1).
- Frontend: hay cambios de UI → **step E2E (Playwright MCP) aplica**. Vista responsive de
  solo lectura + cableado del clic del indicador del calendario hacia ella.
- Deuda técnica considerada (no se arregla aquí): (a) off-by-one de TZ en
  `formatearFechaHora` — los derivados temporales se calculan/comparan como instantes
  `timestamptz`, nunca fecha formateada (memoria `ttl-display-timezone-offbyone`); (b) el
  test de concurrencia de US-004 flaky (`40P01`) — ajeno; solo se vigila al leer la suite
  global.
- Trazabilidad: **US-017**, **UC-11**, dolores **D2**/**D4**; reutiliza US-004
  (modelo de cola), US-018 (`ColaQueryPort`/`ColaQueryPrismaAdapter`, `promocion-cola.ts`),
  US-039 (indicador `🔁` + delegación del clic), US-005 (`GET /reservas/{id}` para las
  fichas enlazadas). **Prerequisito** de US-019 (promoción manual) y US-020 (salir de cola),
  que dependen de US-017 en `_backlog.json`.
- Fuera de alcance: la **promoción manual** por el Gestor (US-019); la **salida voluntaria**
  de cola (US-020); cualquier **mutación** del estado de la cola; el rediseño del indicador
  del calendario (US-039, ya vivo).

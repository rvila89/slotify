# Change: us-040-bloquear-fecha-atomicamente

## Why

El riesgo crítico del negocio es la **doble reserva** (dolor **D4**): que dos
solicitudes del mismo tenant bloqueen la misma fecha de forma simultánea. La US-040
(UC-30) introduce la **operación fundacional de bloqueo atómico de fecha**:
`bloquearFecha()`, una función transaccional única, compartida por todos los flujos que
necesitan reservar una fecha (alta con fecha, paso a `2.c`/`2.v`, `pre_reserva`,
`reserva_confirmada`). La garantía de no-doble-reserva reside en el **motor de
PostgreSQL** (`UNIQUE(tenant_id, fecha)` + `SELECT ... FOR UPDATE`), **no** en lógica
aplicativa. (`US-040 §Historia`, `§Reglas de negocio`; `er-diagram.md §5.3`, `§3.6`.)

Sin esta operación, las automatizaciones A1 (lead con fecha → bloqueo `2.b`),
A2 (activar pre-reserva → bloqueo 7d), A6 (confirmar señal → bloqueo firme) y
A18 (visita → bloqueo hasta día post-visita) no tienen dónde apoyarse: cada una
invoca `bloquearFecha()` como servicio. (`US-040 §Contexto`; `use-cases.md` UC-30.)

Es **infraestructura de dominio (solo backend)**: no aporta vista propia ni,
previsiblemente, endpoint HTTP propio (ver `design.md` D-7). La consumen otras US
(US-004/UC-03, US-014, etc.) desde sus transiciones de estado.

## What Changes

- **Nueva capability `bloqueo-fecha`**: operación de dominio `bloquearFecha()` que
  inserta o actualiza atómicamente una fila en `FECHA_BLOQUEADA` dentro de una
  transacción `SELECT ... FOR UPDATE`, configurando `tipo_bloqueo` y `ttl_expiracion`
  según la fase de la reserva y los valores de `TENANT_SETTINGS`. (`US-040 §Historia`,
  `§Reglas de negocio`.)
- **Mapa canónico fase → (tipo, TTL)** como estructura de datos declarativa
  (no código disperso), derivado del estado/sub-estado de la `RESERVA`:
  - `2.b` → `blando`, `ttl = now() + TENANT_SETTINGS.ttl_consulta_dias` (3 por defecto).
  - `2.c` → **extensión** del bloqueo existente: `ttl = ttl_actual + ttl_consulta_dias`,
    sin cambiar `tipo` (sigue `blando`).
  - `2.v` → `blando`, `ttl = visita_programada_fecha + 1 día`.
  - `pre_reserva` → `blando`, `ttl = now() + TENANT_SETTINGS.ttl_prereserva_dias` (7).
  - `reserva_confirmada` → **upgrade** a `firme`, `ttl = NULL` (UPDATE del registro
    existente, nunca DELETE+INSERT). (`US-040 §Reglas de negocio`, mapa canónico.)
- **Rechazo atómico determinista**: si la fecha ya tiene bloqueo activo de **otra**
  `reserva_id`, el `INSERT` falla por violación de `UNIQUE(tenant_id, fecha)` (Prisma
  `P2002`), la transacción hace `ROLLBACK` y el error se propaga al flujo invocante
  (que decidirá si ofrece cola). (`US-040 FA-01`, `§Concurrencia`.)
- **Idempotencia del upgrade firme**: un segundo bloqueo firme con el **mismo**
  `reserva_id` es un UPDATE idempotente sin error; con `reserva_id` distinto, se rechaza
  por unicidad. (`US-040 §Idempotencia del bloqueo firme`; `schema.prisma` `reservaId @unique`.)
- **Validaciones de dominio previas a la transacción**: fecha estrictamente no pasada
  ("fecha en el pasado" antes de tocar la BD), coherencia `tenant_id` bloqueo ==
  `tenant_id` reserva, y enum de `tipo_bloqueo`. (`US-040 §Reglas de Validación`,
  §Bloqueo sobre fecha pasada.)
- **Invariantes en BD (check constraints)**: `tipo='firme' ⟹ ttl IS NULL` y
  `tipo='blando' ⟹ ttl IS NOT NULL`, impuestas por el motor además de por el dominio
  (decisión `design.md` D-3). Migración Prisma con SQL crudo (la `@@unique` y RLS ya
  existen desde US-000). (`US-040 §Reglas de Validación`.)

## Impact

- Specs afectadas: **nueva capability `bloqueo-fecha`**. No modifica `foundation` ni
  `calculo-tarifa` (la `foundation` ya estableció el `UNIQUE(tenant_id, fecha)` y RLS en
  la migración 0; esta capability añade la **operación** que lo explota).
- Datos: ninguna entidad nueva — usa `FECHA_BLOQUEADA`, `RESERVA` y `TENANT_SETTINGS`
  ya provisionadas por el seed de US-000. Solo se **añaden check constraints** sobre
  `fecha_bloqueada` vía migración (no destructiva). (`design.md` D-3.)
- Contrato OpenAPI: **previsiblemente NO se expone endpoint HTTP propio** — es una
  operación interna de dominio invocada por otros casos de uso, no una acción de
  usuario. Decisión razonada y revisable en `design.md` D-7; este change **no edita
  `docs/api-spec.yml`**.
- Código (implementación posterior, fuera de este change de spec): servicio de dominio
  `bloquearFecha()` en `apps/api` (hexagonal), puerto `FechaBloqueadaRepositoryPort` y
  adaptador Prisma con `$queryRaw` + `FOR UPDATE`; mapa fase→(tipo,TTL) declarativo.
- Concurrencia: **zona crítica — TDD primero**. Tests de dos workers simultáneos para
  la misma `(tenant_id, fecha)` → siempre 1 éxito + 1 violación de unicidad.
  (`US-040 §Concurrencia`, `CLAUDE.md §Testing`.)
- Trazabilidad: **US-040**, **UC-30**, dolor **D4**; invocada por A1/A2/A6/A18 y por
  US-004/UC-03, US-014.
- Fuera de alcance: la **liberación** de fecha (`liberarFecha()` / UC-31 / US separada),
  la oferta de **cola** ante rechazo (US-004/UC-03), el **barrido de TTL** vencido
  (job idempotente, US de jobs asíncronos) y las transiciones de estado de `RESERVA`
  (responsabilidad del flujo invocante). (`US-040 §Notas de alcance`, `§Reglas de Validación`.)

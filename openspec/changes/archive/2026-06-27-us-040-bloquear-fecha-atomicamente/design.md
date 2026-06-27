# Design — us-040-bloquear-fecha-atomicamente

## Context

`bloquearFecha()` es la **operación fundacional anti-doble-reserva** (UC-30, dolor D4).
La US-040 es la fuente de verdad. La infraestructura de datos ya existe desde US-000:
`schema.prisma` define `model FechaBloqueada` con `@@unique([tenantId, fecha])`,
`reservaId @unique` (relación 1:1 reserva↔bloqueo), `tipoBloqueo` (enum
`TipoBloqueo = blando | firme`) y `ttlExpiracion DateTime?`, además de RLS por tenant.
Este change añade la **operación de dominio** que explota ese constraint, su mapa
fase→(tipo,TTL), las validaciones y los check constraints de coherencia. Este documento
fija las decisiones técnicas no triviales.

## D-1. Transacción con `$queryRaw` + `SELECT … FOR UPDATE` (regla crítica)

El bloqueo es **exclusivamente de base de datos**: nada de Redis/Redlock/locks
distribuidos (hook `no-distributed-lock` lo bloquea; `AGENTS.md §Regla crítica`).

- La operación corre dentro de una transacción Prisma (`$transaction`) con nivel de
  aislamiento adecuado; el acceso a la fila objetivo se serializa con
  `SELECT … FOR UPDATE` vía `prisma.$queryRaw` (Prisma no expone `FOR UPDATE` en su API
  de alto nivel).
- Patrón por caso:
  - **Crear** (fecha libre): `SELECT … FOR UPDATE` de la fila `(tenant_id, fecha)`
    (puede no existir) + `INSERT`. La garantía última es el `UNIQUE(tenant_id, fecha)`:
    aunque dos transacciones pasen el `SELECT`, el segundo `INSERT` recibe `P2002`.
  - **Extender / promover** (fila existente de la misma reserva): `SELECT … FOR UPDATE`
    + `UPDATE` (TTL en `2.c`; `tipo='firme', ttl=NULL` en `reserva_confirmada`).
- **Por qué el UNIQUE es la última línea, no el `SELECT`**: el `FOR UPDATE` serializa
  filas existentes, pero dos `INSERT` de una fila inexistente compiten; el constraint de
  unicidad del motor es lo que hace el rechazo **determinista** (1 éxito + 1 `P2002`),
  sin ventana de carrera. (`er-diagram.md §5.3`, decisión de modelado 2.)

## D-2. Mapa fase → (tipo, TTL) como estructura declarativa

El mapa NO se dispersa en `if/else` por cada llamador; es una **tabla de datos** en
dominio, consistente con "la máquina de estados como estructura de datos"
(`CLAUDE.md`). Entrada: fase de la reserva (`2.b | 2.c | 2.v | pre_reserva |
reserva_confirmada`) + `TENANT_SETTINGS` + (para `2.v`) `visita_programada_fecha` +
(para `2.c`) `ttl_actual`. Salida: `{ tipo, ttl, modo: 'insert' | 'extend' | 'upgrade' }`.

| Fase | tipo | ttl | modo |
|------|------|-----|------|
| `2.b` | blando | `now() + ttl_consulta_dias` | insert |
| `2.c` | blando | `ttl_actual + ttl_consulta_dias` | extend |
| `2.v` | blando | `visita_programada_fecha + 1 día` | insert |
| `pre_reserva` | blando | `now() + ttl_prereserva_dias` | insert |
| `reserva_confirmada` | firme | `NULL` | upgrade |

Los días (`ttl_consulta_dias=3`, `ttl_prereserva_dias=7` en el piloto) se **leen de
`TENANT_SETTINGS`**; nunca se hardcodean. (`US-040 §Reglas de negocio`.)

## D-3. Check constraints de coherencia tipo↔TTL (impuesto en BD)

La US pide imponer en BD (recomendado) la coherencia. **Decisión**: añadirla como
**check constraints** vía migración Prisma con SQL crudo (no destructiva; la `@@unique`
y RLS ya existen):

```sql
ALTER TABLE fecha_bloqueada
  ADD CONSTRAINT chk_firme_sin_ttl
    CHECK (tipo_bloqueo <> 'firme' OR ttl_expiracion IS NULL),
  ADD CONSTRAINT chk_blando_con_ttl
    CHECK (tipo_bloqueo <> 'blando' OR ttl_expiracion IS NOT NULL);
```

- El predicado `ttl > now()` para blando es **temporal** y no se modela como CHECK
  estable (un CHECK con `now()` se reevalúa de forma problemática); se valida en
  **dominio** antes de escribir. El CHECK garantiza solo la *forma* (nulo/no nulo).
- Defensa en profundidad: dominio valida primero (errores claros en español), BD es la
  última línea (igual que el `UNIQUE`). (`US-040 §Reglas de Validación`.)

## D-4. Errores de dominio explícitos

Errores tipados, en español, con payload de diagnóstico:
- `FECHA_YA_BLOQUEADA` → `{ tenant_id, fecha, reserva_id_existente }` — traducción del
  `P2002` de Prisma; lo recibe el flujo invocante para decidir cola. (FA-01.)
- `FECHA_EN_PASADO` → `{ fecha }` — validación previa a la transacción.
- `TENANT_MISMATCH` → `{ tenant_id_bloqueo, tenant_id_reserva }` — coherencia de tenant.

El upgrade idempotente (mismo `reserva_id`) **no** es error. La traducción a códigos
HTTP/OpenAPI solo aplicaría si en el futuro se expone endpoint (ver D-7).

## D-5. Hexagonal: puerto en dominio, adaptador Prisma en infra

- `bloquearFecha()` vive en `domain/` (servicio de dominio del agregado `Reserva`).
  No importa `@nestjs` ni Prisma (hook `no-infra-in-domain`).
- Puerto `FechaBloqueadaRepositoryPort` (en dominio) con las operaciones
  transaccionales (`bloquearConForUpdate`, `extenderTtl`, `promoverAFirme`), implementado
  por un adaptador Prisma en `infrastructure/` que encapsula el `$queryRaw` +
  `FOR UPDATE` y la traducción de `P2002` → `FECHA_YA_BLOQUEADA`.
- El `tenant_id` llega del **contexto de petición** (JWT/RLS), nunca de input de usuario.

## D-6. Multi-tenancy y RLS

- Todas las operaciones filtran por `tenant_id`; el `UNIQUE` es `(tenant_id, fecha)`,
  de modo que el mismo día puede bloquearse en tenants distintos sin colisión.
- RLS (activo desde US-000) impide cualquier lectura/escritura cross-tenant; el dominio
  además valida `tenant_id` bloqueo == `tenant_id` reserva (D-4 `TENANT_MISMATCH`).

## D-7. Contrato OpenAPI — DECISIÓN: NO se expone endpoint HTTP propio

**Decisión**: `bloquearFecha()` **no** introduce ningún endpoint en `docs/api-spec.yml`;
este change no toca el contrato.

**Justificación**:
1. El **actor de UC-30 es "Sistema"**, no un usuario. El bloqueo no es una acción que
   un cliente HTTP invoque directamente: es un **efecto secundario** de transiciones de
   estado de `RESERVA` (crear consulta con fecha, activar pre-reserva, confirmar señal,
   programar visita). (`US-040 §Historia`, "Como Sistema, Cuando se cumple una solicitud
   originada por una transición de estado".)
2. La US lo declara **infraestructura**: "el bloqueo es infraestructura; los emails los
   disparan los flujos que invocan el bloqueo" (`US-040 §Contexto`). Es una **función de
   dominio compartida**, análoga al motor de tarifa de US-016 (que tampoco expuso
   endpoint propio: lo consume su flujo invocante).
3. Exponer un endpoint `POST /fechas-bloqueadas` directo **rompería invariantes**: el
   bloqueo debe ocurrir en la **misma transacción** que la transición de estado de la
   reserva (atomicidad reserva↔bloqueo, `er-diagram.md §5.3`). Un endpoint aislado
   permitiría bloquear sin transicionar, dejando datos incoherentes.
4. La superficie HTTP correspondiente (crear consulta con fecha, activar pre-reserva,
   etc.) pertenece a **otras US/UC** (US-004/UC-03, US-014/UC-14…), que ya definirán sus
   endpoints e invocarán esta operación por debajo.

**Consecuencia**: la verificación de QA con `curl` (step-N+2) se hace **indirectamente**
a través de un endpoint invocante ya existente que dispare un bloqueo, o, si ninguno
está disponible aún en la rama, se cubre con tests de integración del repositorio
(transacción real contra PostgreSQL) documentados en el report, dejando constancia del
motivo. La decisión es **revisable en el gate humano**: si el equipo prefiere un endpoint
interno/protegido para diagnóstico, se reabriría el contrato en un change posterior.

## D-8. Orden de evaluación de `bloquearFecha()`

1. Validar dominio (D-4): `fecha` no pasada → `FECHA_EN_PASADO`; `tenant_id` coincide →
   `TENANT_MISMATCH`; `tipo` ∈ enum.
2. Resolver `(tipo, ttl, modo)` del mapa declarativo (D-2) según la fase.
3. Abrir transacción; `SELECT … FOR UPDATE` de `(tenant_id, fecha)`.
4. Según `modo`: `insert` (fecha libre) | `extend` (TTL `2.c`) | `upgrade` (a firme).
   - `insert` que choca con bloqueo de otra reserva → `P2002` → `FECHA_YA_BLOQUEADA`.
   - `upgrade`/`extend` con mismo `reserva_id` → idempotente, sin error.
5. `COMMIT` (o `ROLLBACK` ante violación) y propagar el resultado/error al invocante.

## Riesgos / Trade-offs

- **TTL vencido no se purga aquí**: el barrido de bloqueos blandos expirados es un job
  idempotente (estado en fila + cron) de otra US; `bloquearFecha()` no libera fechas. Si
  una fecha tiene un bloqueo blando vencido pero aún presente, este change lo trata como
  ocupado (rechazo). La liberación/promoción la gestionan UC-31 y el job. (`US-040
  §Notas de alcance`.)
- **`reservaId @unique`**: refuerza 1:1 reserva↔bloqueo y hace el upgrade firme natural
  (UPDATE de la fila de esa reserva), pero implica que una reserva no puede bloquear dos
  fechas; es coherente con el modelo (una reserva = un evento = una fecha).

## Pendiente / fuera de alcance

- `liberarFecha()` / UC-31 / barrido de TTL (US separadas).
- Oferta de **cola** ante rechazo (US-004/UC-03): esta operación solo propaga el error.
- Endpoints HTTP de los flujos invocantes (US-004, US-014…) y su contrato OpenAPI.
- Transiciones de estado de `RESERVA` (las ejecuta el flujo invocante, en la misma
  transacción que el bloqueo).

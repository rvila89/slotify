# Design — us-041-liberar-fecha

## Context

`liberarFecha()` es el **complemento atómico** de `bloquearFecha()` (US-040): la mitad que
**devuelve** una fecha al mercado (UC-31, dolores D4/D13). La US-041 es la fuente de verdad.
La infraestructura de datos ya existe: `FECHA_BLOQUEADA` (`@@unique([tenantId, fecha])`,
`reservaId @unique`, `tipoBloqueo blando|firme`, `ttlExpiracion DateTime?`, check
constraints de US-040, RLS por tenant); la cola se modela como campos en `RESERVA`
(`posicion_cola`, `consulta_bloqueante_id` auto-ref, `sub_estado = '2d'`); `AUDIT_LOG` ya
existe (`accion` admite `eliminar`). Este change añade la **operación de dominio** de
liberación en el mismo módulo `reservas/domain`, reutilizando el puerto y el adaptador
Prisma de US-040 (ampliados con `liberar(...)`), sin redefinir nada de US-040.

Reutiliza/extiende, **sin redefinir**:
- `apps/api/src/reservas/domain/bloquear-fecha.service.ts` — tipos de dominio, puerto
  `FechaBloqueadaRepositoryPort`, `ClockPort`, errores tipados en español.
- `apps/api/src/reservas/infrastructure/fecha-bloqueada.prisma.adapter.ts` — patrón
  `$transaction` + `SET LOCAL app.tenant_id` (RLS) + `$queryRaw`.
- `schema.prisma model FechaBloqueada`, `model Reserva` (campos de cola), `model AuditLog`.

Este documento fija las decisiones no triviales. **Dos** de ellas son **decisiones de
alcance que requieren aprobación explícita en el gate humano** (D-2 y D-9).

## D-1. Transacción con DELETE serializado (regla crítica, gemela de US-040 D-1)

La liberación es **exclusivamente de base de datos**: nada de Redis/Redlock/locks
distribuidos (hook `no-distributed-lock`; `AGENTS.md §Regla crítica`).

- La operación corre dentro de una transacción Prisma (`$transaction`) que fija el contexto
  RLS (`SET LOCAL app.tenant_id` vía `set_config`) y ejecuta el
  `DELETE FROM fecha_bloqueada WHERE tenant_id = T AND fecha = D` (vía `$executeRaw`, que
  devuelve el **número de filas afectadas**).
- El **rows-affected del DELETE** es la señal canónica: `1` = esta transacción liberó la
  fecha (procede evaluar/disparar promoción); `0` = otra ya la liberó o nunca existió
  (no-op idempotente, sin promoción). El motor serializa el DELETE sobre la misma fila, de
  modo que de dos liberaciones concurrentes exactamente una obtiene `1`.
- **Por qué rows-affected y no un `SELECT … FOR UPDATE` previo**: el DELETE ya es atómico y
  serializado por el motor; leer-luego-borrar abriría una ventana de carrera innecesaria.
  El conteo de filas borradas es la primitiva exactamente-una-vez (D-4).

## D-2. Promoción de cola como SEAM (`PromocionColaPort`) — DECISIÓN DE ALCANCE (gate)

**Problema**: US-018 (promoción automática de cola: reordenación FIFO + email al lead
promovido) **aún no existe**. US-041 debe **disparar** esa mecánica sin implementarla.

**Decisión propuesta (a aprobar en el gate)**: introducir un **puerto de dominio**
`PromocionColaPort` con una operación `promoverPrimeroEnCola({ tenantId, fecha })`, e
implementarlo con un **adaptador stub no-op temporal** (documentado) que solo deja
constancia (log/audit) de que la promoción **debería** ejecutarse. Cuando se implemente
US-018, su adaptador real sustituye al stub sin tocar `liberarFecha()`.

**Contrato esperado del puerto** (lo respetará US-018):
- **Idempotente**: invocarlo dos veces para la misma `(T, D)` no debe promover dos veces.
- **Detección de cola**: US-041 invoca el puerto solo si detectó cola activa
  (`RESERVA` con `sub_estado = '2d'` y `consulta_bloqueante_id` → reserva liberada); el
  puerto puede revalidar.
- **Atomicidad / consistencia**: misma transacción que el DELETE **o** paso inmediato
  post-commit. La US acepta **consistencia eventual** post-commit siempre que la cola
  permanezca en `2.d` hasta que la promoción complete (no hay estado "fecha libre + cola
  huérfana" observable como definitivo). Recomendación: **post-commit inmediato** para no
  alargar la transacción del DELETE con la lógica (futura) de reordenación + email de
  US-018; el trigger exactamente-una-vez se preserva porque solo el worker con rows=1 llama
  al puerto (D-4).

**Alternativa descartada**: implementar aquí una promoción mínima inline → invadiría el
alcance de US-018, duplicaría lógica de cola y rompería la trazabilidad. Rechazada.

> **Punto de gate #1**: aprobar (a) que la promoción se modele como `PromocionColaPort` con
> stub no-op, y (b) que la invocación sea post-commit inmediato (vs misma transacción).

## D-3. Atomicidad DELETE + promoción y exactamente-una-vez

- La promoción se dispara **solo** cuando el DELETE afectó **1 fila** (D-1). Ante dos
  liberaciones concurrentes, el motor garantiza un único `rows = 1`; el otro worker obtiene
  `rows = 0` y **no** dispara promoción → **exactamente una** promoción, sin doble
  promoción. (`US-041 §Concurrencia`, §Criterio de éxito: 0 dobles promociones.)
- Race liberación vs nuevo bloqueo: la serialización del motor + el `UNIQUE(tenant_id,
  fecha)` de US-040 garantizan que nunca coexistan dos bloqueos para `(T, D)`; la
  liberación completa primero y el nuevo bloqueo hace INSERT o entra en cola.

## D-4. rows-affected como primitiva de idempotencia y trigger

`DELETE` con `0` filas = **éxito silencioso** (sin excepción): soporta los retries del cron.
`1` fila = liberación efectiva → registrar en `AUDIT_LOG` (causa) y, si hay cola, disparar
promoción. Tanto el éxito como la tentativa idempotente (0 filas) y el rechazo de la guarda
firme se auditan. (`US-041 §Edge Cases idempotencia`, §Reglas de Validación.)

## D-5. Guarda del bloqueo firme apoyada en la máquina de estados (estructura de datos)

La regla "un bloqueo `firme` solo se libera si la `RESERVA` está en `reserva_cancelada`" se
valida en **dominio**, **antes** del DELETE, consultando el estado de la reserva. La guarda
se expresa como **dato declarativo** (qué estados terminales habilitan la liberación de un
firme), no como `if` disperso, consistente con "la máquina de estados como estructura de
datos" (`CLAUDE.md`). Si la reserva no está cancelada: rechazo con error de dominio tipado
(en español), la fila firme permanece intacta, y se audita el intento. Para un bloqueo
`blando` la guarda no aplica (liberación libre por TTL/descarte).

## D-6. Hexagonal: puerto en dominio, adaptador Prisma en infra

- `liberarFecha()` vive en `domain/` (servicio de dominio del agregado `Reserva`). No
  importa `@nestjs` ni Prisma (hook `no-infra-in-domain`).
- Se **amplía** el puerto existente `FechaBloqueadaRepositoryPort` con una operación
  `liberar({ tenantId, fecha }): Promise<{ filasAfectadas, reservaIdLiberada, tipoBloqueo }>`
  (o un puerto hermano), implementada por el adaptador Prisma de US-040 (mismo patrón
  `$transaction` + RLS + `$executeRaw`). El servicio necesita además leer el `tipo_bloqueo`
  y el `estado` de la reserva para la guarda firme (D-5): se modela con un puerto de lectura
  (p. ej. `ReservaEstadoPort` / reuso del repositorio) sin acoplar a Prisma en dominio.
- El `PromocionColaPort` (D-2) y un `AuditLogPort` (D-8) completan los puertos.

## D-7. Contrato OpenAPI — DECISIÓN: NO se expone endpoint HTTP propio (gemela de US-040 D-7)

**Decisión**: `liberarFecha()` **no** introduce ningún endpoint en `docs/api-spec.yml`;
este change no toca el contrato.

**Justificación**:
1. El **actor de UC-31 es "Sistema"**, no un usuario. La liberación es un **efecto** de
   transiciones de estado (descarte, cancelación) y del barrido de TTL, no una acción que
   un cliente HTTP invoque directamente. (`US-041 §Historia`.)
2. La US la declara **infraestructura de dominio compartida**, gemela de `bloquearFecha()`:
   la consumen US-012, US-013, US-011, US-019 y la cancelación de reserva, cada una con su
   propia superficie HTTP (otras US/UC).
3. Exponer un `DELETE /fechas-bloqueadas` aislado rompería invariantes: la liberación debe
   ocurrir junto con la transición de estado del flujo invocante (atomicidad reserva↔bloqueo,
   `er-diagram.md §5.3`).

**Consecuencia**: la verificación de QA con `curl` (step-N+2) se hace **indirectamente** a
través de tests de integración del repositorio (transacción/DELETE real contra PostgreSQL),
como en US-040, dejando constancia del motivo en el report. Revisable en el gate: si el
equipo prefiere el endpoint protegido de barrido aquí, se decide en D-9.

## D-8. AUDIT_LOG vía puerto de dominio

Se registra cada liberación exitosa (causa: TTL/descarte/cancelación), cada tentativa
idempotente (0 filas) y cada rechazo de la guarda firme, con `accion = 'eliminar'`,
`entidad = 'FECHA_BLOQUEADA'`. Para mantener el dominio puro, el registro se hace a través
de un `AuditLogPort` (interfaz en dominio) implementado por un adaptador Prisma; el servicio
de dominio decide **qué** auditar, el adaptador decide **cómo** persistirlo.
(`US-041 §Reglas de Validación`; `er-diagram.md §3.17`.)

## D-9. Alcance del cron/endpoint de barrido — DECISIÓN DE ALCANCE (gate)

**Problema**: la ficha menciona un "cron de barrido periódico que ejecuta el endpoint de
expiración protegido" (patrón async-jobs: `ttl_expiracion` + cron + endpoint protegido
idempotente). ¿US-041 incluye ese endpoint + scheduler, o solo la operación de dominio + la
semántica de lote?

**Decisión propuesta (a aprobar en el gate)**: US-041 entrega **(a)** la operación de dominio
reutilizable `liberarFecha()` y **(b)** el **caso de uso de aplicación de liberación en
lote** (orquestación de N fechas expiradas, cada una en transacción independiente con fallo
aislado, D-3). El **wiring del cron + endpoint protegido + scheduler** se **difiere** a la US
de jobs asíncronos / US-012, igual que US-040 difirió el barrido. Justificación: el cron es
**transversal** (toca varias liberaciones y la infraestructura de scheduling/seguridad del
endpoint), y mezclarlo aquí ampliaría el alcance y la superficie HTTP de una operación cuyo
núcleo es de dominio. La **semántica de lote** (aislamiento de fallos parciales) sí se
especifica y testea aquí porque es propia de la liberación.

> **Punto de gate #2**: aprobar que US-041 entregue `liberarFecha()` + el caso de uso de
> **liberación en lote** (orquestación), **difiriendo** el cron/endpoint protegido +
> scheduler a la US de jobs / US-012. Si el equipo prefiere incluir el endpoint protegido
> aquí, se reabre el contrato (D-7) y se amplía el alcance.

## D-10. Multi-tenancy y RLS

- El `tenant_id` llega del **contexto** (JWT/RLS), nunca de input de usuario; el DELETE
  filtra por `(tenant_id, fecha)` y la RLS (activa desde US-000) impide cualquier
  liberación cross-tenant. El `UNIQUE(tenant_id, fecha)` ya garantiza que el mismo día en
  tenants distintos son filas independientes.

## Riesgos / Trade-offs

- **Stub de promoción**: hasta que exista US-018, la promoción es un no-op auditado. Riesgo:
  una fecha con cola se libera pero la cola no avanza realmente. Mitigación: la cola
  permanece en `2.d` (no se pierde); al implementar US-018 el barrido siguiente las promueve;
  se documenta como deuda explícita ligada a US-018.
- **Post-commit vs misma transacción** (D-2): post-commit reduce la duración del lock pero
  introduce consistencia eventual acotada (aceptada por la US). Si el gate prefiere fuerte
  atomicidad, se mueve la invocación dentro de la transacción del DELETE.

## Pendiente / fuera de alcance

- Reordenación de cola + email al lead promovido → **US-018** (el seam solo dispara).
- Wiring del **cron/endpoint protegido** de barrido + scheduler → US de jobs / US-012 (D-9).
- **Transiciones de estado** de `RESERVA` (a `2.z`/`reserva_cancelada`) → flujo invocante
  (US-012/US-013/US-011/cancelación); `liberarFecha()` no muta la reserva.
- Endpoints HTTP de los flujos invocantes y su contrato OpenAPI.

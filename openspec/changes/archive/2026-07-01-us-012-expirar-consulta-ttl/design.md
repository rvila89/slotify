# Design — us-012-expirar-consulta-ttl

## Context

US-012 (UC-09, actor **Sistema**) es el **flujo invocante** que cierra el patrón
"estado en fila + barrido periódico" para la expiración de consultas por TTL agotado
(automatizaciones A4/A5/A21/A21b). La infraestructura de dominio ya existe y **se
reutiliza sin redefinir**:

- `apps/api/src/reservas/domain/liberar-fecha.service.ts` — `liberarFecha()` (US-041):
  DELETE serializado + rows-affected + guarda firme + disparo del seam `PromocionColaPort`
  post-commit. **No muta la RESERVA** (US-041 §3.7); la transición de estado es de US-012.
- `apps/api/src/reservas/application/liberar-fechas-lote.service.ts` — `LiberarFechasEnLoteService`
  (US-041 §D-9): orquesta N liberaciones con **fallo aislado por fecha**, cada una en su
  transacción. US-012 lo envuelve añadiendo la transición de estado por RESERVA.
- `apps/api/src/reservas/infrastructure/promocion-cola.stub.adapter.ts` — stub no-op del
  seam US-018 (la promoción real es US-018).
- `apps/api/src/reservas/domain/maquina-estados.ts` — máquina de estados como estructura
  de datos declarativa; ya define `EstadoReserva`, `SubEstadoConsulta` (incluye `2x`),
  y guardas de origen de US-005/007/008 y la precondición de bloqueo blando de US-006.
- `FECHA_BLOQUEADA` (`@@unique([tenantId, fecha])`, check constraints US-040, RLS por
  tenant), `RESERVA` (`ttl_expiracion`, campos de cola), `AUDIT_LOG` — todo provisionado.
- `CRON_TOKEN` ya declarado en `apps/api/src/config/env.validation.ts` (opcional).

US-041 dejó **explícitamente diferido a US-012** el wiring del cron/endpoint protegido
(`us-041 design.md §D-9`) y las transiciones de estado (§Pendiente/fuera de alcance).
Este documento fija las decisiones no triviales. **Dos** son **decisiones de alcance que
requieren aprobación en el gate humano**: D-2 (endpoint HTTP en el contrato) y D-8
(alcance de la promoción de cola con el stub).

## D-1. Patrón obligatorio "estado en fila + barrido periódico" (regla dura)

- El trabajo pendiente es **estado en la BBDD** (`RESERVA.ttl_expiracion` +
  `estado`/`sub_estado`), nunca un timer en memoria. PROHIBIDO Lambda/EventBridge ni
  timers exactos (skill `async-jobs`; `CLAUDE.md §Jobs asíncronos`).
- Un `@Cron('*/N * * * *')` (`@nestjs/schedule`) invoca el **endpoint interno protegido**
  `POST /cron/barrido-expiracion` con la cabecera `X-Cron-Token`. El scheduler no ejecuta
  lógica de negocio: solo dispara el endpoint (para que el barrido sea invocable también
  manualmente/por otro scheduler externo y testeable como HTTP).
- El barrido es **idempotente** (D-4): re-ejecutarlo no produce transiciones ni
  auditorías duplicadas.
- Frecuencia: acota el retraso máximo desde la expiración teórica hasta la efectiva sin
  comprometer consistencia. Valor concreto configurable (env), por defecto cada pocos
  minutos. No se depende de precisión de timer.

## D-2. Endpoint HTTP protegido en el contrato — DECISIÓN DE ALCANCE (gate)

**Problema**: US-041 decidió NO exponer endpoint HTTP (`us-041 design.md §D-7`, actor
Sistema). US-012 **sí** necesita una superficie invocable por el cron.

**Decisión propuesta (a aprobar en el gate)**: añadir al contrato OpenAPI un **endpoint
interno protegido** `POST /cron/barrido-expiracion`:

- **Auth service-to-service**: cabecera `X-Cron-Token` comparada con `CRON_TOKEN` del
  entorno mediante un **guard dedicado** (`CronTokenGuard`), NO el `JwtAuthGuard`/`RolesGuard`
  de usuario. Sin token válido → **401**. No accesible desde el exterior (documentado; el
  despliegue lo restringe a red interna si aplica).
- **Idempotente**: repetir la llamada no duplica efectos (D-4).
- **Respuesta 200** con resumen: `{ candidatas, expiradas, promocionesDisparadas,
  fallos }`. No expone datos de negocio sensibles.
- Lo fija `contract-engineer` tras el gate; este change **describe** el endpoint pero el
  editado de `docs/api-spec.yml` es post-gate (Step contrato).

**Alternativa descartada**: invocar el caso de uso directamente desde el `@Cron` sin
endpoint HTTP. Rechazada: rompe el patrón de referencia de `async-jobs` (endpoint
protegido idempotente), impide el disparo manual/externo y dificulta el test con `curl`.

> **Punto de gate #1**: aprobar (a) que se exponga `POST /cron/barrido-expiracion` en el
> contrato y (b) que se autentique con `X-Cron-Token` vía `CronTokenGuard` (no JWT).

## D-3. Transición de estado por TTL como estructura de datos declarativa

La transición terminal se modela como **tabla de datos** en `maquina-estados.ts` (skill
`state-machine`, NO `if` dispersos), añadiendo una guarda/mapa nuevo sin reescribir los
existentes:

```
MAPA_EXPIRACION_TTL (origen candidato → destino terminal):
  { consulta, 2b }      → { consulta, 2x }
  { consulta, 2c }      → { consulta, 2x }
  { consulta, 2v }      → { consulta, 2x }
  { pre_reserva, null } → { reserva_cancelada, null }
```

- Una función pura `resolverExpiracionTtl(estado, subEstado)` consulta el mapa y devuelve
  el destino, o `null` si no es candidato (guarda de origen). Los terminales (`2x/2y/2z/
  reserva_cancelada/reserva_completada`) y cualquier otro estado devuelven `null` →
  **no se expira** aunque el TTL esté vencido.
- La guarda se evalúa **dentro** de la transacción de cada RESERVA (bajo `SELECT … FOR
  UPDATE`), de modo que un reintento/segunda ejecución re-evalúe con el estado actualizado
  (base de la idempotencia y de RC-1).
- **El estado terminal correcto para expiración por TTL es `2x`** (para `2b/2c/2v`) y
  `reserva_cancelada` (para `pre_reserva`), verificado contra la ficha US-012 §Reglas de
  negocio y `use-cases.md` UC-09. `2y` (descarte por cola, A16/US-007) y `2z` (descarte
  por cliente, US-013) NO son destinos de expiración por TTL: no confundir.

## D-4. Idempotencia y exactamente-una-vez

- **Selección de candidatas** = `ttl_expiracion < now()` AND (`sub_estado ∈ {2b,2c,2v}`
  OR `estado = 'pre_reserva'`). Los terminales quedan fuera por construcción → 2.ª
  ejecución no los reexpira.
- **Re-evaluación bajo lock** (D-3): tras el `SELECT … FOR UPDATE`, si la RESERVA ya no es
  candidata (otra TX la expiró, o la extensión de US-006 movió el TTL), la transacción no
  muta nada. Esto da la idempotencia de RC-1 y RC-2 sin locks distribuidos.
- **Liberación**: `liberarFecha()` (US-041) ya es idempotente (DELETE 0 filas = éxito
  silencioso) → cubre el edge case "FECHA_BLOQUEADA ya eliminada" (expiración parcial).
- **Promoción**: `liberarFecha()` dispara el seam **exactamente una vez** solo si el
  DELETE afectó 1 fila y hay cola activa; US-012 no re-dispara.

## D-5. Concurrencia crítica (RC-1/RC-2/RC-3) — TDD primero

La zona crítica se apoya **exclusivamente** en PostgreSQL (hook `no-distributed-lock`):

- **RC-1 (doble cron)**: `SELECT … FOR UPDATE` sobre la fila bloqueante + re-evaluación de
  la guarda de origen dentro de la TX → exactamente una transición.
- **RC-2 (expiración vs extensión US-006)**: ambas compiten por la misma fila bloqueante
  con `SELECT … FOR UPDATE`; la que commitea primero gana; la otra re-evalúa y se
  autoexcluye (extensión rechazada por estado terminal, o expiración fuera de candidatas
  por TTL ya extendido). Sin estado intermedio.
- **RC-3 (liberación vs nuevo bloqueo)**: garantía de US-040/US-041 —
  `UNIQUE(tenant_id, fecha)` + serialización del motor; nunca dos bloqueos activos.
- Tests de concurrencia **reales** (Postgres, workers simultáneos), no mocks
  (skill `concurrency-locking`). El test de US-004 flaky (`40P01`) es ajeno; solo se
  vigila al leer la suite global.

## D-6. Multi-tenancy / RLS en un proceso de Sistema

- El barrido es **cross-tenant** (una sola pasada evalúa candidatas de todos los tenants),
  pero **cada** liberación/transición se ejecuta bajo el **contexto RLS del tenant** de la
  RESERVA (`SET LOCAL app.tenant_id` vía `set_config`, como el adaptador de US-041). El
  `tenant_id` proviene de la fila candidata, nunca de input externo.
- La lectura inicial de candidatas cross-tenant se hace con el rol técnico del proceso de
  Sistema (mismo patrón que el adaptador de barrido de US-041); las escrituras siempre
  reponen el `tenant_id` correcto. Documentar en `architecture.md §2.5` que este es el
  único punto legítimo cross-tenant y que las mutaciones siguen respetando RLS por tenant.

## D-7. Off-by-one de TZ conocido — comparar instantes, no fechas formateadas

Deuda técnica en memoria: `formatearFechaHora` muestra `+1 día` en `ttlExpiracion` por
TZ. **No se arregla aquí** (change aparte). Mitigación en US-012: la selección de
candidatas y toda la lógica de vencimiento comparan **instantes `timestamptz`**
(`ttl_expiracion < now()` en SQL/dominio), **nunca** una fecha formateada como string.
Así el off-by-one de presentación no afecta a qué se expira. Se añade un test que fija
esta invariante.

## D-8. Promoción de cola — reutilizar el seam US-018, NO reimplementar A15 (gate)

**Problema**: la ficha US-012 describe (Happy Path 2.b con cola) la promoción inline: la
primera en cola pasa a `2b`, se recrea `FECHA_BLOQUEADA` para la promovida, el resto
decrementa `posicion_cola` (mecánica A15). Pero US-041 ya modeló la promoción como
**seam `PromocionColaPort`** cuyo destinatario real es **US-018** (aún no implementada);
el stub es no-op.

**Decisión propuesta (a aprobar en el gate)**: US-012 **dispara** el seam exactamente una
vez (reutilizando el mecanismo de `liberarFecha()`) pero **NO reimplementa A15** (FIFO +
re-bloqueo + decremento). Justificación: (a) evita duplicar la lógica de cola que es de
US-018; (b) preserva la trazabilidad (US-018 es la dueña); (c) US-041 ya fijó este
contrato y consistencia eventual aceptable (la cola permanece en `2.d` hasta que US-018
promueva). Hasta US-018, la fecha se libera y la cola queda intacta en `2.d` → **deuda
técnica explícita ligada a US-018**, documentada.

**Alternativa descartada**: implementar A15 mínima inline en US-012 → invadiría US-018 y
contradiría la decisión de US-041 §D-2. Rechazada.

> **Punto de gate #2**: aprobar que US-012 solo **dispare** la promoción (seam US-018) y
> **NO** implemente la reordenación/re-bloqueo A15, asumiendo la deuda hasta US-018. Si el
> equipo prefiere adelantar A15 aquí, se amplía el alcance y se reabre la relación con
> US-018.

## D-9. Hexagonal: dominio puro + caso de uso de aplicación + adaptadores

- **Dominio**: `resolverExpiracionTtl()` (guarda/mapa declarativo, D-3) en
  `reservas/domain/maquina-estados.ts`; reuso de `LiberarFechaService`. Nada de `@nestjs`
  ni Prisma (hook `no-infra-in-domain`).
- **Aplicación**: un caso de uso `ExpirarConsultasVencidasService` (o `BarridoExpiracionUseCase`)
  que (1) lista candidatas (puerto de lectura), (2) por cada una abre transacción con
  `SELECT … FOR UPDATE`, re-evalúa la guarda, aplica la transición de estado, invoca
  `liberarFecha()` (que ya libera + audita + dispara el seam), y (3) agrega el resumen con
  fallo aislado por RESERVA. Reutiliza la semántica de `LiberarFechasEnLoteService`.
- **Infraestructura**: adaptador Prisma para listar candidatas y para la UoW de transición
  (mismo patrón `$transaction` + `SET LOCAL app.tenant_id` + `$queryRaw`/`$executeRaw` que
  US-041); `CronTokenGuard` + controller del endpoint; provider del `@Cron`. Registrar en
  `reservas.module.ts` (o un módulo `cron` dedicado).
- **AUDIT_LOG**: la transición se audita con `accion = 'transicion'`, `entidad = 'RESERVA'`
  (via `AuditLogPort`); la liberación con `entidad = 'FECHA_BLOQUEADA'`, causa `TTL` (ya lo
  hace `liberarFecha()`). No duplicar la auditoría de la liberación.

## D-10. Alerta interna al gestor (no email al cliente)

La expiración deja constancia para una **alerta interna** ("Consulta [código] expirada.
Fecha [fecha] liberada.") consumible por el dashboard/notificaciones (US-044). En MVP no
hay email al cliente de expiración (sin código E en §9.3). El mecanismo concreto de la
alerta (tabla de notificaciones vs señal en AUDIT_LOG) se mantiene mínimo: US-012 registra
el evento; la superficie de notificaciones es de US-044. No bloquea la expiración.

## Riesgos / Trade-offs

- **Stub de promoción (deuda US-018)**: una fecha con cola se libera pero la cola no
  avanza hasta US-018. Mitigación: la cola permanece en `2.d` (no se pierde); el barrido
  posterior, ya con US-018, la promoverá. Deuda explícita ligada a US-018.
- **Cross-tenant read + RLS write** (D-6): el único punto cross-tenant del sistema; se
  documenta y se testea que las escrituras nunca cruzan tenant.
- **Barrido secuencial** (fallo aislado, US-041) vs paralelo: se mantiene secuencial por
  simplicidad y aislamiento; el volumen de candidatas por barrido es acotado.

## Pendiente / fuera de alcance

- **Reordenación de cola + re-bloqueo de la promovida (A15)** → **US-018** (el seam solo
  dispara).
- **Emails al cliente** de expiración (sin código E en MVP); A3 recordatorio día +2 (solo
  diseñado).
- **UI del dashboard de notificaciones** → US-044 (US-012 solo registra el evento).
- **Arreglo del off-by-one de TZ** en `formatearFechaHora` → change aparte (D-7).

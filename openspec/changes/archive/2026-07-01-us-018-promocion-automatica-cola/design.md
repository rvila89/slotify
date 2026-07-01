# Design — us-018-promocion-automatica-cola

## Context

US-018 (UC-12, actor **Sistema**) es el **destinatario real del seam de promoción de
cola** que US-041 modeló y US-012 dejó cableado como stub no-op. **Completa** la mecánica
A15 (promoción FIFO + re-bloqueo + reordenación) sin reinventar el seam ni el disparo. La
infraestructura de dominio ya existe y **se reutiliza sin redefinir**:

- `apps/api/src/reservas/domain/liberar-fecha.service.ts` — define el puerto
  `PromocionColaPort.promoverPrimeroEnCola({ tenantId, fecha })` (~L113-115) y **dispara el
  seam post-commit exactamente una vez** (~L269-277) cuando el DELETE de `FECHA_BLOQUEADA`
  afecta 1 fila y `hayColaActiva` es cierto. **US-018 hereda este contrato tal cual: NO
  re-dispara, NO reimplementa la detección de cola, NO toca `liberarFecha()`.**
- `apps/api/src/reservas/infrastructure/promocion-cola.stub.adapter.ts` — **stub no-op a
  SUSTITUIR** por el adaptador real. Su cabecera ya anuncia que US-018 lo reemplaza.
- `apps/api/src/reservas/domain/bloquear-fecha.service.ts` — `bloquearFecha()` (US-040): la
  **primitiva atómica** que la promoción reutiliza para re-crear la fila de
  `FECHA_BLOQUEADA` de la promovida (`UNIQUE(tenant_id, fecha)` + `SELECT … FOR UPDATE`).
- `apps/api/src/reservas/domain/maquina-estados.ts` — máquina de estados declarativa; ya
  define `EstadoReserva`, `SubEstadoConsulta` (incluye `2d`, `2b`) y varias tablas de
  transición. US-018 **añade** una tabla `{consulta,2d} → {consulta,2b}` sin reescribir
  las existentes.
- `reservas.tokens.ts` (`PROMOCION_COLA_PORT`, ~L16) y `reservas.module.ts`
  (`{ provide: PROMOCION_COLA_PORT, useClass: PromocionColaStubAdapter }`, ~L298) — solo
  cambia el **binding** al adaptador real.
- `RESERVA` (`posicion_cola`, `consulta_bloqueante_id` auto-ref, `sub_estado`,
  `ttl_expiracion`), `FECHA_BLOQUEADA`, `AUDIT_LOG` y el índice UNIQUE parcial de cola
  (`reserva_cola_posicion_key`, US-004) — todo provisionado. Sin migración nueva.

Este documento fija las decisiones no triviales. Los dos puntos de gate quedan
**DECIDIDOS por el usuario en el gate SDD (01/07/2026)**: **D-5** = alerta interna al
gestor, SIN email al cliente en MVP (mismo patrón que US-012 §D-10; superficie diferida a
US-044); **D-6** = FIFO estricto + gana el primer lock (sin cesión a la acción manual
US-019). Ambas secciones reflejan la decisión firme.

## D-1. Sustituir el stub, NO re-inventar el seam (regla dura de alcance)

El seam `PromocionColaPort` y su disparo post-commit exactamente-una-vez son **contrato
heredado y CONGELADO** de US-012/US-041. US-018:

- **Sustituye** `PromocionColaStubAdapter` por `PromocionColaPrismaAdapter` (adaptador real).
- **NO** modifica `liberar-fecha.service.ts` (dominio de liberación), ni la detección de
  cola (`hayColaActiva`), ni el punto/momento de disparo.
- El adaptador real recibe `{ tenantId, fecha }` (la firma del puerto no cambia) y desde
  ahí resuelve el resto (localizar la bloqueante liberada por fecha, la cola, etc.).

Justificación: preserva la trazabilidad (US-041 dueño del trigger, US-018 dueño del efecto),
respeta el hook `no-infra-in-domain` y evita re-disparo/doble promoción.

## D-2. Hexagonal: dominio puro + caso de uso de aplicación + adaptador Prisma

- **Dominio (puro, sin `@nestjs`/Prisma — hook `no-infra-in-domain`)**:
  - Nueva tabla declarativa `MAPA_PROMOCION_COLA` + función pura
    `resolverPromocionCola(estado, subEstado)` en `maquina-estados.ts`: guarda de origen
    ESTRICTA `{consulta,2d} → {consulta,2b}` (solo `2.d` es promovible; cualquier otro
    origen → `null`). Mismo patrón que `resolverExpiracionTtl` (US-012, D-3).
  - Una operación de dominio pura que, dados los datos de la cola leídos por el puerto
    (candidato `posicion_cola = 1` + restantes), calcula el **plan de promoción**
    (mutaciones de la promovida + decrementos + nuevo `consulta_bloqueante_id`) y valida
    la **contigüidad** de posiciones (aborta si hay hueco, D-8 de la spec). Sin efectos.
- **Aplicación**: caso de uso `PromoverPrimeroEnColaService` que orquesta la transacción:
  (1) `SELECT … FOR UPDATE` sobre las **RESERVA en `sub_estado = '2d'`** de `(tenant,
  fecha)` — la fila de `FECHA_BLOQUEADA` ya no existe tras el `liberarFecha()` post-commit
  que disparó el seam, por lo que el cerrojo recae sobre las RESERVA en cola (ver D-3);
  (2) guarda "ya promovida" (D-3); (3) leer cola bajo lock; (4) aplicar el plan de dominio:
  mutar promovida (`posicion_cola`/`consulta_bloqueante_id → NULL`), re-bloquear vía
  `bloquearFecha()`, reordenar restantes (decremento FIFO); (5) auditar por cada RESERVA
  modificada con `origen: promocion_automatica`; todo en UNA transacción. Reutiliza el
  patrón UoW de US-041.
- **Infraestructura**: `PromocionColaPrismaAdapter implements PromocionColaPort` (invoca el
  caso de uso bajo `SET LOCAL app.tenant_id`), + puertos de lectura de cola/escritura de
  RESERVA de cola con `$queryRaw`/`$executeRaw`. Re-binding en `reservas.module.ts`.

## D-3. Guarda "ya promovida" — idempotencia y coordinación (dentro de la TX, bajo lock)

La idempotencia (FA-04), la RC-1 (doble job) y la RC-3 (coordinación US-019) se resuelven
con **una sola guarda** evaluada **dentro de la transacción tras el `SELECT … FOR UPDATE`**:

- **El punto de serialización es un `SELECT … FOR UPDATE` sobre las RESERVA en `sub_estado
  = '2d'` de `(tenant, fecha)`**, no sobre `FECHA_BLOQUEADA`. Esta distinción es crítica:
  cuando el seam `PromocionColaPort` se dispara, la fila de `FECHA_BLOQUEADA` ya fue
  eliminada por el `liberarFecha()` previo (DELETE commiteó antes del disparo post-commit);
  un `FOR UPDATE` sobre 0 filas no serializa nada y dejaría la guarda vacía. En cambio, las
  RESERVA en `2d` para esa `(tenant, fecha)` sí existen y son el recurso a serializar.
- Re-verificar el invariante bajo lock: ¿existe un candidato `sub_estado = '2d'`,
  `posicion_cola = 1` para esta `(tenant, fecha)` pendiente de promover?
- Si el invariante NO se cumple (otra TX ya promovió: ya no hay `posicion_cola = 1` en
  `2d`, porque la ganadora lo muló a `NULL` al promover), **abortar sin cambios** (no-op
  silencioso, sin error).
- Esta guarda es **la misma** para: segunda instancia del cron (RC-1), promoción manual
  US-019 que ganó la carrera (RC-3), y re-ejecución idempotente (FA-04). Reside en
  PostgreSQL (serialización por lock sobre RESERVA `2d` + re-lectura), NUNCA en locks
  distribuidos (hook `no-distributed-lock`).

## D-4. Atomicidad y no-doble-reserva — solo PostgreSQL

- Toda la promoción (mutación promovida + `bloquearFecha()` + reordenación + auditoría) va
  en **una transacción**, serializada por `SELECT … FOR UPDATE` sobre las RESERVA en `2d`
  de `(tenant, fecha)` (ver D-3; la fila de `FECHA_BLOQUEADA` ya no existe en este punto).
- El re-bloqueo usa `bloquearFecha()` (US-040): `UNIQUE(tenant_id, fecha)` impide dos
  bloqueos activos; como la liberación (DELETE) ya commiteó antes del disparo del seam
  (post-commit), no hay conflicto de UNIQUE con la fila vieja.
- La reordenación respeta `UNIQUE(tenant_id, consulta_bloqueante_id, posicion_cola) WHERE
  posicion_cola IS NOT NULL` (US-004). Orden de UPDATE de posiciones cuidado para no violar
  el índice a mitad (decremento en orden ascendente o UPDATE en bloque con expresión).
- El `ttl_expiracion` nuevo es **instante `timestamptz`** `now() + ttl_consulta_dias`,
  nunca fecha formateada (mitiga el off-by-one de TZ, deuda ajena — misma decisión que
  US-012 §D-7).

## D-5. Notificación de promoción — alerta interna al gestor, SIN email al cliente (DECIDIDO)

**Decisión (usuario, gate SDD 01/07/2026)**: al promover se registra una **alerta interna
dirigida al GESTOR** para que él proceda a comunicarse con la reserva promovida. **NO** se
envía email automático al cliente en MVP. Aplica **exactamente el mismo patrón que US-012
§D-10** (alerta interna mínima; la superficie de notificaciones/dashboard es de **US-044**).
El requisito de negocio "se debe notificar" se cumple **vía el gestor**, no vía email al
cliente.

**Justificación**: la ficha US-018 marca el email "¡La fecha está disponible!" (UC-12 paso 8)
como `📐 Solo diseñado`, **fuera del MVP** (`§Email relacionado`, `§Notas de alcance`). El
adaptador de promoción **NO** toca el puerto de comunicaciones/email (US-045).

**Cómo**:
- La promoción **deja constancia mínima** del evento para el gestor ("Consulta [código]
  promovida a bloqueo de la fecha [fecha]; contactar al cliente."), consumible por la
  superficie de notificaciones de US-044. El mecanismo concreto (señal en `AUDIT_LOG` con la
  transición ya registrada, o registro de notificación mínimo) se mantiene mínimo y NO
  bloquea la promoción.
- **Idempotencia del registro**: el registro de la alerta va **dentro de la misma
  transacción** de la promoción y por tanto ligado a la **guarda "ya promovida" (D-3)**: si
  la transacción aborta por la guarda (re-ejecución/carrera), no se registra alerta
  duplicada. N ejecuciones → 1 sola alerta, como la auditoría de la transición.
- **Sin acoplamiento a US-045**: no hay envío de email, por lo que no hay riesgo de doble
  envío por reintento.

## D-6. Arbitraje con la promoción manual US-019 — FIFO estricto + gana el primer lock (DECIDIDO)

**Decisión (usuario, gate SDD 01/07/2026)**: rige **FIFO estricto** ("siempre
`posicion_cola = 1`") + **"gana quien toma el lock primero"**. **NO** hay cesión de prioridad
a la acción manual. **No se amplía el alcance** de US-018 para la promoción manual.

**Cómo se resuelve**: US-018 y la futura US-019 comparten la **guarda "ya promovida" (D-3)**,
evaluada bajo `SELECT … FOR UPDATE` sobre las **RESERVA en `2d`** de `(tenant, fecha)`,
dentro de la transacción. La primera ruta que adquiere el lock completa la promoción; la
segunda, al obtener el lock, detecta que ya no hay candidato `posicion_cola = 1` en `2d` y
**aborta limpio** (no-op, sin inconsistencia). Esta única guarda cubre RC-1 (doble job),
RC-3 (coordinación con US-019) y la idempotencia (FA-04). Reside en PostgreSQL sobre RESERVA
`2d`, NUNCA en locks distribuidos.

**Fuera de alcance (US-019)**: la **superficie de la acción manual**, su UI y el **mensaje de
error** al Gestor ("La cola ya fue actualizada automáticamente") son de **US-019**. US-018
solo deja el **contrato de guarda** listo. Cualquier política de selección de candidato
distinta al FIFO (elegir uno que no sea `posicion_cola = 1`) queda para el diseño de US-019 y
excede este change.

## D-7. Multi-tenancy / RLS

La promoción se ejecuta bajo el **contexto RLS del tenant** de la fecha liberada
(`SET LOCAL app.tenant_id` vía `set_config`, mismo patrón que el adaptador de US-041). El
`tenant_id` llega en el comando del seam (`{ tenantId, fecha }`), nunca de input externo.
Todas las lecturas/escrituras de cola y `FECHA_BLOQUEADA` respetan RLS por tenant.

## D-8. Consistencia eventual — cierre de la deuda US-012/US-041

Hasta US-018, tras liberar una fecha con cola la cola quedaba **intacta en `2.d`** (deuda
documentada en `us-041 §D-2 Riesgos`, `us-012 §D-8`, `er-diagram.md §5.3`). US-018 la
**cierra**: el seam, ya con el adaptador real, promueve **inmediatamente** en el post-commit
de `liberarFecha()`. Se documenta en `architecture.md`/`er-diagram.md` que la promoción es
síncrona al disparo del seam (no hay ventana de "fecha libre + cola huérfana" salvo fallo
transitorio, que el siguiente barrido recupera al re-disparar). Actualizar los párrafos de
`er-diagram.md §5.3` que hoy dicen "stub no-op / diferido a US-018".

## Riesgos / Trade-offs

- **Reordenación bajo índice UNIQUE parcial de cola**: decrementar `posicion_cola` puede
  chocar transitoriamente con `reserva_cola_posicion_key` si se hace fila a fila en mal
  orden. Mitigación: UPDATE en bloque o en orden ascendente de posición; test dirigido.
- **Fallo del re-bloqueo tras mutar la promovida**: cubierto por la atomicidad (todo en una
  TX; rollback completo). Sin re-bloqueo, R2 no debe quedar en `2b` sin fila de
  `FECHA_BLOQUEADA`.
- **Notificación (D-5)**: al ser alerta interna al gestor sin email al cliente, no hay riesgo
  de doble envío; el registro es idempotente por ir ligado a la guarda "ya promovida" (D-3).
- **US-004 flaky (`40P01`)**: ajeno; solo se vigila al leer la suite global de concurrencia.

## Pendiente / fuera de alcance

- **Email al cliente** de promoción (UC-12 paso 8, `📐 Solo diseñado`) → fuera de MVP (D-5,
  decidido): en su lugar, alerta interna al gestor (patrón US-012 §D-10); superficie de
  notificaciones diferida a US-044.
- **Promoción manual por el Gestor** (US-019): US-018 solo deja la **guarda de coordinación**
  (D-3/D-6, FIFO + primer lock); la acción manual, su UI y su mensaje de error son de US-019.
- **Arreglo del off-by-one de TZ** en `formatearFechaHora` → change aparte (D-4 mitiga
  comparando instantes).
- **UI del dashboard/notificaciones** → US-044.

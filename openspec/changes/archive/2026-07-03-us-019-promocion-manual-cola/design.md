# Design — us-019-promocion-manual-cola

## Context

US-019 (UC-12 flujo alternativo manual, actor **Gestor**) añade la **promoción manual**
de una consulta arbitraria de la cola, complementaria a la promoción **automática** FIFO
de US-018 (actor Sistema). El punto de diseño más delicado es la **coordinación
anti-doble-promoción** entre ambas rutas: US-018 la dejó **explícitamente preparada** (su
requisito RC-3 y sus decisiones §D-3/§D-6 definen la guarda "ya promovida" pensando en
US-019). Este documento fija cómo US-019 **consume** ese contrato sin reinventarlo, y las
decisiones no triviales propias de la promoción manual (expiración forzosa + selección
arbitraria + reordenación por cierre de hueco).

Infraestructura existente que se **reutiliza sin redefinir**:

- `apps/api/src/reservas/domain/maquina-estados.ts` — máquina de estados declarativa; ya
  define `EstadoReserva`, `SubEstadoConsulta` (incluye `2d`, `2b`, `2x`) y la transición
  `{consulta,2d} → {consulta,2b}` (`MAPA_PROMOCION_COLA` / `resolverPromocionCola`, US-018).
  US-019 la **reutiliza** para la promoción y **reutiliza** la transición de expiración a
  `2.x` de US-012.
- `apps/api/src/reservas/domain/promocion-cola.ts` — operación de dominio pura de US-018
  (`planificarPromocionCola` + validación de contigüidad). US-019 la **extiende/parametriza**
  para el caso "promover posición P arbitraria" (ver D-2), no la duplica.
- `apps/api/src/reservas/domain/bloquear-fecha.service.ts` — `bloquearFecha()` (US-040):
  primitiva atómica que re-crea la fila de `FECHA_BLOQUEADA` de la promovida
  (`UNIQUE(tenant_id, fecha)` + `SELECT … FOR UPDATE`).
- Semántica de expiración de US-012 (`2.x` terminal, `ttl_expiracion → NULL`): US-019 la
  aplica **deliberadamente por el Gestor** sobre la bloqueante actual (no por barrido TTL).
- `RESERVA`, `FECHA_BLOQUEADA`, `AUDIT_LOG` y el índice UNIQUE parcial de cola
  (`reserva_cola_posicion_key`, US-004) — todo provisionado. Sin migración nueva.

## D-1. Superficie HTTP — decisión diferida al step de contrato (fuera del SDD)

US-019 **sí tiene superficie HTTP de usuario** (a diferencia de US-018). Hay dos opciones y
la elección es del `contract-engineer` en el step de contrato, NO del SDD:

- **(a)** Madurar el placeholder `POST /reservas/{id}/promover` (hoy tag `Cola`, descrito
  como el encadenamiento automático UC-12), redefiniendo su semántica: `{id}` = la RESERVA
  en `2.d` que el Gestor promueve; body/flag de confirmación explícita.
- **(b)** Añadir un path dedicado (p. ej. `POST /reservas/{id}/promover-manual`) dejando el
  placeholder existente para el efecto automático.

**Recomendación de diseño (no vinculante)**: el `{id}` de la ruta debe ser la **RESERVA en
`2.d` a promover** (el objeto de la acción), no la bloqueante; el backend resuelve la fecha y
la bloqueante a partir de ella. La confirmación destructiva del Gestor es responsabilidad de
la **UI** (diálogo), y el endpoint actúa solo ante una petición explícita; opcionalmente el
contrato puede exigir un flag `confirmado: true` como defensa en servidor. Códigos: **409**
para "la cola ya fue actualizada automáticamente" (carrera perdida), **4xx** para "la consulta
seleccionada ya no está en cola" (FA-05) y "no existe FECHA_BLOQUEADA para la fecha"
(inconsistencia). La resolución definitiva se cierra en el step de contrato.

## D-2. Hexagonal: dominio puro + caso de uso de aplicación + adaptador Prisma

- **Dominio (puro, sin `@nestjs`/Prisma — hook `no-infra-in-domain`)**:
  - **Guarda de origen de la promovida**: reutiliza `resolverPromocionCola` (US-018):
    solo `{consulta,2d}` es promovible; cualquier otro origen → `null` → rechazo FA-05.
  - **Guarda de la bloqueante a expirar**: la transición forzosa de la bloqueante actual a
    `2.x` se modela declarativamente (reutiliza la tabla de expiración de US-012); admite
    orígenes `2.b`, `2.c`, `2.v` (con TTL vigente **o** ya vencido pero no barrido). Si la
    fecha **no** tiene bloqueante viva (ya expirada/liberada), no hay nada que expirar y se
    procede solo con la promoción (coordinado con la guarda, D-4).
  - **Plan de reordenación por "cierre de hueco"** (extensión del plan de US-018): dado el
    conjunto de la cola en `2.d` y la `posicion_cola = P` de la promovida, calcular las
    mutaciones: la promovida sale (`posicion_cola → NULL`); cada RESERVA con `posicion_cola
    > P` decrementa 1; las de `posicion_cola < P` **no cambian de posición** pero **sí**
    re-apuntan su `consulta_bloqueante_id` a la nueva bloqueante. Resultado: posiciones
    contiguas empezando en 1, sin huecos. Se valida contigüidad (aborta si hay anomalía,
    igual que US-018). Nota: cuando `P = 1` (FA-01) el plan coincide exactamente con el
    decremento uniforme de US-018; el "cierre de hueco" lo generaliza a `P` arbitrario.
- **Aplicación**: caso de uso `PromoverManualEnColaService` que orquesta **una** transacción:
  (1) `SELECT … FOR UPDATE` sobre la fila de `FECHA_BLOQUEADA` de `(tenant, fecha)` (ver D-4;
  a diferencia de US-018, aquí la fila **sí existe** porque la bloqueante aún no se ha
  liberado); (2) validar que la RESERVA elegida está en `2.d` y pertenece a la cola de esa
  fecha (FA-05); (3) validar que existe `FECHA_BLOQUEADA` activa (inconsistencia si no);
  (4) guarda "ya promovida" (D-4); (5) aplicar el plan de dominio: expirar la bloqueante a
  `2.x`, mutar la promovida (`sub_estado → 2b`, `posicion_cola`/`consulta_bloqueante_id →
  NULL`, TTL), re-bloquear vía `bloquearFecha()`, reordenar restantes (cierre de hueco);
  (6) auditar por cada RESERVA modificada con `origen: 'promocion_manual'` y el `usuario_id`
  del Gestor; todo all-or-nothing. Reutiliza el patrón UoW de US-041/US-018.
- **Infraestructura**: adaptador Prisma que ejecuta el caso de uso bajo `SET LOCAL
  app.tenant_id` + puertos de lectura/escritura de cola con `$queryRaw`/`$executeRaw`;
  controller NestJS que expone el endpoint (D-1), extrae `tenantId`/`usuarioId` del JWT y
  mapea los errores de dominio a códigos HTTP.

## D-3. Expiración forzosa de la bloqueante — orden dentro de la transacción

La promoción manual es **destructiva**: expira la bloqueante viva antes de promover. El
orden dentro de la única transacción es crítico para no violar `UNIQUE(tenant_id, fecha)`:

1. Bajo el lock (D-4), leer la bloqueante actual y la cola.
2. **Expirar la bloqueante**: `sub_estado → '2.x'`, `ttl_expiracion → NULL`. (La bloqueante
   deja de "poseer" la fecha a nivel lógico.)
3. **Liberar/actualizar la fila de `FECHA_BLOQUEADA`**: como el re-bloqueo de la promovida
   reutiliza `bloquearFecha()` y `UNIQUE(tenant_id, fecha)` impide dos filas activas, la fila
   existente debe **reasignarse** a la promovida (UPDATE de `reserva_id` + `ttl_expiracion`
   sobre la misma fila) **o** eliminarse y recrearse dentro de la misma TX. Se prefiere
   **reasignar la fila existente** (UPDATE `reserva_id`/`ttl_expiracion`/`tipo_bloqueo`) para
   no chocar con el UNIQUE ni con el índice, manteniendo la fecha **siempre bloqueada** (no
   hay instante observable con la fecha libre). El detalle de reutilizar `bloquearFecha()` vs
   un UPDATE dirigido se cierra en implementación respetando la primitiva atómica; la regla
   dura es: **una sola fila activa de `FECHA_BLOQUEADA` por `(tenant, fecha)` en todo
   momento**.
4. Promover la RESERVA elegida a `2.b` (transición declarativa) y reordenar la cola.
5. Auditar.

Todo dentro de la misma TX → si algo falla, rollback completo: la bloqueante sigue viva, la
fecha sigue bloqueada por ella, la cola intacta. No hay estado intermedio observable.

## D-4. Coordinación anti-doble-promoción con US-018 — guarda "ya promovida" (PUNTO CRÍTICO)

Este es el núcleo de la coordinación pedida. US-018 (§D-3/§D-6, requisito RC-3) **decidió y
dejó preparada** la política: **FIFO estricto + "gana quien toma el lock primero"**, sin
cesión de prioridad a la acción manual. US-019 **respeta esa decisión** — no la renegocia.

- **Punto de serialización**: `SELECT … FOR UPDATE` sobre la fila de `FECHA_BLOQUEADA` de
  `(tenant, fecha)` dentro de la transacción. **Matiz importante frente a US-018**: en la
  promoción automática (US-018 §D-3) la fila de `FECHA_BLOQUEADA` **ya no existe** cuando el
  seam se dispara (la liberación commiteó antes), por lo que US-018 serializa sobre las
  **RESERVA en `2d`**. En la promoción **manual**, la bloqueante **aún no se ha expirado**
  cuando el Gestor actúa, así que **la fila de `FECHA_BLOQUEADA` SÍ existe** y es el recurso
  natural a bloquear con `FOR UPDATE`. Ambas rutas convergen en el mismo recurso lógico (la
  fecha), y la relación entre ambos loci de lock se resuelve así:
  - **Caso normal (bloqueante viva)**: el Gestor toma el lock sobre `FECHA_BLOQUEADA`; el
    barrido automático de US-018, para esa misma fecha, primero debe **liberar** (expirar la
    bloqueante + DELETE de `FECHA_BLOQUEADA`) — operación que también toma `FOR UPDATE` sobre
    esa fila en `liberarFecha()`. Por tanto **ambas rutas contienden por el mismo `FOR
    UPDATE` sobre la fila de `FECHA_BLOQUEADA`**: la primera en adquirirlo gana; la segunda
    espera al COMMIT y luego re-evalúa.
  - **Re-evaluación bajo lock (la guarda "ya promovida")**: tras adquirir el lock, US-019
    **re-lee** el estado y verifica los invariantes:
    - la RESERVA que el Gestor eligió **sigue en `sub_estado = '2d'`** (si el barrido
      automático ya promovió a otra y la reordenó, la elegida podría haber cambiado de
      `posicion_cola` — sigue válida — o, si la elegida era la que el automático promovió,
      ya estará en `2b` → **abortar**);
    - la `FECHA_BLOQUEADA` sigue apuntando a la bloqueante esperada (o la fecha sigue en un
      estado coherente para promover).
    Si los invariantes **no** se cumplen (el automático ganó la carrera y ya promovió a la
    primera), US-019 **aborta sin cambios** y el controller devuelve **409** con "La cola ya
    fue actualizada automáticamente, por favor recarga la vista". (`US-019 §RC manual vs
    automático`.)
- **Por qué esto evita la doble promoción**: `UNIQUE(tenant_id, fecha)` garantiza una sola
  fila activa de `FECHA_BLOQUEADA`; el `FOR UPDATE` serializa las dos rutas sobre esa fila
  (o sobre las RESERVA en `2d` en el caso automático post-liberación); la re-evaluación bajo
  lock detecta el estado ya cambiado. **Nunca** se re-bloquea dos veces la misma fecha ni se
  promueven dos consultas. Reside **exclusivamente en PostgreSQL**, NUNCA en locks
  distribuidos (hook `no-distributed-lock`).
- **La política NO cede prioridad al Gestor** (decisión de US-018 §D-6, respetada): si el
  automático toma el lock primero, promueve la primera FIFO y la acción manual del Gestor
  aborta con el 409 — el Gestor recarga y decide de nuevo sobre el estado actualizado. No se
  intenta "reservar" la intención manual ni cancelar una promoción automática en curso.

### D-4.1. Race entre dos Gestores (RC-B)

Dos Gestores promoviendo consultas **distintas** de la misma cola contienden por el mismo
`FOR UPDATE` sobre `FECHA_BLOQUEADA`. La primera transacción completa (expira bloqueante,
promueve su elegida, reordena). La segunda, al obtener el lock, re-evalúa: **la bloqueante
que esperaba ya está en `2.x`** y/o **la fecha ya está bloqueada por la consulta que promovió
el primer Gestor** (que ahora está en `2.b`, no en `2.d`), y su consulta elegida puede haber
cambiado de `posicion_cola`. La guarda detecta la incoherencia (la bloqueante ya no es la
esperada) y **aborta** con 409. Exactamente una promoción se materializa. Cubierto con TDD
de concurrencia real. (`US-019 §RC dos Gestores`.)

## D-5. Atomicidad y no-doble-reserva — solo PostgreSQL

- Toda la operación (expiración forzosa + promoción + re-bloqueo + reordenación + auditoría)
  en **una transacción**, serializada por `SELECT … FOR UPDATE` sobre la fila de
  `FECHA_BLOQUEADA` (D-4).
- El re-bloqueo/reasignación respeta `UNIQUE(tenant_id, fecha)` (una sola fila activa) y la
  reordenación respeta `UNIQUE(tenant_id, consulta_bloqueante_id, posicion_cola) WHERE
  posicion_cola IS NOT NULL` (US-004): orden de UPDATE de posiciones cuidado (decremento en
  orden ascendente o UPDATE en bloque) para no violar el índice a mitad. Mismo cuidado que
  US-018 §D-4.
- `ttl_expiracion` nuevo = **instante `timestamptz`** `now() + ttl_consulta_dias`, nunca
  fecha formateada (mitiga el off-by-one de TZ, deuda ajena — misma decisión que US-012 §D-7
  y US-018 §D-4).

## D-6. Notificación de la promoción — alerta interna al Gestor, SIN email al cliente

Se aplica **exactamente el mismo patrón que US-018 §D-5 / US-012 §D-10** (⚠ pendiente de
confirmación humana en el gate SDD, aunque el precedente está fijado): la promoción manual
**NO** envía email automático al cliente en MVP (el email "¡La fecha está disponible!" de
UC-12 paso 8 es `📐 Solo diseñado`, fuera de alcance). El adaptador **NO** toca el puerto de
comunicaciones/email (US-045). La traza en `AUDIT_LOG` (`origen: 'promocion_manual'` + el
`usuario_id` del Gestor) es suficiente para el MVP; la superficie de notificaciones es de
US-044. Como la acción es deliberada del Gestor (él ya sabe a quién promovió), una alerta
interna adicional es opcional y, si se registra, va **dentro de la misma transacción**
(idempotente respecto a la guarda "ya promovida").

## D-7. Multi-tenancy / RLS

La promoción manual se ejecuta bajo el **contexto RLS del tenant del Gestor autenticado**
(`SET LOCAL app.tenant_id` vía `set_config`, mismo patrón que US-041/US-018). El `tenant_id`
y el `usuario_id` del Gestor viajan en el **payload firmado del JWT**, nunca de input externo
(el `reservaId` del body/path se resuelve siempre dentro del tenant del JWT). Todas las
lecturas/escrituras de cola y `FECHA_BLOQUEADA` respetan RLS por tenant.

## D-8. Frontend — acción sobre la vista de cola de US-017

La acción "Promover a bloqueante" + el **diálogo de confirmación destructiva** se añaden a la
vista de cola existente (`apps/web/src/features/cola-espera`, US-017). Regla dura de
responsive (CLAUDE.md): funciona en móvil/tablet/escritorio (390/768/1280); el diálogo y la
lista de cola no rompen en `<lg`. El cliente HTTP se **genera** desde el contrato (nunca a
mano). Tras confirmar, se invalida la query de la cola (TanStack Query) para reflejar el
nuevo estado. Un 409 muestra "La cola ya fue actualizada automáticamente, por favor recarga
la vista".

## Riesgos / Trade-offs

- **Locus de lock distinto al de US-018**: US-018 serializa sobre RESERVA en `2d` (fecha ya
  liberada); US-019 sobre la fila de `FECHA_BLOQUEADA` (bloqueante aún viva). Ambos convergen
  porque `liberarFecha()` (la vía por la que el automático llega a promover) también toma
  `FOR UPDATE` sobre `FECHA_BLOQUEADA` antes de eliminarla. **Riesgo**: si en implementación
  se demostrara que los dos loci no se serializan mutuamente en algún encadenamiento, habría
  que unificar el lock. **Mitigación**: TDD de concurrencia real (RC-A) que fuerza el
  encadenamiento barrido→liberar→promover vs promoción manual y verifica exactamente una
  promoción; es la prueba que valida esta decisión.
- **Reordenación por cierre de hueco bajo índice UNIQUE parcial**: decrementar
  `posicion_cola` fila a fila en mal orden puede chocar transitoriamente con
  `reserva_cola_posicion_key`. Mitigación: UPDATE en bloque o en orden ascendente; test
  dirigido (igual que US-018 §Riesgos).
- **Expiración forzosa irreversible**: `2.x` es terminal; la confirmación explícita del
  Gestor (UI) es la salvaguarda. No hay "deshacer".
- **US-004 flaky (`40P01`)**: ajeno; solo se vigila al leer la suite global de concurrencia.

## Puntos que requieren decisión humana en el gate SDD

1. **D-1 (superficie HTTP)**: ¿madurar `POST /reservas/{id}/promover` (opción a) o path
   dedicado (opción b)? — recomendación: decisión de contract-engineer, pero el gate puede
   fijar preferencia.
2. **D-6 (notificación)**: confirmar que se aplica el patrón US-018 §D-5 (alerta interna /
   solo AUDIT_LOG, SIN email al cliente en MVP). Recomendado: sí, por coherencia.
3. **D-4 (política de arbitraje)**: confirmar que se respeta la decisión de US-018 §D-6
   (FIFO estricto + gana el primer lock; el Gestor pierde y recibe 409 si el automático ganó,
   sin cesión). Recomendado: sí, ya fue decidido en el gate de US-018.

## Pendiente / fuera de alcance

- **Email al cliente** de promoción (UC-12 paso 8, `📐 Solo diseñado`) → fuera de MVP (D-6).
- **Superficie de notificaciones/dashboard** → US-044.
- **Cambios en la promoción automática de US-018** → ninguno; US-019 solo consume su guarda.
- **Arreglo del off-by-one de TZ** en `formatearFechaHora` → change aparte (D-5 mitiga
  comparando instantes).

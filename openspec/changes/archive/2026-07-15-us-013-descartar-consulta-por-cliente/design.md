# Design — us-013-descartar-consulta-por-cliente

## Contexto

US-013 introduce la transición **descarte por cliente → `2z`** desde cualquier
sub_estado no terminal (`2a/2b/2c/2d/2v`). El grueso de la complejidad no está en la
transición de estado en sí, sino en los **efectos secundarios condicionados por el
origen** sobre FECHA_BLOQUEADA y la cola de espera, todos ellos atómicos. Este documento
justifica las decisiones no triviales y deja constancia de las ambigüedades que requieren
criterio humano en el gate.

## D-1: Tratamiento declarativo por origen (tabla origen → efectos)

Los efectos del descarte se modelan como una **tabla declarativa** indexada por
`sub_estado` de origen, no como una cadena de `if`. Cada origen produce una combinación
fija de efectos:

| Origen | → sub_estado | ¿Libera fecha? | ¿Promueve cola (A15)? | ¿Reordena cola (decremento)? | Notas |
|--------|-------------|----------------|-----------------------|------------------------------|-------|
| `2a`   | `2z`        | No (no hay bloqueo) | No | No | Solo marca `2z` (+ notas opc.) |
| `2b` sin cola | `2z` | Sí (`liberarFecha()`) | No (cola vacía → no-op) | No | — |
| `2b` con cola | `2z` | Sí (`liberarFecha()`) | **Sí, una vez** | No (la promoción reordena internamente) | Rama "bloqueante" |
| `2c`   | `2z`        | Sí (`liberarFecha()`) | No (cola vaciada al entrar en `2c`) | No | Operación vacía sobre cola = válida |
| `2d`   | `2z`        | No (sin bloqueo propio) | No | **Sí (decremento de `posicion_cola > P`)** | Rama "en cola"; la bloqueante NO se toca |
| `2v` sin cola | `2z` | Sí (`liberarFecha()`) | No | No | — |
| `2v` con cola heredada | `2z` | Sí (`liberarFecha()`) | **Sí, una vez** | No | Idéntico a `2b` con cola |

Esta tabla es la fuente de verdad de los scenarios del spec-delta y del árbol de tests
TDD. La guarda de origen (rechazo de terminales) precede a la tabla.

## D-2: Dos ramas distintas del mismo caso de uso — promoción (2b/2v) vs. salida de cola (2d)

Punto clave de diseño: **descartar una consulta bloqueante** y **descartar una consulta
que está en la cola** son dos ramas mecánicamente opuestas y NO deben confundirse:

- **Rama bloqueante (`2b`/`2v` con cola):** la RESERVA descartada *posee* el bloqueo de
  fecha. Al liberarlo, la fecha queda libre y hay candidatos esperándola. Se reutiliza el
  seam existente `PromocionColaPort.promoverPrimeroEnCola({ tenantId, fecha })`
  (US-018/US-041), que ya encapsula toda la mecánica A15: promover el primero a `2b`,
  re-bloquear con `bloquearFecha()` y reordenar el resto re-apuntando a la nueva
  bloqueante. US-013 **no redefine** nada de esto: solo dispara el seam **una vez** desde
  dentro de (o inmediatamente tras) `liberarFecha()`, exactamente como hace el barrido de
  TTL de US-012 al liberar una fecha con cola.

- **Rama en cola (`2d`):** la RESERVA descartada *no posee* bloqueo; es un elemento
  intermedio de la cola de otra bloqueante `B`. No hay fecha que liberar ni promoción que
  disparar. El único efecto es **cerrar el hueco**: decrementar `posicion_cola` de los que
  estaban detrás (`posicion_cola > P`), reutilizando el mismo patrón de reordenación por
  decremento que ya existe en US-018/US-019. La bloqueante `B` no se modifica.

Confundir ambas (p. ej. disparar promoción desde `2d`, o intentar reordenar manualmente en
`2b`) rompería la cola. El spec-delta las separa en requirements distintos.

**Reutilización del seam, no reimplementación:** se decide explícitamente **no** duplicar
la lógica de promoción. Si el seam A15 evoluciona (US-018/US-041), US-013 hereda el
comportamiento sin cambios. El disparo desde el descarte debe producir **exactamente una**
invocación del seam por fecha liberada (evitar doble promoción).

## D-3: Atomicidad y serialización

- Todo ocurre en **una única transacción** bajo el contexto RLS del tenant.
- Serialización por `SELECT … FOR UPDATE` (Prisma `$queryRaw`) sobre:
  - la fila de `FECHA_BLOQUEADA` cuando el origen tiene bloqueo (`2b/2c/2v`), y/o
  - la RESERVA descartada (siempre) y las RESERVA de cola implicadas (`2d`).
- La no-doble-reserva la garantiza `UNIQUE(tenant_id, fecha)`; la contigüidad de la cola,
  `UNIQUE(tenant_id, consulta_bloqueante_id, posicion_cola) WHERE posicion_cola IS NOT
  NULL`. Ambas ya existen (US-004/US-040); no hay migración nueva.
- **Prohibido** Redis/Redlock/locks distribuidos (regla crítica + hook
  `no-distributed-lock`). La liberación pasa **siempre** por `liberarFecha()` y el
  re-bloqueo por `bloquearFecha()`.
- Sin instante observable de `2z` con bloqueo propio activo ni de cola con hueco
  (all-or-nothing; rollback total ante fallo).

## D-4: Distinción de terminales (2z vs 2y vs 2x)

- `2z` = **descartada por cliente** (esta US, manual, A17).
- `2y` = descartada por cola al activar pre-reserva (US-014, A16). NO se toca.
- `2x` = expirada por barrido de TTL (US-012). NO se toca.

Son terminales semánticamente distintos para el análisis de conversión; el requirement de
la transición lo hace explícito para que la implementación no colapse `2z` con `2y`/`2x`.

## D-5: Forma del endpoint API (DECISIÓN ABIERTA — para el gate / contract-engineer)

US-013 **toca API**: necesita un endpoint de escritura que dispare la transición a `2z`
con `{ motivo? }` opcional. La forma REST **no** se decide en esta fase SDD (el contrato
lo evoluciona el contract-engineer tras el gate). Dos opciones sobre la mesa:

- **Opción A — endpoint de acción dedicado:** `POST /reservas/{id}/descartar` con body
  `{ motivo?: string }`. Explícito, alineado con otros endpoints de acción/transición del
  proyecto (p. ej. barridos y promoción manual usan verbos de acción). Recomendada por
  legibilidad y por facilitar guardas específicas.
- **Opción B — PATCH genérico con intención:** `PATCH /reservas/{id}` con
  `{ accion: 'descartar', motivo?: string }`. Menos rutas, pero mezcla transiciones
  heterogéneas en un solo endpoint y complica la validación por acción.

**Recomendación:** Opción A. **Requiere confirmación humana en el gate** antes de que el
contract-engineer evolucione `docs/api-spec.yml`. La respuesta debe devolver el nuevo
estado de la RESERVA (y, si hubo promoción, dejar constancia consumible por el frontend).

## D-6: Frontend

Acción "Marcar como descartada por cliente" en la ficha operativa de la RESERVA:
- Botón **deshabilitado** en estados terminales (`2x/2y/2z/reserva_cancelada/
  reserva_completada`); la guarda de servidor es defensiva e independiente.
- Motivo opcional (textarea) en un diálogo de confirmación.
- Manejo del error controlado de RC-3 (doble descarte) como mensaje informativo.
- Mobile-first / responsive obligatorio (regla dura del proyecto): verificar en 390/768/1280.
- El cliente HTTP se **genera** desde el contrato (dueño: contract-engineer); no se edita a
  mano.

## Ambigüedades que requieren criterio humano en el gate

1. **Forma del endpoint (D-5):** confirmar Opción A (`POST /reservas/{id}/descartar`) vs
   Opción B (PATCH con intención). Bloquea la fase de contrato.
2. **Persistencia del motivo en `RESERVA.notas`:** la US dice "actualiza notas con el
   motivo". ¿Debe **sobrescribir** `notas` o **anexar** (append con marca temporal) para
   preservar notas operativas previas? La US no lo especifica; se propone **anexar** para
   no perder historial, pero requiere confirmación. (El spec-delta deja "actualizar" sin
   forzar sobrescritura.)
3. **Alerta interna al gestor tras promoción (2b/2v con cola):** US-018 deja una alerta
   interna al promover ("contactar al cliente promovido"). ¿US-013, al disparar la misma
   promoción, debe heredar esa alerta interna? Se asume que **sí** por reutilizar el seam,
   pero conviene confirmarlo para no duplicar ni omitir la notificación.
4. **Traza de auditoría de la salida de cola en `2d`:** confirmar que el criterio de
   `datos_nuevos` (posicion_cola/consulta_bloqueante_id a NULL) coincide con el que ya usa
   US-014/US-018 para salidas de cola, para mantener consistencia del AUDIT_LOG.

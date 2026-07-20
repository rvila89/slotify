# Design: cambiar-fecha-consulta-en-cola

Decisiones técnicas no triviales para habilitar `2d` como origen de
`POST /reservas/{id}/cambiar-fecha`. Las **decisiones de producto ya están tomadas**
(no se reabren): (1) fecha nueva ocupada → conflicto 409 terminal (rollback total, la
consulta se queda en su cola actual, sin re-encolar); (2) fecha nueva libre → la
consulta sale de la cola y pasa a `2b` bloqueando esa fecha (bloqueo blando con TTL) +
borrador E1 no autoenviado.

## D-1 — Rama nueva `2d` por guarda de origen separada

`CambiarFechaUseCase` selecciona la rama de comportamiento **por el origen** de la
RESERVA. Se añade una guarda declarativa **independiente** de la existente:

- Existente (2b/2c/2v): `ORIGENES_CAMBIAR_FECHA_BLOQUEADA` +
  `esOrigenValidoParaCambiarFecha(estado, subEstado)` en
  `apps/api/src/reservas/domain/maquina-estados.ts`.
- Nueva (2d): `ORIGENES_CAMBIAR_FECHA_EN_COLA = [{ estado: 'consulta', subEstado: '2d' }]`
  + `esOrigenCambiarFechaEnCola(estado, subEstado)`.

**NO** se mezcla `2d` dentro de `esOrigenValidoParaCambiarFecha`: son ramas con
semántica distinta (2b/2c/2v mueve su propia fila `FECHA_BLOQUEADA`; 2d no tiene fila).
Modeladas como estructura de datos, no condicionales dispersos (mismo patrón que el
resto de guardas de origen de la máquina de estados). Cualquier origen que no sea
`2b/2c/2v` **ni** `2d` sigue rechazándose con **422** sin efectos.

## D-2 — Guarda de disponibilidad de la fecha nueva → 409 terminal

En la rama `2d`, la fecha nueva `F2` debe estar **LIBRE**. Si está OCUPADA por otra
RESERVA (fila `FECHA_BLOQUEADA(tenant_id, F2)` existente / choque contra
`UNIQUE(tenant_id, fecha)`), el sistema lanza `CambiarFechaConflictoError` con **409**
**terminal** y **rollback total**: no se muta la RESERVA ni su posición de cola ni el
bloqueante ni ninguna `FECHA_BLOQUEADA`.

El shape del error es **idéntico al de hoy**: solo `motivo`, **sin** `colaDisponible`
(la clase `CambiarFechaConflictoError` ya es terminal y no expone `colaDisponible`, ver
`cambiar-fecha.use-case.ts`). No se ofrece re-encolar (decisión de producto 1).

## D-3 — Salida de cola con reordenación (reutiliza mecánica US-013)

Al mover una `2d` con `posicion_cola = P` y `consulta_bloqueante_id = B` a una fecha
libre, se ejecuta **exactamente** la mecánica ya especificada en el requirement vivo
*"Salida de cola con reordenación al descartar desde 2.d"* (US-013), en la misma
transacción:

1. `posicion_cola → NULL`, `consulta_bloqueante_id → NULL` (la RESERVA sale de la cola).
2. **Decrementar en 1** la `posicion_cola` de **todas** las RESERVA en `sub_estado =
   '2d'` con el mismo `consulta_bloqueante_id = B` y `posicion_cola > P`, cerrando el
   hueco. Reordenar en **orden ascendente** para preservar
   `UNIQUE(tenant_id, consulta_bloqueante_id, posicion_cola) WHERE posicion_cola IS NOT
   NULL`; tras la reordenación las posiciones DEBEN ser contiguas empezando en 1.

La RESERVA bloqueante `B` **no se toca** y su `FECHA_BLOQUEADA` (la fecha antigua de la
cola) **no se libera** (la `2d` no tenía bloqueo propio). Se reutiliza el mismo seam de
reordenación de US-013 (no se reimplementa la lógica de huecos de cola).

## D-4 — Sin promoción; INSERT de bloqueo nuevo + cambio de sub-estado

Diferencia clave frente a la rama `2b/2c/2v`:

| | 2b/2c/2v | 2d (esta feature) |
|---|---|---|
| Fila `FECHA_BLOQUEADA` propia de la fecha antigua | **Sí** (mueve en sitio: libera F1, bloquea F2) | **No** (la 2d no posee bloqueo) |
| Efecto sobre F2 | bloquear | **INSERTAR bloqueo nuevo** |
| `sub_estado` | se conserva | **cambia `2d → 2b`** |
| Promoción de cola | libera F1 → si F1 tenía cola, **promueve FIFO** | **NO promueve** ninguna cola |

Por tanto la rama `2d` **NO** dispara promoción: la consulta en `2d` no libera nada; el
bloqueante de su fecha antigua sigue intacto con su cola (menos la propia RESERVA, que
sale reordenando).

## D-5 — Bloqueo atómico de F2 (TTL blando) en una única transacción con RLS

El bloqueo de `F2` usa la **primitiva atómica existente** `bloquearEnTx` /
`resolverPlanBloqueo` fase `2.b` (bloqueo blando con TTL). **Nada de Redis ni locks
distribuidos** (regla crítica `CLAUDE.md §Regla crítica: bloqueo atómico de fecha`; la
serialización la da PostgreSQL vía `UNIQUE(tenant_id, fecha)` + `SELECT … FOR UPDATE`).

Toda la operación (guarda bajo lock, INSERT de bloqueo de F2, `fecha_evento = F2`,
`sub_estado 2d → 2b`, TTL blando fijado, salida+reordenación de la cola vieja, borrador
E1, `AUDIT_LOG`) ocurre en **UNA** `$transaction` bajo el contexto RLS del `tenant_id`
del JWT. La guarda de disponibilidad se re-evalúa **bajo el lock** antes de mutar.

## D-6 — Borrador E1 en la misma transacción (rama 'disponible')

Se crea una `COMUNICACION` E1 en estado **`borrador`** (`fecha_envio = NULL`, **no
autoenviada**), en la misma transacción, reutilizando `plantilla-transicion-fecha.ts`
rama `'disponible'` (`TipoPlantillaTransicion = 'disponible'`). Consistente con el
patrón reciente *email de transición de fecha en borrador* (change archivado
`2026-07-18-email-transicion-fecha-borrador`): el borrador se revisa/envía con el flujo
existente de US-046 (`GET /reservas/:id/comunicaciones` → diálogo *"Revisar y enviar
borrador"* → `POST .../enviar`). No se recrea ese flujo.

## Alternativas descartadas

- **Re-encolar en la fecha nueva si está ocupada** (decisión de producto 1: descartada;
  409 terminal).
- **Mezclar `2d` en `esOrigenValidoParaCambiarFecha`** (D-1: descartado; semánticas
  distintas, guarda separada).
- **Auto-enviar el E1** (D-6: descartado; borrador para revisión del gestor).

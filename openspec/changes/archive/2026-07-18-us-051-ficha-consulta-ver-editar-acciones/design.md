# Design — us-051-ficha-consulta-ver-editar-acciones

> Decisiones técnicas sensibles de la US-051. La regla dominante es que **la fecha del
> evento es sagrada respecto del bloqueo atómico**: ninguna edición de datos puede mutar
> la fecha por una vía que no pase por `bloquearFecha()`/`liberarFecha()`.

## D-1 · Separación fecha ↔ PATCH genérico (regla dura del proyecto)

El `PATCH /reservas/{id}` (`UpdateReservaRequest`) es un **update parcial de campos
simples** de la RESERVA: `tipoEvento`, `duracionHoras`, `numAdultosNinosMayores4`,
`numNinosMenores4`, `numInvitadosFinal`, `notas` y `horario`. Estos campos **no** afectan
al bloqueo de fecha ni a la cola.

- El PATCH **NO DEBE** asignar ni mutar `fechaEvento`. El contrato ya deja el campo
  `fechaEvento` de `TransicionRequest` como `deprecated`, y `UpdateReservaRequest` **no lo
  incluye**: se mantiene así. Si un cliente envía `fechaEvento` en el PATCH, el servidor
  lo ignora / rechaza (no lo persiste).
- Justificación: `CLAUDE.md §Regla crítica: bloqueo atómico de fecha` — toda mutación de
  bloqueo pasa por `bloquearFecha()`/`liberarFecha()` con `SELECT … FOR UPDATE` +
  `UNIQUE(tenant_id, fecha)`. Un PATCH genérico de campos no puede saltarse esa
  transacción sin abrir una carrera de doble-reserva.
- Validación de `horario`: espejo de la spec viva de `consultas` ("Idioma y horario
  opcionales") — `horario` (`HH:MM`) solo es válido si la RESERVA tiene (o el mismo PATCH
  fija) `duracionHoras`. Si se envía `horario` sin `duracionHoras` presente ni entrante,
  el servidor rechaza con error de validación en `horario`.

**Migración**: NO se necesita nueva migración para `horario`: la columna
`RESERVA.horario` ya existe (migración `20260717150000_add_idioma_horario_to_reserva`,
llegada con US-047). US-051 solo la **expone** en el contrato de lectura y de update.

## D-2 · Asignar / cambiar fecha por el flujo atómico (NO por el PATCH)

La edición de la **fecha del evento** se resuelve según el sub-estado, siempre bajo el
bloqueo atómico:

| Situación de la RESERVA | Cómo se cambia la fecha | Reutiliza |
|---|---|---|
| `2a` (sin fecha, `ttl_expiracion = NULL`) | Asignar fecha vía `POST /reservas/{id}/fecha` (transición `2a → 2b/2d` con cola) | US-005 (flujo existente) |
| `2b` / `2c` / `2v` (fecha ya bloqueada) | Operación atómica NUEVA "cambiar fecha" | patrón `atomic-date-lock` (nuevo) |
| `2d` (en cola), terminales, `pre_reserva`+ | No editable en esta US | — |

### D-2.1 · Operación atómica "cambiar fecha" (la parte de mayor riesgo)

Cambiar una fecha **ya bloqueada** por otra es, atómicamente, **liberar la antigua +
bloquear la nueva** en **UNA sola transacción** con `SELECT … FOR UPDATE`:

1. `SELECT … FOR UPDATE` sobre la RESERVA y sobre `FECHA_BLOQUEADA(tenant_id, fecha_nueva)`.
2. Si `fecha_nueva` está libre → `bloquearFecha(tenant_id, fecha_nueva)`, actualizar
   `RESERVA.fecha_evento`, `liberarFecha(tenant_id, fecha_antigua)` y, si la fecha antigua
   tenía cola, disparar la **promoción FIFO** del primero en cola (mecánica A15/US-018).
3. Si `fecha_nueva` está bloqueada por otra RESERVA encolable → decisión de producto
   (previsiblemente rechazar el cambio con conflicto; se define en la spec-delta y se
   revalida en el gate). El estado y la fecha antigua **no se tocan** si el cambio no puede
   completarse.
4. `AUDIT_LOG` `accion='actualizar'`, `entidad='RESERVA'`, con la fecha anterior y la
   nueva.

Todo bajo el contexto RLS del tenant. La atomicidad y la serialización las dan PostgreSQL
(`FOR UPDATE` + `UNIQUE(tenant_id, fecha)`), **no** locks distribuidos (prohibido por
`CLAUDE.md` y el hook `no-distributed-lock`).

### D-2.2 · TDD de concurrencia OBLIGATORIO primero

Por ser una mutación de bloqueo, `tdd-first` DEBE cubrir en **rojo** (patrón
`concurrency-locking` / `atomic-date-lock`) al menos:
- Dos "cambiar fecha" concurrentes hacia la **misma** `fecha_nueva`: solo uno gana; el
  otro recibe conflicto sin doble-bloqueo (invariante `UNIQUE(tenant_id, fecha)`).
- "Cambiar fecha" concurrente con un alta/transición que intenta bloquear la misma
  `fecha_nueva` (anti-doble-reserva D4).
- "Cambiar fecha" que libera una fecha con cola → promoción FIFO se dispara exactamente
  una vez, sin estado intermedio observable.
- Idempotencia / aislamiento de fallos: si falla el bloqueo de la nueva, la antigua
  permanece intacta (rollback total).

### D-2.3 · Opción de acotación por el gate (decisión abierta)

Si el gate humano quiere **reducir riesgo/alcance** en esta US, la edición de fecha puede
**diferirse**: dejar la fecha editable **solo en `2a`** (reusando `POST /reservas/{id}/
fecha`, sin nueva operación atómica), y llevar "cambiar fecha bloqueada" a un change
propio. En ese caso, el requirement "Edición de datos" de la spec-delta conserva la parte
de campos simples + fecha en `2a`, y se retira de esta US la operación atómica "cambiar
fecha". **Esta decisión se toma en el gate**, no por defecto.

## D-3 · Gating de "Generar presupuesto" por completitud de datos

Hoy `puedeGenerarPresupuesto` (frontend) y la guarda de origen del backend miran solo
estado/sub-estado; la completitud de datos se comprueba **tarde**, en el motor, con 422 en
cascada. US-051 adelanta esa comprobación a la **UI** para no ofrecer un botón que fallará:

- Además de la guarda de estado/sub-estado existente (`estado='consulta'`,
  `subEstado ∈ {2a,2b,2c,2v}`, sin presupuesto enviado/aceptado), "Generar presupuesto"
  solo se **habilita** cuando la RESERVA tiene: `fechaEvento` + `numAdultosNinosMayores4`
  (≥ 1) + `duracionHoras` (∈ {4,8,12}) + `horario` (`HH:MM`).
- Si falta alguno, el botón queda **deshabilitado** y la ficha **enumera qué falta** y
  sugiere "Editar consulta" (abre el editor del Punto 2).
- Esto NO sustituye la validación de servidor: el backend sigue revalidando completitud +
  datos fiscales (spec viva `presupuestos`, "Validación síncrona…"). Los datos fiscales
  **no** entran en el gate de UI de esta US (se resuelven con el flujo de datos fiscales
  existente, US-014 #5); el gate de UI cubre los **datos de la RESERVA** que el editor del
  Punto 2 permite corregir. `horario` se añade a la lista de completitud como campo
  requerido para presupuestar (decisión de producto de US-051).

## D-4 · Saneo de acciones en consultas cerradas (terminales)

Hoy `AccionesConsulta` calcula `mostrarPresupuesto = estado==='consulta'` y
`mostrarDescartar = estado==='consulta'`, que son `true` también en los sub-estados
terminales `2x`/`2y`/`2z`, de modo que se pintan botones **deshabilitados**. US-051:

- En sub-estados terminales (`2x`/`2y`/`2z`) y estados terminales (`reserva_cancelada`,
  `reserva_completada`), NO se renderiza **ninguna** acción (ni el bloque "Generar
  presupuesto" deshabilitado, ni "Descartar" deshabilitado): solo el fallback "No hay
  acciones disponibles para esta consulta en su estado actual."
- Se ajustan las guardas `mostrarPresupuesto` / `mostrarDescartar` (y el bloque
  `AccionPresupuesto`) para excluir terminales, y el fallback "sin acciones" pasa a ser el
  único contenido en esos estados. Es una guarda de **UI**; las guardas de servidor de las
  transiciones permanecen intactas (revalidan de forma defensiva).

## D-5 · Adición de `horario` al contrato (para `contract-engineer`)

- `Reserva` (respuesta de lectura): añadir `horario: { type: string, nullable: true,
  pattern: '^\d{2}:\d{2}$', example: '11:00' }`. Cambio **aditivo** (opcional/nullable),
  no rompe consumidores.
- `UpdateReservaRequest`: añadir `horario: { type: string, pattern: '^\d{2}:\d{2}$' }`.
- El SDK del frontend se **regenera** desde el contrato (nunca se edita a mano;
  `contract-engineer` es el dueño, hook `protect-generated-client`).
- Lo ejecuta `contract-engineer` **después** del gate humano SDD, antes de TDD/impl.

## Trazabilidad

- US: `US-051` (los 4 puntos de la ficha).
- UC: UC-14 (generar presupuesto, gate de completitud), UC-05/UC-12/UC-18 (bloqueo de
  fecha y cola, referencia para "cambiar fecha").
- ER: `er-diagram §3.6 RESERVA` (campos del evento, `horario`, `notas`), `§FECHA_BLOQUEADA`
  (bloqueo atómico), `AUDIT_LOG`.
- Specs vivas: `consultas` ("Idioma y horario opcionales en el alta de consulta",
  guardas de acciones), `presupuestos` ("Validación síncrona de completitud…").
- `CLAUDE.md §Regla crítica: bloqueo atómico de fecha`, `§Multi-tenancy`, `§Máquina de
  estados`.

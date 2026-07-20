# Design: historial-completo-comunicaciones

## Contexto

La sección "Comunicaciones" de la ficha solo muestra un E1 porque cada evento del
ciclo de vida **sobrescribe** la única fila E1 de la reserva (upsert manual
`findFirst` + `update`). El listado y el frontend ya devuelven/renderizan todo. La
restricción de fondo es el índice UNIQUE parcial
`uq_comunicacion_reserva_codigo (reserva_id, codigo_email) WHERE reserva_id IS NOT
NULL AND es_reenvio = false AND codigo_email <> 'manual'` (US-045/046), que hace que
dos E1 `borrador` de la misma reserva colisionen — de ahí el upsert.

**Insight que dirige el diseño:** un `codigo_email = 'E1'` compartido agrupa emails
**semánticamente distintos** (respuesta a consulta exploratoria, asignación de fecha,
confirmación de fecha, cola, cambio de fecha). Marcar el 2º como "reenvío" sería
**incorrecto** (no es un reenvío, es otro email). La solución es **persistir un
`subtipo` explícito**, INSERTAR una fila por evento y mostrarlas todas etiquetadas.

## D-subtipo — Nueva columna `subtipo` en `COMUNICACION`

**Decisión.** Añadir una columna `subtipo` **nullable** a `COMUNICACION`, modelada
como enum Prisma `SubtipoEmail`. Es `NULL` para E2–E8, `manual` y filas legadas.

**Taxonomía por evento (granularidad elegida) y etiqueta de UI.**

| `subtipo`               | Etiqueta humana                    |
|-------------------------|------------------------------------|
| `consulta_exploratoria` | "Respuesta a consulta (sin fecha)" |
| `fecha_disponible`      | "Fecha disponible / asignada"      |
| `fecha_confirmada`      | "Fecha confirmada"                 |
| `cola_espera`           | "En cola de espera"                |
| `cambio_fecha`          | "Cambio de fecha"                  |

**Poblado en cada punto de generación de E1** (mapeo de los "tipo"/"tipoE1" de render
existentes → `subtipo`):
- `alta-consulta.use-case.ts:775` `tipoE1`
  `sin_fecha | fecha_disponible | fecha_confirmada | fecha_cola` →
  `consulta_exploratoria | fecha_disponible | fecha_confirmada | cola_espera`.
- `transicion-fecha-uow.prisma.adapter.ts` `disponible` → `fecha_disponible`;
  `cola` → `cola_espera`.
- `cambiar-fecha.use-case.ts` — el subtipo depende de la **rama**, no del `tipo` de
  plantilla (ambas usan `disponible`): la **salida de cola** (2d → 2b sobre fecha libre,
  `cambiarDesdeCola`) → `fecha_disponible` ("Fecha disponible / asignada"); el **cambio de
  fecha de una 2b** (rama no-cola) → `cambio_fecha` ("Cambio de fecha"). El adaptador
  `cambiar-fecha-uow.prisma.adapter.ts` persiste el `subtipo` que el caso de uso le pasa
  en `CrearBorradorE1Params` (no lo hardcodea).

## D-indice-terna — Índice UNIQUE parcial clavado sobre la terna `(reserva, codigo, subtipo)`

**Decisión.** El índice UNIQUE parcial pasa de
`(reserva_id, codigo_email) WHERE reserva_id IS NOT NULL AND es_reenvio = false AND
codigo_email <> 'manual'` a
`(reserva_id, codigo_email, subtipo) WHERE reserva_id IS NOT NULL AND es_reenvio =
false AND codigo_email <> 'manual' AND estado = 'enviado'`.

**Consecuencias.**
- Ilimitados `borrador` (cualquier subtipo) → historial completo.
- Subtipos **distintos** pueden **ambos** estar `enviado` — son emails legítimos
  distintos, **NO** reenvíos.
- Solo un **segundo envío** del **mismo** `(reserva, codigo, subtipo)` colisiona — y
  ese SÍ es un reenvío genuino (`es_reenvio = true`, patrón E3/E4/E8), que queda fuera
  del constraint. El índice es el **backstop** de la carrera de doble envío idéntico;
  el chequeo aplicativo (D-autosend) es la primera línea.
- Reenvíos (`es_reenvio = true`) y `manual` siguen fuera por su predicado.

**Migración.** SQL crudo: `DROP INDEX` del índice actual + `CREATE UNIQUE INDEX` sobre
la terna con el nuevo predicado (Prisma no modela el `WHERE` de índices parciales).
`CREATE TYPE "SubtipoEmail" AS ENUM (…)` + `ALTER TABLE comunicacion ADD COLUMN subtipo`
nullable. Actualizar el comentario documental de `prisma/schema.prisma:648-655`.

**Coexistencia de datos legados.** Las filas existentes tienen `subtipo = NULL` y, por
el upsert previo, a lo sumo una E1 por reserva; con `NULL` en la terna y el predicado
`estado = 'enviado'`, el estrechamiento nunca puede violar la nueva unicidad. No se
requiere backfill (aunque opcionalmente se podría inferir el subtipo de las E1 legadas;
no es necesario para la unicidad).

## D-autosend — Acotar el chequeo de idempotencia del motor a la terna + estado `enviado`

**Decisión.** En `despachar-email.service.ts:157-165`, el chequeo previo
(`buscarPorReservaYCodigo` → si existe, `idempotente`) debe clavar sobre
`(reserva_id, codigo_email, subtipo)` y filtrar `estado = 'enviado'`: solo un
**auto-envío previo consumado de la misma terna** frena un nuevo auto-envío. La
coexistencia de borradores o de subtipos distintos no debe cortocircuitar el motor.

**Puerto/adaptador.** `buscarPorReservaYCodigo` (puerto
`comunicacion.repository.port.ts:118-120`, adaptador
`comunicacion.repository.prisma.adapter.ts`) se amplía con `subtipo` en sus params y se
estrecha a filas `estado = 'enviado'`. Semántica: "¿ya hay un envío consumado de esta
terna?". El INSERT/UPDATE a `enviado` sigue protegido por el índice (backstop).

## D-insert-no-upsert — INSERT en lugar de upsert en los adaptadores UoW

**Decisión.** Sustituir el bloque `findFirst` + `update`/`create` por un **INSERT
directo** de una `COMUNICACION` E1 `borrador` **con su `subtipo`** en:
- `transicion-fecha-uow.prisma.adapter.ts:161-207` (añadir fecha / cola).
- `cambiar-fecha-uow.prisma.adapter.ts:285-328` (cambio de fecha).

El E1 inicial de `alta-consulta.use-case.ts:648/:775` ya inserta; se le añade el
`subtipo` derivado de `tipoE1`. Todos los E1 se insertan como `borrador`,
`es_reenvio = false`, `fecha_envio = NULL`, dentro de la misma `$transaction` con RLS.

**Adición de comportamiento (deliberada, en intención):** cambiar la fecha de una consulta
**2b** (rama no-cola de `cambiar-fecha.use-case.ts`) ahora **emite un borrador E1**
(`subtipo = cambio_fecha`) dentro de la misma transacción. **Antes esa rama no producía
ninguna comunicación** (solo bloqueaba F2 / actualizaba fecha / liberaba F1 / AUDIT_LOG),
de modo que un cambio de fecha de una 2b no informaba al cliente: era un hueco. Con el
historial completo, cada evento del ciclo de vida (incluido este) inserta su E1. La rama
de **cola** (2d → 2b) ya insertaba su borrador y ahora lo etiqueta `fecha_disponible`.

## D-regenera-en-sitio — Editar datos sin cambio de estado ACTUALIZA en sitio (no inserta)

**Decisión (recomendada, no abierta).** `actualizar-reserva.use-case.ts:383`
re-renderiza el borrador **actual** cuando el gestor edita **datos** de la consulta
(p. ej. nº de personas) **sin** cambio de estado. Esto debe seguir siendo un **UPDATE
in-place** del borrador pendiente (mismo `subtipo`, mismo evento, contenido corregido)
vía `actualizarContenidoBorrador`, **NO** un INSERT de fila nueva.

**Motivo.** Una re-renderización de datos puros **no es un evento de ciclo de vida**:
es la corrección del mismo email pendiente. Insertar una fila nueva **contaminaría** el
historial con duplicados por cada edición de datos. Solo los **eventos reales** (alta,
añadir fecha, cambiar fecha, entrar en cola) INSERTAN. Esta distinción
evento-vs-corrección es la línea que separa D-insert-no-upsert (eventos → INSERT) de
D-regenera-en-sitio (correcciones → UPDATE).

## D-manual-2o-borrador — RESUELTO por el modelo de `subtipo`

**Pregunta previa (abierta en la versión anterior).** Si el gestor envía manualmente un
2º borrador del mismo `codigo` cuando ya existe un `enviado`, ¿bloquear o tratar como
reenvío?

**Resolución con `subtipo`.** La pregunta se disuelve:
- Envíos manuales de **subtipo distinto** (p. ej. un E1 `cambio_fecha` cuando ya hubo
  un E1 `consulta_exploratoria` enviado) **coexisten** sin error y **sin** ficción de
  reenvío: son emails semánticamente distintos.
- Un re-envío de **subtipo idéntico** (misma terna ya `enviado`) es un **reenvío
  genuino** → `es_reenvio = true`, consistente con E3/E4/E8, y queda fuera del
  constraint.

Ya **no** es una decisión abierta: la taxonomía por subtipo la determina.

## Alcance / no-alcance

- **En alcance**: enum + columna `subtipo` + migración del índice a la terna; poblado
  del subtipo en los 3 puntos de generación; INSERT en los dos adaptadores UoW;
  UPDATE-in-place en `actualizar-reserva`; estrechar el chequeo de auto-envío del motor
  y su puerto/adaptador; **contrato OpenAPI + SDK** (campo `subtipo`); **frontend**
  (etiqueta humana por subtipo); docs ER; actualizar tests que codifican el invariante
  de fila única.
- **Fuera de alcance**: cambio de comportamiento de E2–E8 (`subtipo = NULL`); backfill
  del subtipo en filas legadas.

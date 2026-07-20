# Change: historial-completo-comunicaciones

## Why

En la ficha de una RESERVA, la sección **"Comunicaciones"** solo muestra **UN**
borrador E1 (el último), aunque el email E1 se genera en varios puntos del ciclo
de vida de una consulta (**alta** → **añadir fecha** → **cambiar fecha** → **cola**).
El gestor pierde el histórico: no ve el E1 que se generó al dar de alta, solo el
último que sobrescribió a los anteriores.

**Causa raíz (ya verificada en código, no re-investigar).** Existe físicamente
**UNA** fila E1 por reserva y cada evento la **SOBRESCRIBE in-place** con un upsert
manual (`findFirst` + `update`) en lugar de insertar una fila nueva:

- `apps/api/src/reservas/infrastructure/transicion-fecha-uow.prisma.adapter.ts:161-207`
- `apps/api/src/reservas/infrastructure/cambiar-fecha-uow.prisma.adapter.ts:285-328`
- `apps/api/src/reservas/application/alta-consulta.use-case.ts:648` crea el E1 inicial.

El endpoint de listado (`GET /reservas/:id/comunicaciones` → `listarPorReserva`,
`findMany` sin filtros) y el frontend (`ComunicacionesCard.tsx`, `.map()` sin
deduplicación) **ya devuelven y renderizan todo** — son **inocentes**. La restricción
la imponen conjuntamente: (a) el **índice UNIQUE parcial**
`uq_comunicacion_reserva_codigo (reserva_id, codigo_email) WHERE reserva_id IS NOT NULL
AND es_reenvio = false AND codigo_email <> 'manual'` (US-045/US-046), y (b) el
upsert que sobrescribe. Con el índice actual, dos filas E1 `borrador` de la misma
reserva colisionarían (`P2002`), por eso el código sobrescribe en vez de insertar.

Es un **bug/mejora de producto** sobre US-045 (motor de emails, idempotencia) y
US-046 (revisión de borradores en la ficha). No hay número de US nuevo.

(Fuente: `US-045 §Reglas de Validación` (idempotencia); `US-046 §Supuestos`
sección Comunicaciones de la ficha; requirement vivo *"Idempotencia de un email por
reserva y código"* (`openspec/specs/comunicaciones/spec.md:165-187`); requirement
vivo *"Listado de las comunicaciones de una RESERVA…"* (`spec.md:1021-1043`);
`CLAUDE.md §Máquina de estados de reserva`.)

## What Changes

> Slice sobre la capability `comunicaciones`. **Deja de sobrescribir**: cada evento
> del ciclo de vida INSERTA su propia `COMUNICACION` (**historial completo**),
> etiquetada con un `subtipo` explícito porque un mismo `codigo_email = 'E1'` cubre
> emails **semánticamente distintos** (respuesta a consulta exploratoria, asignación
> de fecha, confirmación de fecha, cola, cambio de fecha). La idempotencia y el índice
> UNIQUE se **clavan sobre `(reserva, codigo, subtipo)`**. **Con cambios de contrato
> OpenAPI/SDK** (nuevo campo `subtipo`) y **con migración de BD** (enum + columna +
> índice). Sujeto al **Gate de revisión humana SDD**.

- **Insight de producto (dirige el diseño).** Un `codigo_email = 'E1'` compartido
  agrupa emails **semánticamente distintos**: la respuesta a una consulta
  exploratoria (sin fecha), la asignación de una fecha disponible, la confirmación de
  fecha, la entrada en cola y el cambio de fecha son **eventos diferentes**. Marcar el
  2º como "reenvío" sería **incorrecto** (no es un reenvío del mismo email, es otro
  email distinto). Por eso se **persiste un `subtipo` explícito** de E1, se **INSERTA
  una fila por generación** y se **muestran todas etiquetadas**.

- **Nueva columna `subtipo` en `COMUNICACION`** (enum Prisma `SubtipoEmail`, nullable;
  `NULL` para E2–E8, `manual` y filas legadas). Taxonomía por evento:
  - `consulta_exploratoria` → "Respuesta a consulta (sin fecha)"
  - `fecha_disponible`      → "Fecha disponible / asignada"
  - `fecha_confirmada`      → "Fecha confirmada"
  - `cola_espera`           → "En cola de espera"
  - `cambio_fecha`          → "Cambio de fecha"

- **MODIFICA** el requirement *"Idempotencia de un email por reserva y código"*:
  1. Cada **evento** de ciclo de vida SHALL INSERTAR su **propia** `COMUNICACION` con
     su `subtipo` (historial completo; varios E1 `borrador` de distintos subtipos por
     reserva son válidos).
  2. El anti-duplicado se **clava sobre `(reserva, codigo, subtipo)`**: distintos
     subtipos pueden coexistir ambos `enviado` (son emails legítimos distintos, **no**
     reenvíos); solo un 2º envío del **mismo** `(reserva, codigo, subtipo)` colisiona,
     y ese SÍ es un reenvío genuino (`es_reenvio = true`, patrón E3/E4/E8).
  3. El **índice UNIQUE parcial** pasa a `(reserva_id, codigo_email, subtipo) WHERE
     reserva_id IS NOT NULL AND es_reenvio = false AND codigo_email <> 'manual' AND
     estado = 'enviado'` (backstop de la carrera de doble envío idéntico).

- **MODIFICA** el requirement *"Listado de las comunicaciones de una RESERVA…"*:
  el listado devuelve **todas** las filas E1 (una por evento) con su `subtipo`; el
  frontend renderiza una **etiqueta humana** por `subtipo`.

### Impacto por capa

- **Contrato** `docs/api-spec.yml` **(AHORA EN ALCANCE)**: añadir `subtipo` (enum
  nullable) al esquema `ComunicacionListItem`; **regenerar el SDK** del frontend
  (dueño: `contract-engineer`). Esto **supersede** la nota previa de "sin cambio de
  contrato".
- **Backend** `apps/api/src`:
  - **BD/Prisma**: migración que añade el **enum `SubtipoEmail` + columna `subtipo`
    nullable** y **reemplaza** el índice UNIQUE parcial por
    `(reserva_id, codigo_email, subtipo) WHERE reserva_id IS NOT NULL AND es_reenvio =
    false AND codigo_email <> 'manual' AND estado = 'enviado'`; actualizar el
    comentario de `prisma/schema.prisma:648-655`.
  - **Reservas (infra)**: sustituir el **upsert que sobrescribe** (`findFirst` +
    `update`) por **INSERT** de una `COMUNICACION` nueva **con su `subtipo`** en los
    dos adaptadores UoW (`transicion-fecha-uow.prisma.adapter.ts:161-207` →
    `disponible`→`fecha_disponible`, `cola`→`cola_espera`;
    `cambiar-fecha-uow.prisma.adapter.ts:285-328` → `disponible`→`cambio_fecha`).
  - **Reservas (application)**: poblar `subtipo` en el E1 inicial de
    `alta-consulta.use-case.ts:775` mapeando `tipoE1`
    `sin_fecha|fecha_disponible|fecha_confirmada|fecha_cola` →
    `consulta_exploratoria|fecha_disponible|fecha_confirmada|cola_espera`.
  - **Reservas (regeneración en sitio)**: `actualizar-reserva.use-case.ts:383`
    re-renderiza el borrador **actual** cuando el gestor edita DATOS de la consulta
    sin cambio de estado → **UPDATE in-place** del borrador pendiente (mismo
    `subtipo`), **NO** inserta fila nueva (no es un evento de ciclo de vida). Ver
    `design.md §D-regenera-en-sitio`.
  - **Comunicaciones (motor)**: estrechar el chequeo de idempotencia de auto-envío en
    `despachar-email.service.ts:157-165` (y su puerto/adaptador
    `buscarPorReservaYCodigo`) para clavar sobre `(reserva, codigo, subtipo)` y filtrar
    `estado = 'enviado'`.
- **Frontend** `apps/web/src/features/reservas` **(AHORA EN ALCANCE)**:
  `ComunicacionListaItem.tsx` renderiza una **etiqueta humana por `subtipo`** (el mapa
  de etiquetas vive en `lib/`, no en el `.tsx`, por el guardrail *components-solo-tsx*).
  Responsive (390/768/1280) y arrow functions.

## Impact

- **Specs afectadas**: `openspec/specs/comunicaciones/spec.md` — requirements
  *"Idempotencia de un email por reserva y código"* (MODIFIED) y *"Listado de las
  comunicaciones de una RESERVA para la ficha del gestor"* (MODIFIED).
- **Contrato/SDK**: **CON cambio** — nuevo campo `subtipo` (enum nullable) en
  `ComunicacionListItem`; SDK regenerado.
- **BD**: **CON migración** — enum `SubtipoEmail` + columna `subtipo` nullable +
  reemplazo del índice UNIQUE parcial (clave sobre `subtipo`).
- **Riesgo**: la carrera de doble **envío idéntico** del mismo `(reserva, codigo,
  subtipo)`. La frena el índice estrechado a `estado = 'enviado'` sobre esa terna.
  Cubierto por TDD (idempotencia de auto-envío preservada → una sola fila `enviado`
  por terna).
- **No rompe**: reenvíos E3/E4/E8 (`es_reenvio = true`) ni emails `manual` siguen
  fuera del constraint; E2–E8 llevan `subtipo = NULL` (sin cambio de comportamiento).
- **Decisión resuelta (ya no abierta)** (ver `design.md §D-manual-2o-borrador`): con el
  modelo de `subtipo`, envíos manuales de **subtipo distinto** coexisten sin error ni
  ficción de reenvío; un re-envío de **subtipo idéntico** es un reenvío genuino
  (`es_reenvio = true`).

# Spec Delta — Capability `confirmacion`

> **mejoras-detalle-consulta** (Mejora 2 · siembra) — Al crear la FICHA_OPERATIVA vacía en
> la confirmación del pago de señal (US-021, `pre_reserva → reserva_confirmada`), su campo
> `notas_operativas` se **siembra** con el `comentarios` de la RESERVA (si existe y no está
> en blanco), para que el gestor lo encuentre ya insertado y editable al abrir la ficha
> operativa. NO se añade campo nuevo a la ficha operativa; se reutiliza `notas_operativas`.
> NO altera la atomicidad, la idempotencia ni el bloqueo atómico de fecha de la confirmación.
>
> Fuente: `US-021 §Happy Path` (ficha vacía 1:1, idempotencia); `mejoras-detalle-consulta`
> Mejora 2; `confirmar-pago-senal.use-case.ts §FICHA_OPERATIVA`; `er-diagram §3.14
> FICHA_OPERATIVA`, `§3.6 RESERVA`; `CLAUDE.md §Multi-tenancy`.

## MODIFIED Requirements

### Requirement: Creación idempotente de la FICHA_OPERATIVA vacía (relación 1:1)

El sistema SHALL (DEBE), al confirmar, crear en la misma transacción una FICHA_OPERATIVA
con `reserva_id` de la RESERVA confirmada, `ficha_cerrada = false` y los campos de contenido
a `NULL` (`num_invitados_confirmado`, `menu_seleccionado`, `timing_detallado`,
`contacto_evento_nombre`, `contacto_evento_telefono`, `briefing_equipo`), **con la única
excepción de `notas_operativas`**, que el sistema DEBE **sembrar** con el valor de
`RESERVA.comentarios` cuando este exista y no esté en blanco (tras `trim`); si
`RESERVA.comentarios` está ausente o vacío, `notas_operativas` nace `NULL` como los demás
campos de contenido. La siembra copia el comentario del alta a la ficha para que el gestor
lo tenga ya insertado y **editable** al abrir la ficha operativa (no se añade ningún campo
nuevo a la ficha; se reutiliza `notas_operativas`). La relación es **1:1** (`reserva_id
@unique`). La creación DEBE ser **idempotente**: si ya existe una FICHA_OPERATIVA con ese
`reserva_id` (por un error previo o reintento), el sistema DEBE **detectarla y no
duplicarla** (sin re-sembrar `notas_operativas` sobre lo ya existente), continuando la
transición sin error. La siembra ocurre dentro de la misma transacción y bajo el contexto
RLS del tenant, sin afectar a la atomicidad all-or-nothing de la confirmación. (Fuente:
`US-021 §Happy Path`, `§Reglas de negocio` ficha vacía 1:1, `§FICHA_OPERATIVA ya existente
(idempotencia)`; UC-17 paso 12, UC-20; `mejoras-detalle-consulta` Mejora 2; `er-diagram.md
§3.14 FICHA_OPERATIVA` `reserva_id @unique`, `§3.6 RESERVA` `comentarios`.)

#### Scenario: Confirmar con comentarios en la reserva siembra notas_operativas

- **GIVEN** una RESERVA en `pre_reserva` sin FICHA_OPERATIVA y con
  `comentarios='Quieren carpa en el jardín'`
- **WHEN** el gestor confirma el pago de la señal
- **THEN** se crea una FICHA_OPERATIVA con `reserva_id`, `ficha_cerrada = false`, los demás
  campos de contenido `NULL` y `notas_operativas='Quieren carpa en el jardín'`
- **AND** al abrir la ficha operativa el comentario aparece ya insertado y editable

#### Scenario: Confirmar sin comentarios deja notas_operativas nula

- **GIVEN** una RESERVA en `pre_reserva` sin FICHA_OPERATIVA y con `comentarios` nulo o en
  blanco
- **WHEN** el gestor confirma el pago de la señal
- **THEN** se crea una FICHA_OPERATIVA con todos los campos de contenido `NULL`, incluido
  `notas_operativas`, y `ficha_cerrada = false`

#### Scenario: FICHA_OPERATIVA ya existente no se duplica ni se re-siembra (idempotencia)

- **GIVEN** una RESERVA en `pre_reserva` que ya tiene una FICHA_OPERATIVA con su
  `reserva_id` (por un error previo)
- **WHEN** el sistema intenta crear la ficha operativa durante la confirmación
- **THEN** detecta el registro existente y **no** crea un duplicado
- **AND** no sobreescribe el `notas_operativas` ya existente con el `comentarios`
- **AND** la transición a `reserva_confirmada` continúa sin error

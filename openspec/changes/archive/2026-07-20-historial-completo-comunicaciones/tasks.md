# Tasks: historial-completo-comunicaciones

> Pasos obligatorios de `openspec/config.yaml` en orden. El AGENTE ejecuta cada
> prueba y verifica antes de marcar `[x]`. Nunca se delega testing al usuario.

## Step 0 — Crear feature branch (PRIMERO)

- [x] `feature/historial-completo-comunicaciones` desde `master` (worktree ya creado
      en esa rama).

## GATE — Revisión humana SDD (⏸ PARADA OBLIGATORIA)

- [x] `proposal.md` + spec-delta (`specs/comunicaciones/spec.md`) + `design.md`
      **aprobados por el humano** (OK explícito recibido). Confirmada la
      **taxonomía de `subtipo`** (5 valores + etiquetas), la clave del índice sobre la
      terna (`§D-indice-terna`) y las recomendaciones `§D-regenera-en-sitio` y
      `§D-manual-2o-borrador`.

## TDD primero (tests en RED antes de implementar)

- [x] Test de integración (BD real): tras **alta consulta exploratoria + añadir fecha +
      cambiar fecha** existen **3 filas E1** en `estado = 'borrador'` con `subtipo`
      `consulta_exploratoria`, `fecha_disponible` y `cambio_fecha`, cada una con su
      propio `asunto`/`fecha_creacion`; ninguna sobrescrita.
- [x] Test: la **idempotencia de auto-envío se preserva** — dos auto-envíos de la misma
      terna `(reserva, codigo, subtipo)` dejan **una sola** fila `estado = 'enviado'`.
- [x] Test: dos E1 de **subtipo distinto** pueden **ambos** llegar a `enviado` sin
      colisión ni `es_reenvio`.
- [x] Test del índice/terna: colisión de la MISMA terna `enviado` (`P2002`); coexistencia
      de subtipos distintos. (Cubierto en `comunicacion-manual-indice-parcial`.)
- [x] Test del motor (`DespacharEmailService`): con un borrador previo de la misma terna
      (sin `enviado`), el auto-envío **NO** cortocircuita como idempotente.
- [x] Test: reeditar datos de la consulta sin cambio de estado **ACTUALIZA en sitio** el
      borrador pendiente (mismo `subtipo`) y **NO** añade fila al historial.
- [x] Confirmado que TODOS los tests nuevos estaban en **RED** antes de implementar
      (3 suites rojas verificadas desde la sesión principal).

## Step N — Implementación (revisar/actualizar tests unitarios existentes)

### Contrato OpenAPI + SDK (dueño: contract-engineer)
- [x] Añadido `SubtipoEmail` (enum) + `subtipo` (nullable) al esquema `Comunicacion`
      (heredado por `ComunicacionListItem`) de `docs/api-spec.yml`. Validado.
- [x] **SDK regenerado** (no a mano): `schema.d.ts` incluye `SubtipoEmail` y `subtipo?`.

### Backend `apps/api/src`
- [x] **Migración BD** `20260720120000_historial_comunicaciones_subtipo`: `CREATE TYPE
      "SubtipoEmail"` + `ALTER TABLE comunicacion ADD COLUMN subtipo` (nullable) +
      índice UNIQUE parcial reclavado a `(reserva_id, codigo_email, subtipo)
      NULLS NOT DISTINCT WHERE reserva_id IS NOT NULL AND es_reenvio = false AND
      codigo_email <> 'manual' AND estado = 'enviado'`; comentario de `schema.prisma`
      actualizado.
- [x] Reservas (application): `subtipo` poblado en el E1 inicial de `alta-consulta`
      mapeando `tipoE1` → subtipo.
- [x] Reservas (infra): upsert sustituido por **INSERT** de E1 `borrador` con su `subtipo`
      en `transicion-fecha-uow` y `cambiar-fecha-uow`. **Nueva emisión**: la rama 2b de
      `cambiar-fecha.use-case` ahora emite un E1 `cambio_fecha` (antes no comunicaba).
- [x] Reservas (regeneración en sitio): `actualizar-reserva` mantiene **UPDATE-in-place**
      del borrador pendiente; `cargar-borrador-e1-pendiente` ordena por `fechaCreacion desc`.
- [x] Comunicaciones (motor): idempotencia de auto-envío estrechada a la terna +
      `estado = 'enviado'`; puerto/adaptador `buscarPorReservaYCodigo` ampliado con
      `subtipo`/`estado`.
- [x] **Read path**: `subtipo` fluye por `SELECCION_LISTADO` → `ComunicacionListItem` →
      `aListItemResponse` → `ComunicacionResponseDto` (bug detectado por el E2E HTTP y
      corregido; guarda de regresión por `listarPorReserva` añadida al test de integración).
- [x] Tests existentes del invariante de fila única re-expresados fielmente
      (`transicion-fecha-integracion`, `cambiar-fecha`, `comunicacion-manual-indice-parcial`,
      `despachar-email.service`).

### Frontend `apps/web/src/features/comunicaciones`
- [x] `ComunicacionListaItem.tsx`: etiqueta humana por `subtipo` (mapa en `lib/`, no en
      el `.tsx`). `NULL` → sin etiqueta. Responsive; arrow functions.
- [x] Sin tests de UI del item previos; fixtures del puerto actualizados.

## Step N+1 — Unit tests + verificación de estado BD (AGENTE EJECUTA) + report

- [x] Suites afectadas VERDE (14 suites / 148 tests) + suite API completa (2669 passing;
      fallos restantes pre-existentes/no relacionados: react-pdf ESM, `app.e2e` typo env).
- [x] Estado BD verificado: columna `subtipo` + índice parcial sobre la terna con
      `NULLS NOT DISTINCT` y predicado `estado='enviado'` (confirmado por SQL).
- [x] Evidencia consolidada en `reports/qa-report.md`.

## Step N+2 — Pruebas manuales con curl (AGENTE EJECUTA, restaurar BD) + report

- [x] E2E HTTP real: alta exploratoria → añadir fecha → cambiar fecha →
      `GET /api/reservas/{id}/comunicaciones` devuelve **3 E1** con `subtipo`
      `consulta_exploratoria`, `fecha_disponible`, `cambio_fecha` (serializados). BD de
      test restaurada (datos `@example.test` borrados).
- [x] Evidencia en `reports/qa-report.md`.

## Step N+3 — E2E con Playwright MCP (hay frontend) (AGENTE EJECUTA) + report

- [x] Ficha de la reserva: la sección "Comunicaciones" muestra **tres** E1 con su
      **etiqueta humana por subtipo** ("Respuesta a consulta (sin fecha)",
      "Fecha disponible / asignada", "Cambio de fecha"). Desktop 1280 y tablet 768 PASS;
      overflow a 390 = deuda pre-existente del app-shell (no atribuible).
- [x] Capturas en `reports/e2e-screenshots/`; evidencia en `reports/qa-report.md`.

## Step N+4 — Actualizar documentación técnica

- [x] `docs/` actualizada (docs-keeper): `er-diagram.md` (v4.11), `data-model.md` (v3.1)
      y `architecture.md` con la columna `subtipo` (enum + nullable) y el índice sobre la
      terna con `NULLS NOT DISTINCT`; consistencia cruzada verificada.

## Code review (OBLIGATORIO)

- [x] `code-reviewer` del diff → **`Veredicto: APTO`** en `reports/code-review.md`.

## GATE — Revisión humana final (⏸ PARADA OBLIGATORIA)

- [ ] code-review **APTO** + validación manual **aprobados por el humano** (esperar OK)
      antes de archive/PR.

## Archive

- [ ] `openspec archive historial-completo-comunicaciones`; actualizar
      `openspec/specs/comunicaciones/`; abrir PR (solo tras gate final y code-review
      APTO).

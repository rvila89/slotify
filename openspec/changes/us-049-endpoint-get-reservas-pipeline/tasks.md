# Tasks — us-049-endpoint-get-reservas-pipeline

> Pasos obligatorios de `openspec/config.yaml`, en orden. Esta US **toca API**
> (implementa el `GET /reservas` ya declarado + enriquece el schema `Reserva`) y
> tiene **solo capa backend** (el frontend Kanban/Listado es US aparte → **sin
> E2E de Playwright**). El AGENTE DEBE ejecutar él mismo todas las pruebas
> (unit/curl); **nunca** delega en el usuario. Cada `[x]` solo tras ejecutar y
> verificar. Reports en
> `openspec/changes/us-049-endpoint-get-reservas-pipeline/reports/`.
>
> Recordatorio de alcance: **lectura pura**, sin mutación; **sin tests de
> concurrencia** (no hay bloqueo atómico ni mutación); campos nuevos del schema
> `Reserva` son **opcionales** (cambio aditivo, no rompe consumidores).

## 0. Setup: crear feature branch (OBLIGATORIO — PRIMER PASO — step-0)
- [x] 0.1 Branch `feature/us-049-050-pipeline-reservas` **ya creada** (compartida
      con US-050); Step 0 cubierto. NO crear branch nueva ni cambiar de rama.
- [x] 0.2 Verificar que la branch actual es `feature/us-049-050-pipeline-reservas`

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd)
- [ ] 1.1 Presentar al humano `proposal.md` + spec-delta (`specs/pipeline/spec.md`)
      (no hay `design.md`: decisiones triviales — lectura pura, mapa declarativo de
      progreso, capability `pipeline` separada de `consultas`) y **ESPERAR su OK
      explícito**
- [ ] 1.2 No avanzar a contrato/TDD/implementación sin la aprobación del humano

## 2. Contrato OpenAPI (post-gate — dueño: `contract-engineer`)
- [x] 2.1 Añadir `operationId: listarReservas` al `GET /reservas` existente
      (`docs/api-spec.yml` ~línea 194); mantener los parámetros de query ya
      definidos (`estado`, `subEstado`, `fechaDesde`, `fechaHasta`, `search`,
      `page`, `limit`) y el envoltorio `ReservaListResponse`
- [x] 2.2 Añadir al schema `Reserva` **tres propiedades opcionales** (cambio
      aditivo, no en `required`): `nombreEvento: string`,
      `progressLogistica: integer (0-100)`, `progressLiquidacion: integer (0-100)`
- [x] 2.3 `spectral lint docs/api-spec.yml` en verde (o `validate-openapi` equivalente);
      confirmar que no se rompen `ReservaDetalle`/`CreateReservaResponse`/`FichaConsulta`
- [x] 2.4 Regenerar el SDK del frontend `apps/web/src/api-client/` (nunca editar el
      cliente generado a mano)

## 3. Tests primero — TDD RED (OBLIGATORIO — tdd-first — dueño: `tdd-engineer`)
> Sin tests de race condition (lectura pura; no hay bloqueo atómico ni mutación).
> Ubicación: `apps/api/src/reservas/__tests__/listar-reservas.use-case.spec.ts`.
- [x] 3.1 Test: **lista vacía** cuando no hay reservas activas → `data: []`,
      `metadata.total = 0` (en rojo)
- [x] 3.2 Test: incluye **todos los estados activos** (`2a`, `2b`, `2c`, `2d`, `2v`,
      `pre_reserva`, `reserva_confirmada`, `evento_en_curso`, `post_evento`),
      ordenados por `fechaCreacion` descendente (en rojo)
- [x] 3.3 Test: **excluye** `2x`, `2y`, `2z`, `reserva_completada`,
      `reserva_cancelada` (en rojo)
- [x] 3.4 Test: **aislamiento multi-tenant** — con `tenant_id` T-001 no se devuelven
      reservas de otro tenant (en rojo)
- [x] 3.5 Test: **derivación `progressLogistica`** — `pendiente=0`, `en_curso=50`,
      `cerrado=100`; consulta/`pre_reserva` → `0` (en rojo)
- [x] 3.6 Test: **derivación `progressLiquidacion`** — `pendiente=0`, `facturada=50`,
      `cobrada=100`; consulta sin liquidación → `0` (en rojo)
- [x] 3.7 Test: **`nombreEvento`** = `{cliente.nombre} {cliente.apellidos}`, con
      **fallback a `codigo`** cuando no hay cliente resoluble (en rojo)
- [x] 3.8 Test: **filtro por estado** (`?estado=pre_reserva`) devuelve solo ese
      estado, sobre el conjunto de activas (en rojo)
- [x] 3.9 Test de **no-mutación**: el use-case no escribe ninguna entidad (en rojo)
- [x] 3.10 Confirmar que toda la batería está **en rojo** antes de implementar
      (22 tests, 22 failed; todos fallan por `NotImplementedError` — implementación
      ausente; el use-case es un STUB TDD-RED que lanza a propósito)

## 4. Backend: revisar y actualizar tests unitarios existentes (OBLIGATORIO — step-N — dueño: `backend-developer`)
- [x] 4.1 Revisar tests existentes del módulo `reservas` y del agregado `RESERVA`;
      confirmar regresión cero (esta US no modifica escrituras ni transiciones,
      solo añade lectura y campos derivados opcionales)

## 5. Implementación backend (post-gate — dueño: `backend-developer`)
> Scope hexagonal completo; `domain/` no importa Prisma/NestJS.
- [x] 5.1 Dominio: `listar-reservas.port.ts` (puerto de consulta en `domain/`) +
      **función pura de derivación** de `progressLogistica`/`progressLiquidacion`
      (mapa declarativo estado→progreso) y de `nombreEvento` (fallback a `codigo`)
- [x] 5.2 Aplicación: `listar-reservas.use-case.ts` — orquesta la consulta de
      activas, aplica los filtros y proyecta cada `RESERVA` a `Reserva` con los
      tres campos derivados. Sin efectos de escritura
- [x] 5.3 Infraestructura: `listar-reservas.prisma.adapter.ts` — query de reservas
      activas (excluye `2x/2y/2z/reserva_completada/reserva_cancelada`) con **join
      a `CLIENTE`**, filtro **obligatorio por `tenant_id`** + RLS, orden por
      `fechaCreacion` desc, paginación (`page`/`limit`) y filtros de query
- [x] 5.4 Interfaz: `listar-reservas.controller.ts` — `GET /reservas` (mapeo
      200/401), `tenant_id` inyectado desde el JWT (no configurable por el usuario);
      registrar en el módulo `reservas`

## 6. QA: unit tests + verificación de BD (OBLIGATORIO — step-N+1 — EL AGENTE DEBE EJECUTARLO)
- [x] 6.1 Capturar baseline de BD (counts de `reserva`, `cliente`) para confirmar
      **lectura pura**
- [x] 6.2 Ejecutar tests dirigidos del módulo cambiado (listar-reservas: estados,
      exclusiones, aislamiento, progresos, nombreEvento, filtros, no-mutación)
- [x] 6.3 Ejecutar la suite requerida (`pnpm test`)
- [x] 6.4 Verificar que la BD queda **idéntica** al baseline (la lectura no muta
      nada); restaurar si hace falta
- [x] 6.5 Crear report `reports/YYYY-MM-DD-step-N+1-unit-test-and-db-verification.md`
- [x] 6.6 Marcar completado solo tras tests en verde y report creado

## 7. QA: pruebas manuales con curl (OBLIGATORIO — step-N+2 — EL AGENTE DEBE EJECUTARLO)
- [x] 7.1 Levantar el backend y autenticarse (JWT del gestor seed)
- [x] 7.2 GET `/reservas` con datos en distintos estados → 200; verificar que
      aparecen todas las activas ordenadas por `fechaCreacion` desc, con
      `nombreEvento`, `progressLogistica` y `progressLiquidacion`
- [x] 7.3 GET `/reservas` con un tenant sin reservas activas → 200 con
      `{ data: [], metadata: { total: 0, page: 1, limit: 20 } }`
- [x] 7.4 Verificar exclusión: reservas en `2x/2y/2z/reserva_completada/
      reserva_cancelada` NO aparecen
- [x] 7.5 GET `/reservas?estado=pre_reserva` → solo reservas en `pre_reserva`
- [x] 7.6 Verificar derivaciones sobre datos reales: `preEventoStatus=en_curso` →
      `progressLogistica=50`; `liquidacionStatus=cobrada` → `progressLiquidacion=100`;
      consulta → ambos `0`; `nombreEvento` correcto (y fallback a `codigo`)
- [x] 7.7 GET con **JWT de otro tenant** → no aparecen reservas del primero
      (aislamiento); sin sesión → 401 con formato de error del contrato OpenAPI
- [x] 7.8 Confirmar que ningún GET muta la BD (lectura pura: counts intactos)
- [x] 7.9 Crear report `reports/YYYY-MM-DD-step-N+2-curl-endpoint-tests.md`

## 8. QA: E2E con Playwright MCP (step-N+3 — NO APLICA)
- [ ] 8.1 **No aplica**: US-049 no entrega frontend (Kanban/Listado es US aparte).
      Documentar en el report de curl (step-N+2) que el E2E se difiere a la US de
      frontend. `required: false` en `config.yaml`

## 9. Docs: actualizar documentación técnica (OBLIGATORIO — step-N+4 — dueño: `docs-keeper`)
- [ ] 9.1 Actualizar docs técnicas afectadas (nueva capability `pipeline`: lectura
      de reservas activas, exclusión de terminales, derivación de progreso/nombre,
      aislamiento multi-tenant/RLS) y la trazabilidad de la US (`docs/use-cases.md`
      UC-37/UC-38; `docs/er-diagram.md` lectura de `RESERVA`/`CLIENTE` y campos
      `preEventoStatus`/`liquidacionStatus`; `docs/architecture.md`). Reflejar el
      `GET /reservas` implementado y los campos nuevos del schema `Reserva`. Sin
      migración (sin cambios de esquema)

## 10. Code review (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO)
- [ ] 10.1 Ejecutar `code-reviewer` sobre el diff (guardrails: hexagonal — `domain/`
      sin Prisma/NestJS; RLS + filtro por `tenant_id`; **lectura pura sin mutación**;
      exclusión de estados terminales; derivación de progreso como **mapa
      declarativo/función pura**, no código disperso; campos nuevos del contrato
      **opcionales** — no rompen consumidores; SDK regenerado, no editado a mano)
- [ ] 10.2 Dejar informe `reports/YYYY-MM-DD-step-review-code-review.md` con la línea
      literal `Veredicto: APTO` (si NO APTO, volver a implementación)

## 11. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final)
- [ ] 11.1 Tras code-review APTO + validación manual, **ESPERAR el OK humano** antes
      de archive/PR

## 12. Archivar change + abrir PR (OBLIGATORIO — archive — dueño: `spec-author`)
- [ ] 12.1 `openspec archive us-049-endpoint-get-reservas-pipeline` (solo tras gate
      final y code-review APTO; el hook `require-code-review` lo bloquea sin APTO)
- [ ] 12.2 Actualizar `openspec/specs/` (nueva capability `pipeline`) y abrir PR

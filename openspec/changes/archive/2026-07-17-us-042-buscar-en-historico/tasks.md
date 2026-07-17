# Tasks — us-042-buscar-en-historico

> Fuente de los pasos obligatorios: `openspec/config.yaml` +
> `docs/openspec-tasks-mandatory-steps.md`. El agente DEBE ejecutar él mismo
> todas las pruebas (unit, curl, E2E); nunca las delega en el usuario.

## 0. Setup: crear feature branch (OBLIGATORIO — PRIMER PASO — step-0)
- [x] 0.1 Crear branch `feature/us-042-buscar-en-historico` desde `master`
- [x] 0.2 Verificar la branch creada y la branch actual

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd)
- [ ] 1.1 Presentar al humano `proposal.md` + spec-delta (`specs/historico/spec.md`)
      + `design.md` y ESPERAR su OK explícito antes de continuar
- [ ] 1.2 No avanzar a contrato/TDD/implementación sin el OK humano

## 2. Contrato OpenAPI (tras el gate SDD)
- [ ] 2.1 `contract-engineer`: añadir `GET /historico`
      (`operationId: listarHistorico`) a `docs/api-spec.yml`: parámetros de query
      (`estadoFinal`, `fechaDesde`, `fechaHasta`, `tipoEvento`, `importeMin`,
      `importeMax`, `search`, `page`, `limit`) y respuesta paginada
- [ ] 2.2 Decidir schema de fila (`ReservaHistorico` propio vs reutilizar
      `Reserva`) — detalle reutiliza `ReservaDetalle` (sin cambio de contrato)
- [ ] 2.3 Validar contrato (`spectral lint docs/api-spec.yml`) y regenerar el SDK
      del frontend (nunca editar el cliente generado a mano)

## 3. Tests primero — TDD RED (OBLIGATORIO — tdd-first)
- [ ] 3.1 `tdd-engineer`: tests del caso de uso `listar-historico` en rojo:
      - Aislamiento multi-tenant (solo tenant del JWT)
      - Exclusión de estados activos y `2x`/`2y`/`2z` (solo cerrados)
      - Opt-in de canceladas (sin `estadoFinal` → solo `reserva_completada`)
      - Filtros estructurados combinados con AND (fecha, tipoEvento, importe)
      - Búsqueda full-text: match y no-match sobre los 5 campos declarados
      - Paginación por defecto y validación de `limit` fuera de rango (400)
      - Orden por `fechaEvento` descendente
- [ ] 3.2 Confirmar que los tests fallan (RED) antes de implementar

## 4. Backend: revisar y actualizar tests unitarios existentes (OBLIGATORIO — step-N)
- [ ] 4.1 `backend-developer`: implementar puerto de repositorio de solo lectura
      + adaptador Prisma (full-text `$queryRaw` parametrizado + filtros +
      paginación + `tenant_id`/RLS), caso de uso y controller `GET /historico`
- [ ] 4.2 Crear la migración del índice GIN full-text (o `pg_trgm`/`ILIKE` como
      plan B de D-2) — única mutación de esquema del change
- [ ] 4.3 Revisar/actualizar tests unitarios afectados; poner en verde el TDD

## 5. QA: unit tests + verificación de BD (OBLIGATORIO — step-N+1 — EL AGENTE DEBE EJECUTARLO)
- [ ] 5.1 Capturar baseline de BD (counts de `RESERVA` por estado, `CLIENTE`)
- [ ] 5.2 Ejecutar tests dirigidos del módulo histórico
- [ ] 5.3 Ejecutar la suite requerida (`pnpm lint`, `pnpm typecheck`, `pnpm test`)
- [ ] 5.4 Verificar que la BD no mutó (lectura pura) y restaurar si hiciera falta
- [ ] 5.5 Crear report `openspec/changes/us-042-buscar-en-historico/reports/YYYY-MM-DD-step-N+1-unit-test-and-db-verification.md`
- [ ] 5.6 Marcar completado solo tras tests en verde y report creado

## 6. QA: pruebas manuales con curl (OBLIGATORIO — step-N+2 — EL AGENTE DEBE EJECUTARLO)
- [ ] 6.1 Levantar el backend con datos sembrados (reservas cerradas reales del tenant)
- [ ] 6.2 `GET /historico` sin filtros → solo `reserva_completada`, orden desc, 200
- [ ] 6.3 `GET /historico?estadoFinal=reserva_cancelada` → solo canceladas
- [ ] 6.4 Filtros combinados (`fechaDesde`/`fechaHasta` + `tipoEvento` + `search`) → AND
- [ ] 6.5 `search` con match y sin match (data vacía sin error)
- [ ] 6.6 Paginación por defecto y `limit` fuera de rango (400)
- [ ] 6.7 Aislamiento multi-tenant (JWT de otro tenant no ve datos ajenos) y `401` sin JWT
- [ ] 6.8 `GET /reservas/{id}` de una reserva cerrada devuelve `ReservaDetalle` completo
- [ ] 6.9 Verificar que NINGÚN curl mutó la BD (lectura pura); restaurar si aplica
- [ ] 6.10 Crear report `.../reports/YYYY-MM-DD-step-N+2-curl-endpoint-tests.md`

## 7. QA: E2E con Playwright MCP (OBLIGATORIO — hay frontend — step-N+3 — EL AGENTE DEBE EJECUTARLO)
- [ ] 7.1 Levantar frontend y backend con BD en estado conocido
- [ ] 7.2 Navegar a `/historico`; verificar tabla paginada y orden por fecha desc
- [ ] 7.3 Aplicar filtro de rango de fechas; verificar resultados y paginación
- [ ] 7.4 Búsqueda full-text ("García"); verificar resultados y término destacado
- [ ] 7.5 Activar opt-in de canceladas; verificar que aparecen las canceladas
- [ ] 7.6 Estados vacíos: sin resultados por filtros, búsqueda sin coincidencias,
      tenant sin histórico ("Aún no hay reservas archivadas")
- [ ] 7.7 Abrir el detalle de una fila: verificar modo lectura SIN controles de edición
- [ ] 7.8 Verificar responsive en 390/768/1280 (sin overflow horizontal)
- [ ] 7.9 Restaurar entorno; mover capturas a `reports/e2e-screenshots/`
- [ ] 7.10 Crear report `.../reports/YYYY-MM-DD-step-N+3-e2e-playwright.md`

## 8. Docs: actualizar documentación técnica (OBLIGATORIO — step-N+4)
- [ ] 8.1 `docs-keeper`: reflejar `GET /historico` y la capability `historico` en
      la documentación técnica (`docs/`), y la sección Histórico del frontend

## 9. Code review (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO)
- [ ] 9.1 `code-reviewer` sobre el diff (hexagonal, multi-tenant/RLS, lectura pura,
      sin SQL raw inseguro, responsive, cliente generado intacto)
- [ ] 9.2 Dejar informe `.../reports/YYYY-MM-DD-step-review-code-review.md` con
      la línea literal `Veredicto: APTO`

## 10. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final)
- [ ] 10.1 Tras code-review APTO + validación manual, ESPERAR el OK humano

## 11. Archivar change + abrir PR (OBLIGATORIO — archive)
- [ ] 11.1 `openspec archive us-042-buscar-en-historico` (crea `openspec/specs/historico/`)
- [ ] 11.2 Abrir PR (solo tras gate final y code-review APTO)
- [ ] 11.3 Actualizar frontmatter de `user-stories/US-042-buscar-en-historico.md`
      (estado + pr)

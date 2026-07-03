# Tasks — us-019-promocion-manual-cola

> Fuente de los pasos obligatorios: `openspec/config.yaml` + `docs/openspec-tasks-mandatory-steps.md`.
> El AGENTE DEBE ejecutar él mismo todas las pruebas (unit/curl/E2E). Nunca las delega.
> Reports en `openspec/changes/us-019-promocion-manual-cola/reports/`.

## 0. Setup: crear feature branch (OBLIGATORIO — PRIMER PASO — step-0)
- [x] 0.1 Crear branch `feature/us-019-promocion-manual-cola` desde `master`
- [x] 0.2 Verificar la branch creada y la branch actual

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd — PARADA)
- [ ] 1.1 Presentar al humano `proposal.md` + spec-delta (`specs/consultas/spec.md`) + `design.md` y ESPERAR su OK explícito
- [ ] 1.2 Resolver los ⚠ del design (requieren decisión humana en el gate):
  - [ ] 1.2.1 D-1 — superficie HTTP: madurar `POST /reservas/{id}/promover` (opción a) vs path dedicado (opción b) — se cierra en el step de contrato; el gate puede fijar preferencia
  - [ ] 1.2.2 D-6 — notificación: confirmar patrón US-018 §D-5 (alerta interna / solo AUDIT_LOG, SIN email al cliente en MVP; superficie US-044)
  - [ ] 1.2.3 D-4 — arbitraje: confirmar FIFO estricto + "gana quien toma el lock primero" (decisión heredada de US-018 §D-6; el Gestor pierde con 409 si el automático gana, sin cesión)
- [ ] 1.3 NO avanzar a implementación sin OK humano explícito (gate duro)

## 2. Contrato OpenAPI (post-gate — contract-engineer)
- [x] 2.1 Decidir y aplicar la superficie HTTP de la promoción manual (D-1): método/path/DTO/códigos de error (409 "cola ya actualizada"; 4xx "consulta ya no en cola" / "sin bloqueo para la fecha")
- [x] 2.2 Actualizar `docs/api-spec.yml` y validar con `spectral lint docs/api-spec.yml` (hook `validate-openapi`)
- [x] 2.3 Regenerar el SDK del frontend desde el contrato (nunca editar el cliente generado a mano — hook `protect-generated-client`)

## 3. Tests primero — TDD RED (OBLIGATORIO — tdd-first — zona crítica de concurrencia)
- [ ] 3.1 Dominio puro: guarda de origen de la promovida (`{consulta,2d}→{consulta,2b}`, reutiliza `resolverPromocionCola` US-018); guarda de expiración forzosa de la bloqueante (`2b/2c/2v → 2x`); plan de reordenación por **cierre de hueco** (posición P arbitraria) + validación de contigüidad/anomalía (RED)
- [ ] 3.2 Caso de uso `PromoverManualEnColaService`: happy path (promover P intermedia), FA-01 (promover P=1), FA-02 (bloqueante con TTL vencido no barrida se expira igual), FA-03 (cola de 1 queda vacía), FA-04 (cancelación = no-op, cubierto en front), FA-05 (consulta ya no en 2.d = rechazo), inconsistencia (sin FECHA_BLOQUEADA = rechazo) (RED)
- [ ] 3.3 Concurrencia REAL en Postgres (workers simultáneos, NO mocks — skill `concurrency-locking`):
  - [ ] 3.3.1 RC-A promoción manual vs barrido automático US-018 sobre la misma fecha → exactamente una promoción; la que pierde aborta (Gestor recibe 409)
  - [ ] 3.3.2 RC-B dos Gestores promueven consultas distintas de la misma cola → exactamente una promoción, la otra aborta
- [ ] 3.4 Atomicidad all-or-nothing: fallo parcial (p. ej. choque de UNIQUE en el re-bloqueo) → rollback completo (bloqueante viva, fecha bloqueada por ella, cola intacta) (RED)
- [ ] 3.5 Confirmar que TODOS los tests están en ROJO antes de implementar

## 4. Backend: revisar y actualizar tests unitarios existentes (OBLIGATORIO — step-N)
- [x] 4.1 Revisar tests de `promocion-cola.ts` / `maquina-estados.ts` de US-018 — NO deben romperse (US-019 extiende, no reescribe). Verificado: 160 tests de US-018 + máquina de estados en verde tras extender la máquina y añadir el plan manual.
- [x] 4.2 Revisar tests de la guarda "ya promovida" de US-018 (RC-3) — confirmar que la coordinación con US-019 sigue coherente. RC-A/RC-B de US-019 contienden con el barrido automático US-018 sobre el mismo `FOR UPDATE` de `FECHA_BLOQUEADA`; exactamente una promoción efectiva.
- [x] 4.3 Implementar (GREEN): dominio (plan por cierre de hueco + guardas de expiración forzosa/origen), caso de uso `PromoverManualEnColaService` + errores, adaptador Prisma UoW (`SELECT … FOR UPDATE` sobre `FECHA_BLOQUEADA`, reasignación de la fila reutilizando la primitiva atómica, reordenación por cierre de hueco, AUDIT_LOG con `origen: 'promocion_manual'` + `usuario_id`), controller NestJS `POST /reservas/:id/promover` + DTO + binding en `reservas.module.ts`; RLS por tenant + `usuario_id` del JWT; NUNCA Redis/locks distribuidos. Las 6 suites nuevas en verde + US-018 sin regresión.
- [x] 4.4 Frontend: acción "Promover a bloqueante" + diálogo de confirmación en la vista de cola de US-017 (`features/cola-espera`), consumiendo el SDK generado; invalidar la query de cola tras promover; manejar 409 con "La cola ya fue actualizada automáticamente, por favor recarga la vista"; responsive (390/768/1280, regla dura)

## 5. QA: unit tests + verificación de BD (OBLIGATORIO — step-N+1 — EL AGENTE DEBE EJECUTARLO)
- [x] 5.1 Capturar baseline de BD (`RESERVA` cola: `sub_estado`, `posicion_cola`, `consulta_bloqueante_id`, `ttl_expiracion`; `FECHA_BLOQUEADA`; `AUDIT_LOG`) en `slotify_test`
- [x] 5.2 Ejecutar tests dirigidos de los módulos cambiados (dominio, caso de uso, concurrencia RC-A/RC-B)
- [x] 5.3 Ejecutar la suite requerida (`pnpm lint`, `pnpm typecheck`, `pnpm test`); registrar totales/flaky (vigilar el flaky pre-existente US-004 40P01)
- [x] 5.4 Verificar estado posterior de BD y restaurar si hace falta (BD aislada `slotify_test`)
- [x] 5.5 Crear report `openspec/changes/us-019-promocion-manual-cola/reports/2026-07-03-step-N+1-unit-test-and-db-verification.md`
- [x] 5.6 Marcar completado solo tras tests en verde y report creado

## 6. QA: pruebas manuales con curl (OBLIGATORIO — step-N+2 — EL AGENTE DEBE EJECUTARLO)
- [x] 6.1 Levantar el backend (`.env.test` → `slotify_test`)
- [x] 6.2 Preparar escenario: R1 en `2b` bloqueante (TTL vigente) + R2/R3 en `2d` apuntando a R1 (seed)
- [x] 6.3 Invocar el endpoint de promoción manual (JWT de Gestor) promoviendo R3 (posición intermedia) y verificar 200
- [x] 6.4 Verificar en BD: R1 en `2x` (`ttl_expiracion=NULL`); R3 en `2b` con `FECHA_BLOQUEADA` re-asignada; R2 con `posicion_cola` cerrando el hueco y `consulta_bloqueante_id → R3`; `AUDIT_LOG` con `origen: promocion_manual` + `usuario_id` del Gestor; sin `COMUNICACION` (D-6)
- [x] 6.5 Casos de error: FA-05 (consulta ya no en `2d` → 4xx), inconsistencia (sin FECHA_BLOQUEADA → 4xx), carrera perdida (409 con mensaje)
- [x] 6.6 Casos adicionales: FA-01 (promover P=1), FA-03 (cola de 1 queda vacía)
- [x] 6.7 Restaurar BD al estado previo (limpiar seed)
- [x] 6.8 Crear report `openspec/changes/us-019-promocion-manual-cola/reports/2026-07-03-step-N+2-curl-endpoint-tests.md`

## 7. QA: E2E con Playwright MCP (OBLIGATORIO — HAY FRONTEND — step-N+3 — EL AGENTE DEBE EJECUTARLO)
- [x] 7.1 Levantar frontend y backend con BD en estado conocido
- [x] 7.2 Navegar a la vista de cola de US-017 de una fecha con bloqueante + cola
- [x] 7.3 Ejecutar el flujo: seleccionar una consulta, "Promover a bloqueante", confirmar el diálogo; verificar que la vista se actualiza (nueva bloqueante + cola reordenada)
- [x] 7.4 Probar la cancelación del diálogo (FA-04): no cambia nada
- [x] 7.5 Verificar persistencia (BD coincide con la UI) y responsive en 3 viewports (390/768/1280, regla dura)
- [x] 7.6 Restaurar entorno y estado de BD
- [x] 7.7 Crear report `openspec/changes/us-019-promocion-manual-cola/reports/2026-07-03-step-N+3-e2e-playwright.md`

## 8. Docs: actualizar documentación técnica (OBLIGATORIO — step-N+4)
- [ ] 8.1 Actualizar `use-cases.md` UC-12 (flujo alternativo manual implementado)
- [ ] 8.2 Anotar en `er-diagram.md §5.3` / `architecture.md` la coexistencia de promoción automática (US-018) y manual (US-019) coordinadas por la guarda "ya promovida" + `FOR UPDATE` sobre `FECHA_BLOQUEADA`
- [ ] 8.3 Documentar el nuevo endpoint en la referencia técnica si procede

## 9. Code review (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO)
- [ ] 9.1 Ejecutar `code-reviewer` sobre el diff (guardrails: hexagonal, atomic-date-lock, no-distributed-lock, state-machine, RLS, responsive, contract-sync)
- [ ] 9.2 Dejar informe `reports/YYYY-MM-DD-step-review-code-review.md` con la línea literal `Veredicto: APTO` (si NO APTO, volver a impl y repetir)

## 10. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final — PARADA)
- [ ] 10.1 Tras code-review APTO + validación manual, ESPERAR el OK humano ANTES de archive/PR

## 11. Archivar change + abrir PR (OBLIGATORIO — archive)
- [ ] 11.1 `openspec archive us-019-promocion-manual-cola` (solo tras gate final y code-review APTO; el hook `require-code-review` lo bloquea sin APTO)
- [ ] 11.2 Verificar que `openspec/specs/consultas/spec.md` recoge los requisitos añadidos
- [ ] 11.3 Abrir PR (GitHub MCP o `gh`)

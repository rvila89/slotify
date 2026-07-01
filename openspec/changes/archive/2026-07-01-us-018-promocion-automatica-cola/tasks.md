# Tasks — us-018-promocion-automatica-cola

> Fuente de los pasos obligatorios: `openspec/config.yaml` + `docs/openspec-tasks-mandatory-steps.md`.
> El AGENTE DEBE ejecutar él mismo todas las pruebas (unit/curl/E2E). Nunca las delega.
> Reports en `openspec/changes/us-018-promocion-automatica-cola/reports/`.

## 0. Setup: crear feature branch (OBLIGATORIO — PRIMER PASO — step-0)
- [x] 0.1 Crear branch `feature/us-018-promocion-automatica-cola` desde `master`
- [x] 0.2 Verificar la branch creada y la branch actual

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd — COMPLETADO)
> Usuario aprobó 01/07/2026; D-5 = alerta interna al gestor (sin email al cliente, notif diferida a US-044); D-6 = FIFO estricto + gana el primer lock.
- [x] 1.1 Presentar al humano `proposal.md` + spec-delta (`specs/consultas/spec.md`) + `design.md`
- [x] 1.2 Resolver los ⚠ del design (DECIDIDOS en el gate; OK explícito del humano recibido):
  - [x] 1.2.1 D-5 — notificación: alerta interna al gestor, SIN email al cliente en MVP (patrón US-012 §D-10; superficie US-044); registro idempotente ligado a la guarda "ya promovida"
  - [x] 1.2.2 D-6 — coordinación US-019: FIFO estricto + "gana quien toma el lock primero" (sin cesión a la acción manual)
- [x] 1.3 OK humano recibido (gate duro superado)

## 2. Contrato OpenAPI (post-gate — contract-engineer)
- [ ] 2.1 Confirmar que NO hay endpoint nuevo (la promoción es efecto de Sistema post-commit del seam)
- [ ] 2.2 Verificar que el resumen del barrido US-012 (`promocionesDisparadas`) sigue coherente; regenerar SDK solo si hubiera delta (previsiblemente NO-OP)

## 3. Tests primero — TDD RED (OBLIGATORIO — tdd-first — zona crítica de concurrencia)
- [x] 3.1 Dominio puro: `resolverPromocionCola` (guarda declarativa `{consulta,2d} → {consulta,2b}`; orígenes no promovibles → null) y el cálculo del plan de promoción (mutación promovida + decrementos + nuevo `consulta_bloqueante_id`), incluida la validación de contigüidad de posiciones (RED)
  > `__tests__/maquina-estados-promocion-cola.spec.ts` (guarda declarativa) + `__tests__/planificar-promocion-cola.spec.ts` (plan puro + contigüidad + anomalía). RED: faltan `resolverPromocionCola`/`ResultadoPromocionCola`/`MAPA_PROMOCION_COLA` en `domain/maquina-estados.ts` y el módulo `domain/promocion-cola.ts`.
- [x] 3.2 Caso de uso `PromoverPrimeroEnColaService`: happy path, FA-01 (cola de 1), FA-02 (sin cola = no-op), FA-03 (>2 elementos reordena), FA-04 (idempotencia guarda "ya promovida") (RED)
  > `__tests__/promover-primero-en-cola.use-case.spec.ts` (dobles de puertos, aislado) + `__tests__/promocion-cola-integracion.spec.ts` (efecto real en BD: 2b, re-bloqueo blando ttl futuro, reordenación, AUDIT_LOG `origen: promocion_automatica`, alerta interna sin COMUNICACION) + `__tests__/promocion-cola.binding.spec.ts` (stub→adaptador real). RED: falta `application/promover-primero-en-cola.service.ts` e `infrastructure/promocion-cola.prisma.adapter.ts`.
- [x] 3.3 Concurrencia REAL en Postgres (workers simultáneos, NO mocks — skill `concurrency-locking`):
  - [x] 3.3.1 RC-1 doble job concurrente → exactamente una promoción, cero duplicados
  - [x] 3.3.2 RC-2 barrido TTL (US-012) libera + dispara seam vs promoción → sin doble bloqueo
  - [x] 3.3.3 RC-3 job automático vs promoción manual US-019 (simulada) → guarda "ya promovida" aborta la segunda
  > `__tests__/promocion-cola-concurrencia.spec.ts` (Promise.allSettled, `slotify_test`, fechas 2029-07-*). RED: mismo motivo (adaptador stub no promueve / servicio ausente).
- [x] 3.4 Anomalía de posiciones no contiguas → auditar + abortar sin corrección silenciosa (RED)
  > Cubierto en `planificar-promocion-cola.spec.ts` (dominio: hueco/no-arranca-en-1/duplicadas → anomalía), `promover-primero-en-cola.use-case.spec.ts` (use-case reporta `anomalia`) y `promocion-cola-integracion.spec.ts` (BD: no promueve, no corrige, audita). Atomicidad all-or-nothing en `__tests__/promocion-cola-atomicidad.spec.ts` (rollback al chocar el re-bloqueo con UNIQUE(tenant,fecha)).
- [x] 3.5 Confirmar que TODOS los tests están en ROJO antes de implementar
  > Verificado: 7 suites en ROJO por AUSENCIA DE IMPLEMENTACIÓN (TS2307/TS2305: módulos/símbolos inexistentes), no por errores triviales. GREEN es de `backend-developer`.

## 4. Backend: revisar y actualizar tests unitarios existentes (OBLIGATORIO — step-N)
- [x] 4.1 Revisar tests de `liberar-fecha.service` (seam ya cableado) — NO deben cambiar (contrato heredado)
- [x] 4.2 Actualizar/ajustar tests del binding del módulo (stub → adaptador real) y de `maquina-estados`
- [x] 4.3 Implementar (GREEN): dominio (`resolverPromocionCola` + plan), caso de uso, adaptador Prisma real, re-binding en `reservas.module.ts`; reutilizar `bloquearFecha()` para el re-bloqueo; RLS por tenant; NUNCA Redis/locks distribuidos
- [x] 4.4 Sustituir `PromocionColaStubAdapter` por el adaptador real (`PROMOCION_COLA_PORT` → `PromocionColaPrismaAdapter`; el stub se mantiene SOLO como referencia del test de binding, ya no se enlaza en el módulo)

## 5. QA: unit tests + verificación de BD (OBLIGATORIO — step-N+1 — EL AGENTE DEBE EJECUTARLO)
- [x] 5.1 Capturar baseline de BD (`RESERVA` cola: `sub_estado`, `posicion_cola`, `consulta_bloqueante_id`; `FECHA_BLOQUEADA`; `AUDIT_LOG`) en `slotify_test`
- [x] 5.2 Ejecutar tests dirigidos de los módulos cambiados (dominio, caso de uso, concurrencia) — 7 suites US-018 en VERDE (49 tests)
- [x] 5.3 Ejecutar la suite requerida (`pnpm lint` 0 errores, `pnpm typecheck` OK, `pnpm arch` OK, `pnpm test` 622/622 — todos verdes en esta ejecución; el flaky US-004 40P01 pre-existente no apareció)
- [x] 5.4 Verificar estado posterior de BD y restaurar si hace falta (BD aislada `slotify_test` — limpia post-test)
- [x] 5.5 Crear report `openspec/changes/us-018-promocion-automatica-cola/reports/2026-07-01-step-N+1-unit-test-and-db-verification.md`
- [x] 5.6 Marcar completado solo tras tests en verde y report creado

## 6. QA: pruebas manuales con curl (OBLIGATORIO — step-N+2 — EL AGENTE DEBE EJECUTARLO)
- [x] 6.1 Levantar el backend (ya estaba corriendo con `.env.test` → `slotify_test`)
- [x] 6.2 Preparar escenario: R1 en `2b` con TTL vencido + R2/R3/R4 en `2d` apuntando a R1 (seed)
- [x] 6.3 Invocar `POST /cron/barrido-expiracion` (US-012) con `X-Cron-Token` válido y verificar que expira R1, libera la fecha y **dispara la promoción real** de R2 a `2b`
- [x] 6.4 Verificar en BD: R2 en `2b` con `FECHA_BLOQUEADA` re-creada; R3/R4 con `posicion_cola` decrementado y `consulta_bloqueante_id → R2`; `AUDIT_LOG` con `origen: promocion_automatica`; D-5 `COMUNICACION=0`
- [x] 6.5 Idempotencia: segunda invocación no re-promueve (candidatas=0, sin cambios en BD)
- [x] 6.6 Casos adicionales: FA-01 (cola 1), FA-02 (sin cola = no-op), ANOMALÍA (posiciones no contiguas = audita + aborta)
- [x] 6.7 Restaurar BD al estado previo (limpiar seed — 16 reservas + 16 clientes eliminados, BD=0)
- [x] 6.8 Crear report `openspec/changes/us-018-promocion-automatica-cola/reports/2026-07-01-step-N+2-curl-endpoint-tests.md`

## 7. QA: E2E con Playwright MCP (OBLIGATORIO SI HAY FRONTEND — step-N+3 — EL AGENTE DEBE EJECUTARLO)
- [x] 7.1 Sin cambios de frontend: US-018 es efecto de Sistema (sin pantalla propia). Documentado N/A en `openspec/changes/us-018-promocion-automatica-cola/reports/2026-07-01-step-N+3-e2e-playwright-NA.md` (efecto visible indirecto: fecha promovida en Calendario US-039; no requiere E2E nuevo)

## 8. Docs: actualizar documentación técnica (OBLIGATORIO — step-N+4)
- [x] 8.1 Actualizar `er-diagram.md §5.3` (párrafos "stub no-op / diferido a US-018" → promoción real implementada)
- [x] 8.2 Anotar en `architecture.md` que la promoción es síncrona al post-commit del seam (cierre de la deuda de consistencia eventual de US-012/US-041)
- [x] 8.3 Actualizar `use-cases.md` UC-12 si procede (estado de implementación)

## 9. Code review (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO)
- [x] 9.1 Ejecutar `code-reviewer` sobre el diff (guardrails: hexagonal, atomic-date-lock, no-distributed-lock, state-machine, RLS)
- [x] 9.2 Dejar informe `reports/2026-07-01-step-review-code-review.md` con la línea literal `Veredicto: APTO` (si NO APTO, volver a impl y repetir). B-1 (deriva doc) corregido en design.md y docblock

## 10. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final — PARADA)
- [x] 10.1 Tras code-review APTO + validación manual, ESPERAR el OK humano ANTES de archive/PR
  > OK humano recibido 01/07/2026 (gate final aprobado); code-review `Veredicto: APTO` en `reports/2026-07-01-step-review-code-review.md`.

## 11. Archivar change + abrir PR (OBLIGATORIO — archive)
- [x] 11.1 `openspec archive us-018-promocion-automatica-cola` (solo tras gate final y code-review APTO; el hook `require-code-review` lo bloquea sin APTO)
- [x] 11.2 Actualizar `openspec/specs/consultas/spec.md` con los requisitos añadidos
- [ ] 11.3 Abrir PR (GitHub MCP o `gh`) — lo hace el humano

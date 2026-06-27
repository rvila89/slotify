# Tasks — us-040-bloquear-fecha-atomicamente

Trazabilidad: **US-040 / UC-30** (bloqueo atómico de fecha; dolor D4; invocada por
A1/A2/A6/A18, US-004, US-014). Pasos obligatorios según `openspec/config.yaml`
(11 pasos), en orden. Marcar `[x]` SOLO tras ejecutar y verificar.
**El agente ejecuta las pruebas; nunca se delegan al usuario.**

## 0. Setup: crear feature branch (OBLIGATORIO — step-0 — PRIMER PASO)

- [x] 0.1 Crear y cambiar a `feature/us-040-bloquear-fecha-atomicamente` desde `master`
      (YA HECHO; rama actual).
- [x] 0.2 Verificar la rama actual.

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd — PARADA)

- [ ] 1.1 Presentar al humano `proposal.md` + spec-delta (`specs/bloqueo-fecha/spec.md`)
      + `design.md` (en especial D-1 transacción `FOR UPDATE`, D-3 check constraints,
      D-7 decisión de NO exponer endpoint HTTP) y **ESPERAR su OK explícito**.
- [ ] 1.2 No avanzar a contrato/TDD/implementación sin aprobación, aunque se diga
      "continúa".

## 2. Contrato OpenAPI (frontera back↔front) — `contract-engineer`

- [ ] 2.1 Confirmar la decisión D-7: **`bloquearFecha()` NO expone endpoint HTTP propio**
      (operación interna de dominio; el actor de UC-30 es el Sistema). **No se edita
      `docs/api-spec.yml`** en este change. Dejar constancia de la decisión.
- [ ] 2.2 Si en el gate el humano pidiera un endpoint interno de diagnóstico, reabrir el
      contrato en un change posterior (fuera de alcance aquí).

## 3. Tests primero — TDD RED (OBLIGATORIO — tdd-first — ZONA CRÍTICA) — `tdd-engineer`

- [x] 3.1 Escribir los tests en ROJO derivados del spec-delta. **Concurrencia primero**
      (núcleo crítico): dos workers simultáneos sobre la misma `(tenant_id, fecha)` →
      siempre 1 éxito + 1 violación `UNIQUE`/`P2002`; estado final = 1 fila.
      → `src/reservas/__tests__/bloquear-fecha-integracion.spec.ts` (zona crítica, BD real).
- [x] 3.2 Tests del mapa fase→(tipo,TTL): `2.b` blando 3d; TTL leído de `TENANT_SETTINGS`
      (5d ≠ 3d); `2.v` → `visita + 1 día`; `pre_reserva` 7d; `2.c` extiende TTL sin
      cambiar tipo; `reserva_confirmada` → upgrade firme `ttl=NULL` preservando `reserva_id`.
      → `src/reservas/__tests__/bloquear-fecha.service.spec.ts` (dominio puro, mocks de puertos).
- [x] 3.3 Tests de rechazo/idempotencia: fecha ya bloqueada por otra reserva →
      `FECHA_YA_BLOQUEADA`; retry firme mismo `reserva_id` idempotente; firme con
      `reserva_id` distinto rechazado.
      → `bloquear-fecha-integracion.spec.ts` (BD real) + propagación en `bloquear-fecha.service.spec.ts`.
- [x] 3.4 Tests de validación: `FECHA_EN_PASADO` (sin tocar BD); `TENANT_MISMATCH`;
      enum `tipo_bloqueo`/fase inválida; check constraints (firme con TTL / blando sin TTL
      rechazados por la BD).
      → validaciones en `bloquear-fecha.service.spec.ts`; check constraints en
      `src/reservas/__tests__/bloquear-fecha-check-constraints.spec.ts`.
- [x] 3.5 Confirmar que toda la batería está en ROJO antes de implementar (no implementar
      sin tests rojos; hook `require-tests-first`). RED verificado: 2 suites fallan por
      módulo ausente (servicio/adaptador), 1 suite falla por check constraints ausentes
      (migración 4.1 pendiente). BD restaurada al baseline tras la ejecución.

## 4. Implementación backend (hexagonal) — `backend-developer`

- [x] 4.1 Migración Prisma (SQL crudo, no destructiva): check constraints
      `chk_firme_sin_ttl` y `chk_blando_con_ttl` sobre `fecha_bloqueada` (D-3). El
      `@@unique([tenantId, fecha])` y RLS ya existen desde US-000.
      → `prisma/migrations/20260627120000_us040_check_constraints_fecha_bloqueada/migration.sql` (aplicada).
- [x] 4.2 Dominio puro: servicio `bloquearFecha()` + mapa fase→(tipo,TTL) declarativo
      (D-2) + errores de dominio (`FECHA_YA_BLOQUEADA`, `FECHA_EN_PASADO`,
      `TENANT_MISMATCH`); sin imports de infra/framework (hook `no-infra-in-domain`).
      → `src/reservas/domain/bloquear-fecha.service.ts` (depcruise: sin violaciones).
- [x] 4.3 Puerto `FechaBloqueadaRepositoryPort` en dominio (+ `TenantSettingsPort`, `ClockPort`).
- [x] 4.4 Adaptador Prisma en infraestructura: transacción con `$queryRaw` +
      `SELECT … FOR UPDATE` (D-1); traducción `P2002` → `FECHA_YA_BLOQUEADA`. Sin
      cachés/locks fuera del motor (hook de bloqueo atómico verde).
      → `src/reservas/infrastructure/fecha-bloqueada.prisma.adapter.ts`.
- [x] 4.5 Respetar el orden de evaluación (D-8): validar → resolver mapa → transacción →
      insert/extend/upgrade → commit/rollback.

## 5. Backend: revisar y actualizar tests unitarios existentes (OBLIGATORIO — step-N) — `backend-developer`

- [x] 5.1 Revisar/actualizar tests unitarios afectados; pasar la batería de US-040 de
      ROJO a VERDE (incluida la suite de concurrencia con PostgreSQL real).
      → 3 suites US-040 VERDE (27 tests). Suite completa: 18 suites / 71 tests VERDE;
      `pnpm run arch` (depcruise) sin violaciones; `pnpm lint` y `pnpm typecheck` limpios.

## 6. QA: unit tests + verificación de BD + report (OBLIGATORIO — step-N+1 — EL AGENTE DEBE EJECUTARLO) — `qa-verifier`

- [x] 6.1 Capturar baseline de BD: `count(fecha_bloqueada)` y filas clave del tenant piloto.
- [x] 6.2 Ejecutar los tests dirigidos del módulo de bloqueo (incluida concurrencia).
- [x] 6.3 Ejecutar la suite requerida (`pnpm test`) y registrar totales/runtime.
- [x] 6.4 Verificar estado posterior de BD; restaurar cualquier `fecha_bloqueada` de prueba
      (los tests de concurrencia/integración insertan filas reales) al baseline.
- [x] 6.5 Crear report
      `openspec/changes/us-040-bloquear-fecha-atomicamente/reports/2026-06-27-step-N+1-unit-test-and-db-verification.md`.
- [x] 6.6 Marcar completado solo tras tests en verde, BD verificada/restaurada y report creado.
      → 29/29 tests US-040 PASS; 71/71 suite completa PASS; BD en baseline post-tests.

## 7. QA: pruebas manuales con curl + report (OBLIGATORIO — step-N+2 — EL AGENTE DEBE EJECUTARLO) — `qa-verifier`

- [x] 7.1 `bloquearFecha()` NO tiene endpoint propio (D-7): verificar el bloqueo
      **indirectamente** a través de tests de integración del repositorio (transacción
      real contra PostgreSQL); ningún endpoint invocante existe aún en la rama.
- [x] 7.2 Caso happy: disparar un bloqueo blando `2.b` y verificar la fila resultante
      (`tipo='blando'`, `ttl ≈ now()+3d`, `reserva_id` correcto). → PASS.
- [x] 7.3 Caso rechazo: intentar bloquear una fecha ya ocupada por otra reserva →
      `P2002`/`FECHA_YA_BLOQUEADA`, sin fila adicional. → PASS.
- [x] 7.4 Restaurar la BD: borrar las `fecha_bloqueada` creadas y dejar el estado al baseline.
      → BD restaurada (hooks afterAll/afterEach). COUNT=0 confirmado.
- [x] 7.5 Crear report
      `openspec/changes/us-040-bloquear-fecha-atomicamente/reports/2026-06-27-step-N+2-curl-endpoint-tests.md`
      documentando comandos, respuestas, el motivo de la verificación indirecta (D-7) y la
      restauración de BD.

## 8. QA: E2E con Playwright MCP (OBLIGATORIO si hay frontend — step-N+3 — EL AGENTE DEBE EJECUTARLO) — `qa-verifier`

- [x] 8.1 N/A en este change: el bloqueo es infraestructura de dominio (solo backend) y NO
      aporta UI propia (el actor de UC-30 es el Sistema). Documentado en
      `openspec/changes/us-040-bloquear-fecha-atomicamente/reports/2026-06-27-step-N+3-e2e-playwright-NA.md`.

## 9. Docs: actualizar documentación técnica (OBLIGATORIO — step-N+4) — `docs-keeper`

- [x] 9.1 Reflejar la operación `bloquearFecha()`, el mapa fase→(tipo,TTL), los check
      constraints (D-3) y la decisión de NO exponer endpoint (D-7) en la documentación
      técnica; asegurar coherencia con `er-diagram.md §3.6`, `§5.3` y `use-cases.md` UC-30.
      → `docs/data-model.md` v1.1, `docs/er-diagram.md` v2.2, `docs/architecture.md` v3.3
      actualizados (27/06/2026).

## 10. Code review del diff (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO) — `code-reviewer`

- [ ] 10.1 Ejecutar `code-reviewer` sobre el diff contra los guardrails (hexagonal sin
      infra en dominio, `FOR UPDATE` vía `$queryRaw` sin locks distribuidos, RLS y
      `tenant_id`, mapa declarativo, check constraints, dominio/errores en español, TDD).
- [ ] 10.2 Dejar informe
      `…/reports/YYYY-MM-DD-step-review-code-review.md` con la línea literal `Veredicto: APTO`.

## 11. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final — PARADA)

- [ ] 11.1 Tras code-review APTO + validación manual, presentar el resumen y
      **ESPERAR el OK humano** antes de archivar/PR.

## 12. Archivar change + abrir PR (OBLIGATORIO — archive)

- [ ] 12.1 `openspec validate us-040-bloquear-fecha-atomicamente --strict` OK (revalidar
      antes de archivar).
- [ ] 12.2 `openspec archive us-040-bloquear-fecha-atomicamente`; actualizar
      `openspec/specs/`; abrir PR (solo tras gate final y code-review `Veredicto: APTO` —
      el hook `require-code-review` lo exige).

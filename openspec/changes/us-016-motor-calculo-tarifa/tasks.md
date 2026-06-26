# Tasks — us-016-motor-calculo-tarifa

Trazabilidad: **US-016 / UC-16** (motor de cálculo de tarifa; invocado por UC-14/UC-15).
Pasos obligatorios según `openspec/config.yaml` (11 pasos), en orden. Marcar `[x]` SOLO
tras ejecutar y verificar. **El agente ejecuta las pruebas; nunca se delegan al usuario.**

## 0. Setup: crear feature branch (OBLIGATORIO — step-0 — PRIMER PASO)

- [x] 0.1 Crear y cambiar a `feature/us-016-motor-calculo-tarifa` desde `master` (YA HECHO; rama actual).
- [x] 0.2 Verificar la rama actual.

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd — PARADA)

- [x] 1.1 Presentar al humano `proposal.md` + spec-delta (`specs/calculo-tarifa/spec.md`) + `design.md`
      (incluida la decisión D-1 del esquema de salida canónico) y **ESPERAR su OK explícito**.
- [x] 1.2 No avanzar a contrato/TDD/implementación sin aprobación, aunque se diga "continúa".

## 2. Contrato OpenAPI (frontera back↔front) — `contract-engineer`

- [x] 2.1 Definir en `docs/api-spec.yml` el schema de salida del motor con el **esquema canónico D-1**
      (`temporada`, `tarifa_a_consultar`, `precio_tarifa_eur|null`, `extras_total_eur|null`,
      `total_eur|null`, `tarifa_id|null`) y los tres errores de dominio.
- [x] 2.2 Validar el contrato (`spectral lint docs/api-spec.yml`) y regenerar el cliente.

## 3. Tests primero — TDD RED (OBLIGATORIO — tdd-first) — `tdd-engineer`

- [x] 3.1 Escribir los tests del motor en ROJO, derivados de los escenarios del spec-delta:
      happy path (alta/8h/40→1076); extras (barbacoa+paellero→1136); niños <4 ignorados;
      >50 invitados → `tarifa_a_consultar`; `TARIFA_NO_CONFIGURADA`; fronteras de temporada
      (marzo/septiembre/diciembre); distinción de duración 4/8/12; vigencia de tarifa;
      EXTRA inactivo y EXTRA cross-tenant (RLS) → `EXTRA_NO_ENCONTRADO`; validaciones de input;
      `TEMPORADA_NO_CONFIGURADA`; determinismo/lectura pura (sin mutación de BD).
      → `apps/api/src/tarifas/__tests__/calculadora-tarifa.service.spec.ts` (dobles de puertos in-memory, dominio aislado).
- [x] 3.2 Confirmar que toda la batería está en ROJO antes de implementar (no implementar sin tests rojos).
      → `npx jest src/tarifas/__tests__/calculadora-tarifa.service.spec.ts` falla por `Cannot find module '../domain/calculadora-tarifa.service'` (ausencia de implementación).

## 4. Implementación backend (hexagonal) — `backend-developer`

- [x] 4.1 Dominio puro: motor stateless/determinista + errores de dominio
      (`TARIFA_NO_CONFIGURADA`, `EXTRA_NO_ENCONTRADO`, `TEMPORADA_NO_CONFIGURADA`); sin imports de infra/framework.
- [x] 4.2 Puertos en dominio: `TarifaRepositoryPort`, `TemporadaCalendarioPort`, `ExtraRepositoryPort`.
- [x] 4.3 Adaptadores Prisma en infraestructura (lectura pura, filtrando por `tenant_id`; RLS para EXTRA).
- [x] 4.4 Componer el output canónico (D-1) y respetar el orden de evaluación (D-5).

## 5. Backend: revisar y actualizar tests unitarios existentes (OBLIGATORIO — step-N) — `backend-developer`

- [x] 5.1 Revisar/actualizar tests unitarios afectados; pasar los tests del motor de ROJO a VERDE.

## 6. QA: unit tests + verificación de BD + report (OBLIGATORIO — step-N+1 — EL AGENTE DEBE EJECUTARLO) — `qa-verifier`

- [x] 6.1 Capturar baseline de BD de las entidades leídas (45 `TARIFA`, 12 `TEMPORADA_CALENDARIO`, 2 `EXTRA`).
- [x] 6.2 Ejecutar los tests dirigidos del módulo del motor.
- [x] 6.3 Ejecutar la suite requerida (`pnpm test`) y registrar totales/runtime.
- [x] 6.4 Verificar estado posterior de BD: al ser lectura pura, NADA debe haber mutado; restaurar si hiciera falta.
- [x] 6.5 Crear report `openspec/changes/us-016-motor-calculo-tarifa/reports/2026-06-26-step-N1-unit-test-and-db-verification.md`.
- [x] 6.6 Marcar completado solo tras tests en verde, BD verificada y report creado.

## 7. QA: pruebas manuales con curl + report (OBLIGATORIO — step-N+2 — EL AGENTE DEBE EJECUTARLO) — `qa-verifier`

- [x] 7.1 Levantar el backend; verificar conexión a BD (motor de lectura pura: no se esperan mutaciones).
- [x] 7.2 `curl` happy path (alta/8h/40 invitados → `total_eur=1076`).
- [x] 7.3 `curl` con extras (barbacoa+paellero → `total_eur=1136`).
- [x] 7.4 `curl` >50 invitados → `tarifa_a_consultar:true` con importes `null` (sin error).
- [x] 7.5 `curl` casos de error: `EXTRA_NO_ENCONTRADO` (inactivo/cross-tenant) y validaciones de input
      (duración inválida, invitados negativos). Nota: el 422 `TARIFA/TEMPORADA_NO_CONFIGURADA` por curl quedó
      bloqueado por el sandbox (requería borrado destructivo de seed); cubierto por unit tests del dominio.
- [x] 7.6 Verificar que la BD queda intacta (lectura pura); restaurar si algún caso la hubiera tocado.
- [x] 7.7 Crear report `openspec/changes/us-016-motor-calculo-tarifa/reports/2026-06-26-step-N2-curl-endpoint-tests.md`.

## 8. QA: E2E con Playwright MCP (OBLIGATORIO si hay frontend — step-N+3 — EL AGENTE DEBE EJECUTARLO) — `qa-verifier`

- [x] 8.1 N/A en este change: el motor es backend puro y NO aporta UI propia (la UI la consume UC-14/US-014).
      Si la implementación incluyera cambios de frontend, ejecutar el E2E con Playwright MCP y dejar report
      `…/reports/YYYY-MM-DD-step-N+3-e2e-playwright.md`. En caso contrario, documentar el motivo de la omisión.

## 9. Docs: actualizar documentación técnica (OBLIGATORIO — step-N+4) — `docs-keeper`

- [x] 9.1 Reflejar el motor y el esquema canónico de salida (D-1) en la documentación técnica
      (`docs/` y referencias de UC-16); asegurar coherencia con `er-diagram.md §3.7–§3.9`.

## 10. Code review del diff (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO) — `code-reviewer`

- [x] 10.1 Ejecutar `code-reviewer` sobre el diff contra los guardrails (hexagonal, RLS, importes Decimal,
      lectura pura, esquema canónico D-1, dominio en español).
- [x] 10.2 Dejar informe `…/reports/2026-06-26-code-review.md` (+ addendum de re-revisión tras los fixes
      post-review) con la línea literal `Veredicto: APTO`.

## 11. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final — PARADA)

- [ ] 11.1 Tras code-review APTO + validación manual, presentar el resumen y **ESPERAR el OK humano**
      antes de archivar/PR.

## 12. Archivar change + abrir PR (OBLIGATORIO — archive)

- [x] 12.1 `openspec validate us-016-motor-calculo-tarifa --strict` OK (revalidar antes de archivar).
- [ ] 12.2 `openspec archive us-016-motor-calculo-tarifa`; actualizar `openspec/specs/`; abrir PR
      (solo tras gate final y code-review `Veredicto: APTO` — el hook `require-code-review` lo exige).

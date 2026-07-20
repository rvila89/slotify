# Tasks — Ajustes UI: sidebar 12rem + toast único por acción

> Change 100% frontend (`apps/web`). Sin backend, sin dominio, sin contrato.

## Step 0 — Feature branch (obligatorio, primero)

- [x] Crear rama `feature/2026-07-20-ajustes-ui-sidebar-toasts` desde `master`.

## GATE revisión humana (SDD) — PARADA OBLIGATORIA

- [x] Aprobar `proposal.md` + spec-delta (`specs/app-shell/spec.md`) ANTES de
      implementar. Aprobado por el usuario ("adelante").
      _(No aplica `design.md`: cambios triviales, sin decisiones técnicas no
      triviales.)_

## Tests primero (RED)

- [x] Test unitario de `lib/notify.ts`: cada variante (`success/error/warning/
      info`) llama a `toast.dismiss()` antes del `toast.*()` correspondiente y
      reenvía mensaje + opciones (mock de `sonner`). Verificado RED (módulo
      inexistente) antes de implementar.
- [x] Revisado: los tests de `AppShellResponsive` no asevera clases de ancho
      (usan role/aria queries), así que el cambio `w-72→w-48` no requiere test
      nuevo de string; el ancho se valida en E2E.

## Implementación

- [x] `AppShell.tsx`: `w-72` → `w-48` en el `<aside>` (clase de abierto) y en el
      `<div className="h-full w-48">`; docstring actualizado (288px → 192px).
- [x] Creado `apps/web/src/lib/notify.ts` (wrapper de `toast` con
      `toast.dismiss()` previo; arrow functions; export `notify`).
- [x] Migrados los call-sites de `toast.*()` a `notify.*()` en 9 ficheros de
      features (reservas, comunicaciones, facturacion, condiciones-firmadas);
      `features/facturacion/lib/toastLiquidacion.ts` reusa `notify`.

## Step N — Revisar y actualizar tests existentes

- [x] Añadido `dismiss: vi.fn()` a los 2 mocks de `sonner`
      (`RevisarEnviarBorradorDialog.test.tsx`, `AccionReenviarE3.test.tsx`) para
      que `notify` no lance con el mock.

## Step N+1 — Unit tests + verificación + report (agente ejecuta)

- [x] `eslint` (solo warnings pre-existentes de boundaries) + `tsc --noEmit`
      limpio + `vitest run` full en verde (60 ficheros / 362 tests).
      Report: `reports/2026-07-20-step-N+1-unit-test-and-db-verification.md`
      _(sin BD: change frontend; documentada la ausencia de verificación de BD)._

## Step N+2 — Pruebas manuales de endpoints con curl

- [x] N/A: change sin endpoints nuevos ni modificados. Justificado en el report
      `reports/2026-07-20-step-N+2-curl-endpoint-tests.md`.

## Step N+3 — E2E con Playwright MCP (frontend, agente ejecuta)

- [x] Verificado sidebar a 12rem en escritorio (1280, abierto) y colapso (0px)
      en 390 / 768 sin overflow; y que 3 acciones separadas dejan un único toast
      (el último). Report: `reports/2026-07-20-step-N+3-e2e-playwright.md`
      (capturas en `reports/e2e-screenshots/`).

## Step N+4 — Documentación técnica

- [x] Actualizado el ancho del sidebar 288px → 192px/12rem en `docs/DESIGN.md`
      (3 sitios: diagrama, título §Sidebar, responsive) y `docs/architecture.md`
      §2.8 (convención de layouts).

## Code review (agente ejecuta, obligatorio)

- [x] Informe del `code-reviewer` con `Veredicto: APTO` en
      `reports/2026-07-20-step-review-code-review.md`. Sin bloqueantes; hallazgo
      Bajo (conteo del proposal) corregido.

## GATE revisión humana (final) — PARADA OBLIGATORIA

- [ ] Aprobar (code-review APTO + validación manual) ANTES de archive/PR.

## Archive

- [ ] Archivar el change + abrir PR (solo tras gate final y code-review APTO).

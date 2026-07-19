# Tasks — descarte-consulta-scroll-alert-ficha

> Cambio **SOLO frontend** (`apps/web`). NO toca contrato OpenAPI, backend,
> Prisma ni BD. No hay endpoints nuevos → **sin pruebas curl** (Step de curl
> N/A). QA en 3 viewports (390 / 768 / 1280). **Hallazgo (debugging):** el alert
> de éxito no aparecía porque el host global `<Toaster/>` (Sonner) nunca se
> montaba; la implementación (a) monta `<Toaster/>` en `App.tsx` y (b) añade el
> desplazamiento al inicio en `onDescartado` de `FichaConsultaPage`.

## Step 0 — Feature branch (PRIMERO, OBLIGATORIO)
- [x] Rama `feature/descarte-consulta-scroll-alert-ficha` creada (vía `git
  worktree add` desde `master`). El worktree ya materializa la rama; **saltar** el
  `git checkout -b` interno del spec-author.

## GATE — Revisión humana de artefactos SDD (PARADA OBLIGATORIA)
- [x] `proposal.md` + spec-delta (`specs/ficha-consulta-ui/spec.md`) aprobados por
  el humano (con indicación de asegurar que el alert de éxito aparece).

## TDD — Tests primero (RED antes de implementar)
- [x] **T1** Test de regresión: con `<App/>` montada, un `toast.success` se
  renderiza en el DOM (RED confirmado antes del fix — sin `<Toaster/>` el texto
  nunca aparece). `components/ui/__tests__/toaster-montado.test.tsx`.
- [x] **T2** Test: al confirmar el descarte con éxito, se muestra el alert de
  éxito (toast) y se notifica `onDescartado`.
  `features/reservas/components/__tests__/DescartarConsultaDialog.test.tsx`.

## Implementación
- [x] **Ajuste 1 (causa raíz)** — Montar el host global `<Toaster/>` una única vez
  en `apps/web/src/App.tsx` (dentro de `QueryClientProvider`, junto a
  `InterceptorRegistrar`). Repara TODOS los toasts de la app.
- [x] **Ajuste 2 (feature)** — En `FichaConsultaPage.tsx` cambiar
  `onDescartado={() => {}}` por un handler que ejecute
  `window.scrollTo({ top: 0, behavior: 'smooth' })` (patrón de
  `NuevaConsulta/NuevaConsultaPage.tsx`).

## Step 1 — Revisar/actualizar tests unitarios
- [x] T1–T2 en verde; no rompen tests existentes de la ficha.

## Step 2 — Ejecutar unit + verificar + report
- [x] `pnpm lint` en `apps/web` VERDE (exit 0).
- [x] `pnpm test` en `apps/web` VERDE (51 files / 316 tests).
- [x] Report `reports/2026-07-19-step-2-unit-test.md`.

## Step 3 — Pruebas manuales con curl
- [x] N/A — cambio solo frontend, sin endpoints. Documentado aquí.

## Step 4 — QA manual / E2E (Playwright)
- [x] Verificado en 3 viewports (390 / 768 / 1280): descartar desde la ficha
  desplazada → la página vuelve al inicio (`scrollY → 0`) y aparece el alert de
  éxito (toast) con el código de la consulta.
- [x] Caso de error (estado terminal) cubierto por unit test: sin scroll ni alert
  de éxito, error inline.
- [x] Report `reports/2026-07-19-step-4-e2e-playwright.md` (+ captura móvil).

## Step 5 — Actualizar documentación técnica
- [ ] Sincronizar `docs/` si procede (frontend-standards / UX de la ficha).

## Code review (OBLIGATORIO)
- [x] Report `reports/2026-07-19-code-review.md` — **Veredicto: APTO**.

## GATE — Revisión humana final (PARADA OBLIGATORIA)
- [ ] Aprobaciones del humano + code-review APTO antes de archivar/PR.

## Archive / PR (solo tras GATE final aprobado)
- [ ] `openspec archive 2026-07-19-descarte-consulta-scroll-alert-ficha`; abrir PR.

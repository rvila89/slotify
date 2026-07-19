# Tasks — layout-appshell-ancho-titulos-sidebar

> Cambio **SOLO frontend** (`apps/web`). NO toca contrato OpenAPI, backend,
> Prisma ni BD. No hay endpoints → **sin pruebas curl** (Step de curl N/A,
> documentado abajo). QA en 3 viewports (390 / 768 / 1280).

## Step 0 — Feature branch (PRIMERO, OBLIGATORIO)

- [x] Crear y cambiar a `feature/layout-appshell-ancho-titulos-sidebar` antes de
  cualquier escritura.

## GATE — Revisión humana de artefactos SDD (PARADA OBLIGATORIA)

- [x] `proposal.md` + spec-delta (`specs/app-shell/spec.md`) aprobados por el
  humano. **El flujo se DETIENE aquí: esperar OK explícito antes de implementar.**
  (No hay `design.md`: los tres ajustes son cambios de presentación sin decisiones
  técnicas no triviales.)

## TDD — Tests primero (RED antes de implementar)

- [x] **T1** Ampliar/añadir test del App Shell
  (`components/layout/__tests__/AppShellInitialSidebar.test.tsx`) para el **estado
  inicial del sidebar por viewport**: con `window.innerWidth ≥ 1024` el aside
  arranca abierto (`aria-hidden=false`, sin `inert`); con `innerWidth < 1024`
  arranca cerrado. Mockear `window.innerWidth`. Falló (RED) contra el
  `useState(false)` original.
- [x] **T2** Añadir test de **títulos de contenedor** distintos del header
  (`TitulosContenedor.test.tsx`): Reservas → `<h1>` "Pipeline de solicitudes";
  Histórico → `<h1>` "Reservas archivadas"; Métricas (`SectionPlaceholder`) →
  título "Panel de métricas". Falló (RED) contra los textos originales.
- [x] **T3** Test de layout (`AnchoContenidoFullWidth.test.tsx`) que verifica que el
  contenedor raíz de las páginas ya NO incluye `max-w-[1200px]` ni `mx-auto`.
  Falló (RED).

## Implementación (SOLO tras el GATE humano aprobado)

- [x] **Ajuste 1 — sidebar por viewport.** En
  `apps/web/src/components/layout/AppShell.tsx` cambiar
  `useState(false)` → `useState(() => window.innerWidth >= 1024)`. NO añadir
  drawer (Sheet) ni listener de `resize`.
- [x] **Ajuste 2 — ancho uniforme.** Quitar `mx-auto w-full max-w-[1200px]` del
  contenedor raíz (dejar `flex flex-col gap-6`) en:
  - [x] `features/dashboard/pages/DashboardPage.tsx`
  - [x] `features/reservas/pages/ReservasPage/ReservasPage.tsx`
  - [x] `features/reservas/pages/NuevaConsulta/NuevaConsultaPage.tsx`
  - [x] `features/reservas/pages/FichaConsulta/FichaConsultaPage.tsx`
  - [x] `features/historico/pages/HistoricoPage.tsx`
  - [x] `features/historico/pages/DetalleHistorico/DetalleHistoricoPage.tsx`
  - [x] `features/cola-espera/pages/ColaEsperaPage.tsx`
  - [x] Verificado que `CalendarioPage` NO se toca (ya fluye a ancho completo).
- [x] **Ajuste 3 — títulos de contenedor.**
  - [x] `ReservasPage.tsx`: `"Reservas"` → `"Pipeline de solicitudes"`.
  - [x] `HistoricoPage.tsx`: `"Histórico"` → `"Reservas archivadas"`.
  - [x] Métricas: `SectionPlaceholder` con prop `titulo`; `App.tsx` pasa
    `titulo="Panel de métricas"` a `/metricas`, sin crear página nueva.
  - [x] Verificado (NO cambiado) que Dashboard ("Dashboard operativo") y Calendario
    ("Calendario de disponibilidad") ya difieren del header. `navigation.ts` intacto.

## Step N — Revisar/actualizar tests unitarios

- [x] T1–T3 en VERDE tras la implementación; tests existentes del App Shell
  adaptados (fijando `innerWidth=390`) sin perder cobertura de toggle/inert.

## Step N+1 — Ejecutar unit + verificar estado + report

- [x] `pnpm lint` en `apps/web` VERDE.
- [x] `pnpm test` en `apps/web` VERDE (49 archivos, 314 tests).
- [x] Report `reports/2026-07-19-step-N+1-unit-lint.md`. (No hay BD que verificar.)

## Step N+2 — Pruebas manuales de endpoints con curl (N/A)

- [x] **N/A — documentado.** El change NO añade ni modifica endpoints; sustituido
  por la QA de viewports del Step N+3.

## Step N+3 — QA manual / E2E en 3 viewports (AGENTE DEBE EJECUTAR)

- [x] Playwright MCP en **390 / 768 / 1280** — PASS global:
  - [x] **1280:** sidebar arranca abierto; contenido full-width; sin overflow.
  - [x] **768:** sidebar arranca cerrado; full-width; sin overflow (deuda ~15px
    preexistente no empeora).
  - [x] **390:** sidebar arranca cerrado; el aside de 288px no se superpone en
    arranque; sin overflow.
  - [x] **Títulos:** header vs `<h1>` distintos en Reservas, Histórico y Métricas.
  - [x] Toggle manual del menú sigue operativo.
- [x] Capturas en `reports/e2e-screenshots/`; report
  `reports/2026-07-19-step-N+3-qa-viewports.md`.

## Step N+4 — Actualizar documentación técnica

- [x] Comentario de `AppShell.tsx` refleja el estado inicial del sidebar por
  viewport y el ancho full-width. Sin cambios adicionales de docs necesarios
  (cambio de presentación acotado).

## Code review (OBLIGATORIO)

- [x] `code-reviewer` del diff → report
  `reports/2026-07-19-step-review-code-review.md` con `Veredicto: APTO`.

## GATE — Revisión humana final (PARADA OBLIGATORIA)

- [x] code-review `APTO` + QA de viewports aprobados por el humano. OK explícito
  recibido para `archive` / PR.

## Archive / PR (solo tras GATE final aprobado)

- [x] `openspec archive layout-appshell-ancho-titulos-sidebar`; actualizar
  `openspec/specs/app-shell/spec.md`; abrir PR.

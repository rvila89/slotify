# Tasks — descarte-aviso-inline-ficha

> Cambio **SOLO frontend** (`apps/web`). NO toca contrato OpenAPI, backend, Prisma,
> BD ni SDK generado. No hay endpoints nuevos → **sin pruebas curl** (Step de curl
> N/A). QA en 3 viewports (390 / 768 / 1280). Sustituye el toast lateral de los dos
> descartes (pre-reserva US-011 y consulta US-013) por un **aviso inline verde** en la
> cabecera de la ficha + scroll al inicio, homogéneo con el resto de transiciones.
> Coordinación con el change hermano `2026-07-19-descarte-consulta-scroll-alert-ficha`
> (no archivado): ver `proposal.md §Nota de coordinación`.

## Step 0 — Feature branch (PRIMERO, OBLIGATORIO)
- [x] Rama `feature/descarte-aviso-inline-ficha` creada (vía `git worktree add` desde
  `master`). El worktree ya materializa la rama; **saltar** el `git checkout -b`
  interno del spec-author.

## GATE — Revisión humana de artefactos SDD (PARADA OBLIGATORIA)
- [x] `proposal.md` + spec-delta (`specs/ficha-consulta-ui/spec.md`) aprobados por el
  humano ("adelante", 2026-07-20): (a) sustituir toast por aviso inline verde en AMBOS
  descartes; (b) enfoque de coordinación con el change hermano no archivado.

## TDD — Tests primero (RED antes de implementar)
- [x] **T1** Test de `AvisoDescarte`: renderiza el banner verde con `tipo='consulta'`
  (texto de consulta descartada + código) y con `tipo='prereserva'` (texto de
  pre-reserva descartada + código); el botón de cerrar invoca `onCerrar`.
  `features/reservas/pages/FichaConsulta/components/__tests__/AvisoDescarte.test.tsx`.
- [x] **T2** Actualizar test de `DescartarPreReservaDialog`: al confirmar con éxito
  ya NO emite toast, invoca `onDescartado(reserva)` y cierra el diálogo; en error se
  muestra inline y NO se cierra.
  `features/reservas/components/__tests__/DescartarPreReservaDialog.test.tsx`.
- [x] **T3** Actualizar test de `DescartarConsultaDialog`: al confirmar con éxito ya
  NO emite toast, invoca `onDescartado(reserva)` y cierra; error inline.
  `features/reservas/components/__tests__/DescartarConsultaDialog.test.tsx`.
- [x] **T4** Test de wiring en `AvisosFicha`/ficha: con `descarte` no nulo se
  renderiza `AvisoDescarte`; con `null` no aparece; `onCerrarDescarte` lo limpia.
- [x] Confirmar RED (los tests fallan antes de implementar).

## Implementación (5 archivos de producción)
- [x] **A1** NUEVO `apps/web/src/features/reservas/pages/FichaConsulta/components/AvisoDescarte.tsx`
  — banner verde esmeralda (`border-emerald-200 bg-emerald-50 text-emerald-900`,
  patrón de `AvisoVisitaProgramada`), props `{ tipo: 'consulta' | 'prereserva';
  codigo: string; onCerrar: () => void }`, cerrable, `role="status"`, con
  `data-testid`. Arrow function.
- [x] **A2** `AvisosFicha.tsx` — nueva prop `descarte: { reserva: Reserva; tipo:
  'consulta' | 'prereserva' } | null` + `onCerrarDescarte: () => void`; render
  condicional de `AvisoDescarte` (con `codigo={descarte.reserva.codigo}`) junto al
  resto de avisos.
- [x] **A3** `FichaConsultaPage.tsx` — nuevo estado `resultadoDescarte`;
  `onDescartado` (consulta) pasa a `setResultadoDescarte({ reserva, tipo: 'consulta' })`
  + `window.scrollTo({ top: 0, behavior: 'smooth' })`; `onDescartadoPreReserva` deja de
  ser no-op → `setResultadoDescarte({ reserva, tipo: 'prereserva' })` + `scrollTo`;
  limpia `resultadoDescarte` al abrir cualquiera de los dos diálogos de descarte; pasa
  `descarte` y `onCerrarDescarte` a `AvisosFicha`.
- [x] **A4** `DescartarPreReservaDialog.tsx` — quitar la llamada `toast.success` (e
  import `toast` huérfano eliminado); `onDescartado`/cierre se conservan.
- [x] **A5** `DescartarConsultaDialog.tsx` — quitar la llamada `toast.success` (e
  import `toast` huérfano eliminado); `onDescartado`/cierre se conservan.
- [x] Verificar `<Toaster/>` sigue montado en `App.tsx` (NO se toca; otros dominios lo
  usan).

## Step 1 — Revisar/actualizar tests unitarios
- [x] T1–T4 en verde; no rompen tests existentes de la ficha ni de los diálogos.

## Step 2 — Ejecutar unit + verificar + report
- [x] `pnpm lint` en `apps/web` VERDE (exit 0) — respeta arrow functions,
  `components/` solo `.tsx`, `max-lines` ≤300.
- [x] `pnpm test` en `apps/web` VERDE.
- [x] Report `reports/2026-07-20-step-2-unit-test.md` (comandos + salida + conteo).

## Step 3 — Pruebas manuales con curl
- [x] **N/A** — cambio solo frontend, sin endpoints nuevos ni cambios de contrato.
  Documentado en `reports/2026-07-20-step-3-curl-NA.md`.

## Step 4 — QA manual / E2E (Playwright) en 3 viewports
- [x] **Cubierto-por-unit** (decisión humana 2026-07-20): la BD dev no tenía datos
  usables (0 pre-reservas, 0 consultas activas) y el usuario optó por no ejecutar el
  E2E full-stack para este cambio de solo presentación. El comportamiento queda cubierto
  por los unit tests verdes (aviso verde por tipo + código, ausencia de toast, callbacks,
  `<Toaster/>` intacto). Justificación y análisis de cobertura/residual en
  `reports/2026-07-20-step-4-e2e-covered-by-unit.md`.

## Adición — Un solo aviso de desenlace visible (el último)
> Petición de usuario (2026-07-20, tras GATE final): en la ficha debe verse **como máximo
> un aviso a la vez** (el de la última acción); un nuevo desenlace sustituye al anterior.
- [x] **TDD-RED** Test del invariante: al mostrar un aviso y luego otro, solo el último
  queda visible; cerrar/ocultar limpia. (Preferible sobre el hook extraído `useAvisosFicha`.)
  `pages/FichaConsulta/__tests__/useAvisosFicha.test.ts`.
- [x] **Impl** Extraer la gestión de avisos a `pages/FichaConsulta/useAvisosFicha.ts`
  (hook `.ts`, fuera de `components/`), que centraliza el invariante: cada `mostrar*`
  limpia los demás antes de fijar el suyo; `cerrar()` limpia todo. `FichaConsultaPage`
  usa el hook; `AvisosFicha`/`AvisosEdicionPresupuesto` quedan presentacionales sin cambios
  (el invariante garantiza ≤1 resultado no nulo). Alivia también `max-lines` de la página.
- [x] `pnpm lint` + `pnpm test` verdes tras la adición.

## Step 5 — Actualizar documentación técnica
- [x] `docs/frontend-standards.md` §"Manejo de errores y estados de carga": añadida la
  convención de la Ficha de consulta (confirmaciones de transiciones y descartes = aviso
  inline en cabecera, no toast lateral; toasts reservados a dominios sin ficha).

## Code review (OBLIGATORIO)
- [x] 1ª pasada (descarte aviso inline) → `reports/2026-07-20-code-review.md`,
  **`Veredicto: APTO`** (sin bloqueantes ni mayores).
- [x] 2ª pasada tras la adición "un solo aviso visible" (hook `useAvisosFicha`) →
  **`Veredicto: APTO`** sobre el diff completo (sin bloqueantes/mayores, sin regresiones).

## GATE — Revisión humana final (PARADA OBLIGATORIA)
- [ ] code-review APTO + validación manual (3 viewports) aprobados por el humano antes
  de archivar/PR. Recordar al humano la **reconciliación con el change hermano no
  archivado** (ver `proposal.md §Nota de coordinación`).

## Archive / PR (solo tras GATE final aprobado)
- [ ] `openspec archive 2026-07-20-descarte-aviso-inline-ficha`; abrir PR.

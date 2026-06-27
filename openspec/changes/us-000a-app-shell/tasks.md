# Tasks — us-000a-app-shell

Trazabilidad: **US-000A** (Technical Foundation Story de UI; habilita toda pantalla
autenticada posterior). Pasos obligatorios según `openspec/config.yaml`.
Marcar `[x]` SOLO tras ejecutar y verificar. El agente ejecuta las pruebas; nunca
se delegan al usuario. Es un change **frontend-only**: sin endpoints nuevos ni
entidades de dominio.

## 0. Setup: crear feature branch (OBLIGATORIO — step-0 — PRIMER PASO)

- [x] 0.1 Crear y cambiar a `feature/us-000A-app-shell` desde `master` (YA HECHO; worktree dedicado).
- [x] 0.2 Verificar la branch actual (`git branch --show-current`).

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd)

- [x] 1.1 Presentar al humano `proposal.md` + spec-delta (`specs/app-shell/spec.md`) + `design.md` y ESPERAR su OK explícito antes de tocar `apps/web`. NO avanzar por defecto. → **OK humano recibido 2026-06-27** (curl N/A y guard-contra-abstracción validados).

## 2. Tests primero — TDD RED (OBLIGATORIO — tdd-first)

> No hay concurrencia/máquina de estados (es UI). Los tests RED cubren el armazón.
> RED verificado con `pnpm --filter @slotify/web test` (Vitest 2.1.9 + RTL):
> 6 test files fallan, 1 (LoginPage scaffolding) sigue verde — sin regresión.
> La abstracción de sesión se INYECTA en los tests vía el `SessionProvider` aún
> inexistente (no se asume implementación concreta de auth, US-001).
- [x] 2.1 Test de guard: ruta protegida sin sesión → redirige a login y preserva la ruta solicitada (en ROJO). → `src/app/__tests__/RequireAuth.test.tsx`. Falla: `Failed to resolve import "@/app/RequireAuth"` (guard inexistente).
- [x] 2.2 Test de guard: tras sesión válida → regresa a la ruta solicitada (en ROJO). → `src/app/__tests__/RequireAuth.test.tsx`. Falla: mismo módulo `@/app/RequireAuth`/`@/auth/session` inexistente.
- [x] 2.3 Test de navegación SPA: seleccionar sección cambia el outlet sin recargar y resalta el item activo (en ROJO). → `src/app/__tests__/AppShellNavigation.test.tsx`. Falla: `Failed to resolve import "@/auth/session"` (shell/sesión no cableados).
- [x] 2.4 Test de catch-all: ruta inexistente dentro del shell muestra "no encontrado" conservando la nav (en ROJO). → `src/app/__tests__/AppShellCatchAll.test.tsx`. Falla: `Failed to resolve import "@/auth/session"`.
- [x] 2.5 Test de placeholder: sección no implementada muestra placeholder sin romper la nav (en ROJO). → `src/app/__tests__/AppShellPlaceholder.test.tsx`. Falla: `Failed to resolve import "@/auth/session"`.
- [x] 2.6 Test de separación de layouts: `/login` NO renderiza el sidebar/header del shell (en ROJO). → `src/app/__tests__/LayoutSeparation.test.tsx`. Falla: `Failed to resolve import "@/auth/session"`.
- [x] 2.7 Test de tokens: el shell consume tokens nombrados (sin hex inline) y las fuentes Epilogue/Manrope están declaradas (en ROJO). → `src/design-system/__tests__/design-tokens.test.ts`. Falla por aserción: `index.css` sin `:root`/tokens de estado/fuentes, `tailwind.config.ts` con `extend:{}`, y `src/app/AppShell.tsx` inexistente.

## 3. Frontend: revisar y actualizar tests unitarios existentes (OBLIGATORIO — step-N)

- [x] 3.1 Implementar el cableado de tokens (`index.css` `:root` + `tailwind.config.ts` + fuentes + `shadcn init`) y revisar/ajustar los smoke tests del scaffolding (US-000) que dependan de Tailwind. → Tokens semánticos + estados de reserva como CSS vars en `:root`, mapeados en `tailwind.config.ts` (`colors`/`fontFamily`/`borderRadius` vía `var(--…)`). Fuentes Epilogue + Manrope cargadas (Google Fonts `@import`). shadcn/ui inicializado (`components.json` + `src/lib/utils.ts` `cn`; deps `clsx`/`tailwind-merge`/`cva`/`lucide-react`). LoginPage sin regresión.
- [x] 3.2 Implementar `AppShell` (sidebar 288px + header + outlet), guard de sesión, navegación SPA con item activo, placeholders y catch-all, hasta poner en VERDE los tests de la Fase 2. → `@/auth/session` (SessionProvider+useSession), `@/app/RequireAuth` (redirige a `/login` con `state.from`), `@/app/AppShell` (nav `aria-current="page"` + "+ Nueva Reserva" + `<Outlet/>`), `SectionPlaceholder` (`data-testid="section-placeholder"`) y `NotFound` (catch-all dentro del shell). `/login` fuera del chrome. **7/7 suites VERDE (13 tests); `pnpm lint` y `pnpm typecheck` en verde.**

## 4. QA: unit tests + verificación de estado (OBLIGATORIO — step-N+1 — EL AGENTE DEBE EJECUTARLO)

- [x] 4.1 Ejecutar tests dirigidos de `apps/web` (Vitest/RTL) de los módulos cambiados. → 7 suites / 13 tests PASS. `pnpm --filter @slotify/web test` exit 0.
- [x] 4.2 Ejecutar la suite requerida (`pnpm test`) y `pnpm lint && pnpm typecheck`. → Todos en verde: 0 errores lint, 0 errores tsc.
- [x] 4.3 Verificar que no hay regresiones en el scaffolding existente (no hay mutación de BD: change frontend-only). → LoginPage (1 test) PASS. BD: N/A justificado.
- [x] 4.4 Crear report `openspec/changes/us-000a-app-shell/reports/YYYY-MM-DD-step-N+1-unit-test-and-db-verification.md` (sección BD: N/A justificado). → `reports/2026-06-27-step-N+1-unit-test-and-db-verification.md` creado.
- [x] 4.5 Marcar completado solo tras tests en verde y report creado. → COMPLETADO.

## 5. QA: pruebas manuales con curl (OBLIGATORIO — step-N+2 — EL AGENTE DEBE EJECUTARLO)

> Change frontend-only: NO introduce endpoints nuevos. El agente documenta el N/A.
- [x] 5.1 Confirmar que US-000A no añade ni modifica endpoints del backend. → Confirmado: ningún fichero de `apps/api` modificado; `LoginPage` es stub sin llamadas HTTP.
- [x] 5.2 Crear report `…/reports/YYYY-MM-DD-step-N+2-curl-endpoint-tests.md` registrando "N/A — sin endpoints nuevos" con la justificación de alcance. → `reports/2026-06-27-step-N+2-curl-endpoint-tests.md` creado.

## 6. QA: E2E con Playwright MCP (OBLIGATORIO — step-N+3 — EL AGENTE DEBE EJECUTARLO)

> Aplica: hay cambios de frontend. Es la verificación principal de esta US.
- [x] 6.1 Levantar `apps/web` (y backend mínimo para la sesión si hace falta) en estado conocido. → Dev server levantado en `http://localhost:5174`. Backend no requerido.
- [x] 6.2 `browser_navigate` a una ruta protegida SIN sesión → verificar redirección a `/login`. → PASS: `/calendario` redirige a `/login` (URL verificada).
- [ ] 6.3 Con sesión válida → verificar el App Shell completo (sidebar Calendario·Reservas·Métricas, header con "+ Nueva Reserva", outlet) y el regreso a la ruta solicitada. → BLOQUEADO por US-001: sin mecanismo de inyección de sesión en producción. Cubierto por unit tests (RequireAuth.test.tsx, AppShellNavigation.test.tsx).
- [ ] 6.4 Navegar entre secciones → verificar cambio de outlet sin recarga y resaltado del item activo. → BLOQUEADO por US-001.
- [ ] 6.5 Navegar a sección no implementada → verificar placeholder; a ruta inexistente → verificar "no encontrado" dentro del área conservando la nav. → BLOQUEADO por US-001.
- [x] 6.6 Verificar que `/login` NO muestra el chrome del shell (separación de layouts). → PASS: aside ausente, nav[aria-label] ausente; formulario email/password/submit presentes.
- [x] 6.7 Restaurar entorno y cerrar sesiones de navegador. → `context.close()` + `browser.close()` ejecutados. Dev server: proceso background (sin datos persistidos).
- [x] 6.8 Crear report `…/reports/YYYY-MM-DD-step-N+3-e2e-playwright.md`. → `reports/2026-06-27-step-N+3-e2e-playwright.md` creado.

## 7. Docs: actualizar documentación técnica (OBLIGATORIO — step-N+4)

- [x] 7.1 Sincronizar `docs/` afectada. → `docs/architecture.md §2.8`: nota sobre la convención de layouts auth vs app (App Shell como armazón de toda pantalla autenticada; guard `RequireAuth`; `/login` sin chrome). `docs/DESIGN.md §5`: wording actualizado de plan a hecho (tokens cableados, shadcn/ui instalado, AppShell construido).
- [x] 7.2 Actualizar el frontmatter de `user-stories/US-000A-app-shell.md`. → `branch: feature/us-000A-app-shell`, `estado: en-implementacion`. `pr:` sin tocar (aún sin PR).

## 8. Code review (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO)

- [x] 8.1 Ejecutar `code-reviewer` sobre el diff (guardrails: arrow functions, tokens sin hex inline, sin persistencia de token en storage, separación de layouts, cliente generado intacto). → Sin hallazgos bloqueantes ni mayores; un menor no bloqueante (estrechar `value: Session` en US-001).
- [x] 8.2 Dejar informe `…/reports/YYYY-MM-DD-step-review-code-review.md` con la línea literal `Veredicto: APTO`. → `reports/2026-06-27-step-review-code-review.md` → **Veredicto: APTO**.

## 9. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final)

- [x] 9.1 Tras code-review APTO + validación manual, ESPERAR el OK humano antes de archive/PR. → **OK humano recibido 2026-06-27** (aprobado cerrar; E2E 6.3–6.5 diferidos a US-001 aceptados).

## 10. Archivar change + abrir PR (OBLIGATORIO — archive)

- [ ] 10.1 `openspec archive us-000a-app-shell` y abrir PR (solo tras gate final y code-review APTO; el hook `require-code-review` lo bloquea sin APTO).

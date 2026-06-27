# Code Review — us-000a-app-shell (App Shell autenticado)

- **Fecha**: 2026-06-27
- **Revisor**: code-reviewer (solo lectura; no aplica fixes)
- **Branch**: `feature/us-000A-app-shell` vs `master`
- **Worktree**: `aplec-us-000A`
- **Alcance**: frontend-only (Vite + React Router + TS + Tailwind + shadcn). Armazón
  autenticado; sin dominio, sin endpoints, sin entidades de negocio.

## Material revisado

Producción: `apps/web/src/auth/session.tsx`, `apps/web/src/app/{RequireAuth,AppShell,SectionPlaceholder,NotFound}.tsx`,
`apps/web/src/App.tsx`, `apps/web/src/index.css`, `apps/web/tailwind.config.ts`,
`apps/web/components.json`, `apps/web/src/lib/utils.ts`, `apps/web/package.json`.
Tests: 6 suites del shell + tokens. Artefactos: proposal/spec/design/tasks/reports + `docs/DESIGN.md`.

## Verificaciones ejecutadas

- `pnpm --filter @slotify/web test` → **7 suites / 13 tests PASS**.
- `pnpm --filter @slotify/web lint` → **0 errores** (incluye `func-style`/`prefer-arrow-callback`).
- `pnpm --filter @slotify/web typecheck` → **0 errores**.
- `grep localStorage|sessionStorage` en `src/` → solo comentarios doctrinales; **ninguna escritura**.
- `grep hex` en `src/app|src/auth|src/lib` → **ningún hex inline**.
- `grep function ...|any` en código nuevo → **ninguna función declarativa, ningún `any`**.
- `src/api-client/` (cliente generado) → **fuera de git status, intacto**.
- `lucide-react@1.21.0` → confirmado `latest` en npm dist-tags (no typosquat).

## Checklist Slotify

| Regla | Resultado |
|---|---|
| Hexagonal (`domain/` sin infra/framework) | N/A — change UI, sin `domain/`. Sin violación. |
| Bloqueo atómico de fecha (sin Redis/locks) | N/A — UI. Confirmado: sin Redis/lock distribuido. |
| Máquina de estados declarativa | N/A — UI. |
| Multi-tenancy / RLS (`tenant_id` del JWT) | N/A — UI, sin queries. |
| Jobs (estado en fila + barrido) | N/A. |
| Tipos TS strict, sin `any` injustificado | OK (ver M1 sobre `value: unknown`). |
| DTOs `class-validator` / Decimal | N/A — sin DTOs ni importes. |
| Contrato OpenAPI ↔ DTOs; cliente generado no editado a mano | OK — `src/api-client/` intacto. |
| Tests primero (TDD RED→GREEN) | OK — RED documentado en `tasks.md` §2; 13/13 verde. |
| Convenciones de nombres en español | OK. |
| **Arrow functions siempre** | OK — todo el código nuevo usa arrow; lint verde. |
| **Tokens sin hex inline** | OK — componentes consumen clases Tailwind sobre CSS vars; hex solo en `index.css` (definición de tokens). Estados de reserva como tokens nombrados. |
| **Sesión sin persistencia insegura** | OK — `session.tsx` en memoria (context + `useMemo`); cero storage. |
| **Separación de layouts auth vs app** | OK — `App.tsx`: `/login` fuera del árbol `RequireAuth→AppShell`; test `LayoutSeparation` lo verifica. |
| Accesibilidad básica | OK — `nav aria-label`, `aria-current="page"` (NavLink, verificado en test), `aria-hidden` en iconos, `aria-label` en campana, `type="button"`. |

## Hallazgos

### Bloqueantes
- Ninguno.

### Mayores
- Ninguno.

### Menores
- **M1 — `SessionProvider` acepta `value: unknown` y normaliza defensivamente**
  (`apps/web/src/auth/session.tsx:28-49`). Aceptable: confina la laxitud al *borde*
  del provider (entrada inyectada por tests hoy, US-001 mañana) y endurece en
  runtime; `useSession()` devuelve `Session` estricto a los consumidores. El cast
  `as Session` solo valida `status==='authenticated'` y `user` truthy, no la forma
  de `user.nombre` — mitigado porque `AppShell` accede con optional chaining
  (`user?.nombre ?? 'Invitado'`, `inicialDe`). Recomendación (no bloqueante):
  estrechar a `value: Session` cuando US-001 aporte el provider real, o validar la
  forma de `user`. **Veredicto del punto 1 de escrutinio: aceptable.**

### Nits
- **N1 — `LoginPage` usa clases Tailwind nativas (`slate-*`), no los design tokens**
  (`apps/web/src/pages/LoginPage.tsx`). Es scaffolding pre-existente de US-000,
  fuera del set de producción de este change; US-001 es dueña del layout de login.
  Se anota por consistencia de tokens a futuro. Sin acción en US-000A.
- **N2 — Header con título "Panel" / subtítulo "Gestión de reservas" fijos**
  (`AppShell.tsx:72-73`). Placeholder de chrome correcto; el título por-sección
  llega con cada US. **Veredicto del punto 4 de escrutinio: aceptable.**
- **N3 — `lucide-react@^1.21.0`**: confirmado `latest` en npm (`dist-tags.latest=1.21.0`).
  No es typosquat; el `0.4xx` esperado estaba desactualizado. **Punto 3: aceptado.**
- **N4 — shadcn init "ligero"** (solo `components.json` + `cn` + deps base, sin
  componentes generados): coherente con el alcance "solo armazón". **Punto 2: aceptable.**
- **N5 — Warnings de future flags de React Router v7** en la salida de tests:
  cosméticos, sin impacto.

## Veredicto sobre puntos de escrutinio del implementador

1. `value: unknown` + normalización defensiva → **Aceptable** (M1, no bloqueante).
2. shadcn init ligero → **Aceptable** (coherente con alcance).
3. `lucide-react@^1.21.0` → **Aceptado** (verificado `latest` en npm).
4. Título "Panel" como placeholder de chrome → **Aceptable**.

## Conclusión

Change limpio, dentro de alcance, con TDD verificable (RED→GREEN), guardrails de
frontend respetados (arrow functions, tokens sin hex inline, sesión en memoria,
separación de layouts, cliente generado intacto) y lint/typecheck/tests en verde.
Sin hallazgos bloqueantes ni mayores.

Veredicto: APTO

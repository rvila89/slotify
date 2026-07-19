# Code Review — layout-appshell-ancho-titulos-sidebar

**Fecha:** 2026-07-19
**Revisor:** code-reviewer (solo lectura, sin auto-fix)
**Rama:** `feature/layout-appshell-ancho-titulos-sidebar` vs `master`
**Alcance declarado:** SOLO frontend (`apps/web`). Sin contrato/backend/Prisma/BD.
**Diff revisado:** working tree (`git diff master`) — cambios sin commitear.

---

## Resumen del diff

Ficheros de producción (3 + 7 páginas):
- `components/layout/AppShell.tsx` — `useState(false)` → `useState(() => window.innerWidth >= 1024)`.
- `components/layout/SectionPlaceholder.tsx` — nueva prop opcional `titulo?: string` (fallback `titulo ?? nombre`).
- `App.tsx` — `/metricas` pasa `titulo="Panel de métricas"`.
- 7 páginas: quitado `mx-auto w-full max-w-[1200px]` → `flex flex-col gap-6`
  (DashboardPage, ReservasPage, NuevaConsultaPage, FichaConsultaPage,
  HistoricoPage, DetalleHistoricoPage, ColaEsperaPage).
- Títulos `<h1>`: ReservasPage "Reservas"→"Pipeline de solicitudes";
  HistoricoPage "Histórico"→"Reservas archivadas".

Tests (3 nuevos + 5 adaptados):
- Nuevos: `AppShellInitialSidebar.test.tsx` (T1), `TitulosContenedor.test.tsx` (T2),
  `AnchoContenidoFullWidth.test.tsx` (T3).
- Adaptados: `AppShellResponsive`, `AppShellNavigation`, `AppShellCatchAll`,
  `AppShellPlaceholder`, `CerrarSesionUI`.

Fuera de `apps/web` / `openspec/changes`: **nada** (verificado con `git diff --stat`
y `git status`). Backend, Prisma, contrato OpenAPI, SDK `api-client/` y
`navigation.ts` intactos.

---

## Hallazgos por severidad

### Bloqueantes
- Ninguno.

### Altas
- Ninguna.

### Medias
- Ninguna.

### Bajas / Observaciones (no bloqueantes)

- **[responsive · SSR] `window.innerWidth` en el initializer de `useState`.**
  `AppShell.tsx:26` lee `window.innerWidth` en el primer render. Es correcto en
  este proyecto (Vite SPA, sin SSR/SSG), pero acoplaría el componente al DOM si
  algún día se introdujera prerender/SSR (referencia a `window` en render server).
  Se documenta como riesgo latente, no como defecto actual. Los tests mockean
  `window.innerWidth` vía `Object.defineProperty`, confirmando la dependencia.

- **[responsive · alcance conocido] Sin listener de `resize`.**
  El estado del sidebar se fija solo en el primer render; cruzar el breakpoint en
  caliente no lo recalcula. Está explícitamente fuera de alcance en proposal/spec
  y es coherente. Igualmente, abrir el aside de 288px en 390px produce overflow
  horizontal (scrollWidth 598 > 390), documentado en el QA report como limitación
  esperada hasta que exista el drawer móvil (Sheet). No rompe el estado de
  arranque (cerrado en <lg, sin overflow). Se anota para no perder de vista la
  deuda del drawer.

- **[semántica] Métricas usa `<h2>`, no `<h1>`.**
  `SectionPlaceholder` emite `<h2>` "Panel de métricas". La spec-delta admite
  "heading semántico principal" y el título difiere del header ("Métricas"), por
  lo que cumple el escenario. Coherente con que las páginas reales sí usan `<h1>`;
  no se exige unificar en este change.

- **[deuda preexistente] Overflow ~15px en cabecera a 768.**
  Registrado en memoria (`appshell-overflow-768-deuda.md`). El QA confirma que
  NO empeora con este change. Fuera de alcance.

---

## Verificación del checklist

### Guardrails de arquitectura (backend) — N/A justificado
- Hexagonal, bloqueo atómico de fecha, multi-tenancy/RLS, jobs asíncronos,
  Decimal vs Float, DTOs class-validator, contrato OpenAPI: **N/A**. El change no
  toca `apps/api`, `domain/`, Prisma ni el contrato. Verificado: sin cambios fuera
  de `apps/web`.
- **Cliente HTTP generado no editado a mano:** OK — `api-client/` intacto; en los
  tests solo se dobla `apiClient.GET` con `vi.mock`, no se edita el SDK.

### Reglas duras de frontend (CLAUDE.md)
- **Arrow functions, no `function` declarativo:** OK. Todo helper nuevo es arrow
  (`fijarAncho`, `renderApp`, `claseRaiz`, `asideDelShell`, `SectionPlaceholder`).
  Sin `function` declarativo introducido. `pnpm lint` verde (report N+1).
- **`components/` solo `.tsx`:** OK. La prop nueva no metió helpers/tipos/constantes
  sueltos bajo `components/`; el tipo de la prop es inline en la firma de
  `SectionPlaceholder.tsx`. Los nuevos ficheros bajo `components/layout/__tests__/`
  son `.test.tsx`. No se creó ningún `.ts` no-componente.
- **Estructura por dominio / barrels:** OK. Los tests importan features por barrel
  (`@/features/reservas`, `@/features/historico`, `@/features/dashboard`,
  `@/features/auth`). No hay imports a archivos internos de una feature.
- **Responsive (mobile-first, 3 viewports):** OK con observaciones arriba.
  Evidencia aportada en el QA report (390/768/1280) con capturas y mediciones de
  scrollWidth. Estado de arranque correcto: abierto ≥1024, cerrado <1024, sin
  overflow en reposo.
- **Convenciones de nombres en español:** OK (títulos, comentarios y nombres de
  test en español).

### Contrato y navegación
- **`navigation.ts` intacto:** OK — diff vacío; sigue siendo la única fuente de
  verdad del título del header. El header no se tocó (AppShell mantiene
  `resolveSectionMeta`, el `<p>` de título y toda la barra de acciones).

### Coherencia con la spec-delta (5 escenarios)
1. Sidebar arranca abierto en escritorio (≥1024) — OK (T1 + QA 1280).
2. Sidebar arranca cerrado en <1024 — OK (T1 390/768 + QA 390/768).
3. Contenido a ancho completo uniforme sin `max-w`/`mx-auto` — OK (T3 + diff 7
   páginas + QA; Calendario no tocado, ya fluía).
4. Títulos de contenedor distintos del header (Reservas/Histórico/Métricas) — OK
   (T2 + diff + QA). Dashboard/Calendario solo verificados, no modificados.
5. El login no hereda el shell — sin cambios en la separación de layouts;
   `LayoutSeparation.test.tsx` intacto y verde.

### Tests primero y sin pérdida de cobertura
- **TDD:** T1–T3 escritos como RED antes de implementar (report N+1 confirma
  RED→GREEN). Los 3 miden el comportamiento correcto (atributos a11y `aria-hidden`/
  `inert` para el sidebar, `<h1>`/heading para títulos, clase raíz para ancho).
- **Adaptación de tests existentes sin pérdida de cobertura:** OK. El cambio de
  ancho por defecto de jsdom (1024 → sidebar abierto) habría roto los tests que
  asumían "arranca cerrado". Se fija `window.innerWidth=390` en `beforeEach` de los
  5 tests afectados para SEGUIR ejercitando el toggle abrir→cerrar desde estado
  colapsado y la aserción "nav no accesible en reposo". No se eliminó ninguna
  aserción de toggle, inert/aria-hidden ni separación de layouts; solo se
  actualizó el texto esperado del `<h1>` de Reservas ("Pipeline de solicitudes")
  y se restaura `innerWidth` en `afterEach`. Cobertura conservada.
- **Suite:** report N+1 → lint verde, 314/314 tests verdes.

---

## Veredicto: APTO

Cambio de presentación acotado, coherente con proposal y spec-delta, sin tocar
backend/contrato/BD ni `navigation.ts`. Cumple las reglas duras (arrow functions,
`components/` solo `.tsx`, estructura por dominio, responsive con evidencia en 3
viewports). TDD respetado (T1–T3 RED→GREEN) y sin pérdida de cobertura en los
tests adaptados. Hallazgos solo de severidad Baja/observación (dependencia de
`window` sin SSR, ausencia de listener de resize y overflow al abrir en móvil —
todos documentados y fuera de alcance; deuda de 15px a 768 no empeora). No hay
Bloqueantes.

# Report — Step N+1: Unit + Lint

**Change:** `layout-appshell-ancho-titulos-sidebar`
**Fecha:** 2026-07-19
**Rama:** `feature/layout-appshell-ancho-titulos-sidebar`
**Alcance:** SOLO frontend (`apps/web`). Sin backend/Prisma/BD → **no hay estado de BD que verificar** y el **Step N+2 (curl) es N/A** (el change no añade ni modifica endpoints).

## Lint

`pnpm --filter web lint` → **VERDE (exit 0)**.
- 0 errores de reglas duras (`func-style`, `prefer-arrow-callback`, `eslint-plugin-boundaries`, `no-restricted-imports`, `max-lines`, pureza de segmento).
- Únicos avisos: warnings pre-existentes de deprecación del plugin `eslint-plugin-boundaries` (no introducidos por este change).

## Unit tests

`pnpm --filter web test` → **VERDE: 49 archivos, 314 tests passed, 0 failed**.

### Tests nuevos (TDD, RED→GREEN)
| Test | Archivo | Cubre |
|------|---------|-------|
| **T1** | `components/layout/__tests__/AppShellInitialSidebar.test.tsx` (3) | Estado inicial del sidebar por viewport: abierto en ≥1024px; cerrado en 390 y 768. |
| **T2** | `components/layout/__tests__/TitulosContenedor.test.tsx` (3) | `<h1>`/título de contenedor: Reservas "Pipeline de solicitudes", Histórico "Reservas archivadas", Métricas "Panel de métricas". |
| **T3** | `components/layout/__tests__/AnchoContenidoFullWidth.test.tsx` (2) | El contenedor raíz de Dashboard e Histórico ya NO incluye `max-w-[1200px]` ni `mx-auto`. |

### Tests existentes adaptados (sin pérdida de cobertura)
El nuevo estado inicial por viewport (jsdom `innerWidth=1024` por defecto → abierto) rompía tests que asumían "arranca cerrado". Se fijó `window.innerWidth=390` en sus fixtures para conservar la cobertura del toggle abrir/cerrar:
- `AppShellResponsive.test.tsx` (reescrito), `AppShellNavigation.test.tsx`, `AppShellCatchAll.test.tsx`, `AppShellPlaceholder.test.tsx`, `CerrarSesionUI.test.tsx`.
- Aserciones de `<h1>` de Reservas actualizadas a "Pipeline de solicitudes".
- `LayoutSeparation.test.tsx` sin cambios (no dependía del estado del nav).

## Conclusión

Lint verde y suite completa verde (314/314). T1–T3 en verde; ningún test existente roto. Listo para la QA de viewports (Step N+3).

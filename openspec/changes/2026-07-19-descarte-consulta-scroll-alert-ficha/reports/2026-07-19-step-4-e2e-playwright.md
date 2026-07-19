# Step 4 — E2E Playwright (2026-07-19)

Change: `descarte-consulta-scroll-alert-ficha`. Verificación del comportamiento
real en navegador sobre la app del worktree.

## Entorno

- API + Postgres del entorno de desarrollo ya en marcha (`:3000`, `slotify-postgres` healthy).
- Web del **worktree** servida en `:5174` apuntando a esa API.
- Nota: el CORS del API solo admite `WEB_URL` (`:5173`), así que para el E2E se usó
  un **proxy de Vite** temporal (`/api → :3000`, same-origin) en el worktree. Ese
  ajuste de harness se **revirtió** al terminar (no forma parte del change).
- Login gestor `info@masialencis.com`. Navegación SPA por clics (no `goto`, que
  pierde el JWT en memoria).

## Flujo verificado (no destructivo)

Por cada viewport: crear una consulta exploratoria (2a) → abrir su ficha →
desplazar la página hacia abajo → "Marcar como descartada por cliente" →
confirmar. Se observó (a) el alert de éxito (toast) vía `MutationObserver` sobre
`[data-sonner-toast]`, y (b) `window.scrollY` antes/después.

## Resultados — los 3 viewports (390 / 768 / 1280)

| Viewport | Consulta | Alert de éxito capturado | scrollY antes → después |
|----------|----------|--------------------------|--------------------------|
| 1280 (desktop) | 26-0012 | "Consulta 26-0012 marcada como descartada por el cliente." | 898 → **0** |
| 768 (tablet)   | 26-0014 | "Consulta 26-0014 marcada como descartada por el cliente." | 1152 → **0** |
| 390 (móvil)    | 26-0013 | "Consulta 26-0013 marcada como descartada por el cliente." | 5684 → **0** |

- El badge de la ficha pasó a **"Cerrada"** (terminal 2z) en todos los casos.
- `<Toaster/>` (host de Sonner, `region "Notifications alt+T"`) presente en todas
  las capturas de accesibilidad — confirma el fix del montaje.
- Captura móvil: `reports/e2e-screenshots/e2e-descarte-toast-390.png`.
- Caso de error (estado terminal) cubierto por unit test
  (`DescartarConsultaDialog`): sin scroll ni alert de éxito, error inline.

## Observaciones / deuda ajena al change

- **Overflow horizontal en la cabecera del App Shell** en móvil (390) y tablet:
  los elementos que exceden el viewport son del *banner/header* del shell
  (título, botón de notificaciones, CTA "Nueva Reserva"), **ninguno** es del
  `<Toaster/>` (`data-sonner-*`). Es deuda **pre-existente** del app-shell, no
  introducida por este change (que solo añade el montaje del Toaster y el scroll).
- **Datos de prueba en la BD de desarrollo**: se crearon y descartaron 5 consultas
  de QA (26-0010 … 26-0014), todas en estado terminal `2z` (fuera del pipeline,
  inocuas). Creadas a propósito para no mutar leads reales.

Resultado: **APTO** — alert de éxito + desplazamiento al inicio verificados en los 3 viewports.

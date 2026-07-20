# Change: layout-appshell-ancho-titulos-sidebar

> Ajustes de layout del App Shell autenticado. Cambio **SOLO frontend**
> (`apps/web`): NO toca el contrato OpenAPI, el backend NestJS, Prisma ni la BD.
> Refina la presentación de la capability viva `app-shell` sin alterar rutas,
> auth, tokens ni la navegación (`navigation.ts` intacto).
>
> Fuente: capability viva `openspec/specs/app-shell/spec.md` (requisito "Layout
> App Shell autenticado con cabecera, nav lateral y outlet"); `CLAUDE.md §Web
> responsive (regla dura)`, `§Estructura del frontend por dominio`.

## Why

Tres fricciones de layout observadas en el App Shell tras acumular varias US de
contenido (Dashboard, Reservas, Histórico, Calendario, Cola, ficha de detalle):

1. **El menú lateral arranca colapsado también en escritorio.**
   `AppShell.tsx` inicializa el aside con `useState(false)`, de modo que incluso
   con espacio de sobra (≥lg / 1024px) el usuario tiene que abrir el menú a mano
   en cada sesión. En escritorio el sidebar debería estar visible por defecto;
   en móvil (<lg) debe seguir colapsado porque **aún no hay drawer móvil (Sheet)**
   y abrir el aside de 288px sobre un viewport de 390px rompería la regla
   responsive dura de `CLAUDE.md`.

2. **El contenido no ocupa el mismo ancho que el calendario.**
   7 páginas topan su contenido a `max-w-[1200px]` con `mx-auto`, mientras que el
   Calendario fluye a ancho completo dentro del padding del `<main>`. El salto de
   ancho entre secciones es inconsistente y desaprovecha el espacio disponible en
   pantallas anchas (listados, Kanban, tablas de histórico, fichas).

3. **El `<h1>` de la página repite el título del header.**
   El header (topbar) ya muestra un título por ruta derivado de `navigation.ts`
   (`resolveSectionMeta`). En Reservas ("Reservas") e Histórico ("Histórico") el
   `<h1>` interno de la página duplica literalmente ese título, y Métricas
   (placeholder) muestra "Métricas" igual que el header. La duplicación es ruido
   visual y semántico.

## What Changes

Tres ajustes acotados, todos en `apps/web/src`:

1. **Estado inicial del sidebar por viewport.**
   En `apps/web/src/components/layout/AppShell.tsx` (línea 23) cambiar
   `const [open, setOpen] = useState(false)` por inicialización perezosa derivada
   del viewport: `useState(() => window.innerWidth >= 1024)` → **abierto en
   desktop (≥lg/1024px), cerrado en móvil (<lg)**.
   - **Fuera de alcance (NO se implementa):** drawer móvil (Sheet), listener de
     `resize`, ni cambio de estado al cruzar el breakpoint en caliente. El toggle
     manual (botón del logo) sigue funcionando igual.

2. **Ancho del contenido uniforme con el calendario.**
   Igualar TODAS las páginas al comportamiento del calendario: quitar
   `mx-auto w-full max-w-[1200px]` del contenedor raíz y dejar `flex flex-col gap-6`
   (se **conserva** `gap-6`). Aplica a las 7 páginas topadas, incl. formularios y
   fichas de detalle:
   - `features/dashboard/pages/DashboardPage.tsx:26`
   - `features/reservas/pages/ReservasPage/ReservasPage.tsx:42`
   - `features/reservas/pages/NuevaConsulta/NuevaConsultaPage.tsx:98`
   - `features/reservas/pages/FichaConsulta/FichaConsultaPage.tsx:116`
   - `features/historico/pages/HistoricoPage.tsx:61`
   - `features/historico/pages/DetalleHistorico/DetalleHistoricoPage.tsx:43`
   - `features/cola-espera/pages/ColaEsperaPage.tsx:56`
   El Calendario ya fluye a ancho completo → NO se toca.

3. **Título de contenedor distinto del título del header.**
   El header (`navigation.ts`) se **mantiene intacto**. Solo cambia el `<h1>`
   interno de las páginas que hoy lo duplican:
   - Reservas (`ReservasPage.tsx:45`): `"Reservas"` → `"Pipeline de solicitudes"`.
   - Histórico (`HistoricoPage.tsx:64`): `"Histórico"` → `"Reservas archivadas"`.
   - Métricas: hoy es `SectionPlaceholder` con `nombre="Métricas"` desde
     `App.tsx:56`; el título interno debe ser `"Panel de métricas"` (vía prop en
     `App.tsx`, o añadiendo una prop de título al placeholder). Sin crear página
     nueva.
   - Dashboard (`DashboardPage.tsx:29` = "Dashboard operativo") y Calendario
     (`CalendarioPage.tsx:35` = "Calendario de disponibilidad") YA difieren del
     header → **solo verificar, NO cambiar**.
   - `navigation.ts` NO se toca.

## Impact

- **Ámbito:** exclusivamente `apps/web` (frontend SPA).
- **NO afectado:** contrato OpenAPI (`api-spec.yml`), backend NestJS, Prisma, BD,
  SDK generado (`api-client/`), auth, tokens de diseño, `navigation.ts`.
- **Specs afectadas:** capability viva `app-shell` (1 requisito MODIFIED del
  layout + 2 requisitos ADDED de estado inicial del sidebar y de títulos).
- **Archivos de producción tocados:** `AppShell.tsx`, `App.tsx` (y/o
  `SectionPlaceholder.tsx`), y las 7 páginas topadas listadas arriba.
- **Riesgo:** bajo; cambios de presentación sin lógica de negocio ni datos.
- **Verificación:** `pnpm lint` + `pnpm test` en `apps/web` verdes, y QA manual en
  **3 viewports (390 / 768 / 1280)** confirmando: sidebar abierto en 1280 y
  cerrado en 390/768, contenido a ancho completo sin overflow horizontal, y
  `<h1>` distinto del título del header en Reservas, Histórico y Métricas.

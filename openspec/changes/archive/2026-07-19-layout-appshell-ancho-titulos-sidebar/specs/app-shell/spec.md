# Spec Delta — Capability `app-shell`

> Refinamientos de layout del App Shell autenticado (SOLO frontend, `apps/web`).
> MODIFICA el requisito de layout para fijar el estado inicial del menú lateral
> por viewport y el ancho del área de contenido; AÑADE el requisito de que el
> título de contenedor de cada página no duplique el título del header.
>
> Fuente: capability viva `openspec/specs/app-shell/spec.md`; `CLAUDE.md §Web
> responsive (regla dura)`; `apps/web/src/components/layout/{AppShell,navigation}.tsx`.

## MODIFIED Requirements

### Requirement: Layout App Shell autenticado con cabecera, nav lateral y outlet

Para un usuario autenticado, `apps/web` SHALL (DEBE) renderizar el App Shell:
un sidebar de 288px con la marca "Slotify", la navegación lateral
(Calendario · Reservas · Métricas) y una card de usuario, junto a una cabecera
(título + subtítulo, badge, campana y botón "+ Nueva Reserva") y un área de
contenido (outlet) que renderiza la sección activa. El botón "+ Nueva Reserva"
DEBE estar accesible desde toda pantalla autenticada. El layout de autenticación
(login, US-001) NO PUEDE heredar este shell.

El **estado inicial del menú lateral** DEBE derivarse del viewport en el primer
render, con inicialización perezosa: **abierto en escritorio (ancho de viewport
≥ 1024px, corte `lg`) y cerrado en móvil/tablet estrecho (< 1024px)**. El motivo
del corte es que todavía NO existe drawer móvil (Sheet): abrir el aside de 288px
sobre un viewport estrecho (p. ej. 390px) rompería la regla responsive dura de
`CLAUDE.md`. El toggle manual del menú (botón del logo en la cabecera) DEBE seguir
operativo. NO se requiere listener de `resize` ni recalcular el estado al cruzar
el breakpoint en caliente.

El **área de contenido** (outlet) DEBE fluir a **ancho completo** dentro del
padding del `<main>`, sin tope de ancho máximo (`max-w-[1200px]`) ni centrado
(`mx-auto`), de forma **uniforme en todas las secciones** — igual que hoy fluye
el calendario. El App Shell DEBE consumir tokens de diseño vía clases Tailwind,
sin hex inline, y respetar la regla responsive (sin overflow horizontal en 390 /
768 / 1280). (Fuente: `US-000A §Happy Path`, `§Reglas`; `DESIGN.md §4`;
`CLAUDE.md §Web responsive`.)

#### Scenario: Usuario autenticado ve el app shell completo

- **GIVEN** un usuario con sesión válida
- **WHEN** accede a la aplicación
- **THEN** ve la cabecera (marca/título, acción "+ Nueva Reserva" y usuario), la
  navegación lateral con Calendario / Reservas / Métricas, y un área de contenido
  que renderiza la sección activa

#### Scenario: El login no usa el app shell

- **WHEN** se renderiza la pantalla de login (US-001)
- **THEN** usa el layout de autenticación, distinto del App Shell
- **AND** no muestra el sidebar ni la cabecera del shell

#### Scenario: El menú lateral arranca abierto en escritorio

- **GIVEN** un usuario autenticado con un viewport de escritorio (ancho ≥ 1024px)
- **WHEN** se monta el App Shell por primera vez
- **THEN** el menú lateral se renderiza **abierto** (visible, ancho 288px)
- **AND** el contenido queda a la derecha del sidebar sin overflow horizontal

#### Scenario: El menú lateral arranca cerrado en móvil/tablet estrecho

- **GIVEN** un usuario autenticado con un viewport estrecho (ancho < 1024px, p. ej.
  390px o 768px)
- **WHEN** se monta el App Shell por primera vez
- **THEN** el menú lateral se renderiza **cerrado** (colapsado, ancho 0)
- **AND** no hay overflow horizontal ni el aside de 288px superpuesto al contenido

#### Scenario: El área de contenido fluye a ancho completo de forma uniforme

- **GIVEN** el App Shell visible en cualquier sección (Dashboard, Reservas, Nueva
  consulta, Ficha, Histórico, Detalle de histórico, Cola de espera, Calendario)
- **WHEN** se renderiza el contenido de la sección
- **THEN** el contenedor raíz de la página ocupa el ancho disponible dentro del
  padding del `<main>`, sin tope `max-w-[1200px]` ni centrado `mx-auto`
- **AND** el ancho es consistente con el del calendario en todas las secciones
- **AND** no hay overflow horizontal en 390 / 768 / 1280

## ADDED Requirements

### Requirement: Título de contenedor distinto del título del header

El `<h1>` (o heading semántico principal) de cada página SHALL (DEBE) mostrar un
título de contenedor **distinto** del título del header de esa ruta, evitando la
duplicación literal. El header muestra un **título por ruta** derivado de
`navigation.ts` (`resolveSectionMeta`), que es la única fuente de verdad de la
etiqueta de sección y DEBE permanecer intacto. El mapa de títulos internos DEBE
ser:

| Ruta | Título del header (`navigation.ts`) | Título de contenedor (`<h1>` de la página) |
|------|-------------------------------------|--------------------------------------------|
| `/dashboard` | Dashboard | Dashboard operativo |
| `/calendario` | Calendario | Calendario de disponibilidad |
| `/reservas` | Reservas | **Pipeline de solicitudes** |
| `/historico` | Histórico | **Reservas archivadas** |
| `/metricas` | Métricas | **Panel de métricas** |

Dashboard y Calendario YA difieren del header y NO se modifican. Reservas,
Histórico y Métricas SE ajustan (los tres marcados en negrita). Métricas es hoy un
`SectionPlaceholder`; su título de contenedor se aporta por prop desde la ruta, sin
crear página nueva. `navigation.ts` NO se modifica. (Fuente:
`apps/web/src/components/layout/navigation.ts`; páginas listadas en
`proposal.md §What Changes`.)

#### Scenario: Reservas no duplica el título del header

- **GIVEN** el usuario en `/reservas`
- **WHEN** se renderiza la página
- **THEN** el header muestra "Reservas" (de `navigation.ts`)
- **AND** el `<h1>` de la página muestra "Pipeline de solicitudes"

#### Scenario: Histórico no duplica el título del header

- **GIVEN** el usuario en `/historico`
- **WHEN** se renderiza la página
- **THEN** el header muestra "Histórico" (de `navigation.ts`)
- **AND** el `<h1>` de la página muestra "Reservas archivadas"

#### Scenario: Métricas (placeholder) no duplica el título del header

- **GIVEN** el usuario en `/metricas`
- **WHEN** se renderiza el `SectionPlaceholder`
- **THEN** el header muestra "Métricas" (de `navigation.ts`)
- **AND** el título de contenedor del placeholder muestra "Panel de métricas"

#### Scenario: Dashboard y Calendario ya difieren y no cambian

- **GIVEN** el usuario en `/dashboard` o en `/calendario`
- **WHEN** se renderiza la página
- **THEN** el `<h1>` muestra "Dashboard operativo" / "Calendario de disponibilidad"
  respectivamente, ya distinto del título del header ("Dashboard" / "Calendario")
- **AND** ninguno de esos dos `<h1>` se modifica en este change

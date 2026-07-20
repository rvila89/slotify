# app-shell Specification

## Purpose
TBD - created by archiving change us-000a-app-shell. Update Purpose after archive.
## Requirements
### Requirement: Design tokens del sistema de diseño cableados en apps/web
`apps/web` SHALL (DEBE) exponer los design tokens de `DESIGN.md §1–§3` como CSS
custom properties en `index.css` (`:root`) y mapearlos en `tailwind.config.ts`
(`theme.extend.colors`, `fontFamily`, `borderRadius`), cargar las familias
**Epilogue** y **Manrope**, e inicializar **shadcn/ui** (`components.json`)
apuntando a esos tokens. Los colores semánticos de estado de reserva
(`confirmada`, `bloqueada`, `cola`, `disponible`) DEBEN quedar como tokens
nombrados, nunca como hex inline. El App Shell DEBE consumir tokens, no valores
hex sueltos. (Fuente: `DESIGN.md §1, §2, §3, §5`.)

#### Scenario: Tokens disponibles como utilidades de Tailwind
- **WHEN** se inspecciona la configuración de `apps/web`
- **THEN** los colores semánticos (`brand.primary`, `bg.canvas`, `accent.active`,
  `text.primary`, `border.default`, estados de reserva) están definidos como CSS
  custom properties en `:root` y mapeados en `tailwind.config.ts`
- **AND** las familias `Epilogue` y `Manrope` están cargadas y declaradas en
  `fontFamily`

#### Scenario: El shell no usa hex inline
- **WHEN** se inspecciona el código del App Shell
- **THEN** los colores y radios provienen de tokens nombrados (clases Tailwind o
  custom properties)
- **AND** no hay literales hexadecimales de color embebidos en el markup

### Requirement: Rutas protegidas con redirección a login y retorno
Todas las rutas del App Shell SHALL (DEBE) ser rutas protegidas: un guard
comprueba la sesión en memoria. El acceso sin sesión válida (o token expirado)
DEBE redirigir al login (US-001) y, tras autenticar, DEBE regresar a la ruta
originalmente solicitada. Ninguna ruta del shell PUEDE ser accesible sin sesión
válida. (Fuente: `US-000A §Acceso sin sesión`, `§Reglas de Validación`.)

#### Scenario: Usuario sin sesión es redirigido al login
- **GIVEN** un usuario sin sesión válida o con token expirado
- **WHEN** intenta acceder a una ruta protegida del shell
- **THEN** es redirigido al login (US-001)
- **AND** la ruta solicitada se conserva para regresar a ella tras autenticar

#### Scenario: Tras autenticar regresa a la ruta solicitada
- **GIVEN** un usuario redirigido al login desde una ruta protegida
- **WHEN** completa la autenticación con éxito
- **THEN** la aplicación lo lleva a la ruta que solicitó originalmente

### Requirement: Layout App Shell autenticado con cabecera, nav lateral y outlet

Para un usuario autenticado, `apps/web` SHALL (DEBE) renderizar el App Shell:
un sidebar de **12rem (192px)** con la marca "Slotify", la navegación lateral
(Calendario · Reservas · Métricas) y una card de usuario, junto a una cabecera
(título + subtítulo, badge, campana y botón "+ Nueva Reserva") y un área de
contenido (outlet) que renderiza la sección activa. El botón "+ Nueva Reserva"
DEBE estar accesible desde toda pantalla autenticada. El layout de autenticación
(login, US-001) NO PUEDE heredar este shell.

El **estado inicial del menú lateral** DEBE derivarse del viewport en el primer
render, con inicialización perezosa: **abierto en escritorio (ancho de viewport
≥ 1024px, corte `lg`) y cerrado en móvil/tablet estrecho (< 1024px)**. El motivo
del corte es que todavía NO existe drawer móvil (Sheet): abrir el aside de 12rem
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
`CLAUDE.md §Web responsive`; petición de usuario 2026-07-20 — ancho 12rem.)

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
- **THEN** el menú lateral se renderiza **abierto** (visible, ancho 12rem / 192px)
- **AND** el contenido queda a la derecha del sidebar sin overflow horizontal

#### Scenario: El menú lateral arranca cerrado en móvil/tablet estrecho

- **GIVEN** un usuario autenticado con un viewport estrecho (ancho < 1024px, p. ej.
  390px o 768px)
- **WHEN** se monta el App Shell por primera vez
- **THEN** el menú lateral se renderiza **cerrado** (colapsado, ancho 0)
- **AND** no hay overflow horizontal ni el aside de 12rem superpuesto al contenido

#### Scenario: El área de contenido fluye a ancho completo de forma uniforme

- **GIVEN** el App Shell visible en cualquier sección (Dashboard, Reservas, Nueva
  consulta, Ficha, Histórico, Detalle de histórico, Cola de espera, Calendario)
- **WHEN** se renderiza el contenido de la sección
- **THEN** el contenedor raíz de la página ocupa el ancho disponible dentro del
  padding del `<main>`, sin tope `max-w-[1200px]` ni centrado `mx-auto`
- **AND** el ancho es consistente con el del calendario en todas las secciones
- **AND** no hay overflow horizontal en 390 / 768 / 1280

### Requirement: Navegación SPA con item activo resaltado
El App Shell SHALL (DEBE) permitir navegar entre secciones sin recargar la página
(SPA): al seleccionar una sección de la navegación lateral, el área de contenido
cambia a esa ruta y el item correspondiente queda resaltado como activo.
(Fuente: `US-000A §Happy Path` 2º escenario; `DESIGN.md §4 Sidebar`.)

#### Scenario: Cambiar de sección sin recargar y resaltar el activo
- **GIVEN** el App Shell visible
- **WHEN** el usuario selecciona una sección de la navegación lateral
- **THEN** el área de contenido cambia a esa ruta sin recargar la página
- **AND** el item de navegación seleccionado queda resaltado como activo

### Requirement: Placeholder para sección aún no implementada
El App Shell SHALL (DEBE) renderizar un placeholder vacío coherente con el layout
para toda sección cuya funcionalidad todavía no esté construida, sin romper la
navegación. Esto permite que cada historia posterior rellene su slot de forma
incremental. (Fuente: `US-000A §Sección aún no implementada`,
`§Reglas de Validación`.)

#### Scenario: Sección no implementada muestra placeholder
- **GIVEN** una sección cuya funcionalidad aún no está construida
- **WHEN** el usuario la selecciona
- **THEN** el área de contenido muestra un placeholder vacío coherente con el
  layout
- **AND** la navegación lateral y la cabecera siguen operativas

### Requirement: Catch-all de ruta inexistente dentro del shell
El App Shell SHALL (DEBE) incluir una ruta *catch-all* dentro del layout
autenticado: una ruta inexistente muestra un estado "no encontrado" **dentro** del
área de contenido, conservando la navegación lateral y la cabecera.
(Fuente: `US-000A §Ruta inexistente`.)

#### Scenario: Ruta inexistente muestra "no encontrado" conservando la nav
- **GIVEN** el usuario autenticado
- **WHEN** navega a una ruta que no existe dentro del shell
- **THEN** el área de contenido muestra un estado "no encontrado"
- **AND** la navegación lateral y la cabecera permanecen visibles

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

### Requirement: Solo el último toast permanece visible a cada acción

El sistema global de notificaciones (toasts, Sonner) SHALL (DEBE) mostrar
**únicamente el último mensaje** ante cada nueva acción del usuario: el
`<Toaster/>` se monta una única vez en `App` y, antes de emitir un toast nuevo,
el sistema DEBE descartar los toasts
previos, de modo que nunca se apilen mensajes viejos sobre el más reciente y no
se confunda al usuario. Este comportamiento SHALL (DEBE) implementarse mediante
un helper compartido `apps/web/src/lib/notify.ts` que envuelve `toast` de Sonner
y ejecuta `toast.dismiss()` inmediatamente antes de cada `toast.*()`, cubriendo
las cuatro variantes (`success`, `error`, `warning`, `info`) y preservando el
tipo, el mensaje, la descripción y demás opciones de cada llamada. Todos los
disparadores de toast de `apps/web` DEBEN usar `notify.*()` en lugar de llamar a
`toast.*()` directamente (incluido el helper de facturación
`toastLiquidacion.ts`, que reusa `notify`). La configuración del `<Toaster/>`
(posición `bottom-right`, colores por tokens, `closeButton`) NO cambia. (Fuente:
petición de usuario 2026-07-20; `apps/web/src/components/ui/sonner.tsx`;
`apps/web/src/App.tsx`; patrón `features/facturacion/lib/toastLiquidacion.ts`.)

#### Scenario: Dos acciones consecutivas dejan solo el último toast

- **GIVEN** el usuario autenticado que acaba de ejecutar una acción y ve su toast
  (p. ej. "Consulta descartada correctamente")
- **WHEN** ejecuta una segunda acción que emite otro toast antes de que el primero
  desaparezca
- **THEN** el primer toast se descarta y **solo** el toast de la segunda acción
  queda visible
- **AND** no quedan mensajes apilados de acciones anteriores

#### Scenario: El tipo y el estilo del toast se preservan

- **GIVEN** una acción que emite un toast de error, éxito, advertencia o info vía
  `notify.*()`
- **WHEN** se muestra el toast
- **THEN** conserva su tipo (success / error / warning / info) con el estilo del
  `<Toaster/>` (posición `bottom-right`, colores por tokens, `closeButton`), que
  no cambia
- **AND** el mensaje y la descripción de la llamada se muestran íntegros


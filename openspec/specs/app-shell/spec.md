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
un sidebar de 288px con la marca "Slotify", la navegación lateral
(Calendario · Reservas · Métricas) y una card de usuario, junto a una cabecera
(título + subtítulo, badge, campana y botón "+ Nueva Reserva") y un área de
contenido (outlet) que renderiza la sección activa. El botón "+ Nueva Reserva"
DEBE estar accesible desde toda pantalla autenticada. El layout de autenticación
(login, US-001) NO PUEDE heredar este shell. (Fuente: `US-000A §Happy Path`,
`§Reglas`; `DESIGN.md §4`.)

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


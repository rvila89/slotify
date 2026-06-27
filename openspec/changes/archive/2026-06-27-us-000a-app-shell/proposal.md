# Change: us-000a-app-shell

## Why

US-000A es una **Technical Foundation Story** de UI: el armazón de navegación
autenticada sobre el que se montará el 100% de las pantallas posteriores
(Calendario US-039, Reservas US-042, Métricas US-044, Nueva Reserva US-014, …).
Sin este shell cada historia redefiniría navegación, layout y guard de sesión.

No tiene UC funcional asociado (es prerrequisito transversal de presentación,
análoga a US-000). Resuelve **D2** (cero estructura/visibilidad del trabajo
diario) de forma transversal: fija una sola vez la superficie autenticada y
desbloquea el desarrollo en paralelo de todas las secciones.
(Fuente: `US-000A §Historia`, `§Contexto de Negocio`, `§Impacto de Negocio`.)

Además, US-000A cablea **por primera vez** los design tokens del sistema de
diseño: hoy `apps/web/tailwind.config.ts` tiene `extend: {}` y `index.css` solo
los `@tailwind`, y shadcn/ui no está inicializado.
(Fuente: `DESIGN.md §5 Puente a implementación`.)

## What Changes

> Alcance estricto: **solo armazón**. NO entrega el contenido funcional de cada
> sección (calendario que pinta reservas, listados, métricas) ni toca entidades
> de dominio. (Fuente: `US-000A §Notas de alcance`, `§Reglas de Validación`.)

- **Cableado de design tokens** en `apps/web`: tokens de `DESIGN.md §1–§3` como
  CSS custom properties en `index.css` (`:root`), mapeados en `tailwind.config.ts`
  (`colors`, `fontFamily`, `borderRadius`); carga de fuentes **Epilogue** +
  **Manrope**; inicialización de **shadcn/ui** (`components.json`) apuntando a esos
  tokens. Los colores semánticos de estado quedan como tokens nombrados (no hex
  inline) para que US-039 y demás los reutilicen.
  (Fuente: `DESIGN.md §1, §2, §3, §5`.)
- **Layout autenticado `AppShell`**: sidebar 288px (marca "Slotify" + nav
  Calendario·Reservas·Métricas + card de usuario) y header (título + subtítulo,
  badge, campana, botón "+ Nueva Reserva") con un content outlet que renderiza la
  ruta activa. (Fuente: `US-000A §Happy Path`, `DESIGN.md §4`.)
- **Rutas protegidas + guard de sesión**: todas las rutas del shell exigen sesión
  válida (en memoria, sin `localStorage`); el acceso sin sesión redirige al login
  (US-001) y, tras autenticar, regresa a la ruta solicitada.
  (Fuente: `US-000A §Acceso sin sesión`, `§Reglas de Validación`.)
- **Navegación SPA con item activo**: seleccionar una sección cambia la ruta sin
  recargar y resalta el item activo. (Fuente: `US-000A §Happy Path` 2º escenario.)
- **Placeholder de sección no implementada**: cada slot aún no construido muestra
  un placeholder vacío coherente con el layout, sin romper la navegación.
  (Fuente: `US-000A §Sección aún no implementada`.)
- **Catch-all "no encontrado"**: una ruta inexistente dentro del shell muestra un
  estado "no encontrado" *dentro* del área de contenido, conservando la
  navegación. (Fuente: `US-000A §Ruta inexistente`.)
- **Separación de layouts auth vs app**: el layout de login (US-001) NO hereda
  este shell. (Fuente: `US-000A §Reglas`, `§Reglas de Validación`.)

## Impact

- Specs afectadas: **nueva capability `app-shell`** (armazón de presentación
  autenticado del frontend). No modifica la capability `foundation`.
- Código afectado (implementación posterior, fuera de este change de spec):
  `apps/web/src/index.css`, `apps/web/tailwind.config.ts`,
  `apps/web/components.json`, `apps/web/src/app/**` (rutas + layout `AppShell` +
  guard + placeholders + catch-all), carga de fuentes.
- Trazabilidad: **US-000A**; sin UC funcional (habilita US-039, US-042, US-044,
  US-014, … toda pantalla autenticada).
- Dependencias: US-000 (scaffolding `apps/web` operativo); el guard se apoya en la
  sesión en memoria establecida por US-001 (login), que evoluciona en su propia US.
- Fuera de alcance: contenido funcional de cada sección, layout/lógica de login
  (US-001), cualquier lectura/escritura de entidades de dominio.

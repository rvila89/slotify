# Design — us-000a-app-shell

Decisiones técnicas no triviales del armazón. La implementación la ejecuta el
`frontend-developer` tras el gate humano. (Stack: `architecture.md §2`.)

## 1. Separación de layouts: auth vs app

Dos árboles de rutas independientes bajo React Router:

- **Layout auth** (público): `/login` y futuras pantallas de autenticación
  (US-001). NO monta el `AppShell`.
- **Layout app** (`AppShell`, protegido): envuelto por el guard de sesión; todas
  sus rutas hijas renderizan en el content `<Outlet/>` del shell.

Motivo: la regla dura de `US-000A §Reglas` ("el layout de login no hereda este
shell"). Mantener árboles separados evita fugas de chrome (sidebar/header) en la
pantalla de login y permite que US-001 evolucione su layout sin tocar el shell.

## 2. Guard de sesión y retorno a la ruta solicitada

- El guard lee la sesión **en memoria** (sin `localStorage`/`sessionStorage`,
  coherente con la capability `foundation` y `architecture.md`).
- Sin sesión → redirige a `/login` preservando la ruta solicitada (p. ej. vía
  `state.from` o `?redirect=`), para regresar a ella tras autenticar.
- US-000A entrega el **mecanismo** de guard y redirección; la lógica real de
  autenticación (validar credenciales, poblar la sesión) es de US-001. Para no
  bloquear el desarrollo en paralelo, el guard se diseña contra una abstracción de
  sesión (hook/contexto) cuyo proveedor real llega con US-001.

## 3. Cableado de design tokens (orden de implementación)

Plan de `DESIGN.md §5`, en este orden para que cada paso construya sobre el previo:

1. CSS custom properties en `index.css` (`:root`) con los primitivos y semánticos
   de `DESIGN.md §1`, más spacing/radios de `§3`.
2. Mapeo en `tailwind.config.ts` (`theme.extend.colors`, `fontFamily`,
   `borderRadius`) referenciando las custom properties.
3. Carga de fuentes Epilogue + Manrope (Google Fonts o self-host).
4. `shadcn/ui init` (`components.json`) apuntando a esos tokens.
5. `AppShell` consumiendo tokens (clases Tailwind), nunca hex inline.

Los colores semánticos de **estado de reserva** quedan como tokens nombrados para
que US-039 (calendario) y listados los reutilicen sin redefinir hex.

## 4. Rutas del shell (MVP)

Items de navegación del MVP: **Calendario · Reservas · Métricas**
(`DESIGN.md §4 Sidebar`). Cada uno mapea a una ruta hija del layout app que, en
US-000A, renderiza un **placeholder** (su contenido funcional llega en su US:
Calendario US-039, Reservas US-042, Métricas US-044). Una ruta *catch-all* dentro
del layout app muestra "no encontrado" conservando el chrome.

## 5. Fuera de alcance (anti-scope)

- Contenido funcional de cualquier sección (no se pinta calendario, listado ni
  métricas reales).
- Lógica/markup de login (US-001).
- Cualquier entidad de dominio, llamada a API o estado de datos de negocio.
- Responsive/mobile fino más allá de lo necesario para no romper el layout base
  (el diseño de referencia es desktop; el detalle se aborda por pantalla en su US).

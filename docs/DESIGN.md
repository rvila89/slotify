# DESIGN.md — Sistema de Diseño Slotify

> Fuente de verdad de tokens, tipografía y anatomía del App Shell.
> Extraído del diseño de Figma `Slotify` (file `rBCYMkAoQQRVnWhOxXatio`), frame
> **"Calendario - Masia l'Encís"** (`node 0:86`), migrado desde Google Stitch.
> Origen de cada valor: nodos `0:87` (sidebar), `0:117` (header), `0:136` (leyenda de estados).

Paleta cálida mediterránea (terracota + crema + marrón), coherente con el caso piloto *Masia l'Encís*.

---

## 1. Design tokens — Color

### Primitivos (raw)

| Token | HEX | Notas |
|-------|-----|-------|
| `--brand-700` | `#8d4d39` | Terracota de marca. Wordmark, botón primario, dot de badge |
| `--terracotta-400` | `#d98b74` | Salmón. Avatar y estado *confirmada* |
| `--taupe-500` | `#86736e` | Estado *bloqueada* |
| `--taupe-300` | `#ad9c91` | Estado *cola* |
| `--cream-50` | `#fcf9f4` | Fondo canvas (sidebar / header) |
| `--cream-100` | `#f6f3ee` | Superficie elevada suave (cards, leyenda) |
| `--cream-150` | `#f0ede9` | Superficie sutil (badge) |
| `--sand-200` | `#eae1d6` | Acento de item de navegación activo |
| `--border-300` | `#d8c2bc` | Bordes y divisores |
| `--ink-900` | `#1c1c19` | Texto primario / títulos |
| `--ink-700` | `#53433f` | Texto secundario / labels |
| `--ink-500` | `#69645b` | Texto atenuado (nav activa) |
| `--white` | `#ffffff` | Texto sobre primario |

### Semánticos (uso)

| Token semántico | Alias de | Uso |
|-----------------|----------|-----|
| `color.brand.primary` | `brand-700` | Marca, CTA primario |
| `color.primary.foreground` | `white` | Texto sobre primario |
| `color.bg.canvas` | `cream-50` | Fondo de app (sidebar + header con blur) |
| `color.surface.muted` | `cream-100` | Card usuario, contenedor leyenda |
| `color.surface.subtle` | `cream-150` | Badge informativo |
| `color.accent.active` | `sand-200` | Item de nav seleccionado |
| `color.border.default` | `border-300` | Bordes, divisores (a `0.3`–`0.5` alpha en cards) |
| `color.text.primary` | `ink-900` | Títulos, nombre de usuario |
| `color.text.secondary` | `ink-700` | Subtítulos, nav inactiva |
| `color.text.muted` | `ink-500` | Texto de nav activa |

### Colores semánticos de estado de reserva (transversales a todo Slotify)

> Alineados con la máquina de estados. Reutilizar SIEMPRE estos tokens para pintar
> estados de reserva/fecha (calendario US-039, listados, badges, etc.).

| Estado | Token | HEX | Tratamiento |
|--------|-------|-----|-------------|
| Confirmada | `color.state.confirmada` | `#d98b74` | Relleno sólido |
| Bloqueada | `color.state.bloqueada` | `#86736e` | Relleno sólido |
| En cola | `color.state.cola` | `#ad9c91` | Relleno sólido |
| Disponible | `color.state.disponible` | — | Transparente + borde `border-300` |

---

## 2. Design tokens — Tipografía

Dos familias. **Cárgalas en `apps/web`** (Google Fonts o self-host).

| Rol | Familia | Pesos usados |
|-----|---------|--------------|
| Display / Headings | **Epilogue** | Bold (700), Medium (500) |
| UI / Body | **Manrope** | Regular (400), Medium (500), SemiBold (600) |

### Escala tipográfica (observada en el diseño)

| Token | Familia / Peso | Size / Line | Tracking | Uso |
|-------|----------------|-------------|----------|-----|
| `type.brand` | Epilogue Bold | 32 / 40 | -0.8px | Wordmark "Slotify" |
| `type.h2` | Epilogue Medium | 24 / 32 | 0 | Título de página ("Masia l'Encís") |
| `type.h3` | Epilogue Medium | 24 / 32 | 0 | Encabezado de sección ("Mayo 2024") |
| `type.body` | Manrope Regular | 16 / 24 | 0 | Texto botón / cuerpo |
| `type.label` | Manrope SemiBold | 14 / 20 | 0.14px | Items de nav, nombre usuario |
| `type.caption` | Manrope Medium | 12 / 16 | 0.48px | Subtítulos, badges, leyenda |
| `type.overline` | Manrope Regular | 10 / 15 | 0.5px (UPPER) | "PREMIUM PLAN" |

---

## 3. Design tokens — Spacing, radios, bordes

| Token | Valor |
|-------|-------|
| `space.2` | 8px |
| `space.3` | 12px |
| `space.4` | 16px |
| `space.6` | 24px |
| `space.8` | 32px |
| `radius.md` | 12px (card usuario) |
| `radius.lg` | 16px (cards, contenedor leyenda) |
| `radius.full` | 9999px (pills de nav, badge, avatar, botones redondos) |
| `border.width` | 1px |

> Escala base de 8px. Paddings finos observados (9/10/13/17px) son ajustes ópticos
> de Stitch; normalízalos a la escala (`space.*`) salvo necesidad visual.

---

## 4. Anatomía del App Shell (US-000A)

Layout de dos columnas, **solo para usuarios autenticados** (el login NO usa este shell).

```
┌─────────────┬───────────────────────────────────────────────┐
│  SIDEBAR    │  HEADER (Top App Bar)                          │
│  192px      │  título + subtítulo  ·  badge · 🔔 · [+ Nueva] │
│             ├───────────────────────────────────────────────┤
│  Slotify    │                                                │
│             │   CONTENT OUTLET                               │
│  ▸ Calendario (activo)                                       │
│  ▸ Reservas │   (cada US posterior rellena su slot;          │
│  ▸ Métricas │    placeholder vacío si no implementada;       │
│             │    catch-all "no encontrado" dentro del área)  │
│             │                                                │
│  [👤 user]  │                                                │
└─────────────┴───────────────────────────────────────────────┘
```

### Sidebar (`Aside - Sidebar Navigation`, 192px / 12rem)
- Fondo `surface.canvas` (`#fcf9f4`), borde derecho `border.default`.
- **Marca**: "Slotify" en `type.brand`, color `brand.primary`. Padding 32px.
- **Nav** (px 16, gap 8): cada item es pill (`radius.full`), px16 py12, icono 18–20px + label `type.label`.
  - Activo: fondo `accent.active` (`#eae1d6`), texto `text.muted`.
  - Inactivo: sin fondo, texto `text.secondary`.
  - Items MVP: **Calendario · Reservas · Métricas**.
- **Card de usuario** (abajo, padding 24): fondo `surface.muted`, borde `border` @0.3, `radius.md`, padding 13. Avatar 40px (`radius.full`, fondo `terracotta-400`) + nombre (`type.label`, `text.primary`) + plan (`type.overline`, `text.secondary`).

### Header (`Header - Top App Bar`, alto 80)
- Fondo `bg.canvas` @0.8 + `backdrop-blur 6px`, borde inferior `border.default`, padding-x 32.
- **Izquierda**: título `type.h2` (`text.primary`) + subtítulo `type.caption` (`text.secondary`).
- **Derecha** (gap 16): badge "N reservas hoy" (fondo `surface.subtle`, borde @0.5, pill, dot `brand.primary`) · botón campana 48px redondo · **botón "+ Nueva Reserva"** (fondo `brand.primary`, texto `white` `type.body`, pill, px24 py10) — accesible desde TODA pantalla autenticada.

### Content outlet
- Renderiza la ruta activa (SPA, sin recarga). Estados a soportar por US-000A:
  - **Sección no implementada** → placeholder vacío coherente con el layout.
  - **Ruta inexistente** → estado "no encontrado" *dentro* del área, conservando nav.
  - **Sin sesión** → redirige a login (US-001) y vuelve a la ruta solicitada tras autenticar.

### Responsive del App Shell (obligatorio)

> **Web responsive es regla dura** (ver [CLAUDE.md](../CLAUDE.md) y [frontend-standards.md](./frontend-standards.md)). El frame de Figma del shell (`0:86`) **solo existe en desktop** (sidebar nombrado *"Aside - Sidebar Navigation (Desktop)"*); **no hay diseño móvil en Figma**, así que la adaptación se diseña con los tokens de este documento.

Breakpoints (defaults de Tailwind): `sm 640 · md 768 · lg 1024 · xl 1280`. Corte mobile↔desktop del shell en **`lg` (1024px)**.

- **Desktop (`≥ lg`)**: layout de dos columnas tal cual arriba (sidebar fijo 192px / 12rem + header + content).
- **Móvil / tablet (`< lg`)**: el **sidebar se oculta** (`hidden lg:flex`) y su contenido (marca + nav + card de usuario) se sirve en un **drawer off-canvas** (`Sheet` de shadcn / Radix Dialog, lado izquierdo) que abre un **botón hamburguesa** en el header (`lg:hidden`, con `aria-label`/`aria-expanded`/`aria-controls`). El drawer cierra al navegar, con Escape o al pulsar el overlay (focus-trap de Radix).
- **Header compacto en `< lg`**: el badge "N reservas hoy" se oculta en móvil (`hidden md:flex`); el botón **"+ Nueva Reserva"** colapsa a solo-icono (`<span className="hidden sm:inline">Nueva Reserva</span>`). Padding-x `px-4 lg:px-8`.
- **Content**: padding `p-4 md:p-6 lg:p-8`; sin overflow horizontal.
- **Verificación**: E2E en 390 / 768 / 1280 (móvil sin sidebar visible hasta abrir hamburguesa; desktop con sidebar fijo y sin hamburguesa).

---

## 5. Implementación en apps/web

> Implementado en US-000A (`feature/us-000A-app-shell`). Los tokens están cableados
> en `apps/web` y son realidad, no plan.

**Realizado en US-000A:**
1. Tokens definidos como **CSS custom properties** en `apps/web/src/index.css` (`:root`), incluyendo los colores semánticos de estado de reserva.
2. Mapeados en `tailwind.config.ts` (`theme.extend.colors`, `fontFamily`, `borderRadius`) vía `var(--…)`.
3. Fuentes **Epilogue** + **Manrope** cargadas (Google Fonts `@import`).
4. **shadcn/ui** inicializado (`components.json` + `src/lib/utils.ts` con `cn`; deps `clsx`/`tailwind-merge`/`cva`/`lucide-react`).
5. `AppShell` (layout + nav + outlet) construido consumiendo tokens, sin hex sueltos.

Los colores semánticos de estado quedan como tokens nombrados (no hex inline)
para que US-039 (calendario) y demás los reutilicen.

---

## 6. Estado en Figma y migración

**Este documento (`DESIGN.md`) es la fuente de verdad de los tokens**, no las Figma Variables.

Decisión: NO se crean Figma Variables. El plan Figma es **Pro con seat Dev**, que permite
*leer* diseños vía MCP (lo que necesita el `frontend-developer` para convertir diseño→código)
pero NO *escribir/editar* (crear variables requiere seat Full). El flujo de código consume los
valores leídos + este `DESIGN.md`, así que las Variables no aportan y no se persiguen.

Migración del resto de frames: **just-in-time por US** (el `frontend-developer` los lee del
Figma cuando toca cada historia). Mapeo frame → US:

| Frame | node-id | US |
|-------|---------|----|
| Login (desktop / mobile) | `0:3` / `0:304` | US-001 |
| Calendario (funcional) | `0:86` | US-039 |
| Nueva Reserva | `0:382` | US-014 |
| Reservas (flow + listado) | `0:523` | US-042 |
| Dashboard | `0:742` | US-044 |

> File key Figma: `rBCYMkAoQQRVnWhOxXatio`.

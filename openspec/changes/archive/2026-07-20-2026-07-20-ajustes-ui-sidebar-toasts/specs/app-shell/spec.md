# Spec Delta — Capability `app-shell`

> Dos ajustes UI menores sobre el App Shell de `apps/web`, sin impacto de
> dominio ni de contrato: (1) el menú lateral abierto pasa de **288px a 12rem
> (192px)** en escritorio; (2) el sistema global de toasts (Sonner, montado en
> `App`) deja **solo el último mensaje** visible a cada acción. Fuente: petición
> de usuario; `apps/web/src/components/layout/AppShell.tsx`;
> `apps/web/src/components/ui/sonner.tsx` + `App.tsx`;
> `apps/web/src/features/facturacion/lib/toastLiquidacion.ts`.

## MODIFIED Requirements

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

## ADDED Requirements

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

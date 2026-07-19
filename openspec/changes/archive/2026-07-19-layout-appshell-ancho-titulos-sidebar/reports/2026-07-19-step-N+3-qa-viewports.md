# QA Report — Step N+3: E2E Playwright · Viewports
**Change:** `layout-appshell-ancho-titulos-sidebar`
**Fecha:** 2026-07-19
**Agente:** qa-verifier
**Step N+2 (curl):** N/A — change exclusivamente frontend, sin endpoints nuevos ni modificados.

---

## Entorno

| Componente | URL | Estado |
|-----------|-----|--------|
| Frontend (Vite + React) | http://localhost:5173 | OK — responde 200 |
| Backend (NestJS) | http://localhost:3000 | OK — en uso por la SPA |
| Tenant de prueba | info@masialencis.com / Masia l'Encís | Login OK |

Login verificado en los 3 viewports mediante navegación a `/login`, relleno de formulario y click en "Entrar a Slotify". En todos los casos el redirect post-login fue a `/dashboard` (o a la última ruta intentada).

**Gotcha aplicado:** tras el login, toda la navegación se realizó mediante clics en links del UI o en el botón hamburguesa; no se usó `browser_navigate` a rutas internas para evitar pérdida del JWT en memoria.

---

## Tabla de resultados: viewport × comprobación

| Comprobación | 1280×800 | 768×1024 | 390×844 |
|---|---|---|---|
| Estado inicial sidebar (arranque) | PASS — abierto, aside 288px | PASS — cerrado, aside 0px | PASS — cerrado, aside 0px |
| Sin overflow horizontal (sidebar cerrado/estado normal) | PASS — scrollWidth 1265 ≤ 1280 | PASS — scrollWidth 753 ≤ 768 | PASS — scrollWidth 375 ≤ 390 |
| Deuda 15px en cabecera 768 (preexistente) | — | ANOTADA — no empeora (ver abajo) | — |
| Ancho contenido full-width (sin max-w cap) | PASS — sin clases max-w en contenedores | PASS — main ocupa ancho disponible | PASS — main 374px (~total viewport) |
| Reservas: header "Reservas" / h1 "Pipeline de solicitudes" | PASS | PASS | PASS |
| Histórico: header "Histórico" / h1 "Reservas archivadas" | PASS | PASS | PASS |
| Métricas: header "Métricas" / heading "Panel de métricas" | PASS | PASS | PASS |
| Dashboard: header "Dashboard" / h1 "Dashboard operativo" | PASS | PASS | PASS |
| Toggle manual sidebar (abre/cierra) | PASS (verificado en 390) | PASS | PASS |

---

## Evidencia por viewport

### Viewport 1280×800 — Escritorio

**Estado inicial del sidebar:**
- `aside.getBoundingClientRect().width = 288` — abierto en primer render.
- Botón con `aria-label="Cerrar navegación"` / `aria-expanded="true"` visible.
- `scrollWidth=1265, innerWidth=1280` → overflowOk: true.

**Ancho de contenido:**
- Reservas: `mainWidth=976px`, `mainFirstChildWidth=912px`, clase `flex flex-col gap-6` — sin `max-w`.
- Calendario (referencia): `mainWidth=992px`, `mainFirstChildWidth=928px`, clase `flex flex-col gap-4` — sin `max-w`.
- Diferencia ~16px entre secciones atribuible a padding de contenedor propio de cada página; ambas fluyen a ancho completo sin tope.

**Títulos observados (1280):**

| Ruta | Header (primer `<p>` en `<header>`) | `<h1>` de la página |
|------|-------------------------------------|---------------------|
| /dashboard | Dashboard | Dashboard operativo |
| /reservas | Reservas | Pipeline de solicitudes |
| /historico | Histórico | Reservas archivadas |
| /metricas | Métricas | — (SectionPlaceholder con `<h2>` "Panel de métricas") |
| /calendario | Calendario | Calendario de disponibilidad |

Nota sobre Métricas: el `SectionPlaceholder` no emite `<h1>` sino `<h2>`. La spec indica "heading semántico principal" y especifica que "Métricas es hoy un `SectionPlaceholder`; su título de contenedor se aporta por prop desde la ruta, sin crear página nueva." El `<h2>` "Panel de métricas" cumple la distinción respecto al header "Métricas" y es coherente con la implementación de placeholder. Marcado PASS.

**Capturas:** `1280-dashboard-initial.png`, `1280-reservas-titles.png`, `1280-historico-titles.png`, `1280-metricas-titles.png`, `1280-calendario.png`.

---

### Viewport 768×1024 — Tablet

**Estado inicial del sidebar:**
- `aside.getBoundingClientRect().width = 0`, `aside.offsetWidth = 0` — cerrado en primer render.
- `getComputedStyle(aside).overflow = "hidden"` — el aside existe en el DOM pero colapsado.
- `scrollWidth=753, innerWidth=768` → overflowOk: true.
- Botón con `aria-label="Abrir navegación"` / `aria-expanded="false"` visible en cabecera.

**Deuda preexistente (appshell-overflow-768-deuda.md):**
- En el Dashboard con sidebar cerrado: `htmlScrollWidth=753`, `htmlClientWidth=753`, `innerWidth=768`. Diferencia de 15px entre `innerWidth` y `htmlScrollWidth` — coincide con la deuda conocida. No hay elementos con `rect.right > innerWidth+1`. El contenido del documento tiene 753px de ancho; el restante de 15px es espacio vacío (posible scrollbar reservado o margen del shell).
- En Histórico con sidebar abierto: `htmlScrollWidth=768 = innerWidth=768`, `headerRight=768` — sin overflow, sin overflowing elements.
- **Conclusión: la deuda de 15px se mantiene igual que antes del change, NO empeora.**

**Toggle hamburguesa en 768:** al pulsar el botón "Abrir navegación", `aside.width` pasa de 0 a 288px y `aria-label` cambia a "Cerrar navegación" / `aria-expanded="true"`. Con el aside abierto a 288px en 768: `scrollWidth=768 = innerWidth=768` (no overflow, el aside desplaza el contenido sin romper el layout a este ancho).

**Títulos observados (768):**

| Ruta | Header | Heading de contenedor |
|------|--------|-----------------------|
| /reservas | Reservas | Pipeline de solicitudes (`<h1>`) |
| /historico | Histórico | Reservas archivadas (`<h1>`) |
| /metricas | Métricas | Panel de métricas (`<h2>`) |

**Capturas:** `768-dashboard-initial-closed.png`, `768-reservas-titles.png`, `768-historico-sidebar-open.png`, `768-historico-overflow-check.png`.

---

### Viewport 390×844 — Móvil

**Estado inicial del sidebar:**
- `aside.getBoundingClientRect().width = 0`, `aside.offsetWidth = 0` — cerrado en primer render.
- `scrollWidth=375, innerWidth=390` → overflowOk: true.
- Botón con `aria-label="Abrir navegación"` / `aria-expanded="false"` visible en cabecera.

**Comportamiento del toggle manual (punto 5 de la spec):**
- Al pulsar "Abrir navegación": `aside.width = 288px`, botón cambia a "Cerrar navegación" / `aria-expanded="true"`.
- Con sidebar abierto en 390: `scrollWidth=598 > innerWidth=390` → overflow.
  - **Este es el comportamiento esperado y documentado.** La spec indica explícitamente: "abrir el aside de 288px sobre un viewport estrecho (p. ej. 390px) rompería la regla responsive dura [...] todavía NO existe drawer móvil (Sheet)". El toggle funciona; el overflow al abrirlo en móvil es una limitación de diseño conocida pendiente de drawer.
- Al pulsar "Cerrar navegación": `aside.width = 0`, `scrollWidth=375 ≤ 390` → sin overflow.

**Ancho de contenido (sidebar cerrado):**
- Reservas: `mainWidth=374px` (~375px disponibles).
- Métricas: `mainWidth=374px`.
- El contenido ocupa el ancho completo del viewport sin sidebar, sin `max-w` cap.

**Títulos observados (390):**

| Ruta | Header | Heading de contenedor |
|------|--------|-----------------------|
| /dashboard | Dashboard | Dashboard operativo (`<h1>`) |
| /reservas | Reservas | Pipeline de solicitudes (`<h1>`) |
| /historico | Histórico | Reservas archivadas (`<h1>`) |
| /metricas | Métricas | Panel de métricas (`<h2>`) |

**Capturas:** `390-dashboard-initial-closed.png`, `390-dashboard-sidebar-open-overflow.png`, `390-reservas-sidebar-closed.png`, `390-metricas-sidebar-closed.png`.

---

## Resumen de scrollWidth por viewport (sidebar en estado normal de arranque)

| Viewport | scrollWidth | innerWidth | Ratio | Resultado |
|----------|-------------|------------|-------|-----------|
| 1280×800 (sidebar abierto) | 1265 | 1280 | 98.8% | PASS |
| 768×1024 (sidebar cerrado) | 753 | 768 | 98.0% | PASS — deuda 15px preexistente, no empeora |
| 390×844 (sidebar cerrado) | 375 | 390 | 96.2% | PASS |

---

## Anomalías y observaciones

1. **Deuda 15px a 768 (preexistente):** `htmlScrollWidth=753` vs `innerWidth=768` en el Dashboard con sidebar cerrado. Ningún elemento sobrepasa el viewport; la diferencia es espacio vacío del shell. Anotado en `appshell-overflow-768-deuda.md`. Este change NO lo empeora.

2. **Overflow al abrir sidebar en móvil 390:** comportamiento esperado según la spec del change (no existe drawer móvil todavía). En el estado normal de arranque (sidebar cerrado) no hay overflow.

3. **Métricas usa `<h2>` en lugar de `<h1>`:** el `SectionPlaceholder` emite `<h2>` como heading principal del contenedor. La spec acepta "heading semántico principal"; el título "Panel de métricas" es distinto del header "Métricas". No supone incumplimiento.

4. **Navegación en viewports estrechos:** en 768 y 390, los links del aside (width:0) no son clickeables directamente; se requiere abrir el sidebar primero. Comportamiento correcto dado que el aside está colapsado.

---

## Veredicto

**PASS**

Todos los requisitos del change verificados y conformes:
- El estado inicial del sidebar en arranque es correcto en los 3 viewports (abierto en >=1024px, cerrado en <1024px).
- No hay overflow horizontal en estado normal en ningún viewport.
- El área de contenido fluye a ancho completo sin tope `max-w` en todas las secciones.
- Los títulos de contenedor difieren de los títulos del header en Reservas, Histórico y Métricas, y en Dashboard y Calendario (sin cambio).
- El toggle manual funciona correctamente.
- La deuda preexistente de 15px a 768 no empeora.

---

## Capturas generadas

Directorio: `openspec/changes/layout-appshell-ancho-titulos-sidebar/reports/e2e-screenshots/`

- `1280-dashboard-initial.png` — 1280, sidebar abierto estado inicial
- `1280-reservas-titles.png` — 1280, Reservas con títulos diferenciados
- `1280-historico-titles.png` — 1280, Histórico con títulos diferenciados
- `1280-metricas-titles.png` — 1280, Métricas con títulos diferenciados
- `1280-calendario.png` — 1280, Calendario (referencia ancho full-width)
- `768-dashboard-initial-closed.png` — 768, sidebar cerrado estado inicial
- `768-reservas-titles.png` — 768, Reservas sidebar cerrado
- `768-historico-sidebar-open.png` — 768, Histórico con sidebar abierto
- `768-historico-overflow-check.png` — 768, verificación overflow Histórico
- `390-dashboard-initial-closed.png` — 390, sidebar cerrado estado inicial
- `390-dashboard-sidebar-open-overflow.png` — 390, sidebar abierto (overflow esperado)
- `390-reservas-sidebar-closed.png` — 390, Reservas sidebar cerrado full-width
- `390-metricas-sidebar-closed.png` — 390, Métricas sidebar cerrado

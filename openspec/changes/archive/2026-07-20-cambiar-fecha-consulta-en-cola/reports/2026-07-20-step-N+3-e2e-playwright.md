# Step N+3 — E2E Playwright: cambiar-fecha-consulta-en-cola

**Fecha:** 2026-07-20
**Change:** `cambiar-fecha-consulta-en-cola`
**Agente:** qa-verifier
**Entorno:** http://localhost:5199 (web) / http://localhost:3999 (api) / BD `slotify_test_cfcola`

---

## Resumen de resultado

**VEREDICTO: PASS**

El flujo completo `2d → "Cambiar fecha" → 2b` funciona correctamente en los tres viewports. El botón "Cambiar fecha" está habilitado para consultas en estado `2d`. La transición se completa con éxito, generando sub_estado `2b`, fecha bloqueada, y borrador E1 visible en Comunicaciones.

---

## Configuración de prueba

- **Login:** `info@masialencis.com` / `Slotify2026!`
- **Consulta de prueba:** 26-0003 (QAC Cola), sub_estado `2d`, fecha inicial 2026-09-15, posición cola 1
- **Fecha destino:** 2026-09-25 (libre)
- **Viewport principal:** 1280x800 (escritorio)

---

## Pasos ejecutados y resultados

### Paso 1 — Login y navegación (viewport 1280)

| Acción | Resultado |
|--------|-----------|
| `browser_navigate` → http://localhost:5199 | Redirige a /login |
| Rellenar email + password, click "Entrar a Slotify" | Login exitoso → /dashboard |
| Verificar JWT en memoria | PASS — carga el dashboard con pipeline activo |

**Captura:** `01-ficha-26-0003-cola-desktop-1280.png`

### Paso 2 — Localizar y abrir ficha 26-0003

| Acción | Resultado |
|--------|-----------|
| Click en "26-0003 QAC Cola 15 sept 2026" en sección "Consultas en cola" del dashboard | Navega a `/reservas/675b83bb-1d12-41e4-8c6f-057461c91457` |
| Verificar heading "Consulta 26-0003" | PASS |
| Verificar badge "En cola de espera" | PASS |
| Verificar "Fecha del evento: 15 de septiembre de 2026" | PASS |
| Verificar "Posición en cola: 1" | PASS |

### Paso 3 — Verificar fix: botón "Cambiar fecha" habilitado para 2d

| Aserción | Resultado |
|----------|-----------|
| Click "Editar consulta" abre el `EditarConsultaDialog` | PASS |
| En sección "Fecha del evento" del dialog: botón "Cambiar fecha" presente | PASS |
| Botón "Cambiar fecha" **no está disabled** (era el bug antes del fix) | PASS |
| Botón muestra icono `CalendarRange` + texto "Cambiar fecha" | PASS |
| No aparece el mensaje "La fecha no puede cambiarse en el estado actual" | PASS |

**Captura:** `02-editar-consulta-dialog-cambiar-fecha-habilitado-desktop-1280.png`

### Paso 4 — Ejecutar cambio de fecha a 2026-09-25

| Acción | Resultado |
|--------|-----------|
| Click "Cambiar fecha" → abre `CambiarFechaDialog` | PASS |
| Dialog muestra "La fecha actual es **15 de septiembre de 2026**" | PASS |
| Input "Nueva fecha del evento" disponible y activo | PASS |
| Introducir "2026-09-25", click "Cambiar fecha" | PASS — petición POST exitosa |

**Captura:** `03-dialogo-cambiar-fecha-abierto-desktop-1280.png`

### Paso 5 — Verificar estado post-cambio: 2b + fecha nueva + borrador E1

| Aserción | Resultado |
|----------|-----------|
| Badge cambia a **"Consulta con fecha"** (antes "En cola de espera") | PASS — sub_estado `2b` |
| Sección "Datos del lead" → "Fecha del evento": **25 de septiembre de 2026** | PASS |
| Sección "Datos del lead": "Posición en cola" ya NO aparece (salió de cola) | PASS |
| Banner de transición: "La fecha **25 de septiembre de 2026** ha quedado **bloqueada**..." | PASS |
| Sección "Comunicaciones": email "Confirmación de consulta (E1)" con estado **"Borrador"** | PASS |
| Asunto del borrador: "La fecha que proposes està disponible" | PASS |
| Sección "Acciones": mensaje "Revisa y envía el correo de confirmación antes de continuar" (borrador bloquea acciones) | PASS |
| Dashboard (tras navegar): "Consultas en cola: 0" (26-0003 ya no está en cola) | PASS |
| Dashboard: 26-0003 aparece en Pipeline activo con "25 sept 2026" | PASS |

**Captura:** `04-resultado-cambio-fecha-2b-borrador-E1-desktop-1280.png`

### Paso 6 — Caso conflicto (fecha ocupada)

**OMITIDO.** Tras el cambio, 26-0003 está en `2b` con borrador E1 pendiente. El bloqueo de acciones por `tieneBorradorE1Pendiente` impide acceder a "Editar consulta" → "Cambiar fecha" en la misma sesión sin enviar el E1 o restaurar la BD. No hay otra consulta en `2d` disponible para probar el conflicto. Anotado para QA separado o prueba manual por el dev.

La prueba de conflicto `POST /reservas/{id}/cambiar-fecha` → 409 fue cubierta en el **Step N+2 (curl)** con resultado PASS.

---

## Responsive — 3 viewports

### Mobile 390px

| Verificación | Resultado |
|--------------|-----------|
| Login → dashboard funciona | PASS |
| Nav colapsada a hamburguesa "Abrir navegación" | PASS |
| Click hamburguesa → drawer lateral visible | PASS |
| Overflow horizontal en página (scrollWidth === clientWidth) | PASS — sin overflow (375px === 375px) |
| Ficha 26-0003 carga correctamente con estado 2b + fecha 25 sept 2026 | PASS |
| Dashboard muestra "Consultas en cola: 0" confirmando persistencia | PASS |

**Capturas:** `05-dashboard-mobile-390.png`, `06-ficha-26-0003-2b-mobile-390.png`, `07-nav-drawer-mobile-390.png`

### Tablet 768px

| Verificación | Resultado |
|--------------|-----------|
| Nav colapsada a hamburguesa "Abrir navegación" (768 < 1024 = lg) | PASS |
| Overflow horizontal en página cerrada (scrollWidth === clientWidth) | PASS — sin overflow (753px === 753px) |
| Overflow con drawer abierto | 15px (768 > 753) — **pre-existente** (documentado en memoria del proyecto `appshell-overflow-768-deuda.md`; change `layout-appshell-ancho-titulos-sidebar` pendiente) |
| Ficha 26-0003 renderiza correctamente en 768 | PASS |
| Contenido sin truncamientos ni elementos rotos | PASS |

**Capturas:** `08-ficha-26-0003-2b-tablet-768.png`, `09-ficha-26-0003-2b-tablet-768-nooverflow.png`, `10-ficha-26-0003-fullpage-tablet-768.png`, `11-nav-drawer-tablet-768-overflow-preexistente.png`

### Escritorio 1280px

| Verificación | Resultado |
|--------------|-----------|
| Nav visible como sidebar fijo (1280 >= 1024 = lg) | PASS — botón "Cerrar navegación" [expanded] |
| Sin overflow horizontal (1265px === 1265px) | PASS |
| Flujo completo 2d → Cambiar fecha → 2b ejecutado en este viewport | PASS |
| Dialog "Cambiar la fecha del evento" usable y centrado | PASS |

**Capturas:** `01-ficha-26-0003-cola-desktop-1280.png`, `02-editar-consulta-dialog-cambiar-fecha-habilitado-desktop-1280.png`, `03-dialogo-cambiar-fecha-abierto-desktop-1280.png`, `04-resultado-cambio-fecha-2b-borrador-E1-desktop-1280.png`, `12-ficha-26-0003-2b-desktop-1280-final.png`

---

## Aserciones de negocio verificadas (UI)

| Aserción | PASS/FAIL |
|----------|-----------|
| Botón "Cambiar fecha" habilitado para sub_estado `2d` (fix principal del change) | PASS |
| Botón "Cambiar fecha" muestra CalendarRange (no CalendarPlus = Añadir) | PASS |
| Dialog "Cambiar la fecha del evento" se abre correctamente | PASS |
| POST a fecha libre → transición `2d → 2b` visible en UI | PASS |
| Sub_estado actualizado: badge "Consulta con fecha" | PASS |
| Fecha del evento actualizada a 25 sept 2026 | PASS |
| Posición en cola eliminada (campo desaparece de Datos del lead) | PASS |
| Borrador E1 creado con estado "Borrador" visible en Comunicaciones | PASS |
| Bloqueo de acciones por E1 borrador pendiente activo | PASS |
| Persistencia en dashboard: contador "Consultas en cola" → 0 | PASS |
| 26-0003 sale de sección "Consultas en cola" del dashboard | PASS |
| 26-0003 en Pipeline activo con nueva fecha 25 sept 2026 | PASS |

---

## Estado BD tras las pruebas

La BD de test `slotify_test_cfcola` fue **mutada intencionalmente** por el flujo E2E (26-0003: `2d → 2b`, fecha `2026-09-15 → 2026-09-25`, borrador E1 insertado). No se restaura porque:
1. Las instrucciones del agente indican "NO toques la BD"
2. La mutación es el resultado correcto y esperado del flujo under test

Si se necesita reiniciar las pruebas, el dev debe ejecutar el seed de worktree correspondiente.

---

## Capturas de pantalla (referencia)

Todas en `reports/e2e-screenshots/`:

| Archivo | Descripción |
|---------|-------------|
| `01-ficha-26-0003-cola-desktop-1280.png` | Ficha 26-0003 en estado 2d (cola), desktop 1280 |
| `02-editar-consulta-dialog-cambiar-fecha-habilitado-desktop-1280.png` | Dialog Editar consulta con "Cambiar fecha" habilitado para 2d |
| `03-dialogo-cambiar-fecha-abierto-desktop-1280.png` | Dialog "Cambiar la fecha del evento" abierto |
| `04-resultado-cambio-fecha-2b-borrador-E1-desktop-1280.png` | Estado post-cambio: 2b + fecha 25/09 + borrador E1 |
| `05-dashboard-mobile-390.png` | Dashboard en mobile 390 (Consultas en cola = 0) |
| `06-ficha-26-0003-2b-mobile-390.png` | Ficha 26-0003 en estado 2b, mobile 390 |
| `07-nav-drawer-mobile-390.png` | Drawer de navegación abierto, mobile 390 |
| `08-ficha-26-0003-2b-tablet-768.png` | Ficha 26-0003 en estado 2b, tablet 768 |
| `09-ficha-26-0003-2b-tablet-768-nooverflow.png` | Ficha sin overflow, tablet 768 |
| `10-ficha-26-0003-fullpage-tablet-768.png` | Página completa, tablet 768 |
| `11-nav-drawer-tablet-768-overflow-preexistente.png` | Drawer abierto en 768: overflow 15px pre-existente |
| `12-ficha-26-0003-2b-desktop-1280-final.png` | Estado final ficha, desktop 1280 |

---

## Incidencias

1. **Overflow 15px en 768px con drawer abierto** — Pre-existente. Documentado en `appshell-overflow-768-deuda.md`. No es regresión de este change.
2. **Caso conflicto no probado en E2E** — Cubierto en Step N+2 (curl). No se puede reproducir en E2E sin restaurar la BD o tener otra consulta en 2d.
3. **JWT en memoria se pierde en `browser_navigate` directa** — Gotcha conocido (memoria del proyecto). Se mitigó navegando por clics o re-logueando.

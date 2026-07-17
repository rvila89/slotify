# Step: E2E Playwright — US-042 Buscar y filtrar en el histórico

**Fecha:** 2026-07-17
**Ejecutado por:** agente QA via MCP Playwright
**Frontend:** http://localhost:5173
**Backend:** http://localhost:3000
**Credenciales:** info@masialencis.com / Slotify2026!
**Rama:** feature/us-042-buscar-en-historico

---

## Contexto de datos

La BD de desarrollo no contiene reservas en estado cerrado (`reserva_completada`, cancelada). El histórico aparecerá vacío durante este E2E. Es el comportamiento esperado — los tests de integración (sesión principal, Postgres real) ya validaron búsqueda + filtros con datos reales.

---

## Capturas generadas

Todas en `openspec/changes/us-042-buscar-en-historico/reports/e2e-screenshots/`:

| Archivo | Descripción |
|---|---|
| `e2e-us042-1280-historico-overview.png` | 1280px — vista inicial de Histórico (sidebar cerrado) |
| `e2e-us042-1280-sidebar-open.png` | 1280px — sidebar abierto con "Histórico" activo |
| `e2e-us042-1280-historico-desktop.png` | 1280px — snapshot adicional tras reopen |
| `e2e-us042-768-historico-overview.png` | 768px — tablet, sidebar colapsado |
| `e2e-us042-390-historico-overview.png` | 390px — móvil, sidebar colapsado |
| `e2e-us042-390-drawer-open.png` | 390px — drawer abierto con todos los nav items |

---

## Workflow ejecutado

### Login

- Navegado a `http://localhost:5173` → redirige a `/login`
- Introducidas credenciales: info@masialencis.com / Slotify2026!
- Login exitoso → redirige a `/historico` (URL donde se había intentado navegar)
- Sin errores de consola (0 errores, 2 warnings pre-existentes)

### Navegación a Histórico

- Item "Histórico" localizado en la navegación lateral con URL `/historico`
- Navegación a `/historico` correcta
- Header dinámico muestra título "Histórico" y subtítulo "Reservas completadas y canceladas"

---

## Responsive — 3 viewports

### 1280px (escritorio)

**Overflow horizontal:** NO (docWidth=1280 = viewWidth=1280)

**Sidebar:** El AppShell usa sidebar de toggle manual (no breakpoint automático). Con sidebar cerrado: hamburger visible, contenido a pantalla completa. Con sidebar abierto (toggle): sidebar 288px visible, "Histórico" resaltado activo, contenido reflowea correctamente sin overflow.

**Filtros:** Renderizan en layout de 3 columnas (`Estado final | Tipo de evento | Fecha del evento`) + segunda fila (`Importe (€)`). Sin overflow.

**Estado vacío:** "Aún no hay reservas archivadas" + descripción + botones "Ir al Calendario" / "Ir al Pipeline". Correcto.

**Controles de edición:** Ninguno visible. Vista de solo lectura confirmada.

**Resultado:** PASS

---

### 768px (tablet)

**Overflow horizontal (drawer cerrado):** NO (docWidth=768 = viewWidth=768)

**Sidebar:** Colapsado. Hamburger visible. Drawer abre al tocar (nav items con "Histórico" activo). Al cerrar el drawer, sin overflow.

**Nota técnica:** El AppShell implementa un push-drawer (el aside empuja el contenido), no un overlay. Con el drawer abierto, el document.scrollWidth supera el viewport. Esta es una limitación pre-existente del AppShell, registrada en la deuda técnica `appshell-overflow-768-deuda.md`. No introducida por US-042.

**Filtros:** En 768px los filtros adaptan a layout de 2 columnas (`Estado final | Tipo de evento` en primera fila, `Fecha del evento | Importe` en segunda). Sin overflow.

**Estado vacío:** Correcto.

**Controles de edición:** Ninguno.

**Resultado:** PASS (con deuda pre-existente de push-drawer anotada)

---

### 390px (móvil)

**Overflow horizontal (drawer cerrado):** NO (docWidth=375 < viewWidth=390)

**Sidebar:** Hamburger visible en header. Al tocar hamburger el drawer se abre mostrando todos los items de navegación con "Histórico" resaltado. Al cerrar: sin overflow.

**Filtros:** En 390px los filtros se apilan en una sola columna: Buscar → Estado final → Tipo de evento → Fecha del evento → Importe. Todos accesibles. Sin overflow.

**Header:** Botón "Nueva Reserva" compacto (solo icono "+") en móvil. El texto se oculta en `< sm` (`hidden sm:inline`). Correcto.

**Estado vacío:** "Aún no hay reservas archivadas" con texto envuelto correctamente. Botones "Ir al Calendario" / "Ir al Pipeline" accesibles con objetivo táctil adecuado.

**Controles de edición:** Ninguno.

**Resultado:** PASS

---

## Verificaciones adicionales

### Item de navegación Histórico

- Presente en la navigation con URL `/historico`
- Accesible desde todos los viewports
- Al estar en `/historico` el item aparece resaltado (activo)
- PASS

### Modo solo lectura

- No se observan botones de edición, eliminar, crear ni actualizar en la página de Histórico
- Solo botones de navegación ("Ir al Calendario", "Ir al Pipeline")
- PASS

### Errores de consola

- 0 errores de consola durante toda la sesión E2E
- 2 warnings pre-existentes (no relacionados con US-042)
- PASS

---

## Cobertura: E2E vivo vs. tests de integración

| Funcionalidad | Cubierto por |
|---|---|
| Render de la página + nav item | E2E Playwright (este report) |
| Estado vacío con BD vacía | E2E Playwright (este report) |
| Responsive 3 viewports | E2E Playwright (este report) |
| Drawer/hamburger en <lg | E2E Playwright (este report) |
| Sin controles de edición | E2E Playwright (este report) |
| FTS por nombre/apellidos/email/código/notas | Test integración Postgres real (sesión principal) |
| Aislamiento multi-tenant | Test integración Postgres real (sesión principal) |
| Filtros AND combinados | Test integración Postgres real (sesión principal) |
| Paginación y orden | Test integración Postgres real (sesión principal) |
| 401 sin token, 400 limit>100 | Curl smoke (sesión principal) |

---

## Hallazgos

1. **Deuda pre-existente — push-drawer overflow:** El AppShell usa un push-drawer que al abrirse extiende el scrollWidth por encima del viewport en viewports estrechos. Registrado como deuda en `appshell-overflow-768-deuda.md`. No introducido por US-042.

2. **Sidebar sin auto-apertura en lg+:** Por diseño, el AppShell no abre automáticamente el sidebar en breakpoints grandes (toggle manual). Es un comportamiento intencional del AppShell (ver `AppShell.tsx`). No es un defecto de US-042.

3. **Histórico vacío en dev:** La BD de dev no tiene reservas cerradas. El estado vacío se muestra correctamente. La validación funcional con datos reales está cubierta por los tests de integración.

---

## Resultado

**PASS** — La vista de Histórico renderiza correctamente en los 3 viewports sin overflow (drawer cerrado), muestra el estado vacío apropiado, no expone controles de edición, y el item de navegación está presente y activo. Deudas pre-existentes del AppShell anotadas, no atribuibles a US-042.

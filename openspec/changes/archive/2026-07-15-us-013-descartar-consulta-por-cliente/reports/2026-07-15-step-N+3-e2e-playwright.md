# Step N+3 — E2E Playwright Tests
## Change: us-013-descartar-consulta-por-cliente
## Date: 2026-07-15
## Executed by: qa-verifier

---

## 1. Entorno de ejecución

| Componente | Valor |
|------------|-------|
| Frontend SPA | http://localhost:5175 (Vite, BD slotify_test via API :3099) |
| Backend API | http://localhost:3099/api |
| BD | slotify_test (PostgreSQL real, levantado por sesión principal) |
| Usuario | gestor-a1@slotify.test (rol gestor, tenant ...0001) |
| Reserva 2a descartable | `589aa958-8368-4a8b-8c24-4d7827bbb1ea` (E2E013-q44jl9) |
| Reserva terminal s2x | `e2e00001-0000-0000-0000-000000000002` (E2E-0001) |

---

## 2. Casos ejecutados y resultado

### Caso 1 — Happy path: descartar consulta 2a (viewport 1280px)

**Pasos:**
1. Login por UI en http://localhost:5175/login con gestor-a1@slotify.test / Slotify2026!
2. Click en enlace del Pipeline activo del dashboard hacia la ficha `/reservas/589aa958-8368-4a8b-8c24-4d7827bbb1ea`
3. Click en botón "Marcar como descartada por cliente" (data-testid: boton-descartar-consulta)
4. Diálogo abierto: heading "Marcar como descartada por cliente", campo textarea motivo, botones Cancelar / Marcar como descartada
5. Introducido motivo: "El cliente ha decidido celebrar el evento en otra ubicación."
6. Click en "Marcar como descartada" (data-testid: confirmar-descartar-consulta)
7. Verificado resultado en la ficha

**Resultado red:**
```
POST http://localhost:3099/api/reservas/589aa958-8368-4a8b-8c24-4d7827bbb1ea/descartar => 200 OK
```

**Resultado UI post-descarte:**
- Badge/estado de la ficha: "Cerrada" (antes era "Consulta exploratoria")
- Botón "Marcar como descartada por cliente": `disabled`
- Texto informativo: "Esta consulta ya está en un estado terminal y no puede modificarse"
- Botón "Generar presupuesto": `disabled`, texto: "Esta consulta está en un estado terminal y no admite la generación de un presupuesto"
- Sin errores en consola (0 errores JS)

**Resultado: PASS**

---

### Caso 2 — Estado terminal: consulta s2x no descartable (viewport 1280px)

**Pasos:**
1. Navegación SPA via pushState a `/reservas/e2e00001-0000-0000-0000-000000000002`
2. Snapshot de la ficha de consulta E2E-0001

**Resultado UI:**
- Estado mostrado: "Descartada"
- Botón "Marcar como descartada por cliente": `disabled`
- Texto: "Esta consulta ya está en un estado terminal y no puede modificarse"
- Botón "Generar presupuesto": `disabled`

**Resultado: PASS**

---

### Caso 3 — Responsive: 3 viewports

#### 3a. Viewport 390px (móvil)

| Checkpoint | Resultado |
|------------|-----------|
| Nav colapsa a drawer + botón hamburguesa "Abrir navegación" visible | PASS |
| Sidebar fijo NO visible (correcto para <lg=1024) | PASS |
| Ficha de reserva sin overflow horizontal (scrollWidth=375, clientWidth=375) | PASS |
| Botón "Marcar como descartada" visible y en estado disabled correcto (reserva ya en 2z) | PASS |
| Sin errores JS | PASS |

**Resultado viewport 390: PASS**

#### 3b. Viewport 768px (tablet)

| Checkpoint | Resultado |
|------------|-----------|
| Nav colapsa a drawer + botón hamburguesa visible (768 < lg=1024) | PASS |
| Ficha de reserva sin overflow (bodyScrollWidth=768, maxElementOverflow=0) | PASS |
| Dashboard sin overflow (bodyScrollWidth=768, maxElementOverflow=0) | PASS |
| Deuda pre-existente ~15px en cabecera | NO reproducida en esta ejecucion (0px overflow) |
| Botón "Marcar como descartada" disabled visible | PASS |

**Resultado viewport 768: PASS**
(Nota: la deuda pre-existente de overflow en cabecera documentada en `appshell-overflow-768-deuda.md` no se reproduce en esta ejecucion con la version actual del codigo.)

#### 3c. Viewport 1280px (escritorio)

| Checkpoint | Resultado |
|------------|-----------|
| Sidebar fijo visible en navegacion (navigation presente en el contenedor lateral, fuera del banner) | PASS |
| Sin overflow horizontal (scrollWidth=1265, clientWidth=1265) | PASS |
| Boton "Marcar como descartada" visible y funcional (se abrio dialogo, se confirmo descarte) | PASS |
| Dialogo centrado en desktop, campos y botones usables | PASS |

**Resultado viewport 1280: PASS**

---

## 3. Capturas

| Archivo | Descripcion |
|---------|-------------|
| `01-dashboard-1280.png` | Dashboard post-login, viewport 1280px |
| `02-ficha-2a-1280-antes-descartar.png` | Ficha consulta 2a antes del descarte, 1280px (boton activo) |
| `03-dialog-descartar-1280.png` | Dialogo de descarte abierto, 1280px |
| `04-ficha-2z-post-descarte-1280.png` | Ficha post-descarte (estado "Cerrada", boton disabled), 1280px |
| `05-ficha-terminal-s2x-boton-disabled-1280.png` | Ficha consulta s2x terminal, boton disabled, 1280px |
| `06-ficha-2z-390-movil.png` | Ficha post-descarte, viewport 390px movil, hamburguesa visible |
| `07-ficha-2z-768-tablet.png` | Ficha post-descarte, viewport 768px tablet, hamburguesa visible |
| `08-dashboard-768-tablet.png` | Dashboard viewport 768px tablet |
| `09-dashboard-1280-sidebar-fijo.png` | Dashboard viewport 1280px, sidebar fijo confirmado |

Ruta: `openspec/changes/us-013-descartar-consulta-por-cliente/reports/e2e-screenshots/`

---

## 4. Estado BD post-ejecucion

La reserva `589aa958-8368-4a8b-8c24-4d7827bbb1ea` quedo en estado terminal `2z` (descartada por cliente).
Esta mutacion es el objetivo del test (happy path) y es IRREVERSIBLE por diseno.
El pipeline del dashboard confirma la transicion: la reserva ya no aparece en "Pipeline activo" (count=0) tras el descarte.

La reserva terminal `e2e00001-0000-0000-0000-000000000002` (s2x) no fue modificada.

---

## 5. Outcome

**Veredicto Step N+3: PASS**

Todos los casos E2E ejecutados correctamente:
- Happy path completo: boton activo → dialogo → confirmacion → POST /descartar 200 OK → UI actualizada a estado "Cerrada" con boton disabled.
- Estado terminal: boton deshabilitado con mensaje correcto en consulta s2x.
- Responsive: sin overflow en los 3 viewports (390 / 768 / 1280); nav colapsa a drawer en <lg y es sidebar fijo en >=lg.
- Sin errores JS en consola.
- Bug `::uuid` confirmado corregido (endpoint responde 200 OK contra BD real).

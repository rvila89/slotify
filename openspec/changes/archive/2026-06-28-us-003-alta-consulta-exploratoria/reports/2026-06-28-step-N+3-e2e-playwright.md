# Step N+3 — E2E Playwright (2026-06-28)

## Entorno
- Frontend: `pnpm --filter @slotify/web run dev` → http://localhost:5173 (Vite)
- Backend: `pnpm --filter @slotify/api run dev` → http://localhost:3000 (ts-node-dev)
- Playwright: Chromium headless
- Ambos servidores lanzados limpios (procesos previos matados, puertos 3000/5173 liberados antes de arrancar)

## Baseline de BD
| tabla            | count pre |
|------------------|-----------|
| reserva          | 0         |
| cliente          | 0         |
| comunicacion     | 0         |
| audit_log        | 25*       |
| fecha_bloqueada  | 0         |

*23 originales + 2 de logins del Step N+2 (curl)

## Estrategia de sesión
El access token de la SPA vive en memoria React (nunca en localStorage).
`page.goto()` recarga la SPA y pierde la sesión. Se usó:
- **Un único login en `beforeAll`** con un contexto de navegador compartido.
- Toda la navegación posterior es **client-side** (click de links React Router) para preservar el token en memoria.
- `page.goto()` se usó ÚNICAMENTE para el login inicial.

## Resultado de tests (9/9 PASS en 3.1s)

| # | Test | Resultado |
|---|------|-----------|
| 8.2 | navega a /reservas/nueva vía botón Nueva Reserva del header | PASS |
| 8.3 | flujo feliz sin comentarios → alerta E1 enviado + BD verificada | PASS |
| 8.4 | flujo con comentarios → alerta E1 borrador + BD verificada | PASS |
| 8.5a | campos obligatorios vacíos → errores de validación, API no invocada | PASS |
| 8.5b | email inválido → error de formato, API no invocada | PASS |
| 8.5c | canal no seleccionado → error de validación, API no invocada | PASS |
| 8.6a | viewport 390 (móvil): sin overflow, drawer hamburguesa visible | PASS |
| 8.6b | viewport 768 (tablet): sin overflow, drawer visible | PASS |
| 8.6c | viewport 1280 (escritorio): sidebar fijo, sin hamburguesa | PASS |

## Detalle de verificaciones

### 8.2 — Navegación
- `a[aria-label="Nueva Reserva"]` visible en header a 1280px
- Click → URL cambia a /reservas/nueva (SPA navigation, sin recarga)
- `data-testid="form-nueva-consulta"` visible
- `h1[role=heading][name="Nueva consulta"]` visible
- Heading "Panel" del AppShell también visible (AppShell activo)

### 8.3 — Flujo feliz sin comentarios
- Campos rellenados: nombre/apellidos/email/telefono/canalEntrada=web, sin comentarios
- Submit → HTTP 201
- Alerta `[data-testid="alerta-e1-enviado"]` visible con texto "enviado automáticamente" y código `26-XXXX`
- Formulario resetado tras submit (nombre = '')
- BD:
  - RESERVA `estado=consulta / sub_estado=s2a / ttl_expiracion=NULL` ✓
  - COMUNICACION `estado=enviado` ✓
  - AUDIT_LOG `accion=crear / entidad=RESERVA` ✓
  - fecha_bloqueada count = 0 ✓

### 8.4 — Flujo con comentarios
- Campo `comentarios` rellenado con texto
- Submit → HTTP 201
- Alerta `[data-testid="alerta-e1-borrador"]` visible con "borrador" y "no se ha enviado"
- BD: COMUNICACION `estado=borrador` ✓

### 8.5 — Validaciones
- Sin ningún campo: 5 errores visibles (nombre, apellidos, email, teléfono, canal)
- API interceptada con `page.route` → `apiCalled = false` confirmado
- Email sin arroba: "Introduce un email válido" visible, API no invocada
- Canal vacío: "Selecciona un canal de entrada" visible, API no invocada

### 8.6 — Responsive en 3 viewports

| viewport | scrollWidth ≤ viewport+2 | sidebar | hamburguesa | formulario |
|----------|--------------------------|---------|-------------|------------|
| 390 (móvil) | PASS (≤392) | oculto (not visible) | visible | PASS |
| 768 (tablet) | PASS (≤770) | oculto (not visible) | visible | PASS |
| 1280 (escritorio) | PASS (≤1282) | visible (aside) | oculto (not visible) | PASS |

El corte `lg=1024px` funciona correctamente:
- `< lg`: sidebar colapsado → drawer con hamburguesa en header
- `≥ lg`: sidebar fijo en aside, hamburguesa oculta

## Incidente durante QA (resuelto)
Al intentar usar `page.goto('/reservas/nueva')` en los tests (primer y segundo intento), la sesión se perdía porque la recarga de la SPA resetea la variable en-memoria del access token. Solución: uso de contexto compartido con login único en `beforeAll` y navegación interna SPA mediante clicks (sin `page.goto()` salvo el login inicial).

## Comparación BD pre/post

| tabla            | pre | post | restaurado |
|------------------|-----|------|------------|
| reserva          | 0   | 0    | sí — `afterAll` eliminó las 2 reservas de test |
| cliente          | 0   | 0    | sí — `afterAll` eliminó los 2 clientes de test |
| comunicacion     | 0   | 0    | sí — `afterAll` eliminó las 2 comunicaciones de test |
| audit_log        | 25  | 32   | parcial — 7 entradas `login/Usuario` del proceso E2E persisten (auditoría legítima del módulo auth) |
| fecha_bloqueada  | 0   | 0    | n/a |

Los 7 audit_log de `login/Usuario` no son residuos de datos de negocio: son trazas de auditoría del módulo auth generadas por los intentos de login durante las 3 ejecuciones de prueba del agente QA.

## Restauración
- Reservas de test (`eva.martinez@e2e-test.com`, `lluc.ferrer@e2e-test.com`): eliminadas en `afterAll` (audit_log RESERVA + comunicacion + reserva + cliente)
- Contexto de navegador: cerrado en `afterAll`
- Servidores: se mantienen activos para posibles tests adicionales; se pueden matar con `pkill -f ts-node-dev`

## Outcome
PASS — 9/9 tests en verde, BD de negocio restaurada, responsive verificado en 3 viewports.

# Step N+3 — E2E Playwright (2026-07-18)

Change: `presupuesto-prereserva-cta-descarte-y-e2`
Worktree: `C:/Users/roger.vila/Documents/slotify-presupuesto-prereserva`

## Estado del entorno

**BLOQUEADO**: El MCP de Playwright reporta "Browser is already in use for
`C:\Users\roger.vila\AppData\Local\ms-playwright-mcp\mcp-chrome-4321e63`, use --isolated
to run multiple instances of the same browser". No es posible iniciar sesiones de
navegación desde este agente.

El frontend está sirviendo en `http://localhost:5173` (proceso PID 19424, Vite dev server).
No se puede confirmar si corresponde al worktree del change o al principal, lo que añade
incertidumbre adicional sobre si los cambios del workstream A estarían visibles.

## Guión E2E a ejecutar (cuando el navegador esté disponible)

### Setup

```
1. Navegar a http://localhost:5173
2. Login con gestor-a1@slotify.test / Slotify2026!
3. Navegar a la ficha de la reserva 55ada7b0-75dd-45ef-97fb-03470d4ef6df (pre_reserva)
```

### Workstream A — Orden y color de CTAs

```
Para cada viewport en [390, 768, 1280]:
  browser_resize(width=viewport, height=900 o 1024)
  browser_navigate('/reservas/55ada7b0-75dd-45ef-97fb-03470d4ef6df')
  browser_snapshot()
  
  Verificar:
  - El botón "Confirmar pago de señal" es visible y aparece ANTES de "Editar presupuesto"
  - El botón "Confirmar pago de señal" tiene clase bg-accent-success (verde)
  - El botón "Editar presupuesto" tiene clase bg-brand-primary (terracota/primary)
  - No hay overflow horizontal (scrollWidth == clientWidth)
  - En viewport 390/768: la nav es un drawer con hamburguesa (< lg = 1024px)
  - En viewport 1280: la nav es sidebar fijo

  Abrir diálogo "Confirmar pago de señal":
  browser_click('[data-testid="boton-confirmar-senal"]')
  browser_snapshot()
  Verificar: el botón "Confirmar" dentro del diálogo tiene clase bg-accent-success
  Cerrar diálogo

  Abrir diálogo "Descartar pre-reserva":
  browser_click('[data-testid="boton-descartar-prereserva"]') (o el botón de AccionDescartarPreReserva)
  browser_snapshot()
  Verificar: el diálogo de descarte aparece con campo motivo opcional
  Guardar captura: e2e-screenshots/e2e-descarte-prereserva-${viewport}.png
```

### Workstream B — Flujo de descarte

```
(Requiere API del change levantada)
1. Abrir diálogo de descarte, dejar motivo vacío → confirmar → verificar reserva en "reserva_cancelada"
2. Repetir con motivo "test QA" → verificar audit_log en BD
3. Verificar que el botón de descarte no aparece en estados != pre_reserva
4. Verificar BD: FECHA_BLOQUEADA liberada
```

### Responsive obligatorio

| viewport | nav | overflow | CTAs | resultado |
|----------|-----|----------|------|-----------|
| 390 (móvil) | drawer+hamburguesa | sin overflow | confirmar primero+verde | NO EJECUTADO |
| 768 (tablet) | drawer+hamburguesa | sin overflow | confirmar primero+verde | NO EJECUTADO |
| 1280 (escritorio) | sidebar fijo | sin overflow | confirmar primero+verde | NO EJECUTADO |

## Capturas E2E

Directorio de destino: `reports/e2e-screenshots/`
Estado: VACÍO (no se ejecutó ninguna captura)

## Restauración

N/A — no se ejecutaron acciones en el navegador.

## Outcome

BLOQUEADO — Playwright MCP no disponible (instancia de navegador en uso por otro proceso).
El guión está documentado y listo para ejecución manual o desde la sesión principal.

Riesgo: dado que la API en ejecución es master (sin el orquestador por fase), el flujo
de descarte del workstream B tampoco sería verificable incluso con el navegador disponible.
Para un E2E completo se requiere que tanto la API del worktree del change como el Playwright
MCP estén disponibles.

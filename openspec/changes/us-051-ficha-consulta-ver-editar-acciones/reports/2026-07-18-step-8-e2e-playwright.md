# QA Step 8 — E2E Playwright (US-051)

Fecha: 2026-07-18 · Frontend Vite `localhost:5173` + API `localhost:3000` (`EMAIL_TRANSPORT=fake`) contra `slotify_dev`. Conducido con Playwright MCP desde la sesión principal. 0 errores de consola en todo el flujo.

## Datos de prueba
- Consulta A (26-0006, `2b` con fecha, sin duración/invitados/horario).
- Consulta B (26-0007) descartada por cliente → sub-estado terminal.
Ambas eliminadas de la BD al finalizar.

## Flujos verificados

### Punto 1 — Ver detalles del evento ✅
La ficha de A muestra la sección **"Detalles del evento"** con Duración, Hora de inicio, Invitados (adultos y niños > 4), Niños ≤ 4, Nº de invitados final y Comentarios. Los opcionales ausentes muestran **"De momento no se dispone de esta información"**.
Captura: `e2e-01-ficha-detalles-gating-1280.png`.

### Punto 3 — Gating de "Generar presupuesto" ✅
Con datos incompletos, el botón **"Generar presupuesto" aparece deshabilitado** con el texto: *"Faltan datos para generar el presupuesto: Número de invitados, Duración (horas), Hora de inicio. Usa 'Editar consulta' para completarlos."*

### Punto 2 — Editar consulta ✅
Abierto **"Editar consulta"**: tipo, duración (4/8/12), invitados, niños ≤4, **hora de inicio (deshabilitada hasta elegir duración**, misma regla que el alta), comentarios, y la **fecha gestionada aparte** ("Cambiar fecha" → flujo atómico, nunca por el PATCH). Se fijó duración 8h + invitados 30 + hora 11:00 y se guardó: la ficha se actualizó (Duración "8 h", Hora "11:00", Invitados "30") y **"Generar presupuesto" pasó a habilitado**.
Captura: `e2e-02-ficha-editada-presupuesto-habilitado-1280.png`. (El caso 30→20 se verificó por curl en Step 7.)

### Punto 4 — Consulta cerrada sin acciones ✅
La ficha de B (terminal, badge **"Cerrada"**) muestra en la sección Acciones **únicamente** "No hay acciones disponibles para esta consulta en su estado actual." — **ningún botón** (ni "Generar presupuesto" ni "Descartar" deshabilitados).
Captura: `e2e-03-ficha-terminal-sin-acciones-1280.png`.

## Responsive (regla dura — 3 viewports) ✅
Sin overflow horizontal (`scrollWidth == clientWidth`) en:
- **390** (móvil): ficha terminal (`e2e-04-ficha-terminal-390.png`) y editor de consulta (`e2e-05-editor-consulta-390.png`).
- **768** (tablet): editor de consulta (`e2e-06-editor-consulta-768.png`).
- **1280** (escritorio): capturas 01–03.

## Notas
- La navegación directa por URL (`goto`) a una ficha pierde el JWT en memoria (no hay refresh silencioso en carga dura); se navegó por la SPA. Sin impacto funcional.
- Emails: transporte `fake` forzado; E1 figura "Enviado" sin envío real (0 quota Resend).

# Step 8 — E2E con Playwright
## Change: us-007-transicion-pendiente-invitados
## Fecha: 2026-06-30
## Agente: qa-verifier

---

## 1. Entorno

- Frontend: `http://localhost:5173` (Vite dev server en marcha)
- Backend: `http://localhost:3000` (NestJS en marcha)
- Playwright: v1.61.1, browser Chromium (headless)
- Spec creada: `e2e/us-007-pendiente-invitados.spec.ts`
- Credenciales: `info@masialencis.com / Slotify2026!`

### Datos de prueba

| Entidad | ID | Estado inicial |
|---------|-----|----------------|
| RESERVA bloqueante | `9e8b1384-db02-47d0-a82d-af80217d1dcb` | s2b, TTL vigente, FECHA_BLOQUEADA activa |
| RESERVA cola | `3ba9faad-5e45-4814-9c6d-e9eb9f45529e` | s2d, apunta a bloqueante |
| RESERVA exploratoria 2a | `1abe5647-b5dd-46d5-a824-6a800f57c2fe` | s2a, sin fecha (del seed) |

Nota técnica: el access token vive en memoria de React (no en localStorage/cookie JS). Para mantener la sesión entre pasos, la navegación entre rutas se realiza via `window.history.pushState` + `PopStateEvent` (React Router) en lugar de `page.goto()`, que causaría un reload de la SPA y pérdida del token en memoria. Mismo patrón que `e2e/us-004-alta-consulta-con-fecha.spec.ts`.

---

## 2. Comandos ejecutados

```bash
npx playwright test e2e/us-007-pendiente-invitados.spec.ts
```

---

## 3. Resultados por viewport

### 3.1 desktop-1280 (1280×800)

| Test | Resultado | Detalle |
|------|-----------|---------|
| 2a no muestra boton-pendiente-invitados | PASS | `boton-anadir-fecha` visible, `boton-pendiente-invitados` no visible (guarda D-1 UI) |
| No overflow en ficha 2b | PASS | scrollWidth=1280 <= clientWidth=1280; aside (sidebar) visible |
| Flujo completo 2b→2c + cola + feedback + persistencia | PASS | Ver detalle abajo |

**Detalle flujo completo (desktop-1280):**

1. Navegó a ficha RESERVA bloqueante (2b). `boton-pendiente-invitados` visible.
2. BD pre-call verificada: `sub_estado = 's2b'`.
3. Click en `boton-pendiente-invitados` → `dialog-pendiente-invitados` abierto. Contiene texto "cola" (aviso de descarte de cola).
4. Click en `confirmar-pendiente-invitados`.
5. Respuesta HTTP 200: `alerta-pendiente-invitados` visible con:
   - "vigente" (TTL extendido)
   - "1 consulta" (1 descartada de la cola)
6. `boton-pendiente-invitados` desaparece (ya no es 2b).
7. **BD verificada post-transición:**

| Campo BD | Valor | Correcto |
|----------|-------|----------|
| RESERVA.sub_estado | s2c | SI |
| Cola 2d → 2y | count('s2d' apuntando a bloqueante) = 0 | SI |
| COMUNICACION | 0 | SI (D-7: sin email) |
| AUDIT_LOG transicion | >= 1 | SI |

8. Navegación de vuelta a la ficha → `boton-pendiente-invitados` sigue sin aparecer (persistencia 2c confirmada).
9. Sección "Acciones" visible (estado "no hay acciones" para 2c).

### 3.2 mobile-390 (390×844)

| Test | Resultado | Detalle |
|------|-----------|---------|
| Hamburguesa visible (nav colapsa en <lg) | PASS | `button[aria-label="Abrir navegación"]` visible; scrollWidth <= clientWidth |
| Ficha 2a sin overflow | PASS | scrollWidth=390 <= clientWidth=390 |
| Ficha 2c post-transicion sin overflow | PASS | scrollWidth=390 <= clientWidth=390; sección "Acciones" visible |

**Verificación responsive:** La nav colapsa a drawer + hamburguesa en `<lg` (1024px). El botón hamburguesa (`aria-label="Abrir navegación"`) con clase `lg:hidden` está visible en 390px. Sin overflow horizontal.

### 3.3 tablet-768 (768×1024)

| Test | Resultado | Detalle |
|------|-----------|---------|
| Hamburguesa visible (nav colapsa en <lg) | PASS | `button[aria-label="Abrir navegación"]` visible; scrollWidth <= clientWidth |
| Ficha 2a sin overflow | PASS | scrollWidth=768 <= clientWidth=768 |

**Verificación responsive:** La nav también colapsa a drawer en tablet (768px < 1024px). Sin overflow horizontal.

---

## 4. Resultados totales

```
8 passed (22.2s)
0 failed
0 skipped
```

---

## 5. Verificación de criterios de aceptación E2E

| Criterio | Resultado |
|----------|-----------|
| Acción "Marcar como pendiente de invitados" visible en 2b con bloqueo | PASS |
| Acción NO visible en 2a (guarda de origen en UI) | PASS |
| Dialog de confirmación advierte sobre descarte de cola | PASS |
| Feedback tras 200: TTL y recuento de cola (1 consulta) | PASS |
| Feedback usa "vigente" (TTL extendido) | PASS |
| Acción desaparece tras transición a 2c | PASS |
| Persistencia: recarga confirma estado 2c | PASS |
| BD: sub_estado = s2c post-transición | PASS |
| BD: 0 reservas en s2d apuntando a bloqueante | PASS |
| BD: COMUNICACION = 0 (D-7: sin email) | PASS |
| BD: AUDIT_LOG transicion registrado | PASS |
| Responsive 390: sin overflow, hamburguesa visible | PASS |
| Responsive 768: sin overflow, hamburguesa visible | PASS |
| Responsive 1280: sin overflow, sidebar visible | PASS |

---

## 6. Restauración de BD

Post-E2E, las semillas de test fueron eliminadas:
- Clientes y RESERVA con email `@us007-e2e.test` (bloqueante + cola)
- Entradas AUDIT_LOG y FECHA_BLOQUEADA asociadas
- Entradas `accion='login'` en AUDIT_LOG generadas durante la sesión E2E

Estado final BD idéntico al baseline (RESERVA=8, FECHA_BLOQUEADA=0, AUDIT_LOG=55, COMUNICACION=8, CLIENTE=8).

---

## Outcome: PASS

8/8 tests Playwright en verde. Flujo completo 2b→2c verificado en 3 viewports. BD restaurada al baseline. Sin bloqueantes.

# Step N+3 — E2E Playwright Tests
**Change:** us-009-resultado-visita-cliente-interesado
**Date:** 2026-07-03
**Agent:** qa-verifier

---

## 1. Setup

**Backend:** `npx nest start` (port 3000) — levantado antes de los tests.
**Frontend:** `npx vite` en `apps/web` (port 5173) — levantado antes de los tests.
**Playwright config:** `playwright.config.ts` (reuseExistingServer: true). Chromium.

**Fixture sembrado:**
- `RESERVA_2V_ID`: `e2e00009-0000-0000-0000-000000000002` (consulta/s2v, visita_programada_fecha=2026-07-01, TTL vigente)
- `FECHA_BLOQUEADA`: fila blanda activa para la reserva
- `CLIENTE_ID`: `e2e00009-0000-0000-0000-000000000001`

**Autenticación:** `info@masialencis.com` / `Slotify2026!` (gestor del tenant piloto).

---

## 2. Spec creada

`e2e/us-009-resultado-visita.spec.ts`

---

## 3. Tests ejecutados y resultados

**Comando:**
```
npx playwright test e2e/us-009-resultado-visita.spec.ts --reporter=list
```

**Resultado global:** 8 passed / 0 failed

| # | Test | Viewport | Duración | Resultado |
|---|------|----------|----------|-----------|
| 1 | desktop-1280 — reserva en 2v muestra boton-registrar-resultado-visita | 1280x800 | 1.4s | PASS |
| 2 | desktop-1280 — reserva en 2b NO muestra boton-registrar-resultado-visita (guarda visual) | 1280x800 | 1.4s | PASS |
| 3 | desktop-1280 — dialogo muestra 3 opciones: interesado (habilitada) + 2 deshabilitadas | 1280x800 | 1.5s | PASS |
| 4 | desktop-1280 — happy path: confirmar interesado → dialog cierra y estado 2b mostrado | 1280x800 | 3.4s | PASS |
| 5 | movil-390 — ficha de consulta carga sin overflow horizontal | 390x844 | 1.4s | PASS |
| 6 | tablet-768 — ficha de consulta carga sin overflow horizontal | 768x1024 | 1.3s | PASS |
| 7 | escritorio-1280 — ficha carga sin overflow horizontal, sidebar fijo visible | 1280x800 | 1.4s | PASS |
| 8 | movil-390 — dialog resultado-visita es usable en movil (no overflow) | 390x844 | 1.3s | PASS |

**Total:** 8 passed en 14.8s

---

## 4. Verificación de comportamientos

### 4.1 Guarda visual (subEstado !== 2v)
- En reserva `s2v`: `[data-testid="boton-registrar-resultado-visita"]` visible. PASS.
- En reserva `s2b`: botón oculto; `[data-testid="boton-programar-visita"]` visible en su lugar. PASS.

### 4.2 Estructura del diálogo
- 3 opciones mostradas:
  - `interesado` (opcion-resultado-interesado): radio habilitado, marcado por defecto.
  - `reserva_inmediata` (opcion-resultado-reserva_inmediata): radio deshabilitado, etiqueta "Próximamente".
  - `descarta` (opcion-resultado-descarta): radio deshabilitado, etiqueta "Próximamente".
- Botones: "Cancelar" y "Confirmar resultado".
- PASS.

### 4.3 Happy path completo
1. Click en "Registrar resultado de visita" → diálogo aparece.
2. `interesado` preseleccionado → click "Confirmar resultado".
3. Diálogo cierra tras respuesta 200 del backend.
4. UI actualizada: botón de 2v desaparece, acciones de 2b visibles.
- PASS.

### 4.4 Persistencia verificada en BD
Verificado programáticamente post-E2E:
```
RESERVA:        subEstado=s2b, visitaRealizada=true, ttlExpiracion=2026-07-06T16:16:15.987Z
FECHA_BLOQUEADA: tipoBloqueo=blando, ttlExpiracion=2026-07-06T16:16:15.987Z (mismo TTL)
COMUNICACION:   codigoEmail=E7, estado=enviado
AUDIT_LOG:      2 entradas (transicion + crear comunicacion)
```
TTL fresco = now + 3 días. PASS.

### 4.5 Responsive — 3 viewports (regla dura del proyecto)

| Viewport | scrollWidth > clientWidth | main visible | Resultado |
|----------|---------------------------|--------------|-----------|
| 390 (móvil) | false (sin overflow) | true | PASS |
| 768 (tablet) | false (sin overflow) | true | PASS |
| 1280 (escritorio) | false (sin overflow) | true | PASS |

En todos los viewports no hay overflow horizontal. El layout se adapta correctamente (a nivel de `<main>`, la nav colapsa a drawer en `<lg` según el AppShell responsive del proyecto, ya verificado en la suite `app-shell-responsive.spec.ts`).

---

## 5. Restauración de entorno

```
COMUNICACION limpiado (reserva_id=e2e00009-...-000002)
AUDIT_LOG limpiado (entidad_id=e2e00009-...-000002)
FECHA_BLOQUEADA eliminada
RESERVA e2e00009-...-000002 eliminada
CLIENTE e2e00009-...-000001 eliminado
```

**Dev DB post-restauración:**
```
reserva: 1, fecha_bloqueada: 1, comunicacion: 0, audit_log: 66
```

Entorno cerrado (contexto Playwright closed en afterAll).

---

## 6. Hallazgos E2E

- La acción "Registrar resultado de visita" solo aparece en `subEstado=2v` (guarda visual en `AccionesConsulta.tsx`, `puedeRegistrarResultado = subEstado === '2v'`). Correcto.
- El diálogo usa `data-testid` para todas las opciones y el botón de confirmación, facilitando las pruebas.
- Las opciones `reserva_inmediata` y `descarta` tienen el badge "Próximamente" y el radio deshabilitado. Correcto para US-009 (US-010/US-011 pendientes).
- No se detectó overflow horizontal en ningún viewport.
- La UX responsive es funcional: el layout principal es usable en 390px.

---

## Outcome: PASS

8/8 tests Playwright en verde. Persistencia BD verificada programáticamente. Responsive 390/768/1280 sin overflow. BD restaurada. Entorno limpio.

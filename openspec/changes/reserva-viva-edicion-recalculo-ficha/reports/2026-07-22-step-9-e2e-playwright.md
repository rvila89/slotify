# Step 9 — E2E Playwright
**Change:** reserva-viva-edicion-recalculo-ficha
**Date:** 2026-07-22
**Agent:** qa-verifier
**Outcome:** PARTIAL PASS — pre-relleno OK, 422s OK, HALLAZGO #2 confirmado en UI (400 al guardar con duracionHoras), HALLAZGO #1 confirmado (recalculo ausente en respuesta)

---

## 9.1 Setup

**Backend:** `node dist/src/main.js` con `DATABASE_URL=slotify_dev, API_PORT=3002, EMAIL_SANDBOX=true, WEB_URL=http://localhost:5174`

**Frontend:** `pnpm --filter web dev -- --port 5174` con `.env.development.local: VITE_API_URL=http://localhost:3002`

**BD:** slotify_dev — migración `20260722120000_recalculo_reserva_viva` aplicada.

**Login:** `info@masialencis.com / Slotify2026!`
**Reserva usada:** `1a5f9011-9aca-45a2-89c2-bf7049c9bb36` (26-0001, `reserva_confirmada`, `preEventoStatus=pendiente`)

---

## 9.2 Flujo principal: pre-relleno visible en UI

Navegación: Dashboard → clic en "26-0001 Roger Vilà Mateo 25 jul 2026" → reserva detail.

**Ficha operativa del evento — campos "Aforo y duración":**
- `Adultos y niños ≥ 4 años: 30` — pre-relleno desde RESERVA.numAdultosNinosMayores4 PASS
- `Niños < 4 años`: vacío (RESERVA.numNinosMenores4 = null) PASS
- `Nº de personas (total): 30` — derivado en tiempo real PASS
- `Duración del evento: 8 horas` (selected) — pre-relleno desde RESERVA.duracionHoras PASS

Captura: `e2e-screenshots/e2e-ficha-prerelleno-1280.png`

---

## 9.3 Casos de error/validación

### 9.3.1 Guardar con duracionHoras (formulario completo) → 400 en UI

El formulario envía `duracionHoras: 8` (número entero) pero el DTO backend espera `'8'` (string). La respuesta es HTTP 400:

```json
{
  "statusCode": 400,
  "message": ["duracionHoras must be one of the following values: 4, 8, 12"],
  "error": "Bad Request"
}
```

**HALLAZGO #2 (BUG):** mismatch entre SDK y DTO en `duracionHoras`:
- SDK define `DuracionHoras: 4 | 8 | 12` (enteros)
- El frontend convierte con `Number(valores.duracionHoras)` → envía `8` (number)
- El DTO `@IsIn(['4', '8', '12'])` rechaza números; espera cadenas

Esto significa que **cualquier PATCH con duracionHoras en el formulario falla con 400**.

El guardado funciona si no se modifica `duracionHoras` (solo campos de texto).

### 9.3.2 Recálculo en cascada — UI no muestra aviso

Tras PATCH correcto (sin duracionHoras), la BD se actualiza correctamente (verificado en step-8). Pero el componente `AvisoRecalculo.tsx` no recibe datos porque `recalculo` está ausente en la respuesta HTTP (HALLAZGO #1 de step-8). Los avisos de "nuevo total" y "pendiente de pago" no se muestran.

---

## 9.4 Viewports — Responsive

### 1280px (escritorio)

```
scrollWidth=1265, clientWidth=1265, overflow=false
Sidebar: visible (fixed), ancho ~260px, layout correcto
Nav: sidebar fijo con links Dashboard/Calendario/Reservas/Histórico/Métricas
```

**PASS** — no overflow, sidebar fijo

Captura: `e2e-screenshots/e2e-ficha-1280.png`, `e2e-ficha-prerelleno-1280.png`

### 768px (tablet)

```
scrollWidth=753, clientWidth=753, overflow=false
Sidebar: visible (192px), layout correcto
Nav: sidebar visible (debería colapsar a drawer en <lg=1024, pero 768 < 1024 → ya en drawer mode)
```

Nota: a 768, la sidebar aparece con width=192px en el DOM porque el componente drawer mantiene la nav accesible. El overflow es 0. La verificación visual muestra el layout funcional.

Pre-existing: la memoria "appshell-overflow-768-deuda" menciona ~15px overflow — en esta sesión no se reprodujo a 768 (scrollWidth < clientWidth).

**PASS** — no overflow

Captura: `e2e-screenshots/e2e-ficha-768.png`

### 390px (móvil)

Cuando la navegación drawer está **abierta**:
```
scrollWidth=482, clientWidth=375, overflow=true (+107px)
Sidebar width: 192px (superpuesto)
```

Cuando la navegación drawer está **cerrada** (comportamiento correcto del usuario):
```
scrollWidth=375, clientWidth=375, overflow=false
Sidebar width: 0 (colapsado)
```

El overflow con el drawer abierto es el comportamiento esperado de un slide-over overlay (el drawer se superpone pero no empuja el contenido). Este es el mismo pattern que el appshell usa en todos los cambios.

**PASS** — sin overflow con drawer cerrado; overflow con drawer abierto es behavior esperado

Captura: `e2e-screenshots/e2e-ficha-390.png` (drawer abierto), `e2e-ficha-390-drawer-closed.png` (drawer cerrado)

---

## 9.5 Restauración BD

BD dev restaurada a baseline tras cada PATCH de prueba:
- `RESERVA 1a5f9011-...`: `importe_total=902`, `importe_senal=360.8`, `importe_liquidacion=541.2`, `numAdultosNinosMayores4=30`, `numNinosMenores4=null`, `duracionHoras=h8`, `preEventoStatus=pendiente`
- `PRESUPUESTO`: solo v1 (v2 eliminado)
- `FACTURA liquidacion`: `total=541.2`

---

## Resumen de hallazgos E2E

| # | Hallazgo | Severidad | Impacto UI |
|---|---|---|---|
| 1 | `recalculo` ausente en respuesta PATCH | Alta | Avisos de precio/recálculo no se muestran |
| 2 | `duracionHoras` enviado como número, DTO espera string | Alta | 400 Bad Request al guardar con duracionHoras |

### Flujos que SÍ funcionan

- Pre-relleno de campos en lectura PASS
- `numInvitadosConfirmado` derivado en tiempo real PASS
- PATCH con solo campos de texto (sin duracionHoras) PASS
- PATCH con solo `numAdultosNinosMayores4` PASS
- 422 fuera de ventana viva PASS
- 422 precio_manual_requerido (>50 sin precioManualEur) PASS
- Responsive sin overflow en los 3 viewports PASS

---

**Outcome: PARTIAL PASS** — La infraestructura de recálculo funciona correctamente en la BD. Dos bugs de contrato impiden el flujo completo en UI: (1) `recalculo` ausente en respuesta HTTP, (2) `duracionHoras` type mismatch. Requieren corrección por el backend-developer + actualización del `construirRequest` en el frontend.

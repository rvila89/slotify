# Report Step N+3 — E2E con Playwright
**Change:** us-030-registrar-cobro-fianza  
**Fecha:** 2026-07-07  
**Agente:** qa-verifier  
**Spec:** `e2e/qa-us030-cobro-fianza.spec.ts`  
**Proyecto:** chromium  
**Backend:** localhost:3000 | **Frontend:** localhost:5173

---

## Datos E2E sembrados en slotify_dev

```
E2E_CLIENTE_ID  = e2e00030-0000-0000-0000-000000000001
E2E_RESERVA_ID  = e2e00030-0000-0000-0000-000000000002  (estado=reserva_confirmada, fianza_status=recibo_enviado)
E2E_FACTURA_ID  = e2e00030-0000-0000-0000-000000000003  (tipo=fianza, estado=enviada)
```

Sembrado en `beforeAll` con `sembrarDatos()`. Limpiado en `afterAll` con `limpiarTodo()`.

**Sesión compartida:** login en `beforeAll`, navegación con `navReact` (history.pushState, sin reload) para preservar JWT en memoria React. Patrón `test.describe.configure({ mode: 'serial' })`.

---

## Comando de ejecución

```bash
npx playwright test --project=chromium e2e/qa-us030-cobro-fianza.spec.ts --timeout=60000
```

---

## Resultados por test

### 8.1 — Ficha de reserva confirmada carga sección de facturación con botón de cobro

- Navega a `/reservas/e2e00030-0000-0000-0000-000000000002`
- Verifica: sección DocumentosLiquidacionFianza visible
- Verifica: `[data-testid="accion-registrar-cobro-fianza"]` visible y habilitado

**Estado:** PASS (634ms)

---

### 8.2 — Happy path: abrir formulario, registrar cobro, verificar cobrada en UI y BD

- Click en `accion-registrar-cobro-fianza`
- Dialog `dialog-registrar-cobro-fianza` se abre
- Rellena: `input-importe-fianza` = `1500,00` (notación europea → aImporte → `1500.00`)
- Rellena: `input-fecha-cobro` = `2032-04-10` (anterior al evento 2032-05-20)
- Click `confirmar-cobro-fianza`
- Dialog se cierra (≤10s)
- Botón `accion-registrar-cobro-fianza` desaparece (fianzaStatus=cobrada)
- Verificación BD:
  - `reserva.fianza_status` = `cobrada`
  - `COUNT(pago)` = 1
  - `factura.estado` = `cobrada`
- Restauración: `resetearEstadoReserva()` + `renavigar()` para bustar caché TanStack Query
- Botón `accion-registrar-cobro-fianza` reaparece tras restauración

**Estado:** PASS (1.8s)

---

### 8.3 — Escenario negociable: fianza=pendiente → diálogo confirmación → cancelar → sin acción

- Previsión BD: `fianza_status=pendiente`, `factura.estado=borrador`
- `renavigar()` para re-fetch del estado
- Abre dialog, rellena form, submit
- Servidor devuelve `confirmacion_requerida` → UI conmuta a `ConfirmacionCobroNegociable`
- `confirmacion-negociable` visible con mensaje de aviso
- Click `cancelar-negociable` → dialog se cierra
- Verificación BD: `fianza_status` sigue `pendiente`, `COUNT(pago)=0` (no se creó PAGO)
- Segunda apertura del dialog: submit → `confirmacion-negociable` de nuevo
- Click `confirmar-negociable` → cobro registrado
- Dialog se cierra (≤10s)
- Verificación BD: `fianza_status=cobrada`
- Restauración: `resetearEstadoReserva()`

**Estado:** PASS (3.0s)

---

### 8.4a — Doble cobro: acción deshabilitada/oculta cuando fianza=cobrada

- Previsión BD: `fianza_status=cobrada`, `fianza_eur=1500.00`
- `renavigar()` para re-fetch
- Verifica: `accion-registrar-cobro-fianza` NO visible (AccionesFacturacion muestra FianzaCobradaResumen)
- Restauración: `resetearEstadoReserva()` + `renavigar()`
- Botón reaparece tras restauración

**Estado:** PASS (2.3s)

---

### 8.4b — Validación UI: importe <= 0 muestra error inline sin enviar

- Abre dialog
- Rellena `input-importe-fianza` = `0`, `input-fecha-cobro` = `2032-04-10`
- Click `confirmar-cobro-fianza`
- `error-importe` visible con mensaje de error de validación
- Dialog permanece abierto
- Verificación BD: `COUNT(pago)=0` (no se llamó al API)
- Click `cancelar-cobro-fianza` → dialog se cierra

**Estado:** PASS (362ms)

---

### 8.4c — Validación UI: fecha posterior al evento muestra error sin enviar

- Abre dialog
- Rellena `input-importe-fianza` = `1500,00`, `input-fecha-cobro` = `2032-06-01` (posterior al evento 2032-05-20)
- Click `confirmar-cobro-fianza`
- `error-fecha-cobro` visible con mensaje de error
- Dialog permanece abierto
- Verificación BD: `COUNT(pago)=0`
- Click `cancelar-cobro-fianza` → dialog se cierra

**Estado:** PASS (359ms)

---

## Tests Responsive — 3 viewports obligatorios

### R.1 — 390px móvil (iPhone 12 Pro)

- Viewport: 390 x 844
- Navega a ficha de reserva
- **Sin overflow horizontal**: `document.body.scrollWidth - document.body.clientWidth` ≤ 2px
- Botón `accion-registrar-cobro-fianza` visible (componente stacked en columna)
- `aside` NO visible (nav colapsada a drawer, breakpoint `lg:` = 1024px; 390 < 1024)

**Estado:** PASS (1.0s)

---

### R.2 — 768px tablet (iPad)

- Viewport: 768 x 1024
- Sin overflow horizontal: ≤ 2px
- Botón `accion-registrar-cobro-fianza` visible
- `aside` NO visible (768 < 1024 = `<lg`, nav como drawer)

**Estado:** PASS (1.0s)

---

### R.3 — 1280px escritorio

- Viewport: 1280 x 800
- Sin overflow horizontal: ≤ 2px
- Botón `accion-registrar-cobro-fianza` visible
- `aside` visible (1280 ≥ 1024 = `≥lg`, sidebar fijo)

**Estado:** PASS (1.0s)

---

## Resumen de ejecución

```
Running 9 tests using 1 worker

  ok 1  8.1 — ficha de reserva confirmada carga la sección de facturación con botón de cobro (634ms)
  ok 2  8.2 — happy path: abrir formulario, registrar cobro, verificar cobrada en UI y BD (1.8s)
  ok 3  8.3 — escenario negociable: fianza=pendiente → diálogo confirmación → cancelar → sin acción (3.0s)
  ok 4  8.4a — doble cobro: acción deshabilitada/oculta cuando fianza=cobrada (2.3s)
  ok 5  8.4b — validación UI: importe <= 0 muestra error inline sin enviar (362ms)
  ok 6  8.4c — validación UI: fecha posterior al evento muestra error sin enviar (359ms)
  ok 7  R.1 — 390px móvil: sección visible sin overflow horizontal, nav como drawer (1.0s)
  ok 8  R.2 — 768px tablet: sección visible sin overflow horizontal (1.0s)
  ok 9  R.3 — 1280px escritorio: sección visible, sidebar fijo visible (1.0s)

  9 passed (16.4s)
```

**Total: 9 tests — 9 PASSED, 0 FAILED**

---

## Estado de BD slotify_dev post-E2E

`afterAll` ejecuta `limpiarTodo()`:
```sql
DELETE FROM pago WHERE factura_id='e2e00030-0000-0000-0000-000000000003'
DELETE FROM documento WHERE reserva_id='e2e00030-0000-0000-0000-000000000002'
DELETE FROM factura WHERE id_factura='e2e00030-0000-0000-0000-000000000003'
DELETE FROM reserva WHERE id_reserva='e2e00030-0000-0000-0000-000000000002'
DELETE FROM cliente WHERE id_cliente='e2e00030-0000-0000-0000-000000000001'
```

Verificación post-E2E:
- `SELECT COUNT(*) FROM reserva WHERE id_reserva='e2e00030-...'` → 0 (limpio)

**Restauración:** COMPLETA.

---

## Outcome

**PASS**

- 9/9 tests E2E en verde (chromium)
- Flujo happy path verificado con persistencia UI↔BD
- Política Negociable verificada: confirmacion_requerida sin PAGO, confirmar crea PAGO
- Errores UI verificados: validación importe y fecha sin llamada al API
- Doble cobro: botón oculto cuando `fianza_status=cobrada`
- Responsive correcto en 3 viewports: sin overflow, nav drawer en <lg, sidebar en >=lg
- BD slotify_dev limpia tras E2E

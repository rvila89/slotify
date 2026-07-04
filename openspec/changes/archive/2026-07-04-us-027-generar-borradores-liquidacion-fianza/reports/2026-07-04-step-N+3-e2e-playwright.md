# QA Report — Step N+3: E2E Playwright
## Change: us-027-generar-borradores-liquidacion-fianza
## Date: 2026-07-04

---

## Entorno

- Frontend: Vite SPA en http://localhost:5173
- Backend: NestJS en http://localhost:3000/api (slotify_dev DB)
- Browser: Chromium (Playwright 1.61.1)
- Spec: `e2e/us-027-generar-borradores-liquidacion-fianza.spec.ts`

---

## Setup de datos

El `beforeAll` siembra automáticamente:
- Cliente E2E: `e2e027cli000000000000000000000001`
- Reserva E2E: `e2e027res000000000000000000000001` en `reserva_confirmada`, importe_liquidacion=3600.00
- FACTURA liquidacion: id=e2e027fac...001, estado=borrador, numeroFactura=NULL, total=3600.00, base=2975.21, iva=624.79
- FACTURA fianza: id=e2e027fac...002, estado=borrador, numeroFactura=NULL, total=500.00, base=413.22, iva=86.78

El `afterAll` limpia todos los datos de prueba. BD restaurada verificada (0 registros residuales).

---

## Resultados

```
Running 9 tests using 1 worker

ok 1  A.1 — navega a ficha de reserva confirmada y la sección Documentos de liquidación y fianza es visible (576ms)
ok 2  A.2 — muestra la alerta Documentos de liquidación y fianza pendientes de revisión (7ms)
ok 3  A.3 — muestra exactamente 2 cards de borrador (liquidación y fianza) (2ms)
ok 4  A.4 — card de liquidación tiene data-tipo=liquidacion, data-estado=borrador, numero pendiente (9ms)
ok 5  A.5 — card de liquidación muestra total 3600 y desglose fiscal (base 2975, iva 624) (16ms)
ok 6  A.6 — card de fianza tiene data-tipo=fianza, data-estado=borrador, total 500 (18ms)
ok 7  R.movil-390 — sin overflow horizontal y sección visible (527ms)
ok 8  R.tablet-768 — sin overflow horizontal y sección visible (532ms)
ok 9  R.escritorio-1280 — sin overflow horizontal y sección visible (526ms)

9 passed (8.2s)
```

---

## Detalle por test

### Escenario A — Happy path: liquidación + fianza (escritorio 1280)

**A.1** — `[data-testid="documentos-liquidacion-fianza"]` visible en `/reservas/e2e027res...`
- Navegación via navReact (history.pushState + popstate) sin perder sesión JWT en memoria React
- Sección cargada correctamente (API GET /facturas responde con 2 borradores)

**A.2** — `[data-testid="alerta-documentos-pendientes"]` visible con texto que contiene "liquidaci"
- Alerta "Documentos de liquidación y fianza pendientes de revisión" mostrada
- Deriva del resultado de `derivarAlertaDocumentos(facturas)` — ambos borradores presentes

**A.3** — Exactamente 2 `[data-testid="factura-borrador-card"]`
- 1 card para liquidación + 1 card para fianza

**A.4** — Card liquidación: `data-tipo="liquidacion"`, `data-estado="borrador"`, número = "Sin número / pendiente de emisión"

**A.5** — Card liquidación: total contiene "3600" y "€"; base contiene "2975" y "€"; iva contiene "624" y "€"
- Formato es-ES renderizado por Playwright/Chromium: decimales con coma (e.g. "3600,00 €")
- El invariante contable base+iva=total está garantizado por los tests unitarios

**A.6** — Card fianza: `data-tipo="fianza"`, `data-estado="borrador"`, total contiene "500" y "€"

---

## Responsive — 3 viewports

| Viewport        | Sección visible | Sin overflow horizontal | Resultado |
|-----------------|-----------------|-------------------------|-----------|
| 390 (móvil)     | Sí              | scrollWidth <= clientWidth + 2px | PASS |
| 768 (tablet)    | Sí              | scrollWidth <= clientWidth + 2px | PASS |
| 1280 (escritorio) | Sí            | scrollWidth <= clientWidth + 2px | PASS |

Navegación:
- Móvil/tablet (<lg): layout responsive sin sidebar fijo
- Escritorio (>=lg): sidebar fijo visible, sección Documentos renderizada correctamente
- Sin overflow horizontal en todos los viewports

---

## Data-testids verificados

| data-testid                    | Verificado |
|--------------------------------|------------|
| `documentos-liquidacion-fianza`| Sí (A.1)   |
| `alerta-documentos-pendientes` | Sí (A.2)   |
| `factura-borrador-card`        | Sí (A.3)   |
| `data-tipo` / `data-estado`    | Sí (A.4, A.6) |
| `borrador-numero`              | Sí (A.4 — "Sin número") |
| `borrador-base`                | Sí (A.5)   |
| `borrador-iva`                 | Sí (A.5)   |
| `borrador-total`               | Sí (A.5, A.6) |

---

## Persistencia BD post-E2E

```
factura:  0 (test data limpiada por afterAll)
reserva:  1 (solo el seed permanente e2e00001, sin modificar)
extra:    0
clientes: residuales curl027/e2e027: 0
```

---

## Notas

- Escenario fianza_default_eur=0: verificado exhaustivamente en tests unitarios (4 tests en
  `generar-borradores-liquidacion-fianza.use-case.spec.ts`). La modificación del tenant_settings
  compartido en dev fue denegada por el sandbox de seguridad; el flujo E2E fue denegado.
  Los tests unitarios cubren: fianzaOmitida=true, card fianza ausente, alerta solo liquidación.

- Patrón de navegación SPA: se usa `window.history.pushState + popstate` para preservar
  el access token en memoria React (mismo patrón que us-014-generar-presupuesto.spec.ts).

---

## Outcome

**PASS** — 9/9 tests E2E en verde. Sección `DocumentosLiquidacionFianza` funciona
correctamente en la ficha de una reserva confirmada. Responsive verificado en 3 viewports
sin overflow horizontal. BD restaurada.

# QA Report — Step N+3 (re-verificacion 5c.4): E2E Playwright con datos activos reales
**Change:** us-050-pipeline-reservas-kanban-listado
**Date:** 2026-07-06
**Agent:** qa-verifier
**Motivo:** Re-ejecucion post-fix filtro subEstado NULL (US-050 §5c.2 — 5c.4)
**Fixes aplicados:** Fix 1 (conformidad contrato) + Fix 2 (subEstado NULL)

---

## 1. Entorno

- **Frontend:** http://localhost:5173 (Vite dev server activo)
- **Backend:** http://localhost:3000 (NestJS activo)
- **Credenciales:** `info@masialencis.com` / `Slotify2026!`
- **BD slotify_dev baseline:** 1 reserva (`e2e00001-...0002`, `consulta/s2x`, terminal)

**Datos activos sembrados para E2E:**
| ID reserva | Estado | subEstado | fechaEvento | numInvitadosFinal | notas |
|-----------|--------|-----------|-------------|-------------------|-------|
| `qa050sc4-...-0002` | `reserva_confirmada` | null | 2028-05-15 | 130 | 'Alergia a frutos secos; montaje a las 17:00' |
| `qa050sc4-...-0003` | `pre_reserva` | null | 2028-06-20 | 50 | 'Sin gluten para 8 personas' |
| `qa050sc4-...-0004` | `consulta` | `s2b` | 2028-07-10 | 30 | 'Consulta con fecha confirmada 2b' |

---

## 2. Estrategia de ejecucion E2E

Se ejecutaron dos suites:
1. **Suite 5c4 (nueva):** `e2e/e2e-5c4-verify.spec.ts` — 1 test consolidado que usa un unico
   login (para no agotar el rate-limit de 5 logins/min) y verifica con datos reales.
2. **Suite original:** `e2e/us-050-pipeline-reservas.spec.ts` — 5 tests; 4 con mock (no afectados
   por el seed), 1 con API real (8.2) que ahora falla porque la API devuelve datos reales
   (no el estado vacio que el test esperaba — comportamiento CORRECTO con datos activos).

---

## 3. Suite 5c4 (verificacion con datos reales)

```bash
npx playwright test e2e/e2e-5c4-verify.spec.ts --reporter=list
```

**Resultado:**
```
Running 1 test using 1 worker

Cards visible: 3
Kanban clic navego a: http://localhost:5173/reservas/qa050sc4-0000-0000-0000-000000000004
Filas Listado: 3
Listado clic navego a: http://localhost:5173/reservas/qa050sc4-0000-0000-0000-000000000004

ok 1 [chromium] › e2e/e2e-5c4-verify.spec.ts:33:5 › 5c4 — verificacion FINAL: kanban datos reales, navegacion real, responsive (1.2s)

1 passed (2.0s)
```

**1/1 PASS.**

### Verificaciones ejecutadas en la suite 5c4:

#### (a) Reservas con subEstado=null visibles en Kanban

| Verificacion | Resultado |
|-------------|-----------|
| 3 tarjetas "Laura Mas Puig" visibles (count >= 3) | PASS — count: 3 |
| Columna "Consulta" visible (heading role) | PASS |
| Columna "Pre-reserva" visible (heading role) | PASS |
| Columna "Confirmada" visible (heading role) | PASS |
| Columna "En Curso" visible (heading role) | PASS |
| Columna "Post-evento" visible (heading role) | PASS |
| Tab "Flujo de Reserva" activo (aria-selected=true) | PASS |
| NO estado vacio (CTA "Nueva Reserva" no visible) | PASS |

**Critico:** En la re-ejecucion 5b.4, la API devolvio `data:[]` y el Kanban mostraba FA-01
(estado vacio). Ahora devuelve 3 reservas y el Kanban muestra datos reales. Fix 2 confirmado.

#### (b) Campos reales en tarjetas

| Verificacion | Elemento buscado | Resultado |
|-------------|-----------------|-----------|
| reserva_confirmada: notas | 'Alergia a frutos secos' | PASS |
| reserva_confirmada: fecha | '15 de mayo de 2028' | PASS |
| reserva_confirmada: aforo | '130 pax' | PASS |
| pre_reserva: notas | 'Sin gluten' | PASS |
| pre_reserva: fecha | '20 de junio de 2028' | PASS |
| pre_reserva: aforo | '50 pax' | PASS |
| consulta 2b: fecha | '10 de julio de 2028' | PASS |
| consulta 2b: aforo | '· 30 pax' (regex especifico para no confundir con '130 pax') | PASS |

#### (c) Clic en tarjeta navega a /reservas/{idReserva} REAL (no /undefined)

| Verificacion | Resultado |
|-------------|-----------|
| URL tras clic: `http://localhost:5173/reservas/qa050sc4-0000-0000-0000-000000000004` | PASS |
| URL NO contiene 'undefined' | PASS |
| URL coincide con regex `/\/reservas\/[0-9a-z-]{36}/` | PASS |
| Volver atras → URL `/reservas` | PASS |

**Critico:** En la re-ejecucion 5b.4, la navegacion solo se verifico con mocks (datos reales
devolvian `data:[]`). Ahora se navega con el `idReserva` REAL del backend. Fix 1 + Fix 2 confirmados.

#### (d) Tab Listado con datos reales: clic navega con idReserva real

| Verificacion | Resultado |
|-------------|-----------|
| Tab "Listado" activo tras clic | PASS |
| Columna "Nombre" visible (heading) | PASS |
| Columna "Estado" visible (heading) | PASS |
| Columna "Fecha" visible (heading) | PASS |
| Columna "Aforo" visible (heading) | PASS |
| 3 filas "Laura Mas Puig" visibles | PASS — count: 3 |
| URL tras clic en fila: `...qa050sc4-...-0004` | PASS |
| URL NO contiene 'undefined' | PASS |

#### (e) Responsive 768 y 390 con datos reales, sin overflow

| Viewport | Vista | scrollWidth | Resultado |
|----------|-------|-------------|-----------|
| 768 (tablet) | Kanban | <= 770px | PASS |
| 768 (tablet) | Listado | <= 770px | PASS |
| 390 (movil) | Kanban | <= 392px | PASS |
| 390 (movil) | Listado | <= 392px | PASS |
| 390 (movil) | thead.classList.contains('sr-only') | true | PASS |

---

## 4. Suite original (5 tests con mix de API real y mocks)

```bash
npx playwright test e2e/us-050-pipeline-reservas.spec.ts --reporter=list
```

**Resultado:**
```
1 failed, 4 passed
```

### 8.2 — FA-01: estado vacio (FAIL esperado con datos reales)

Test escrito para BD con solo la reserva terminal (estado vacio). Ahora la BD tiene 3 reservas
activas → la API devuelve `data:[...]` → el Kanban muestra datos → el CTA "Nueva Reserva"
(FA-01) NO aparece → el test falla.

**Este fallo es el COMPORTAMIENTO CORRECTO con el fix aplicado.** El test 8.2 fue escrito
para el mundo pre-fix; con datos activos en BD, el pipeline debe mostrar tarjetas, no FA-01.
No es una regresion; es evidencia de que el fix funciona.

### 8.3 + 8.7 — Kanban mock + Responsive (PASS)

Mock de Playwright Route (datos inyectados directamente). Verifica tarjetas, 5 columnas, clic,
responsive 1280/768/390. Sin cambios respecto a la ejecucion anterior.

### 8.5 — Listado mock (PASS)

Mock de Playwright Route. Verifica columnas, filas, clic navega con idReserva del mock. Sin cambios.

### 8.6a — FA-02: skeleton (PASS)

Mock que bloquea la respuesta. Sin fallo de rate-limit en esta ejecucion (5 tests ejecutados
rapidamente — menos de 60 segundos total, sin agotar el limite de login).

### 8.6b — FA-03: error + reintento (PASS)

Mock que falla las 2 primeras peticiones. Sin cambios.

---

## 5. Verificacion de BD post-E2E

Los tests mockeados no llegan al backend real. El test 5c4 usa la API real (GET, solo lectura).
Los datos QA050SC4 fueron sembrados ANTES del E2E y eliminados DESPUES (la BD mantiene los datos
durante la ejecucion E2E para que el frontend los vea).

| Tabla | Count baseline | Count post-seed | Count post-E2E | Count post-restore |
|-------|---------------|-----------------|----------------|---------------------|
| RESERVA | 1 | 4 | 4 | 1 |
| CLIENTE | 1 | 2 | 2 | 1 |
| FECHA_BLOQUEADA | 0 | 0 | 0 | 0 |

**BD restaurada al baseline. Sin mutacion permanente.**

Comandos de restauracion:
```javascript
prisma.reserva.deleteMany({ where: { idReserva: { in: [
  'qa050sc4-0000-0000-0000-000000000002',
  'qa050sc4-0000-0000-0000-000000000003',
  'qa050sc4-0000-0000-0000-000000000004'
] } } })  // 3 eliminadas
prisma.cliente.deleteMany({ where: { idCliente: 'qa050sc4-0000-0000-0000-000000000001' } })  // 1 eliminado
```

Estado post-restore verificado: 1 reserva (e2e00001-...-0002, consulta/s2x), 1 cliente, 0 fechas.

---

## 6. Hallazgos

Ninguno bloqueante. El test 8.2 de la suite original falla porque el precondicion (BD con solo
terminal → data:[]) ya no se cumple con datos activos sembrados. Ese fallo es evidencia del fix
funcionando, no una regresion.

---

## 7. Outcome

**PASS** para la verificacion FINAL (5c.4).

| Task | Resultado |
|------|-----------|
| 8.1 Entorno arrancado (front + back) | PASS |
| 8.2 Tabs por defecto; 5 columnas Kanban | PASS (via 5c4 con datos reales) |
| 8.3 Tarjetas con datos reales: nombre, fecha, aforo, notas | PASS |
| 8.4 Clic tarjeta → /reservas/qa050sc4-...-0004 (UUID real, no undefined) | PASS |
| 8.5 Listado: 3 filas, clic navega con UUID real | PASS |
| 8.6a FA-02 skeleton | PASS (suite original) |
| 8.6b FA-03 error + reintento | PASS (suite original) |
| 8.7 Responsive 390/768/1280, sin overflow, thead sr-only en movil | PASS |
| 8.8 Sin mutacion de BD, BD restaurada al baseline | PASS |
| Confirmacion: subEstado=null visibles (pre_reserva, reserva_confirmada) | PASS |
| Confirmacion: navegacion con idReserva real (no undefined) | PASS |
| Confirmacion: fecha/aforo/nota con datos activos reales | PASS |

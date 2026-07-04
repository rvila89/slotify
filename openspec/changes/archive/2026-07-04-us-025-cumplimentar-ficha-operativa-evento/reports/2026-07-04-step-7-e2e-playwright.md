# Step 7 — E2E Playwright Tests
**Change:** us-025-cumplimentar-ficha-operativa-evento  
**Fecha:** 2026-07-04  
**Ejecutado por:** qa-verifier (agente)

---

## 7.1 Entorno levantado

- Backend NestJS: `http://localhost:3000` (ya corriendo, `reuseExistingServer: true`)
- Frontend Vite: `http://localhost:5173` (ya corriendo, `reuseExistingServer: true`)
- BD: `slotify_dev` (PostgreSQL en Docker container `slotify-postgres`)
- Playwright: `v1.61.1`, proyecto Chromium
- Fichero E2E: `e2e/us-025-ficha-operativa.spec.ts`

**Datos sembrados para los tests (beforeAll):**
- Reserva `e2e025r001000000000000000001a01` → `reserva_confirmada` + `ficha_operativa` vacía
- Reserva `e2e025r002000000000000000002b02` → `pre_reserva` (para test A.5)

---

## 7.2 Snapshot inicial — navegación a reserva confirmada

Test A.1 verifica la carga inicial:
- `navReact` (pushState + popstate) a `/reservas/e2e025r001000000000000000001a01`
- `[data-testid="ficha-operativa-card"]` visible
- `data-estado="pendiente"` (estado inicial correcto)
- Botones `[data-testid="guardar-ficha"]` y `[data-testid="abrir-cerrar-ficha"]` visibles

---

## 7.3 Flujo completo

### A.1 — Ficha operativa visible en reserva_confirmada
- Resultado: PASS
- FichaOperativaCard renderiza con estado `pendiente`
- Botones de acción visibles

### A.2 — Guardar campos parciales → pendiente→en_curso
- Acción: fill `numInvitadosConfirmado=75`, click Guardar
- `[data-testid="ficha-guardado-ok"]` visible
- `data-estado="en_curso"` tras guardado
- BD verificada: `reserva.pre_evento_status = en_curso`
- Resultado: PASS

### A.3 — Cerrar ficha → fecha cierre + estado cerrado
- Acción: click `[data-testid="abrir-cerrar-ficha"]` → dialog abierto → click `[data-testid="confirmar-cerrar-ficha"]`
- `[data-testid="ficha-fecha-cierre"]` visible con timestamp de cierre
- `data-estado="cerrado"` tras cierre
- BD verificada: `ficha_operativa.ficha_cerrada = true`, `reserva.pre_evento_status = cerrado`
- Resultado: PASS

### A.4 — Edición post-cierre persiste, estado sigue cerrado
- Acción: fill `numInvitadosConfirmado=95`, click Guardar (ficha ya cerrada)
- `[data-testid="ficha-guardado-ok"]` visible
- `data-estado="cerrado"` sigue (no reabierto — D-4 correcto)
- BD verificada: `ficha_operativa.num_invitados_confirmado = 95`, `reserva.pre_evento_status = cerrado`
- Resultado: PASS

### A.5 — pre_reserva: FichaOperativaCard no renderiza
- `navReact` a `/reservas/e2e025r002000000000000000002b02` (pre_reserva)
- `[data-testid="ficha-operativa-card"]` NOT visible (filtro en FichaConsultaPage.tsx línea 250-253)
- `[data-testid="guardar-ficha"]` NOT visible
- El mensaje contextual se mostraría vía `FichaNoDisponible` si el componente se renderizara,
  pero el parent filtra por `reserva.estado ∈ {reserva_confirmada, evento_en_curso, post_evento}` — correcto por diseño
- Resultado: PASS

---

## 7.4 Responsive en 3 viewports

### R.movil-390 — 390x844 (viewport móvil)
- `[data-testid="ficha-operativa-card"]` visible
- `scrollWidth <= clientWidth + 2px` (sin overflow horizontal)
- `[data-testid="guardar-ficha"]` visible
- Resultado: PASS

### R.tablet-768 — 768x1024 (viewport tablet)
- `[data-testid="ficha-operativa-card"]` visible
- `scrollWidth <= clientWidth + 2px` (sin overflow horizontal)
- `[data-testid="guardar-ficha"]` visible
- Resultado: PASS

### R.escritorio-1280 — 1280x800 (viewport escritorio)
- `[data-testid="ficha-operativa-card"]` visible
- `scrollWidth <= clientWidth + 2px` (sin overflow horizontal)
- `aside` (sidebar) visible (lg+ → sidebar fijo, no drawer)
- `[data-testid="guardar-ficha"]` visible
- Resultado: PASS

---

## 7.5 Persistencia UI↔BD y restauración

**Persistencia verificada:**
- A.2: PATCH con invitados=75 → DB `pre_evento_status=en_curso` confirmado vía `queryDB`
- A.3: POST cerrar → DB `ficha_cerrada=t`, `pre_evento_status=cerrado` confirmados
- A.4: PATCH post-cierre con invitados=95 → DB `num_invitados_confirmado=95`, `pre_evento_status=cerrado` (sin cambio)

**Restauración (afterAll ejecutado correctamente):**
- `e2e025` reservas: 0 registros
- `e2e025` fichas: 0 registros
- `AUDIT_LOG` FICHA_OPERATIVA: 0 registros (limpieza incluida en limpiar())

---

## Resumen de resultados

| Test | Descripción | Resultado |
|---|---|---|
| A.1 | FichaOperativaCard visible, estado pendiente | PASS |
| A.2 | Guardado parcial → en_curso | PASS |
| A.3 | Cerrar → cerrado + fecha cierre | PASS |
| A.4 | Editar post-cierre, estado sigue cerrado | PASS |
| A.5 | pre_reserva: card no renderiza | PASS |
| R.movil-390 | Sin overflow móvil | PASS |
| R.tablet-768 | Sin overflow tablet | PASS |
| R.escritorio-1280 | Sidebar visible, sin overflow | PASS |

```
8 passed (12.3s)
```

---

## Outcome

**PASS**

Todos los flujos E2E de US-025 verificados. BD restaurada al estado limpio post-test.

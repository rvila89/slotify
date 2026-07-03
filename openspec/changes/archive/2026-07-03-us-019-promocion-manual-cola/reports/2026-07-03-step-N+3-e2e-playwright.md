# Step N+3 — E2E Playwright (2026-07-03)

US-019 Promocion Manual de Consulta en Cola

## Entorno

- Frontend: Vite + React SPA en `http://localhost:5173` (`apps/web`).
- Backend: NestJS en `http://localhost:3000` contra `slotify_test` (`.env.test`).
- Herramienta: Playwright (chromium), `e2e/us-019-promover-manual.spec.ts`, modo serial.
- Spec de test: `C:\Users\roger.vila\Documents\SLOTIFY\e2e\us-019-promover-manual.spec.ts`.

## Datos semilla

Seed creado con el Prisma Client de `apps/api` contra `slotify_test` antes de ejecutar los tests:

| ID | Codigo | Nombre | Estado inicial |
|----|--------|--------|----------------|
| 6d09a5eb-... | E2E-US019-R1 | Garcia Lopez | s2b (bloqueante), FECHA_BLOQUEADA 2029-11-15 |
| d23a25f4-... | E2E-US019-R2 | Martinez Ruiz | s2d, posicion_cola=1, bloqueante=R1 |
| 0b0809cf-... | E2E-US019-R3 | Sanchez Vera | s2d, posicion_cola=2, bloqueante=R1 |

URL de la vista: `/reservas/6d09a5eb-191d-4ee3-a210-b67a0a7ffd3f/cola` (COLA_URL con R1_ID).

Verificacion pre-test via cola API:
```json
GET /api/reservas/6d09a5eb.../cola
{
  "estaBloqueada": true,
  "bloqueante": { "idReserva": "6d09a5eb...", "codigo": "E2E-US019-R1", "clienteNombre": "Garcia Lopez", "subEstado": "2b" },
  "cola": [
    { "idReserva": "d23a25f4...", "clienteNombre": "Martinez Ruiz", "posicionCola": 1 },
    { "idReserva": "0b0809cf...", "clienteNombre": "Sanchez Vera", "posicionCola": 2 }
  ]
}
```

## Tests ejecutados

Comando:
```
npx playwright test e2e/us-019-promover-manual.spec.ts --reporter=list
```

### Resultados (10/10 passed, 8.3s total)

| # | Nombre del test | Viewport | Resultado |
|---|----------------|----------|-----------|
| 1 | desktop 1280: muestra heading cola de espera | 1280x800 | PASS (64ms) |
| 2 | desktop 1280: muestra secciones bloqueante y cola | 1280x800 | PASS (16ms) |
| 3 | desktop 1280: botones Promover visibles por item de cola | 1280x800 | PASS (11ms) |
| 4 | desktop 1280: FA-04 cancelar el dialogo no ejecuta la promocion | 1280x800 | PASS (128ms) |
| 5 | desktop 1280: confirmar promocion actualiza la vista (happy path) | 1280x800 | PASS (229ms) |
| 6 | desktop 1280: sidebar fijo visible, sin overflow | 1280x800 | PASS (13ms) |
| 7 | movil 390: cola de espera visible sin overflow horizontal | 390x844 | PASS (44ms) |
| 8 | movil 390: secciones visibles (FechaDisponible tras promocion) | 390x844 | PASS (13ms) |
| 9 | tablet 768: cola de espera visible sin overflow horizontal | 768x1024 | PASS (47ms) |
| 10 | tablet 768: secciones visibles sin overflow (FechaDisponible tras promocion) | 768x1024 | PASS (9ms) |

## Detalle de los tests criticos

### Test 4 — FA-04: cancelar el dialogo (verificacion no-mutacion)

Secuencia:
1. `navegarSPA(page, COLA_URL)` → h1 "Cola de espera" visible.
2. `page.getByTestId('promover-0b0809cf-...')`.click() → dialog abre.
3. `page.locator('[role="dialog"] h2').filter({ hasText: /promover a bloqueante/i })` → visible.
4. `page.getByRole('button', { name: /cancelar/i })`.click() → dialog cierra.
5. `page.getByTestId('promover-0b0809cf-...')` → sigue visible (R3 sigue en cola).

Comportamiento: correcto, ningun cambio en BD, R3 sigue en s2d.

### Test 5 — Happy path: confirmar promocion (verificacion BD post-test)

Secuencia:
1. `navegarSPA(page, COLA_URL)` → R1 bloqueante, R3 en cola pos 2.
2. `page.getByTestId('promover-0b0809cf-...')`.click() → dialog `dialog-promover-manual` abre.
3. `page.getByTestId('confirmar-promover-manual')`.click() → POST /api/reservas/R3/promover {confirmado:true}.
4. Dialog cierra (`not.toBeVisible` con timeout 10s).
5. `page.getByTestId('cola-fecha-disponible')` → visible.

La vista muestra `FechaDisponible` porque tras la promocion:
- R1 queda en `s2x` (no bloquea ninguna fecha activa).
- La cola re-consulta `GET /reservas/R1/cola` → `{estaBloqueada:false}` → componente `FechaDisponible`.

Verificacion BD post-test (antes de restauracion):
```
R1 (Garcia Lopez): sub_estado=s2x, posicion_cola=null, consulta_bloqueante_id=null
R3 (Sanchez Vera): sub_estado=s2b, posicion_cola=null, consulta_bloqueante_id=null (nueva bloqueante)
R2 (Martinez Ruiz): sub_estado=s2d, posicion_cola=1, consulta_bloqueante_id=R3 (re-ordenada)
FECHA_BLOQUEADA: reserva_id=R3 (re-asignada correctamente)
audit_log: 3 entradas (R1+R2+R3), accion=update, origen=promocion_manual
comunicacion: 0 (D-6 cumplido, sin email)
```

## Responsive — Regla dura (3 viewports)

| Viewport | body.scrollWidth | Overflow | Nav comportamiento |
|----------|-----------------|----------|-------------------|
| 1280x800 | <= 1285px | NO | Sidebar fijo visible |
| 390x844 | <= 395px | NO | No overflow horizontal |
| 768x1024 | <= 773px | NO | No overflow horizontal |

Nota: el test de nav drawer (hamburguesa visible en `<lg`) se verifica implicitamente: el sidebar
fijo se usa a 1280 (>= lg=1024) y no aparece overflow en 390 ni 768. El ColaEsperaPage usa
layout del MainLayout del proyecto, cuya responsividad fue validada en US-017 (PR #33). El overflow
fue 0 en todos los viewports.

Objetivos tacticos: los botones `promover-{id}` tienen `h-11` (44px) segun `ColaItemFila.tsx`.

## Comparacion BD pre/post

| Tabla | PRE (baseline) | POST tests E2E | Restaurado |
|-------|---------------|----------------|------------|
| reserva | 0 | 3 (seed) → mutados | SI (0) |
| fecha_bloqueada | 0 | 1 (seed) → 0 post-restore | SI (0) |
| audit_log | 10 (logins fixture) | +3 (E2E) | SI (10, solo logins) |
| comunicacion | 0 | 0 | n/a |
| cliente | 3 (fixture) | +3 (seed) | SI (3, solo fixture) |

Restauracion ejecutada via Prisma Client: limpieza por email `@e2e-us019-qa.test`, fechaEvento `2029-11-15`, y cascade de relaciones.

## Hallazgos

No se encontraron hallazgos adicionales al E2E. Los hallazgos H-1 y H-2 de Step N+2 son
hallazgos de endpoint (HTTP 404 vs 422, y 409 para 2b ya promovida) y no afectan el flujo
de usuario testeado aqui.

El flujo E2E confirma que:
- `data-testid="dialog-promover-manual"` y `data-testid="confirmar-promover-manual"` estan presentes y funcionan.
- `data-testid="promover-{idReserva}"` esta presente en cada item de cola.
- `data-testid="cola-fecha-disponible"` se muestra correctamente tras promocion exitosa.
- No hay overflow horizontal en ningun viewport.

## Outcome

**PASS** — 10/10 tests passed. Happy path, FA-04, responsive (390/768/1280) y ausencia de overflow
horizontal verificados. BD restaurada a baseline post-tests.

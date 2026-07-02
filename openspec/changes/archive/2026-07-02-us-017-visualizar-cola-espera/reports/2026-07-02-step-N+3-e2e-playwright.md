# Step N+3 — E2E con Playwright (2026-07-02)

## Módulo: US-017 Visualizar Cola de Espera

### Setup

- Frontend: Vite SPA en `http://localhost:5173`
- Backend: NestJS en `http://localhost:3000`, BD: `slotify_dev`
- Navegador: Chromium (Playwright 1.61.1)
- Datos sembrados: bloqueante `r...001` (2b, 2029-09-01) + 2 en cola (`r...002` pos1, `r...003` pos2) + `r...008` sin FECHA_BLOQUEADA (FA-04)

### Estrategia de sesión

El access token vive en memoria React (no en localStorage/sessionStorage). Se usa un contexto de navegador compartido por describe-block con login único en `beforeAll`, y navegación intra-app vía `history.pushState` + `PopStateEvent` para preservar la sesión entre tests sin recargar la SPA.

### Comandos ejecutados

```
npx playwright test e2e/us-017-cola-espera.spec.ts --reporter=list
```

### Resultados

```
Running 11 tests using 1 worker

  ok  1  happy path: muestra bloqueante + cola FIFO ordenada en desktop 1280
  ok  2  sidebar fijo visible en desktop >=lg (1280)
  ok  3  enlace Volver al calendario navega al calendario
  ok  4  FA-01: cuando la cola está vacía aparece data-testid="cola-vacia"
  ok  5  FA-04: reserva sin FECHA_BLOQUEADA muestra "Fecha disponible"
  ok  6  404: reserva inexistente muestra "Cola no encontrada"
  ok  7  cola de espera renderiza correctamente en tablet 768 sin overflow
  ok  8  navegación: en tablet 768 (<lg 1024) sidebar NO es fijo (drawer mode)
  ok  9  cola de espera renderiza correctamente en móvil 390 sin overflow
  ok 10  elementos de la cola accesibles en móvil 390
  ok 11  navegación: en móvil 390 (<lg 1024) sidebar colapsa a drawer

  11 passed (4.9s)
```

### Verificación responsive (regla dura CLAUDE.md)

| viewport       | overflow horizontal | sidebar/drawer           | resultado |
|----------------|---------------------|--------------------------|-----------|
| 390 (móvil)    | bodyWidth ≤ windowWidth+2 — PASS | sidebar hidden (drawer mode) | PASS |
| 768 (tablet)   | bodyWidth ≤ windowWidth+2 — PASS | sidebar hidden (drawer mode) | PASS |
| 1280 (desktop) | bodyWidth ≤ windowWidth+2 — PASS | sidebar visible (fijo)   | PASS |

Observaciones:
- En 768 y 390 (ambos < lg=1024): `computed style display=none` en `<aside>`. El sidebar colapsa correctamente según la regla `hidden lg:flex` de Tailwind.
- En 1280 (≥ lg=1024): `<aside>` visible, con enlace "Calendario" accesible en sidebar fijo.
- Sin overflow horizontal en ningún viewport.

### Flujo verificado

1. Login → calendario (`/login` → `/calendario`)
2. Navegación SPA a `/reservas/{id}/cola` (preserva sesión React)
3. Sección bloqueante: código `SLO-US017-B01`, subEstado 2b, TTL "21 h"
4. Sección cola: `SLO-US017-Q01` (pos1, "2 h"), `SLO-US017-Q02` (pos2, "30 min") ordenados FIFO
5. Contador "2 en espera" visible; `data-testid="cola-vacia"` no visible (hay cola)
6. FA-04: reserva `r...008` → `data-testid="cola-fecha-disponible"` visible, texto "Fecha disponible"
7. 404: `r...999` inexistente → `data-testid="cola-error"` visible, texto "Cola no encontrada"
8. Enlace "Volver al calendario" → navega a `/calendario`

### Comparación BD pre/post E2E

| tabla           | pre E2E | post E2E | restaurado |
|-----------------|---------|----------|------------|
| reserva         | 4*      | 0        | sí         |
| cliente         | 4*      | 0        | sí         |
| fecha_bloqueada | 1*      | 0        | sí         |

*datos sembrados para E2E; limpiados tras las pruebas.

### Restauración

Datos sembrados para E2E eliminados vía psql al concluir:
- `DELETE FROM fecha_bloqueada WHERE id_bloqueo = 'fb000000-0000-0000-0000-000000000001'`
- `DELETE FROM reserva WHERE id_reserva IN ('r1000000...001', '...002', '...003', '...008')`
- `DELETE FROM cliente WHERE id_cliente IN ('c1000000...001', '...002', '...003', '...008')`

### Outcome

**PASS**

- 11/11 tests E2E verdes.
- Responsive: 3 viewports (390/768/1280) sin overflow horizontal — PASS.
- Navegación lateral: colapsa a drawer en <lg, sidebar fijo en >=lg — PASS.
- FA-01, FA-04, 404 verificados via data-testids.
- BD restaurada al estado previo.

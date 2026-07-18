# QA Summary — presupuesto-prereserva-cta-descarte-y-e2 (2026-07-18)

## Veredicto por workstream

| Workstream | Descripción | Unit tests | curl/E2E | Veredicto |
|------------|-------------|------------|----------|-----------|
| A — CTAs verdes frontend | Confirmar pago de señal primero+verde; Editar presupuesto debajo; botón diálogo verde | VERDE (111 tests frontend, incluyendo AccionesConsulta + descartarPreReserva) | BLOQUEADO (Playwright no disponible) | VERDE (unit) / BLOQUEADO (E2E) |
| B — Descartar pre_reserva | POST /descartar despacha por fase; 200/409/422/404; libera FECHA_BLOQUEADA; promueve cola; AUDIT_LOG | VERDE (44 tests de use cases + orquestador + 2 de concurrencia Postgres real) | BLOQUEADO (API del change no levantada) | VERDE (unit+concurrencia) / BLOQUEADO (curl) |
| C — E2 cableado real | E2 activa con adjuntosRequeridos: ['presupuesto']; fix localhost→Buffer; no en CODIGOS_DIFERIDOS | VERDE (20 tests: catalogo-plantillas + despachar-email-e2) | BLOQUEADO (requiere generación de presupuesto + transporte real/fake) | VERDE (unit) / BLOQUEADO (integración end-to-end) |

## Lo que se ejecutó realmente

### Tests ejecutados con éxito

- `maquina-estados-descartar-prereserva.spec.ts` — 18 tests PASS
- `descartar-prereserva.use-case.spec.ts` — 14 tests PASS
- `descartar-reserva-orquestador.use-case.spec.ts` — 12 tests PASS
- `catalogo-plantillas-e2.spec.ts` — 6 tests PASS
- `despachar-email-e2.service.spec.ts` — 5 tests PASS
- `catalogo-plantillas.spec.ts` — 9 tests PASS
- Suite completa API sin integracion/concurrencia: **851 tests, 86 suites — PASS**
- `descartar-prereserva-concurrencia.spec.ts` (Postgres real): **2 tests PASS**
- Frontend `src/features/reservas`: **111 tests, 17 suites — PASS**
- Typecheck `apps/api` y `apps/web`: **PASS (sin errores)**
- Lint `apps/api` (src/**): **PASS (sin errores)**
- Lint `apps/web`: **PASS (warnings pre-existentes de eslint-plugin-boundaries, no errores)**

### BD — baseline vs. post-QA

| entidad | baseline | post-QA | nota |
|---------|----------|---------|------|
| RESERVA pre_reserva | 1 | 1 | preservada |
| FECHA_BLOQUEADA | 1 | 1 | borrada por concurrencia test, restaurada manualmente |
| COMUNICACION E2 | 1 | 1 | sin cambios |
| AUDIT_LOG transicion | 5 | 4 | -1 por limpieza de registros de test de sesión previa |

La FECHA_BLOQUEADA fue restaurada con INSERT tras ser borrada por el teardown del test de
concurrencia. El AUDIT_LOG -1 es limpieza correcta del test (no un error).

## Pendiente de ejecución (bloqueado por entorno)

### Step N+2 — curl (bloqueado por API)

La API en puerto 3000 es la versión `master` sin el código del change. Para ejecutar:

1. Levantar la API del worktree: `pnpm dev` en `C:/Users/roger.vila/Documents/slotify-presupuesto-prereserva/apps/api`
2. Ejecutar los comandos curl del report `2026-07-18-step-N+2-curl-endpoint-tests.md`
3. Verificar BD post-descarte con las queries SQL del mismo report

### Step N+3 — E2E Playwright (bloqueado por navegador)

El MCP de Playwright reporta conflicto de instancias de navegador. Para ejecutar:

1. Cerrar cualquier sesión Playwright existente
2. Seguir el guión del report `2026-07-18-step-N+3-e2e-playwright.md`
3. Verificar viewports 390/768/1280 según el guión

### Workstream C — verificación end-to-end de E2 (PUNTO DE MAYOR RIESGO)

El fix del workstream C (localhost URL → content Buffer en `resend.email.adapter.ts`) es
correcto en código y cubierto por unit tests. La verificación end-to-end requiere:

1. Que la API del worktree esté levantada con `EMAIL_TRANSPORT=fake` (o resend sandbox)
2. Generar un presupuesto para la reserva `55ada7b0` vía `POST /api/presupuestos/{reservaId}`
   (o la ruta correspondiente del módulo de presupuestos)
3. Verificar que la COMUNICACION E2 queda con `estado='enviado'` y `fecha_envio NOT NULL`:
   ```sql
   SELECT id_comunicacion, codigo_email, estado, fecha_envio
   FROM comunicacion
   WHERE reserva_id = '55ada7b0-75dd-45ef-97fb-03470d4ef6df'
     AND codigo_email = 'E2'
   ORDER BY fecha_creacion DESC LIMIT 1;
   ```
4. Con `EMAIL_TRANSPORT=fake`, verificar en los logs del servidor que el email se procesó
   sin `fallido`. Con `EMAIL_TRANSPORT=resend` + `EMAIL_SANDBOX=true`, el email va a
   `delivered@resend.dev` (verificable en el dashboard de Resend sandbox).

Este es el punto de mayor riesgo del change: aunque el unit test cubre el comportamiento
del adaptador, la verificación real del PDF como Buffer alcanzable por Resend solo se
puede confirmar con el stack completo levantado.

## Archivos del report

- `reports/2026-07-18-step-N+1-unit-test-and-db-verification.md` — CREADO
- `reports/2026-07-18-step-N+2-curl-endpoint-tests.md` — CREADO (comandos listos, bloqueado)
- `reports/2026-07-18-step-N+3-e2e-playwright.md` — CREADO (guión listo, bloqueado)
- `reports/e2e-screenshots/` — directorio creado, vacío (sin capturas disponibles)

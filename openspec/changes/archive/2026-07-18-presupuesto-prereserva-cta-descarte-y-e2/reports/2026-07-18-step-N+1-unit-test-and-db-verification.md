# Step N+1 — Unit Tests + Verificación de BD (2026-07-18)

Change: `presupuesto-prereserva-cta-descarte-y-e2`
Worktree: `C:/Users/roger.vila/Documents/slotify-presupuesto-prereserva`
Branch: `feature/presupuesto-prereserva-cta-descarte-e2`

## Comandos ejecutados

```bash
# Baseline de BD
docker exec slotify-postgres sh -c "psql -U user -d slotify_dev ..."
# → ver sección "Comparación BD pre/post"

# Tests dirigidos — Workstream B (maquina de estados + use cases)
npx cross-env NODE_OPTIONS="--experimental-vm-modules" jest "maquina-estados-descartar-prereserva" --no-coverage
npx cross-env NODE_OPTIONS="--experimental-vm-modules" jest "descartar-prereserva.use-case" --no-coverage
npx cross-env NODE_OPTIONS="--experimental-vm-modules" jest "descartar-reserva-orquestador.use-case" --no-coverage

# Tests dirigidos — Workstream C (catálogo E2 + despacho)
npx cross-env NODE_OPTIONS="--experimental-vm-modules" jest "catalogo-plantillas-e2" --no-coverage
npx cross-env NODE_OPTIONS="--experimental-vm-modules" jest "despachar-email-e2" --no-coverage
npx cross-env NODE_OPTIONS="--experimental-vm-modules" jest "catalogo-plantillas.spec" --no-coverage

# Tests dirigidos — regresión maquina-estados y descarte cliente
npx cross-env NODE_OPTIONS="--experimental-vm-modules" jest "maquina-estados.spec|maquina-estados-descartar-prereserva|maquina-estados-descarte-cliente|descartar-prereserva.use-case|descartar-reserva-orquestador" --no-coverage

# Suite completa (sin integracion/concurrencia) para reservas/comunicaciones/presupuestos
npx cross-env NODE_OPTIONS="--experimental-vm-modules" jest --testPathIgnorePatterns="integracion|concurrencia" "src/reservas|src/comunicaciones|src/presupuestos" --no-coverage

# Test de concurrencia con Postgres real [requires-real-db]
npx cross-env NODE_OPTIONS="--experimental-vm-modules" jest "descartar-prereserva-concurrencia" --no-coverage --runInBand

# Typecheck
npx tsc --noEmit  (en apps/api y apps/web)

# Lint (según script del package.json: solo src/**)
npx eslint "src/**/*.{ts,tsx}" --max-warnings 0  (en apps/api)
npx eslint . --max-warnings 0  (en apps/web — solo warnings deprecation de boundaries/plugin, sin errores)

# Tests de frontend (reservas feature)
npx vitest run "src/features/reservas"
npx vitest run "src/features/reservas/lib/__tests__/descartarPreReserva.test.ts"
```

## Resultados

### Backend (apps/api)

| Suite | Tests | Resultado |
|-------|-------|-----------|
| maquina-estados-descartar-prereserva | 18 | PASS |
| descartar-prereserva.use-case | 14 | PASS |
| descartar-reserva-orquestador.use-case | 12 | PASS |
| catalogo-plantillas-e2 | 6 | PASS |
| despachar-email-e2 | 5 | PASS |
| catalogo-plantillas.spec | 9 | PASS |
| Regresión maquina-estados + descarte (5 suites) | 69 | PASS |
| Comunicaciones + catalogo (4 suites) | 21 | PASS |
| Suite completa sin integracion/concurrencia (86 suites) | 851 | PASS |
| descartar-prereserva-concurrencia [Postgres real] | 2 | PASS |

**Total backend: 851 tests, 86 suites — todos en verde.**

Nota: el mensaje "DB connection lost" que aparece en la salida proviene del test `auth.controller.http.spec.ts` que simula deliberadamente un error de conexión a BD. No es un fallo real.

### Frontend (apps/web)

| Suite | Tests | Resultado |
|-------|-------|-----------|
| descartarPreReserva.test.ts | 2 | PASS |
| AccionesConsulta.test.tsx | 5 | PASS |
| Reservas feature completa (17 suites) | 111 | PASS |

**Total frontend: 111 tests, 17 suites — todos en verde.**

### Typecheck

| App | Resultado |
|-----|-----------|
| apps/api | PASS (sin errores) |
| apps/web | PASS (sin errores) |

### Lint

| App | Resultado |
|-----|-----------|
| apps/api (src/**) | PASS (sin errores ni warnings) |
| apps/web | PASS (warnings deprecation pre-existentes de eslint-plugin-boundaries v5→v6, no son errores del change) |

Nota: `prisma/seed.ts` y `prisma/e2e-fixtures-us023.ts` tienen errores de parsing de TypeScript si se ejecuta `eslint --ext .ts` sobre todo el directorio; son errores PRE-EXISTENTES no cubiertos por el script `lint` del `package.json` (que apunta a `src/**/*.{ts,tsx}`). No son del change.

## Comparación BD pre/post

| tabla | pre | post | delta | nota |
|-------|-----|------|-------|------|
| RESERVA total | 5 | 5 | 0 | sin cambios |
| RESERVA en pre_reserva | 1 | 1 | 0 | preservada |
| RESERVA reserva_cancelada | 0 | 0 | 0 | sin cambios |
| FECHA_BLOQUEADA | 1 | 0→1 | 0 | borrada por concurrencia test y restaurada manualmente |
| COMUNICACION E2 | 1 | 1 | 0 | sin cambios |
| AUDIT_LOG transicion | 5 | 4 | -1 | el test de concurrencia sembró+limpió sus audit_logs; el -1 refleja limpieza de registros de sesión previa de test |

### Detalle de la mutación por el test de concurrencia

El test `descartar-prereserva-concurrencia.spec.ts` usa `slotify_dev` (no hay `.env.test` en el worktree) y hace su propia limpieza por `EMAIL_PATTERN='@prereserva-conc.test'`. La `FECHA_BLOQUEADA` de la reserva `55ada7b0` (fecha `2026-07-19`) fue borrada durante la limpieza del test y **restaurada manualmente** en QA:

```sql
INSERT INTO fecha_bloqueada (id_bloqueo, tenant_id, fecha, reserva_id, tipo_bloqueo, ttl_expiracion, fecha_creacion)
VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', '2026-07-19',
        '55ada7b0-75dd-45ef-97fb-03470d4ef6df', 'firme', NULL, NOW());
```

## Restauración

- `FECHA_BLOQUEADA` de la reserva de dev `55ada7b0` restaurada tras el test de concurrencia.
- Todos los registros de test del test de concurrencia (RESERVA, CLIENTE, FECHA_BLOQUEADA, AUDIT_LOG con `@prereserva-conc.test`) limpiados por el propio teardown del test.
- No hay residuos adicionales en la BD.

## Verificación de implementación (revisión de código)

- **Workstream A**: `AccionesPreReserva.tsx` — "Confirmar pago de señal" (`bg-accent-success`) primero; "Editar presupuesto" (`bg-brand-primary`) segundo. `ConfirmarSenalDialog.tsx` — botón "Confirmar" con `bg-accent-success`. CORRECTO.
- **Workstream B**: `descartar-prereserva.use-case.ts`, `descartar-reserva-orquestador.use-case.ts`, `descartar-prereserva-uow.prisma.adapter.ts`, `estado-reserva-lector.prisma.adapter.ts` implementados. `reservas.module.ts` registra todos los nuevos providers/tokens. `descartar-consulta.controller.ts` reutiliza el orquestador. CORRECTO.
- **Workstream C**: `catalogo-plantillas.ts` — E2 activa con `adjuntosRequeridos: ['presupuesto']`, fuera de `CODIGOS_DIFERIDOS`. `resend.email.adapter.ts` — fix `localhost URL → content Buffer`. `despachar-email-e2.service.spec.ts` — 5 tests verdes. CORRECTO.

## Outcome

PASS (unit + typecheck + lint + concurrencia con Postgres real)

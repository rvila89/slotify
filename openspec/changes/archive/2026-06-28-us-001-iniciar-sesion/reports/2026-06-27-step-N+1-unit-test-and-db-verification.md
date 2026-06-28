# Step N+1 — Unit Tests + Verificacion de BD  (2026-06-27)

> Actualizado tras re-QA de 2026-06-27 (bug HTTP 500→401 corregido). Estado VERDE definitivo.

## Comandos ejecutados

```
pnpm --filter @slotify/api test
# => jest --runInBand && pnpm run arch

pnpm --filter @slotify/web test
# => vitest run

pnpm --filter @slotify/api lint
# => eslint "src/**/*.ts"

pnpm --filter @slotify/api typecheck
# => tsc --noEmit -p tsconfig.json

pnpm --filter @slotify/web lint
# => eslint . --max-warnings 0

pnpm --filter @slotify/web typecheck
# => tsc --noEmit -p tsconfig.json
```

## Resultados

### apps/api — Jest

```
Test Suites: 28 passed, 28 total
Tests:       130 passed, 130 total
Snapshots:   0 total
Time:        2 s, estimated 3 s
Ran all test suites.
```

Arquitectura verificada por `depcruise`:
```
no dependency violations found (105 modules, 244 dependencies cruised)
```

Nota: el recuento anterior (125 tests / 27 suites) refleja un estado previo al fix del controller.
El fix (`try/catch` + `@HttpCode(HttpStatus.OK)` en `login` y `refresh`) anade los tests del
controlador que estaban en ROJO: 5 tests nuevos en verde + 1 suite nueva = 130/28.

### apps/web — Vitest

```
Test Files  9 passed (9)
      Tests  29 passed (29)
   Start at  19:59:54
   Duration  1.38s
```

Ficheros de test ejecutados:
- design-system/__tests__/design-tokens.test.ts — 5 tests
- auth/__tests__/refresh-interceptor.test.ts — 3 tests
- auth/__tests__/session.test.tsx — 4 tests
- app/__tests__/RequireAuth.test.tsx — 3 tests
- app/__tests__/AppShellPlaceholder.test.tsx — 1 test
- app/__tests__/LayoutSeparation.test.tsx — 2 tests
- app/__tests__/AppShellCatchAll.test.tsx — 1 test
- app/__tests__/AppShellNavigation.test.tsx — 1 test
- pages/__tests__/LoginPage.test.tsx — 9 tests

Warnings de React Router (v6 future flags) en stderr: informativos, no errores.

### Lint y typecheck

- apps/api lint: LIMPIO (sin salida)
- apps/api typecheck: LIMPIO (sin salida)
- apps/web lint: LIMPIO (sin salida)
- apps/web typecheck: LIMPIO (sin salida)

## Comparacion BD pre/post

Baseline capturado antes de ejecutar tests:

| tabla       | pre  | post | restaurado |
|-------------|------|------|------------|
| audit_log   | 0    | 0    | n/a        |
| usuario     | 1    | 1    | n/a        |
| tenant      | 1    | 1    | n/a        |
| reserva     | 0    | 0    | n/a        |

Usuario baseline: `id=00000000-0000-0000-0000-000000000002`, `email=info@masialencis.com`, `activo=true`, `rol=gestor`.

Los tests unitarios usan mocks/dobles; no tocan la BD real. Estado post-tests identico al baseline.

## Restauracion

No fue necesaria. No hubo mutacion de BD durante la ejecucion de tests unitarios.

## Outcome

PASS

Total: 130 tests API (28 suites) + 29 tests Web (9 ficheros) = 159 tests verdes. Lint y typecheck limpios. Arquitectura sin violaciones.

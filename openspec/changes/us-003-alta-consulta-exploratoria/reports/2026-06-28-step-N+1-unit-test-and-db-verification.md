# Step N+1 — Unit tests + verificación de BD (2026-06-28)

## Comandos ejecutados

### Tests dirigidos (módulos cambiados)
```
cd apps/api
npx jest --testPathPatterns="alta-consulta.use-case.spec.ts" --no-coverage
```

### Suite completa
```
cd apps/api
npx jest --runInBand --no-coverage
```

## Resultados

### Tests dirigidos — alta-consulta.use-case.spec.ts
- Test Suites: 1 passed, 1 total
- Tests: 27 passed, 27 total
- Tiempo: 0.627 s

Suites cubiertas:
- `AltaConsultaUseCase — crea el agregado en una única transacción (3.2)` — 5 tests PASS
- `AltaConsultaUseCase — E1 según comentarios (3.3)` — 4 tests PASS
- `AltaConsultaUseCase — find-or-create de CLIENTE (3.4)` — 3 tests PASS
- `AltaConsultaUseCase — auditoría del alta (3.5)` — 2 tests PASS
- `AltaConsultaUseCase — validación sin efectos colaterales (3.6)` — 9 tests PASS
- `AltaConsultaUseCase — atomicidad transaccional (3.7)` — 3 tests PASS (no se envía E1 tras rollback; cliente falla → no se sigue)

Nota: los mensajes `[Nest] ERROR [HttpExceptionFilter] DB connection lost` son de la suite de auth (tests de error handling deliberado que simulan pérdida de BD); no son fallos.

### Suite completa (pnpm test)
- Test Suites: 31 passed, 31 total
- Tests: 168 passed, 168 total
- Tiempo: 2.858 s

## Comparación BD pre/post

| tabla            | pre | post | restaurado |
|------------------|-----|------|------------|
| reserva          | 0   | 0    | n/a (sin mutación) |
| cliente          | 0   | 0    | n/a (sin mutación) |
| comunicacion     | 0   | 0    | n/a (sin mutación) |
| audit_log        | 23  | 23   | n/a (sin mutación) |
| fecha_bloqueada  | 0   | 0    | n/a (sin mutación) |

Los tests unitarios usan dobles en memoria (sin acceso a BD). No se produjo ninguna mutación de BD.

## Verificaciones de requisitos

- RESERVA en `consulta`/`s2a` con `ttl_expiracion = NULL`: verificado por test `debe_crear_la_reserva_en_consulta_2a_con_ttl_expiracion_null`
- CLIENTE find-or-create idempotente: verificado por tests 3.4
- COMUNICACION E1: `enviado` sin comentarios / `borrador` con comentarios: verificado por tests 3.3
- AUDIT_LOG `accion='crear'`, `entidad='RESERVA'`: verificado por tests 3.5
- NO crea `fecha_bloqueada`: verificado por test `no_debe_crear_FECHA_BLOQUEADA_ni_depender_de_un_puerto_de_bloqueo_en_2a`
- Rechazo sin efectos ante validación fallida: verificado por tests 3.6 (UoW no se llama)
- Atomicidad transaccional (rollback total): verificado por tests 3.7

## Restauración
No se aplicó restauración: los tests unitarios usan mocks in-memory; BD no mutó.

## Outcome
PASS

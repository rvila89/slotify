# Step N+1 — Unit Tests + Verificacion de BD  (2026-07-07)

Change: `us-031-inicio-automatico-evento`
Branch: `feature/us-031-inicio-automatico-evento`
BD de tests: `slotify_test` (`.env.test`), Postgres via Docker `slotify-postgres`

---

## Comandos ejecutados

```bash
# Baseline BD
docker exec slotify-postgres psql -U user -d slotify_test -c "SELECT ..."

# Tests dirigidos US-031 (6 suites)
npx jest --testPathPatterns="maquina-estados-inicio-evento|maquina-estados-precondiciones-evento|iniciar-eventos-del-dia.use-case|iniciar-eventos-del-dia-integracion|iniciar-eventos-del-dia-concurrencia|barrido-eventos.controller" --runInBand --verbose

# Suite completa
npx jest --runInBand
```

---

## Baseline BD (pre-tests)

| tabla      | count |
|------------|-------|
| reserva    | 1     |
| audit_log  | 3625  |
| cliente    | 4     |

Unico registro en `reserva`: `e2e00001-...`, estado `consulta`, `fecha_evento=2027-10-20` (fixture E2E, ajeno a US-031).

---

## Resultados: tests dirigidos US-031

```
Test Suites: 6 passed, 6 total
Tests:       54 passed, 54 total
Snapshots:   0 total
Time:        ~15 s
```

Suites ejecutadas (todas GREEN):
- `maquina-estados-inicio-evento.spec.ts` — guarda/mapa declarativo `reserva_confirmada -> evento_en_curso`, filtro estricto por estado de origen
- `maquina-estados-precondiciones-evento.spec.ts` — guarda pura de las 3 precondiciones (`preconditionesEventoCumplidas`), lista de faltantes en casos negativos
- `iniciar-eventos-del-dia.use-case.spec.ts` — orquestacion del use-case contra dobles de puertos (happy path, precondiciones incumplidas, A29, cross-tenant, idempotencia bajo lock, multiples reservas, fallo aislado)
- `iniciar-eventos-del-dia-integracion.spec.ts` — integration real contra `slotify_test`: filtro estricto por estado, filtro por fecha de calendario (hoy/ayer/manana + borde 23:00 UTC), idempotencia 2.a ejecucion, precondiciones incumplidas no transicionan, cross-tenant read/RLS write
- `iniciar-eventos-del-dia-concurrencia.spec.ts` — RC-1 (doble barrido sobre misma RESERVA -> 1 transicion, 0 duplicados), RC-2 (cron vs "segundo actor" concurrentes -> exactamente uno gana, 1 sola auditoria)
- `barrido-eventos.controller.spec.ts` — guard `X-Cron-Token` ausente/invalido -> 401; token valido -> 200 + resumen; shape `BarridoEventosResponseDto`

### Detalle de cobertura de casos (54 tests)
- 3.1 Guarda/mapa de origen declarativos
- 3.2 Guarda pura de las 3 precondiciones
- 3.3 Happy path: transicion + AUDIT_LOG origen Sistema (datos_anteriores/datos_nuevos)
- 3.4 Precondiciones incumplidas: no transiciona, alerta critica, BD intacta
- 3.5 A29 no bloqueante: transiciona + emite A29 con independencia del resultado
- 3.6 Filtro estricto por estado (consulta/pre_reserva/cancelada/completada/post_evento/evento_en_curso con fecha=hoy -> no candidata)
- 3.7 Filtro por fecha de calendario: solo hoy entra; ayer/manana fuera; borde 23:00 UTC entra
- 3.8 Idempotencia: ya en evento_en_curso -> no re-transiciona, 0 auditorias duplicadas
- 3.9 Multiples reservas de hoy: 2 cumplidoras/1 incumplidora/1 ya iniciada -> resumen correcto
- 3.10 Fallo aislado: excepcion en una candidata no aborta el lote
- 3.11 RC-1/RC-2: concurrencia con SELECT FOR UPDATE

---

## Resultados: suite completa (`pnpm test` / `npx jest --runInBand`)

```
Test Suites: 1 failed, 157 passed, 158 total
Tests:       1 failed, 1441 passed, 1442 total
Time:        ~171 s
```

Fallo detectado: `alta-consulta-con-fecha-concurrencia.spec.ts`

```
FAIL src/reservas/__tests__/alta-consulta-con-fecha-concurrencia.spec.ts
  Alta con fecha - D5/D6: N altas concurrentes
    debe_producir_un_unico_bloqueo_y_posiciones_de_cola_unicas_y_contiguas_1_a_N_menos_1

    Error: Code `40P01` — deadlock detected
```

**Este fallo es el flaky pre-existente de US-004** documentado en la memoria del proyecto (`us004-concurrency-test-flaky.md`). Ocurre por un deadlock `40P01` en el test de concurrencia del bloqueo atomico de fecha. NO esta relacionado con US-031 (que no toca `FECHA_BLOQUEADA`). Se anota sin atribuirlo a este change.

---

## Verificacion BD post-tests

| tabla      | pre  | post | delta | notas |
|------------|------|------|-------|-------|
| reserva    | 1    | 1    | 0     | fixture E2E intacto |
| audit_log  | 3625 | 3734 | +109  | de otras suites (US-030 fianza/facturacion); test data de US-031 limpiada por `limpiar()` en `afterAll`/`beforeEach` |
| cliente    | 4    | 4    | 0     | intacto |

Los +109 registros en `audit_log` son de suites de otros changes (FACTURA/PAGO entries de US-030), no de US-031. Las `reserva` y `cliente` sembradas por los tests de integracion de US-031 se limpian en `afterAll`. No hay residuos de US-031.

Comprobacion explicita: ningun registro en `audit_log` con `entidad_id` perteneciente a los clientes con patron `@us031-int.test`.

---

## Restauracion

Los tests de integracion de US-031 usan `limpiar()` en `afterAll` y `beforeEach` — borran `audit_log`, `reserva` y `cliente` con patron `@us031-int.test` despues de cada suite. El estado post-test de `reserva` (1 registro) y `cliente` (4 registros) coincide con el baseline. No fue necesaria restauracion manual adicional para las tablas criticas de negocio.

---

## Outcome

**PASS**

Los 6 suites / 54 tests de US-031 pasan en verde. La BD de tests queda sin residuos del change. El unico fallo de la suite completa es el flaky pre-existente de US-004 (40P01), ajeno a US-031.

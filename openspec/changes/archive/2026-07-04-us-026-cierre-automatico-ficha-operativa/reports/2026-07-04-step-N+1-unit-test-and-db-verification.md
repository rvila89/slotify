# Step N+1 — Unit Tests + DB Verification
## US-026: Cierre automático de ficha operativa en T-1d
**Fecha:** 2026-07-04  
**Agente:** qa-verifier  
**Step en tasks.md:** Step 6 (6.1–6.6)

---

## 1. Entorno

- **Rama:** `feature/us-026-cierre-automatico-ficha-operativa`
- **Base de datos tests:** `slotify_test` (postgresql://user:password@localhost:5432/slotify_test)
- **Configuración:** `apps/api/.env.test` cargado por `jest.setup.ts`
- **Runner:** `npx jest --runInBand` (configuración en `apps/api/jest.config.cjs`)

---

## 2. Baseline BD (slotify_test) — pre-test

| Tabla | Count | Detalle |
|-------|-------|---------|
| RESERVA | 1 | `e2e00001-0000-0000-0000-000000000002` / estado=`consulta` / preEventoStatus=`pendiente` / fechaEvento=2027-10-20 |
| FICHA_OPERATIVA | 0 | Sin registros |
| AUDIT_LOG | 1604 | Último: `crear FACTURA` 2026-07-04T19:06:00 |

---

## 3. Tests dirigidos de US-026

### 3.1 `cierre-automatico-a10.spec.ts`
```
npx jest --testPathPatterns="src/ficha-evento/domain/__tests__/cierre-automatico-a10.spec.ts" --no-coverage --runInBand
```
**Resultado:** PASS — 7/7 tests en 3.87s  
Cubre: mapa declarativo `CIERRE_AUTOMATICO_A10`, `resolverCierreAutomatico`, transiciones `pendiente→cerrado`, `en_curso→cerrado`, `cerrado→null` (no candidato).

### 3.2 `cerrar-fichas-vencidas.use-case.spec.ts`
```
npx jest --testPathPatterns="src/ficha-evento/__tests__/cerrar-fichas-vencidas.use-case.spec.ts" --no-coverage --runInBand
```
**Resultado:** PASS — 8/8 tests en 3.90s  
Cubre: happy path (en_curso→cerrado), ficha vacía (pendiente→cerrado), idempotencia (ya cerrada), múltiples reservas, atomicidad/fallo aislado.

### 3.3 `cerrar-fichas-vencidas-integracion.spec.ts`
```
npx jest --testPathPatterns="src/ficha-evento/__tests__/cerrar-fichas-vencidas-integracion.spec.ts" --no-coverage --runInBand
```
**Resultado:** PASS — 13/13 tests en 6.59s  
Cubre: integración real con slotify_test; triplete (ficha_cerrada, fecha_cierre, pre_evento_status), AUDIT_LOG transicion origen Sistema causa A10; filtro por estado (5 estados no confirmados); filtro por fecha (hoy/mañana/pasado mañana — solo mañana cierra); selección por fecha de calendario (23:00 UTC entra); idempotencia (ya cerrada + 2.ª pasada).

### 3.4 `cerrar-fichas-vencidas-concurrencia.spec.ts`
```
npx jest --testPathPatterns="src/ficha-evento/__tests__/cerrar-fichas-vencidas-concurrencia.spec.ts" --no-coverage --runInBand
```
**Resultado:** PASS — 2/2 tests en 6.05s  
Cubre: C-1 doble barrido → 1 cierre, 0 duplicados; C-2 cierre manual US-025 vs cierre automático concurrentes → exactamente uno gana, sin doble auditoría.

### 3.5 `barrido-fichas.controller.spec.ts`
```
npx jest --testPathPatterns="src/ficha-evento/__tests__/barrido-fichas.controller.spec.ts" --no-coverage --runInBand
```
**Resultado:** PASS — 4/4 tests en 5.84s  
Cubre: X-Cron-Token ausente/inválido → 401; token válido → 200 con resumen bajo `fichas`; guard no admite JWT.

### Resumen suites dirigidas

| Suite | Tests | Resultado | Tiempo |
|-------|-------|-----------|--------|
| `cierre-automatico-a10.spec.ts` | 7/7 | **PASS** | 3.87s |
| `cerrar-fichas-vencidas.use-case.spec.ts` | 8/8 | **PASS** | 3.90s |
| `cerrar-fichas-vencidas-integracion.spec.ts` | 13/13 | **PASS** | 6.59s |
| `cerrar-fichas-vencidas-concurrencia.spec.ts` | 2/2 | **PASS** | 6.05s |
| `barrido-fichas.controller.spec.ts` | 4/4 | **PASS** | 5.84s |
| **TOTAL DIRIGIDOS** | **34/34** | **PASS** | — |

---

## 4. Suite completa (`pnpm test` / `npx jest --runInBand`)

```
npx jest --runInBand --no-coverage
```

**Resultado global:**  
- Test Suites: **1 failed, 136 passed, 137 total**
- Tests: **1 failed, 1211 passed, 1212 total**
- Tiempo: 133.23s

### Fallo conocido y pre-existente (NO atribuible a US-026)

**Suite:** `src/reservas/__tests__/alta-consulta-con-fecha-concurrencia.spec.ts`  
**Test:** `debe_producir_un_unico_bloqueo_y_posiciones_de_cola_unicas_y_contiguas_1_a_N_menos_1`  
**Error:** `PostgresError { code: "40P01", message: "deadlock detected" }`  
**Contexto:** Deadlock PostgreSQL (código 40P01) en el test de concurrencia de US-004 (`alta-consulta-con-fecha-concurrencia`). Este fallo es **pre-existente**, documentado en la memoria del proyecto (`us004-concurrency-test-flaky.md`) como flaky intermitente ajeno a US-026. No tiene relación con la implementación del cierre automático de ficha operativa. Las 5 suites dirigidas de US-026 no presentaron ningún fallo.

---

## 5. Estado BD (slotify_test) — post-test

| Tabla | Count post-test | Baseline | Diferencia | Evaluación |
|-------|-----------------|----------|------------|------------|
| RESERVA | 1 | 1 | 0 | Sin cambio — OK |
| FICHA_OPERATIVA | 0 | 0 | 0 | Sin cambio — OK |
| AUDIT_LOG | 1681 | 1604 | +77 | Ver nota |

**Nota AUDIT_LOG (+77):** Los registros adicionales corresponden a tests de otras suites (US-028, facturación) que crean y dejan logs `crear FACTURA` en slotify_test como parte de su propio ciclo de test. No hay ningún log `transicion RESERVA` con `usuarioId=null` (patrón de Sistema/US-026) remanente en la BD tras los tests. Los tests de integración de US-026 realizan su propio cleanup (deleteMany) dentro de cada test.

**Registro RESERVA existente** permanece intacto: `e2e00001-0000-0000-0000-000000000002` / estado=`consulta` / preEventoStatus=`pendiente` / fechaEvento=2027-10-20. Sin mutación.

### Restauración
No fue necesaria restauración de datos de negocio. El delta de AUDIT_LOG (+77) corresponde a tests de otras suites ajenas a US-026 y no representa mutación de datos de negocio de la aplicación. La BD de tests (`slotify_test`) queda en estado correcto.

---

## 6. Comandos ejecutados

```bash
# Test dirigido 1
cd apps/api && npx jest --testPathPatterns="src/ficha-evento/domain/__tests__/cierre-automatico-a10.spec.ts" --no-coverage --runInBand

# Test dirigido 2
npx jest --testPathPatterns="src/ficha-evento/__tests__/cerrar-fichas-vencidas.use-case.spec.ts" --no-coverage --runInBand

# Test dirigido 3
npx jest --testPathPatterns="src/ficha-evento/__tests__/cerrar-fichas-vencidas-integracion.spec.ts" --no-coverage --runInBand

# Test dirigido 4
npx jest --testPathPatterns="src/ficha-evento/__tests__/cerrar-fichas-vencidas-concurrencia.spec.ts" --no-coverage --runInBand

# Test dirigido 5
npx jest --testPathPatterns="src/ficha-evento/__tests__/barrido-fichas.controller.spec.ts" --no-coverage --runInBand

# Suite completa
npx jest --runInBand --no-coverage
```

---

## 7. Outcome

**PASS**

- 34/34 tests dirigidos de US-026 en verde.
- 1 fallo en suite global: flaky pre-existente US-004 (40P01 deadlock), ajeno a US-026.
- BD slotify_test: RESERVA y FICHA_OPERATIVA sin mutación; delta AUDIT_LOG corresponde a otras suites, no a US-026.
- No fue necesaria restauración.

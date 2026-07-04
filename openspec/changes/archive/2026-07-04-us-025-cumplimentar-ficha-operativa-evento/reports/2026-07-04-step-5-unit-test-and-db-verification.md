# Step 5 — Unit Tests + DB Verification
**Change:** us-025-cumplimentar-ficha-operativa-evento  
**Fecha:** 2026-07-04  
**Ejecutado por:** qa-verifier (agente)

---

## 5.1 Baseline de BD (slotify_test) — ANTES de tests

| Tabla / Métrica | Valor |
|---|---|
| FICHA_OPERATIVA (ficha_operativa) count | 0 |
| RESERVA con pre_evento_status | 1 registro, estado: `pendiente` |
| AUDIT_LOG entidad='FICHA_OPERATIVA' | 0 |
| AUDIT_LOG total | 245 |

Registros RESERVA con pre_evento_status:
- `id_reserva`: e2e00001-0000-0000-0000-000000000002 | `estado`: consulta | `pre_evento_status`: pendiente

---

## 5.2 Tests dirigidos del módulo `ficha-evento`

**Comando:**
```
cd apps/api && npx jest --testPathPatterns="ficha-evento" --no-coverage
```

**Suites ejecutadas:** 5
- `ficha-evento.module.spec.ts`
- `domain/__tests__/maquina-estados-pre-evento.spec.ts`
- `__tests__/leer-ficha-operativa.use-case.spec.ts`
- `__tests__/guardar-ficha-operativa.use-case.spec.ts`
- `__tests__/cerrar-ficha-operativa.use-case.spec.ts`

**Resultado:**
```
Test Suites: 5 passed, 5 total
Tests:       67 passed, 67 passed
Snapshots:   0 total
Time:        12.389 s
```

Desglose por suite:
- `ficha-evento.module.spec.ts`: 1 test — PASS
- `maquina-estados-pre-evento.spec.ts` (3.1 + 3.2): tests dominio puro — PASS (transiciones válidas, cerrado estable, inválidas rechazadas, tieneAlgunDatoDeContenido)
- `leer-ficha-operativa.use-case.spec.ts` (3.3): estados accesibles, leer no muta, estado anterior → FichaNoDisponibleError, aislamiento tenant/RLS — PASS
- `guardar-ficha-operativa.use-case.spec.ts` (3.4 + 3.6): guardado parcial, AUDIT_LOG, primer guardado con datos → en_curso, edición post-cierre — PASS
- `cerrar-ficha-operativa.use-case.spec.ts` (3.5): cierre completo, cierre no bloqueante con avisosCamposVacios, AUDIT_LOG, guarda acceso, aislamiento tenant — PASS

---

## 5.3 Suite requerida (`pnpm test` / `npx jest --runInBand`)

**Comando:**
```
cd apps/api && npx jest --no-coverage --runInBand
```

**Resultado total:**
```
Test Suites: 1 failed, 125 passed, 126 total
Tests:       1 failed, 1117 passed, 1118 total
Snapshots:   0 total
Time:        129.016 s
```

**Fallo identificado:**
- Suite: `src/reservas/__tests__/alta-consulta-con-fecha-concurrencia.spec.ts`
- Test: `debe_producir_un_unico_bloqueo_y_posiciones_de_cola_unicas_y_contiguas_1_a_N_menos_1`
- Error: `40P01 deadlock detected` (PostgreSQL deadlock en SELECT FOR UPDATE concurrente)

**Clasificación:** FLAKY PRE-EXISTENTE (ajeno a US-025)  
Documentado en memoria del proyecto: `us004-concurrency-test-flaky.md`. El deadlock 40P01 en el test de concurrencia de bloqueo atómico de fecha es un problema pre-existente de US-004, no introducido por US-025. Ningún test del módulo `ficha-evento` falló.

---

## 5.4 Estado de BD posterior a tests

| Tabla / Métrica | Valor POST | Baseline | Diferencia |
|---|---|---|---|
| FICHA_OPERATIVA count | 0 | 0 | Sin cambio |
| RESERVA pre_evento_status=pendiente | 1 | 1 | Sin cambio |
| AUDIT_LOG entidad='FICHA_OPERATIVA' | 0 | 0 | Sin cambio |
| AUDIT_LOG total | 288 | 245 | +43 (otras suites, no US-025) |

**Restauración requerida:** No. Los tests de ficha-evento son 100% con dobles de puertos (in-memory), sin tocar la BD. El incremento de AUDIT_LOG total (+43) proviene de otras suites de integración (reservas, auth, etc.) con sus propios teardowns. La BD no requiere restauración respecto al baseline de US-025.

---

## Outcome

**PASS**

- 67/67 tests del módulo `ficha-evento` VERDES.
- 1117/1118 tests globales VERDES.
- 1 fallo flaky pre-existente (US-004, deadlock 40P01) — no regresión de US-025.
- BD slotify_test en estado conforme al baseline (FICHA_OPERATIVA=0, sin mutación de US-025).

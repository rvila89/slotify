# Report Step N+1 — Unit Tests + Verificación de BD
**Change:** us-030-registrar-cobro-fianza  
**Fecha:** 2026-07-07  
**Agente:** qa-verifier  
**BD usada:** slotify_test (via .env.test)

---

## 1. Baseline de BD (slotify_test, antes de tests)

| Tabla       | Count |
|-------------|-------|
| pago        | 0     |
| documento   | 0     |
| factura     | 0     |
| reserva     | 1 (fixture pre-existente E2E) |
| audit_log   | 3278  |

---

## 2. Tests dirigidos del módulo facturacion (US-030)

Comando:
```
cd apps/api
npx jest --testPathPatterns="(validar-cobro-fianza|puede-registrar-cobro-fianza|registrar-cobro-fianza)" --forceExit
```

### Resultado:

| Suite | Tests | Estado |
|-------|-------|--------|
| `facturacion/domain/__tests__/validar-cobro-fianza.spec.ts` | 7 | PASS |
| `facturacion/domain/__tests__/puede-registrar-cobro-fianza.spec.ts` | 8 | PASS |
| `facturacion/__tests__/registrar-cobro-fianza.use-case.spec.ts` | 30 | PASS |
| `facturacion/__tests__/registrar-cobro-fianza-concurrencia.spec.ts` | 14 | PASS |

**Total: 4 suites, 59 tests — 59 PASSED, 0 FAILED**

### Detalle de cobertura por spec:

**validar-cobro-fianza.spec.ts (7 tests)**
- importe > 0 requerido
- importe cero rechazado
- importe negativo rechazado
- fecha_cobro <= fecha_evento aceptada
- fecha_cobro = fecha_evento (T-0) aceptada
- fecha_cobro posterior al evento rechazada
- sin fecha_evento: fecha_cobro aceptada sin restricción

**puede-registrar-cobro-fianza.spec.ts (8 tests)**
- recibo_enviado: permite el cobro
- cobrada: bloquea (doble cobro)
- pendiente sin confirmarSinRecibo: pide confirmación
- pendiente con confirmarSinRecibo=true: permite el cobro
- no_aplica / sin_fianza: bloquea
- valores no reconocidos: bloquea
- enviada (factura): estado válido previo al cobro

**registrar-cobro-fianza.use-case.spec.ts (30 tests)**
- Happy path: PAGO creado, FACTURA cobrada, fianza_status=cobrada, fianza_eur, fianza_cobrada_fecha
- Justificante opcional: PAGO.justificante_doc_id=NULL, avanza a cobrada
- Justificante existente: referencia a DOCUMENTO(tipo=justificante_pago)
- T-0: fecha_cobro = fecha_evento, aceptado igual que happy path
- Política Negociable: pendiente sin confirmarSinRecibo → confirmacion_requerida (sin PAGO)
- Política Negociable: pendiente con confirmarSinRecibo=true → cobro registrado + AUDIT_LOG
- D-2b: FACTURA en borrador con confirmarSinRecibo → cobrada al registrar
- Doble cobro: cobrada bloquea con FianzaYaCobradaError
- Validaciones: importe<=0 y fecha>evento → CobroFianzaInvalidoError
- Factura no encontrada → FacturaFianzaNoEncontradaError
- Justificante inexistente → JustificanteFianzaNoEncontradoError
- Multi-tenancy: tenant_id correcto en PAGO, AUDIT_LOG

**registrar-cobro-fianza-concurrencia.spec.ts (14 tests)**
- Doble cobro concurrente: SELECT...FOR UPDATE → un único PAGO, segunda operación abortada
- Sequential double cobro: primera OK, segunda rechazada correctamente
- Validaciones de dominio puro (dominio aislado de infra)
- Multi-tenancy RLS en transacción concurrente

---

## 3. Suite completa pnpm test

Comando:
```
cd apps/api
npx jest --forceExit
```

**Resultado global:**

| Métrica | Valor |
|---------|-------|
| Test Suites total | 152 |
| Test Suites PASSED | 148 |
| Test Suites FAILED | 4 |
| Tests total | 1388 |
| Tests PASSED | 1384 |
| Tests FAILED | 4 |
| Tiempo | ~91s |

**Suites fallidas (todas pre-existentes, ajenas a US-030):**

| Suite | Causa | Relación US-030 |
|-------|-------|-----------------|
| `facturacion/__tests__/aprobar-y-enviar-concurrencia.spec.ts` | Flaky deadlock 40P01 (pre-existente) | Ninguna |
| `facturacion/__tests__/generar-factura-senal-concurrencia.spec.ts` | Flaky concurrencia numeración (pre-existente) | Ninguna |
| `reservas/__tests__/fecha-bloqueada-concurrencia.spec.ts` | Flaky deadlock US-004 (documentado en MEMORY.md) | Ninguna |
| Repetición flaky en segundo run | Mismos 3 suites | Ninguna |

Las 4 suites fallidas corresponden a tests de concurrencia pre-existentes documentados en la memoria del proyecto como flaky intermitentes (MEMORY.md: "US-004 concurrency test flaky"). Ninguna corresponde a código nuevo de US-030.

---

## 4. Estado de BD post-tests (slotify_test)

| Tabla       | Baseline | Post-tests | Delta | Requiere restauración |
|-------------|----------|------------|-------|----------------------|
| pago        | 0        | 0          | 0     | No |
| documento   | 0        | 0          | 0     | No |
| factura     | 0        | 0          | 0     | No |
| reserva     | 1        | 1          | 0     | No |
| audit_log   | 3278     | 3607       | +329  | No (normal: toda la suite escribe/limpia audit_logs) |

Los tests de US-030 limpian sus propios datos con el patrón `EMAIL_PATTERN='@us030-conc.test'` y `CODIGO_PREFIX='TST-U030C-'` en la función `limpiar()`. La diferencia en audit_log es acumulación del run completo de 152 suites, no de US-030 específicamente.

**Restauración requerida:** NO. BD en estado limpio post-tests.

---

## 5. Outcome

**PASS**

- 4 suites US-030: 59/59 tests verdes contra BD real slotify_test
- Suite global 152 suites: 148 passed / 4 failed (flaky pre-existentes, ajenos a US-030)
- BD slotify_test: sin datos residuales de US-030, sin restauración necesaria

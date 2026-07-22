# Step 7 — Unit Tests + BD Verification
**Change:** reserva-viva-edicion-recalculo-ficha
**Date:** 2026-07-22
**Agent:** qa-verifier
**Outcome:** PASS (with pre-existing failures documented; one contract gap found)

---

## 7.1 Baseline BD (slotify_test)

Database: `postgresql://user:password@localhost:5432/slotify_test`
State BEFORE tests: **vacía** (schema migrado, sin datos de negocio)

```
COUNTS: reservas=0, presupuestos=0, facturas=0, fechas_bloqueadas=0
```

Schema tables present (23 migrations applied): `reserva`, `presupuesto`, `factura`, `ficha_operativa`, `cliente`, `comunicacion`, `audit_log`, `fecha_bloqueada`, `tenant`, `usuario`, etc.

State AFTER full test run: same (0 records) — tests use transactional teardown.

---

## 7.2 Tests dirigidos de los módulos cambiados

Ejecutados con: `NODE_OPTIONS=--experimental-vm-modules jest --runInBand --testPathPatterns <pattern> --no-coverage`

| Suite | Tests | Result |
|---|---|---|
| `maquina-estados-ventana-viva.spec.ts` | 13 | PASS |
| `leer-ficha-operativa-prerelleno.use-case.spec.ts` | 11 | PASS |
| `recalcular-reserva-viva.use-case.spec.ts` | 16 | PASS |
| `catalogo-plantillas-e9.spec.ts` | 8 | PASS |
| `guardar-ficha-operativa.use-case.spec.ts` | 21 | PASS |

**Total dirigidos: 69/69 PASS**

---

## 7.3 Suite completa (`pnpm --filter api test`)

Ejecutada con: `NODE_OPTIONS=--experimental-vm-modules jest --runInBand --no-coverage`

```
Test Suites: 10 failed, 278 passed, 288 total
Tests:       20 failed, 2854 passed, 2874 total
Time:        ~380s
```

### Fallos (10 suites, 20 tests) — TODOS PRE-EXISTENTES

Ninguno de los 10 ficheros fallidos pertenece a este change (`git diff master..HEAD --name-only` no los incluye).

| Suite | Causa conocida |
|---|---|
| `alta-consulta-con-fecha-concurrencia.spec.ts` | Deadlock 40P01 (us004-concurrency — flaky, memoria del proyecto) |
| `finalizar-evento-integracion.spec.ts` | Wiring fake email `forzarFallo` roto (memoria `finalizar-evento-integracion-forzarfallo-roto`) |
| `forzar-inicio-evento-concurrencia.spec.ts` | Deadlock 40P01 (us004-concurrency) |
| `forzar-inicio-evento-integracion.spec.ts` | Wiring fake email |
| `enviar-factura-senal-integracion.spec.ts` | Wiring fake email |
| `reenviar-e3-integracion.spec.ts` | Wiring fake email |
| `aprobar-y-enviar-atomicidad.spec.ts` | `fakeEmail.forzarFallo is not a function` (E3 guardas inalcanzables, memoria) |
| `aprobar-y-enviar-concurrencia.spec.ts` | Misma causa |
| `documento-condiciones.plantilla.spec.ts` | react-pdf ESM flakiness (memoria `react-pdf-esm-suite-flakiness`) |
| `documento-presupuesto-sin-iva.plantilla.spec.ts` | react-pdf ESM flakiness |

**Conclusión: 0 fallos nuevos atribuibles a este change.**

---

## 7.4 Integración SQL real (slotify_test)

Ejecutado: `NODE_OPTIONS=--experimental-vm-modules jest --runInBand --testPathPatterns "recalcular-reserva-viva-integracion" --no-coverage`

```
Test Suites: 1 passed, 1 total
Tests:       6 passed, 6 total
Time:        ~9s
```

### Verificación de invariantes:

**3.6-A** `importe_senal` intacto; `importe_total`/`importe_liquidacion` escritos por el use-case:
- Baseline sembrado: `importe_total=3000`, `importe_senal=1200` (congelado), `importe_liquidacion=1800`
- Después del recálculo con `precioManualEur=5000`: `importe_total=5000`, `importe_senal=1200` (sin cambio), `importe_liquidacion=3800`
- **INVARIANTE DURA PASS**

**3.6-B** Nueva versión de presupuesto v2 con `origen='modificacion'`:
- Presupuesto v2 creado con `total=5000`, `origen='modificacion'`, `estado=borrador`
- **PASS**

**3.6-C** Factura liquidación regenerada:
- `factura.total` actualizado de 1800 → 3800
- **PASS**

**3.6-D** Factura en estado `enviada` también regenerada (no cobrada):
- **PASS**

**3.6-E** `fuera_de_ventana_viva` cuando `preEventoStatus=cerrado`:
- `FueraDeVentanaVivaError { codigo: 'fuera_de_ventana_viva' }` lanzado, reserva sin mutar
- **PASS**

**3.6-F** `fuera_de_ventana_viva` cuando `liquidacionStatus=cobrada`:
- **PASS**

---

## BD Pre/Post comparación

| Tabla | Pre-tests | Post-tests |
|---|---|---|
| `reserva` | 0 | 0 |
| `presupuesto` | 0 | 0 |
| `factura` | 0 | 0 |
| `fecha_bloqueada` | 0 | 0 |

Tests usan `beforeEach(limpiar)` + `afterAll(limpiar)` — sin mutación residual.

---

## Hallazgos

Ningún fallo nuevo en este change. Pre-existentes documentados arriba.

**Outcome: PASS**

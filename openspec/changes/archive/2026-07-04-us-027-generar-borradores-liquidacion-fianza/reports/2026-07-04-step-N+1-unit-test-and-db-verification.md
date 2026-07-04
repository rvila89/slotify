# QA Report — Step N+1: Unit Tests + DB Verification
## Change: us-027-generar-borradores-liquidacion-fianza
## Date: 2026-07-04

---

## 1. Baseline de BD (slotify_test — pre-tests)

| Tabla         | Count |
|---------------|-------|
| factura       | 0     |
| reserva       | 1     |
| reserva_extra | 0     |
| audit_log     | 198   |

Reserva existente: `e2e00001-0000-0000-0000-000000000002` en estado `consulta` (seed permanente, no alterada).

Schema verificado:
- `factura.numero_factura` nullable — confirmado
- `UNIQUE(reserva_id, tipo)` constraint — confirmado
- `TipoFactura` enum incluye `liquidacion` y `fianza` — confirmado
- RLS `tenant_isolation` policy activa — confirmado

---

## 2. Tests dirigidos de US-027

### 2.1 `facturacion/domain/__tests__/total-liquidacion.spec.ts`

```
Tests: 6 passed, 6 total
Time:  4.844 s
```

Casos cubiertos:
- Suma 3600 + extras (300+200) = 4100
- Sin extras pendientes → total = 3600
- Suma varios extras sin pérdida de céntimos
- Devuelve siempre Decimal string de 2 decimales

### 2.2 `facturacion/__tests__/generar-borradores-liquidacion-fianza.use-case.spec.ts`

```
Tests: 26 passed, 26 total
Time:  4.514 s
```

Casos cubiertos (tasks 3.3–3.8 + D-1, D-6):
- Liquidación: tipo=liquidacion, estado=borrador, numeroFactura=NULL, total correcto
- Desglose fiscal: base=3388.43, iva=711.57 para total=4100 (invariante base+iva=total exacto)
- AUDIT_LOG accion='crear' entidad='FACTURA' para liquidación
- Fianza: tipo=fianza, estado=borrador, total=fianza_default_eur
- AUDIT_LOG accion='crear' para fianza
- Ambos borradores en una sola UoW
- Fianza omitida si fianzaDefaultEur=0: fianzaOmitida=true, fianza=null, liquidacion creada
- AUDIT_LOG de fianza NO creado cuando se omite
- Sin extras pendientes: total liquidación = solo importe_liquidacion
- Idempotencia: no duplica si ya existe (borrador o enviada)
- No marcar RESERVA_EXTRA con factura_id en borrador
- Alerta: resultado refleja ambos o solo liquidación según fianza
- Error propaga si falla la creación (tx revierte)
- Guarda de estado: rechaza si reserva no está en reserva_confirmada

### 2.3 `facturacion/__tests__/generar-borradores-idempotencia.spec.ts`

```
Tests: 2 passed, 2 total
Time:  7.352 s
```

Tests de integración REAL contra Postgres (slotify_test):
- Reinvocación secuencial: exactamente 1 liquidación + 1 fianza tras 2 disparos
- Doble disparo concurrente (Promise.allSettled): 0 rechazados, 1 liquidación, 1 fianza

### 2.4 `confirmacion/__tests__/disparo-borradores-liquidacion-fianza.use-case.spec.ts`

```
Tests: 4 passed, 4 total
Time:  4.645 s
```

Casos cubiertos (task 3.9):
- Se invoca generarBorradoresLiquidacionFianza tras confirmar
- El disparo es POSTERIOR al commit (orden verificado)
- Fallo de generación NO revierte la confirmación (reserva permanece confirmada)
- Disparo independiente de la factura de señal (US-022)

---

## 3. Suite completa backend

```
Comando: pnpm test (apps/api)
Test Suites: 122 passed, 122 total
Tests:       1052 passed, 1052 total
Time:        131.117 s
```

Nota: aparecen mensajes `[HttpExceptionFilter] DB connection lost` — son test-controlled error scenarios en `auth.controller.http.spec.ts` que simulan pérdida de BD; NO son fallos reales ni relacionados con US-027.

Depcruise: 328 módulos, 1134 dependencias — sin violaciones hexagonales.

Flaky conocido (memoria US-004): ningún deadlock 40P01 detectado en esta ejecución.

---

## 4. Estado de BD post-tests

| Tabla         | Count |
|---------------|-------|
| factura       | 0     |
| reserva       | 1     |
| reserva_extra | 0     |
| audit_log     | 245   |

Diferencia: +47 en audit_log (entradas `crear` FACTURA de las pruebas de integración de idempotencia). Los registros de factura/reserva/extra fueron limpiados por el `afterEach`/`afterAll` de las specs de integración. El incremento en audit_log es esperado: el patrón de test aislado de este proyecto limpia entidades de negocio pero no audit_log (consistente con todas las suites previas; ver memoria "Tests con BD aislada slotify_test").

Restauración: no necesaria — datos de test correctamente limpiados por las propias specs.

---

## 5. Outcome

**PASS** — 122 suites / 1052 tests en verde (0 fallos reales). Los 4 specs dirigidos de US-027 pasan completamente. BD en estado correcto post-tests.

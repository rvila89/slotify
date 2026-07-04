# QA Report — Step N+2: Curl Endpoint Tests
**Change:** us-029-registrar-cobro-liquidacion  
**Date:** 2026-07-04  
**Branch:** feature/us-029-registrar-cobro-liquidacion  
**Endpoint:** `POST /api/reservas/{id}/facturas/liquidacion/cobro`  
**Executor:** qa-verifier (agent)

---

## 1. Setup

### BD antes de los tests (dev: slotify_dev)

Nota: el API en ejecucion usa `slotify_dev`. La migracion `20260704150000_us029_pago_tenant_id` no estaba aplicada a `slotify_dev` al inicio de la sesion QA; se aplico con `prisma migrate deploy` antes de las pruebas.

| Tabla     | Baseline dev |
|-----------|-------------|
| pago      | 0           |
| factura   | 0           |
| reserva   | 1           |
| documento | 0           |
| audit_log | 198         |

### Autenticacion

```bash
TOKEN=$(curl -s http://localhost:3000/api/auth/login \
  -X POST -H "Content-Type: application/json" \
  -d '{"email":"info@masialencis.com","password":"Slotify2026!"}' \
  | python -c "import sys,json; d=json.load(sys.stdin); print(d.get('accessToken',''))")
```

JWT valido obtenido. Tenant: `00000000-0000-0000-0000-000000000001`.

### Fixtures creados

Se crearon 7 reservas de test con el patron `QA-U029-*` (reserva_confirmada + factura liquidacion enviada) para cada escenario. Todos fueron eliminados al final.

---

## 2. Test 1 — Happy path con justificante

**Fixture:** reserva `QA-U029-9kw3xj`, RESERVA.liquidacionStatus=`facturada`, FACTURA.estado=`enviada`, total=`4100.00`. Documento `justificante_pago` creado previamente.

**Comando:**
```bash
curl -s -w "\n%{http_code}" \
  http://localhost:3000/api/reservas/46f9c719-146b-43f2-9c32-02b0810fbf09/facturas/liquidacion/cobro \
  -X POST \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"importe":"4100.00","fechaCobro":"2026-06-15","justificanteDocId":"dcad003c-2b75-483c-9050-c0a3dca798f3"}'
```

**Respuesta HTTP: 200**
```json
{
  "pago": {
    "idPago": "9715fda1-3725-4094-93c7-17616316f0d8",
    "facturaId": "41d2c195-e4bc-4ede-b91a-eb15dcbb0e41",
    "importe": "4100.00",
    "fechaCobro": "2026-06-15",
    "justificanteDocId": "dcad003c-2b75-483c-9050-c0a3dca798f3"
  },
  "liquidacion": { "estado": "cobrada", "total": "4100.00", ... },
  "liquidacionStatus": "cobrada",
  "alertaDiscrepancia": null
}
```

**Verificacion de BD:**
- PAGO creado: idPago=`9715fda1...`, importe=`4100`, fechaCobro=`2026-06-15`, justificanteDocId vinculado. **OK**
- PAGO.tenantId=`00000000-0000-0000-0000-000000000001`. **RLS correcto.**
- FACTURA.estado=`cobrada`. **OK**
- RESERVA.liquidacionStatus=`cobrada`, RESERVA.estado=`reserva_confirmada` (no avanza a evento_en_curso). **OK**
- AUDIT_LOG: entrada `accion=crear, entidad=PAGO`; entrada `accion=actualizar, entidad=FACTURA`; entrada `accion=actualizar, entidad=RESERVA`. **OK**
- alertaDiscrepancia=null (importe coincide). **OK**

**Resultado: PASSED**

**Restauracion:** PAGO eliminado, FACTURA revertida a `enviada`, RESERVA revertida a `facturada`.

---

## 3. Test 2 — Cobro sin justificante (justificanteDocId omitido)

**Fixture:** reserva `QA-U029-q2jzmg`, liquidacionStatus=`facturada`.

**Comando:**
```bash
curl -s -w "\n%{http_code}" \
  http://localhost:3000/api/reservas/330ff74f-aa67-43b2-b08d-008dcb5f965c/facturas/liquidacion/cobro \
  -X POST -H "Content-Type: application/json" -H "Authorization: Bearer $TOKEN" \
  -d '{"importe":"4100.00","fechaCobro":"2026-06-15"}'
```

**Respuesta HTTP: 200**
```json
{
  "pago": { "idPago": "e838766d...", "importe": "4100.00", "justificanteDocId": null },
  "liquidacionStatus": "cobrada",
  "alertaDiscrepancia": null
}
```

**Verificacion de BD:**
- PAGO.justificanteDocId=`null`. **OK**
- FACTURA.estado=`cobrada`. **OK**
- RESERVA.liquidacionStatus=`cobrada`. **OK**

**Resultado: PASSED**

**Restauracion:** PAGO eliminado, estados revertidos.

---

## 4. Test 3 — Discrepancia de importe (alerta en 200, no bloquea)

**Fixture:** reserva `QA-U029-gnusid`, FACTURA.total=`4100.00`.

**Comando:**
```bash
curl ... -d '{"importe":"4000.00","fechaCobro":"2026-06-15"}'
```

**Respuesta HTTP: 200**
```json
{
  "pago": { "importe": "4000.00", "justificanteDocId": null },
  "liquidacionStatus": "cobrada",
  "alertaDiscrepancia": {
    "importeFacturado": "4100.00",
    "importeCobrado": "4000.00",
    "diferencia": "100.00"
  }
}
```

**Verificacion de BD:**
- PAGO.importe=`4000` (importe real, no el facturado). **OK**
- FACTURA.estado=`cobrada`. **OK**
- AUDIT_LOG contiene referencias a `4100.00` y `4000.00` (discrepancia trazada). **OK**
- alertaDiscrepancia presente en respuesta 200 (no bloquea). **OK**

**Resultado: PASSED**

**Restauracion:** PAGO eliminado, estados revertidos.

---

## 5. Test 4 — Doble cobro → 409 LIQUIDACION_YA_COBRADA

**Fixture:** reserva `QA-U029-ek23n6`, liquidacionStatus=`facturada`.

**Secuencia:**
```bash
# Primer cobro (OK)
curl ... -d '{"importe":"4100.00","fechaCobro":"2026-06-15"}'
# → HTTP 200

# Segundo cobro (DEBE FALLAR)
curl ... -d '{"importe":"4100.00","fechaCobro":"2026-06-15"}'
```

**Respuesta segundo cobro HTTP: 409**
```json
{
  "statusCode": 409,
  "message": "La liquidación ya está marcada como cobrada",
  "error": "Conflict",
  "codigo": "LIQUIDACION_YA_COBRADA",
  "motivo": "La liquidación ya está marcada como cobrada"
}
```

**Verificacion de BD:**
- PAGO count=`1` (no se creo un segundo PAGO). **OK**
- Guarda de doble cobro activa via `SELECT ... FOR UPDATE`. **OK**

**Resultado: PASSED**

**Restauracion:** PAGO eliminado, FACTURA revertida a `enviada`, RESERVA revertida a `facturada`.

---

## 6. Test 5 — Precondicion pendiente → 409 LIQUIDACION_NO_FACTURADA

**Fixture:** reserva `QA-U029-40dox3`, liquidacionStatus=`pendiente` (FACTURA no enviada aun).

**Respuesta HTTP: 409**
```json
{
  "statusCode": 409,
  "message": "La factura de liquidación debe estar enviada antes de registrar su cobro",
  "error": "Conflict",
  "codigo": "LIQUIDACION_NO_FACTURADA",
  "motivo": "La factura de liquidación debe estar enviada antes de registrar su cobro"
}
```

**Verificacion de BD:**
- PAGO count=`0`. **OK**
- Estado de RESERVA sin cambios (`pendiente`). **OK**

**Resultado: PASSED**

---

## 7. Test 6 — Importe <= 0 → 400 COBRO_INVALIDO

**Comando:**
```bash
curl ... -d '{"importe":"0.00","fechaCobro":"2026-06-15"}'
```

**Respuesta HTTP: 400**
```json
{
  "statusCode": 400,
  "message": "El importe del cobro debe ser mayor que 0",
  "error": "Bad Request",
  "codigo": "COBRO_INVALIDO",
  "motivo": "El importe del cobro debe ser mayor que 0"
}
```

**Verificacion de BD:** PAGO count=`0`. **OK**

**Resultado: PASSED**

---

## 8. Test 7 — Fecha de cobro futura → 400 COBRO_INVALIDO

**Comando:**
```bash
curl ... -d '{"importe":"4100.00","fechaCobro":"2099-12-31"}'
```

**Respuesta HTTP: 400**
```json
{
  "statusCode": 400,
  "message": "La fecha de cobro no puede ser futura",
  "error": "Bad Request",
  "codigo": "COBRO_INVALIDO",
  "motivo": "La fecha de cobro no puede ser futura"
}
```

**Verificacion de BD:** PAGO count=`0`. **OK**

**Resultado: PASSED**

---

## 9. Test 8 — Justificante de otro tenant → 404 JUSTIFICANTE_NO_ENCONTRADO

**Setup:** Documento creado en tenant `00000000-0000-0000-0000-0000000000ff` (tenant ajeno, invisible por RLS para el gestor del tenant `...0001`).

**Respuesta HTTP: 404**
```json
{
  "statusCode": 404,
  "message": "El justificante de pago referenciado no existe",
  "error": "Not Found",
  "codigo": "JUSTIFICANTE_NO_ENCONTRADO"
}
```

**Verificacion de BD:** PAGO count=`0`. Multi-tenancy/RLS verificado: documento de otro tenant es invisible. **OK**

**Resultado: PASSED**

**Restauracion:** Documento del otro tenant eliminado.

---

## 10. Test 9 — Sin autenticacion → 401

**Respuesta HTTP: 401**
```json
{
  "statusCode": 401,
  "message": "No autenticado: token ausente o inválido",
  "error": "Unauthorized"
}
```

**Resultado: PASSED**

---

## 11. Test 10 — Reserva inexistente → 404 FACTURA_LIQUIDACION_NO_ENCONTRADA

**Comando:** reservaId=`00000000-0000-0000-0000-999999999999` (no existe).

**Respuesta HTTP: 404**
```json
{
  "statusCode": 404,
  "message": "No hay factura de liquidación para la reserva",
  "codigo": "FACTURA_LIQUIDACION_NO_ENCONTRADA"
}
```

**Resultado: PASSED**

---

## 12. Resumen de casos

| Test | Escenario | HTTP esperado | HTTP obtenido | BD verificada | Resultado |
|------|-----------|---------------|---------------|---------------|-----------|
| 1 | Happy path con justificante | 200 | 200 | PAGO creado, FACTURA/RESERVA cobrada, AUDIT_LOG, RLS tenant OK | PASSED |
| 2 | Sin justificante | 200 | 200 | PAGO.justificanteDocId=null, cobrada | PASSED |
| 3 | Discrepancia importe | 200 | 200 | alertaDiscrepancia en respuesta, PAGO con importe real, audit con discrepancia | PASSED |
| 4 | Doble cobro | 409 | 409 | 1 solo PAGO, codigo LIQUIDACION_YA_COBRADA | PASSED |
| 5 | Precondicion pendiente | 409 | 409 | 0 PAGOs, LIQUIDACION_NO_FACTURADA | PASSED |
| 6 | Importe <= 0 | 400 | 400 | 0 PAGOs, COBRO_INVALIDO | PASSED |
| 7 | Fecha futura | 400 | 400 | 0 PAGOs, COBRO_INVALIDO | PASSED |
| 8 | Justificante otro tenant | 404 | 404 | 0 PAGOs, JUSTIFICANTE_NO_ENCONTRADO, RLS OK | PASSED |
| 9 | Sin auth | 401 | 401 | — | PASSED |
| 10 | Reserva inexistente | 404 | 404 | FACTURA_LIQUIDACION_NO_ENCONTRADA | PASSED |

**Total: 10/10 PASSED**

---

## 13. Restauracion de BD

Todos los fixtures QA (`QA-U029-*`) eliminados al finalizar:
- 7 reservas eliminadas
- 7 facturas de liquidacion eliminadas
- PAGOs residuales eliminados
- Documentos QA eliminados
- Audit_log entries de los fixtures eliminados

**BD dev (slotify_dev) restaurada al estado baseline.**

| Tabla     | Post-restauracion | Baseline | Estado |
|-----------|-------------------|----------|--------|
| pago      | 0                 | 0        | OK |
| factura   | 0                 | 0        | OK |
| reserva   | 1                 | 1        | OK |
| documento | 0                 | 0        | OK |
| audit_log | 198               | 198      | OK |

---

## 14. Outcome

**PASS — US-029 endpoint verificado completamente.**

Los 10 escenarios del contrato OpenAPI pasan: happy path (PAGO creado, FACTURA/RESERVA cobrada, AUDIT_LOG, RLS), justificante opcional (NULL), discrepancia (alerta 200 sin bloqueo), doble cobro (409 LIQUIDACION_YA_COBRADA), precondicion pendiente (409 LIQUIDACION_NO_FACTURADA), validaciones dominio (400 COBRO_INVALIDO importe y fecha), RLS multi-tenant (404 JUSTIFICANTE_NO_ENCONTRADO), sin auth (401), reserva inexistente (404).

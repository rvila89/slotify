# Step N+2 — Curl Endpoint Tests
**Change:** us-036-registrar-devolucion-fianza
**Date:** 2026-07-10
**Executed by:** qa-verifier

---

## 1. Entorno

- Backend: `node dist/src/main.js` en localhost:3000 (ya levantado en sesión principal).
- BD: `slotify_dev` (PostgreSQL en Docker `slotify-postgres`).
- Endpoint verificado: `POST /api/reservas/:id/fianza/devolucion`
- Autenticación: Gestor `info@masialencis.com` (JWT Bearer).

### Seed de datos de prueba

Se insertaron 6 reservas QA (`qa036res0-...-001` a `006`) y 1 cliente (`qa036cli0-...-001`) en `slotify_dev` con los estados necesarios para las pruebas.

---

## 2. Autenticación

```bash
curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"info@masialencis.com","password":"Slotify2026!"}'
```

**Resultado:** 200 OK — `accessToken` JWT obtenido.

---

## 3. Tests

### TEST 1 — Happy Path: Devolución completa con justificante

**Condición:** reserva `qa036res0-...-001` (post_evento, fianza_status=cobrada, fianza_eur=1000.00, fianza_cobrada_fecha=2026-05-15, iban_devolucion presente)

**Comando:**
```bash
curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST \
  "http://localhost:3000/api/reservas/qa036res0-0000-0000-0000-000000000001/fianza/devolucion" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"importeDevuelto":"1000.00","fechaCobro":"2026-06-05","justificanteDocId":"a0360000-0000-0000-0000-000000000001"}'
```

**Respuesta:**
```json
{
  "reserva": {
    "idReserva": "qa036res0-0000-0000-0000-000000000001",
    "fianzaStatus": "devuelta",
    "fianzaDevueltaEur": "1000.00",
    "fianzaDevueltaFecha": "2026-06-05",
    "motivoRetencion": null
  },
  "documentoJustificante": {
    "idDocumento": "a0360000-0000-0000-0000-000000000001",
    "tipo": "justificante_pago",
    "mimeType": "application/pdf",
    "url": "https://storage.test/qa036/justificante.pdf"
  },
  "avisoSinJustificante": false
}
```
**HTTP_STATUS: 200**

**Verificacion BD:**
```sql
SELECT fianza_status, fianza_devuelta_eur, fianza_devuelta_fecha::date FROM reserva
WHERE id_reserva='qa036res0-0000-0000-0000-000000000001';
-- fianza_status=devuelta | 1000.00 | 2026-06-05
```

**AUDIT_LOG verificado:** `accion=actualizar`, `datos_anteriores={fianzaStatus: 'cobrada', fianzaDevueltaEur: null, fianzaDevueltaFecha: null}`, `datos_nuevos={fianzaStatus: 'devuelta', fianzaDevueltaEur: '1000.00', ...}`

**RESULTADO: PASS**

**Restauracion:** `UPDATE reserva SET fianza_status='cobrada', fianza_devuelta_eur=NULL, fianza_devuelta_fecha=NULL, motivo_retencion=NULL WHERE id_reserva='qa036res0-0000-0000-0000-000000000001'`

---

### TEST 2 — FA-01: Devolución parcial con motivo (retenida_parcial)

**Condición:** reserva `qa036res0-...-002` (fianza_eur=1500.00)

**Comando:**
```bash
curl ... -d '{"importeDevuelto":"1000.00","fechaCobro":"2026-06-06","motivoRetencion":"Daños en vajilla valorados en 500 €"}'
```

**Respuesta:**
```json
{
  "reserva": {"fianzaStatus": "retenida_parcial", "fianzaDevueltaEur": "1000.00", "motivoRetencion": "Daños en vajilla..."},
  "documentoJustificante": null,
  "avisoSinJustificante": true
}
```
**HTTP_STATUS: 200**

**Verificacion BD:** `fianza_status=retenida_parcial`, `fianza_devuelta_eur=1000.00`, `motivo_retencion` persistido.

**RESULTADO: PASS** — Restaurada BD.

---

### TEST 3 — Retención total (importe=0.00)

**Condición:** reserva `qa036res0-...-003` (fianza_eur=800.00)

**Comando:**
```bash
curl ... -d '{"importeDevuelto":"0.00","fechaCobro":"2026-06-10","motivoRetencion":"Retención total por desperfectos graves"}'
```

**Respuesta:** `{"reserva":{"fianzaStatus":"retenida_parcial","fianzaDevueltaEur":"0.00",...}}` — HTTP 200.

**Verificacion BD:** `fianza_status=retenida_parcial`, `fianza_devuelta_eur=0.00`. El valor `0.00` es válido.

**RESULTADO: PASS** — Restaurada BD.

---

### TEST 4 — FA-02: Importe > fianza_eur (400 IMPORTE_SUPERA_FIANZA)

**Nota:** tasks.md 7.5 menciona `422` pero el contrato congelado y el código usan `400`. Se valida contra `400`.

**Comando:**
```bash
curl ... -d '{"importeDevuelto":"1500.00","fechaCobro":"2026-06-05"}'
# contra reserva 001 con fianza_eur=1000.00
```

**Respuesta:**
```json
{
  "statusCode": 400,
  "message": "El importe a devolver no puede superar la fianza cobrada",
  "error": "Bad Request",
  "codigo": "IMPORTE_SUPERA_FIANZA"
}
```
**HTTP_STATUS: 400** (no 422)

**Verificacion BD:** ningún campo modificado.

**RESULTADO: PASS**

---

### TEST 5 — FA-03: Fecha anterior a fianza_cobrada_fecha (400 FECHA_DEVOLUCION_INVALIDA)

**Nota:** tasks.md 7.6 menciona `422` pero el contrato usa `400`.

**Comando:**
```bash
curl ... -d '{"importeDevuelto":"1000.00","fechaCobro":"2026-05-10"}'
# fianza_cobrada_fecha=2026-05-15
```

**Respuesta:**
```json
{
  "statusCode": 400,
  "mensaje": "La fecha de devolución no puede ser anterior a la fecha de cobro de la fianza",
  "codigo": "FECHA_DEVOLUCION_INVALIDA"
}
```
**HTTP_STATUS: 400** (no 422)

**Verificacion BD:** `fianza_status` sigue en `cobrada`, sin mutación.

**RESULTADO: PASS**

---

### TEST 6 — FA-01 sin motivo (400 MOTIVO_RETENCION_REQUERIDO)

**Comando:**
```bash
curl ... -d '{"importeDevuelto":"500.00","fechaCobro":"2026-06-05"}'
# importe < fianza_eur (1000.00) sin motivoRetencion
```

**Respuesta:**
```json
{
  "statusCode": 400,
  "message": "El motivo de retención es obligatorio en una devolución parcial",
  "codigo": "MOTIVO_RETENCION_REQUERIDO"
}
```
**HTTP_STATUS: 400**

**RESULTADO: PASS**

---

### TEST 7 — FA-04: Registro sin justificante (200 + avisoSinJustificante=true)

**Condición:** reserva `qa036res0-...-006` (fianza_eur=600.00), sin justificanteDocId en el body.

**Comando:**
```bash
curl ... -d '{"importeDevuelto":"600.00","fechaCobro":"2026-06-05"}'
```

**Respuesta:**
```json
{
  "reserva": {"fianzaStatus": "devuelta", "fianzaDevueltaEur": "600.00", ...},
  "documentoJustificante": null,
  "avisoSinJustificante": true
}
```
**HTTP_STATUS: 200**

**Verificacion BD:** `fianza_status=devuelta`, sin DOCUMENTO creado.

**RESULTADO: PASS** — Restaurada BD.

---

### TEST 8a — Precondición: sin IBAN (409 PRECONDICION_NO_CUMPLIDA)

**Condición:** reserva `qa036res0-...-004` (iban_devolucion=NULL, cliente Anna Puig).

**Respuesta:**
```json
{
  "statusCode": 409,
  "message": "No se cumplen las precondiciones para registrar la devolución de la fianza",
  "codigo": "PRECONDICION_NO_CUMPLIDA"
}
```
**HTTP_STATUS: 409**

**RESULTADO: PASS**

---

### TEST 8b — Precondición: fuera de post_evento (409 PRECONDICION_NO_CUMPLIDA)

**Condición:** reserva `qa036res0-...-005` (estado=evento_en_curso).

**Respuesta:** 409 `PRECONDICION_NO_CUMPLIDA`.

**RESULTADO: PASS**

---

### TEST 9 — Doble registro (409 DEVOLUCION_YA_REGISTRADA)

**Primer registro:** 200 OK.

**Segundo registro sobre reserva ya en `devuelta`:**
```json
{
  "statusCode": 409,
  "message": "La devolución de la fianza ya está registrada",
  "codigo": "DEVOLUCION_YA_REGISTRADA"
}
```
**HTTP_STATUS: 409**

**RESULTADO: PASS** — Restaurada BD.

---

### TEST 10 — justificanteDocId inexistente (404 JUSTIFICANTE_NO_ENCONTRADO)

**Comando:**
```bash
curl ... -d '{"importeDevuelto":"1000.00","fechaCobro":"2026-06-05","justificanteDocId":"ffffffff-ffff-ffff-ffff-ffffffffffff"}'
```

**Respuesta:**
```json
{
  "statusCode": 404,
  "message": "El justificante de pago referenciado no existe",
  "codigo": "JUSTIFICANTE_NO_ENCONTRADO"
}
```
**HTTP_STATUS: 404**

**RESULTADO: PASS**

---

## 4. Estado BD post-tests

Todos los datos de test fueron restaurados. BD `slotify_dev` vuelve al estado baseline (4 reservas originales, 0 documentos justificante_pago, 0 fianza mutations).

---

## 5. Correcciones detectadas

**tasks.md 7.5 y 7.6 indican `422`:** Los errores FA-02 (IMPORTE_SUPERA_FIANZA) y FA-03 (FECHA_DEVOLUCION_INVALIDA) devuelven `400 Bad Request`, NO `422 Unprocessable Entity`. Esto está alineado con el contrato OpenAPI congelado y con el patrón de US-030. Las tareas `tasks.md` tienen un error tipográfico. Los tests del contrato ya validan `400` correctamente.

---

## 6. Resumen

| Test | Escenario | HTTP Esperado | HTTP Obtenido | Resultado |
|------|-----------|---------------|---------------|-----------|
| 1 | Happy path devolución completa + justificante | 200 | 200 | PASS |
| 2 | FA-01 parcial con motivo | 200 | 200 | PASS |
| 3 | Retención total (importe=0.00) | 200 | 200 | PASS |
| 4 | FA-02 importe > fianza | 400 | 400 | PASS |
| 5 | FA-03 fecha anterior | 400 | 400 | PASS |
| 6 | Parcial sin motivo | 400 | 400 | PASS |
| 7 | FA-04 sin justificante + aviso | 200 | 200 | PASS |
| 8a | Precondición sin IBAN | 409 | 409 | PASS |
| 8b | Precondición fuera post_evento | 409 | 409 | PASS |
| 9 | Doble registro | 409 | 409 | PASS |
| 10 | justificanteDocId inexistente | 404 | 404 | PASS |

**OUTCOME: PASS — 11/11 tests OK**

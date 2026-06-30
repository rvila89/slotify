# Step 7 — Pruebas de Endpoints con curl
## Change: 2026-06-30-us-008-programar-visita-espacio
## Fecha: 30/06/2026
## Agente: qa-verifier

---

## 1. Entorno

- API: NestJS en `http://localhost:3000` (arrancada con `pnpm dev` en `apps/api`)
- PostgreSQL: `slotify-postgres` (Docker, `healthy`)
- Gestor seed: `info@masialencis.com` / tenant `00000000-0000-0000-0000-000000000001`
- TENANT_SETTINGS.max_dias_programar_visita = 7 (seed)
- Fecha de ejecución: 2026-06-30 (hoy)

### JWT obtenido

```
POST /api/auth/login
Body: {"email": "info@masialencis.com", "password": "Slotify2026!"}
→ 200 { accessToken: "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9..." }
```

---

## 2. Baseline BD pre-curl

| Tabla | Count |
|-------|-------|
| RESERVA (total) | 9 |
| RESERVA s2a | 1 (`1abe5647`, sin fecha_evento) |
| RESERVA s2b | 5 |
| RESERVA s2c | 1 (`d07f3b65`, fecha_evento=2026-07-04) |
| RESERVA s2d | 2 |
| FECHA_BLOQUEADA | 2 |
| COMUNICACION | 9 |
| AUDIT_LOG | 62 |

---

## 3. Tests ejecutados

### TEST 7.2 — Happy path desde 2b (fecha = hoy+3)

**RESERVA de prueba:** `0c421363-a39a-4ff1-b8d4-761d1cf66ba3` (s2b, fecha_evento=2026-07-11)

```bash
curl -X POST http://localhost:3000/api/reservas/0c421363-a39a-4ff1-b8d4-761d1cf66ba3/visita \
  -H "Authorization: Bearer {TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"fecha": "2026-07-03", "hora": "17:30"}'
```

**Respuesta 200:**
```json
{
  "idReserva": "0c421363-a39a-4ff1-b8d4-761d1cf66ba3",
  "subEstado": "2v",
  "ttlExpiracion": "2026-07-04T23:59:59.000Z",
  "visitaProgramadaFecha": "2026-07-03",
  "visitaProgramadaHora": "17:30",
  "visitaRealizada": false,
  ...
}
```

**Verificación BD:**
- RESERVA.sub_estado = `s2v` ✓
- RESERVA.visita_programada_fecha = `2026-07-03` ✓
- RESERVA.visita_programada_hora = `17:30` ✓
- RESERVA.visita_realizada = `false` ✓
- RESERVA.ttl_expiracion = `2026-07-04 23:59:59` (visita+1día 23:59:59) ✓
- FECHA_BLOQUEADA: 1 fila, ttl_expiracion = `2026-07-04 23:59:59` (UPDATE) ✓
- COMUNICACION: E6 `estado='enviado'` ✓
- AUDIT_LOG: `accion='transicion'`, datos_anteriores.subEstado=`2b`, datos_nuevos.subEstado=`2v` ✓

**Restauración:** sub_estado→s2b, ttl_expiracion→original, FECHA_BLOQUEADA TTL→original, DELETE E6 COMUNICACION, DELETE audit transicion/E6. Verificado: RESERVA en s2b. ✓

---

### TEST 7.3 — Happy path desde 2a (sin bloqueo previo, con fecha_evento)

**RESERVA de prueba:** `1abe5647-b5dd-46d5-a824-6a800f57c2fe` (s2a, fecha_evento=NULL → fijada a 2027-08-01 para el test)

**Pre-condición:** `UPDATE reserva SET fecha_evento='2027-08-01' WHERE id_reserva='1abe5647'`
(La 2a seed no tiene fecha_evento; se la fijamos temporalmente para el test)

```bash
curl -X POST http://localhost:3000/api/reservas/1abe5647-b5dd-46d5-a824-6a800f57c2fe/visita \
  -H "Authorization: Bearer {TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"fecha": "2026-07-02", "hora": "11:00"}'
```

**Respuesta 200:**
```json
{
  "subEstado": "2v",
  "ttlExpiracion": "2026-07-03T23:59:59.000Z",
  "visitaProgramadaFecha": "2026-07-02",
  "visitaProgramadaHora": "11:00",
  "visitaRealizada": false,
  ...
}
```

**Verificación BD:**
- RESERVA.sub_estado = `s2v` ✓
- FECHA_BLOQUEADA: 1 fila nueva `tipo_bloqueo='blando'`, ttl_expiracion = `2026-07-03 23:59:59` (INSERT, visita+1día) ✓
- COMUNICACION: E6 `estado='enviado'` ✓

**Restauración:** DELETE FECHA_BLOQUEADA, DELETE E6 COMUNICACION, DELETE audit_log transicion/E6, UPDATE reserva→s2a + fecha_evento=NULL. Verificado: RESERVA en s2a, fecha_evento NULL, FECHA_BLOQUEADA=0 para esta reserva. ✓

---

### TEST 7.4 — Happy path desde 2c (bloqueo existente)

**RESERVA de prueba:** `d07f3b65-f12e-45a4-bb3f-e92bf0299313` (s2c, fecha_evento=2026-07-04, ttl=2026-07-06)

```bash
curl -X POST http://localhost:3000/api/reservas/d07f3b65-f12e-45a4-bb3f-e92bf0299313/visita \
  -H "Authorization: Bearer {TOKEN}" \
  -H "Content-Type: application/json" \
  -d '{"fecha": "2026-07-03", "hora": "10:00"}'
```

**Respuesta 200:**
```json
{
  "subEstado": "2v",
  "ttlExpiracion": "2026-07-04T23:59:59.000Z",
  "visitaProgramadaFecha": "2026-07-03",
  "visitaProgramadaHora": "10:00",
  "visitaRealizada": false,
  ...
}
```

**Verificación BD:**
- RESERVA.sub_estado = `s2v` ✓
- FECHA_BLOQUEADA: 1 fila (la misma, UPDATE de TTL de 2026-07-06 a 2026-07-04 23:59:59) ✓
- COMUNICACION: E6 `estado='enviado'` ✓

Nota: Al restaurar, se deletaron accidentalmente 2 entradas de audit_log en lugar de 1 (la del test + 1 pre-existente de la transicion 2b→2c de la misma reserva). Se restauró la entrada pre-existente con INSERT en audit_log. Audit_log volvió a 62. ✓

**Restauración:** sub_estado→s2c, ttl→2026-07-06, FECHA_BLOQUEADA TTL→2026-07-06, DELETE E6, INSERT audit_log transicion 2b→2c (restauración). Verificado: RESERVA en s2c, ttl=2026-07-06. ✓

---

### TEST 7.5a — fecha = hoy → 422

```bash
curl -X POST .../0c421363.../visita -d '{"fecha": "2026-06-30", "hora": "17:30"}'
```

**Respuesta 422:**
```json
{
  "statusCode": 422,
  "message": "La fecha de la visita debe ser futura (posterior a hoy)",
  "error": "Unprocessable Entity"
}
```
RESERVA intacta (s2b, sin mutar). ✓

---

### TEST 7.5b — fecha en pasado → 422

```bash
curl -X POST .../0c421363.../visita -d '{"fecha": "2026-06-25", "hora": "17:30"}'
```

**Respuesta 422:**
```json
{
  "statusCode": 422,
  "message": "La fecha de la visita debe ser futura (posterior a hoy)",
  "error": "Unprocessable Entity"
}
```
✓

---

### TEST 7.5c — fecha > hoy+7 → 422

```bash
curl -X POST .../0c421363.../visita -d '{"fecha": "2026-07-10", "hora": "17:30"}'
```

**Respuesta 422:**
```json
{
  "statusCode": 422,
  "message": "La fecha de la visita no puede superar la ventana de 7 días (hoy + max_dias_programar_visita)",
  "error": "Unprocessable Entity"
}
```
✓

---

### TEST 7.6a — RESERVA en 2d → 409 (UC-12)

**RESERVA:** `6c943572-bcfa-47d3-83c9-53898e6dd28d` (s2d)

```bash
curl -X POST .../6c943572.../visita -d '{"fecha": "2026-07-03", "hora": "17:30"}'
```

**Respuesta 409:**
```json
{
  "statusCode": 409,
  "message": "No es posible programar una visita para una consulta en cola. La consulta debe ser promovida primero (UC-12).",
  "error": "Conflict",
  "motivo": "No es posible programar una visita para una consulta en cola. La consulta debe ser promovida primero (UC-12)."
}
```
El campo `motivo` está presente en el cuerpo del error (contrato UC-12). RESERVA intacta (s2d). ✓

---

### TEST 7.6b — RESERVA en 2a sin fecha_evento → 422

**RESERVA:** `1abe5647-b5dd-46d5-a824-6a800f57c2fe` (s2a, fecha_evento=NULL)

```bash
curl -X POST .../1abe5647.../visita -d '{"fecha": "2026-07-03", "hora": "17:30"}'
```

**Respuesta 422:**
```json
{
  "statusCode": 422,
  "message": "Para programar una visita desde una consulta exploratoria (2a) debe introducirse antes la fecha del evento",
  "error": "Unprocessable Entity"
}
```
RESERVA intacta (s2a, fecha_evento NULL). ✓

---

### TEST 7.7a — RESERVA inexistente → 404

```bash
curl -X POST .../00000000-0000-0000-0000-999999999999/visita -d '{"fecha": "2026-07-03", "hora": "17:30"}'
```

**Respuesta 404:**
```json
{
  "statusCode": 404,
  "message": "La reserva no existe para el tenant",
  "error": "Not Found"
}
```
✓

---

### TEST 7.7b — Sin sesión → 401

```bash
curl -X POST .../0c421363.../visita -d '{"fecha": "2026-07-03", "hora": "17:30"}'
# (sin header Authorization)
```

**Respuesta 401:**
```json
{
  "statusCode": 401,
  "message": "No autenticado: token ausente o inválido",
  "error": "Unauthorized"
}
```
✓

---

### TEST 7.8 — Cuerpo inválido → 400 (class-validator)

```bash
curl -X POST .../0c421363.../visita -d '{"fecha": "invalid-date", "hora": "25:99"}' \
  -H "Authorization: Bearer {TOKEN}"
```

**Respuesta 400:**
```json
{
  "statusCode": 400,
  "message": [
    "La fecha de la visita debe tener el formato YYYY-MM-DD",
    "La hora de la visita debe tener el formato HH:mm (24h)"
  ],
  "error": "Bad Request"
}
```
✓ El formato de error es un array de mensajes (class-validator NestJS). El contrato OpenAPI (`ProgramarVisitaRequest`) no especifica formato de 400 más allá de `message`; la estructura es coherente con el resto de endpoints del proyecto.

---

## 4. Verificación de BD post-curl

| Tabla | Baseline | Post-curl | Delta | Estado |
|-------|----------|-----------|-------|--------|
| RESERVA total | 9 | 9 | 0 | OK |
| RESERVA s2a | 1 | 1 | 0 | OK |
| RESERVA s2b | 5 | 5 | 0 | OK |
| RESERVA s2c | 1 | 1 | 0 | OK |
| RESERVA s2d | 2 | 2 | 0 | OK |
| FECHA_BLOQUEADA | 2 | 2 | 0 | OK |
| COMUNICACION | 9 | 9 | 0 | OK |
| AUDIT_LOG | 62 | 62 | 0 | OK |
| CLIENTE | 9 | 9 | 0 | OK |

Incidencia de restauración: en el test 7.4 se eliminó accidentalmente 1 entrada de audit_log pre-existente (transicion 2b→2c de la RESERVA d07f3b65). Se restauró mediante INSERT con los datos originales. Audit_log quedó en 62. Sin más diferencias con el baseline.

---

## 5. Resumen de pruebas

| Test | Endpoint | Escenario | HTTP esperado | HTTP obtenido | Resultado |
|------|----------|-----------|---------------|---------------|-----------|
| 7.2 | POST /reservas/{2b}/visita | Happy path 2b, fecha=hoy+3 | 200 | 200 | PASS |
| 7.3 | POST /reservas/{2a}/visita | Happy path 2a sin bloqueo | 200 | 200 | PASS |
| 7.4 | POST /reservas/{2c}/visita | Happy path 2c, extiende bloqueo | 200 | 200 | PASS |
| 7.5a | POST /reservas/{2b}/visita | fecha = hoy (≤ hoy) | 422 | 422 | PASS |
| 7.5b | POST /reservas/{2b}/visita | fecha en pasado | 422 | 422 | PASS |
| 7.5c | POST /reservas/{2b}/visita | fecha > hoy+7 (ventana) | 422 | 422 | PASS |
| 7.6a | POST /reservas/{2d}/visita | Cola 2d → UC-12 | 409 | 409 | PASS |
| 7.6b | POST /reservas/{2a}/visita | 2a sin fecha_evento | 422 | 422 | PASS |
| 7.7a | POST /reservas/{inexistente}/visita | RESERVA inexistente | 404 | 404 | PASS |
| 7.7b | POST /reservas/{2b}/visita | Sin sesión | 401 | 401 | PASS |
| 7.8 | POST /reservas/{2b}/visita | Cuerpo inválido | 400 | 400 | PASS |

**Total: 11/11 tests PASS**

---

## Outcome: PASS

Todos los endpoints verificados en verde. BD restaurada a su estado baseline. Sin bloqueantes.

# Step N+2 — curl Endpoint Tests
**Change:** `us-004-alta-consulta-con-fecha`
**Date:** 2026-06-28
**Agent:** qa-verifier

---

## Setup

**Backend:** already running (ts-node-dev port 3000, slotify-postgres healthy)
**Auth endpoint:** `POST /api/auth/login`
**Credentials:** `info@masialencis.com` / `Slotify2026!` (gestor seed, tenant `00000000-...0001`)

**Token acquisition:**
```bash
curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"info@masialencis.com","password":"Slotify2026!"}' \
  | python3 -c "import sys,json; print(json.load(sys.stdin)['accessToken'])"
# → eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9... (JWT OK)
```

**BD Baseline** (before all curl tests):
- reserva: 0, fecha_bloqueada: 0, comunicacion: 0, cliente: 0, audit_log (RESERVA): 1 (pre-existing orphan)

---

## Test 7.2 — POST fecha libre (futura) → 201 sub-estado 2b

**Command:**
```bash
curl -s -X POST http://localhost:3000/api/reservas \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "canalEntrada": "web",
    "fechaEvento": "2027-09-15",
    "tipoEvento": "boda",
    "duracionHoras": 8,
    "numAdultosNinosMayores4": 30,
    "numNinosMenores4": 5,
    "cliente": {"nombre":"Ana","apellidos":"García","email":"ana.garcia@qa-curl.test","telefono":"600111001"}
  }'
```

**Response (HTTP 201):**
```json
{
  "idReserva": "2e58eb9e-2c89-47be-97c1-a60ab5ab1a65",
  "codigo": "26-0001",
  "estado": "consulta",
  "subEstado": "2b",
  "ttlExpiracion": "2026-07-01T18:31:49.292Z",
  "posicionCola": null,
  "consultaBloqueanteId": null,
  "tipoBloqueo": "blando",
  "fechaDisponible": true,
  "avisoDisponibilidad": null,
  "tarifaEstimada": {
    "temporada": "alta",
    "tarifaAConsultar": false,
    "precioTarifaEur": 902,
    "extrasTotalEur": 0,
    "totalEur": 902,
    "tarifaId": "c4710102-26f5-4055-97c3-292fb0db72c7"
  }
}
```

**BD verification:**
- `reserva.sub_estado = s2b` ✓
- `reserva.ttl_expiracion = 2026-07-01` (today + 3 días = ttl_consulta_dias=3) ✓
- `fecha_bloqueada.tipo_bloqueo = blando` ✓
- `fecha_bloqueada.ttl_expiracion` = same as reserva ✓
- `comunicacion.codigo_email = E1, estado = enviado` (sin comentarios → auto-enviado) ✓
- `audit_log.entidad = RESERVA, accion = crear` ✓

**Resultado: PASS** | **BD restaurada:** DELETE reserva + fecha_bloqueada + comunicacion + audit_log + cliente

---

## Test 7.3 — POST misma fecha (bloqueada por 2b) → 201 sub-estado 2d

**Command:**
```bash
curl -s -X POST http://localhost:3000/api/reservas \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "canalEntrada": "instagram",
    "fechaEvento": "2027-09-15",
    "tipoEvento": "boda",
    "duracionHoras": 8,
    "numAdultosNinosMayores4": 25,
    "cliente": {"nombre":"Carlos","apellidos":"López","email":"carlos.lopez@qa-curl.test","telefono":"600111002"}
  }'
```

**Response (HTTP 201):**
```json
{
  "idReserva": "72426f8d-150b-41e0-a3a7-dab7d9c18889",
  "codigo": "26-0002",
  "estado": "consulta",
  "subEstado": "2d",
  "ttlExpiracion": null,
  "posicionCola": 1,
  "consultaBloqueanteId": "2e58eb9e-2c89-47be-97c1-a60ab5ab1a65",
  "tipoBloqueo": null,
  "fechaDisponible": false,
  "avisoDisponibilidad": "La fecha está reservada por otra consulta; tu solicitud queda en lista de espera.",
  "tarifaEstimada": { "temporada": "alta", "tarifaAConsultar": false, "precioTarifaEur": 785, "totalEur": 785 }
}
```

**BD verification:**
- `reserva.sub_estado = s2d` ✓
- `posicion_cola = 1` ✓
- `consulta_bloqueante_id = 2e58eb9e-...` (points to 2b ganadora) ✓
- `fecha_bloqueada` count = 1 (only the original 2b's, no new one for 2d) ✓

**Resultado: PASS** | **BD restaurada:** DELETE 2d reserva + cliente

---

## Test 7.4 — POST fecha bloqueada por pre_reserva → 201 sub-estado 2a

**Setup:** Created a 2b reserva for `2027-10-20`, then `UPDATE reserva SET estado='pre_reserva', sub_estado=NULL` via SQL.

**Command:**
```bash
curl -s -X POST http://localhost:3000/api/reservas \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "canalEntrada": "whatsapp",
    "fechaEvento": "2027-10-20",
    "tipoEvento": "boda",
    "duracionHoras": 8,
    "numAdultosNinosMayores4": 30,
    "cliente": {"nombre":"María","apellidos":"Fernández","email":"maria.fernandez@qa-curl.test","telefono":"600111003"}
  }'
```

**Response (HTTP 201):**
```json
{
  "idReserva": "50512344-2f10-4c22-8008-6974d90eea37",
  "codigo": "26-0003",
  "estado": "consulta",
  "subEstado": "2a",
  "ttlExpiracion": null,
  "posicionCola": null,
  "consultaBloqueanteId": null,
  "tipoBloqueo": null,
  "fechaDisponible": false,
  "avisoDisponibilidad": "La fecha seleccionada no está disponible; la consulta queda como exploratoria."
}
```

**BD verification:**
- `reserva.sub_estado = s2a` ✓
- `posicion_cola = NULL` ✓
- `consulta_bloqueante_id = NULL` ✓
- No new `fecha_bloqueada` for 2a reservation ✓

**Resultado: PASS** | **BD restaurada:** DELETE 2a + pre_reserva blocker + fecha_bloqueada + clientes

---

## Test 7.5a — POST fecha_evento = HOY → 400

**Command:**
```bash
curl -s -X POST http://localhost:3000/api/reservas \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "canalEntrada": "web",
    "fechaEvento": "2026-06-28",
    "cliente": {"nombre":"Bypass","apellidos":"Today","email":"bypass.today@qa-curl.test","telefono":"600111010"}
  }'
```

**Response (HTTP 400):**
```json
{
  "statusCode": 400,
  "message": ["fechaEvento: La fecha del evento debe ser estrictamente futura (posterior a hoy)"],
  "error": "Bad Request",
  "path": "/api/reservas",
  "timestamp": "2026-06-28T18:33:42.360Z"
}
```

**BD verification:** reserva=0, fecha_bloqueada=0, cliente count unchanged ✓

**Resultado: PASS** (no records created)

---

## Test 7.5b — POST fecha PASADA (2026-05-01) → 400

**Response (HTTP 400):**
```json
{
  "statusCode": 400,
  "message": ["fechaEvento: La fecha del evento debe ser estrictamente futura (posterior a hoy)"],
  "error": "Bad Request"
}
```

**BD verification:** no records created ✓

**Resultado: PASS**

---

## Test 7.6 — POST con fecha pero SIN invitados/horas → E1 dossier general sin precio

**Command:**
```bash
curl -s -X POST http://localhost:3000/api/reservas \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "canalEntrada": "web",
    "fechaEvento": "2027-11-10",
    "cliente": {"nombre":"Pedro","apellidos":"Sin Datos","email":"pedro.sindatos@qa-curl.test","telefono":"600111004"}
  }'
```

**Response (HTTP 201):**
```json
{
  "idReserva": "f474a336-9d60-4b73-82c1-73e8d7943b06",
  "codigo": "26-0002",
  "estado": "consulta",
  "subEstado": "2b",
  "ttlExpiracion": "2026-07-01T18:34:10.711Z",
  "tipoBloqueo": "blando",
  "fechaDisponible": true,
  "tarifaEstimada": null
}
```

**BD verification:**
- `sub_estado = s2b` ✓
- `fecha_bloqueada.tipo_bloqueo = blando` ✓
- `comunicacion.codigo_email = E1, estado = enviado` ✓
- `tarifaEstimada = null` (no invitados, no horas → dossier general sin precio) ✓

**Resultado: PASS** | **BD restaurada**

---

## Test 7.7 — POST SIN fecha (regresión US-003) → 201 sub-estado 2a

**Command:**
```bash
curl -s -X POST http://localhost:3000/api/reservas \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "canalEntrada": "telefono",
    "cliente": {"nombre":"Laura","apellidos":"Sin Fecha","email":"laura.sinfecha@qa-curl.test","telefono":"600111005"}
  }'
```

**Response (HTTP 201):**
```json
{
  "idReserva": "4bd0c2a6-b6a6-4ea4-a5c7-8bb03d5efaf9",
  "codigo": "26-0002",
  "estado": "consulta",
  "subEstado": "2a",
  "ttlExpiracion": null,
  "posicionCola": null,
  "consultaBloqueanteId": null,
  "tipoBloqueo": null,
  "fechaDisponible": null,
  "avisoDisponibilidad": null,
  "tarifaEstimada": null
}
```

**Resultado: PASS** (regresión US-003 intacta) | **BD restaurada**

---

## Test 7.8 — Formato de error coincide con OpenAPI

**OpenAPI `ErrorResponse` schema:**
```yaml
ErrorResponse:
  required: [statusCode, message]
  properties:
    statusCode: { type: integer }
    message: { oneOf: [string, string[]] }
    error: { type: string }
```

**Actual 400 response:**
```json
{
  "statusCode": 400,          ← integer ✓
  "message": ["fechaEvento: ..."],  ← array of strings ✓
  "error": "Bad Request",     ← string ✓
  "path": "/api/reservas",    ← extra (not in spec, acceptable)
  "timestamp": "..."          ← extra (not in spec, acceptable)
}
```

**Resultado: PASS** — formato coincide con el contrato OpenAPI.

---

## BD Final State (post all tests, fully restored)

| Table | Pre | Post | Delta |
|-------|-----|------|-------|
| `reserva` | 0 | 0 | 0 |
| `fecha_bloqueada` | 0 | 0 | 0 |
| `comunicacion` | 0 | 0 | 0 |
| `cliente` | 0 | 0 | 0 |

Note: `audit_log` grew by ~11 entries (login events from authentication calls during the test session) — login audit entries are non-destructive and represent actual login events.

---

## Outcome: PASS

All 7 curl test cases passed:
- 7.2 fecha libre → 2b + FECHA_BLOQUEADA blando + ttl=+3d + E1 enviado + audit_log RESERVA ✓
- 7.3 misma fecha → 2d posicion_cola=1 + consulta_bloqueante_id + SIN nueva FECHA_BLOQUEADA ✓
- 7.4 fecha pre_reserva → 2a exploratoria, sin bloqueo ni cola ✓
- 7.5 fecha=hoy → 400 + fecha pasada → 400, sin crear nada ✓
- 7.6 fecha sin invitados/horas → 2b + E1 sin precio (tarifaEstimada=null) ✓
- 7.7 sin fecha → 2a regresión US-003 intacta ✓
- 7.8 formato de error coincide con OpenAPI ErrorResponse ✓

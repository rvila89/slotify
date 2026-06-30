# Step 7 — Pruebas de Endpoint con curl
## Change: us-007-transicion-pendiente-invitados
## Fecha: 2026-06-30
## Agente: qa-verifier

---

## 1. Entorno

- Backend NestJS en `http://localhost:3000` (ya arrancado, `GET /api/health → {"status":"ok"}`)
- Autenticación: `POST /api/auth/login` con `info@masialencis.com / Slotify2026!`
- Token JWT access (15min TTL): se renovó entre tests con nuevo login
- Endpoint probado: `POST /api/reservas/:id/pendiente-invitados`

---

## 2. Baseline de BD (pre-curl)

| Tabla | Count |
|-------|-------|
| RESERVA total | 8 (5 s2b, 2 s2d, 1 s2a) |
| FECHA_BLOQUEADA | 0 |
| AUDIT_LOG | 55 |
| COMUNICACION | 8 |
| CLIENTE | 8 |

---

## 3. Tests ejecutados

### 3.1 — 401 Sin token

```bash
curl -s -X POST http://localhost:3000/api/reservas/some-id/pendiente-invitados \
  -H "Content-Type: application/json" -d '{}'
```

**Respuesta (HTTP 401):**
```json
{
  "statusCode": 401,
  "message": "No autenticado: token ausente o inválido",
  "error": "Unauthorized",
  "path": "/api/reservas/some-id/pendiente-invitados",
  "timestamp": "2026-06-30T10:11:12.664Z"
}
```
Resultado: PASS — 401 correcto sin token.

---

### 3.2 — 404 Reserva inexistente

```bash
curl -s -X POST http://localhost:3000/api/reservas/00000000-0000-0000-0000-ffffffffffff/pendiente-invitados \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}'
```

**Respuesta (HTTP 404):**
```json
{
  "statusCode": 404,
  "message": "La reserva no existe para el tenant",
  "error": "Not Found"
}
```
Resultado: PASS — 404 correcto para reserva inexistente.

---

### 3.3 — 409 Reserva 2b sin FECHA_BLOQUEADA

Reserva usada: `3d8dd655-c701-4cbd-bf70-6ddb61b714fe` (s2b del seed, sin FECHA_BLOQUEADA)

```bash
curl -s -X POST http://localhost:3000/api/reservas/3d8dd655-c701-4cbd-bf70-6ddb61b714fe/pendiente-invitados \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}'
```

**Respuesta (HTTP 409):**
```json
{
  "statusCode": 409,
  "message": "La transición a 2.c requiere una fecha bloqueada activa para la reserva",
  "error": "Conflict",
  "motivo": "La transición a 2.c requiere una fecha bloqueada activa para la reserva"
}
```
Resultado: PASS — 409 correcto sin FECHA_BLOQUEADA.

---

### 3.4 — 409 TTL expirado

Semilla: RESERVA en s2b + FECHA_BLOQUEADA con `ttlExpiracion = ayer`.

```bash
curl -s -X POST http://localhost:3000/api/reservas/4213882d-d2a0-4f49-b9d9-82b225d9a505/pendiente-invitados \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}'
```

**Respuesta (HTTP 409):**
```json
{
  "statusCode": 409,
  "message": "El bloqueo de la fecha ha expirado; la transición a 2.c no es posible",
  "error": "Conflict",
  "motivo": "El bloqueo de la fecha ha expirado; la transición a 2.c no es posible"
}
```
Resultado: PASS — 409 correcto con TTL expirado. RESERVA permaneció en s2b (verificado en BD).

Restaurado: reserva y bloqueo semilla eliminados post-test.

---

### 3.5 — 422 Guarda de origen: reserva en 2c (no 2b)

Semilla: RESERVA en `s2c` + FECHA_BLOQUEADA vigente.

```bash
curl -s -X POST http://localhost:3000/api/reservas/f92499d0-2fb4-4a05-8873-ed7cfa62884a/pendiente-invitados \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}'
```

**Respuesta (HTTP 422):**
```json
{
  "statusCode": 422,
  "message": "La transición a 2.c (pendiente de invitados) solo es válida desde el sub-estado 2b",
  "error": "Unprocessable Entity"
}
```
Resultado: PASS — 422 correcto para origen no-2b (2c).

Restaurado: reserva y bloqueo semilla eliminados post-test.

---

### 3.6 — 200 Reserva 2b con bloqueo vigente, SIN cola

Semilla: RESERVA `f6d08cc9-9ac6-4506-991d-928248b064a3` en s2b, TTL base `2026-07-30T10:12:07.100Z`, FECHA_BLOQUEADA vigente, 0 colas.

```bash
curl -s -X POST http://localhost:3000/api/reservas/f6d08cc9-9ac6-4506-991d-928248b064a3/pendiente-invitados \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}'
```

**Respuesta (HTTP 200):**
```json
{
  "reserva": {
    "idReserva": "f6d08cc9-9ac6-4506-991d-928248b064a3",
    "clienteId": "7a2b81da-0537-43ee-a870-fd7aed756d6b",
    "estado": "consulta",
    "subEstado": "2c",
    "fechaEvento": "2027-09-15",
    "ttlExpiracion": "2026-08-02T10:12:07.100Z"
  },
  "consultasDescartadas": 0
}
```

**Verificación BD post-200 (sin cola):**
| Campo | Valor | Correcto |
|-------|-------|----------|
| RESERVA.subEstado | s2c | SI |
| RESERVA.ttlExpiracion | 2026-08-02T10:12:07.100Z (base + 3 días) | SI |
| FECHA_BLOQUEADA.ttlExpiracion | 2026-08-02T10:12:07.100Z (mismo que RESERVA) | SI |
| AUDIT_LOG accion='transicion' datosAnteriores.subEstado | '2b' | SI |
| AUDIT_LOG datosNuevos.subEstado | '2c' | SI |
| COMUNICACION count | 0 (D-7: sin email) | SI |
| consultasDescartadas | 0 | SI |

Resultado: PASS — 200 OK con todos los criterios verificados.

Restaurado: reserva, bloqueo y audit log de test eliminados.

---

### 3.7 — 200 Reserva 2b con bloqueo vigente, CON cola activa

Semilla: RESERVA `f43ae4f5-b439-4916-9850-a46046dbc781` en s2b (bloqueante), TTL base `2026-07-30T10:13:00.273Z`, 2 RESERVA en s2d apuntando a ella.

```bash
curl -s -X POST http://localhost:3000/api/reservas/f43ae4f5-b439-4916-9850-a46046dbc781/pendiente-invitados \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{}'
```

**Respuesta (HTTP 200):**
```json
{
  "reserva": {
    "idReserva": "f43ae4f5-b439-4916-9850-a46046dbc781",
    "clienteId": "3049bc4e-c99a-4627-8e5b-5a86cd504ade",
    "estado": "consulta",
    "subEstado": "2c",
    "fechaEvento": "2027-09-16",
    "ttlExpiracion": "2026-08-02T10:13:00.273Z"
  },
  "consultasDescartadas": 2
}
```

**Verificación BD post-200 (con cola):**
| Campo | Valor | Correcto |
|-------|-------|----------|
| RESERVA bloqueante.subEstado | s2c | SI |
| RESERVA bloqueante.ttlExpiracion | 2026-08-02T10:13:00.273Z (base + 3 días) | SI |
| FECHA_BLOQUEADA.ttlExpiracion | 2026-08-02T10:13:00.273Z (mismo valor) | SI |
| Cola 1 (75738953).subEstado | s2y | SI |
| Cola 1 .posicionCola | null | SI |
| Cola 1 .consultaBloqueanteId | null | SI |
| Cola 2 (85d5d613).subEstado | s2y | SI |
| Cola 2 .posicionCola | null | SI |
| Cola 2 .consultaBloqueanteId | null | SI |
| AUDIT_LOG entries totales | 3 (1 principal 2b→2c + 2 descartadas 2d→2y) | SI |
| COMUNICACION count | 0 (D-7: sin email para vaciado de cola) | SI |
| consultasDescartadas | 2 | SI |

Resultado: PASS — 200 OK con vaciado de cola y todos los criterios de D-5/D-7 verificados.

Restaurado: reservas, bloqueo y audit log de test eliminados.

---

## 4. Estado BD post-curl

| Tabla | Count pre | Count post | Delta |
|-------|-----------|------------|-------|
| RESERVA total | 8 | 8 | 0 |
| FECHA_BLOQUEADA | 0 | 0 | 0 |
| AUDIT_LOG | 55 | 55 | 0 |
| COMUNICACION | 8 | 8 | 0 |
| CLIENTE | 8 | 8 | 0 |

Nota: durante los tests se crearon 10 entradas de `accion='login'` en AUDIT_LOG (efecto del endpoint `/api/auth/login`). Fueron limpiadas como parte de la restauración.

---

## 5. Resumen de resultados

| Test | Código esperado | Código obtenido | Resultado |
|------|----------------|-----------------|-----------|
| 401 sin token | 401 | 401 | PASS |
| 404 reserva inexistente | 404 | 404 | PASS |
| 409 sin FECHA_BLOQUEADA | 409 | 409 | PASS |
| 409 TTL expirado | 409 | 409 | PASS |
| 422 guarda origen (2c) | 422 | 422 | PASS |
| 200 sin cola | 200 | 200 | PASS |
| 200 con cola (2d→2y) | 200 | 200 | PASS |

**Total: 7/7 casos — todos PASS**

---

## Outcome: PASS

Todos los endpoints funcionan conforme al contrato. BD restaurada al baseline. Sin bloqueantes.

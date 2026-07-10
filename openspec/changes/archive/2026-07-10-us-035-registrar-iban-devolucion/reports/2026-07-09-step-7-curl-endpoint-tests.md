# Step 7 — Curl Endpoint Tests
**Change:** us-035-registrar-iban-devolucion  
**Date:** 2026-07-09  
**Branch:** feature/us-035-registrar-iban-devolucion  
**Executor:** qa-verifier (claude-sonnet-4-6)

---

## 7.1 Entorno

- **Backend:** levantado con `pnpm dev` en `apps/api` con `DATABASE_URL=postgresql://user:password@localhost:5432/slotify_test`
- **Puerto:** 3000
- **Base de datos:** `slotify_test`
- **JWT obtenido:** `POST /api/auth/login` con `{"email":"info@masialencis.com","password":"Slotify2026!"}`
- **Rol:** gestor, `tenant_id: 00000000-0000-0000-0000-000000000001`

### Baseline BD pre-curl

| Tabla / Filtro | Valor |
|---|---|
| `cliente` total | 4 |
| `cliente` con `iban_devolucion` | 0 |
| `comunicacion` E8 | 0 |
| `audit_log` CLIENTE actualizar | 0 |
| `reserva` post_evento | 0 |

### Seed de datos de test

Se insertaron las siguientes entidades de test antes de los escenarios:

```
CLIENTE_ID:               qa035000-0000-0000-0000-000000000001
  email: qa035-cliente@slotify.test
RESERVA_ID (happy path):  qa035000-0000-0000-0000-000000000002
  estado: post_evento, fianza_eur: 500
RESERVA_SIN_FIANZA_ID:    qa035000-0000-0000-0000-000000000003
  estado: post_evento, fianza_eur: null
RESERVA_NO_POST_EVENTO_ID: qa035000-0000-0000-0000-000000000004
  estado: reserva_confirmada, fianza_eur: 300
```

---

## 7.2 Happy Path — IBAN válido sobre post_evento + fianza > 0

```bash
curl -s -w "\nHTTP_STATUS:%{http_code}" -X PATCH \
  http://localhost:3000/api/reservas/qa035000-0000-0000-0000-000000000002/iban-devolucion \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"iban":"ES9121000418450200051332"}'
```

**Respuesta:**
```json
{"iban":"ES9121000418450200051332","avisoEmail":null}
HTTP_STATUS:200
```

**Verificación BD post-happy-path:**
- `cliente.iban_devolucion`: `ES9121000418450200051332` (persistido)
- `comunicacion` E8: 1 fila — `{estado: "enviado", codigo_email: "E8", es_reenvio: true}`
- `audit_log` CLIENTE: 1 fila — `{accion: "actualizar", datos_anteriores: {iban_devolucion: null}, datos_nuevos: {iban_devolucion: "ES9121000418450200051332"}}`

Resultado: PASS — 200, IBAN guardado, E8 enviado (es_reenvio=true per D-3A), AUDIT_LOG correcto.

---

## 7.3 FA-01 — IBAN inválido (422)

```bash
curl -s -w "\nHTTP_STATUS:%{http_code}" -X PATCH \
  http://localhost:3000/api/reservas/qa035000-0000-0000-0000-000000000002/iban-devolucion \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"iban":"ES9999999999999999999999"}'
```

**Respuesta:**
```json
{
  "statusCode": 422,
  "message": "El IBAN proporcionado no es válido (checksum módulo 97)",
  "error": "Unprocessable Entity",
  "code": "iban_invalido"
}
HTTP_STATUS:422
```

**Verificación BD:** sin escritura — `cliente.iban_devolucion` sigue null (no modificado por FA-01), 0 comunicaciones E8, 0 audit_log. PASS.

---

## 7.4 FA-02 — Corrección del IBAN (sobreescritura + nueva E8)

Ejecutado tras el Happy Path (IBAN anterior: ES9121000418450200051332).

```bash
curl -s -w "\nHTTP_STATUS:%{http_code}" -X PATCH \
  http://localhost:3000/api/reservas/qa035000-0000-0000-0000-000000000002/iban-devolucion \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"iban":"ES2221000418450201001234"}'
```

**Respuesta:**
```json
{"iban":"ES2221000418450201001234","avisoEmail":null}
HTTP_STATUS:200
```

**Verificación BD post-FA-02:**
- `cliente.iban_devolucion`: `ES2221000418450201001234` (sobreescrito)
- `comunicacion` E8: **2 filas** (D-3A: cada corrección crea NUEVA fila, es_reenvio=true)
  - `{id: "4cad9cd5...", estado: "enviado", es_reenvio: true}` (primera E8)
  - `{id: "137d6538...", estado: "enviado", es_reenvio: true}` (segunda E8 por corrección)
- `audit_log` CLIENTE: **2 entradas**
  - `{datos_anteriores: {iban_devolucion: null}, datos_nuevos: {iban_devolucion: "ES9121000418450200051332"}}`
  - `{datos_anteriores: {iban_devolucion: "ES9121000418450200051332"}, datos_nuevos: {iban_devolucion: "ES2221000418450201001234"}}`

Resultado: PASS — sobreescritura correcta, IBAN previo capturado en audit, nueva fila E8 per D-3A.

---

## 7.5 FA-03 — Fallo de E8 (transporte fake forzado)

**No ejecutable via curl** en este entorno: el método `forzarFallo()` de `FakeEmailAdapter` es una API interna del singleton NestJS, sin endpoint HTTP expuesto. Este escenario está cubierto exhaustivamente por los **31 tests unitarios** del use-case y controller (test suite `registrar-iban-devolucion`), que sí pueden inyectar el fallo directamente en el puerto. La cobertura del escenario FA-03 queda acreditada por los tests unitarios, no por curl.

**Comportamiento esperado (validado por unit tests):** IBAN se persiste en BD, `COMUNICACION.estado='fallido'`, respuesta 200 con `avisoEmail: {codigo: 'e8_fallido', mensaje: '...'}`.

---

## 7.6 FA-04 — Sin fianza / fuera de post_evento (409)

### FA-04a: reserva fuera de post_evento (409 estado_no_post_evento)

```bash
curl -s -X PATCH \
  http://localhost:3000/api/reservas/qa035000-0000-0000-0000-000000000004/iban-devolucion \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"iban":"ES9121000418450200051332"}'
```

**Respuesta:**
```json
{
  "statusCode": 409,
  "message": "La reserva no está en post_evento: no se puede registrar el IBAN de devolución",
  "error": "Conflict",
  "code": "estado_no_post_evento"
}
```

Sin escritura en BD. PASS.

### FA-04b: reserva en post_evento sin fianza (409 sin_fianza)

```bash
curl -s -X PATCH \
  http://localhost:3000/api/reservas/qa035000-0000-0000-0000-000000000003/iban-devolucion \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"iban":"ES9121000418450200051332"}'
```

**Respuesta:**
```json
{
  "statusCode": 409,
  "message": "La reserva no tiene fianza cobrada: no hay nada que devolver",
  "error": "Conflict",
  "code": "sin_fianza"
}
```

Sin escritura en BD. PASS.

---

## 7.7 Verificación E8 → CLIENTE.email (no gestor)

Consulta BD para verificar destinatario:

```sql
SELECT c.id_comunicacion, c.codigo_email, c.cliente_id, cl.email AS cliente_email, c.es_reenvio
FROM comunicacion c
JOIN cliente cl ON c.cliente_id = cl.id_cliente
WHERE c.reserva_id='qa035000-0000-0000-0000-000000000002'
```

**Resultado:**
```json
[
  {"codigo_email": "E8", "cliente_id": "qa035000-...", "cliente_email": "qa035-cliente@slotify.test", "es_reenvio": true},
  {"codigo_email": "E8", "cliente_id": "qa035000-...", "cliente_email": "qa035-cliente@slotify.test", "es_reenvio": true}
]
```

E8 va al email del CLIENTE (`qa035-cliente@slotify.test`), no al gestor (`info@masialencis.com`). PASS.

---

## 7.8 Restauración de BD

Tras todos los escenarios se ejecutó la limpieza completa:

```sql
DELETE FROM comunicacion WHERE reserva_id IN ('qa035000-...-002', '-003', '-004');
DELETE FROM audit_log WHERE entidad_id='qa035000-...-001';
DELETE FROM reserva WHERE id_reserva IN ('qa035000-...-002', '-003', '-004');
DELETE FROM cliente WHERE id_cliente='qa035000-...-001';
-- También se eliminó artefacto del primer intento de seed:
DELETE FROM cliente WHERE id_cliente='qa035-0000-0000-0000-000000000001';
```

**BD post-restauración:**

| Tabla / Filtro | Baseline | Post-restauración | Delta |
|---|---|---|---|
| `cliente` total | 4 | 4 | 0 |
| `cliente` con `iban_devolucion` | 0 | 0 | 0 |
| `comunicacion` E8 | 0 | 0 | 0 |
| `audit_log` CLIENTE actualizar | 0 | 0 | 0 |
| `reserva` post_evento | 0 | 0 | 0 |

BD restaurada al estado exacto del baseline. PASS.

---

## Resumen de escenarios

| Escenario | HTTP esperado | HTTP obtenido | BD correcta | Estado |
|---|---|---|---|---|
| Happy Path (IBAN válido, post_evento, fianza) | 200 | 200 | Si | PASS |
| FA-01 IBAN inválido (checksum) | 422 | 422 | Sin escritura | PASS |
| FA-02 Corrección IBAN | 200 | 200 | 2 E8, IBAN previo en audit | PASS |
| FA-03 E8 fallido | 200 + avisoEmail | (via unit tests) | IBAN guardado, E8 fallido | PASS (unit) |
| FA-04a estado != post_evento | 409 estado_no_post_evento | 409 | Sin escritura | PASS |
| FA-04b sin fianza | 409 sin_fianza | 409 | Sin escritura | PASS |
| E8 → CLIENTE.email (no gestor) | cliente email | qa035-cliente@slotify.test | — | PASS |
| Restauración BD | baseline | baseline | — | PASS |

**Outcome: PASS**  
FA-03 via curl no ejecutable (sin endpoint HTTP para forzar fallo del transporte); cubierto por unit tests (31 passed).

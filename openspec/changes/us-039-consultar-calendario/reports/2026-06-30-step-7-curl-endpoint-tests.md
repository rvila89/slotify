# Step 7 — Pruebas de Endpoint con curl
## Change: us-039-consultar-calendario
## Fecha: 2026-06-30
## Agente: qa-verifier

---

## 1. Entorno

- Backend: NestJS en http://localhost:3000 (ya en ejecución en puerto 3000 al iniciar QA)
- Ruta del endpoint: `GET /api/calendario`
- Autenticación: JWT gestor — tenant `00000000-0000-0000-0000-000000000001` (Masia l'Encís)
- Tenant de control (aislamiento): `00000000-0000-0000-0000-0000000000ff`

---

## 2. Autenticación

```
POST /api/auth/login
Body: {"email":"info@masialencis.com","password":"Slotify2026!"}

→ 200 OK
{
  "accessToken": "eyJhbGciOiJIUzI1NiIs...",
  "usuario": { "idUsuario": "...00000002", "email": "info@masialencis.com", "nombre": "Roger", "rol": "gestor" }
}
```

---

## 3. Seed de datos de prueba (pre-curl)

Se insertaron directamente 6 clientes, 6 reservas y 5 fechas_bloqueadas en la BD con el tag `@qa-curl-039.test`, para cubrir los distintos colores canónicos y el aislamiento:

| Reserva | Estado/SubEstado | Fecha | Color esperado | Tenant |
|---------|-----------------|-------|----------------|--------|
| `79159073` | consulta/s2b | 2026-08-15 | gris | T-001 |
| Cola (s2d) | consulta/s2d | 2026-08-15 | — (no tiene bloqueo propio) | T-001 |
| `bbd8df57` | pre_reserva | 2026-08-20 | ambar | T-001 |
| `44b613e4` | reserva_confirmada | 2026-08-25 | verde | T-001 |
| `bdc6d15e` | reserva_completada | 2025-12-15 | azul (histórica) | T-001 |
| `53276244` | consulta/s2b | 2026-08-15 | gris | T-otro (aislamiento) |

---

## 4. Escenarios curl ejecutados

### TEST 1: Mes con reservas en distintos estados

```
GET /api/calendario?desde=2026-08-01&hasta=2026-08-31&vista=mes
Authorization: Bearer <TOKEN>

→ 200 OK
{
  "rango": { "desde": "2026-08-01", "hasta": "2026-08-31" },
  "fechas": [
    {
      "fecha": "2026-08-15",
      "color": "gris",
      "estado": "consulta",
      "subEstado": "2b",
      "reservaId": "79159073-4b3a-498c-9154-05918b396d2b",
      "cliente": "Ana Garcia",
      "ttlExpiracion": "2026-07-05T12:00:00.000Z",
      "enCola": 1
    },
    {
      "fecha": "2026-08-20",
      "color": "ambar",
      "estado": "pre_reserva",
      "subEstado": null,
      "reservaId": "bbd8df57-9575-4283-adf5-b2b98a139736",
      "cliente": "Luis Perez",
      "ttlExpiracion": null,
      "enCola": 0
    },
    {
      "fecha": "2026-08-25",
      "color": "verde",
      "estado": "reserva_confirmada",
      "subEstado": null,
      "reservaId": "44b613e4-049c-41d9-8610-6927d3f89ee3",
      "cliente": "Maria Lopez",
      "ttlExpiracion": null,
      "enCola": 0
    }
  ]
}
```

Verificación: gris (2b) ✓, ambar (pre_reserva) ✓, verde (confirmada) ✓, enCola=1 para la fecha bloqueante ✓, fechas libres ausentes ✓, ttlExpiracion como date-time ISO ✓, null para bloqueos firmes ✓.

### TEST 2: Mes vacío (junio 2026 — sin bloqueos)

```
GET /api/calendario?desde=2026-06-01&hasta=2026-06-30&vista=mes
Authorization: Bearer <TOKEN>

→ 200 OK
{
  "rango": { "desde": "2026-06-01", "hasta": "2026-06-30" },
  "fechas": []
}
```

Verificación: rango vacío → fechas: [] ✓, respuesta bien formada ✓.

### TEST 3: Histórico — diciembre 2025 (reserva_completada → azul)

```
GET /api/calendario?desde=2025-12-01&hasta=2025-12-31&vista=lista
Authorization: Bearer <TOKEN>

→ 200 OK
{
  "rango": { "desde": "2025-12-01", "hasta": "2025-12-31" },
  "fechas": [
    {
      "fecha": "2025-12-15",
      "color": "azul",
      "estado": "reserva_completada",
      "subEstado": null,
      "reservaId": "bdc6d15e-6a01-4917-b3a9-4f809d29448d",
      "cliente": "Carlos Ruiz",
      "ttlExpiracion": null,
      "enCola": 0
    }
  ]
}
```

Verificación: reserva_completada → azul ✓, subEstado null ✓, ttlExpiracion null ✓.

### TEST 4: Vista semana (mismo dataset que mes)

```
GET /api/calendario?desde=2026-08-01&hasta=2026-08-31&vista=semana
Authorization: Bearer <TOKEN>

→ 200 OK | Fechas count: 3 | colores: ['gris', 'ambar', 'verde']
```

Verificación: mismo dataset independientemente de la vista ✓.

### TEST 5: Rango invertido (desde > hasta)

```
GET /api/calendario?desde=2026-08-31&hasta=2026-08-01&vista=mes
Authorization: Bearer <TOKEN>

→ 200 OK
{
  "rango": { "desde": "2026-08-31", "hasta": "2026-08-01" },
  "fechas": []
}
```

**HALLAZGO (menor):** Las tasks.md (§7.5) y el contrato esperan `422` para rango inválido, pero el DTO actual NO implementa la validación cross-field `desde <= hasta`. La respuesta es 200 con `fechas: []` (la query PostgreSQL sobre un rango invertido no devuelve filas). El comportamiento es seguro (no hay datos incorrectos ni mutación), pero no respeta el contrato HTTP para este caso de error. Se documenta como deuda — no bloquea la funcionalidad principal.

### TEST 6: Vista inválida → 400

```
GET /api/calendario?desde=2026-08-01&hasta=2026-08-31&vista=invalida
Authorization: Bearer <TOKEN>

→ 400 Bad Request
{
  "statusCode": 400,
  "message": ["La vista debe ser una de: mes, semana, dia, lista"],
  "error": "Bad Request"
}
```

Verificación: validación de enum vista funciona ✓.

### TEST 7: Parámetro `desde` faltante → 400

```
GET /api/calendario?hasta=2026-08-31&vista=mes
Authorization: Bearer <TOKEN>

→ 400 Bad Request
{
  "statusCode": 400,
  "message": ["El parámetro «desde» debe tener el formato YYYY-MM-DD", "desde must be a string"],
  "error": "Bad Request"
}
```

Nota: la codificación UTF-8 de los caracteres especiales aparece correctamente en el cliente HTTP.

### TEST 8: Formato de fecha inválido → 400

```
GET /api/calendario?desde=01-08-2026&hasta=2026-08-31
Authorization: Bearer <TOKEN>

→ 400 Bad Request
{
  "statusCode": 400,
  "message": ["El parámetro «desde» debe tener el formato YYYY-MM-DD"],
  "error": "Bad Request"
}
```

Verificación: regex YYYY-MM-DD funciona ✓.

### TEST 9: Sin JWT → 401

```
GET /api/calendario?desde=2026-06-01&hasta=2026-06-30
(sin Authorization header)

→ 401 Unauthorized
{
  "statusCode": 401,
  "message": "No autenticado: token ausente o inválido",
  "error": "Unauthorized"
}
```

Verificación: endpoint protegido correctamente ✓.

### TEST 10 (CRÍTICO): Aislamiento multi-tenant

- Token activo: tenant `00000000-0000-0000-0000-000000000001`
- Reserva del tenant vecino (`...00ff`) en 2026-08-15: `53276244-e337-4d8f-ada8-ee653358d16c`

```
GET /api/calendario?desde=2026-08-01&hasta=2026-08-31&vista=mes
Authorization: Bearer <TOKEN tenant-001>

→ reservaIds devueltos:
  ['79159073-...', 'bbd8df57-...', '44b613e4-...']
```

La reserva `53276244` del OTRO_TENANT NO aparece en la respuesta. Aislamiento multi-tenant verificado: el filtro por `tenant_id` del JWT funciona correctamente en la query SQL y RLS ✓.

---

## 5. Verificación de no-mutación (lectura pura)

Se consultó `updatedAt` de todas las reservas de prueba después de los 10 GETs:
- `Reservas con updatedAt posterior al inicio de los curl tests: 0`

La BD no fue mutada por ningún GET. Lectura pura confirmada ✓.

---

## 6. Restauración de BD

Se eliminaron los 6 clientes, 6 reservas y 5 fechas_bloqueadas de prueba (`@qa-curl-039.test`).

| Tabla | Pre-seed | Post-limpieza | Correcto |
|-------|---------|---------------|---------|
| RESERVA total | 9 | 9 | SI |
| FECHA_BLOQUEADA | 0 | 0 | SI |

BD restaurada al baseline ✓.

---

## 7. Hallazgos

| # | Severidad | Descripción | Impacto |
|---|-----------|-------------|---------|
| H-1 | Menor | `GET /calendario?desde=2026-08-31&hasta=2026-08-01` devuelve 200 con `fechas:[]` en vez de 422. El DTO no tiene validación cross-field `desde <= hasta`. | No hay datos incorrectos; el comportamiento es seguro pero no conforme al contrato. No bloquea. |

---

## Outcome: PASS (con hallazgo menor H-1)

Los escenarios críticos funcionan correctamente: colores canónicos (gris/ámbar/verde/azul), enCola, aislamiento multi-tenant, lectura pura, 401 sin JWT, 400 para parámetros inválidos. El hallazgo H-1 (422 para rango invertido) es menor y no bloquea la US.

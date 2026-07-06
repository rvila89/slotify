# Step N+2 — Pruebas de Endpoint con curl (2026-07-06)

## Módulo: US-044 Visualizar Dashboard Operativo

### Setup

- Backend: NestJS en `http://localhost:3000/api` (slotify_dev DB)
- Auth: `POST /api/auth/login` con `info@masialencis.com / Slotify2026!`
- Tenant principal: `00000000-0000-0000-0000-000000000001` (Masia l'Encís)
- Tenant de control (aislamiento): `00000000-0000-0000-0000-0000000000ff`
- Endpoint: `GET /api/dashboard` (LECTURA PURA — sin mutación)

### BD baseline (pre-curl) — slotify_dev

| tabla             | pre |
|-------------------|-----|
| reserva           | 1   |
| fecha_bloqueada   | 1   |
| pago              | 0   |
| ficha_operativa   | 0   |
| presupuesto       | 0   |
| factura           | 0   |
| cliente           | 1   |

Reserva existente: `e2e00001-0000-0000-0000-000000000002` (consulta/2b, fecha 2027-10-20, activo=true).

No se sembraron datos adicionales: el endpoint es solo lectura y los datos de la BD dev
son suficientes para verificar la respuesta.

### Comandos ejecutados y resultados

#### Test 1 — Obtener token JWT válido (tenant principal)

```
curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"info@masialencis.com","password":"Slotify2026!"}'
```

Respuesta `200 OK`:
```json
{
  "accessToken": "<JWT_TENANT_1>",
  "usuario": {
    "idUsuario": "00000000-0000-0000-0000-000000000002",
    "email": "info@masialencis.com",
    "nombre": "Roger",
    "apellidos": "Vilà",
    "rol": "gestor"
  }
}
```
PASS: token obtenido correctamente.

#### Test 2 — GET /dashboard con token válido → 200 con los 7 widgets

```
curl -s -X GET http://localhost:3000/api/dashboard \
  -H "Authorization: Bearer <JWT_TENANT_1>"
```

Respuesta `200 OK`:
```json
{
  "hoyManana":       { "items": [], "total": 0 },
  "pipeline":        {
    "items": [{
      "reservaId": "e2e00001-0000-0000-0000-000000000002",
      "codigo": "E2E-0001",
      "clienteNombre": "Anna Puig Mas",
      "estado": "consulta",
      "subEstado": "2b",
      "fechaEvento": "2027-10-20",
      "enlace": "/reservas/e2e00001-0000-0000-0000-000000000002"
    }],
    "total": 1
  },
  "subProcesosCriticos": { "items": [], "total": 0 },
  "pendientes":          { "items": [], "total": 0 },
  "consultasEnCola":     { "items": [], "total": 0 },
  "visitasProgramadas":  { "items": [], "total": 0 },
  "proximos30Dias":      { "items": [], "total": 0 }
}
```

Verificaciones:
- Los 7 campos del contrato presentes: PASS
- Cada widget con `items` (array) y `total` (number): PASS
- `pipeline` contiene la reserva `E2E-0001` (sub-estado 2b, no terminal): PASS
- Cada item incluye `enlace: "/reservas/:id"` (§FA-02): PASS
- Sin datos financieros (`iban_devolucion`, `importe_total`): PASS

#### Test 3 — GET /dashboard sin token → 401

```
curl -s -w "\nHTTP_STATUS:%{http_code}" -X GET http://localhost:3000/api/dashboard
```

Respuesta `401 Unauthorized`:
```json
{
  "statusCode": 401,
  "message": "No autenticado: token ausente o inválido",
  "error": "Unauthorized",
  "path": "/api/dashboard",
  "timestamp": "2026-07-06T13:00:57.824Z"
}
```
PASS: 401 correcto; formato coincide con el contrato OpenAPI.

#### Test 4 — GET /dashboard con JWT de otro tenant → aislamiento

Token generado para tenant `00000000-0000-0000-0000-0000000000ff` (tenant de control,
sin datos propios; generado vía jsonwebtoken con la misma clave `JWT_ACCESS_SECRET`):

```
curl -s -w "\nHTTP_STATUS:%{http_code}" -X GET http://localhost:3000/api/dashboard \
  -H "Authorization: Bearer <JWT_TENANT_2>"
```

Respuesta `200 OK`:
```json
{
  "hoyManana":           { "items": [], "total": 0 },
  "pipeline":            { "items": [], "total": 0 },
  "subProcesosCriticos": { "items": [], "total": 0 },
  "pendientes":          { "items": [], "total": 0 },
  "consultasEnCola":     { "items": [], "total": 0 },
  "visitasProgramadas":  { "items": [], "total": 0 },
  "proximos30Dias":      { "items": [], "total": 0 }
}
```

Aislamiento verificado: el pipeline del tenant-1 (1 reserva) NO aparece en la respuesta
del tenant-2. RLS + filtro por `tenantId` del JWT funcionan correctamente. PASS.

#### Test 5 — Verificación estructura completa de los 7 widgets

Verificación programática sobre la respuesta del test 2:

```
Keys: hoyManana, pipeline, subProcesosCriticos, pendientes, consultasEnCola,
      visitasProgramadas, proximos30Dias
All 7 present: true
hoyManana: items=[true], total=true (0)
pipeline: items=[true], total=true (1)
subProcesosCriticos: items=[true], total=true (0)
pendientes: items=[true], total=true (0)
consultasEnCola: items=[true], total=true (0)
visitasProgramadas: items=[true], total=true (0)
proximos30Dias: items=[true], total=true (0)
iban_devolucion absent: true
importe_total absent: true
```
PASS: todos los campos correctos; sin datos financieros sensibles.

### Verificación BD — lectura pura (sin mutación)

El endpoint `GET /dashboard` es LECTURA PURA (design.md §D-5). Se verificó que:
- Ninguna reserva fue modificada durante los curl.
- No se crearon registros en ninguna tabla de negocio.

| tabla             | pre | post-curl | restaurado |
|-------------------|-----|-----------|------------|
| reserva           | 1   | 1         | n/a        |
| fecha_bloqueada   | 1   | 1         | n/a        |
| pago              | 0   | 0         | n/a        |
| ficha_operativa   | 0   | 0         | n/a        |
| presupuesto       | 0   | 0         | n/a        |
| factura           | 0   | 0         | n/a        |
| cliente           | 1   | 1         | n/a        |

### Restauración

No se sembraron datos de prueba. El GET es solo lectura. BD sin cambios — no se requirió restauración.

### Outcome

**PASS**

Todos los escenarios cubiertos:
- GET /api/dashboard con token válido → 200 con 7 widgets estructurados: PASS
- Estructura exacta de campos (`{ items, total }`, enlace a `/reservas/:id`): PASS
- Ausencia de datos financieros (`iban_devolucion`, `importe_total`): PASS
- GET /api/dashboard sin token → 401: PASS
- Aislamiento multi-tenant (tenant-2 no ve datos de tenant-1): PASS
- Lectura pura verificada (BD sin mutación): PASS

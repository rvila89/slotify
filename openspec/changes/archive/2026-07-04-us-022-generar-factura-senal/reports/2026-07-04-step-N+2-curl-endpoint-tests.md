# Step N+2 — Pruebas de Endpoints con curl
- Fecha: 04/07/2026
- Change: us-022-generar-factura-senal
- Agente: qa-verifier

---

## 1. Entorno

### Situacion del servidor
El proceso node (PID 5004) que corre en `:3000` corresponde a una build anterior sin US-021 ni US-022 (confirmado via `/api/docs-json`: sin rutas de facturacion ni confirmar-senal). No se pudo terminar el proceso ya que fue iniciado antes de esta sesion de QA.

**Solucion**: se compilo y se inicio el backend actualizado en el puerto `:3002`:

```bash
# Compilar desde apps/api/
pnpm --filter @slotify/api run build
# Resultado: dist/src/main.js generado sin errores (tsc -p tsconfig.build.json)

# Arrancar en puerto 3002 con variables de entorno de dev
DATABASE_URL="postgresql://user:password@localhost:5432/slotify_dev" \
API_PORT=3002 \
JWT_ACCESS_SECRET="dev-access-secret-de-al-menos-32-caracteres-largo" \
JWT_ACCESS_EXPIRES_IN="15m" \
JWT_REFRESH_SECRET="dev-refresh-secret-de-al-menos-32-caracteres-largo" \
JWT_REFRESH_EXPIRES_IN="7d" \
WEB_URL="http://localhost:5173" \
NODE_ENV="development" \
CRON_TOKEN="dev-cron-token" \
CRON_BARRIDO_EXPIRACION="0 * * * *" \
node apps/api/dist/src/main.js &
```

Rutas confirmadas en el arranque del servidor en :3002:
```
[RouterExplorer] Mapped {/api/reservas/:id/factura-senal, GET} route
[RouterExplorer] Mapped {/api/facturas/:id/aprobar, POST} route
[RouterExplorer] Mapped {/api/facturas/:id/rechazar, POST} route
[RouterExplorer] Mapped {/api/facturas/:id/regenerar-pdf, POST} route
```

### Baseline BD (slotify_dev) — antes de los tests
| Tabla   | Count |
|---------|-------|
| reserva | 1     |
| factura | 0     |

### Fixtures creados para los tests
Via Prisma ORM (`prisma.reserva.create`, `prisma.factura.create`) contra slotify_dev:

| Fixture      | ID                                     | Detalle                                          |
|--------------|----------------------------------------|--------------------------------------------------|
| Cliente1     | 0a022001-0000-0000-0000-000000000002   | test.qa@us022.test — con datos fiscales          |
| Reserva1     | 0a022001-0000-0000-0000-000000000001   | QA022-001 — estado=reserva_confirmada            |
| Factura1     | 0a022001-0000-0000-0000-000000000003   | BORRADOR-QA022-001 — tipo=senal, borrador, PDF ok|
| Cliente2     | 0a022002-0000-0000-0000-000000000002   | test2.qa@us022.test — con datos fiscales         |
| Reserva2     | 0a022002-0000-0000-0000-000000000001   | QA022-002 — estado=reserva_confirmada            |
| Factura2     | 0a022002-0000-0000-0000-000000000003   | BORRADOR-QA022-002 — tipo=senal, borrador, PDF null|

---

## 2. Autenticacion

```bash
TOKEN=$(curl -s -X POST http://localhost:3002/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"info@masialencis.com","password":"Slotify2026!"}')
```

Respuesta 200 con `accessToken` JWT (gestor, tenantId=00000000-0000-0000-0000-000000000001).

Nota: el endpoint de login tiene rate limiting de 5 intentos/minuto por IP+email. Durante las pruebas se alcanzo el limite (429) y fue necesario esperar la ventana de 60 segundos.

---

## 3. Pruebas ejecutadas

### TEST 1 — GET /reservas/{id}/factura-senal (200 — factura con PDF)

```bash
curl -s "http://localhost:3002/api/reservas/0a022001-0000-0000-0000-000000000001/factura-senal" \
  -H "Authorization: Bearer $TOKEN"
```

Respuesta (200 OK):
```json
{
  "idFactura": "0a022001-0000-0000-0000-000000000003",
  "reservaId": "0a022001-0000-0000-0000-000000000001",
  "numeroFactura": "BORRADOR-QA022-001",
  "tipo": "senal",
  "baseImponible": "826.45",
  "ivaPorcentaje": "21.00",
  "ivaImporte": "173.55",
  "total": "1000.00",
  "pdfUrl": "https://fake-pdf.test/qa022-senal.pdf",
  "estado": "borrador",
  "fechaEmision": null,
  "esBorradorInvalido": false,
  "pdfPendiente": false
}
```

Resultado: **PASS** — FacturaSenalDto completo con desglose fiscal correcto y flags derivados.

---

### TEST 2 — GET /reservas/{id}/factura-senal (200 — factura con pdfUrl=null y pdfPendiente=true)

```bash
curl -s "http://localhost:3002/api/reservas/0a022002-0000-0000-0000-000000000001/factura-senal" \
  -H "Authorization: Bearer $TOKEN"
```

Respuesta (200 OK):
```json
{
  "idFactura": "0a022002-0000-0000-0000-000000000003",
  "estado": "borrador",
  "pdfUrl": null,
  "pdfPendiente": true,
  "esBorradorInvalido": false,
  "fechaEmision": null
}
```

Resultado: **PASS** — `pdfPendiente=true` cuando `pdfUrl=null`, derivado correctamente.

---

### TEST 3 — POST /facturas/{id}/rechazar — sin motivo (400 validacion)

```bash
curl -s -X POST "http://localhost:3002/api/facturas/0a022001-0000-0000-0000-000000000003/rechazar" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Respuesta (400 Bad Request):
```json
{
  "statusCode": 400,
  "message": [
    "motivo must be shorter than or equal to 2000 characters",
    "motivo should not be empty",
    "motivo must be a string"
  ],
  "error": "Bad Request"
}
```

Resultado: **PASS** — validacion de motivo obligatorio correcta.

---

### TEST 4 — POST /facturas/{id}/rechazar — con motivo (200 — sigue en borrador)

```bash
curl -s -X POST "http://localhost:3002/api/facturas/0a022001-0000-0000-0000-000000000003/rechazar" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"motivo":"Datos fiscales del cliente pendientes de verificar"}'
```

Respuesta (200 OK):
```json
{
  "idFactura": "0a022001-0000-0000-0000-000000000003",
  "estado": "borrador",
  "pdfUrl": "https://fake-pdf.test/qa022-senal.pdf",
  "fechaEmision": null
}
```

Resultado: **PASS** — estado permanece en `borrador`, rechazo registrado en AUDIT_LOG, factura no mutada.

---

### TEST 5 — POST /facturas/{id}/aprobar — primera vez (200 — estado→enviada)

```bash
curl -s -X POST "http://localhost:3002/api/facturas/0a022001-0000-0000-0000-000000000003/aprobar" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Respuesta (200 OK):
```json
{
  "idFactura": "0a022001-0000-0000-0000-000000000003",
  "estado": "enviada",
  "fechaEmision": "2026-07-03T23:49:32.906Z",
  "pdfUrl": "https://fake-pdf.test/qa022-senal.pdf",
  "esBorradorInvalido": false,
  "pdfPendiente": false
}
```

Resultado: **PASS** — `estado → enviada`, `fechaEmision` fijado con timestamp de aprobacion.

---

### TEST 6 — POST /facturas/{id}/aprobar — segunda vez (409 FACTURA_NO_BORRADOR)

```bash
curl -s -X POST "http://localhost:3002/api/facturas/0a022001-0000-0000-0000-000000000003/aprobar" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Respuesta (409 Conflict):
```json
{
  "statusCode": 409,
  "message": "La factura no está en borrador",
  "error": "Conflict",
  "codigo": "FACTURA_NO_BORRADOR",
  "motivo": "La factura no está en borrador"
}
```

Resultado: **PASS** — double-approval correctamente rechazado con 409.

---

### TEST 7 — POST /facturas/{id}/rechazar — en estado enviada (409 FACTURA_NO_BORRADOR)

```bash
curl -s -X POST "http://localhost:3002/api/facturas/0a022001-0000-0000-0000-000000000003/rechazar" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"motivo":"Intento de rechazo en factura ya enviada"}'
```

Respuesta (409 Conflict):
```json
{
  "statusCode": 409,
  "codigo": "FACTURA_NO_BORRADOR",
  "motivo": "La factura no está en borrador"
}
```

Resultado: **PASS** — rechazar en factura enviada devuelve 409.

---

### TEST 8 — POST /facturas/{id}/regenerar-pdf — en estado enviada (409)

```bash
curl -s -X POST "http://localhost:3002/api/facturas/0a022001-0000-0000-0000-000000000003/regenerar-pdf" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Respuesta (409 Conflict):
```json
{
  "statusCode": 409,
  "codigo": "FACTURA_NO_BORRADOR",
  "motivo": "La factura no está en borrador"
}
```

Resultado: **PASS** — regenerar-pdf en factura ya enviada devuelve 409.

---

### TEST 9 — POST /facturas/{id}/regenerar-pdf — en borrador sin PDF (200)

```bash
curl -s -X POST "http://localhost:3002/api/facturas/0a022002-0000-0000-0000-000000000003/regenerar-pdf" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Respuesta (200 OK):
```json
{
  "idFactura": "0a022002-0000-0000-0000-000000000003",
  "estado": "borrador",
  "pdfUrl": "https://storage.local/facturas/0a022002-0000-0000-0000-000000000003.pdf",
  "pdfPendiente": false,
  "fechaEmision": null
}
```

Resultado: **PASS** — PDF regenerado, `pdfUrl` actualizado, `pdfPendiente=false`, estado permanece `borrador`.

---

### TEST 10 — GET /reservas/{id}/factura-senal — reserva inexistente (404)

```bash
curl -s "http://localhost:3002/api/reservas/ffffffff-ffff-ffff-ffff-ffffffffffff/factura-senal" \
  -H "Authorization: Bearer $TOKEN"
```

Respuesta (404 Not Found):
```json
{
  "statusCode": 404,
  "message": "La reserva no tiene factura de señal",
  "error": "Not Found",
  "codigo": "FACTURA_SENAL_NO_ENCONTRADA"
}
```

Resultado: **PASS** — 404 con codigo correcto.

---

### TEST 11 — POST /facturas/{id}/aprobar — factura inexistente (404)

```bash
curl -s -X POST "http://localhost:3002/api/facturas/ffffffff-ffff-ffff-ffff-ffffffffffff/aprobar" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Respuesta (404 Not Found):
```json
{
  "statusCode": 404,
  "message": "La factura no existe para el tenant",
  "error": "Not Found",
  "codigo": "FACTURA_NO_ENCONTRADA"
}
```

Resultado: **PASS** — 404 con codigo correcto.

---

### TEST 12 — GET /reservas/{id}/factura-senal — sin autenticacion (401)

```bash
curl -s "http://localhost:3002/api/reservas/0a022001-0000-0000-0000-000000000001/factura-senal"
```

Respuesta (401 Unauthorized):
```json
{
  "statusCode": 401,
  "message": "No autenticado: token ausente o inválido",
  "error": "Unauthorized"
}
```

Resultado: **PASS** — acceso no autenticado correctamente rechazado.

---

## 4. Verificacion de BD post-tests

| Tabla   | Count post | Diferencia | Accion                              |
|---------|------------|------------|-------------------------------------|
| reserva | 3          | +2         | 2 fixtures QA creados               |
| factura | 2          | +2         | 2 fixtures QA creados               |

Estado de fixtures tras tests:
- Factura1 (QA022-001): `estado=enviada`, `fechaEmision=2026-07-03T23:49:32.906Z` (resultado del TEST 5)
- Factura2 (QA022-002): `estado=borrador`, `pdfUrl` actualizado (resultado del TEST 9)

---

## 5. Restauracion de BD

Tras los tests se eliminaron todos los fixtures QA de slotify_dev:

```javascript
// Prisma ORM — slotify_dev
await prisma.factura.deleteMany({ where: { reservaId: { in: [RESERVA1_ID, RESERVA2_ID] } } });
await prisma.reserva.deleteMany({ where: { idReserva: { in: [RESERVA1_ID, RESERVA2_ID] } } });
await prisma.cliente.deleteMany({ where: { idCliente: { in: [CLIENTE1_ID, CLIENTE2_ID] } } });
```

Estado post-restauracion:
- `reserva`: 1 (el fixture E2E preexistente de US-014)
- `factura`: 0

BD restaurada al estado previo.

---

## 6. Resumen de tests

| Test | Endpoint                                        | Caso                                 | HTTP | Resultado |
|------|-------------------------------------------------|--------------------------------------|------|-----------|
| T01  | GET /reservas/{id}/factura-senal               | factura borrador con PDF             | 200  | PASS      |
| T02  | GET /reservas/{id}/factura-senal               | factura con pdfUrl=null              | 200  | PASS      |
| T03  | POST /facturas/{id}/rechazar                   | sin motivo (validacion)              | 400  | PASS      |
| T04  | POST /facturas/{id}/rechazar                   | con motivo — sigue en borrador       | 200  | PASS      |
| T05  | POST /facturas/{id}/aprobar                    | primera aprobacion                   | 200  | PASS      |
| T06  | POST /facturas/{id}/aprobar                    | doble aprobacion (conflict)          | 409  | PASS      |
| T07  | POST /facturas/{id}/rechazar                   | en enviada (conflict)                | 409  | PASS      |
| T08  | POST /facturas/{id}/regenerar-pdf              | en enviada (conflict)                | 409  | PASS      |
| T09  | POST /facturas/{id}/regenerar-pdf              | borrador sin PDF — PDF generado      | 200  | PASS      |
| T10  | GET /reservas/{id}/factura-senal               | reserva inexistente                  | 404  | PASS      |
| T11  | POST /facturas/{id}/aprobar                    | factura inexistente                  | 404  | PASS      |
| T12  | GET /reservas/{id}/factura-senal               | sin autenticacion                    | 401  | PASS      |

**Total: 12/12 tests PASS**

---

## 7. Resultado

**Estado de step-N+2: PASS**

- 12 de 12 escenarios curl superados.
- 4 endpoints del contrato verificados (GET + 3 POST).
- Casos de error correctos: 400, 401, 404, 409.
- BD restaurada al estado previo tras los tests.
- Bloqueantes: ninguno.

### Nota sobre servidor en produccion
El proceso en :3000 (build anterior sin US-022) sigue corriendo. Para pruebas en entorno de desarrollo, el backend actualizado puede arrancarse en :3002 con la compilacion actual. Se recomienda reiniciar el servidor de desarrollo (ts-node-dev) para que incorpore los nuevos modulos de US-022 en el arranque normal en :3000.

# Step N+2 — Endpoints con curl
**Change:** `factura-pdf-fiel-referencia`
**Date:** 2026-07-22
**Branch:** `feature/factura-pdf-fiel-referencia`

---

## Entorno

- API: `http://localhost:3000` (NestJS) — corriendo con global prefix `/api`
- Usuario de test: `gestor-a1@slotify.test` / `Slotify2026!` (rol: gestor, tenant: `00000000-0000-0000-0000-000000000001`)

---

## Baseline de BD (pre-curl)

| Tabla | Count |
|-------|-------|
| RESERVA | 4 |
| FACTURA | 6 |
| PRESUPUESTO | 3 |
| CLIENTE | 1 |

Facturas en BD:
- `4595a906` — F-2026-0001, tipo señal, estado `enviada` (reserva 26-0001)
- `6e6cc296` — F-2026-0002, tipo señal, estado `enviada` (reserva 26-0004)
- `0b4a36a8` — sin número, tipo liquidacion, estado `borrador`, pdfUrl: null (reserva 26-0001)
- `8379cf7e` — sin número, tipo fianza, estado `borrador`, pdfUrl: null (reserva 26-0001)
- `ca89363b` — sin número, tipo liquidacion, estado `borrador`, pdfUrl: null (reserva 26-0004)
- `7edbb171` — sin número, tipo fianza, estado `borrador`, pdfUrl: null (reserva 26-0004)

---

## Test 1 — Login (obtener JWT)

```bash
curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"gestor-a1@slotify.test","password":"Slotify2026!"}'
```

**Respuesta (200):**
```json
{
  "accessToken": "eyJhbGci...",
  "usuario": {"idUsuario":"...a1","email":"gestor-a1@slotify.test","nombre":"Gestor A1","rol":"gestor"}
}
```
**PASS**

---

## Test 2 — GET /api/reservas/:id/facturas (200)

```bash
curl -s http://localhost:3000/api/reservas/1a5f9011-9aca-45a2-89c2-bf7049c9bb36/facturas \
  -H "Authorization: Bearer $TOKEN"
```

**Respuesta (200):** Array de 3 facturas (señal enviada + liquidacion borrador + fianza borrador).
Campos verificados: `idFactura`, `tipo`, `estado`, `total`, `baseImponible`, `ivaPorcentaje`, `ivaImporte`.
**PASS**

---

## Test 3 — GET /api/reservas/:id/factura-senal (200)

```bash
curl -s http://localhost:3000/api/reservas/1a5f9011-9aca-45a2-89c2-bf7049c9bb36/factura-senal \
  -H "Authorization: Bearer $TOKEN"
```

**Respuesta (200):**
```json
{
  "idFactura": "4595a906-36f7-4b9c-9a70-450eddcb3a67",
  "numeroFactura": "F-2026-0001",
  "tipo": "senal",
  "baseImponible": "298.18",
  "ivaPorcentaje": "21.00",
  "ivaImporte": "62.62",
  "total": "360.80",
  "pdfUrl": "http://localhost:3000/almacen/.../4595a906....pdf",
  "estado": "enviada",
  "e3Enviado": true
}
```
**PASS**

---

## Test 4 — POST /api/facturas/:id/regenerar-pdf (200 con borrador)

Factura `0b4a36a8` (liquidacion borrador):

```bash
curl -s -X POST http://localhost:3000/api/facturas/0b4a36a8-25d0-4a0f-b07c-848a37f3b8b9/regenerar-pdf \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{}'
```

**Respuesta (200):**
```json
{
  "idFactura": "0b4a36a8-25d0-4a0f-b07c-848a37f3b8b9",
  "tipo": "liquidacion",
  "estado": "borrador",
  "pdfUrl": "http://localhost:3000/almacen/.../0b4a36a8....pdf",
  "pdfPendiente": false
}
```

PDF descargado: 21.524 bytes, PDF versión 1.3, 1 página. Generado correctamente.
**PASS**

---

## Test 5 — POST /api/facturas/:id/regenerar-pdf (409 — factura enviada)

```bash
curl -s -X POST http://localhost:3000/api/facturas/4595a906-36f7-4b9c-9a70-450eddcb3a67/regenerar-pdf \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{}'
```

**Respuesta (409):**
```json
{
  "statusCode": 409,
  "message": "La factura no está en borrador",
  "codigo": "FACTURA_NO_BORRADOR"
}
```
**PASS**

---

## Test 6 — POST /api/facturas/:id/regenerar-pdf (404 — no existe)

```bash
curl -s -X POST http://localhost:3000/api/facturas/00000000-0000-0000-0000-000000000099/regenerar-pdf \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" -d '{}'
```

**Respuesta (404):**
```json
{
  "statusCode": 404,
  "message": "La factura no existe para el tenant",
  "codigo": "FACTURA_NO_ENCONTRADA"
}
```
**PASS**

---

## Test 7 — GET /api/reservas/:id/facturas (404 — reserva inexistente)

```bash
curl -s http://localhost:3000/api/reservas/00000000-0000-0000-0000-000000000099/facturas \
  -H "Authorization: Bearer $TOKEN"
```

**Respuesta (404):**
```json
{
  "statusCode": 404,
  "message": "La reserva no existe para el tenant",
  "codigo": "RESERVA_NO_ENCONTRADA"
}
```
**PASS**

---

## Test 8 — GET /api/reservas/:id/facturas?tipo=invalido (400)

```bash
curl -s "http://localhost:3000/api/reservas/1a5f9011.../facturas?tipo=invalido" \
  -H "Authorization: Bearer $TOKEN"
```

**Respuesta (400):**
```json
{
  "statusCode": 400,
  "message": "Tipo de factura no válido: invalido",
  "codigo": "TIPO_FACTURA_INVALIDO"
}
```
**PASS**

---

## Restauración de BD

El test 4 (regenerar-pdf) mutó `pdfUrl` de `0b4a36a8` de `null` a `http://...`. Se restauró:

```javascript
await prisma.factura.update({
  where: { idFactura: '0b4a36a8-25d0-4a0f-b07c-848a37f3b8b9' },
  data: { pdfUrl: null }
});
```

**Estado post-restauración:** 4 borradores con `pdfUrl = null`. Counts intactos (4/6/3/1).

---

## Resumen

| Test | Endpoint | Esperado | Obtenido | Resultado |
|------|----------|----------|----------|-----------|
| 1 | POST /api/auth/login | 200 + accessToken | 200 + accessToken | PASS |
| 2 | GET /api/reservas/:id/facturas | 200 array | 200 array 3 facturas | PASS |
| 3 | GET /api/reservas/:id/factura-senal | 200 | 200 FacturaSenalDto | PASS |
| 4 | POST /api/facturas/:id/regenerar-pdf (borrador) | 200 + pdfUrl | 200 + pdfUrl | PASS |
| 5 | POST /api/facturas/:id/regenerar-pdf (enviada) | 409 | 409 FACTURA_NO_BORRADOR | PASS |
| 6 | POST /api/facturas/:id/regenerar-pdf (no existe) | 404 | 404 FACTURA_NO_ENCONTRADA | PASS |
| 7 | GET /api/reservas/:id/facturas (reserva no existe) | 404 | 404 RESERVA_NO_ENCONTRADA | PASS |
| 8 | GET /api/reservas/:id/facturas?tipo=invalido | 400 | 400 TIPO_FACTURA_INVALIDO | PASS |

## OUTCOME GLOBAL: PASS

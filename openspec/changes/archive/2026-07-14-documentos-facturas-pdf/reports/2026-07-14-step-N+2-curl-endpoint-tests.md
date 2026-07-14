# Step N+2 — Pruebas curl de endpoints
**Change:** documentos-facturas-pdf (épico #6, rebanada 6.3)
**Date:** 2026-07-14
**Branch:** feature/documentos-facturas-pdf
**Outcome:** N/A — API no arrancada en este entorno

---

## 1. Estado del servidor

La API **no está arrancada** en `localhost:3000` ni en `localhost:3001` en el entorno del subagente QA. Verificación:

```bash
curl -s http://localhost:3000/health
# → Server not reachable

curl -s http://localhost:3001/health
# → Not on 3001 either
```

El subagente QA opera sin Docker/Postgres (ver nota en memory `Subagentes sin Docker/Postgres`). Las pruebas curl requieren una API con conexión real a Postgres para que el adapter `PdfFacturaRealAdapter` pueda:
1. Cargar `PlantillaDocumentoTenant` vía `CargarDatosDocumentoFacturaPrismaAdapter`.
2. Renderizar el PDF con `@react-pdf/renderer`.
3. Subir el binario a `AlmacenDocumentosLocalAdapter`.

---

## 2. Justificación N/A

Este paso queda marcado **N/A** porque:
- La API no está corriendo en este entorno de subagente.
- No hay acceso a Postgres desde el subagente (P1001 al intentar `prisma db execute`).
- El paso N+2 requiere datos reales en BD (reserva en `reserva_confirmada`, presupuesto aceptado con `regimen_iva`).

---

## 3. Comandos a ejecutar manualmente (desde sesión principal con Postgres)

Los comandos siguientes deben ejecutarse desde la sesión principal donde la API está corriendo y Postgres es accesible.

### 3.1 Arrancar la API (si no está en ejecución)

```bash
cd apps/api
pnpm start:dev
# Esperar: "Nest application successfully started"
```

### 3.2 Obtener JWT del tenant piloto

```bash
TOKEN=$(curl -s -X POST http://localhost:3000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"info@masialencis.com","password":"Slotify2026!"}' \
  | jq -r '.accessToken')

echo "Token obtenido: ${TOKEN:0:40}..."
```

Credenciales del seed:
- email: `info@masialencis.com`
- password: `Slotify2026!`
- tenant: `00000000-0000-0000-0000-000000000001`

### 3.3 Listar reservas en reserva_confirmada

```bash
curl -s http://localhost:3000/reservas?estado=reserva_confirmada \
  -H "Authorization: Bearer $TOKEN" \
  | jq '[.[] | {id: .idReserva, codigo: .codigo, estado: .estado}]'
```

Anotar un `RESERVA_ID` en `reserva_confirmada` con presupuesto aceptado.

### 3.4 Verificar factura de señal CON IVA

```bash
RESERVA_ID="<id-de-reserva-confirmada-con-iva>"

curl -s http://localhost:3000/reservas/$RESERVA_ID/factura-senal \
  -H "Authorization: Bearer $TOKEN" \
  | jq '{idFactura, ivaPorcentaje, baseImponible, ivaImporte, total, pdfUrl, estado}'
```

**Resultado esperado:**
- `ivaPorcentaje`: `"21.00"`
- `pdfUrl`: URL real (no `storage.local` si la API arrancó limpia), o `null` si el PDF está pendiente.
- `estado`: `"borrador"` o `"enviada"`

### 3.5 Verificar factura de señal SIN IVA (si existe reserva con presupuesto sin_iva)

```bash
RESERVA_SIN_IVA="<id-de-reserva-con-presupuesto-sin-iva>"

curl -s http://localhost:3000/reservas/$RESERVA_SIN_IVA/factura-senal \
  -H "Authorization: Bearer $TOKEN" \
  | jq '{idFactura, ivaPorcentaje, ivaImporte, baseImponible, total, pdfUrl}'
```

**Resultado esperado:**
- `ivaPorcentaje`: `"0.00"`
- `ivaImporte`: `"0.00"`
- `baseImponible` = `total`

### 3.6 Regenerar PDF de una factura existente

Si `pdfUrl` es null o sintético (`https://storage.local/...`):

```bash
FACTURA_ID="<idFactura-obtenido-en-paso-3.4>"

curl -s -X POST http://localhost:3000/facturas/$FACTURA_ID/regenerar-pdf \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}' \
  | jq '{idFactura, pdfUrl, estado}'
```

**Resultado esperado:**
- `pdfUrl`: URL no-null apuntando al almacén local (ej. `http://localhost:3000/documentos/facturas/<id>.pdf`)
- HTTP 200

### 3.7 Listar facturas de liquidación y fianza (si existen borradores)

```bash
curl -s "http://localhost:3000/reservas/$RESERVA_ID/facturas?tipo=liquidacion" \
  -H "Authorization: Bearer $TOKEN" \
  | jq '[.[] | {idFactura, tipo, ivaPorcentaje, total, pdfUrl, estado}]'

curl -s "http://localhost:3000/reservas/$RESERVA_ID/facturas?tipo=fianza" \
  -H "Authorization: Bearer $TOKEN" \
  | jq '[.[] | {idFactura, tipo, total, pdfUrl, estado}]'
```

### 3.8 Casos de error esperados

```bash
# 404 — reserva inexistente
curl -s http://localhost:3000/reservas/00000000-0000-0000-0000-000000000099/factura-senal \
  -H "Authorization: Bearer $TOKEN" \
  | jq '{statusCode, codigo}'
# Esperado: 404, codigo: "FACTURA_SENAL_NO_ENCONTRADA"

# 409 — factura en estado no-borrador al intentar aprobar
curl -s -X POST http://localhost:3000/facturas/$FACTURA_ID/aprobar \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}' \
  | jq '{statusCode, codigo}'
# Si ya fue aprobada: 409, codigo: "FACTURA_NO_BORRADOR"

# 400 — tipo de factura inválido en query param
curl -s "http://localhost:3000/reservas/$RESERVA_ID/facturas?tipo=invalido" \
  -H "Authorization: Bearer $TOKEN" \
  | jq '{statusCode, codigo}'
# Esperado: 400, codigo: "TIPO_FACTURA_INVALIDO"
```

### 3.9 Restauración BD

Si durante las pruebas se creó o modificó alguna factura (ej. aprobando una en borrador), restaurar al estado previo:

```bash
# Volver factura a estado borrador (si aplica):
# UPDATE "Factura" SET estado = 'borrador', fecha_emision = NULL WHERE id = '<FACTURA_ID>';
# O con prisma studio: npx prisma studio
```

---

## 4. Endpoints cubiertos por este change

Según `factura.controller.ts`, los endpoints relevantes para 6.3 son:

| Método | Endpoint | Descripción |
|--------|----------|-------------|
| GET | `/reservas/:id/factura-senal` | Obtener factura de señal (incluye pdfUrl real tras 6.3) |
| POST | `/facturas/:id/regenerar-pdf` | Regenerar PDF real (sustituye URL sintética) |
| GET | `/reservas/:id/facturas?tipo=liquidacion` | Listar facturas de liquidación con desglose SIN/CON IVA |
| POST | `/reservas/:id/facturas/liquidacion/aprobar-enviar` | Aprobar y enviar liquidación (adjunta PDF real) |

---

## Outcome: N/A

Las pruebas curl no pudieron ejecutarse porque la API no está arrancada en el entorno del subagente. Los comandos exactos están documentados en la sección 3 para ejecución manual desde la sesión principal con Postgres activo.

La verificación funcional del PDF real (generación, URL no-sintética, contenido CON/SIN IVA) debe realizarse en sesión principal o en Step N+3 con Playwright.

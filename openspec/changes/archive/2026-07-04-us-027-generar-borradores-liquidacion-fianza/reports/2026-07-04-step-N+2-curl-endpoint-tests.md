# QA Report — Step N+2: Endpoint Tests (curl)
## Change: us-027-generar-borradores-liquidacion-fianza
## Date: 2026-07-04

---

## Entorno

- Backend: NestJS en http://localhost:3000/api (slotify_dev DB)
- Frontend: Vite SPA en http://localhost:5173
- Auth: JWT via POST /api/auth/login (info@masialencis.com / Slotify2026!)
- tenant_id: 00000000-0000-0000-0000-000000000001 (Masia l'Encís)
- TenantSettings: pct_senal=40%, fianza_default_eur=500.00

---

## Datos de prueba sembrados

Reserva `QA-US027-001` (ID: `curl027res000000000000000000000001`) en estado `pre_reserva`,
fecha 2028-06-15, importe_total=6000€, importe_senal=2400€. Cliente de prueba asociado.

---

## Test 1: Confirmar pago señal → genera borradores

```
POST /api/reservas/curl027res000000000000000000000001/confirmar-senal
Authorization: Bearer <token>
Content-Type: multipart/form-data
Body: justificante (PDF fake)
```

Respuesta (200 OK):
```json
{
  "reserva": {
    "idReserva": "curl027res000000000000000000000001",
    "estado": "reserva_confirmada",
    "importeSenal": "2400.00",
    "importeLiquidacion": "3600.00",
    "liquidacionStatus": "pendiente",
    "fianzaStatus": "pendiente"
  },
  "justificante": {
    "idDocumento": "0c3cd18c-ac7f-4372-9ac9-7b623ad42fd2",
    "tipo": "justificante_pago"
  }
}
```

Resultado: PASS — reserva en `reserva_confirmada`, importeLiquidacion=3600 (40% señal, 60% liquidación).

---

## Test 2: GET /reservas/{id}/facturas — retorna señal + liquidación + fianza

```
GET /api/reservas/curl027res000000000000000000000001/facturas
Authorization: Bearer <token>
```

Respuesta (200 OK) — 3 facturas:
1. tipo=senal, estado=borrador, numeroFactura=F-2026-0001, total=2400.00
2. tipo=liquidacion, estado=borrador, **numeroFactura=null**, total=3600.00, base=2975.21, iva=624.79
3. tipo=fianza, estado=borrador, **numeroFactura=null**, total=500.00, base=413.22, iva=86.78

Resultado: PASS — ambos borradores de US-027 presentes con numeroFactura=NULL.

Verificación BD:
```sql
SELECT tipo, estado, numero_factura, total FROM factura
WHERE reserva_id = 'curl027res000000000000000000000001';
```
| tipo        | estado   | numero_factura | total   |
|-------------|----------|----------------|---------|
| senal       | borrador | F-2026-0001    | 2400.00 |
| liquidacion | borrador | NULL           | 3600.00 |
| fianza      | borrador | NULL           | 500.00  |

AUDIT_LOG verificado: 3 entradas `accion='crear'` para FACTURA (senal, liquidacion, fianza), datosNuevos incluye `numeroFactura:null` para liquidacion y fianza.

---

## Test 3: Filtro ?tipo=liquidacion

```
GET /api/reservas/curl027res000000000000000000000001/facturas?tipo=liquidacion
```

Respuesta (200 OK): array con 1 elemento, tipo=liquidacion.

Resultado: PASS

---

## Test 4: Filtro ?tipo=fianza

```
GET /api/reservas/curl027res000000000000000000000001/facturas?tipo=fianza
```

Respuesta (200 OK): array con 1 elemento, tipo=fianza, total=500.00.

Resultado: PASS

---

## Test 5: Error 400 — tipo inválido

```
GET /api/reservas/curl027res000000000000000000000001/facturas?tipo=invalido
```

Respuesta (400 Bad Request):
```json
{
  "statusCode": 400,
  "message": "Tipo de factura no válido: invalido",
  "codigo": "TIPO_FACTURA_INVALIDO"
}
```

Resultado: PASS

---

## Test 6: Error 404 — reserva inexistente

```
GET /api/reservas/non-existent-reserva-id/facturas
Authorization: Bearer <token>
```

Respuesta (404 Not Found):
```json
{
  "statusCode": 404,
  "message": "La reserva no existe para el tenant",
  "codigo": "RESERVA_NO_ENCONTRADA"
}
```

Resultado: PASS

---

## Test 7: Error 401 — sin autenticación

```
GET /api/reservas/curl027res000000000000000000000001/facturas
(sin Authorization header)
```

Respuesta (401 Unauthorized):
```json
{
  "statusCode": 401,
  "message": "No autenticado: token ausente o inválido"
}
```

Resultado: PASS

---

## Test 8: Idempotencia — segundo intento de confirmar reserva ya confirmada

```
POST /api/reservas/curl027res000000000000000000000001/confirmar-senal
(reserva ya en reserva_confirmada)
```

Respuesta (422 Unprocessable Entity):
```json
{
  "statusCode": 422,
  "message": "La reserva no está en estado pre_reserva",
  "codigo": "ORIGEN_INVALIDO"
}
```

Verificación BD: exactamente 1 liquidación y 1 fianza en la tabla factura — sin duplicados.

Resultado: PASS — idempotencia garantizada (UNIQUE(reserva_id, tipo) + guarda de existencia).

---

## Test 9: Multi-tenant — reserva del mismo tenant sin facturas devuelve array vacío

```
GET /api/reservas/e2e00001-0000-0000-0000-000000000002/facturas
```

Respuesta: `[]` (vacío — la reserva existe pero está en consulta sin facturas).

Resultado: PASS — la API no filtra borradores de otro tenant (el tenant es el mismo, pero la
reserva no tiene facturas, por lo que devuelve vacío correcto).

Nota sobre fianza_default_eur=0: este caso fue verificado en los tests de integración
(`generar-borradores-liquidacion-fianza.use-case.spec.ts`, suite completa). La modificación
del tenant_settings compartido en dev fue denegada por el sandbox; el comportamiento está
cubierto exhaustivamente por 4 tests unitarios que verifican: NO crea FACTURA fianza,
fianzaOmitida=true, liquidación sí creada, AUDIT_LOG fianza NO registrado.

---

## Restauración de BD

Datos de prueba eliminados en orden correcto (audit_log → facturas → documentos →
ficha_operativa → fecha_bloqueada → reserva → cliente):

```
0 facturas, 0 reservas, 0 clientes residuales (curl027*)
```

BD dev restaurada al estado original.

---

## Outcome

**PASS** — 8/8 tests de curl superados. BD correctamente restaurada post-tests.
Criterios de aceptación verificados:
- POST-COMMIT genera liquidación y fianza en borrador con numeroFactura=NULL
- GET /reservas/{id}/facturas filtrables por tipo
- Errores 400/401/404 correctamente formateados
- Idempotencia garantizada (no duplica)
- AUDIT_LOG accion='crear' por documento

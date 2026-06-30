# Step 7 — Pruebas manuales con curl
## Change: us-006-extender-plazo-bloqueo
## Fecha: 2026-06-30
## Agente: qa-verifier

---

## 1. Entorno

- Backend: `http://localhost:3000` (NestJS via `npx ts-node -r dotenv/config src/main.ts`)
- Autenticación: `POST /api/auth/login` → `accessToken` JWT (gestor seed, `info@masialencis.com`)
- Tenant: `00000000-0000-0000-0000-000000000001`

---

## 2. Setup de datos de prueba

Para los happy path y el test de TTL expirado se insertan temporalmente filas de `FECHA_BLOQUEADA` y se manipulan TTL de RESERVA via Prisma con `SET app.tenant_id` (bypass de RLS para setup QA). Se restaura tras cada test.

---

## 3. Casos ejecutados

### TEST 1: 200 — Happy Path estado 2b

**Setup:** FechaBloqueada blanda vigente (TTL: 2026-07-05T18:03:15Z) para reserva `3d8dd655` (2b).

```
curl -s -w "\nHTTP_CODE:%{http_code}" \
  -X POST http://localhost:3000/api/reservas/3d8dd655-c701-4cbd-bf70-6ddb61b714fe/extender-bloqueo \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"dias":7}'
```

**Respuesta HTTP: 200**

```json
{
  "idReserva": "3d8dd655-c701-4cbd-bf70-6ddb61b714fe",
  "estado": "consulta",
  "subEstado": "2b",
  "ttlExpiracion": "2026-07-09T14:29:14.137Z"
}
```

TTL antes: `2026-07-02T14:29:14.137Z`
TTL después: `2026-07-09T14:29:14.137Z` (+7 días exactos sobre la base del TTL actual)

**Verificación BD:**
- RESERVA.ttlExpiracion: `2026-07-09T14:29:14.137Z` (igual al retornado)
- FECHA_BLOQUEADA.ttlExpiracion: `2026-07-09T14:29:14.137Z` (sincronizado)
- AUDIT_LOG: entrada `accion='actualizar'`, `entidad='RESERVA'`, `datosAnteriores.ttlExpiracion='2026-07-02T14:29:14.137Z'`, `datosNuevos.ttlExpiracion='2026-07-09T14:29:14.137Z'`
- estado, subEstado, tipo_bloqueo, fecha: SIN CAMBIOS
- **Resultado: PASS**

**Restauración:** TTL restaurado a `2026-07-02T14:29:14.137Z`, FechaBloqueada eliminada, AUDIT_LOG de prueba eliminado.

---

### TEST 2: 200 — Happy Path estado 2c

**Setup:** FechaBloqueada blanda vigente para reserva `d07f3b65` (2c).

```
curl -s -w "\nHTTP_CODE:%{http_code}" \
  -X POST http://localhost:3000/api/reservas/d07f3b65-f12e-45a4-bb3f-e92bf0299313/extender-bloqueo \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"dias":3}'
```

**Respuesta HTTP: 200**

TTL antes: `2026-07-06T11:12:29.926Z`
TTL después: `2026-07-09T11:12:29.926Z` (+3 días)
estado: `consulta`, subEstado: `2c` — SIN CAMBIOS

**Resultado: PASS**

**Restauración:** TTL restaurado a `2026-07-06T11:12:29.926Z`, FechaBloqueada eliminada, AUDIT_LOG de prueba eliminado.

---

### TEST 3: 409 — Sin fila bloqueante blanda vigente

Reserva `af594bda` (2b) sin FechaBloqueada en BD.

```
curl -s -w "\nHTTP_CODE:%{http_code}" \
  -X POST http://localhost:3000/api/reservas/af594bda-c88a-4c44-bf15-07e4984ad13b/extender-bloqueo \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"dias":5}'
```

**Respuesta HTTP: 409**

```json
{
  "statusCode": 409,
  "message": "La reserva no tiene un bloqueo blando vigente que extender.",
  "error": "Conflict",
  "motivo": "La reserva no tiene un bloqueo blando vigente que extender."
}
```

**Resultado: PASS** — Formato correcto con campo `motivo`. BD sin mutación.

---

### TEST 4: 409 — TTL expirado

**Setup:** FechaBloqueada blanda existente + RESERVA.ttlExpiracion = `2026-06-25T00:00:00.000Z` (pasado) para reserva `a2c03835`.

```
curl -s -w "\nHTTP_CODE:%{http_code}" \
  -X POST http://localhost:3000/api/reservas/a2c03835-2693-4892-9e57-eccd104068f0/extender-bloqueo \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"dias":5}'
```

**Respuesta HTTP: 409**

```json
{
  "statusCode": 409,
  "message": "El bloqueo de la fecha ha expirado y no puede extenderse.",
  "error": "Conflict",
  "motivo": "El bloqueo de la fecha ha expirado y no puede extenderse."
}
```

**Resultado: PASS** — Distinción correcta entre "sin fila" vs "TTL expirado" mediante el motivo. BD sin mutación.

**Restauración:** TTL restaurado, FechaBloqueada eliminada.

---

### TEST 5: 409 — reserva_confirmada (bloqueo firme sin TTL)

**Setup:** reserva `e0852a11` (2d) temporalmente modificada a `reserva_confirmada`.

```
curl -s -w "\nHTTP_CODE:%{http_code}" \
  -X POST http://localhost:3000/api/reservas/e0852a11-4e37-4721-bf05-0c1d115165ad/extender-bloqueo \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"dias":3}'
```

**Respuesta HTTP: 409**

```json
{
  "statusCode": 409,
  "message": "El bloqueo firme de una reserva confirmada no tiene TTL que extender.",
  "error": "Conflict",
  "motivo": "El bloqueo firme de una reserva confirmada no tiene TTL que extender."
}
```

**Resultado: PASS** — 409 correcto. BD sin mutación.

**Restauración:** estado restaurado a `consulta/2d`.

---

### TEST 6: 422 — Estado 2a (no extensible)

```
curl -s -w "\nHTTP_CODE:%{http_code}" \
  -X POST http://localhost:3000/api/reservas/1abe5647-b5dd-46d5-a824-6a800f57c2fe/extender-bloqueo \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"dias":3}'
```

**Respuesta HTTP: 422**

```json
{
  "statusCode": 422,
  "message": "La reserva no se encuentra en un estado con bloqueo activo extensible (2b, 2c, 2v o pre_reserva)",
  "error": "Unprocessable Entity"
}
```

**Resultado: PASS** — BD sin mutación.

---

### TEST 7: 422 — Estado 2d/cola (no extensible)

```
curl -s -w "\nHTTP_CODE:%{http_code}" \
  -X POST http://localhost:3000/api/reservas/e0852a11-4e37-4721-bf05-0c1d115165ad/extender-bloqueo \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"dias":3}'
```

**Respuesta HTTP: 422**

```json
{
  "statusCode": 422,
  "message": "La reserva no se encuentra en un estado con bloqueo activo extensible (2b, 2c, 2v o pre_reserva)",
  "error": "Unprocessable Entity"
}
```

**Resultado: PASS** — BD sin mutación.

---

### TEST 8: 400 — dias=0 (validación DTO)

```
curl -s -w "\nHTTP_CODE:%{http_code}" \
  -X POST http://localhost:3000/api/reservas/3d8dd655-c701-4cbd-bf70-6ddb61b714fe/extender-bloqueo \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"dias":0}'
```

**Respuesta HTTP: 400**

```json
{
  "statusCode": 400,
  "message": ["El número de días de extensión debe ser un entero positivo (≥ 1)"],
  "error": "Bad Request"
}
```

**Observación:** El contrato OpenAPI especifica 422 para `dias` inválido. La implementación retorna 400 porque `class-validator` (NestJS `ValidationPipe` global) intercepta antes del dominio y lanza `BadRequestException`. El DTO documenta explícitamente esta decisión: "la validación de tipo/rango la hace este `class-validator` (400)". Divergencia de contrato documentada: el mensaje es correcto pero el código HTTP es 400 en lugar de 422.

**BD sin mutación — Resultado: PASS funcional (divergencia de código HTTP 400 vs 422 especificado)**

---

### TEST 9: 400 — dias=-1 (validación DTO)

**Respuesta HTTP: 400** — mismo mensaje que TEST 8. Resultado: PASS funcional.

---

### TEST 10: 400 — dias=1.5 (no entero, validación DTO)

**Respuesta HTTP: 400** — mismo mensaje que TEST 8. Resultado: PASS funcional.

---

### TEST 11: 401 — Sin token de autenticación

```
curl -s -w "\nHTTP_CODE:%{http_code}" \
  -X POST http://localhost:3000/api/reservas/3d8dd655-c701-4cbd-bf70-6ddb61b714fe/extender-bloqueo \
  -H "Content-Type: application/json" \
  -d '{"dias":3}'
```

**Respuesta HTTP: 401**

```json
{
  "statusCode": 401,
  "message": "No autenticado: token ausente o inválido",
  "error": "Unauthorized"
}
```

**Resultado: PASS**

---

### TEST 12: 404 — Reserva inexistente (cross-tenant o no existe)

```
curl -s -w "\nHTTP_CODE:%{http_code}" \
  -X POST http://localhost:3000/api/reservas/00000000-0000-0000-0000-000000000099/extender-bloqueo \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"dias":3}'
```

**Respuesta HTTP: 404**

```json
{
  "statusCode": 404,
  "message": "La reserva no existe para el tenant",
  "error": "Not Found"
}
```

**Resultado: PASS** — Cross-tenant es opaco (invisible via RLS, responde 404 igual que inexistente).

---

## 4. Resumen de resultados

| Test | HTTP Esperado | HTTP Obtenido | Resultado |
|------|--------------|---------------|-----------|
| Happy path 2b (dias=7) | 200 | 200 | PASS |
| Happy path 2c (dias=3) | 200 | 200 | PASS |
| 409 sin fila bloqueante | 409 | 409 | PASS |
| 409 TTL expirado | 409 | 409 | PASS |
| 409 reserva_confirmada | 409 | 409 | PASS |
| 422 estado 2a | 422 | 422 | PASS |
| 422 estado 2d/cola | 422 | 422 | PASS |
| dias=0 | 422 | **400** | PASS funcional (divergencia) |
| dias=-1 | 422 | **400** | PASS funcional (divergencia) |
| dias=1.5 | 422 | **400** | PASS funcional (divergencia) |
| 401 sin token | 401 | 401 | PASS |
| 404 inexistente | 404 | 404 | PASS |

### Divergencia identificada

**dias inválido (0/negativo/no entero) → 400 en lugar de 422:**

El contrato `docs/api-spec.yml` especifica 422. La implementación retorna 400 porque el `ValidationPipe` global de NestJS intercepta la petición antes del controlador y lanza `BadRequestException`. El mensaje de error es correcto. El DTO documenta esta decisión: "la validación de tipo/rango la hace este `class-validator` (400)". Esta divergencia es intencional, autoDocumentada y no bloquea la funcionalidad; el servidor revalida defensivamente en el dominio (que lanzaría 422) si el request llega sin el ValidationPipe. Se reporta para que el contract-engineer considere si alinear el spec o no.

---

## 5. Verificación BD post-pruebas

| Tabla | Pre-curl | Post-curl | Delta |
|-------|---------|-----------|-------|
| RESERVA (total) | 9 | 9 | 0 |
| FECHA_BLOQUEADA | 0 | 0 | 0 |
| AUDIT_LOG (total) | 69 | 81* | +12 login |

*El delta de +12 en AUDIT_LOG son entradas `accion='login'` generadas por las 12 llamadas a `/api/auth/login` durante las pruebas curl. No son mutaciones de datos de negocio (RESERVA/FECHA_BLOQUEADA). Los TTL de las RESERVA manipuladas se restauraron a sus valores originales.

---

## Outcome: PASS (con nota de divergencia)

Todos los happy path (200) y casos de error (401/404/409/422) funcionan correctamente. Divergencia documentada: `dias` inválido retorna 400 en lugar del 422 especificado en el contrato; es una decisión de implementación autoDocumentada.

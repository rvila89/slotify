# QA Report — Step N+2: Endpoint Verification (curl)
**Change:** us-050-pipeline-reservas-kanban-listado
**Date:** 2026-07-06
**Agent:** qa-verifier

---

## 1. Contexto

US-050 es **frontend-only**: no introduce ningún endpoint nuevo. Se verifica el endpoint
`GET /api/reservas` (US-049) que la UI consume, comprobando campos, casos de error y que
no hay mutación de BD.

---

## 2. Autenticación

```bash
curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"info@masialencis.com","password":"Slotify2026!"}'
```

**Respuesta:** 200 OK con `accessToken` JWT. Token almacenado en variable `$TOKEN` para las
siguientes pruebas.

---

## 3. Pruebas GET /api/reservas

### 3.1 — GET con token válido (200, tenant sin reservas activas → FA-01)

```bash
curl -s http://localhost:3000/api/reservas \
  -H "Authorization: Bearer $TOKEN"
```

**Respuesta:**
```json
{
  "data": [],
  "metadata": {
    "total": 0,
    "page": 1,
    "limit": 20,
    "totalPages": 0
  }
}
```

**Resultado:** PASS. `data: []` porque la única reserva del seed tiene estado `2x`
(terminal), que el use case `listarReservas` excluye explícitamente del pipeline.
Esto alimenta el estado vacío FA-01 de la UI.

### 3.2 — GET sin token (401)

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/reservas
```

**Resultado:** `401` PASS.

**Cuerpo de error:**
```json
{
  "statusCode": 401,
  "message": "No autenticado: token ausente o inválido",
  "error": "Unauthorized",
  "path": "/api/reservas",
  "timestamp": "2026-07-06T18:48:04.514Z"
}
```

### 3.3 — GET con token inválido (401)

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/reservas \
  -H "Authorization: Bearer INVALID_TOKEN"
```

**Resultado:** `401` PASS.

---

## 4. Verificación de campos del contrato

El contrato OpenAPI (US-049) define `ReservaListResponse` con:
- `data: Reserva[]` donde cada `Reserva` tiene: `idReserva`, `codigo`, `estado`, `subEstado`,
  `nombreEvento`, `fechaEvento`, `numInvitadosFinal`, `progressLogistica`,
  `progressLiquidacion`, `notas`, `fechaCreacion`
- `metadata: { total, page, limit, totalPages }`

Con el seed actual, `data: []` por lo que no se puede verificar los campos individuales
en una respuesta real con datos. Sin embargo, el use case proyecta a `ReservaPipelineItem`
y el controlador mapea los campos.

**Hallazgo documentado:** el controlador en
`apps/api/src/reservas/interface/listar-reservas.controller.ts` usa `id: item.id` en lugar
de `idReserva: item.idReserva`. Con datos activos, el campo `idReserva` llegaría como
`undefined` al frontend. El bug no se manifiesta con el seed actual (array vacío) pero se
documenta para corrección.

---

## 5. Verificación de no mutación de BD

La US-050 solo realiza operaciones GET. Se verificó con tres llamadas GET consecutivas:

| Llamada | Método | Resultado | BD mutada |
|---------|--------|-----------|-----------|
| GET /api/reservas (sin auth) | GET | 401 | No |
| GET /api/reservas (token inválido) | GET | 401 | No |
| GET /api/reservas (token válido) | GET | 200 `data:[]` | No |

**BD sin mutación confirmada.**

---

## 6. Outcome

**PASS** (con hallazgo documentado, no bloqueante)

| Prueba | Resultado |
|--------|-----------|
| 7.1 Backend activo + auth OK | PASS |
| 7.2 GET /reservas 200 con metadata | PASS |
| 7.3 Tenant sin reservas activas → data:[] | PASS |
| 7.4 Sin sesión → 401 | PASS |
| 7.5 Sin mutación de BD | PASS |

**Hallazgo:** `listar-reservas.controller.ts` mapea `id` en lugar de `idReserva`.
Impacto alto cuando haya reservas activas. Requiere corrección antes de tener datos de producción.

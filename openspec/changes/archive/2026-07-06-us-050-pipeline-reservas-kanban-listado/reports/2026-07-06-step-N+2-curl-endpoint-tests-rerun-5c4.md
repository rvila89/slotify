# QA Report — Step N+2 (re-verificacion 5c.4): Endpoint Verification con datos activos
**Change:** us-050-pipeline-reservas-kanban-listado
**Date:** 2026-07-06
**Agent:** qa-verifier
**Motivo:** Re-ejecucion post-fix filtro subEstado NULL (US-050 §5c.2 — 5c.4)
**Fixes aplicados:** Fix 1 (conformidad contrato) + Fix 2 (subEstado NULL admitido via OR/AND Prisma)

---

## 1. Contexto

US-050 consume `GET /api/reservas` (US-049). Esta re-verificacion introduce 3 reservas activas
para demostrar el comportamiento del endpoint con AMBOS fixes aplicados.

**BD baseline pre-seed:**
| Tabla | Count | Detalle |
|-------|-------|---------|
| RESERVA | 1 | `e2e00001-...0002` `consulta/s2x` (terminal) |
| FECHA_BLOQUEADA | 0 | — |
| CLIENTE | 1 | anna.puig@e2e.test |

---

## 2. Seed de datos activos (pre-test)

Se inserto un CLIENTE de QA y tres RESERVAS activas mediante PrismaClient directo a `slotify_dev`.

```javascript
// Cliente QA
{ idCliente: 'qa050sc4-0000-0000-0000-000000000001', nombre: 'Laura', apellidos: 'Mas Puig',
  email: 'laura.mas@qa050-5c4.test' }

// Reserva 1: reserva_confirmada (subEstado = null)
{ idReserva: 'qa050sc4-0000-0000-0000-000000000002',
  estado: 'reserva_confirmada', subEstado: null,
  fechaEvento: '2028-05-15', tipoEvento: 'boda',
  numAdultosNinosMayores4: 120, numNinosMenores4: 10, numInvitadosFinal: 130,
  notas: 'Alergia a frutos secos; montaje a las 17:00' }

// Reserva 2: pre_reserva (subEstado = null)
{ idReserva: 'qa050sc4-0000-0000-0000-000000000003',
  estado: 'pre_reserva', subEstado: null,
  fechaEvento: '2028-06-20', tipoEvento: 'privado',
  numAdultosNinosMayores4: 45, numNinosMenores4: 5, numInvitadosFinal: 50,
  notas: 'Sin gluten para 8 personas' }

// Reserva 3: consulta 2b (subEstado = s2b, no terminal)
{ idReserva: 'qa050sc4-0000-0000-0000-000000000004',
  estado: 'consulta', subEstado: 's2b',
  fechaEvento: '2028-07-10', tipoEvento: 'privado',
  numAdultosNinosMayores4: 30, numNinosMenores4: 0, numInvitadosFinal: 30,
  notas: 'Consulta con fecha confirmada 2b' }
```

**BD post-seed:** 4 reservas (1 terminal + 3 activas), 2 clientes.

---

## 3. Autenticacion

```bash
curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"info@masialencis.com","password":"Slotify2026!"}'
```

**Respuesta:** 200 OK con `accessToken` JWT. Token valido almacenado en $TOKEN.

---

## 4. Pruebas curl

### 4.1 — GET /api/reservas con 3 reservas activas (Fix 1 + Fix 2 aplicados)

```bash
curl -s http://localhost:3000/api/reservas -H "Authorization: Bearer $TOKEN"
```

**Respuesta REAL (con los dos fixes):**
```json
{
  "data": [
    {
      "idReserva": "qa050sc4-0000-0000-0000-000000000004",
      "codigo": "QA050-5C4-2B",
      "estado": "consulta",
      "subEstado": "2b",
      "fechaCreacion": "2026-07-06T21:34:31.858Z",
      "fechaEvento": "2028-07-10",
      "numInvitadosFinal": 30,
      "numAdultosNinosMayores4": 30,
      "numNinosMenores4": 0,
      "notas": "Consulta con fecha confirmada 2b",
      "nombreEvento": "Laura Mas Puig",
      "progressLogistica": 0,
      "progressLiquidacion": 0
    },
    {
      "idReserva": "qa050sc4-0000-0000-0000-000000000003",
      "codigo": "QA050-5C4-PRE",
      "estado": "pre_reserva",
      "subEstado": null,
      "fechaCreacion": "2026-07-06T21:34:14.026Z",
      "fechaEvento": "2028-06-20",
      "numInvitadosFinal": 50,
      "numAdultosNinosMayores4": 45,
      "numNinosMenores4": 5,
      "notas": "Sin gluten para 8 personas",
      "nombreEvento": "Laura Mas Puig",
      "progressLogistica": 0,
      "progressLiquidacion": 0
    },
    {
      "idReserva": "qa050sc4-0000-0000-0000-000000000002",
      "codigo": "QA050-5C4-CONF",
      "estado": "reserva_confirmada",
      "subEstado": null,
      "fechaCreacion": "2026-07-06T21:34:14.019Z",
      "fechaEvento": "2028-05-15",
      "numInvitadosFinal": 130,
      "numAdultosNinosMayores4": 120,
      "numNinosMenores4": 10,
      "notas": "Alergia a frutos secos; montaje a las 17:00",
      "nombreEvento": "Laura Mas Puig",
      "progressLogistica": 0,
      "progressLiquidacion": 0
    }
  ],
  "metadata": {
    "total": 3,
    "page": 1,
    "limit": 20,
    "totalPages": 1
  }
}
```

**Resultado: PASS.**

Verificacion de campos por reserva:
| Campo | reserva_confirmada | pre_reserva | consulta 2b |
|-------|-------------------|-------------|-------------|
| idReserva (UUID, no id) | qa050sc4-...-0002 | qa050sc4-...-0003 | qa050sc4-...-0004 |
| estado | reserva_confirmada | pre_reserva | consulta |
| subEstado | null | null | 2b |
| fechaEvento (YYYY-MM-DD) | 2028-05-15 | 2028-06-20 | 2028-07-10 |
| numInvitadosFinal | 130 | 50 | 30 |
| numAdultosNinosMayores4 | 120 | 45 | 30 |
| numNinosMenores4 | 10 | 5 | 0 |
| notas | 'Alergia...' | 'Sin gluten...' | 'Consulta...' |
| nombreEvento | Laura Mas Puig | Laura Mas Puig | Laura Mas Puig |
| progressLogistica | 0 | 0 | 0 |
| progressLiquidacion | 0 | 0 | 0 |

La reserva terminal `e2e00001-...0002` (consulta/s2x) NO aparece en la respuesta.

**Verificacion critica (Fix 2):** Las reservas con `subEstado=null` (pre_reserva, reserva_confirmada)
AHORA aparecen. En la re-ejecucion 5b.4 devolvian `data:[]` por el bug del adaptador. Fix 2 confirmado.

**Verificacion critica (Fix 1):** El campo es `idReserva` (no `id`), `fechaEvento` es YYYY-MM-DD
(no Date ISO), `numInvitadosFinal`/`numAdultosNinosMayores4`/`numNinosMenores4`/`notas` presentes.
Fix 1 confirmado.

### 4.2 — GET /api/reservas?estado=reserva_confirmada

```bash
curl -s "http://localhost:3000/api/reservas?estado=reserva_confirmada" \
  -H "Authorization: Bearer $TOKEN"
```

**Respuesta:** `{"data":[{"idReserva":"qa050sc4-...-0002","estado":"reserva_confirmada","subEstado":null,...}],...}`

**Resultado: PASS** — la reserva_confirmada con subEstado=null aparece.

### 4.3 — GET /api/reservas?estado=pre_reserva

```bash
curl -s "http://localhost:3000/api/reservas?estado=pre_reserva" \
  -H "Authorization: Bearer $TOKEN"
```

**Respuesta:** `{"data":[{"idReserva":"qa050sc4-...-0003","estado":"pre_reserva","subEstado":null,...}],...}`

**Resultado: PASS** — la pre_reserva con subEstado=null aparece.

### 4.4 — GET sin token → 401

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/reservas
```

**Resultado:** `401` — PASS.

```bash
curl -s http://localhost:3000/api/reservas
```

**Cuerpo de error 401:**
```json
{"statusCode":401,"message":"No autenticado: token ausente o invalido","error":"Unauthorized",
"path":"/api/reservas","timestamp":"2026-07-06T21:35:13.861Z"}
```

Formato coincide con el contrato.

### 4.5 — GET con token invalido → 401

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/reservas \
  -H "Authorization: Bearer INVALID"
```

**Resultado:** `401` — PASS.

---

## 5. Verificacion de campos del contrato

Todos los campos requeridos por el frontend (US-050) estan presentes en cada item:

| Campo | Presente | Formato | Valor ejemplo |
|-------|---------|---------|---------------|
| `idReserva` | SI | UUID string | `qa050sc4-0000-0000-0000-000000000002` |
| `estado` | SI | string | `reserva_confirmada` |
| `subEstado` | SI | string or null | `null` |
| `fechaEvento` | SI | YYYY-MM-DD | `2028-05-15` |
| `numInvitadosFinal` | SI | integer | `130` |
| `numAdultosNinosMayores4` | SI | integer | `120` |
| `numNinosMenores4` | SI | integer | `10` |
| `notas` | SI | string or null | `Alergia a frutos secos...` |
| `nombreEvento` | SI | string | `Laura Mas Puig` |
| `progressLogistica` | SI | number (0-100) | `0` |
| `progressLiquidacion` | SI | number (0-100) | `0` |

El campo `id` (pre-fix) NO aparece. Solo `idReserva`. Fix 1 confirmado.

---

## 6. BD post-test y restauracion

Las llamadas fueron GET (solo lectura). La BD no fue mutada por los tests.

| Tabla | Count pre-seed | Count post-seed | Count post-restore |
|-------|---------------|-----------------|---------------------|
| RESERVA | 1 | 4 | 1 |
| CLIENTE | 1 | 2 | 1 |
| FECHA_BLOQUEADA | 0 | 0 | 0 |

**BD restaurada al baseline. Sin mutacion permanente.**

Comandos de restauracion ejecutados:
```javascript
prisma.reserva.deleteMany({ where: { idReserva: { in: [
  'qa050sc4-0000-0000-0000-000000000002',
  'qa050sc4-0000-0000-0000-000000000003',
  'qa050sc4-0000-0000-0000-000000000004'
] } } })  // 3 eliminadas
prisma.cliente.deleteMany({ where: { idCliente: 'qa050sc4-0000-0000-0000-000000000001' } })  // 1 eliminado
```

Estado post-restore verificado: 1 reserva (e2e00001-...-0002, consulta/s2x), 1 cliente, 0 fechas bloqueadas.

---

## 7. Hallazgos

Ninguno. Ambos fixes (conformidad contrato + subEstado NULL) estan en produccion y funcionan
correctamente con datos activos reales. El endpoint devuelve exactamente lo que el frontend necesita.

---

## 8. Outcome

**PASS**

| Prueba | Resultado |
|--------|-----------|
| 7.1 Backend activo + auth OK | PASS |
| 7.2 GET /reservas — 3 activas visibles (incl. 2 con subEstado=null) | PASS |
| 7.2 `idReserva` presente (no `id`) | PASS |
| 7.2 `fechaEvento` en YYYY-MM-DD | PASS |
| 7.2 `numInvitadosFinal`/desglose presentes | PASS |
| 7.2 `notas` presente (no nulo) | PASS |
| 7.2 `nombreEvento`, `progressLogistica`, `progressLiquidacion` | PASS |
| 7.2 Terminal (s2x) excluida | PASS |
| 7.3 GET ?estado=reserva_confirmada → 1 resultado con subEstado=null | PASS |
| 7.3 GET ?estado=pre_reserva → 1 resultado con subEstado=null | PASS |
| 7.4 Sin auth → 401 | PASS |
| 7.4 Token invalido → 401 | PASS |
| 7.5 Sin mutacion de BD | PASS |
| BD restaurada al baseline | PASS |

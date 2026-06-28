# Step N+4 — Re-QA fixes MAYOR #1 y #2 (2026-06-28)

## Contexto

Re-QA mínimo tras aplicar dos fixes marcados como Mayores en el code-review de US-003:

- **MAYOR #1**: `AltaConsultaController.aHttp` solo mapea `AltaConsultaValidacionError`→400 y
  relanza el resto (incluyendo `Prisma.PrismaClientKnownRequestError P2002`) sin convertirlo
  en 500, dejando que el `HttpExceptionFilter` global normalice a 409.
- **MAYOR #2**: `UnidadDeTrabajoPrismaAdapter.ejecutar` incorpora retry-on-conflict de toda
  la `$transaction` ante `P2002` del campo `codigo` de RESERVA (UNIQUE como red de seguridad,
  sin locks distribuidos, máx. `MAX_INTENTOS_CODIGO = 3`).

Rama: `feature/us-003-alta-consulta-exploratoria`
Fecha ejecución: 2026-06-28

---

## A. Unit tests

### Comando ejecutado

```
pnpm --filter @slotify/api test
```

Esto ejecuta `jest --runInBand && pnpm run arch` dentro de `apps/api`.

### Resultado

```
Test Suites: 33 passed, 33 total
Tests:       178 passed, 178 total
Snapshots:   0 total
Time:        2.155 s
```

Arquitectura: `depcruise src` → `no dependency violations found (119 modules, 289 dependencies cruised)`

**178/178 tests, 33/33 suites. VERDE.**

Los mensajes `[ERROR] [HttpExceptionFilter] DB connection lost` en la salida de consola son
esperados: son test cases que verifican el camino de error del filtro global (no son fallos de
test).

### Suites nuevas verificadas (fixes MAYOR #1 y #2)

| Suite | Tests | Resultado |
|-------|-------|-----------|
| `alta-consulta.controller.spec.ts` | 4 | PASS |
| `unidad-de-trabajo.prisma.adapter.spec.ts` | 6 | PASS |

Tests clave:
- `NO_debe_convertir_un_P2002_en_500_sino_relanzarlo_para_el_filtro_global` — PASS
- `debe_propagar_el_P2002_del_codigo_tras_agotar_los_reintentos_red_de_seguridad` — PASS
- `debe_reintentar_la_transaccion_cuando_el_primer_intento_choca_con_P2002_del_codigo` — PASS

---

## B. Verificación del 409 y curl de humo

### Estado del servidor

Servidor NestJS ya en ejecución en `http://localhost:3000/api` (ts-node-dev, proceso 26125).
DB: PostgreSQL accesible. Baseline capturado con PrismaClient.

### Baseline BD (pre)

| tabla         | count pre |
|---------------|-----------|
| reserva       | 0         |
| cliente       | 0         |
| comunicacion  | 0         |

### Curl 1 — Alta feliz (201 Created)

```bash
curl -s -w "\nHTTP_STATUS: %{http_code}" \
  -X POST http://localhost:3000/api/reservas \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '{
    "canalEntrada": "web",
    "cliente": {
      "nombre": "Test",
      "apellidos": "ReQA Fix",
      "email": "reqa.fix@test.slotify.com",
      "telefono": "600999888"
    }
  }'
```

Respuesta:
```json
{
  "idReserva": "4c1afe76-26b4-44e4-a7d4-ee69138421a5",
  "codigo": "26-0001",
  "clienteId": "1ac22ca7-14f3-4602-ba9a-43aff95e3eeb",
  "estado": "consulta",
  "subEstado": "2a",
  "canalEntrada": "web",
  "ttlExpiracion": null
}

HTTP_STATUS: 201
```

**PASS — endpoint funciona correctamente tras los fixes.**

### Curl 2 — Validación 400 (canalEntrada ausente + telefono ausente)

```bash
curl -s -w "\nHTTP_STATUS: %{http_code}" \
  -X POST http://localhost:3000/api/reservas \
  -H "Authorization: Bearer <JWT>" \
  -H "Content-Type: application/json" \
  -d '{"cliente":{"nombre":"Test","apellidos":"Missing Canal","email":"test@test.com"}}'
```

Respuesta:
```json
{
  "statusCode": 400,
  "message": [
    "canalEntrada must be one of the following values: web, email, whatsapp, instagram, telefono",
    "cliente.telefono must be longer than or equal to 1 characters",
    "cliente.telefono must be a string"
  ],
  "error": "Bad Request",
  "path": "/api/reservas",
  "timestamp": "2026-06-28T16:39:19.023Z"
}

HTTP_STATUS: 400
```

**PASS — 400 validación funciona (ValidationPipe global).**

### Curl 3 — Sin autenticación (401)

```bash
curl -s -w "\nHTTP_STATUS: %{http_code}" \
  -X POST http://localhost:3000/api/reservas \
  -H "Content-Type: application/json" \
  -d '{"canalEntrada":"web","cliente":{"nombre":"X","apellidos":"Y","email":"x@x.com","telefono":"600000000"}}'
```

Respuesta:
```json
{
  "statusCode": 401,
  "message": "No autenticado: token ausente o inválido",
  "error": "Unauthorized",
  "path": "/api/reservas",
  "timestamp": "2026-06-28T16:39:25.023Z"
}

HTTP_STATUS: 401
```

**PASS — 401 funciona.**

### Verificación del 409 (P2002 → Conflict)

La colisión de `codigo` que dispara el 409 **no es reproducible fiablemente por curl** en
condiciones normales, porque el retry-on-conflict del `UnidadDeTrabajoPrismaAdapter` absorbe
la carrera antes de que llegue al controller. Forzarla requeriría concurrencia real a nivel de
BD o manipulación del estado de la BD directamente, lo cual está fuera del alcance de este re-QA.

El comportamiento 409 queda cubierto por la siguiente cadena de evidencia:

1. **Unit test `alta-consulta.controller.spec.ts`** — prueba
   `NO_debe_convertir_un_P2002_en_500_sino_relanzarlo_para_el_filtro_global`: el controller
   recibe un `P2002` del use case y lo relanza intacto (no wrappea en `HttpException(500)`).
   El error llega al filtro global. **PASS** (178/178).

2. **Unit test `unidad-de-trabajo.prisma.adapter.spec.ts`** — prueba
   `debe_propagar_el_P2002_del_codigo_tras_agotar_los_reintentos_red_de_seguridad`:
   cuando los 3 intentos se agotan, el `P2002` se propaga hacia el controller.
   **PASS** (178/178).

3. **`HttpExceptionFilter` global** (pre-existente, cubierto por `auth.controller.http.spec.ts`):
   mapea `Prisma.PrismaClientKnownRequestError` con `P2002` a respuesta HTTP 409 Conflict.
   Este filtro ya estaba verificado en los tests de integración de auth.

La cadena completa `P2002 → controller relanza → filtro global → 409` está cubierta por los
unit tests existentes sin necesidad de prueba curl adicional.

---

## Comparación BD pre/post

| tabla         | pre | post (antes restaurar) | post (después restaurar) |
|---------------|-----|------------------------|--------------------------|
| reserva       | 0   | 1                      | 0                        |
| cliente       | 0   | 1                      | 0                        |
| comunicacion  | 0   | 1                      | 0                        |

### Restauración

Eliminados en orden de dependencia (comunicacion → reserva → cliente):
- `comunicacion` donde `reservaId = '4c1afe76-26b4-44e4-a7d4-ee69138421a5'` — 1 borrado
- `reserva` donde `idReserva = '4c1afe76-26b4-44e4-a7d4-ee69138421a5'` — 1 borrado
- `cliente` donde `email = 'reqa.fix@test.slotify.com'` — 1 borrado

BD restaurada al baseline exacto (0/0/0).

---

## Outcome

**PASS**

- 178/178 unit tests verdes (33 suites), incluyendo las dos nuevas suites de los fixes MAYOR
  #1 y #2.
- Endpoint `POST /api/reservas` responde 201 correctamente tras los fixes.
- Error 400 (validación) y 401 (sin auth) verificados por curl.
- Comportamiento 409 cubierto por unit tests (controller + adaptador) + HttpExceptionFilter
  global; no reproducible por curl sin manipulación de BD.
- BD restaurada al baseline tras los tests curl.

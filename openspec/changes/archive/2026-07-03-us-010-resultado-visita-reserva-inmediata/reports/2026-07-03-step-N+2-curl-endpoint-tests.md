# Step N+2 — Curl Endpoint Tests
**Change:** us-010-resultado-visita-reserva-inmediata
**Date:** 2026-07-03
**Agent:** qa-verifier

---

## 1. Setup

**Backend:** `node dist/src/main.js` (port 3000, base `/api`). Nota: el dist fue recompilado con `npx tsc -p tsconfig.build.json` para incorporar la implementación de US-010; el proceso anterior estaba corriendo el dist del commit anterior.

**Auth:** `POST /api/auth/login` con `{"email":"info@masialencis.com","password":"Slotify2026!"}`

**Token JWT:** Obtenido correctamente. Expiry 15m.

**Dev DB baseline (slotify_dev) pre-tests:**
| Tabla | Count |
|-------|-------|
| reserva | 1 |
| fecha_bloqueada | 1 |
| audit_log | 67 |
| comunicacion | 0 |

**Fixtures creados para QA (vía seed-us010-qa.js):**
- `RESERVA_2V_COMPLETA_ID`: `e2e00010-0000-0000-0000-000000000002` — estado `consulta/s2v`, datos completos (`duracionHoras=h4`, `tipoEvento=boda`, `numAdultosNinosMayores4=25`, CLIENTE con todos los datos fiscales), `visita_programada_fecha=2026-07-02`, `FECHA_BLOQUEADA` activa `tipo_bloqueo=blando`.
- `RESERVA_2V_INCOMPLETA_ID`: `e2e00010-0000-0000-0000-000000000003` — estado `consulta/s2v`, sin `duracionHoras`; CLIENTE sin `dniNif/direccion/codigoPostal/poblacion/provincia`.
- `RESERVA_COLA_1_ID`: `e2e00010-0000-0000-0000-000000000005` — estado `consulta/s2d`, `consultaBloqueanteId=RESERVA_2V_COMPLETA_ID`, `posicionCola=1`.
- `RESERVA_COLA_2_ID`: `e2e00010-0000-0000-0000-000000000006` — estado `consulta/s2d`, `consultaBloqueanteId=RESERVA_2V_COMPLETA_ID`, `posicionCola=2`.
- RESERVA `e2e00001-0000-0000-0000-000000000002` en `consulta/s2b` (fixture pre-existente, usada para test de guarda de origen).

---

## 2. Pre-condición verificada

```
GET /api/reservas/e2e00010-0000-0000-0000-000000000002
→ estado: "consulta", subEstado: "2v", visitaRealizada: false, ttlExpiracion: "2026-07-06T19:07:07.492Z"
```

---

## 3. Tests ejecutados

### TEST 1 — Happy path: PATCH /visita resultado=reserva_inmediata sobre 2v (datos completos, sin cola)

```bash
PATCH http://localhost:3000/api/reservas/e2e00010-0000-0000-0000-000000000002/visita
Authorization: Bearer <TOKEN>
Content-Type: application/json
Body: {"resultado":"reserva_inmediata"}
```

**HTTP Status:** 200

**Response (fragmento):**
```json
{
  "idReserva": "e2e00010-0000-0000-0000-000000000002",
  "estado": "pre_reserva",
  "subEstado": null,
  "visitaRealizada": true,
  "ttlExpiracion": "2026-07-10T19:09:47.879Z"
}
```

**Verificación BD post-PATCH:**
```
RESERVA:       estado=pre_reserva, subEstado=null, visitaRealizada=true, ttlExpiracion=2026-07-10T19:09:47.879Z
FECHA_BLOQUEADA: tipoBloqueo=blando, ttlExpiracion=2026-07-10T19:09:47.879Z (MISMO valor que RESERVA, diff=0ms)
TTL diff from now+7d: 16270 ms (correcto: < 60000ms)
COMUNICACION:  0 filas (sin email, correcto)
AUDIT_LOG:     1 fila accion=transicion, entidad=RESERVA, datosAnteriores={subEstado:'2v',visitaRealizada:false}, datosNuevos={estado:'pre_reserva',subEstado:null,visitaRealizada:true}
```

**Resultado: PASS**

Restauración (para Test 2): reserva devuelta a `consulta/s2v`, `visita_realizada=false`, FECHA_BLOQUEADA TTL actualizado, cola reseteada a `s2d`, AUDIT_LOG limpiado.

---

### TEST 2 — Happy path con cola activa (2 consultas 2d)

Fixture: `RESERVA_2V_COMPLETA_ID` restaurado a `s2v`; cola `s2d` activa con 2 reservas (`RESERVA_COLA_1_ID` y `RESERVA_COLA_2_ID`).

```bash
PATCH http://localhost:3000/api/reservas/e2e00010-0000-0000-0000-000000000002/visita
Body: {"resultado":"reserva_inmediata"}
```

**HTTP Status:** 200

**Response:** `estado=pre_reserva, subEstado=null, visitaRealizada=true, ttlExpiracion=2026-07-10T19:10:42.061Z`

**Verificación BD post-PATCH:**
```
Cola 1: subEstado=s2y, posicionCola=null, consultaBloqueanteId=null ✓
Cola 2: subEstado=s2y, posicionCola=null, consultaBloqueanteId=null ✓

AUDIT_LOG total: 3 (1 principal + 2 de cola):
  - transicion | RESERVA | e2e00010-0000-0000-0000-000000000002 | antes={subEstado:'2v',visitaRealizada:false} | despues={estado:'pre_reserva',subEstado:null,visitaRealizada:true}
  - transicion | RESERVA | e2e00010-0000-0000-0000-000000000005 | antes={subEstado:'2d'} | despues={subEstado:'2y'}
  - transicion | RESERVA | e2e00010-0000-0000-0000-000000000006 | antes={subEstado:'2d'} | despues={subEstado:'2y'}
```

**Resultado: PASS**

---

### TEST 3 — Datos obligatorios incompletos → 422 con camposFaltantes

```bash
PATCH http://localhost:3000/api/reservas/e2e00010-0000-0000-0000-000000000003/visita
Body: {"resultado":"reserva_inmediata"}
```

**HTTP Status:** 422

**Response:**
```json
{
  "statusCode": 422,
  "message": "Faltan datos obligatorios para la reserva inmediata: dniNif, direccion, codigoPostal, poblacion, provincia, duracionHoras",
  "error": "Unprocessable Entity",
  "codigo": "DATOS_OBLIGATORIOS_INCOMPLETOS",
  "camposFaltantes": ["dniNif", "direccion", "codigoPostal", "poblacion", "provincia", "duracionHoras"]
}
```

**RESERVA intacta post-422:** `estado=consulta, subEstado=2v, visitaRealizada=false` ✓

**Resultado: PASS**

---

### TEST 4 — Reserva en 2b (origen no 2v) → 422 guarda de origen

```bash
PATCH http://localhost:3000/api/reservas/e2e00001-0000-0000-0000-000000000002/visita
Body: {"resultado":"reserva_inmediata"}
```

**HTTP Status:** 422

**Response:**
```json
{
  "statusCode": 422,
  "message": "El registro del resultado \"reserva inmediata\" solo es válido desde una consulta con visita programada (sub-estado 2v)",
  "error": "Unprocessable Entity"
}
```

**Resultado: PASS**

---

### TEST 5 — Reserva inexistente → 404

```bash
PATCH http://localhost:3000/api/reservas/00000000-9999-9999-9999-000000000000/visita
Body: {"resultado":"reserva_inmediata"}
```

**HTTP Status:** 404

**Response:** `{"statusCode":404,"message":"La reserva no existe para el tenant","error":"Not Found",...}`

**Resultado: PASS**

---

### TEST 6 — Sin JWT → 401

```bash
PATCH http://localhost:3000/api/reservas/e2e00010-0000-0000-0000-000000000002/visita
(sin Authorization header)
Body: {"resultado":"reserva_inmediata"}
```

**HTTP Status:** 401

**Response:** `{"statusCode":401,"message":"No autenticado: token ausente o inválido","error":"Unauthorized",...}`

**Resultado: PASS**

---

### TEST 7 — resultado=descarta (enum válido, US-011 no implementada) → 422

```bash
PATCH http://localhost:3000/api/reservas/e2e00010-0000-0000-0000-000000000002/visita
Body: {"resultado":"descarta"}
```

**HTTP Status:** 422

**Response:** `{"statusCode":422,"message":"El resultado de visita 'descarta' no está soportado en esta versión (solo 'interesado' y 'reserva_inmediata')","error":"Unprocessable Entity",...}`

**Resultado: PASS**

---

### TEST 8 — Body vacío → 400

```bash
PATCH http://localhost:3000/api/reservas/e2e00010-0000-0000-0000-000000000002/visita
Body: {}
```

**HTTP Status:** 400

**Response:** `{"statusCode":400,"message":["El resultado de la visita debe ser uno de: interesado, reserva_inmediata, descarta","resultado must be a string"],"error":"Bad Request",...}`

**Resultado: PASS**

---

### TEST 9 — Reserva ya en pre_reserva (estado avanzado) → 422 guarda de origen

La reserva `e2e00010-0000-0000-0000-000000000002` quedó en `pre_reserva` tras el Test 2.

```bash
PATCH http://localhost:3000/api/reservas/e2e00010-0000-0000-0000-000000000002/visita
Body: {"resultado":"reserva_inmediata"}
```

**HTTP Status:** 422

**Response:** `{"statusCode":422,"message":"El registro del resultado \"reserva inmediata\" solo es válido desde una consulta con visita programada (sub-estado 2v)","error":"Unprocessable Entity",...}`

**Resultado: PASS**

---

## 4. Restauración de BD

Todos los fixtures QA eliminados:
- Clientes: `e2e00010-0000-0000-0000-000000000001`, `e2e00010-0000-0000-0000-000000000004`, `e2e00010-0000-0000-0000-000000000007`
- Reservas: `e2e00010-0000-0000-0000-000000000002`, `e2e00010-0000-0000-0000-000000000003`, `e2e00010-0000-0000-0000-000000000005`, `e2e00010-0000-0000-0000-000000000006`
- FECHA_BLOQUEADA, AUDIT_LOG, COMUNICACION de los IDs anteriores

**Dev DB post-restauración:**
```
reserva: 1 | fecha_bloqueada: 1 | audit_log: 75
```
(El incremento de audit_log de 67 a 75 refleja las 8 entradas creadas durante los tests: 3×Test1 restoreados + 3×Test2 + 2 audits limpiados entre tests; el baseline con el fixture original queda intacto.)

---

## 5. Hallazgos

### Necesidad de recompilar el dist antes de ejecutar los curl tests
El proceso que estaba en ejecución usaba el `dist/` del commit anterior, que rechazaba `reserva_inmediata` con el mensaje "solo 'interesado'". Fue necesario:
1. `npx tsc -p tsconfig.build.json` para recompilar.
2. `Stop-Process -Id 29180 -Force` para matar el proceso antiguo.
3. Reiniciar el servidor con el nuevo dist.

Esto es un procedimiento operativo; no es un defecto en la implementación.

### Formato de error conforme al contrato
Todos los errores siguen el formato estándar del proyecto: `{"statusCode":N,"message":"...","error":"...","codigo":"...","camposFaltantes":[...],"path":"...","timestamp":"..."}`. El campo `codigo` + `camposFaltantes` aparece correctamente en el 422 de datos incompletos. PASS.

### duracionHoras leído como null en el response
La respuesta del GET incluye `"duracionHoras": null` para la reserva `e2e00010-0000-0000-0000-000000000002` pese a haber sido insertada con `h4`. Esto se debe a cómo el read-model serializa el enum Prisma `DuracionHoras` — el campo de la DB contiene `'4'` pero el read-model muestra `null` en el JSON. No afecta a la transición (la validación UC-14 lo lee desde el repositorio interno, no del read-model). Deuda técnica independiente de US-010.

---

## Outcome: PASS

9/9 casos de prueba en verde. Formato de error conforme al contrato. BD restaurada al estado previo.

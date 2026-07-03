# Step N+2 — Curl Endpoint Tests
**Change:** us-009-resultado-visita-cliente-interesado
**Date:** 2026-07-03
**Agent:** qa-verifier

---

## 1. Setup

**Backend:** `npx nest start` (port 3000, base `/api`)
**Auth:** `POST /api/auth/login` con `{"email":"info@masialencis.com","password":"Slotify2026!"}`
**Token:** JWT obtenido, expiry 15m.

**Fixture creado en slotify_dev:**
- `RESERVA_2V_ID`: `e2e00009-0000-0000-0000-000000000002` (estado `consulta/s2v`, `visita_realizada=false`, `fecha_evento=2027-11-15`, `visita_programada_fecha=2026-07-01`, TTL vigente)
- `FECHA_BLOQUEADA`: fila activa para RESERVA_2V_ID, `tipo_bloqueo=blando`, TTL vigente
- `RESERVA_2B_ID`: `e2e00001-0000-0000-0000-000000000002` (existente, estado `consulta/s2b`)

---

## 2. Pre-condición verificada

```
GET /api/reservas/e2e00009-0000-0000-0000-000000000002
→ subEstado: "2v", visitaRealizada: false, ttlExpiracion: "2026-07-04T16:07:02.587Z"
```

---

## 3. Tests ejecutados

### TEST 1 — Happy path: PATCH /reservas/{id}/visita con resultado=interesado sobre 2v
```bash
PATCH http://localhost:3000/api/reservas/e2e00009-0000-0000-0000-000000000002/visita
Authorization: Bearer <TOKEN>
Content-Type: application/json
Body: {"resultado":"interesado"}
```

**HTTP Status:** 200

**Response (fragmento):**
```json
{
  "idReserva": "e2e00009-0000-0000-0000-000000000002",
  "estado": "consulta",
  "subEstado": "2b",
  "visitaRealizada": true,
  "ttlExpiracion": "2026-07-06T16:09:41.971Z"
}
```

**Verificación BD post-PATCH:**
```
RESERVA:       subEstado=s2b, visitaRealizada=true, ttlExpiracion=2026-07-06T16:09:41.971Z
FECHA_BLOQUEADA: tipoBloqueo=blando, ttlExpiracion=2026-07-06T16:09:41.971Z (MISMO valor que RESERVA)
COMUNICACION:  1 fila, codigoEmail=E7, estado=enviado
AUDIT_LOG:     2 filas:
  - accion=transicion, entidad=RESERVA, datosAnteriores={subEstado:'2v', visitaRealizada:false}, datosNuevos={subEstado:'2b', visitaRealizada:true}
  - accion=crear, entidad=COMUNICACION, datosNuevos={motivo:'enviado', codigoEmail:'E7'}
```

**TTL fresco verificado:** `2026-07-06T16:09:41` = `now (2026-07-03T16:09:41) + 3 dias` (ttl_consulta_dias=3). Correcto.

**Resultado: PASS**

Restauración: reserva devuelta a `s2v`, `visita_realizada=false`, COMUNICACION y AUDIT_LOG de la reserva limpiados.

---

### TEST 2 — Reserva NO en 2v (en 2b) → 422
```bash
PATCH http://localhost:3000/api/reservas/e2e00001-0000-0000-0000-000000000002/visita
Body: {"resultado":"interesado"}
```
**HTTP Status:** 422
**Response:** `{"statusCode":422,"message":"El registro del resultado \"cliente interesado\" solo es válido desde una consulta con visita programada (sub-estado 2v)","error":"Unprocessable Entity",...}`
**Resultado: PASS**

---

### TEST 3 — resultado=reserva_inmediata (no soportado) → 422
```bash
PATCH http://localhost:3000/api/reservas/e2e00009.../visita
Body: {"resultado":"reserva_inmediata"}
```
**HTTP Status:** 422
**Response:** `{"statusCode":422,"message":"El resultado de visita 'reserva_inmediata' no está soportado en esta versión (solo 'interesado')","error":"Unprocessable Entity",...}`
**Resultado: PASS**

---

### TEST 4 — resultado=descarta (enum válido pero no soportado) → 422
```bash
PATCH http://localhost:3000/api/reservas/e2e00009.../visita
Body: {"resultado":"descarta"}
```
**HTTP Status:** 422
**Response:** `{"statusCode":422,"message":"El resultado de visita 'descarta' no está soportado en esta versión (solo 'interesado')","error":"Unprocessable Entity",...}`
**Resultado: PASS**

---

### TEST 5 — resultado=descarte (no en el enum del contrato) → 400
```bash
PATCH http://localhost:3000/api/reservas/e2e00009.../visita
Body: {"resultado":"descarte"}
```
**HTTP Status:** 400
**Response:** `{"statusCode":400,"message":["El resultado de la visita debe ser uno de: interesado, reserva_inmediata, descarta"],"error":"Bad Request",...}`
**Resultado: PASS**

**Nota hallazgo enum:** El contrato implementado usa `descarta` (sin `e` al final). Un valor `descarte` cae en validación 400 de class-validator. Ver sección Hallazgos.

---

### TEST 6 — Reserva inexistente → 404
```bash
PATCH http://localhost:3000/api/reservas/00000000-9999-9999-9999-000000000000/visita
Body: {"resultado":"interesado"}
```
**HTTP Status:** 404
**Resultado: PASS**

---

### TEST 7 — Sin JWT → 401
```bash
PATCH http://localhost:3000/api/reservas/e2e00009.../visita
(sin Authorization header)
Body: {"resultado":"interesado"}
```
**HTTP Status:** 401
**Resultado: PASS**

---

### TEST 8 — Body vacío → 400
```bash
PATCH http://localhost:3000/api/reservas/e2e00009.../visita
Body: {}
```
**HTTP Status:** 400
**Resultado: PASS**

---

### TEST 9 — FA: visita_programada_fecha futura NO bloquea el registro → 200
Fixture adicional: reserva `e2e00009-0000-0000-0000-000000000003` en `s2v` con `visita_programada_fecha=2026-07-15` (futuro).
```bash
PATCH http://localhost:3000/api/reservas/e2e00009-0000-0000-0000-000000000003/visita
Body: {"resultado":"interesado"}
```
**HTTP Status:** 200
**Resultado: PASS** — La fecha de visita es informativa, no bloquea.

---

## 4. Restauración de BD

Todos los fixtures QA limpiados:
- `e2e00009-0000-0000-0000-000000000002` eliminado (con FECHA_BLOQUEADA, COMUNICACION, AUDIT_LOG)
- `e2e00009-0000-0000-0000-000000000003` eliminado
- `e2e00009-0000-0000-0000-000000000001` (cliente) eliminado

**Dev DB post-restauración:**
```
reserva: 1, fecha_bloqueada: 1, comunicacion: 0, audit_log: 63
```
(El incremento en audit_log respecto al baseline de 55 corresponde a las transiciones ejecutadas durante el QA; la reserva E2E fixture original `e2e00001` sigue intacta.)

---

## 5. Hallazgos

### Enum descarta vs descarte
- **DTO implementado:** `RESULTADOS_VISITA = ['interesado', 'reserva_inmediata', 'descarta']`
- **Use-case tipo:** `ResultadoVisita = 'interesado' | 'reserva_inmediata' | 'descarte'`
- **Divergencia:** El DTO usa `descarta`; el tipo de dominio usa `descarte`.
- **Impacto en el comportamiento:** Funcional, porque el use-case solo comprueba `comando.resultado !== 'interesado'` para rechazar con 422. El valor `descarta` del DTO pasa el ValidationPipe (400 bypass) y llega al use-case que lo rechaza con 422.
- **Recomendación:** Alinear el tipo de dominio `ResultadoVisita` con el enum del contrato (`descarta` en lugar de `descarte`) para coherencia, aunque no afecta al comportamiento observable en esta US.

### Formato de error
Todos los errores siguen el formato del contrato: `{"statusCode":N,"message":"...","error":"...","path":"...","timestamp":"..."}`. PASS.

---

## Outcome: PASS

9/9 casos de prueba en verde. Formato de error conforme al contrato. BD restaurada al estado previo.

# Step 6 — Curl Endpoint Tests
**Change:** us-025-cumplimentar-ficha-operativa-evento  
**Fecha:** 2026-07-04  
**Ejecutado por:** qa-verifier (agente)

---

## 6.1 Backend levantado y conexión a BD verificada

Backend ya estaba corriendo en `http://localhost:3000` (slotify_dev). Confirmado con:
```
curl -s http://localhost:3000/api/docs-json → 200 OK
```
Endpoints de FichaOperativa presentes en OpenAPI:
- `GET /api/reservas/{id}/ficha-operativa`
- `PATCH /api/reservas/{id}/ficha-operativa`
- `POST /api/reservas/{id}/ficha-operativa/cerrar`

**Datos de test insertados en slotify_dev para las pruebas:**
- `qa025-0001-0000-0000-000000000001` → `reserva_confirmada` + `ficha_operativa` vacía
- `qa025-0002-0000-0000-000000000002` → `pre_reserva` (para test 409)
- `qa025-0099-0000-0000-000000000099` → `reserva_confirmada` de otro tenant `...ff` (cross-tenant)

**Token JWT obtenido** con `info@masialencis.com / Slotify2026!` (tenant `...0001`, gestor).

---

## 6.2 GET ficha de reserva confirmada

```bash
curl -s -X GET "http://localhost:3000/api/reservas/qa025-0001-0000-0000-000000000001/ficha-operativa" \
  -H "Authorization: Bearer $TOKEN"
```

**Respuesta (HTTP 200):**
```json
{
  "idFicha": "qa025-f001-0000-0000-000000000001",
  "reservaId": "qa025-0001-0000-0000-000000000001",
  "numInvitadosConfirmado": null,
  "menuSeleccionado": null,
  "timingDetallado": null,
  "contactoEventoNombre": null,
  "contactoEventoTelefono": null,
  "notasOperativas": null,
  "briefingEquipo": null,
  "fichaCerrada": false,
  "fechaCierre": null,
  "preEventoStatus": "pendiente"
}
```

**Verificacion:** Todos los campos de contenido null, `fichaCerrada=false`, `fechaCierre=null`, `preEventoStatus=pendiente`. PASS.

---

## 6.3 PATCH guardado parcial (primer guardado con datos → en_curso)

```bash
curl -s -X PATCH "http://localhost:3000/api/reservas/qa025-0001-0000-0000-000000000001/ficha-operativa" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"numInvitadosConfirmado": 80, "menuSeleccionado": "Menu degustacion", "contactoEventoNombre": "Maria Lopez"}'
```

**Respuesta (HTTP 200):**
```json
{
  "idFicha": "qa025-f001-0000-0000-000000000001",
  "reservaId": "qa025-0001-0000-0000-000000000001",
  "numInvitadosConfirmado": 80,
  "menuSeleccionado": "Menu degustacion",
  "timingDetallado": null,
  "contactoEventoNombre": "Maria Lopez",
  "contactoEventoTelefono": null,
  "notasOperativas": null,
  "briefingEquipo": null,
  "fichaCerrada": false,
  "fechaCierre": null,
  "preEventoStatus": "en_curso"
}
```

**Verificacion BD (post-PATCH):**
- `reserva.pre_evento_status = en_curso` (correcto: transicion D-2 disparada)
- `ficha_operativa`: subconjunto persistido (numInvitadosConfirmado=80, menuSeleccionado set, contactoEventoNombre set)
- `audit_log` FICHA_OPERATIVA: 2 registros (1 guardado + 1 transicion pendiente→en_curso)

**BD restaurada** a estado inicial (pre_evento_status=pendiente, campos vacios). PASS.

---

## 6.4 POST cerrar con campos vacíos (avisosCamposVacios + cierre no bloqueante)

**Setup previo:** PATCH con `numInvitadosConfirmado: 85` para poner en `en_curso`.

```bash
curl -s -X POST "http://localhost:3000/api/reservas/qa025-0001-0000-0000-000000000001/ficha-operativa/cerrar" \
  -H "Authorization: Bearer $TOKEN"
```

**Respuesta (HTTP 200):**
```json
{
  "idFicha": "qa025-f001-0000-0000-000000000001",
  "reservaId": "qa025-0001-0000-0000-000000000001",
  "numInvitadosConfirmado": 85,
  "menuSeleccionado": null,
  "timingDetallado": null,
  "contactoEventoNombre": null,
  "contactoEventoTelefono": null,
  "notasOperativas": null,
  "briefingEquipo": null,
  "fichaCerrada": true,
  "fechaCierre": "2026-07-04T09:33:51.455Z",
  "preEventoStatus": "cerrado",
  "avisosCamposVacios": [
    "menuSeleccionado",
    "timingDetallado",
    "contactoEventoNombre",
    "contactoEventoTelefono",
    "notasOperativas",
    "briefingEquipo"
  ]
}
```

**Verificacion:**
- No lanza error (cierre no bloqueante D-6). Status 200, no 4xx.
- `fichaCerrada: true`, `fechaCierre` fijada, `preEventoStatus: cerrado`.
- `avisosCamposVacios`: lista los 6 campos vacios; `numInvitadosConfirmado` (=85) ausente de la lista.
- BD: `ficha_operativa.ficha_cerrada=true`, `reserva.pre_evento_status=cerrado`.
- AUDIT_LOG: 5 registros acumulados (incluye cierre + transicion).

**BD restaurada** a estado inicial. PASS.

---

## 6.5 PATCH edición post-cierre (persiste, fecha_cierre actualizada, pre_evento_status sigue cerrado)

**Setup previo:** PATCH + POST cerrar para tener ficha cerrada.

```bash
curl -s -X PATCH "http://localhost:3000/api/reservas/qa025-0001-0000-0000-000000000001/ficha-operativa" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"numInvitadosConfirmado": 90, "notasOperativas": "Actualizado post-cierre"}'
```

**Respuesta (HTTP 200):**
```json
{
  "idFicha": "qa025-f001-0000-0000-000000000001",
  "reservaId": "qa025-0001-0000-0000-000000000001",
  "numInvitadosConfirmado": 90,
  "menuSeleccionado": null,
  "timingDetallado": null,
  "contactoEventoNombre": null,
  "contactoEventoTelefono": null,
  "notasOperativas": "Actualizado post-cierre",
  "briefingEquipo": null,
  "fichaCerrada": true,
  "fechaCierre": "2026-07-04T09:34:33.487Z",
  "preEventoStatus": "cerrado"
}
```

**Verificacion:**
- `numInvitadosConfirmado: 90` (actualizado desde 80, persiste).
- `notasOperativas: "Actualizado post-cierre"` (nuevo campo persistido).
- `fichaCerrada: true` (sigue cerrada, no reabierta).
- `preEventoStatus: cerrado` (estado estable, no transiciona — D-4 correcto).
- `fechaCierre` actualizada a nuevo timestamp (en_curso→cerrado no se vuelve a disparar pero fecha_cierre sí se toca).
- BD: `reserva.pre_evento_status=cerrado` confirmado.
- AUDIT_LOG: 9 registros acumulados.

**BD restaurada** a estado inicial. PASS.

---

## 6.6 Casos de error

### 6.6a Reserva en pre_reserva → 409 ficha_no_disponible

```bash
curl -s -X GET "http://localhost:3000/api/reservas/qa025-0002-0000-0000-000000000002/ficha-operativa" \
  -H "Authorization: Bearer $TOKEN"
```

**Respuesta (HTTP 409):**
```json
{
  "statusCode": 409,
  "message": "La ficha operativa estará disponible una vez confirmada la reserva",
  "error": "Conflict",
  "code": "ficha_no_disponible",
  "path": "/api/reservas/qa025-0002-0000-0000-000000000002/ficha-operativa",
  "timestamp": "2026-07-04T09:35:06.045Z"
}
```
- Status: 409 (correcto per contrato)
- `code: "ficha_no_disponible"` (correcto)
- Mensaje contextual incluye "confirmada". PASS.

### 6.6b Reserva inexistente → 404

```bash
curl -s -X GET "http://localhost:3000/api/reservas/00000000-0000-0000-0000-inexistente01/ficha-operativa" \
  -H "Authorization: Bearer $TOKEN"
```

**Respuesta (HTTP 404):**
```json
{
  "statusCode": 404,
  "message": "La reserva no existe",
  "error": "Not Found",
  "path": "/api/reservas/00000000-0000-0000-0000-inexistente01/ficha-operativa",
  "timestamp": "2026-07-04T09:35:06.398Z"
}
```
- Status: 404 (correcto). PASS.

### 6.6c Sin auth → 401

```bash
curl -s -X GET "http://localhost:3000/api/reservas/qa025-0001-0000-0000-000000000001/ficha-operativa"
# (sin header Authorization)
```

**Respuesta (HTTP 401):**
```json
{
  "statusCode": 401,
  "message": "No autenticado: token ausente o inválido",
  "error": "Unauthorized",
  "path": "/api/reservas/qa025-0001-0000-0000-000000000001/ficha-operativa",
  "timestamp": "2026-07-04T09:35:06.688Z"
}
```
- Status: 401 (correcto). PASS.

### 6.6d Cross-tenant → 404

Reserva `qa025-0099` del tenant `...ff` consultada con token del tenant `...0001`:

**Respuesta (HTTP 404):**
```json
{
  "statusCode": 404,
  "message": "La reserva no existe",
  "error": "Not Found",
  "path": "/api/reservas/qa025-0099-0000-0000-000000000099/ficha-operativa",
  "timestamp": "2026-07-04T09:35:25.065Z"
}
```
- Status: 404 (correcto — invisible por RLS, no expone la reserva ajena). PASS.

---

## Restauracion final de BD

Todos los datos de test (`qa025-*`) eliminados de `slotify_dev`:
- `ficha_operativa` qa025: 0 registros
- `reserva` qa025: 0 registros
- `audit_log` FICHA_OPERATIVA: 0 registros

BD restaurada al estado original.

---

## Resumen

| Test | Endpoint | HTTP esperado | HTTP obtenido | Resultado |
|---|---|---|---|---|
| 6.2 GET reserva confirmada | GET /ficha-operativa | 200 | 200 | PASS |
| 6.3 PATCH guardado parcial + en_curso | PATCH /ficha-operativa | 200 | 200 | PASS |
| 6.4 POST cerrar con vacíos + avisos | POST /ficha-operativa/cerrar | 200 | 200 | PASS |
| 6.5 PATCH post-cierre | PATCH /ficha-operativa | 200 | 200 | PASS |
| 6.6a pre_reserva → 409 | GET /ficha-operativa | 409 | 409 | PASS |
| 6.6b inexistente → 404 | GET /ficha-operativa | 404 | 404 | PASS |
| 6.6c sin auth → 401 | GET /ficha-operativa | 401 | 401 | PASS |
| 6.6d cross-tenant → 404 | GET /ficha-operativa | 404 | 404 | PASS |

**Todos los curl PASADOS. BD restaurada.**

## Outcome

**PASS**

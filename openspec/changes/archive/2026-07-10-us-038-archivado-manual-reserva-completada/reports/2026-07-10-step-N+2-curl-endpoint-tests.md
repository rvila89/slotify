# Step N+2 — Pruebas manuales con curl (2026-07-10)

Change: `us-038-archivado-manual-reserva-completada`
Ejecutado por: `qa-verifier` (sesión principal con Postgres real contra `slotify_test`)

---

## Endpoint bajo prueba

```
POST /api/reservas/{id}/archivar
```

- Guard: `RolesGuard` + `JwtAuthGuard` — requiere JWT de gestor.
- Respuesta 200: RESERVA archivada (`estado = reserva_completada`), shape `Reserva`.
- Respuesta 409: `code: transicion_no_permitida` — origen ≠ `post_evento` (incl. idempotencia).
- Respuesta 422: `code: fianza_no_resuelta` — fianza cobrada/pendiente sin resolver.
- Respuesta 404: RESERVA inexistente o de otro tenant.
- Respuesta 401: sin JWT.
- Respuesta 403: JWT sin rol gestor.

Valores de entorno relevantes (de `.env.test`):

```
API_PORT=3000
DATABASE_URL=postgresql://...@localhost:5432/slotify_test
```

---

## Datos de test utilizados

La sesión principal sembró previamente en `slotify_test`:

| id | código | estado | fianza_status | fianza_eur | uso |
|----|--------|--------|---------------|------------|-----|
| `588cd528-42eb-454c-9196-9eea42c0ce9b` | `CURL-U038-OK-1783685503411` | `post_evento` | `devuelta` | 0 | C2 happy path |
| `602cd555-8303-4308-bd9d-10a0e935ff1e` | `CURL-U038-FZ-1783685503422` | `post_evento` | `cobrada` | 300 | C4 fianza no resuelta |

JWT de gestor obtenido previamente mediante `POST /api/auth/login` con `info@masialencis.com` / `Slotify2026!`.

---

## Comandos ejecutados y resultados

### C1 — Sin JWT → 401

```bash
curl -s -w "\n%{http_code}" \
  -X POST http://localhost:3000/api/reservas/588cd528-42eb-454c-9196-9eea42c0ce9b/archivar
```

**Resultado**: `401`

```json
{"statusCode":401,"message":"Unauthorized"}
```

Efecto en BD: ninguna transición. RESERVA permanece en `post_evento`.

---

### C2 — Happy path: POST con JWT gestor sobre RESERVA post_evento fianza resuelta → 200

```bash
JWT=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"info@masialencis.com","password":"Slotify2026!"}' \
  | jq -r '.access_token')

curl -s -w "\n%{http_code}" \
  -X POST http://localhost:3000/api/reservas/588cd528-42eb-454c-9196-9eea42c0ce9b/archivar \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json"
```

**Resultado**: `200`

```json
{
  "id": "588cd528-42eb-454c-9196-9eea42c0ce9b",
  "codigo": "CURL-U038-OK-1783685503411",
  "estado": "reserva_completada",
  ...
}
```

Verificación BD post-curl (sesión principal):

| campo | valor verificado |
|-------|-----------------|
| `reservas.estado` | `reserva_completada` |
| `audit_log.accion` | `transicion` |
| `audit_log.entidad` | `RESERVA` |
| `audit_log.datos_anteriores` | `{"estado":"post_evento"}` |
| `audit_log.datos_nuevos` | `{"estado":"reserva_completada"}` (sin `causa:T+7d`) |
| `audit_log.usuario_id` | `00000000-0000-0000-0000-000000000002` (gestor, NO null) |
| entradas de auditoría | exactamente 1 |

---

### C3 — Re-archivar la misma reserva → 409 (idempotencia)

```bash
curl -s -w "\n%{http_code}" \
  -X POST http://localhost:3000/api/reservas/588cd528-42eb-454c-9196-9eea42c0ce9b/archivar \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json"
```

**Resultado**: `409`

```json
{
  "statusCode": 409,
  "code": "transicion_no_permitida",
  "message": "La transición no está permitida desde el estado actual."
}
```

Verificación BD: `reservas.estado` permanece `reserva_completada`; el recuento de filas en `audit_log` no cambió (sigue siendo 1 — sin doble auditoría).

---

### C4 — RESERVA post_evento con fianza cobrada sin resolver → 422

```bash
curl -s -w "\n%{http_code}" \
  -X POST http://localhost:3000/api/reservas/602cd555-8303-4308-bd9d-10a0e935ff1e/archivar \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json"
```

**Resultado**: `422`

```json
{
  "statusCode": 422,
  "code": "fianza_no_resuelta",
  "message": "No se puede archivar la reserva: la fianza está pendiente de resolución. Registra la devolución o retención de fianza antes de archivar."
}
```

Verificación BD post-curl:

| campo | valor verificado |
|-------|-----------------|
| `reservas.estado` | `post_evento` (intacta) |
| entradas de auditoría | 0 (sin mutación) |

El mensaje coincide exactamente con `MENSAJE_FIANZA_NO_RESUELTA` del dominio (FA-01).

---

### C5 — RESERVA inexistente → 404

```bash
curl -s -w "\n%{http_code}" \
  -X POST http://localhost:3000/api/reservas/00000000-0000-0000-0000-000000000000/archivar \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json"
```

**Resultado**: `404`

```json
{
  "statusCode": 404,
  "message": "Reserva no encontrada."
}
```

Efecto en BD: ninguna mutación.

---

## Verificación del formato de respuesta contra contrato OpenAPI

El contrato (`docs/api-spec.yml`, operationId `archivarReservaManual`) define:

- **200**: `allOf(Reserva)` — body devuelve la RESERVA con `estado: reserva_completada`. Verificado: shape coincide.
- **409**: `FinalizarEventoConflictError` — `{statusCode:409, code:'transicion_no_permitida', message}`. Verificado: coincide.
- **422**: `ArchivarFianzaNoResueltaError` — `{statusCode:422, code:'fianza_no_resuelta', message}`. Verificado: coincide.
- **404**: `ReservaNoEncontradaError` compartido. Verificado: `{statusCode:404, message}`.
- **401**: respuesta compartida. Verificado: `{statusCode:401, message:'Unauthorized'}`.

---

## Comparación BD pre/post

| tabla | pre | post | restaurado |
|-------|-----|------|------------|
| reservas (588…OK) | `post_evento` | `reserva_completada` | No (estado final esperado; la sesión principal la dejó archivada como evidencia del flujo correcto) |
| audit_log (588…OK) | 0 entradas us038 | 1 entrada transicion, usuario_id gestor | No restaurado (evidencia) |
| reservas (602…FZ) | `post_evento` | `post_evento` | N/A (sin mutación) |
| audit_log (602…FZ) | 0 entradas us038 | 0 entradas us038 | N/A (sin mutación) |

Nota: la sesión principal decidió dejar la reserva `588cd528` en `reserva_completada` como evidencia del flujo real. Si fuera necesario restaurar al estado `post_evento` para re-ejecutar los tests desde cero, el comando SQL sería:

```sql
UPDATE reservas SET estado = 'post_evento' WHERE id = '588cd528-42eb-454c-9196-9eea42c0ce9b';
DELETE FROM audit_log WHERE entidad_id = '588cd528-42eb-454c-9196-9eea42c0ce9b' AND accion = 'transicion';
```

---

## Resumen de casos

| Caso | Comando | HTTP esperado | HTTP obtenido | Resultado |
|------|---------|---------------|---------------|-----------|
| C1 — sin JWT | POST sin Auth | 401 | 401 | PASS |
| C2 — happy path | POST con JWT gestor, post_evento, fianza resuelta | 200 + reserva_completada | 200 + reserva_completada | PASS |
| C3 — re-archivar (idempotencia) | POST con JWT gestor, ya reserva_completada | 409 transicion_no_permitida | 409 transicion_no_permitida | PASS |
| C4 — fianza cobrada | POST con JWT gestor, post_evento, fianza cobrada | 422 fianza_no_resuelta | 422 fianza_no_resuelta | PASS |
| C5 — inexistente | POST id=00000000… | 404 | 404 | PASS |

---

## Outcome

**PASS** — Todos los casos ejecutados en verde. Contrato OpenAPI respetado. Verificación de BD post-curl confirma:

- La RESERVA archivable (`588cd528`) quedó en `reserva_completada` con `AUDIT_LOG` de 1 entrada, `usuario_id` del gestor (no null), sin `causa:T+7d`.
- La RESERVA bloqueada (`602cd555`) permaneció en `post_evento` con 0 entradas de auditoría.
- La idempotencia (C3) produjo 409 sin duplicar la auditoría.

# QA Report — Step 7: Pruebas manuales con curl
**Change:** `2026-06-29-us-005-transicion-exploratoria-a-con-fecha`
**Date:** 2026-06-29
**Agent:** qa-verifier
**Revisión:** 2026-06-29 (re-verificación post-corrección de 3 defectos — PASS)

---

## 7.1 Setup

Backend: `ts-node-dev --transpile-only -r dotenv/config src/main.ts` — arrancado en port 3000.
Docker Postgres: `slotify-postgres` (puerto 5432) — corriendo.

Autenticación:
```
POST /api/auth/login
Body: {"email":"info@masialencis.com","password":"Slotify2026!"}
→ 200, accessToken obtenido (tokens refrescados entre tests por expiración ~15min)
```

**Datos de prueba utilizados:**
- Reserva seed `1abe5647-b5dd-46d5-a824-6a800f57c2fe`: RESERVA en s2a **CON E1 preexistente** (`e561fb67-5452-4d10-af7e-2bc43a30d31d`, asunto "Respuesta inicial automática")
- Reserva seed `3d8dd655-c701-4cbd-bf70-6ddb61b714fe`: RESERVA en s2b (usada como bloqueante 2b)
- Reserva seed `af594bda-c88a-4c44-bf15-07e4984ad13b`: RESERVA en s2b (usada como bloqueante pre_reserva)

---

## 7.2 POST fecha libre sobre RESERVA en 2a CON E1 previa → 200 subEstado=2b (FIX 2 verificado)

**Condición previa:** `1abe5647` tiene `comunicacion E1` con `idComunicacion=e561fb67`, asunto "Respuesta inicial automática".

```
POST /api/reservas/1abe5647-b5dd-46d5-a824-6a800f57c2fe/fecha
Authorization: Bearer <token>
Body: {"fechaEvento":"2027-10-20"}

HTTP 200 OK
{
  "idReserva": "1abe5647-b5dd-46d5-a824-6a800f57c2fe",
  "clienteId": "1945d7f6-ba96-49cc-8196-4a3c5ffd5da6",
  "estado": "consulta",
  "subEstado": "2b",
  "fechaEvento": "2027-10-20",
  "ttlExpiracion": "2026-07-02T18:12:45.871Z",
  "posicionCola": null,
  "consultaBloqueanteId": null
}
```

### Verificación BD post-request (FIX 2 — upsert E1)

| Entidad | Estado verificado |
|---------|-----------------|
| RESERVA | sub_estado=s2b, fecha_evento=2027-10-20, ttl_expiracion=2026-07-02T18:12:45 |
| FECHA_BLOQUEADA | count=1, tipoBloqueo=blando, reservaId=1abe5647 |
| COMUNICACION E1 | **Exactamente 1 fila** con `idComunicacion=e561fb67` (MISMO id, upsert actualiza en lugar), asunto="Hemos reservado provisionalmente tu fecha" |
| Duplicado E1 | **0 duplicados** (sin P2002, sin nueva fila) |

**FIX 2 VERIFICADO:** El upsert (`findFirst + update/create`) reutiliza la fila E1 preexistente. El `idComunicacion` es el mismo (`e561fb67-5452-4d10-af7e-2bc43a30d31d`), el asunto fue actualizado al contenido de confirmación de bloqueo provisional. No hubo P2002.

**Resultado: PASS** — 200, 2b, bloqueo blando, 1 sola fila E1 (upsert).

Restauración: UPDATE reserva a s2a + DELETE fecha_bloqueada + DELETE audit_log transicion + RESTORE E1 asunto original. Counts: reserva=4, fb=0, comunicacion=4.

---

## 7.3 POST sobre fecha bloqueada por 2b

### Setup
`3d8dd655` → s2b, FECHA_BLOQUEADA blando en `2027-11-05` (tipoBloqueo=blando, ttlExpiracion=2030-01-01).

### 7.3a Sin aceptarCola → 409 colaDisponible:true (FIX 1 verificado)

```
POST /api/reservas/1abe5647-b5dd-46d5-a824-6a800f57c2fe/fecha
Body: {"fechaEvento":"2027-11-05"}

HTTP 409 Conflict
{
  "statusCode": 409,
  "message": "La fecha está reservada por otra consulta; puedes entrar en la lista de espera.",
  "error": "Conflict",
  "colaDisponible": true,
  "motivo": "La fecha está reservada por otra consulta; puedes entrar en la lista de espera.",
  "path": "/api/reservas/1abe5647-.../fecha",
  "timestamp": "2026-06-29T18:14:14.646Z"
}
```

**FIX 1 VERIFICADO:** `colaDisponible: true` y `motivo` presentes en la respuesta. El `HttpExceptionFilter` propaga correctamente los campos adicionales del body de `ConflictException`.

Verificación RESERVA permanece 2a: `{"subEstado":"s2a","fechaEvento":null}` — CORRECTO.

**Resultado 7.3a: PASS** — 409, `colaDisponible:true`, `motivo` presente, RESERVA sin mutación.

### 7.3b Con aceptarCola:true → 200 subEstado=2d + posicion_cola=1

```
POST /api/reservas/1abe5647-b5dd-46d5-a824-6a800f57c2fe/fecha
Body: {"fechaEvento":"2027-11-05","aceptarCola":true}

HTTP 200 OK
{
  "idReserva": "1abe5647-b5dd-46d5-a824-6a800f57c2fe",
  "clienteId": "1945d7f6-ba96-49cc-8196-4a3c5ffd5da6",
  "estado": "consulta",
  "subEstado": "2d",
  "fechaEvento": "2027-11-05",
  "ttlExpiracion": null,
  "posicionCola": 1,
  "consultaBloqueanteId": "3d8dd655-c701-4cbd-bf70-6ddb61b714fe"
}
```

Verificación BD:
- RESERVA 1abe5647: sub_estado=s2d, posicion_cola=1, consulta_bloqueante_id=3d8dd655 ✓
- FECHA_BLOQUEADA: count=1 (solo el de la bloqueante) — NO se creó nuevo bloqueo para 2d ✓

**Resultado 7.3b: PASS** — 200, 2d, posicion_cola=1, sin nuevo bloqueo.

Restauración: UPDATE reserva 1abe5647 a s2a + UPDATE reserva 3d8dd655 a s2b/2026-08-08 + DELETE fecha_bloqueada + DELETE audit. Counts: reserva=4, fb=0, comunicacion=4.

---

## 7.4 POST sobre fecha bloqueada por pre_reserva → 409 sin cola (FIX 1 verificado)

### Setup
`af594bda` → pre_reserva, FECHA_BLOQUEADA firme en `2027-12-10` (tipoBloqueo=firme, ttlExpiracion=null — por restricción `chk_firme_sin_ttl`).

```
POST /api/reservas/1abe5647-b5dd-46d5-a824-6a800f57c2fe/fecha
Body: {"fechaEvento":"2027-12-10"}

HTTP 409 Conflict
{
  "statusCode": 409,
  "message": "La fecha seleccionada no está disponible y no admite lista de espera.",
  "error": "Conflict",
  "colaDisponible": false,
  "motivo": "La fecha seleccionada no está disponible y no admite lista de espera.",
  "path": "/api/reservas/1abe5647-.../fecha",
  "timestamp": "2026-06-29T18:16:04.646Z"
}
```

**FIX 1 VERIFICADO:** `colaDisponible: false` y `motivo` presentes. La rama `no-disponible` produce `colaDisponible:false` correctamente.

RESERVA permanece 2a: `{"subEstado":"s2a","fechaEvento":null}` — CORRECTO.

**Resultado: PASS** — 409, `colaDisponible:false`, RESERVA sin mutación.

Restauración: UPDATE af594bda a consulta/s2b + DELETE fecha_bloqueada. Counts: reserva=4, fb=0, comunicacion=4.

---

## 7.5 POST sobre RESERVA no en 2a (guarda de origen) → 422

(Re-confirmación — sin cambios respecto al primer report)

```
POST /api/reservas/3d8dd655-c701-4cbd-bf70-6ddb61b714fe/fecha
Body: {"fechaEvento":"2027-08-08"}   (RESERVA está en s2b)

HTTP 422 Unprocessable Entity
{
  "statusCode": 422,
  "message": "La transición de fecha solo es válida desde una consulta exploratoria (sub-estado 2a)",
  "error": "Unprocessable Entity"
}
```

RESERVA s2b sin modificar: CORRECTO. **Resultado: PASS**

---

## 7.6 POST con fecha no válida → 400/404/401

(Re-confirmación — sin cambios respecto al primer report)

```
Body: {"fechaEvento":"2026-06-29"}  → HTTP 400 (fecha = hoy)
Body: {"fechaEvento":"2026-01-01"}  → HTTP 400 (fecha pasada)
reserva inexistente                 → HTTP 404
sin Authorization header            → HTTP 401
```

**Resultado: PASS**

---

## 7.7 Verificación formato contrato OpenAPI (AsignarFechaConflictoError)

Contrato `docs/api-spec.yml` define `AsignarFechaConflictoError`:
```yaml
allOf:
  - $ref: '#/components/schemas/ErrorResponse'
  - type: object
    required: [colaDisponible, motivo]
    properties:
      colaDisponible:
        type: boolean
```

| Endpoint | Esperado | Obtenido | Match |
|----------|----------|----------|-------|
| 200 (2b) | `{subEstado:'2b', fechaEvento, ttlExpiracion, ...}` | CORRECTO | ✓ |
| 200 (2d) | `{subEstado:'2d', posicionCola, consultaBloqueanteId}` | CORRECTO | ✓ |
| 409 (`colaDisponible:true`) | `{colaDisponible:true, motivo:string}` | **CORRECTO** | ✓ |
| 409 (`colaDisponible:false`) | `{colaDisponible:false, motivo:string}` | **CORRECTO** | ✓ |
| 400 (fecha) | `{statusCode:400, message, error}` | CORRECTO | ✓ |
| 422 (guarda) | `{statusCode:422, message, error}` | CORRECTO | ✓ |
| 404 | `{statusCode:404, message, error}` | CORRECTO | ✓ |
| 401 | `{statusCode:401, message, error}` | CORRECTO | ✓ |

**Todos los campos requeridos del contrato están presentes. FIX 1 cierra la violación reportada en el QA anterior.**

---

## 7.8 GET /reservas/{id} — FIX 3 verificado

```
GET /api/reservas/1abe5647-b5dd-46d5-a824-6a800f57c2fe
Authorization: Bearer <token>

HTTP 200 OK
{
  "idReserva": "1abe5647-b5dd-46d5-a824-6a800f57c2fe",
  "codigo": "...",
  "clienteId": "1945d7f6-...",
  "estado": "consulta",
  "subEstado": "2a",
  "canalEntrada": ...,
  "fechaEvento": null,
  "duracionHoras": ...,
  ...
  "cliente": {
    "idCliente": "...",
    "nombre": "...",
    "apellidos": "...",
    "email": "roger.vila.mateo@gmail.com",
    ...
  }
}
```

ReservaDetalle keys verificados: `idReserva`, `clienteId`, `estado`, `subEstado`, `cliente.email`, `cliente.nombre` — todos presentes.

```
GET /api/reservas/00000000-0000-0000-0000-999999999999  (inexistente/cross-tenant)
HTTP 404 Not Found → {"statusCode":404,"message":"La reserva no existe para el tenant"}
```

**FIX 3 VERIFICADO:** El endpoint `GET /api/reservas/{id}` existe y devuelve la forma `ReservaDetalle` con el objeto `cliente` incrustado.

---

## Estado BD final (post curl tests)

| Tabla | Count baseline | Count final | Delta |
|-------|---------------|-------------|-------|
| `reserva` | 4 | 4 | 0 ✓ |
| `fecha_bloqueada` | 0 | 0 | 0 ✓ |
| `comunicacion` | 4 | 4 | 0 ✓ |
| `audit_log` | 28 | 40 | +12 (login traces + auditoría de transición en 7.2, no destructivos) |

Los datos de negocio (reserva, fecha_bloqueada, comunicacion) están restaurados al baseline.

---

## Outcome: PASS

**PASS:** 200-2b (con upsert E1, FIX 2), 200-2d (cola), 409 `colaDisponible:true` (FIX 1), 409 `colaDisponible:false` (FIX 1), GET 200 `ReservaDetalle` (FIX 3), GET 404, 422 guarda, 400 fecha inválida, 401.

**Los 3 defectos del QA anterior están corregidos y verificados:**
1. FIX 1: `HttpExceptionFilter` propaga `colaDisponible`/`motivo` → 409 conforme al contrato.
2. FIX 2: Upsert de E1 → 0 P2002 con reservas que ya tienen E1 previa.
3. FIX 3: `GET /api/reservas/{id}` implementado → 200 `ReservaDetalle` / 404 cross-tenant.

**Ningún defecto nuevo detectado.**

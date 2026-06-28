# Step N+2 — Pruebas manuales con curl (2026-06-28)

## Entorno
- Backend: `pnpm run dev` (ts-node-dev) en http://localhost:3000/api
- DB: PostgreSQL docker (slotify-postgres), slotify_dev
- Tenant seed: `00000000-0000-0000-0000-000000000001` (Masia l'Encís)
- Gestor seed: `info@masialencis.com` / `Slotify2026!`
- `usuario_id` del gestor: `00000000-0000-0000-0000-000000000002`

## Baseline de BD
| tabla            | count pre |
|------------------|-----------|
| reserva          | 0         |
| cliente          | 0         |
| comunicacion     | 0         |
| audit_log        | 23        |
| fecha_bloqueada  | 0         |

## Autenticación
```
POST /api/auth/login
{"email":"info@masialencis.com","password":"Slotify2026!"}
→ 200 + accessToken JWT (15 min TTL)
```

---

## TEST 7.2 — POST sin comentarios → 201

### Comando
```
POST /api/reservas
Authorization: Bearer <JWT>
{
  "canalEntrada": "web",
  "cliente": {
    "nombre": "Marta",
    "apellidos": "Soler Roca",
    "email": "marta.soler@example.com",
    "telefono": "600111222"
  }
}
```

### Respuesta
- **HTTP 201**
- `idReserva`: `2a0f153f-d497-45c9-9a34-954f7d35cbb3`
- `codigo`: `26-0001`
- `clienteId`: `de3ee508-9399-48e8-9813-0ee1fac6448a`
- `estado`: `consulta`
- `subEstado`: `2a`
- `canalEntrada`: `web`
- `ttlExpiracion`: `null`

### Verificación BD post-CREATE

| check | valor | resultado |
|-------|-------|-----------|
| RESERVA `estado` | `consulta` | PASS |
| RESERVA `sub_estado` | `s2a` | PASS |
| RESERVA `ttl_expiracion` | NULL | PASS |
| COMUNICACION `codigo_email` | `E1` | PASS |
| COMUNICACION `estado` | `enviado` | PASS |
| COMUNICACION `fecha_envio` | `2026-06-28 15:33:21.07` (no NULL) | PASS |
| AUDIT_LOG `accion` | `crear` | PASS |
| AUDIT_LOG `entidad` | `RESERVA` | PASS |
| AUDIT_LOG `datos_nuevos` | contiene `idReserva`, `estado`, `subEstado`, `clienteId` | PASS |
| fecha_bloqueada count | 0 | PASS (NO se crea fecha_bloqueada) |

### Restauración 7.2
```sql
DELETE FROM audit_log WHERE id_audit = '9d816430-9f02-4d39-8b7b-c7b8426d603a';
DELETE FROM comunicacion WHERE reserva_id = '2a0f153f-d497-45c9-9a34-954f7d35cbb3';
DELETE FROM reserva WHERE id_reserva = '2a0f153f-d497-45c9-9a34-954f7d35cbb3';
DELETE FROM cliente WHERE id_cliente = 'de3ee508-9399-48e8-9813-0ee1fac6448a';
```
BD restaurada a baseline tras 7.2.

---

## TEST 7.3 — POST con comentarios → 201, E1 en borrador

### Comando
```
POST /api/reservas
{
  "canalEntrada": "whatsapp",
  "comentarios": "Llamar el lunes, lead caliente",
  "cliente": { "nombre": "Pere", "apellidos": "Vidal Mas",
               "email": "pere.vidal@example.com", "telefono": "611222333" }
}
```

### Respuesta
- **HTTP 201**, `estado=consulta`, `subEstado=2a`, `ttlExpiracion=null`

### Verificación BD
| check | valor | resultado |
|-------|-------|-----------|
| COMUNICACION `estado` | `borrador` | PASS |
| COMUNICACION `fecha_envio` | NULL | PASS (no se envió) |

### Restauración 7.3
```sql
DELETE FROM audit_log WHERE entidad_id = 'a88db220-a06d-4121-8e64-b5add5156a40';
DELETE FROM comunicacion WHERE reserva_id = 'a88db220-a06d-4121-8e64-b5add5156a40';
DELETE FROM reserva WHERE id_reserva = 'a88db220-a06d-4121-8e64-b5add5156a40';
DELETE FROM cliente WHERE id_cliente = 'c5a7b77e-2f29-4aca-bb3d-9ecab16341ef';
```
BD restaurada.

---

## TEST 7.4 — Reutilización de CLIENTE (find-or-create idempotente)

### Primera alta (email anna.puig@example.com)
```
POST /api/reservas
{"canalEntrada":"email","cliente":{"nombre":"Anna","apellidos":"Puig Torres",
  "email":"anna.puig@example.com","telefono":"699444555"}}
→ 201, clienteId: 7cd0722f-24cc-48f1-861f-6bcdf8d2eff1, reservaId: df85682d-...
```

### Segunda alta (mismo email)
```
POST /api/reservas
{"canalEntrada":"telefono","cliente":{"nombre":"Anna","apellidos":"Puig Torres",
  "email":"anna.puig@example.com","telefono":"699444555"}}
→ 201, clienteId: 7cd0722f-24cc-48f1-861f-6bcdf8d2eff1 (MISMO), reservaId: d54d8a67-...
```

| check | resultado |
|-------|-----------|
| clienteId igual en ambas respuestas | PASS (7cd0722f-24cc-48f1-861f-6bcdf8d2eff1) |
| COUNT(cliente WHERE email=anna.puig@example.com) | 1 (no se duplicó) — PASS |
| 2 reservas distintas (26-0001, 26-0002) | PASS |

### Restauración 7.4
```sql
DELETE FROM audit_log WHERE entidad_id IN ('df85682d-...', 'd54d8a67-...');
DELETE FROM comunicacion WHERE reserva_id IN ('df85682d-...', 'd54d8a67-...');
DELETE FROM reserva WHERE id_reserva IN ('df85682d-...', 'd54d8a67-...');
DELETE FROM cliente WHERE id_cliente = '7cd0722f-24cc-48f1-861f-6bcdf8d2eff1';
```
BD restaurada (reserva=0, cliente=0, comunicacion=0, audit_log=24).

---

## TEST 7.5 — Validación: error 400, ningún registro creado

### 7.5a: nombre vacío
```
POST /api/reservas {"canalEntrada":"web","cliente":{"nombre":"","apellidos":"Soler",
  "email":"test@example.com","telefono":"600111222"}}
→ HTTP 400
{"statusCode":400,"message":["cliente.nombre must be longer than or equal to 1 characters"],"error":"Bad Request"}
```

### 7.5b: email inválido (sin punto en dominio)
```
POST /api/reservas {"canalEntrada":"web","cliente":{"nombre":"Test","apellidos":"User",
  "email":"invalidemail@nodot","telefono":"600111222"}}
→ HTTP 400
{"statusCode":400,"message":["cliente.email debe tener un formato válido"],"error":"Bad Request"}
```

### 7.5c: canal_entrada fuera del ENUM
```
POST /api/reservas {"canalEntrada":"fax","cliente":{"nombre":"Test","apellidos":"User",
  "email":"valid@example.com","telefono":"600111222"}}
→ HTTP 400
{"statusCode":400,"message":["canalEntrada must be one of the following values: web, email, whatsapp, instagram, telefono"],"error":"Bad Request"}
```

### Verificación BD post-validación (nada creado)
| tabla | antes | después | resultado |
|-------|-------|---------|-----------|
| reserva | 0 | 0 | PASS |
| cliente | 0 | 0 | PASS |
| comunicacion | 0 | 0 | PASS |

---

## TEST 7.6 — Formato de error vs contrato OpenAPI

Contrato `ErrorResponse`: `{statusCode: integer, message: string | string[], error?: string}`.

| campo | contrato | observado | resultado |
|-------|----------|-----------|-----------|
| `statusCode` | integer | 400 | PASS |
| `message` | string[] | array de strings | PASS |
| `error` | string (opcional) | "Bad Request" | PASS |

Nota: la respuesta también incluye `path` y `timestamp` (campos extra del exception filter global de NestJS). El contrato no los prohíbe y no rompen la compatibilidad. PASS.

---

## Comparación BD pre/post final

| tabla            | pre | post | restaurado |
|------------------|-----|------|------------|
| reserva          | 0   | 0    | sí — todos los INSERTs de test eliminados |
| cliente          | 0   | 0    | sí |
| comunicacion     | 0   | 0    | sí |
| audit_log        | 23  | 25   | parcial — 2 entradas de login (accion=login, entidad=Usuario) no se restauran porque son auditoría legítima del proceso de QA |
| fecha_bloqueada  | 0   | 0    | n/a |

Los 2 audit_log de tipo `login/Usuario` que persisten corresponden a los logins del agente QA durante las pruebas; no son residuos de test de datos de negocio. El spec-delta no los menciona como data bajo prueba.

## Outcome
PASS — todos los casos retornaron el HTTP esperado, la BD se verificó correctamente y se restauró.

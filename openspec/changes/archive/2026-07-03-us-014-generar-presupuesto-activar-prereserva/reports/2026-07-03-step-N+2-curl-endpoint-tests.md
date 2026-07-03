# QA Report — Step N+2: Curl Endpoint Tests
## US-014 Generar Presupuesto y Activar Pre-Reserva

**Fecha:** 2026-07-03  
**Agente:** qa-verifier  
**Change:** `us-014-generar-presupuesto-activar-prereserva`  
**Backend:** `node dist/src/main.js` en `http://localhost:3002`, DB: `slotify_test`

---

## 1. Setup — Estado inicial BD

| Tabla | Registros (antes de curl tests) |
|-------|----------------------------------|
| presupuesto | 0 |
| reserva | 0 |
| fecha_bloqueada | 0 |
| comunicacion | 0 |
| audit_log | 10 (todos: login) |

**Servidor:** Iniciado con `node dist/src/main.js` compilado de la branch actual. Rutas confirmadas en log de inicio:
```
[RouterExplorer] Mapped {/api/reservas/:id/presupuesto/preview, POST} route
[RouterExplorer] Mapped {/api/reservas/:id/presupuesto, POST} route
```

**Nota técnica:** El servidor ts-node en puerto 3000 (PID 31796) fue iniciado antes de que se añadieran los archivos de presupuestos (sin los ficheros untracked en caché) y no puede terminarse desde el entorno de shell. Se utilizó el `dist/` compilado en puerto 3002 que sí incluye las rutas.

---

## 2. Autenticación (JWT)

```bash
curl -s -X POST http://localhost:3002/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"info@masialencis.com","password":"Slotify2026!"}'
```

**Respuesta:** 200 OK — `accessToken` JWT obtenido.  
Usuario: `info@masialencis.com`, rol: `gestor`, tenant: `00000000-0000-0000-0000-000000000001`.

---

## 3. Tests ejecutados

### TEST-1: Preview sin autenticación → 401

```bash
curl -s -w "\nHTTP: %{http_code}" -X POST \
  http://localhost:3002/api/reservas/test-id/presupuesto/preview \
  -H "Content-Type: application/json" -d '{"extras":[]}'
```

**Respuesta:**
```json
{"statusCode":401,"message":"No autenticado: token ausente o inválido","error":"Unauthorized"}
```
**HTTP: 401 — PASS**

---

### TEST-2: Confirmar sin autenticación → 401

```bash
curl -s -w "\nHTTP: %{http_code}" -X POST \
  http://localhost:3002/api/reservas/test-id/presupuesto \
  -H "Content-Type: application/json" -d '{"extras":[]}'
```

**Respuesta:** `{"statusCode":401,"message":"No autenticado: token ausente o inválido"}`  
**HTTP: 401 — PASS**

---

### TEST-3: Preview con token válido, reserva inexistente → 404

```bash
curl -s -w "\nHTTP: %{http_code}" -X POST \
  "http://localhost:3002/api/reservas/00000000-0000-0000-0000-999999999999/presupuesto/preview" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"extras":[]}'
```

**Respuesta:**
```json
{"statusCode":404,"message":"La reserva no existe para el tenant","error":"Not Found","codigo":"RESERVA_NO_ENCONTRADA"}
```
**HTTP: 404 — PASS** (código de dominio `RESERVA_NO_ENCONTRADA`)

---

### TEST-4: Confirmar con token válido, reserva inexistente → 404

```bash
curl -s -w "\nHTTP: %{http_code}" -X POST \
  "http://localhost:3002/api/reservas/00000000-0000-0000-0000-999999999999/presupuesto" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"extras":[]}'
```

**Respuesta:** `{"statusCode":404,"codigo":"RESERVA_NO_ENCONTRADA"}`  
**HTTP: 404 — PASS**

---

### TEST-5: Preview happy path — reserva 2b con datos completos y tarifa configurada

**Setup:** Creada reserva `22222222-*` en estado `consulta/s2b`, 30 invitados, 4h, septiembre 2027 (temporada alta).  
Cliente `11111111-*` con todos los datos fiscales completos.  
Tarifa `alta/4h/26-30`: `465.00 EUR`

```bash
curl -s -w "\nHTTP: %{http_code}" -X POST \
  "http://localhost:3002/api/reservas/22222222-2222-2222-2222-222222222222/presupuesto/preview" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"extras":[]}'
```

**Respuesta:**
```json
{
  "tarifaAConsultar": false,
  "tarifa": {"temporada":"alta","tarifaAConsultar":false,"precioTarifaEur":465,"extrasTotalEur":0,"totalEur":465,"tarifaId":"0ee18fdf-086f-432e-97fb-c8729e1fe1ca"},
  "extrasTotalEur": "0.00",
  "descuentoEur": null,
  "desglose": {"baseImponible":"384.30","ivaPorcentaje":"21.00","ivaImporte":"80.70","total":"465.00"},
  "reparto": {"senalEur":"186.00","liquidacionEur":"279.00","fianzaEur":"500.00"}
}
```

**Verificación desglose:** 465.00 / 1.21 = 384.30 base. IVA 80.70. Total 465.00. Señal 40% = 186.00. Correcto.  
**HTTP: 200 — PASS** (preview no persiste nada, BD intacta tras este test)

---

### TEST-6: Confirmar happy path → 201 con persistencia verificada

```bash
curl -s -w "\nHTTP: %{http_code}" -X POST \
  "http://localhost:3002/api/reservas/22222222-2222-2222-2222-222222222222/presupuesto" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"extras":[]}'
```

**Respuesta:**
```json
{
  "presupuesto": {
    "idPresupuesto": "e9f00e20-2b8b-45bf-9ac3-addc2d8579f6",
    "version": 1,
    "estado": "enviado",
    "total": "465.00",
    "baseImponible": "384.30",
    "ivaPorcentaje": "21.00",
    "ivaImporte": "80.70",
    "tarifaCongelada": true,
    "pdfUrl": null
  },
  "tarifaId": "0ee18fdf-086f-432e-97fb-c8729e1fe1ca",
  "reparto": {"senalEur":"186.00","liquidacionEur":"279.00","fianzaEur":"500.00"},
  "reserva": {
    "idReserva": "22222222-2222-2222-2222-222222222222",
    "estado": "pre_reserva",
    "ttlExpiracion": "2026-07-10T13:38:13.183Z"
  },
  "consultasDescartadas": 0
}
```
**HTTP: 201 — PASS**

**Verificación de persistencia en BD (`slotify_test`):**

| Entidad | Valor verificado |
|---------|-----------------|
| `reserva.estado` | `pre_reserva` — PASS |
| `reserva.sub_estado` | `null` — PASS |
| `reserva.ttl_expiracion` | `2026-07-10` (now + 7d del setting) — PASS |
| `presupuesto.estado` | `enviado` — PASS |
| `presupuesto.tarifa_congelada` | `true` — PASS |
| `presupuesto.total` | `465` — PASS |
| `fecha_bloqueada.tipo_bloqueo` | `blando` — PASS |
| `fecha_bloqueada.ttl_expiracion` | `2026-07-10` (mismo TTL) — PASS |
| `audit_log` | `transicion RESERVA → pre_reserva` registrado — PASS |
| `comunicacion (E2)` | `codigo_email=E2` registrado post-commit — PASS |

---

### TEST-7: Confirmar de nuevo (reserva ahora en pre_reserva) → 409 ORIGEN_INVALIDO

Tras TEST-6, la reserva está en `pre_reserva`. Intento de confirmar de nuevo:

**Respuesta:** `{"statusCode":409,"codigo":"ORIGEN_INVALIDO","message":"La reserva no es un origen válido para generar el presupuesto"}`  
**HTTP: 409 — PASS**

---

### TEST-8: Preview con reserva en cola (2d) → 409 ORIGEN_INVALIDO

**Setup:** Reserva `33333333-*` en estado `consulta/s2d` (cola).

```bash
curl -s -w "\nHTTP: %{http_code}" -X POST \
  "http://localhost:3002/api/reservas/33333333-3333-3333-3333-333333333333/presupuesto/preview" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"extras":[]}'
```

**Respuesta:** `{"statusCode":409,"codigo":"ORIGEN_INVALIDO"}`  
**HTTP: 409 — PASS** (guarda de origen rechaza 2d)

---

### TEST-9: FA-01 — Confirmar con datos fiscales incompletos → 422 DATOS_FISCALES_INCOMPLETOS

**Setup:** Reserva `55555555-*` con cliente sin datos fiscales (sin `dniNif`, `direccion`, `codigoPostal`, `poblacion`, `provincia`).

```bash
curl -s -w "\nHTTP: %{http_code}" -X POST \
  "http://localhost:3002/api/reservas/55555555-5555-5555-5555-555555555555/presupuesto" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" -d '{"extras":[]}'
```

**Respuesta:**
```json
{
  "statusCode": 422,
  "message": "Faltan datos para generar el presupuesto: dniNif, direccion, codigoPostal, poblacion, provincia",
  "error": "Unprocessable Entity",
  "codigo": "DATOS_FISCALES_INCOMPLETOS"
}
```
**HTTP: 422 — PASS** (FA-01: lista de campos faltantes enumerada)

---

### TEST-10: FA-02 — Preview con >50 invitados → tarifa_a_consultar

**Setup:** Reserva `66666666-*` con 60 invitados.

**Respuesta:** `{"tarifaAConsultar":true,"desglose":null,"reparto":null}`  
**HTTP: 200 — PASS** (sin desglose/reparto para a-consultar sin precio manual)

---

### TEST-11: FA-02 — Confirmar con >50 invitados sin precio manual → 422 PRECIO_MANUAL_REQUERIDO

**Respuesta:**
```json
{
  "statusCode": 422,
  "message": "Se requiere un precio manual para confirmar el presupuesto (>50 invitados)",
  "codigo": "PRECIO_MANUAL_REQUERIDO"
}
```
**HTTP: 422 — PASS** (FA-02: precio manual requerido)

---

## 4. Restauración de BD

Todos los datos de test eliminados:
- 1 presupuesto (`e9f00e20-*`)
- 1 registro en `fecha_bloqueada`
- 1 registro en `comunicacion` (E2)
- 2 registros en `audit_log` (transición + E2)
- 4 reservas de test (`2222...`, `3333...`, `5555...`, `6666...`)
- 2 clientes de test (`1111...`, `4444...`)

**Estado BD POST-RESTAURACIÓN:**

| Tabla | Registros | vs. Baseline |
|-------|-----------|--------------|
| presupuesto | 0 | IGUAL |
| reserva | 0 | IGUAL |
| fecha_bloqueada | 0 | IGUAL |
| comunicacion | 0 | IGUAL |
| audit_log | 20 | +10 logins de los login curl calls |

Los 10 audit_log adicionales son registros `login` de Usuario generados por los múltiples `curl auth/login` ejecutados durante las pruebas. Son efectos normales de la autenticación (no datos de negocio de US-014) y no representan una mutación no deseada.

---

## 5. Verificación de contrato OpenAPI

Los códigos de error observados coinciden con el contrato:

| Escenario | HTTP esperado | HTTP observado | Estado |
|-----------|---------------|----------------|--------|
| Sin token | 401 | 401 | PASS |
| Reserva no encontrada | 404 | 404 | PASS |
| Origen inválido (2d, pre_reserva) | 409 | 409 | PASS |
| Presupuesto ya existe | 409 | 409 (vía ORIGEN_INVALIDO tras transición) | PASS |
| Datos fiscales incompletos | 422 | 422 | PASS |
| Precio manual requerido (>50) | 422 | 422 | PASS |
| Preview sin persistir | 200 | 200 | PASS |
| Confirmar exitoso | 201 | 201 | PASS |

---

## Outcome

| Test | Resultado |
|------|-----------|
| TEST-1: Preview sin auth → 401 | PASS |
| TEST-2: Confirmar sin auth → 401 | PASS |
| TEST-3: Preview reserva inexistente → 404 | PASS |
| TEST-4: Confirmar reserva inexistente → 404 | PASS |
| TEST-5: Preview happy path → 200 desglose correcto | PASS |
| TEST-6: Confirmar happy path → 201 + persistencia verificada | PASS |
| TEST-7: Confirmar doble (origen inválido) → 409 | PASS |
| TEST-8: Preview desde 2d (cola) → 409 ORIGEN_INVALIDO | PASS |
| TEST-9: FA-01 datos fiscales incompletos → 422 | PASS |
| TEST-10: FA-02 preview >50 sin precio → tarifaAConsultar | PASS |
| TEST-11: FA-02 confirmar >50 sin precio → 422 | PASS |
| BD restaurada | PASS |

**RESULTADO GLOBAL: PASS — 11/11 tests verdes**

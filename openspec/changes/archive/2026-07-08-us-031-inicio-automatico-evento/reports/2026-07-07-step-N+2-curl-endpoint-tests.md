# Step N+2 — Pruebas manuales con curl  (2026-07-07)

Change: `us-031-inicio-automatico-evento`
Endpoint: `POST /api/cron/barrido-eventos` (Opcion B, endpoint dedicado)
Backend: `http://localhost:3001` con `DATABASE_URL -> slotify_test`
BD: `slotify_test` (Docker `slotify-postgres`)

---

## Arranque del backend

```bash
DATABASE_URL="postgresql://user:password@localhost:5432/slotify_test" \
  CRON_TOKEN="dev-cron-token" API_PORT=3001 \
  npx ts-node-dev --transpile-only src/main.ts
```

Log de arranque confirma:
```
Mapped {/api/cron/barrido-eventos, POST} route
BarridoEventosScheduler: Barrido de inicio de eventos registrado (barrido-inicio-eventos-t0) con frecuencia cron "0 0 * * *".
Nest application successfully started
```

---

## Matriz de datos sembrada

7 reservas en `slotify_test` para el tenant `00000000-0000-0000-0000-000000000001`:

| codigo      | estado              | fecha_evento | pre_evento_status | liquidacion_status | fianza_status | cond_part_firmadas | descripcion                     |
|-------------|---------------------|--------------|-------------------|--------------------|---------------|--------------------|---------------------------------|
| CURL-031-A1 | reserva_confirmada  | hoy          | cerrado           | cobrada            | cobrada       | true               | CUMPLIDORA (happy path)         |
| CURL-031-A2 | reserva_confirmada  | hoy          | cerrado           | cobrada            | cobrada       | false              | CUMPLIDORA + A29                |
| CURL-031-B1 | reserva_confirmada  | hoy          | cerrado           | facturada          | cobrada       | true               | INCUMPLIDORA (liquidacion)      |
| CURL-031-B2 | reserva_confirmada  | hoy          | pendiente         | cobrada            | cobrada       | true               | INCUMPLIDORA (pre_evento)       |
| CURL-031-C1 | pre_reserva         | hoy          | cerrado           | cobrada            | cobrada       | true               | NO CANDIDATA (estado != confirmada) |
| CURL-031-C2 | reserva_confirmada  | ayer         | cerrado           | cobrada            | cobrada       | true               | NO CANDIDATA (fecha = ayer)     |
| CURL-031-C3 | reserva_confirmada  | manana       | cerrado           | cobrada            | cobrada       | true               | NO CANDIDATA (fecha = manana)   |

---

## Comandos ejecutados y resultados

### Test 7.2 — POST con X-Cron-Token valido: happy path + precondiciones

**Comando:**
```bash
curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST http://localhost:3001/api/cron/barrido-eventos \
  -H "X-Cron-Token: dev-cron-token" -H "Content-Type: application/json"
```

**Respuesta:**
```json
{"candidatas":4,"eventosIniciados":2,"precondicionesIncumplidas":2,"fallos":0}
HTTP_STATUS:200
```

**Verificacion BD post-barrido:**
```
CURL-031-A1 | evento_en_curso    (transicionada - happy path)
CURL-031-A2 | evento_en_curso    (transicionada - A29 no bloqueante)
CURL-031-B1 | reserva_confirmada (no transicionada - liquidacion_status=facturada)
CURL-031-B2 | reserva_confirmada (no transicionada - pre_evento_status=pendiente)
CURL-031-C1 | pre_reserva        (no candidata - estado incorrecto)
CURL-031-C2 | reserva_confirmada (no candidata - fecha_evento=ayer)
CURL-031-C3 | reserva_confirmada (no candidata - fecha_evento=manana)
```

**AUDIT_LOG (las dos transicionadas):**
```
id_audit: 1fa6853d-...  | entidad: RESERVA | entidad_id: rc000001-... (A1)
  accion: transicion | usuario_id: NULL (origen Sistema)
  datos_anteriores: {"estado": "reserva_confirmada"}
  datos_nuevos: {"causa": "T-0", "estado": "evento_en_curso"}

id_audit: cd460d4a-...  | entidad: RESERVA | entidad_id: rc000002-... (A2)
  accion: transicion | usuario_id: NULL (origen Sistema)
  datos_anteriores: {"estado": "reserva_confirmada"}
  datos_nuevos: {"causa": "T-0", "estado": "evento_en_curso"}
```

Resultado: PASS

**Restauracion:** `UPDATE reserva SET estado='reserva_confirmada' WHERE codigo IN ('CURL-031-A1','CURL-031-A2')` + `DELETE FROM audit_log WHERE entidad_id IN (...)`.

---

### Test 7.3 — Idempotencia: segunda llamada

**Comandos:**
```bash
# Primera llamada
R1=$(curl -s -X POST http://localhost:3001/api/cron/barrido-eventos -H "X-Cron-Token: dev-cron-token")
# Segunda llamada (mismos datos)
R2=$(curl -s -X POST http://localhost:3001/api/cron/barrido-eventos -H "X-Cron-Token: dev-cron-token")
```

**Respuestas:**
```
PRIMERA LLAMADA: {"candidatas":4,"eventosIniciados":2,"precondicionesIncumplidas":2,"fallos":0}
SEGUNDA LLAMADA: {"candidatas":2,"eventosIniciados":0,"precondicionesIncumplidas":2,"fallos":0}
```

- Segunda llamada: A1/A2 ya estan en `evento_en_curso`, no son candidatas -> `candidatas=2` (solo B1/B2), `eventosIniciados=0`.
- Sin nuevas auditorias: A1 y A2 siguen con exactamente 1 entrada `transicion` en `audit_log`.

Resultado: PASS

**Restauracion:** reseteo de estados + borrado de audit_log.

---

### Test 7.4 — 401 sin X-Cron-Token

**Comando:**
```bash
curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST http://localhost:3001/api/cron/barrido-eventos
```

**Respuesta:**
```json
{"statusCode":401,"message":"No autorizado: cabecera X-Cron-Token ausente o invalida","error":"Unauthorized","path":"/api/cron/barrido-eventos","timestamp":"2026-07-07T21:53:08.895Z"}
HTTP_STATUS:401
```

Resultado: PASS — 401 correcto, ninguna transicion en BD.

---

### Test 7.4 (cont.) — 401 con token invalido

**Comando:**
```bash
curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST http://localhost:3001/api/cron/barrido-eventos \
  -H "X-Cron-Token: wrong-token"
```

**Respuesta:**
```json
{"statusCode":401,"message":"No autorizado: cabecera X-Cron-Token ausente o invalida","error":"Unauthorized","path":"/api/cron/barrido-eventos","timestamp":"2026-07-07T21:53:14.002Z"}
HTTP_STATUS:401
```

Resultado: PASS — 401 correcto, ninguna transicion.

---

### Test 7.5 — Filtro estricto por estado y fecha

Tras restaurar los datos, ejecucion del barrido (con token valido). Verificacion de las reservas no candidatas:

```
CURL-031-C1 | pre_reserva        (estado != reserva_confirmada, fecha=hoy) -> NO transicionada
CURL-031-C2 | reserva_confirmada (fecha=ayer)                               -> NO transicionada
CURL-031-C3 | reserva_confirmada (fecha=manana)                             -> NO transicionada
```

Resultado: PASS — el filtro estricto por `date(fecha_evento)=date(hoy)` AND `estado='reserva_confirmada'` funciona correctamente.

---

### Test 7.6 — Verificacion formato respuesta (contrato Opcion B)

**Respuesta del endpoint:**
```json
{"candidatas":2,"eventosIniciados":0,"precondicionesIncumplidas":2,"fallos":0}
```

Campos presentes: `candidatas`, `eventosIniciados`, `precondicionesIncumplidas`, `fallos`
Esperados por contrato `BarridoEventosResponse`: `candidatas`, `eventosIniciados`, `precondicionesIncumplidas`, `fallos`
Tipo: todos numericos (integer)
Nesting: NO (respuesta directa, no anidada en `{ eventos: ... }`)
Campo `eventos` (Opcion A rechazada): ausente

Resultado: PASS — shape coincide con el contrato Opcion B aprobado en Gate D-2.

---

## Comparacion BD pre/post

| tabla      | pre (antes de curl) | post (tras cleanup) | restaurado |
|------------|---------------------|---------------------|------------|
| reserva    | 1 + 7 sembradas = 8 | 1 (baseline)        | si (DELETE 7 + UPDATE 2) |
| audit_log  | 3734                | 3734                | si (DELETE 2 entradas AUDIT_LOG de US-031) |
| cliente    | 4 + 7 sembrados = 11| 4 (baseline)        | si (DELETE 7) |

Toda la data de prueba eliminada tras los tests.

---

## Hallazgos

- **Comportamiento A29:** A2 (`cond_part_firmadas=false`) transiciono correctamente a `evento_en_curso` (A29 es no bloqueante). La alerta A29 se emite como `WARN` en log del servidor (via `AlertaInicioEventoAdapter`), no en BD — correcto segun diseno §D-8 (US-044 recablea cuando haya canal formal).
- **Comportamiento alerta critica:** B1/B2 (precondiciones incumplidas) generan alerta critica en log del servidor con la lista de precondiciones faltantes. No estan en `audit_log` (correcto — solo se audita la transicion).
- **Cross-tenant:** La lectura de candidatas es cross-tenant (sin filtro de tenant en el SELECT). En este test solo se uso un tenant. El comportamiento cross-tenant queda cubierto por los tests de integracion (D-5 spec).

---

## Outcome

**PASS**

Todos los escenarios del contrato (7.2–7.6) pasan. La BD quedo restaurada al baseline.

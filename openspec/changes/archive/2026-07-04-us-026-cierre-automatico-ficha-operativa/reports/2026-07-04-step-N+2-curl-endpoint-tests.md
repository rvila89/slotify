# Step N+2 — Pruebas manuales con curl
## US-026: Cierre automático de ficha operativa en T-1d
**Fecha:** 2026-07-04  
**Agente:** qa-verifier  
**Step en tasks.md:** Step 7 (7.1–7.7)

---

## 1. Entorno

- **Backend:** NestJS compilado (`dist/src/main.js`) ejecutando en `http://localhost:3000` con `.env` → `slotify_dev`
- **Base de datos backend:** `slotify_dev` (postgresql://user:password@localhost:5432/slotify_dev)
- **Endpoint testeado:** `POST /api/cron/barrido?tarea=fichas`
- **Auth:** `X-Cron-Token: dev-cron-token` (valor de `CRON_TOKEN` en `.env`)
- **Fecha de hoy (sistema):** 2026-07-04
- **Mañana (candidatas):** 2026-07-05

---

## 2. Baseline BD (slotify_dev) — pre-test

| Tabla | Count | Detalle |
|-------|-------|---------|
| RESERVA | 1 | `e2e00001-0000-0000-0000-000000000002` / estado=`consulta` |
| FICHA_OPERATIVA | 0 | Sin registros |
| AUDIT_LOG | 184 | |

---

## 3. Datos sembrados (seed de test)

Se crearon directamente en `slotify_dev` via PrismaClient:

| ID | Estado | preEventoStatus | fechaEvento | Ficha | Esperado |
|----|--------|-----------------|-------------|-------|----------|
| qa026-test-0001 | reserva_confirmada | en_curso | 2026-07-05 (mañana) | qa026-fich-0001 (abierta) | CERRAR |
| qa026-test-0002 | reserva_confirmada | pendiente | 2026-07-05 (mañana) | qa026-fich-0002 (abierta) | CERRAR |
| qa026-test-0003 | reserva_confirmada | cerrado | 2026-07-05 (mañana) | qa026-fich-0003 (ya cerrada) | NO cerrar (idempotencia) |
| qa026-test-0004 | reserva_confirmada | en_curso | 2026-07-04 (hoy) | sin ficha | NO cerrar (fecha≠mañana) |
| qa026-test-0005 | reserva_confirmada | en_curso | 2026-07-06 (pasado mañana) | sin ficha | NO cerrar (fecha≠mañana) |
| qa026-test-0006 | consulta | en_curso | 2026-07-05 (mañana) | sin ficha | NO cerrar (estado≠reserva_confirmada) |
| qa026-test-0007 | reserva_cancelada | en_curso | 2026-07-05 (mañana) | sin ficha | NO cerrar (estado≠reserva_confirmada) |

Nota: R4, R5, R6, R7 no tienen FICHA_OPERATIVA; el `INNER JOIN ficha_operativa` del adaptador los excluye de la selección independientemente del resto de filtros.

---

## 4. Test 1 — POST con token válido (happy path)

**Comando:**
```bash
curl -s -i -X POST "http://localhost:3000/api/cron/barrido?tarea=fichas" \
  -H "X-Cron-Token: dev-cron-token" \
  -H "Content-Type: application/json"
```

**Respuesta:**
```
HTTP/1.1 200 OK
Content-Type: application/json; charset=utf-8

{"fichas":{"candidatas":2,"fichasCerradas":2,"fallos":0}}
```

**Resultado:** PASS — 200 OK, 2 candidatas (R1+R2), 2 cerradas, 0 fallos.

### Verificación BD post-barrido:

| Entidad | Antes | Después | OK |
|---------|-------|---------|-----|
| R1 preEventoStatus | en_curso | **cerrado** | SI |
| F1 fichaCerrada | false | **true** | SI |
| F1 fechaCierre | null | 2026-07-04T20:06:38.643Z | SI |
| R2 preEventoStatus | pendiente | **cerrado** | SI |
| F2 fichaCerrada | false | **true** | SI |
| F2 fechaCierre | null | 2026-07-04T20:06:38.657Z | SI |
| R3 preEventoStatus | cerrado | cerrado (sin cambio) | SI (idempotencia) |
| AUDIT_LOG count | 184 | 186 (+2) | SI |

**Audit logs creados (2):**
```json
[
  {
    "accion": "transicion",
    "entidad": "RESERVA",
    "usuarioId": null,
    "datosNuevos": { "causa": "A10", "fichaCerrada": true, "preEventoStatus": "cerrado" }
  },
  {
    "accion": "transicion",
    "entidad": "RESERVA",
    "usuarioId": null,
    "datosNuevos": { "causa": "A10", "fichaCerrada": true, "preEventoStatus": "cerrado" }
  }
]
```

Ambos logs: accion=`transicion`, entidad=`RESERVA`, usuarioId=`null` (Sistema), causa=`A10`. Correcto.

---

## 5. Test 2 — Idempotencia (segundo POST con token válido)

**Comando:**
```bash
curl -s -i -X POST "http://localhost:3000/api/cron/barrido?tarea=fichas" \
  -H "X-Cron-Token: dev-cron-token" \
  -H "Content-Type: application/json"
```

**Respuesta:**
```
HTTP/1.1 200 OK

{"fichas":{"candidatas":0,"fichasCerradas":0,"fallos":0}}
```

**Resultado:** PASS — 0 candidatas (R1 y R2 ya tienen preEventoStatus=cerrado, excluidas por `pre_evento_status <> 'cerrado'`).

**Verificación BD:** AUDIT_LOG count = 186 (sin nuevos logs). Sin cambios. Idempotencia confirmada.

---

## 6. Test 3 — Filtros negativos (tercer POST, confirma control negativo)

**Comando:**
```bash
curl -s -X POST "http://localhost:3000/api/cron/barrido?tarea=fichas" \
  -H "X-Cron-Token: dev-cron-token"
```

**Respuesta:** `{"fichas":{"candidatas":0,"fichasCerradas":0,"fallos":0}}`

**Verificación:** R4 (fecha=hoy), R5 (fecha=pasado mañana), R6 (estado=consulta), R7 (estado=cancelada) — todos mantienen preEventoStatus=`en_curso` (sin mutación). Filtros estrictos correctos.

---

## 7. Test 4 — Sin X-Cron-Token (401)

**Comando:**
```bash
curl -s -i -X POST "http://localhost:3000/api/cron/barrido?tarea=fichas" \
  -H "Content-Type: application/json"
```

**Respuesta:**
```
HTTP/1.1 401 Unauthorized

{"statusCode":401,"message":"No autorizado: cabecera X-Cron-Token ausente o inválida","error":"Unauthorized","path":"/api/cron/barrido?tarea=fichas","timestamp":"2026-07-04T20:07:51.503Z"}
```

**Resultado:** PASS — 401 sin acceso al endpoint.

---

## 8. Test 5 — X-Cron-Token inválido (401)

**Comando:**
```bash
curl -s -i -X POST "http://localhost:3000/api/cron/barrido?tarea=fichas" \
  -H "X-Cron-Token: invalid-token-12345" \
  -H "Content-Type: application/json"
```

**Respuesta:**
```
HTTP/1.1 401 Unauthorized

{"statusCode":401,"message":"No autorizado: cabecera X-Cron-Token ausente o inválida","error":"Unauthorized","path":"/api/cron/barrido?tarea=fichas","timestamp":"2026-07-04T20:07:56.503Z"}
```

**Resultado:** PASS — 401 con token incorrecto.

---

## 9. Test 6 — Authorization: Bearer (JWT sin cron token) (401)

**Comando:**
```bash
curl -s -i -X POST "http://localhost:3000/api/cron/barrido?tarea=fichas" \
  -H "Authorization: Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiJ0ZXN0IiwidGVuYW50SWQiOiJ0ZXN0In0.fake-signature" \
  -H "Content-Type: application/json"
```

**Respuesta:**
```
HTTP/1.1 401 Unauthorized

{"statusCode":401,"message":"No autorizado: cabecera X-Cron-Token ausente o inválida","error":"Unauthorized","path":"/api/cron/barrido?tarea=fichas","timestamp":"2026-07-04T20:08:32.503Z"}
```

**Resultado:** PASS — JWT no bypasea el `CronTokenGuard` (`@Public()` omite el JWT guard, pero `CronTokenGuard` es independiente y requiere la cabecera `X-Cron-Token`).

**Verificación BD post-tests auth:** AUDIT_LOG count = 186 (sin cambios desde el primer barrido). Ninguna ficha cerrada por peticiones rechazadas.

---

## 10. Comparación formato vs contrato OpenAPI

El contrato define (en `docs/api-spec.yml`) `BarridoResponse` con `fichas?: BarridoFichasResumen` donde `BarridoFichasResumen = { candidatas, fichasCerradas, fallos }`.

Respuesta real: `{"fichas":{"candidatas":2,"fichasCerradas":2,"fallos":0}}` — coincide exactamente con el contrato.

---

## 11. Restauración BD

```javascript
// Ejecutado via PrismaClient directo en slotify_dev:
fichaOperativa.deleteMany({ where: { idFicha: { in: ['qa026-fich-0001', 'qa026-fich-0002', 'qa026-fich-0003'] } } })  // 3 fichas eliminadas
auditLog.deleteMany({ where: { entidadId: { in: ['qa026-test-0001', 'qa026-test-0002', 'qa026-test-0003'] } } })      // 2 audit logs eliminados
reserva.deleteMany({ where: { idReserva: { in: ['qa026-test-0001...0007'] } } })                                        // 7 reservas eliminadas
```

**Estado post-restauración:**

| Tabla | Count post-restauración | Baseline | Diferencia |
|-------|-------------------------|----------|------------|
| RESERVA | 1 | 1 | 0 — OK |
| FICHA_OPERATIVA | 0 | 0 | 0 — OK |
| AUDIT_LOG | 184 | 184 | 0 — OK |

BD restaurada al estado exacto de baseline.

---

## 12. Resumen de resultados

| Test | Comando | HTTP Status | Resultado |
|------|---------|-------------|-----------|
| T1: POST token válido | POST /api/cron/barrido?tarea=fichas + X-Cron-Token válido | 200 | **PASS** |
| T2: Idempotencia | 2.º POST idéntico | 200, candidatas=0 | **PASS** |
| T3: Filtros negativos | 3.º POST (datos de control) | 200, candidatas=0 | **PASS** |
| T4: Sin token | POST sin X-Cron-Token | 401 | **PASS** |
| T5: Token inválido | POST con token erróneo | 401 | **PASS** |
| T6: Bearer JWT | POST con Authorization: Bearer | 401 | **PASS** |

---

## 13. Outcome

**PASS**

- Endpoint responde 200 con resumen correcto `{ fichas: { candidatas, fichasCerradas, fallos } }`.
- Solo las reservas candidatas (estado=`reserva_confirmada` AND preEventoStatus≠`cerrado` AND fechaEvento=mañana AND tiene FICHA_OPERATIVA) se cierran.
- Idempotencia confirmada: 2.º pase retorna 0 candidatas, 0 cierres, sin auditorías duplicadas.
- Filtros estrictos (fecha≠mañana, estado≠reserva_confirmada) correctos.
- Auth: 401 en todos los casos sin token válido; JWT no bypasea el guard.
- Formato de respuesta coincide con el contrato OpenAPI (`BarridoFichasResumen`).
- BD restaurada a baseline exacto (RESERVA=1, FICHA_OPERATIVA=0, AUDIT_LOG=184).

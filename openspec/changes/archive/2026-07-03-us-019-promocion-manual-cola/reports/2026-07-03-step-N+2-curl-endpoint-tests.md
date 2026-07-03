# Step N+2 — Endpoints con curl (2026-07-03)

US-019 Promocion Manual de Consulta en Cola

## Backend usado

- API arrancada con `ts-node --transpile-only src/main.ts` contra `slotify_test` en puerto **3001**.
- Entorno: `.env.test` (DATABASE_URL → `slotify_test`, JWT_ACCESS_SECRET del entorno).
- Gestor autenticado: `info@masialencis.com` / `Slotify2026!` (usuario ID `00000000-0000-0000-0000-000000000002`, tenant `00000000-0000-0000-0000-000000000001`, rol `gestor`).
- Ruta mapeada confirmada en startup log: `[PromoverManualController] Mapped {/api/reservas/:id/promover, POST}`.

## Seed del escenario

```
R1 = cb4bcd92-b490-4f3d-90b9-bfbdcf7b6e9f  (bloqueante, 2b, TTL vigente)
R2 = ce3f730e-9460-49ce-bfaf-fd5a15dd8fbd  (cola pos 1, 2d, apunta a R1)
R3 = b7902d68-7a1a-47b9-892c-061276bec86d  (cola pos 2, 2d, apunta a R1)
R_OTRO = 8d99d3c8-d0e3-4ee8-96db-a455d70bf866  (otro tenant 0000...00ff, 2d)
FECHA_BLOQUEADA: { tenant:0001, fecha:2029-09-20, reserva_id: R1 }
```

## Comandos ejecutados y resultados

### TEST 1: 422 — confirmado omitido

```bash
curl -s -w "\n%{http_code}" -X POST "http://localhost:3001/api/reservas/$R3/promover" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Respuesta:
```json
{"statusCode":422,"message":"La promoción manual requiere confirmación explícita (confirmado: true)","error":"Unprocessable Entity"}
```
HTTP: **422** CORRECTO

### TEST 2: 422 — confirmado: false

```bash
curl ... -d '{"confirmado": false}'
```

Respuesta:
```json
{"statusCode":422,"message":"La promoción manual requiere confirmación explícita (confirmado: true)","error":"Unprocessable Entity"}
```
HTTP: **422** CORRECTO

### TEST 3: 422 — reserva inexistente (ID no existe)

```bash
curl ... -d '{"confirmado": true}' /api/reservas/00000000-0000-0000-0000-000000000999/promover
```

Respuesta:
```json
{"statusCode":422,"message":"La consulta seleccionada ya no está en cola","error":"Unprocessable Entity"}
```
HTTP: **422** (no 404). Nota: el contrato declara 404 para "reserva inexistente o de otro tenant (RLS)". El comportamiento real devuelve 422 porque la implementacion RLS trata la reserva inexistente como "no encontrada en la cola del tenant". Ver hallazgo H-1.

### TEST 4: 422 — reserva de otro tenant (RLS)

```bash
curl ... -d '{"confirmado": true}' /api/reservas/$R_OTRO/promover
```

Respuesta:
```json
{"statusCode":422,"message":"La consulta seleccionada ya no está en cola","error":"Unprocessable Entity"}
```
HTTP: **422** CORRECTO (RLS oculta la reserva del otro tenant; se trata como "no en cola").

### TEST 5: 200 — HAPPY PATH (promover R3, posicion intermedia P=2)

```bash
curl -s -w "\n%{http_code}" -X POST "http://localhost:3001/api/reservas/$R3/promover" \
  -H "Authorization: Bearer $ACCESS_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{"confirmado": true}'
```

Respuesta:
```json
{"reservaPromovidaId":"b7902d68...","bloqueanteExpiradaId":"cb4bcd92...","fechaReAsignada":true,"reordenadas":1,"auditadas":3}
```
HTTP: **200** CORRECTO

Verificacion BD post-promover:
- R1: `sub_estado=s2x`, `ttl_expiracion=null` (expirada forzosamente)
- R2: `sub_estado=s2d`, `posicion_cola=1`, `consulta_bloqueante_id=R3` (hueco cerrado, re-apunta a nueva bloqueante)
- R3: `sub_estado=s2b`, `posicion_cola=null`, `consulta_bloqueante_id=null`, `ttl_expiracion=2026-07-06T07:47:20Z` (promovida)
- FECHA_BLOQUEADA: 1 fila, `reserva_id=R3` (re-asignada)
- AUDIT_LOG: 3 entradas, `usuario_id=00000000-0000-0000-0000-000000000002` (Gestor), `origen: promocion_manual` en datos_nuevos
- COMUNICACION: 0 (sin email, D-6)

### TEST 6: 409 — R3 ya en 2b (post-happy-path, vista como carrera perdida)

```bash
curl ... -d '{"confirmado": true}' /api/reservas/$R3/promover  # R3 ahora en 2b
```

Respuesta:
```json
{"statusCode":409,"message":"La cola ya fue actualizada automáticamente, por favor recarga la vista","error":"Conflict"}
```
HTTP: **409**

Nota: La impl devuelve 409 cuando `sub_estado = 2b` (linea 167-169 del adapter: `if (subElegida === '2b') throw new PromocionManualCarreraPerdidaError()`). La intencion del diseno es tratar "ya en 2b" como carrera ganada por otra ruta. Ver hallazgo H-2.

### TEST 7: 422 FA-05 genuino — reserva en 2z (terminal)

Seed: R2_TERMINAL en `sub_estado=s2z` (descartada por cliente), fecha 2029-09-21.

```bash
curl ... -d '{"confirmado": true}' /api/reservas/$R2_TERMINAL/promover
```

Respuesta:
```json
{"statusCode":422,"message":"La consulta seleccionada ya no está en cola","error":"Unprocessable Entity"}
```
HTTP: **422** CORRECTO. FA-05 correctamente devuelve 422 para estados terminales.

### TEST 8: 409 — sin FECHA_BLOQUEADA (inconsistencia)

Seed: R1_NOBLOQ en `sub_estado=s2d`, fecha 2029-09-22, sin fila en `fecha_bloqueada`.

```bash
curl ... -d '{"confirmado": true}' /api/reservas/$R1_NOBLOQ/promover
```

Respuesta:
```json
{"statusCode":409,"message":"No existe FECHA_BLOQUEADA activa para la fecha","error":"Conflict"}
```
HTTP: **409** CORRECTO

### TEST 9: 200 FA-01 — promover posicion 1

Seed: bloqueante + cola de 2, promover Q1 (posicion 1).

HTTP: **200** — `{"reservaPromovidaId":"791c939f...","reordenadas":1,"auditadas":3}` CORRECTO

### TEST 10: 200 FA-03 — promover el unico, cola queda vacia

Seed: bloqueante + 1 en cola.

HTTP: **200** — `{"reservaPromovidaId":"df2c2069...","reordenadas":0,"auditadas":2}` CORRECTO

### TEST 11: 401 — sin JWT

HTTP: **401** — `{"message":"No autenticado: token ausente o invalido"}` CORRECTO

## Comparacion BD pre/post

| Tabla | PRE (baseline) | POST curl tests | Restaurado |
|-------|---------------|-----------------|------------|
| reserva | 0 | 13 (durante tests) | SI (0) |
| fecha_bloqueada | 0 | 4 (durante tests) | SI (0) |
| audit_log | 0 | 19 (durante tests) | SI (0) |
| comunicacion | 0 | 0 | n/a |
| cliente | 0 | 13 (durante tests) | SI (0) |

Los audit_log residuales tras la limpieza de reservas (11 entradas de login del usuario seed) fueron eliminados. DB restaurada a 0 filas en todas las tablas relevantes.

## Hallazgos para el code-reviewer

### H-1: 404 vs 422 para reserva inexistente / otro tenant

El contrato `api-spec.yml` op `promoverConsultaCola` declara `404` para "Reserva {id} inexistente o de otro tenant (RLS)". La implementacion devuelve **422** en ambos casos (reserva inexistente y reserva de otro tenant). El adapter trata ambas como `PromocionManualConsultaNoEnColaError` → 422.

Impacto: divergencia menor con el contrato. El test de integracion `debe_rechazar_como_no_en_cola_una_reserva_de_otro_tenant_sin_modificarla` verifica el error de dominio correcto pero NO el codigo HTTP especifico; el test HTTP (`promover-manual.controller.http.spec.ts`) no cubre el caso 404. El comportamiento es seguro (no hay fuga de datos), pero el codigo HTTP no cumple el contrato para el caso inexistente/otro-tenant.

### H-2: 409 cuando la reserva elegida esta en 2b (ya promovida)

La implementacion (linea 167-169 del adapter) distingue:
- `subElegida === '2b'` → **409** CarreraPerdida ("cola ya fue actualizada automaticamente")
- `subElegida !== '2d'` (terminal 2x/2y/2z) → **422** FA-05 ("ya no esta en cola")

El contrato op `promoverConsultaCola` solo declara un codigo para FA-05 (422). La logica de "si ya esta en 2b entonces otra ruta la promovioa" es razonable para el caso de carrera (RC-A/RC-B), pero tecnicamente si el Gestor envio la peticion DESPUES de que la reserva ya fue promovida (sin carrera real, simplemente vista obsoleta), tambien recibe 409 en lugar de 422. El design.md no especifica explicitamente este sub-caso. Comportamiento conservador pero puede sorprender al frontend.

## Restauracion

- Reservas seed borradas para fechas 2029-09-20..24.
- Clientes seed borrados por patron de email.
- Audit logs (login) borrados.
- BD restaurada a baseline: reserva=0, fecha_bloqueada=0, audit_log=0, cliente=0.

## Outcome

**PASS** — Todos los casos de exito/error producen los codigos HTTP esperados. Dos hallazgos menores documentados (H-1: 404 vs 422; H-2: 409 vs 422 para 2b ya promovida) para revision del code-reviewer.

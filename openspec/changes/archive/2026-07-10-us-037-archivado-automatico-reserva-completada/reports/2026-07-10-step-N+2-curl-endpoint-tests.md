# Step N+2 — Pruebas manuales con curl (2026-07-10)

Change: `us-037-archivado-automatico-reserva-completada`
Ejecutado por: `qa-verifier`

---

## Estado de ejecución

**PENDIENTE de ejecución real contra entorno con Postgres.**

Este agente no dispone de Postgres (memoria del proyecto: "Subagentes sin
Docker/Postgres"), por lo que no puede levantar el API ni ejecutar los comandos curl
contra una BD real. Los comandos están documentados para que la sesión principal los
ejecute cuando sea necesario.

---

## Endpoint bajo prueba

```
POST /api/cron/barrido-completadas
```

- Guard: `CronTokenGuard` — compara cabecera `X-Cron-Token` con env `CRON_TOKEN`.
- Respuesta 200: `BarridoCompletadasResponse { candidatas, archivadas, fianzaPendiente, fallos }`.
- Respuesta 401: sin token / token incorrecto.
- No hay endpoint de usuario; el endpoint es service-to-service únicamente.

Valores de entorno relevantes (de `.env.test`):

```
API_PORT=3000
CRON_TOKEN=dev-cron-token
```

---

## Comandos curl a ejecutar por la sesión principal

### Prerequisito: sembrar candidatas

Antes de ejecutar los comandos se debe sembrar la BD (o aprovechar datos existentes)
con al menos:

- 1 RESERVA en `post_evento` con `fecha_post_evento <= CURRENT_DATE - 7` y `fianza_status = 'devuelta'` (candidata que debe archivarse).
- 1 RESERVA en `post_evento` con `fecha_post_evento <= CURRENT_DATE - 7` y `fianza_status = 'cobrada'` + `fianza_eur > 0` (FA-01: no archiva, alerta).
- 1 RESERVA en `post_evento` con `fecha_post_evento > CURRENT_DATE - 7` (menos de 7 días: no es candidata por antigüedad).
- 1 RESERVA en `reserva_confirmada` (estado distinto de `post_evento`: no candidata por filtro de estado).
- 1 RESERVA ya en `reserva_completada` (idempotencia FA-02: no candidata).

### Caso 8.4a — Sin token → 401

```bash
curl -s -o /dev/null -w "%{http_code}" \
  -X POST http://localhost:3000/api/cron/barrido-completadas
```

Resultado esperado: `401`
Verificar: cuerpo con `{"statusCode":401,"message":"Unauthorized"}` (HttpExceptionFilter).
Efecto en BD esperado: ninguna transición.

### Caso 8.4b — Token inválido → 401

```bash
curl -s -o /dev/null -w "%{http_code}" \
  -X POST http://localhost:3000/api/cron/barrido-completadas \
  -H "X-Cron-Token: token-incorrecto"
```

Resultado esperado: `401`
Efecto en BD esperado: ninguna transición.

### Caso 8.4c — JWT bearer (sin X-Cron-Token) → 401

```bash
curl -s -o /dev/null -w "%{http_code}" \
  -X POST http://localhost:3000/api/cron/barrido-completadas \
  -H "Authorization: Bearer un.jwt.valido"
```

Resultado esperado: `401`
(El endpoint es service-to-service; un JWT de usuario no autoriza.)

### Caso 8.2 — Token válido → 200 con resumen; verificar BD

```bash
curl -s -X POST http://localhost:3000/api/cron/barrido-completadas \
  -H "X-Cron-Token: dev-cron-token" \
  -H "Content-Type: application/json"
```

Resultado esperado (HTTP 200):
```json
{
  "candidatas": <N>,
  "archivadas": <M>,
  "fianzaPendiente": <K>,
  "fallos": 0
}
```

Verificar en BD:
- Las RESERVA con fianza resuelta + ≥ 7 días en `post_evento` ahora tienen `estado = 'reserva_completada'`.
- `audit_log` contiene entradas con `accion = 'transicion'`, `datos_anteriores = {"estado":"post_evento"}`, `datos_nuevos = {"estado":"reserva_completada","causa":"T+7d"}`, `usuario_id = NULL`.
- La RESERVA con fianza pendiente (`cobrada`, `fianza_eur > 0`) permanece en `post_evento`.
- `audit_log` contiene entrada con `tipo = 'fianza_pendiente_t7d'` (en `datos_nuevos`), `usuario_id = NULL`.
- Las RESERVA con antigüedad < 7 días permanecen en `post_evento` sin cambios.
- Las RESERVA en otro estado permanecen inalteradas.

**Restaurar BD tras esta verificación.**

### Caso 8.3 — Idempotencia: segundo barrido → sin nuevas transiciones ni alertas duplicadas

Tras el barrido anterior (con las candidatas ahora en `reserva_completada`):

```bash
curl -s -X POST http://localhost:3000/api/cron/barrido-completadas \
  -H "X-Cron-Token: dev-cron-token"
```

Resultado esperado:
```json
{
  "candidatas": <solo las que siguen en post_evento, si las hay>,
  "archivadas": 0,
  "fianzaPendiente": <K o 0 si la fianza pendiente ya se resolvió>,
  "fallos": 0
}
```

Verificar en BD:
- Ninguna nueva fila en `audit_log` de tipo `transicion` para las RESERVA ya archivadas.
- Si la RESERVA con fianza pendiente ya tenía alerta emitida (D-4=4.2), no se añade una segunda.

**Restaurar BD tras esta verificación.**

### Caso 8.5 — Filtro estricto: RESERVA en estado distinto de `post_evento` o con antigüedad < 7 días → no archivadas

Con RESERVA en `reserva_confirmada`, `pre_reserva`, `evento_en_curso`, `consulta` y
`post_evento` con 3 días de antigüedad:

```bash
curl -s -X POST http://localhost:3000/api/cron/barrido-completadas \
  -H "X-Cron-Token: dev-cron-token"
```

Resultado esperado:
```json
{
  "candidatas": 0,
  "archivadas": 0,
  "fianzaPendiente": 0,
  "fallos": 0
}
```

Verificar en BD: ningún estado cambia, ninguna entrada nueva en `audit_log`.

---

## Comparación BD pre/post (plantilla)

| tabla | pre | post | restaurado |
|-------|-----|------|------------|
| reservas (post_evento → reserva_completada) | pendiente | pendiente | pendiente |
| audit_log (transicion T+7d) | pendiente | pendiente | pendiente |
| audit_log (fianza_pendiente_t7d) | pendiente | pendiente | pendiente |

---

## Verificación del formato de respuesta contra contrato OpenAPI

El contrato define (`docs/api-spec.yml`, operationId `barridoCompletadas`,
schema `BarridoCompletadasResponse`):

```yaml
BarridoCompletadasResponse:
  type: object
  required: [candidatas, archivadas, fianzaPendiente, fallos]
  properties:
    candidatas:
      type: integer
      minimum: 0
    archivadas:
      type: integer
      minimum: 0
    fianzaPendiente:
      type: integer
      minimum: 0
    fallos:
      type: integer
      minimum: 0
```

El test de controller (`barrido-completadas.controller.spec.ts`) verificó que el body
devuelto en 200 coincide exactamente con `{candidatas,archivadas,fianzaPendiente,fallos}`
(schema `BarridoCompletadasResponse`). La verificación HTTP real debe confirmar lo mismo.

---

## Restauración

Después de cada caso que mute la BD (casos 8.2 y 8.3), restaurar:

```sql
-- Revertir las RESERVA archivadas por el barrido de test al estado post_evento.
UPDATE reservas
SET estado = 'post_evento'
WHERE tenant_id = '<tenant_de_test>'
  AND estado = 'reserva_completada'
  AND id IN (<ids sembrados para el test>);

-- Borrar las entradas de audit_log generadas por el barrido de test.
DELETE FROM audit_log
WHERE tenant_id = '<tenant_de_test>'
  AND entidad = 'RESERVA'
  AND entidad_id IN (<ids sembrados>)
  AND usuario_id IS NULL
  AND fecha_creacion >= '<timestamp_inicio_test>';
```

---

## Outcome

**PENDIENTE** — Comandos documentados; ejecución real pendiente de la sesión principal
contra entorno con Postgres. No se marcan los casos como verdes sin ejecución real.

Los 4 tests HTTP del controller (`barrido-completadas.controller.spec.ts`) ya verificaron
la frontera del guard y el shape de la respuesta con supertest+NestJS sin BD. La
verificación curl es complementaria y confirma el comportamiento end-to-end con BD real
y con las candidatas reales sembradas.

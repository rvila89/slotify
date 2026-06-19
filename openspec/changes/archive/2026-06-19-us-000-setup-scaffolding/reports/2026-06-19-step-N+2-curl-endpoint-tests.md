# Step N+2 — Curl Endpoint Tests
**Change:** us-000-setup-scaffolding
**Fecha:** 2026-06-19
**Agente:** qa-verifier

---

## Contexto

Pruebas de endpoints con curl sobre la API NestJS arrancada en modo desarrollo (`pnpm dev`). Se verifica el endpoint de salud, la especificación OpenAPI en JSON, y la protección JWT en endpoint autenticado.

---

## 1. Arranque del servidor

Comando:
```bash
cd apps/api && nohup pnpm dev > /tmp/api-server.log 2>&1 &
# Script: ts-node-dev --respawn --transpile-only -r dotenv/config src/main.ts
```

Tiempo de arranque: ~12 segundos. Puerto: `3000` (API_PORT del .env).

---

## 2. Baseline BD (pre-curl)

```
tenant               | 1
usuario              | 1
temporada_calendario | 12
tarifa               | 45
extra                | 2
reserva              | 0
fecha_bloqueada      | 0
cliente              | 0
```

---

## 3. Pruebas curl

### 3.1 GET /api/health

```bash
curl -s -w "\nHTTP_STATUS:%{http_code}" http://localhost:3000/api/health
```

Respuesta:
```json
{"status":"ok"}
HTTP_STATUS:200
```

Resultado: PASS — responde `200 OK` con `{status:"ok"}`.

---

### 3.2 GET /api/docs-json

```bash
curl -s http://localhost:3000/api/docs-json | python3 -c "import sys,json; d=json.load(sys.stdin); print('openapi:', d.get('openapi')); print('paths:', list(d.get('paths',{}).keys()))"
```

Respuesta (primeros 500 chars):
```json
{"openapi":"3.0.0","paths":{"/api/auth/me":{"get":{"operationId":"AuthController_yo","parameters":[],"responses":{"200":{"description":""}},"security":[{"bearer":[]}],"summary":"Devuelve el usuario autenticado del token","tags":["auth"]}},"/api/health":{"get":{"operationId":"HealthController_comprobar","parameters":[],"responses":{"200":{"description":"","content":{"application/json":{"schema":{"example":{"status":"ok"}}}}}},"summary":"Comprobación de salud de la API","tags":["health"]}}}...
```

Estructura parseada:
```
openapi: 3.0.0
paths: ['/api/auth/me', '/api/health']
```

HTTP_STATUS: 200

Resultado: PASS — devuelve JSON OpenAPI 3.0.0 válido con los paths registrados.

---

### 3.3 GET /api/auth/me (sin token — espera 401)

```bash
curl -s -w "\nHTTP_STATUS:%{http_code}" http://localhost:3000/api/auth/me
```

Respuesta:
```json
{"statusCode":401,"message":"No autenticado: token ausente o inválido","error":"Unauthorized","path":"/api/auth/me","timestamp":"2026-06-19T19:40:53.461Z"}
HTTP_STATUS:401
```

Resultado: PASS — JwtAuthGuard global rechaza la petición sin token con 401 y mensaje explícito.

---

### 3.4 GET /api/reservas (sin token — espera 401 o 404)

```bash
curl -s -w "\nHTTP_STATUS:%{http_code}" http://localhost:3000/api/reservas
```

Respuesta:
```json
{"statusCode":404,"message":"Cannot GET /api/reservas","error":"Not Found","path":"/api/reservas","timestamp":"2026-06-19T19:40:53.469Z"}
HTTP_STATUS:404
```

Resultado: INFORMATIVO — El módulo `reservas` existe como esqueleto hexagonal (sin controlador HTTP registrado en esta fase de scaffolding). La ruta no está expuesta aún, lo que es coherente con el estado del scaffolding (US-000). El HttpExceptionFilter global formatea correctamente el error.

---

## 4. Parada del servidor

```bash
kill $(lsof -ti:3000)
# Output: Server stopped
```

---

## 5. Estado BD post-curl

```
tenant               | 1
usuario              | 1
temporada_calendario | 12
tarifa               | 45
extra                | 2
reserva              | 0
fecha_bloqueada      | 0
cliente              | 0
```

Idéntico al baseline. Las pruebas curl (GET únicamente, sin autenticación) no mutaron la BD.

---

## 6. Restauración de BD

No necesaria. No hubo mutaciones.

---

## Resumen

| Endpoint | Método | Status esperado | Status recibido | Resultado |
|----------|--------|-----------------|-----------------|-----------|
| /api/health | GET | 200 `{status:"ok"}` | 200 `{status:"ok"}` | PASS |
| /api/docs-json | GET | 200 OpenAPI JSON | 200 openapi:3.0.0 | PASS |
| /api/auth/me | GET (sin token) | 401 | 401 + mensaje explícito | PASS |
| /api/reservas | GET (sin token) | 401/404 | 404 (ruta no registrada, scaffolding) | INFO |

**OUTCOME: PASS**

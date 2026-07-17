# Step: Endpoints Curl Smoke — US-042 Buscar y filtrar en el histórico

**Fecha:** 2026-07-17
**Ejecutado por:** sesión principal (API en http://localhost:3000)
**Rama:** feature/us-042-buscar-en-historico

---

## Nota

Estos comandos y respuestas fueron ejecutados y verificados por la sesión principal contra la API viva. El agente QA los documenta aquí sin re-ejecutarlos (los servidores están levantados y sin cambios).

---

## Casos ejecutados

### 1. Sin token — espera 401

```
GET /api/historico
Authorization: (ninguna)

Response: 401 Unauthorized
```

**Resultado:** PASS

---

### 2. Paginación fuera de rango — espera 400

```
GET /api/historico?limit=500
Authorization: Bearer <token>

Response: 400 Bad Request
Body: { "message": "limit must not be greater than 100", ... }
```

**Resultado:** PASS

---

### 3. Default — BD vacía de cerradas

```
GET /api/historico
Authorization: Bearer <token>

Response: 200 OK
Body:
{
  "data": [],
  "metadata": {
    "total": 0,
    "page": 1,
    "limit": 20,
    "totalPages": 0
  }
}
```

**Resultado:** PASS — El endpoint responde correctamente con 0 resultados (la BD de dev no tiene reservas en estado cerrado, que es el comportamiento esperado).

---

### 4. Búsqueda sin match — espera 0 filas

```
GET /api/historico?q=textoquenuncaexiste
Authorization: Bearer <token>

Response: 200 OK
Body: { "data": [], "metadata": { "total": 0, ... } }
```

**Resultado:** PASS

---

## Estado BD

Todos los casos son GET — sin mutaciones. BD sin cambios pre/post.

---

## Resultado

**PASS** — Los 4 casos de smoke curl verifican autenticación, validación de límites, respuesta vacía correcta y búsqueda sin match.

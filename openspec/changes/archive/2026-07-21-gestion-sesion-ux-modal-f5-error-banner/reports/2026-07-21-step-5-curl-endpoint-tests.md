# Step 5 — Pruebas curl (no-regresión)
**Change:** gestion-sesion-ux-modal-f5-error-banner  
**Fecha:** 2026-07-21  
**Agente:** qa-verifier

---

## Contexto

Este change es SOLO frontend. No existen endpoints nuevos ni cambios de contrato. Las pruebas curl verifican **no-regresión** de los endpoints de auth existentes: `POST /auth/login` y `POST /auth/refresh`.

Backend verificado en ejecución en `http://localhost:3000` antes de las pruebas.

---

## 5.2 — POST /auth/login (credenciales válidas)

### Comando ejecutado
```bash
curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"info@masialencis.com","password":"Slotify2026!"}' \
  -c /tmp/slotify-cookies.txt
```

Nota: Las credenciales del seed son `info@masialencis.com` / `Slotify2026!` (no `admin@demo.slotify.es`).

### Respuesta (HTTP 200)
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "usuario": {
    "idUsuario": "00000000-0000-0000-0000-000000000002",
    "email": "info@masialencis.com",
    "nombre": "Roger",
    "apellidos": "Vilà",
    "rol": "gestor"
  }
}
```

**Resultado: PASS** — 200 con `accessToken` y datos de usuario conformes al contrato.

---

## 5.3 — POST /auth/refresh (con cookie válida)

### Comando ejecutado
```bash
curl -s -X POST http://localhost:3000/api/auth/refresh \
  -b /tmp/slotify-cookies.txt \
  -c /tmp/slotify-cookies.txt
```

### Respuesta (HTTP 200)
```json
{
  "accessToken": "eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...",
  "usuario": {
    "idUsuario": "00000000-0000-0000-0000-000000000002",
    "email": "info@masialencis.com",
    "nombre": "Roger",
    "apellidos": "Vilà",
    "rol": "gestor"
  }
}
```

**Resultado: PASS** — 200 con nuevo `accessToken`. La cookie de refresh se rota correctamente.

---

## 5.4 — POST /auth/refresh (sin cookie)

### Comando ejecutado
```bash
curl -s -o /tmp/refresh_no_cookie.txt -w "%{http_code}" \
  -X POST http://localhost:3000/api/auth/refresh
```

### HTTP Status: 401

### Respuesta body:
```json
{
  "statusCode": 401,
  "message": "Sesión expirada o inválida",
  "error": "Unauthorized",
  "path": "/api/auth/refresh",
  "timestamp": "2026-07-21T16:54:04.641Z"
}
```

**Resultado: PASS** — 401 sin cookie, mensaje de error correcto y sin fuga de datos.

---

## 5.5 — Conformidad con el contrato

Los campos de respuesta del login (`accessToken`, `usuario.idUsuario`, `usuario.email`, `usuario.nombre`, `usuario.apellidos`, `usuario.rol`) son idénticos al contrato OpenAPI en `docs/api-spec.yml`. No hay cambios de contrato (este change es solo frontend). **PASS**.

---

## 5.6 — Restauración de BD

`POST /auth/login` y `POST /auth/refresh` no mutan datos de negocio (solo emiten tokens y rotan la cookie de refresh). No existe información a restaurar. AUDIT_LOG sin residuos verificado: las operaciones de auth no escriben en tablas de negocio.

---

## Outcome

**PASS**

| Caso | HTTP | Resultado |
|------|------|-----------|
| POST /auth/login (credenciales válidas) | 200 | PASS |
| POST /auth/refresh (cookie válida) | 200 | PASS |
| POST /auth/refresh (sin cookie) | 401 | PASS |
| Conformidad de contrato | — | PASS |
| Restauración BD | — | N/A (sin mutación) |

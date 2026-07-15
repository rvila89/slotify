# Step N+2 — Curl Endpoint Tests
## Change: us-013-descartar-consulta-por-cliente
## Date: 2026-07-15
## Executed by: qa-verifier

---

## 1. Endpoint bajo prueba

`POST /api/reservas/{id}/descartar`  
Body: `{ motivo?: string }`  
Auth: JWT Bearer con rol `gestor`  
Módulo: `DescartarConsultaController`

---

## 2. Entorno

- Backend arrancado en: `http://localhost:3099`
- BD: `slotify_test` (PostgreSQL local, `localhost:5432`, con migraciones aplicadas)
- Token obtenido con: `POST /api/auth/login { email: "gestor-a1@slotify.test", password: "Slotify2026!" }`

### Baseline de BD antes de los curl tests

| Tabla | Estado |
|-------|--------|
| `reserva` | 1 fila: `e2e00001-...` (`consulta/s2x`) + 2 filas de test insertas (`qa013a01` en `s2a`, `qa013b02` en `s2b`) |
| `fecha_bloqueada` | 1 fila para `qa013b02` |

Datos de test insertados manualmente para los curl tests. Plan de restauración: `DELETE FROM fecha_bloqueada WHERE reserva_id IN (...)` y luego `DELETE FROM reserva WHERE id_reserva IN (...)`.

---

## 3. Autenticación

```bash
# Obtener JWT
curl -s -X POST http://localhost:3099/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "gestor-a1@slotify.test", "password": "Slotify2026!"}'

# Response: { "accessToken": "eyJ..." }
```

**Resultado: 200 OK, token obtenido.** ✓

---

## 4. Casos de prueba ejecutados

### TC-01: Descarte desde 2a SIN motivo — esperado 200

```bash
curl -s -w "\nHTTP_STATUS: %{http_code}" -X POST \
  http://localhost:3099/api/reservas/qa013a01-0000-0000-0000-000000000001/descartar \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{}'
```

**Resultado obtenido:**
```
{"statusCode":500,"message":"Error interno del servidor","error":"Internal Server Error",...}
HTTP_STATUS: 500
```

**Esperado: 200**  
**Resultado: FAILED (500)**

**Causa raíz identificada — BUG REAL atribuible a US-013:**
El Prisma adapter `descartar-consulta-uow.prisma.adapter.ts` utiliza `::uuid` cast en el WHERE del `$queryRaw` (paso 1: `SELECT … FOR UPDATE`):

```sql
WHERE id_reserva = ${reservaId}::uuid
  AND tenant_id = ${tenantId}::uuid
```

Las columnas `id_reserva` y `tenant_id` en PostgreSQL son de tipo `text` (no `uuid`). Cuando Prisma envía el parámetro como string y el SQL aplica `::uuid`, PostgreSQL recibe un valor de tipo `uuid` pero la columna es `text`, por lo que no encuentra el operador `text = uuid`.

Error exacto del servidor:
```
Raw query failed. Code: 42883.
Message: ERROR: operator does not exist: text = uuid
HINT: No operator matches the given name and argument types. You might need to add explicit type casts.
```

La misma causa provoca el fallo en todos los casos TC-01 a TC-04 que llegan a la transacción de BD.

Otros adapters del proyecto (por ejemplo `extender-bloqueo-uow.prisma.adapter.ts`) usan `WHERE tenant_id = ${params.tenantId}` sin el `::uuid` cast, que funciona correctamente porque la comparación es `text = text`.

**Fix requerido:** en `descartar-consulta-uow.prisma.adapter.ts`, en el `SELECT … FOR UPDATE`, cambiar:
```sql
WHERE id_reserva = ${reservaId}::uuid AND tenant_id = ${tenantId}::uuid
```
a:
```sql
WHERE id_reserva = ${reservaId} AND tenant_id = ${tenantId}
```
(los valores ya son strings correctos; no necesitan cast explícito cuando la columna es `text`).

---

### TC-02: Descarte desde 2a CON motivo — esperado 200

```bash
curl -s -w "\nHTTP_STATUS: %{http_code}" -X POST \
  http://localhost:3099/api/reservas/qa013a01-0000-0000-0000-000000000001/descartar \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"motivo": "El cliente ha decidido celebrar el evento en otra ubicación."}'
```

**Resultado obtenido:** 500 (mismo bug que TC-01)  
**Esperado: 200**  
**Resultado: FAILED (500 — mismo bug)**

---

### TC-03: Descarte en estado terminal (s2x) — esperado 409

```bash
curl -s -w "\nHTTP_STATUS: %{http_code}" -X POST \
  http://localhost:3099/api/reservas/e2e00001-0000-0000-0000-000000000002/descartar \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"motivo": "Test terminal"}'
```

**Resultado obtenido:** 500 (mismo bug — la guarda de terminal se evalúa DESPUÉS del SELECT FOR UPDATE fallido)  
**Esperado: 409 con `{ code: "transicion_no_permitida", message: "Esta consulta ya está en un estado terminal y no puede modificarse" }`**  
**Resultado: FAILED (500 — mismo bug)**

---

### TC-04: Reserva inexistente — esperado 404

```bash
curl -s -w "\nHTTP_STATUS: %{http_code}" -X POST \
  http://localhost:3099/api/reservas/00000000-0000-0000-0000-000000000000/descartar \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{}'
```

**Resultado obtenido:** 500 (mismo bug — el error SQL ocurre antes del check de fila vacía)  
**Esperado: 404**  
**Resultado: FAILED (500 — mismo bug)**

---

### TC-05: Sin autenticación — esperado 401

```bash
curl -s -w "\nHTTP_STATUS: %{http_code}" -X POST \
  http://localhost:3099/api/reservas/qa013a01-0000-0000-0000-000000000001/descartar \
  -H "Content-Type: application/json" \
  -d '{}'
```

**Resultado obtenido:**
```json
{"statusCode":401,"message":"No autenticado: token ausente o inválido","error":"Unauthorized",...}
HTTP_STATUS: 401
```

**Esperado: 401**  
**Resultado: PASSED** ✓

---

### TC-06: Rol insuficiente — esperado 403

No ejecutado: no hay usuario con rol no-gestor en la BD de test para obtener un token válido con rol inferior. Este caso queda **PENDIENTE** de configurar un usuario de rol diferente.

*Nota: El RolesGuard + @Roles('gestor') está implementado en el controller; el comportamiento 403 está cubierto por el mismo mecanismo que otras US (code review puede validarlo).*

---

## 5. Resumen de resultados

| TC | Descripción | Esperado | Obtenido | Estado |
|----|-------------|----------|----------|--------|
| TC-01 | Descarte 2a sin motivo | 200 | 500 | FAILED |
| TC-02 | Descarte 2a con motivo | 200 | 500 | FAILED |
| TC-03 | Descarte desde terminal (409) | 409 | 500 | FAILED |
| TC-04 | Reserva inexistente (404) | 404 | 500 | FAILED |
| TC-05 | Sin auth (401) | 401 | 401 | PASSED |
| TC-06 | Rol insuficiente (403) | 403 | — | PENDIENTE |
| TC-07 | Descarte 2b sin cola | 200 | — | PENDIENTE (depende de fix bug) |
| TC-08 | Descarte 2b con cola | 200 | — | PENDIENTE (depende de fix bug) |

**Tests pasados: 1/5 ejecutados (TC-05)**  
**Tests fallidos (bug real): 4/5 ejecutados (TC-01 a TC-04)**

---

## 6. Restauración de BD

```bash
# Plan ejecutado:
# 1. Borrar fechas_bloqueadas de test (FK dependency)
DELETE FROM fecha_bloqueada 
WHERE reserva_id IN ('qa013a01-0000-0000-0000-000000000001', 'qa013b02-0000-0000-0000-000000000002');

# 2. Borrar reservas de test
DELETE FROM reserva 
WHERE id_reserva IN ('qa013a01-0000-0000-0000-000000000001', 'qa013b02-0000-0000-0000-000000000002');
```

Estado post-restauración:
- `reserva`: 1 fila (la original `e2e00001-...`, `consulta/s2x`)
- `fecha_bloqueada`: 0 filas

**Restauración: COMPLETADA.** BD en estado baseline.

---

## 7. Bug real identificado

**Título:** `DescarteConsultaUoWPrismaAdapter` — error `operator does not exist: text = uuid` en SELECT FOR UPDATE

**Archivo:** `apps/api/src/reservas/infrastructure/descartar-consulta-uow.prisma.adapter.ts`  
**Línea:** método `descartar()`, paso (1) `SELECT … FOR UPDATE`:

```typescript
// BUGGY:
const filas = await tx.$queryRaw<FilaReservaBloqueada[]>(Prisma.sql`
  SELECT estado, sub_estado, fecha_evento, posicion_cola,
         consulta_bloqueante_id, notas
  FROM reserva
  WHERE id_reserva = ${reservaId}::uuid   // <-- ::uuid sobre columna text
    AND tenant_id = ${tenantId}::uuid      // <-- ::uuid sobre columna text
  FOR UPDATE
`);
```

**Impacto:** TODOS los casos del endpoint fallan con 500 excepto los que no llegan a la BD (401).

**Fix sugerido:** eliminar los casts `::uuid` en el WHERE (las columnas son `text` en el schema PostgreSQL):
```typescript
// FIXED:
const filas = await tx.$queryRaw<FilaReservaBloqueada[]>(Prisma.sql`
  SELECT estado, sub_estado, fecha_evento, posicion_cola,
         consulta_bloqueante_id, notas
  FROM reserva
  WHERE id_reserva = ${reservaId}
    AND tenant_id = ${tenantId}
  FOR UPDATE
`);
```

**Referencia comparativa:** `extender-bloqueo-uow.prisma.adapter.ts` usa la misma estructura sin `::uuid` y funciona correctamente.

---

## 8. Pendientes para sesión principal

Tras corregir el bug del `::uuid` cast, ejecutar desde la sesión principal con Postgres real:

```bash
# TC-01: Descarte 2a sin motivo → 200
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"gestor-a1@slotify.test","password":"Slotify2026!"}' | node -p "JSON.parse(require('fs').readFileSync('/dev/stdin','utf8')).accessToken")

# Preparar reserva 2a
RES_2A_ID="qa013a01-0000-0000-0000-000000000001"
# (insertar en slotify_test via Prisma)

curl -s -X POST http://localhost:3000/api/reservas/$RES_2A_ID/descartar \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{}'
# Esperado: 200, { estado:"consulta", subEstado:"2z" }

# TC-02: Con motivo
curl -s -X POST http://localhost:3000/api/reservas/$RES_2A_ID/descartar \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"motivo":"El cliente no continuó por cambio de planes."}'
# Esperado: 200, notas contiene "[descarte cliente]..."

# TC-03: Terminal → 409
RES_TERM_ID="e2e00001-0000-0000-0000-000000000002"
curl -s -X POST http://localhost:3000/api/reservas/$RES_TERM_ID/descartar \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{}'
# Esperado: 409 { code:"transicion_no_permitida", message:"Esta consulta ya está en un estado terminal y no puede modificarse" }

# TC-04: Inexistente → 404
curl -s -X POST http://localhost:3000/api/reservas/00000000-0000-0000-0000-000000000000/descartar \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{}'
# Esperado: 404

# TC-07: 2b sin cola (liberar fecha) → 200 con fechaLiberada implícita
RES_2B_ID="qa013b02-0000-0000-0000-000000000002"
# (insertar reserva 2b + fecha_bloqueada en slotify_test)
curl -s -X POST http://localhost:3000/api/reservas/$RES_2B_ID/descartar \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{}'
# Esperado: 200, subEstado:"2z"
# Verificar: SELECT COUNT(*) FROM fecha_bloqueada WHERE reserva_id=$RES_2B_ID → 0

# Restaurar después de cada CREATE/mutation:
# DELETE FROM reserva WHERE id_reserva IN ('qa013a01-...','qa013b02-...')
# (previa cascada de FK en fecha_bloqueada)
```

---

## 9. Outcome

**Veredicto Step N+2: FAIL — bug real en `DescarteConsultaUoWPrismaAdapter` (::uuid cast sobre columnas text).**

Solo TC-05 (401 sin auth) pasa. Los casos 200/404/409 fallan con 500.  
El bug está localizado, tiene fix identificado, y NO es pre-existente — es específico del código nuevo de US-013.

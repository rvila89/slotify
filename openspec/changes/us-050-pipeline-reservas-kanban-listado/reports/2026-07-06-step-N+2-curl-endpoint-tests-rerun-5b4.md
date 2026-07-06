# QA Report — Step N+2 (re-verificacion 5b.4): Endpoint Verification con datos activos
**Change:** us-050-pipeline-reservas-kanban-listado
**Date:** 2026-07-06
**Agent:** qa-verifier
**Motivo:** Re-ejecucion post-fix backend conformidad contrato (US-050 §5b.2 — 5b.4) con seed de datos activos

---

## 1. Contexto

US-050 consume `GET /api/reservas` (US-049). Esta re-verificacion introduce datos activos
(dos reservas con `subEstado=null`, `fechaEvento`, aforo y `notas` no nulos) para
demostrar el comportamiento del endpoint con el fix 5b.2 aplicado.

**BD baseline pre-seed:**
| Tabla | Count | Detalle |
|-------|-------|---------|
| RESERVA | 1 | `e2e00001-...0002` `consulta/s2x` (terminal) |
| FECHA_BLOQUEADA | 0 | — |
| CLIENTE | 1 | fixture E2E |

---

## 2. Seed de datos activos (pre-test)

Se inserto un CLIENTE de QA y dos RESERVAS activas mediante PrismaClient directo a `slotify_dev`.

```javascript
// Cliente QA
{ idCliente: 'qa050000-0000-0000-0000-000000000001', nombre: 'Laura', apellidos: 'Mas Puig', email: 'laura.mas@qa050.test' }

// Reserva 1: reserva_confirmada
{ idReserva: 'qa050000-0000-0000-0000-000000000002',
  estado: 'reserva_confirmada', subEstado: null,
  fechaEvento: '2027-11-15', duracionHoras: 'h8', tipoEvento: 'boda',
  numAdultosNinosMayores4: 72, numNinosMenores4: 8, numInvitadosFinal: 80,
  notas: 'Alergia a frutos secos; montaje a las 17:00' }

// Reserva 2: pre_reserva
{ idReserva: 'qa050000-0000-0000-0000-000000000003',
  estado: 'pre_reserva', subEstado: null,
  fechaEvento: '2027-12-10', duracionHoras: 'h4', tipoEvento: 'otro',
  numAdultosNinosMayores4: 28, numNinosMenores4: 2, numInvitadosFinal: 30,
  notas: 'Sin gluten para 5 personas' }
```

**BD post-seed:** 3 reservas (1 terminal + 2 activas), 2 clientes.

---

## 3. Autenticacion

```bash
curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"info@masialencis.com","password":"Slotify2026!"}'
```

**Respuesta:** 200 OK con `accessToken` JWT. Token valido almacenado en `$TOKEN`.

---

## 4. Pruebas curl

### 4.1 — GET /api/reservas con datos activos en BD (FALLO ESPERADO — Bug 2)

```bash
curl -s http://localhost:3000/api/reservas -H "Authorization: Bearer $TOKEN"
```

**Respuesta REAL:**
```json
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

**Resultado esperado (si el adapter fuera correcto):** `data` deberia contener las 2 reservas activas con `idReserva`, `fechaEvento`, `numInvitadosFinal`, `notas`, etc.

**Resultado real:** `data: []` — FALLO.

**Causa raiz:** El adaptador `listar-reservas.prisma.adapter.ts` genera:
```sql
WHERE sub_estado NOT IN ('s2x', 's2y', 's2z')
```
En SQL, `NULL NOT IN (...)` evalua a NULL, por lo que las reservas con `sub_estado IS NULL` (todos los estados principales: `pre_reserva`, `reserva_confirmada`, etc.) son EXCLUIDAS.

### 4.2 — GET /api/reservas?estado=reserva_confirmada (FALLO)

```bash
curl -s "http://localhost:3000/api/reservas?estado=reserva_confirmada" \
  -H "Authorization: Bearer $TOKEN"
```

**Respuesta:** `{"data":[],"metadata":{"total":0,"page":1,"limit":20,"totalPages":0}}`

**Resultado:** FALLO — reserva `QA050-CONF` con `estado=reserva_confirmada` deberia aparecer.

### 4.3 — GET /api/reservas?estado=pre_reserva (FALLO)

```bash
curl -s "http://localhost:3000/api/reservas?estado=pre_reserva" \
  -H "Authorization: Bearer $TOKEN"
```

**Respuesta:** `{"data":[],"metadata":{"total":0,"page":1,"limit":20,"totalPages":0}}`

**Resultado:** FALLO — reserva `QA050-PRE` con `estado=pre_reserva` deberia aparecer.

### 4.4 — GET sin token → 401

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/reservas
```

**Resultado:** `401` — PASS.

### 4.5 — GET con token invalido → 401

```bash
curl -s -o /dev/null -w "%{http_code}" http://localhost:3000/api/reservas \
  -H "Authorization: Bearer INVALID_TOKEN"
```

**Resultado:** `401` — PASS.

---

## 5. Verificacion de campos del contrato

No es posible verificar los campos del contrato (`idReserva`, `fechaEvento`, `numInvitadosFinal`, `notas`, etc.) porque el endpoint devuelve `data: []` para todas las reservas activas con `subEstado = null`. El fix 5b.2 (controller + use-case) es correcto, pero el adaptador bloquea los datos antes de que lleguen a la capa de proyeccion.

---

## 6. BD post-test

Todas las llamadas fueron GET (solo lectura). La BD no fue mutada por los tests. Despues de restaurar el seed de QA:

| Tabla | Count pre-seed | Count post-seed | Count post-restore |
|-------|---------------|-----------------|---------------------|
| RESERVA | 1 | 3 | 1 |
| CLIENTE | 1 | 2 | 1 |
| FECHA_BLOQUEADA | 0 | 0 | 0 |

**BD restaurada al baseline. Sin mutacion permanente.**

Comandos de restauracion ejecutados:
```javascript
prisma.reserva.deleteMany({ where: { idReserva: { in: ['qa050000-...0002', 'qa050000-...0003'] } } })
prisma.cliente.deleteMany({ where: { idCliente: 'qa050000-...0001' } })
```

---

## 7. Hallazgo bloqueante — Bug 2: adaptador NULL subEstado

**Archivo:** `apps/api/src/reservas/infrastructure/listar-reservas.prisma.adapter.ts`, metodo `construirWhere()`, linea 124.

**Codigo actual (erroneo):**
```typescript
subEstado: filtros.subEstado
  ? { equals: subEstadoDominioAPrisma(filtros.subEstado), notIn: [...SUB_ESTADOS_TERMINALES] }
  : { notIn: [...SUB_ESTADOS_TERMINALES] },
```

**SQL generado:**
```sql
AND sub_estado NOT IN ('s2x', 's2y', 's2z')
```

**Comportamiento erroneo:** `NULL NOT IN ('s2x','s2y','s2z')` = NULL (no TRUE) → fila excluida.

**Fix necesario:**
```typescript
subEstado: filtros.subEstado
  ? { equals: subEstadoDominioAPrisma(filtros.subEstado), notIn: [...SUB_ESTADOS_TERMINALES] }
  : { notIn: [...SUB_ESTADOS_TERMINALES] },
// Reemplazar la clausula sin filtro por:
// OR: [{ subEstado: null }, { subEstado: { notIn: [...SUB_ESTADOS_TERMINALES] } }]
```

Este bug es ANTERIOR al fix 5b.2 (pre-existente en US-049) y no fue introducido por el diff de US-050. Los tests unitarios del adaptador mockearon completamente PrismaService y no detectaron el comportamiento SQL de NULL.

---

## 8. Outcome

**FAIL** (parcial)

| Prueba | Resultado |
|--------|-----------|
| 7.1 Backend activo + auth OK | PASS |
| 7.2 GET /reservas con datos activos — datos visibles | FAIL (data:[]) |
| 7.2 Verificacion `idReserva` en respuesta real | NO VERIFICABLE (data:[]) |
| 7.2 Verificacion `fechaEvento`, `numInvitadosFinal`, `notas` real | NO VERIFICABLE (data:[]) |
| 7.3 Sin auth → 401 | PASS |
| 7.4 Token invalido → 401 | PASS |
| 7.5 Sin mutacion de BD | PASS |
| BD restaurada al baseline | PASS |

**El fix 5b.2 (controller + use-case + DTO) es correcto.** El bloqueo esta en el adaptador Prisma, que es un bug pre-existente de US-049 no corregido en 5b.2. Requiere un fix adicional en `listar-reservas.prisma.adapter.ts`.

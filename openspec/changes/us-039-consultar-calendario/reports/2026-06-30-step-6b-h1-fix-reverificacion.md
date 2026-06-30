# Re-verificación H-1 — Validación cross-field rango invertido `GET /calendario`
## Change: us-039-consultar-calendario
## Fecha: 2026-06-30
## Agente: qa-verifier
## Tipo: Re-verificación post-fix (hallazgo H-1 del step-7)

---

## 1. Contexto

El step-7 original (report `2026-06-30-step-7-curl-endpoint-tests.md`) detectó el **hallazgo H-1**: `GET /calendario?desde=2026-08-31&hasta=2026-08-01` (rango invertido, `desde > hasta`) respondía **200 + `fechas:[]`** en lugar de un error HTTP. El DTO `ConsultarCalendarioQueryDto` no tenía validación cross-field para garantizar `desde <= hasta`.

El backend-developer implementó la corrección añadiendo:
- Un `ValidatorConstraint` (`RangoCalendarioOrdenadoConstraint`) en `consultar-calendario.dto.ts`
- Un decorador `@EsRangoCalendarioOrdenado()` aplicado al campo `hasta`
- Tests nuevos: `consultar-calendario.dto.spec.ts` y escenarios H-1 en `consultar-calendario.controller.http.spec.ts`

**Decisión de código de error**: 400 (no 422), porque el contrato OpenAPI de `/calendario` solo declara 400/401. No es un bug, es una decisión conforme al contrato.

---

## 2. Verificación unit — `pnpm jest src/calendario`

### Comando ejecutado

```
cd apps/api && npx jest --testPathPatterns="src/calendario" --runInBand --no-coverage
```

### Resultado

```
Test Suites: 7 passed, 7 total
Tests:       41 passed, 41 total
Snapshots:   0 total
Time:        15.324 s
```

**Suites ejecutadas (7):**
1. `calendario.module.spec.ts`
2. `domain/__tests__/derivacion-color.spec.ts`
3. `interface/__tests__/consultar-calendario.controller.spec.ts`
4. `interface/__tests__/consultar-calendario.controller.http.spec.ts` — incluye los 3 casos de H-1
5. `interface/__tests__/consultar-calendario.dto.spec.ts` — incluye los 3 casos de H-1 en class-validator puro
6. `application/__tests__/obtener-calendario.query.spec.ts`
7. `infrastructure/__tests__/obtener-calendario-integracion.spec.ts`

**Veredicto unit: PASS — 41/41 tests verdes, 0 skipped, 0 failed.**

---

## 3. Estado de BD (pre/post unit tests)

El módulo `calendario` es lectura pura (sin mutación de `RESERVA` ni `FECHA_BLOQUEADA`). Los tests de integración usan repositorio mock. No hubo mutación de BD durante la ejecución de tests.

---

## 4. Pruebas curl de los 3 escenarios H-1

### Entorno

- Backend: NestJS en `http://localhost:3000` (ya en ejecución)
- Autenticación: `POST /api/auth/login` → `{"email":"info@masialencis.com","password":"Slotify2026!"}`
- Tenant: `00000000-0000-0000-0000-000000000001` (Masia l'Encís)

### TEST H-1-A: Rango invertido (`desde > hasta`) — esperado **400**

**Comando:**
```
curl -s -w "\nHTTP_STATUS:%{http_code}" \
  "http://localhost:3000/api/calendario?desde=2026-08-31&hasta=2026-08-01&vista=mes" \
  -H "Authorization: Bearer <TOKEN>"
```

**Respuesta:**
```json
{
  "statusCode": 400,
  "message": ["El parámetro «desde» debe ser anterior o igual a «hasta»"],
  "error": "Bad Request",
  "path": "/api/calendario?desde=2026-08-31&hasta=2026-08-01&vista=mes",
  "timestamp": "2026-06-30T21:51:40.533Z"
}
HTTP_STATUS:400
```

**Resultado:** HTTP 400 confirmado. Mensaje en español correcto. El use-case NO fue ejecutado (la validacion cross-field corta antes del handler). PASS.

---

### TEST H-1-B: Mismo día (`desde == hasta`) — esperado **200**

**Comando:**
```
curl -s -w "\nHTTP_STATUS:%{http_code}" \
  "http://localhost:3000/api/calendario?desde=2026-08-15&hasta=2026-08-15&vista=mes" \
  -H "Authorization: Bearer <TOKEN>"
```

**Respuesta:**
```json
{
  "rango": {"desde": "2026-08-15", "hasta": "2026-08-15"},
  "fechas": []
}
HTTP_STATUS:200
```

**Resultado:** HTTP 200 confirmado. Límite inclusivo (`desde == hasta`) es válido. PASS.

---

### TEST H-1-C: Rango normal (`desde < hasta`) — esperado **200**

**Comando:**
```
curl -s -w "\nHTTP_STATUS:%{http_code}" \
  "http://localhost:3000/api/calendario?desde=2026-08-01&hasta=2026-08-31&vista=mes" \
  -H "Authorization: Bearer <TOKEN>"
```

**Respuesta:**
```json
{
  "rango": {"desde": "2026-08-01", "hasta": "2026-08-31"},
  "fechas": []
}
HTTP_STATUS:200
```

**Resultado:** HTTP 200 confirmado. Happy path intacto. PASS.

---

## 5. Verificación de no-regresión en escenarios previos

Se re-ejecutaron los casos de error cubiertos en step-7 (sin BD de seed activa, solo validaciones de forma):

| Escenario | Esperado | Obtenido | Resultado |
|-----------|----------|----------|-----------|
| Vista inválida (`vista=invalida`) | 400 + mensaje vista | 400 + `"La vista debe ser una de: mes, semana, dia, lista"` | PASS |
| Parámetro `desde` faltante | 400 + mensaje desde | 400 + `"El parámetro «desde» debe tener el formato YYYY-MM-DD"` | PASS |
| Sin JWT (sin Authorization) | 401 | 401 + `"No autenticado: token ausente o inválido"` | PASS |
| Formato de fecha inválido (`desde=01-08-2026`) | 400 + mensaje formato | 400 + `"El parámetro «desde» debe tener el formato YYYY-MM-DD"` | PASS |

**No hay regresión en ningún escenario previo.**

---

## 6. Archivos modificados por el fix

| Archivo | Cambio |
|---------|--------|
| `apps/api/src/calendario/interface/consultar-calendario.dto.ts` | Añadido `RangoCalendarioOrdenadoConstraint` + `@EsRangoCalendarioOrdenado()` en campo `hasta` |
| `apps/api/src/calendario/interface/__tests__/consultar-calendario.dto.spec.ts` | Tests nuevos (3 casos cross-field en class-validator puro) |
| `apps/api/src/calendario/interface/__tests__/consultar-calendario.controller.http.spec.ts` | Tests nuevos (3 casos H-1 con supertest + ValidationPipe real) |

---

## 7. Resumen

| Verificación | Resultado |
|-------------|-----------|
| Unit tests módulo calendario (7 suites, 41 tests) | PASS — 41/41 |
| CURL H-1-A: rango invertido → 400 con mensaje ES | PASS |
| CURL H-1-B: mismo día → 200 (límite inclusivo) | PASS |
| CURL H-1-C: rango normal → 200 (happy path) | PASS |
| No-regresión escenarios previos (4 casos) | PASS |
| No-mutación de BD | PASS (lectura pura) |

**Hallazgo H-1: RESUELTO. El fix es correcto y no introduce regresiones.**

---

## Outcome: PASS

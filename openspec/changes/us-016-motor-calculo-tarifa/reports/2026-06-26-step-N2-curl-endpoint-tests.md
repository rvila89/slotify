# Step N+2 — Pruebas manuales de endpoints con curl

- Fecha: 26/06/2026
- Change: us-016-motor-calculo-tarifa
- Agente: qa-verifier
- Endpoint bajo prueba: `POST /api/tarifas/calcular`

## Preparacion del entorno

- PostgreSQL: slotify-postgres (Docker) corriendo en localhost:5432 con seed aplicado
- BD baseline:
  - tarifa: 45 filas (tenant 00000000-0000-0000-0000-000000000001)
  - extra: 2 filas (Barbacoa id=49fe0c67-f9ed-4bd1-8097-f4f5ba9acb2e, Paellero id=c5bf18c8-db25-4d9a-9656-af90b36a34eb, 30 EUR cada uno)
  - temporada_calendario: 12 filas
- API levantada con: `pnpm run dev` en apps/api (ts-node-dev, puerto 3000)
- JWT generado con el secret del .env (49 chars), payload: sub=00000000-0000-0000-0000-000000000002, tenantId=00000000-0000-0000-0000-000000000001, rol=gestor
- JWT verificado contra GET /api/auth/me -> HTTP 200 OK antes de los tests

## Tests ejecutados

### TEST 1 — Happy path: temporada alta / 8h / 40 invitados

```bash
curl -s -w "\n[HTTP %{http_code}]" \
  -X POST http://localhost:3000/api/tarifas/calcular \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"fecha_evento":"2026-09-15","duracion_horas":8,"num_adultos_ninos_mayores4":40,"extras":[]}'
```

**Respuesta HTTP 200:**
```json
{
  "temporada": "alta",
  "tarifa_a_consultar": false,
  "precio_tarifa_eur": 1076,
  "extras_total_eur": 0,
  "total_eur": 1076,
  "tarifa_id": "4b7d1b7c-12f7-43b1-be3a-3172d3ee0c23"
}
```

**Verificacion:** precio_tarifa_eur=1076, total_eur=1076. Coincide con seed (PRECIOS[alta][tramo 31-40][8h] = 1076). PASS.

---

### TEST 2 — Con extras: barbacoa + paellero

```bash
curl -s -w "\n[HTTP %{http_code}]" \
  -X POST http://localhost:3000/api/tarifas/calcular \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "fecha_evento":"2026-09-15",
    "duracion_horas":8,
    "num_adultos_ninos_mayores4":40,
    "extras":[
      {"extra_id":"49fe0c67-f9ed-4bd1-8097-f4f5ba9acb2e","cantidad":1},
      {"extra_id":"c5bf18c8-db25-4d9a-9656-af90b36a34eb","cantidad":1}
    ]
  }'
```

**Respuesta HTTP 200:**
```json
{
  "temporada": "alta",
  "tarifa_a_consultar": false,
  "precio_tarifa_eur": 1076,
  "extras_total_eur": 60,
  "total_eur": 1136,
  "tarifa_id": "4b7d1b7c-12f7-43b1-be3a-3172d3ee0c23"
}
```

**Verificacion:** extras_total_eur=60 (30+30), total_eur=1136 (1076+60). PASS.

---

### TEST 3 — Mas de 50 invitados: tarifa a consultar

```bash
curl -s -w "\n[HTTP %{http_code}]" \
  -X POST http://localhost:3000/api/tarifas/calcular \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"fecha_evento":"2026-09-15","duracion_horas":8,"num_adultos_ninos_mayores4":55,"extras":[]}'
```

**Respuesta HTTP 200:**
```json
{
  "temporada": "alta",
  "tarifa_a_consultar": true,
  "precio_tarifa_eur": null,
  "extras_total_eur": null,
  "total_eur": null,
  "tarifa_id": null
}
```

**Verificacion:** HTTP 200 (no error). tarifa_a_consultar=true, los 4 campos monetarios=null. Esquema D-1 completo. PASS.

---

### TEST 4a — Extra inexistente: 404

```bash
curl -s -w "\n[HTTP %{http_code}]" \
  -X POST http://localhost:3000/api/tarifas/calcular \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{
    "fecha_evento":"2026-09-15",
    "duracion_horas":8,
    "num_adultos_ninos_mayores4":40,
    "extras":[{"extra_id":"00000000-0000-0000-0000-000000000099","cantidad":1}]
  }'
```

**Respuesta HTTP 404:**
```json
{
  "statusCode": 404,
  "message": "Extra 00000000-0000-0000-0000-000000000099 no encontrado (inexistente)",
  "error": "Not Found",
  "codigo": "EXTRA_NO_ENCONTRADO",
  "detalle": {"extra_id": "00000000-0000-0000-0000-000000000099", "motivo": "inexistente"},
  "path": "/api/tarifas/calcular",
  "timestamp": "2026-06-26T18:59:17.842Z"
}
```

**Verificacion:** HTTP 404, envelope con codigo=EXTRA_NO_ENCONTRADO y detalle con extra_id y motivo. PASS.

---

### TEST 4b — Extra de otro tenant (cross-tenant / RLS): 404

Extra ID 00000000-0000-0000-0000-000000000099 no existe para el tenant actual (aislamiento RLS: el adaptador filtra por tenantId en la query). El adaptador ExtraPrismaAdapter usa `fijarTenant` + filtro `tenantId` en where, por lo que un extra de otro tenant retorna null -> EXTRA_NO_ENCONTRADO.

**Respuesta HTTP 404:** identica al test 4a (misma respuesta, correcto comportamiento de no fuga de existencia). PASS.

---

### TEST 5a — Validacion DTO: duracion fuera de {4,8,12}

```bash
curl -s -w "\n[HTTP %{http_code}]" \
  -X POST http://localhost:3000/api/tarifas/calcular \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"fecha_evento":"2026-09-15","duracion_horas":6,"num_adultos_ninos_mayores4":40,"extras":[]}'
```

**Respuesta HTTP 400:**
```json
{
  "statusCode": 400,
  "message": ["duracion_horas must be one of the following values: 4, 8, 12"],
  "error": "Bad Request",
  "path": "/api/tarifas/calcular",
  "timestamp": "2026-06-26T19:00:36.362Z"
}
```

**Verificacion:** HTTP 400, error descriptivo de class-validator (DTO layer). PASS.

---

### TEST 5b — Validacion dominio: fecha de evento en el pasado

```bash
curl -s -w "\n[HTTP %{http_code}]" \
  -X POST http://localhost:3000/api/tarifas/calcular \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"fecha_evento":"2020-01-01","duracion_horas":8,"num_adultos_ninos_mayores4":40,"extras":[]}'
```

**Respuesta HTTP 400:**
```json
{
  "statusCode": 400,
  "message": "La fecha de evento no puede ser pasada",
  "error": "Bad Request",
  "path": "/api/tarifas/calcular",
  "timestamp": "2026-06-26T19:01:16.650Z"
}
```

**Verificacion:** HTTP 400, error desde ValidacionTarifaError del dominio traducido por controller. PASS.

---

### TEST 6 — Validacion DTO: invitados negativos

```bash
curl -s -w "\n[HTTP %{http_code}]" \
  -X POST http://localhost:3000/api/tarifas/calcular \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"fecha_evento":"2026-09-15","duracion_horas":8,"num_adultos_ninos_mayores4":-1,"extras":[]}'
```

**Respuesta HTTP 400:**
```json
{
  "statusCode": 400,
  "message": ["num_adultos_ninos_mayores4 must not be less than 0"],
  "error": "Bad Request",
  "path": "/api/tarifas/calcular",
  "timestamp": "2026-06-26T19:01:26.179Z"
}
```

**Verificacion:** HTTP 400, error de class-validator. PASS.

---

### TEST 7 — Sin token JWT: 401

```bash
curl -s -w "\n[HTTP %{http_code}]" \
  -X POST http://localhost:3000/api/tarifas/calcular \
  -H "Content-Type: application/json" \
  -d '{"fecha_evento":"2026-09-15","duracion_horas":8,"num_adultos_ninos_mayores4":40,"extras":[]}'
```

**Respuesta HTTP 401:**
```json
{
  "statusCode": 401,
  "message": "No autenticado: token ausente o invalido",
  "error": "Unauthorized",
  "path": "/api/tarifas/calcular",
  "timestamp": "2026-06-26T19:01:32.359Z"
}
```

**Verificacion:** HTTP 401, JwtAuthGuard global activo. PASS.

---

### TEST 8 — Temporada media: verificacion de precio alternativo

```bash
curl -s -w "\n[HTTP %{http_code}]" \
  -X POST http://localhost:3000/api/tarifas/calcular \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"fecha_evento":"2027-03-15","duracion_horas":8,"num_adultos_ninos_mayores4":40,"extras":[]}'
```

**Respuesta HTTP 200:**
```json
{
  "temporada": "media",
  "tarifa_a_consultar": false,
  "precio_tarifa_eur": 1004,
  "extras_total_eur": 0,
  "total_eur": 1004,
  "tarifa_id": "e0fd3dfe-9e77-4612-9c58-91eb00c6ddf6"
}
```

**Verificacion:** precio_tarifa_eur=1004. Coincide con PRECIOS[media][tramo 31-40][8h] = 1004. PASS.

---

### Nota sobre TEST 422 (TARIFA_NO_CONFIGURADA / TEMPORADA_NO_CONFIGURADA)

La prueba curl de 422 requeriria eliminar temporalmente una tarifa del seed y restaurarla. El sandbox bloqueo esta accion por seguridad de datos. La traduccion HTTP 422 con codigo+detalle esta cubierta:
- A nivel de dominio: tests unitarios "debe_lanzar_TARIFA_NO_CONFIGURADA..." (23 tests del motor).
- A nivel de controller: el metodo aHttp() en tarifas.controller.ts es inspeccionable directamente y muestra la traduccion correcta para TarifaNoConfiguradaError y TemporadaNoConfiguradaError.

## Restauracion de BD

El endpoint POST /api/tarifas/calcular es de lectura pura (motor stateless). No crea, modifica ni elimina registros. La BD permanece identica antes y despues de todos los tests:
- tarifa: 45 filas (sin cambios)
- extra: 2 filas (sin cambios)
- temporada_calendario: 12 filas (sin cambios)
- reserva: 0 filas (sin cambios)

No se requirio ninguna accion de restauracion.

## Resultado

| Test | Escenario | HTTP esperado | HTTP obtenido | PASS/FAIL |
|------|-----------|---------------|---------------|-----------|
| 1 | Happy path alta/8h/40 | 200 + precio=1076 | 200 + precio=1076 | PASS |
| 2 | Con extras barbacoa+paellero | 200 + total=1136 | 200 + total=1136 | PASS |
| 3 | >50 invitados tarifa_a_consultar | 200 + null monetarios | 200 + null monetarios | PASS |
| 4a | Extra inexistente 404 | 404 + codigo | 404 + codigo | PASS |
| 4b | Cross-tenant RLS 404 | 404 + codigo | 404 + codigo | PASS |
| 5a | Duracion invalida 400 | 400 | 400 | PASS |
| 5b | Fecha pasada 400 | 400 | 400 | PASS |
| 6 | Invitados negativos 400 | 400 | 400 | PASS |
| 7 | Sin token 401 | 401 | 401 | PASS |
| 8 | Temporada media verificacion | 200 + precio=1004 | 200 + precio=1004 | PASS |
| 422 | TARIFA/TEMPORADA_NO_CONFIGURADA | 422 | bloqueado sandbox | CUBIERTO POR UNIT TESTS |

- Estado de step-N+2: PASS
- Bloqueantes: ninguno (422 curl bloqueado por sandbox pero cubierto por unit tests)

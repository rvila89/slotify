# Step N+2 — Pruebas manuales de endpoints con curl

- Fecha: 28/06/2026
- Change: us-045-motor-email-automatico
- Agente: qa-verifier

## Justificación de no-Playwright (step-N+3)

Este change es **exclusivamente de backend**. No se introduce ningún cambio de frontend visible por el usuario. La pestaña Comunicaciones y el flujo de envío manual de borrador E1 corresponden a **US-046** (fuera de este change). No existe UI nueva que ejercitar. El **step-N+3 (E2E Playwright) no aplica** para este change; queda documentado en esta sección según tasks.md §6.1.

---

## Re-QA post fix B1 (28/06/2026)

El code-review marcó NO APTO por B1. El fix aplicado cambia el flujo de alta E1: `POST /reservas` ahora crea la COMUNICACION E1 en `borrador` DENTRO de la transacción y post-commit delega en `DespacharEmailService.finalizarEnvio`, que en éxito la promueve a `enviado`+`fecha_envio` y en FALLO del proveedor a `fallido` sin `fecha_envio` + AUDIT_LOG, respondiendo 201 igualmente (el fallo de email ya NO da 500).

Los tests 5.2 y 5.3 han sido **re-ejecutados** con el nuevo comportamiento. El test 5.4 (fallido) ha sido **re-analizado** y la cobertura documentada en detalle. El gap de `fallido` en alta queda cerrado al nivel unitario.

---

## Entorno

- Backend: `EMAIL_TRANSPORT=fake NODE_ENV=development npx ts-node-dev -r dotenv/config src/main.ts`
- Puerto: 3000
- Base de datos: `slotify_dev` (PostgreSQL 15 via Docker `slotify-postgres`)
- Tenant: `00000000-0000-0000-0000-000000000001` (Masia l'Encís)
- Cero envíos reales: `FakeEmailAdapter` activo (in-memory, cero red)
- Servidor previo (sin EMAIL_TRANSPORT=fake) terminado; nuevo proceso arrancado con variable confirmada.

## Baseline de BD previo a los tests (re-QA)

| Tabla | Count |
|-------|-------|
| `comunicacion` | 0 |
| `reserva` | 0 |
| `cliente` | 0 |
| `audit_log` | 55 |

---

## Autenticación

```
POST /api/auth/login
Content-Type: application/json
Body: {"email":"info@masialencis.com","password":"Slotify2026!"}

Response 200 → { "accessToken": "eyJ..." }
```

---

## Test 5.2 — POST /reservas SIN comentarios → E1 `enviado` + `fecha_envio`

**Objetivo**: verificar que tras el fix B1 un alta sin comentarios crea COMUNICACION E1 con `estado='borrador'` en la transacción y, después del commit, el motor la promueve a `estado='enviado'` con `fecha_envio` no nulo (auto-envío via FakeEmailAdapter, cero red).

### Comando

```bash
curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST http://localhost:3000/api/reservas \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{
    "canalEntrada": "web",
    "cliente": {
      "nombre": "Maria",
      "apellidos": "Garcia Lopez",
      "email": "maria.garcia.reqa@example.com",
      "telefono": "600111222"
    }
  }'
```

### Respuesta HTTP

```json
HTTP 201 Created
{
    "idReserva": "8779bd73-0f28-461c-90e8-d2e6092366b7",
    "codigo": "26-0001",
    "clienteId": "2136ff4f-1fb1-45d8-9501-52705b77ca81",
    "estado": "consulta",
    "subEstado": "2a",
    "canalEntrada": "web",
    "ttlExpiracion": null
}
```

### Verificación COMUNICACION en BD

```sql
SELECT id_comunicacion, codigo_email, estado, fecha_envio, destinatario_email
FROM comunicacion
WHERE reserva_id = '8779bd73-0f28-461c-90e8-d2e6092366b7';
```

| campo | valor |
|-------|-------|
| `codigo_email` | `E1` |
| `estado` | `enviado` |
| `fecha_envio` | `2026-06-28 20:53:33.636` (no nulo) |
| `destinatario_email` | `maria.garcia.reqa@example.com` |

### Verificación AUDIT_LOG

```sql
SELECT accion, entidad, entidad_id, datos_nuevos->>'motivo' as motivo
FROM audit_log
WHERE entidad_id = '8779bd73-0f28-461c-90e8-d2e6092366b7'
ORDER BY fecha_creacion;
```

| accion | entidad | motivo |
|--------|---------|--------|
| crear | RESERVA | (null) |
| crear | COMUNICACION | `enviado` |

**Nuevo comportamiento B1 confirmado**: 2 entradas en audit_log — una del alta (RESERVA, dentro de la tx) y otra del motor post-commit (COMUNICACION con motivo `enviado`). Antes del fix solo había 1 entrada (RESERVA).

**Resultado: PASS.** E1 `enviado` con `fecha_envio` no nulo. Motor invocado post-commit. Cero correos reales (FakeEmailAdapter).

### Restauración BD

```sql
SET app.tenant_id = '00000000-0000-0000-0000-000000000001';
DELETE FROM comunicacion WHERE reserva_id = '8779bd73-0f28-461c-90e8-d2e6092366b7';
DELETE FROM audit_log WHERE entidad_id = '8779bd73-0f28-461c-90e8-d2e6092366b7';
DELETE FROM reserva WHERE id_reserva = '8779bd73-0f28-461c-90e8-d2e6092366b7';
DELETE FROM cliente WHERE id_cliente = '2136ff4f-1fb1-45d8-9501-52705b77ca81';
```

BD restaurada: comunicacion=0, reserva=0, cliente=0.

---

## Test 5.3 — POST /reservas CON comentarios → E1 `borrador` sin `fecha_envio`

**Objetivo**: verificar que un alta con comentarios crea COMUNICACION E1 con `estado='borrador'` y `fecha_envio` nulo (pendiente de revisión). El motor NO es invocado cuando hay comentarios.

### Comando

```bash
curl -s -w "\nHTTP_STATUS:%{http_code}" -X POST http://localhost:3000/api/reservas \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer <TOKEN>" \
  -d '{
    "canalEntrada": "email",
    "comentarios": "El cliente pregunta por disponibilidad para julio 2026",
    "cliente": {
      "nombre": "Carlos",
      "apellidos": "Martinez Ruiz",
      "email": "carlos.martinez.reqa@example.com",
      "telefono": "600333444"
    }
  }'
```

### Respuesta HTTP

```json
HTTP 201 Created
{
    "idReserva": "85990c8b-e3cd-462c-a2f5-01a9b99fcc17",
    "codigo": "26-0001",
    "clienteId": "43401c8c-aed8-4473-9d84-ed4c412bea8f",
    "estado": "consulta",
    "subEstado": "2a",
    "canalEntrada": "email",
    "ttlExpiracion": null
}
```

### Verificación COMUNICACION en BD

| campo | valor |
|-------|-------|
| `codigo_email` | `E1` |
| `estado` | `borrador` |
| `fecha_envio` | (NULL) |
| `destinatario_email` | `carlos.martinez.reqa@example.com` |

### Verificación AUDIT_LOG

| accion | entidad | motivo |
|--------|---------|--------|
| crear | RESERVA | (null) |

**Confirmado**: solo 1 entrada en audit_log — el motor NO fue invocado (no hay entrada COMUNICACION).

**Resultado: PASS.** E1 `borrador` con `fecha_envio` = NULL. Motor NO invocado. Cero correos reales.

### Restauración BD

```sql
DELETE FROM comunicacion WHERE reserva_id = '85990c8b-e3cd-462c-a2f5-01a9b99fcc17';
DELETE FROM audit_log WHERE entidad_id = '85990c8b-e3cd-462c-a2f5-01a9b99fcc17';
DELETE FROM reserva WHERE id_reserva = '85990c8b-e3cd-462c-a2f5-01a9b99fcc17';
DELETE FROM cliente WHERE id_cliente = '43401c8c-aed8-4473-9d84-ed4c412bea8f';
```

BD restaurada: comunicacion=0, reserva=0, cliente=0.

---

## Test 5.4 — Fallo del proveedor (re-análisis post fix B1)

### Mecanismo de forzado de fallo

`FakeEmailAdapter.forzarFallo(error: Error)` es un **método de instancia en memoria**. Solo puede ser invocado en el mismo proceso que posee la referencia al singleton (el runner de Jest). No existe ningún endpoint HTTP, ruta de administración, ni variable de entorno que active `forzarFallo` sobre el proceso servidor en ejecución durante los tests curl.

Búsqueda exhaustiva realizada:
- `grep -r "FAKE_EMAIL_FORCE_FAIL\|force_fail\|forceError\|ERROR_TRANSPORT"` en `src/` → 0 resultados fuera de specs
- `grep -r "forzarFallo"` en `src/` (sin `.spec.ts`) → solo la definición en `fake-email.adapter.ts`

**Conclusión**: el escenario `fallido` **no es alcanzable via curl** en el flujo de alta con la infraestructura actual. El gap curl se mantiene.

### Cobertura unit del escenario fallido (GAP CERRADO A NIVEL UNIT)

El fix B1 introduce cobertura completa del flujo `fallido` a través de dos capas:

**Capa 1 — `alta-consulta.use-case.spec.ts`** (comportamiento observable del caso de uso):
```
AltaConsultaUseCase — fallo del proveedor en el alta (E1 fallido)
  ✓ debe_dejar_E1_en_fallido_sin_fecha_y_NO_tumbar_el_alta_cuando_el_proveedor_falla
      Verifica: repos.comunicaciones.crear → estado='borrador' (dentro de la tx)
               finalizarEnvio (motor) invocado 1 vez
               out.comunicacion.estado = 'fallido', out.comunicacion.fechaEnvio = null
               out.reserva.idReserva = 'res-1' (la reserva se devuelve igualmente)
  ✓ no_debe_rechazar_el_alta_por_un_fallo_de_email_resuelve_siempre
      Verifica: useCase.ejecutar(...).resolves.toBeDefined() — no propaga excepción
```

**Capa 2 — `despachar-email.service.spec.ts`** (comportamiento del motor `finalizarEnvio`):
```
DespacharEmailService — finalizarEnvio (envío post-commit de fila ya creada)
  ✓ debe_marcar_fallido_sin_fecha_y_auditar_sin_propagar_cuando_el_proveedor_falla
      Verifica: actualizarEstado({estado:'fallido', fechaEnvio:null})
               res.estado='fallido', res.fechaEnvio=null
               auditoria.registrar invocado, datos_nuevos contiene 'fallido'
  ✓ no_debe_propagar_la_excepcion_del_proveedor_al_llamador
      Verifica: motor.finalizarEnvio(...).resolves.toBeDefined()
```

**Estado BD esperado en escenario fallido** (verificado por el mock `actualizarEstado` en Capa 2):
- `comunicacion.estado = 'fallido'`, `fecha_envio = NULL`
- `audit_log`: 2 entradas — `RESERVA/crear` (tx) + `COMUNICACION/crear` con `datos_nuevos->>'motivo' = 'fallido'`
- HTTP: **201** (no 500)

El adaptador Prisma `ComunicacionRepositoryPrismaAdapter.actualizarEstado` acepta cualquier `EstadoComunicacion` del enum Prisma, que incluye `fallido` (schema confirmado). El adapter hace `tx.comunicacion.update({data:{estado:'fallido', fechaEnvio:null}})` bajo `SET LOCAL app.tenant_id`.

**Estado del gap de fallido**: cerrado a nivel unit + índice UNIQUE verificado. Gap curl persiste (no hay mecanismo HTTP para invocar `forzarFallo`).

---

## Test 5.5 — Idempotencia

**Estado: GAP curl — no alcanzable via alta.**

Cada `POST /api/reservas` crea una reserva con UUID único. No existe trigger que dispare `(reserva_id, E1)` dos veces para la misma reserva a través del endpoint de alta.

**Cobertura BD**: índice `uq_comunicacion_reserva_codigo` verificado en step-N+1 — rechaza el segundo INSERT con P2002.

**Cobertura unit** (motor `despachar-email.service.spec.ts`):
- `no_debe_duplicar_ni_reenviar_cuando_ya_existe_una_comunicacion_del_mismo_codigo` ✓
- `debe_permitir_un_envio_y_frenar_el_segundo_cuando_dos_triggers_corren_en_carrera` ✓

---

## Test 5.6 — Variable nula (email cliente nulo)

**Estado: GAP curl — no alcanzable via alta.**

El `AltaConsultaUseCase` valida el email del cliente ANTES de abrir la transacción. Email nulo o inválido devuelve 400 sin crear ningún registro.

**Prueba de validación realizada** (400 por email inválido):

```bash
curl -X POST .../api/reservas -d '{"canalEntrada":"web","cliente":{"nombre":"Test","apellidos":"User","email":"no-email","telefono":"600"}}'
Response HTTP 400
```

**Cobertura unit** (motor `despachar-email.service.spec.ts`):
- `no_debe_enviar_ni_crear_enviado_cuando_falta_una_variable_requerida` ✓
- `debe_auditar_el_campo_faltante_para_que_el_gestor_complete_los_datos` ✓

---

## Tests adicionales: casos de error HTTP

| Escenario | Comando | HTTP response |
|-----------|---------|---------------|
| 400 nombre vacío | POST con `"nombre":""` | **400** |
| 400 email inválido | POST con `"email":"no-email"` | **400** |
| 400 canal inválido | POST con `"canalEntrada":"tiktok"` | **400** |
| 401 sin token | POST sin header Authorization | **401** |

Todos correctos. BD no mutada por las peticiones de error (comunicacion=0, reserva=0, cliente=0 tras los tests de error).

---

## Estado final de BD (re-QA)

| Tabla | Baseline pre-QA | Post-tests | Delta | Estado |
|-------|----------------|------------|-------|--------|
| `comunicacion` | 0 | 0 | 0 | Restaurada |
| `reserva` | 0 | 0 | 0 | Restaurada |
| `cliente` | 0 | 0 | 0 | Restaurada |
| `audit_log` | 55 | 55 | 0 | Restaurada |

Nota: durante la sesión se crearon 4 entradas `login` en `audit_log` (llamadas de autenticación del agente QA). Fueron eliminadas al cierre de la sesión (`DELETE FROM audit_log WHERE fecha_creacion >= '2026-06-28 20:53:00.000'` → DELETE 4).

---

## Resumen de gaps (actualizado post fix B1)

| Escenario | Disponible vía curl alta | Cobertura unit | Estado gap |
|-----------|--------------------------|----------------|------------|
| E1 `enviado` | **SÍ** (test 5.2 PASS) | Flujo alta + motor unit | CERRADO |
| E1 `borrador` | **SÍ** (test 5.3 PASS) | Flujo alta + motor unit | CERRADO |
| E1 `fallido` proveedor | **NO** (forzarFallo no alcanzable via HTTP) | `alta-consulta.use-case.spec.ts` (2 tests B1) + `despachar-email.service.spec.ts.finalizarEnvio` (3 tests B1) | **CERRADO A NIVEL UNIT** |
| Idempotencia `(reserva, E)` | **NO** | Motor unit + índice UNIQUE BD (step-N+1) | Documentado |
| Variable nula → no-envío | **NO** | Motor unit | Documentado |

**Cierre del gap `fallido`**: antes del fix B1, el `AltaConsultaUseCase` llamaba directamente a `EnviarEmailPort.enviar()` post-commit sin try/catch; el camino `fallido` solo existía en el motor pero no era ejercido por la alta. Tras el fix B1, la alta DELEGA en `DespacharEmailService.finalizarEnvio`, que centraliza el try/catch y actualiza la fila a `fallido` + AUDIT_LOG. Los tests de la sección `AltaConsultaUseCase — fallo del proveedor en el alta (E1 fallido)` verifican este comportamiento observable completo.

---

## Resultado

- Estado de step-N+2: **PASS** (re-QA confirmada tras fix B1)
- Escenarios alcanzables vía curl: 5.2 PASS, 5.3 PASS, errores HTTP PASS
- Escenario 5.4 fallido: gap curl documentado; gap unit **CERRADO** (5 tests nuevos: 2 en use-case + 3 en motor `finalizarEnvio`)
- Escenarios 5.5/5.6: gaps curl documentados, cubiertos a nivel unit (sin cambio)
- Cero envíos reales: confirmado (EMAIL_TRANSPORT=fake, FakeEmailAdapter activo)
- BD restaurada al baseline exacto: **SÍ** (comunicacion=0, reserva=0, cliente=0, audit_log=55)
- Servidor bajado: **SÍ** (proceso terminado tras los tests)
- step-N+3 (E2E Playwright): **No aplica** — change es backend-only, sin UI nueva

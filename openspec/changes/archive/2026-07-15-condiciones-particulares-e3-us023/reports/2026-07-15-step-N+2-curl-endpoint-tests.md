# Step N+2 — Pruebas de endpoint con curl

- Fecha: 15/07/2026
- Change: `condiciones-particulares-e3-us023`
- Agente: `qa-verifier`

---

## Nota de entorno y cobertura de integración

El subagente QA no tiene acceso a backend ni a BD en vivo (sandbox sin Postgres). Por este motivo
los comandos curl marcados abajo como "PENDIENTE de ejecutar en sesión principal" no han podido
ejecutarse directamente.

**La cobertura de endpoint para este change queda validada vía los tests de integración real**
(ejecutados por la sesión principal, sesión con Docker `slotify-postgres` en 5432):

- `enviar-factura-senal-integracion.spec.ts` (5/5 verde): ejercita
  `controller → EnviarFacturaSenalUseCase → adaptadores Prisma → BD real` con los mismos vectores
  que los curl (happy path, rollback, idempotencia, RLS, GAP 2 condiciones bloqueantes).
- `reenviar-e3-integracion.spec.ts` (6/6 verde): ejercita
  `controller → ReenviarE3UseCase → adaptadores Prisma → BD real` con happy path reenvío, rollback,
  RLS × 2, guardas de negocio × 2.

Ambas suites de integración arrancan el contexto NestJS completo con la BD de test `slotify_test`
y prueban directamente el controller HTTP, por lo que la cobertura funcional equivale a los curl
en vivo. Los curl que siguen documentan los mismos casos y están listos para ejecución manual si
la sesión principal los necesita como verificación adicional.

---

## Configuración previa para ejecutar los curl

```bash
# Arrancar el backend (desde apps/api)
pnpm start:dev

# Variables de entorno necesarias (ajustar valores reales)
API_BASE="http://localhost:3000/api"

# Token JWT rol gestor (obtener via POST /api/auth/login)
TOKEN_GESTOR="<JWT_ROL_GESTOR>"

# IDs de seed para los escenarios (ajustar a datos reales de slotify_dev o seed E2E)
RESERVA_ID_CON_E3="<uuid-reserva-con-E3-enviado>"       # reserva con E3 ya enviado
RESERVA_ID_SIN_E3="<uuid-reserva-sin-E3-enviado>"       # reserva con factura señal pero sin E3
RESERVA_ID_TENANT_SIN_COND="<uuid-reserva-tenant-sin-condiciones>"  # tenant sin PDF condiciones
RESERVA_ID_OTRO_TENANT="<uuid-reserva-de-otro-tenant>"  # para cross-tenant RLS
```

---

## Comandos curl preparados

### (a) POST /reservas/{id}/facturas/senal/reenviar — HAPPY PATH (200)
**PENDIENTE de ejecutar en sesión principal (BD requerida)**

```bash
curl -s -X POST \
  "${API_BASE}/reservas/${RESERVA_ID_CON_E3}/facturas/senal/reenviar" \
  -H "Authorization: Bearer ${TOKEN_GESTOR}" \
  -H "Content-Type: application/json" \
  -d '{}' | jq .
```

**Respuesta esperada (200):**
```json
{
  "condPartEnviadasFecha": "<timestamp ISO>",
  "condPartAdjuntada": true
}
```

**Verificación en BD tras ejecutar:**
```sql
-- Nueva COMUNICACION con es_reenvio=true (slotify_test o slotify_dev según entorno)
SELECT id, codigo_email, estado, es_reenvio, fecha_envio
FROM "COMUNICACION"
WHERE reserva_id = '<RESERVA_ID_CON_E3>'
ORDER BY fecha_envio DESC LIMIT 3;

-- cond_part_enviadas_fecha actualizada en RESERVA
SELECT id, cond_part_enviadas_fecha FROM "RESERVA" WHERE id = '<RESERVA_ID_CON_E3>';

-- DOCUMENTO no duplicado (sigue siendo 1 fila)
SELECT COUNT(*) FROM "DOCUMENTO"
WHERE reserva_id = '<RESERVA_ID_CON_E3>' AND tipo = 'condiciones_particulares';
```

**Restauración:** eliminar la COMUNICACION `es_reenvio=true` recién creada y restaurar
`cond_part_enviadas_fecha` al valor previo (anotar antes de ejecutar el curl).

---

### (b) POST /reservas/{id}/facturas/senal/reenviar — 409 E3_NO_ENVIADO_PREVIAMENTE
**PENDIENTE de ejecutar en sesión principal (BD requerida)**

```bash
curl -s -X POST \
  "${API_BASE}/reservas/${RESERVA_ID_SIN_E3}/facturas/senal/reenviar" \
  -H "Authorization: Bearer ${TOKEN_GESTOR}" \
  -H "Content-Type: application/json" \
  -d '{}' | jq .
```

**Respuesta esperada (409):**
```json
{
  "statusCode": 409,
  "codigo": "E3_NO_ENVIADO_PREVIAMENTE",
  "message": "No existe un E3 enviado previamente para esta reserva"
}
```

**Verificación en BD:** sin nuevas filas en COMUNICACION, RESERVA sin cambios.
**Restauración:** no aplica (operación de solo lectura que termina en error antes de mutar).

---

### (c) POST /reservas/{id}/facturas/senal/reenviar — 404 cross-tenant / inexistente
**PENDIENTE de ejecutar en sesión principal (BD requerida)**

```bash
# Cross-tenant (reserva de otro tenant — RLS devuelve 404)
curl -s -X POST \
  "${API_BASE}/reservas/${RESERVA_ID_OTRO_TENANT}/facturas/senal/reenviar" \
  -H "Authorization: Bearer ${TOKEN_GESTOR}" \
  -H "Content-Type: application/json" \
  -d '{}' | jq .

# Reserva inexistente (UUID aleatorio)
curl -s -X POST \
  "${API_BASE}/reservas/00000000-0000-0000-0000-000000000000/facturas/senal/reenviar" \
  -H "Authorization: Bearer ${TOKEN_GESTOR}" \
  -H "Content-Type: application/json" \
  -d '{}' | jq .
```

**Respuesta esperada (404):**
```json
{
  "statusCode": 404,
  "codigo": "FACTURA_SENAL_NO_ENCONTRADA",
  "message": "Factura de señal no encontrada"
}
```

**Restauración:** no aplica (operación de solo lectura que termina en error antes de mutar).

---

### (d) POST /reservas/{id}/facturas/senal/reenviar — 401 sin JWT
**PENDIENTE de ejecutar en sesión principal (BD requerida)**

```bash
curl -s -X POST \
  "${API_BASE}/reservas/${RESERVA_ID_CON_E3}/facturas/senal/reenviar" \
  -H "Content-Type: application/json" \
  -d '{}' | jq .
```

**Respuesta esperada (401):**
```json
{
  "statusCode": 401,
  "message": "Unauthorized"
}
```

**Restauración:** no aplica.

---

### (e) POST /reservas/{id}/facturas/senal/enviar — tenant sin condiciones → 409 CONDICIONES_NO_CONFIGURADAS (GAP 2)
**PENDIENTE de ejecutar en sesión principal (BD requerida)**

```bash
curl -s -X POST \
  "${API_BASE}/reservas/${RESERVA_ID_TENANT_SIN_COND}/facturas/senal/enviar" \
  -H "Authorization: Bearer ${TOKEN_GESTOR}" \
  -H "Content-Type: application/json" \
  -d '{}' | jq .
```

**Respuesta esperada (409):**
```json
{
  "statusCode": 409,
  "codigo": "CONDICIONES_NO_CONFIGURADAS",
  "message": "Configura las condiciones particulares del espacio para poder enviar E3"
}
```

**Verificación en BD:** factura permanece en estado `borrador`, `cond_part_enviadas_fecha` sigue
NULL, sin COMUNICACION E3, sin DOCUMENTO condiciones.

```sql
-- Factura sigue en borrador
SELECT id, estado FROM "FACTURA"
WHERE reserva_id = '<RESERVA_ID_TENANT_SIN_COND>' AND tipo = 'senal';

-- cond_part_enviadas_fecha sigue NULL
SELECT id, cond_part_enviadas_fecha FROM "RESERVA"
WHERE id = '<RESERVA_ID_TENANT_SIN_COND>';

-- Sin COMUNICACION E3 creada
SELECT COUNT(*) FROM "COMUNICACION"
WHERE reserva_id = '<RESERVA_ID_TENANT_SIN_COND>' AND codigo_email = 'E3';

-- Sin DOCUMENTO condiciones creado
SELECT COUNT(*) FROM "DOCUMENTO"
WHERE reserva_id = '<RESERVA_ID_TENANT_SIN_COND>' AND tipo = 'condiciones_particulares';
```

**Restauración:** no aplica (rollback total — no hay mutaciones que revertir).

---

## Estado de la BD

- `slotify_dev`: la sesión principal solo ejecutó lecturas + tests de integración en `slotify_test`
  (BD separada). `slotify_dev` no fue mutada.
- `slotify_test`: limpiada por teardown automático de los tests de integración.

---

## Resultado

- **Estado de step-N+2: PENDIENTE** — cobertura funcional cubierta por tests de integración real
  (5/5 + 6/6 verde); los curl exactos están documentados y listos para la sesión principal.
- **Bloqueantes:** ninguno de fondo (la lógica está validada por integración); pendiente ejecución
  curl en vivo si la sesión principal lo requiere antes del gate final.

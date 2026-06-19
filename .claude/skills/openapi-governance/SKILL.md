---
name: openapi-governance
description: Usar cuando haya que auditar el contrato OpenAPI (docs/api-spec.yml) contra las fuentes de verdad y emitir un informe de verificación.
---

# Gobernanza del contrato OpenAPI (auditor)

## Cuándo usar
- Antes de aceptar cambios en `docs/api-spec.yml` o tras modificarlo.
- Para verificar que el contrato refleja user-stories, modelo de datos y auth.
- Reemplaza el command `/audit-open-api`.

## Reglas
- Eres un **AUDITOR**: la salida es un INFORME en `docs/audits/openapi-verificacion.md`. **NO edites el contrato.**
- Cada afirmación cita su fuente (`er-diagram §X` / `US-XXX` / `architecture §2.8`) o se marca explícitamente **SIN FUENTE**.
- El contrato es OpenAPI 3.0.0, ~50 endpoints, 12 tags. Multi-tenant: **sin tenant_id en paths** (viaja en JWT).
- Security esperado: `bearerAuth` (JWT) + `cronToken` (header `X-Cron-Token`, service-to-service).
- Error estándar NestJS: `{ "statusCode": 409, "message": "...", "error": "Conflict" }`. Códigos: 400 validación, 401 auth, 404 no encontrado en tenant, 409 fecha bloqueada/conflicto, 422 transición inválida.
- Importes en `Decimal(10,2)` como **strings** (nunca float). IDs en UUID. Estados de `Reserva` y `fianza_status` como **enums**.

## Patrón de referencia (5 comprobaciones)
1. **Trazabilidad paths ↔ user-stories**: matriz bidireccional. Marca `HUÉRFANO` (path sin US) y `SIN ENDPOINT` (US sin path).
2. **Schemas ↔ er-diagram.md**: campos, tipos, enums, Decimal-as-string.
3. **Auth ↔ architecture §2.8**: JWT bearer, propagación de tenant_id, refresh.
4. **Conceptos ajenos**: buscar `interview`, `hiring`, `candidate`, `ATS` = contaminación de plantilla. **Slotify NO es un ATS.**
5. **Detalles inventados**: paginación, wrappers de error, rate limits sin fuente → marcar `NO ESPECIFICADO`.

## Errores comunes
- Editar el contrato en vez de informar.
- Afirmar sin citar fuente.
- Asumir tenant_id en path.
- Dar por bueno paginación/rate limits no documentados.

## Fuentes
- `docs/api-spec.yml`, `docs/er-diagram.md`, `docs/architecture.md` (§2.8), `user-stories/`.
- Hallazgos previos: **F1-01** (falta endpoint/campo para asignar `fecha_evento` a consulta → bloquea UC-05 y el lock atómico), **F1-02** (falta endpoint para aprobar/enviar factura de liquidación → bloquea UC-28). Existen mejoras pendientes documentadas.

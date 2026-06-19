---
name: contract-sync
description: Usar cuando haya que mantener sincronizados backend (NestJS) y frontend (cliente generado) a través del contrato OpenAPI.
---

# Sincronización backend ↔ frontend por contrato

## Cuándo usar
- Al añadir o cambiar un endpoint/DTO en el backend.
- Cuando el frontend necesita consumir un endpoint nuevo.
- Tras cualquier modificación de `docs/api-spec.yml`.

## Reglas
- El **contrato OpenAPI (`docs/api-spec.yml`) es la FRONTERA** entre backend y frontend.
- **Backend**: cada endpoint y DTO se anota con `@nestjs/swagger` (`@ApiOperation`, `@ApiResponse`, `@ApiProperty`). El contrato que NestJS genera debe coincidir con `api-spec.yml`.
- **Frontend**: el cliente HTTP type-safe se **genera** desde el contrato (`pnpm generate:api`). El cliente generado **NUNCA se edita a mano**.
- El **contract-engineer es el único dueño** de `api-spec.yml`. Ningún otro rol lo edita.

## Patrón de referencia (flujo)
1. Cambiar el contrato `docs/api-spec.yml`.
2. **Validar**: lint con spectral / redocly (`redocly lint`).
3. **Regenerar SDK**: `pnpm generate:api` → `apps/web/src/api-client/`.
4. **Backend**: implementar/ajustar DTOs con anotaciones swagger que reproduzcan el contrato.
5. **Frontend**: consumir exclusivamente los tipos/clientes generados.
6. Verificar que el OpenAPI emitido por NestJS no diverge del contrato.

## Errores comunes
- Editar el cliente generado a mano (se pierde en la siguiente regeneración).
- Tipar a mano respuestas de API en el frontend en vez de usar los tipos generados.
- Cambiar un DTO en backend sin reflejarlo en el contrato (drift).
- Que alguien que no sea contract-engineer toque `api-spec.yml`.

## Fuentes
- `docs/api-spec.yml`, `docs/architecture.md`, `docs/frontend-standards.md`.
- Skills relacionadas: `openapi-governance` (auditoría), `sdk-codegen` (generador).

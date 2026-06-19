---
name: openspec-sync-specs
description: Usar cuando debas verificar que las specs vivas de OpenSpec coinciden con la realidad del código y del contrato.
---
# OpenSpec — Sync specs

## Cuándo usar
Tras archivar un change, o cuando sospeches que `openspec/specs/` y el código/contrato han divergido.

## Reglas / Pasos
1. Compara las specs vivas (`openspec/specs/<capability>/`) con:
   - El código implementado (backend NestJS/Prisma, frontend React).
   - El contrato OpenAPI `docs/api-spec.yml` (fuente de verdad de la API).
   - El modelo de datos `docs/er-diagram.md` / `docs/data-model.md`.
2. Detecta divergencias: endpoints, campos, estados o constraints que existan en código pero no en spec (o viceversa).
3. Si hay divergencia que requiere cambio formal, abre un nuevo change (`openspec-propose`); no edites specs vivas a mano salvo correcciones de coherencia.
4. Valida con `openspec validate --strict` y `openspec list`.

## Patrón de referencia
Auditoría `docs/audits/openapi-verificacion.md` señala endpoint nuevo no especificado → abrir change para reflejarlo en specs.

## Errores comunes
- Parchear `openspec/specs/` sin un change cuando el cambio es funcional.
- Ignorar `docs/api-spec.yml` como fuente de verdad de la API.
- No validar con `--strict` tras sincronizar.

## Fuentes
`openspec/specs/`, `docs/api-spec.yml`, `docs/audits/openapi-verificacion.md`, skill `openspec-workflow`.

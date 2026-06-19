---
name: openspec-apply
description: Usar cuando implementes las tasks de un change de OpenSpec, para ejecutar y verificar antes de marcar cada paso.
---
# OpenSpec — Apply (implementar tasks)

## Cuándo usar
Cuando un change ya tiene `proposal.md` y `tasks.md` validados y toca implementarlo.

## Reglas / Pasos
1. Trabaja sobre la branch `feature/<change-name>` (creada en propose).
2. Sigue `tasks.md` **en orden**, respetando TDD (tests primero).
3. Marca `[x]` una task **SOLO tras ejecutarla y verificarla**. Nunca delegues los tests al usuario.
4. Para los pasos de verificación:
   - Ejecuta tests unitarios y verifica que pasan en verde.
   - Verifica el estado de la BD.
   - Crea el **report** en `changes/<change>/reports/YYYY-MM-DD-step-N+1-*.md`.
   - Pruebas de endpoints con `curl` (ejecútalas tú; restaura la BD después).
   - E2E con Playwright MCP si aplica.
5. Una task **solo está completa** tras: tests verdes + report creado.

## Patrón de referencia
Implementar `bloquearFecha()` → escribir test de concurrencia (TDD) → implementar → `pnpm test` verde → report `reports/2026-06-19-step-3-tests.md` → marcar `[x]`.

## Errores comunes
- Marcar `[x]` sin ejecutar ni verificar.
- Delegar testing al usuario (prohibido).
- Implementar antes de escribir el test.
- Olvidar el report o no restaurar la BD tras `curl`.

## Fuentes
`docs/openspec-tasks-mandatory-steps.md`, skill `openspec-workflow`.

---
name: openspec-archive
description: Usar cuando un change de OpenSpec esté completo y testeado, para archivarlo y actualizar las specs vivas.
---
# OpenSpec — Archive (cerrar un change)

## Cuándo usar
Cuando todas las tasks de `tasks.md` están en `[x]`, con tests verdes y reports creados.

## Reglas / Pasos
1. Verifica precondiciones: change **completo y testeado**.
   - Todas las tasks marcadas `[x]`.
   - Tests en verde (`pnpm test`).
   - Reports presentes en `changes/<change>/reports/`.
2. Ejecuta `openspec archive <change>`.
   - Esto actualiza `openspec/specs/` con el spec-delta del change.
3. Confirma que las specs vivas reflejan el cambio.
4. Tras archivar, considera ejecutar `openspec-sync-specs` para validar coherencia.

## Patrón de referencia
`openspec list` → confirmar `reserva-cola` completo → `openspec archive reserva-cola` → specs de `openspec/specs/reservas/` actualizadas.

## Errores comunes
- Archivar con tasks pendientes o tests rojos.
- Archivar sin reports.
- Editar `openspec/specs/` a mano en vez de dejar que `archive` lo haga.

## Fuentes
Skill `openspec-workflow`, `docs/openspec-tasks-mandatory-steps.md`.

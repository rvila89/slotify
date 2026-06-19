---
name: openspec-workflow
description: Usar cuando empieces o coordines un cambio gestionado por OpenSpec, para conocer el ciclo propose→apply→archive→sync.
---
# OpenSpec — Flujo completo (SDD)

## Cuándo usar
Al iniciar cualquier cambio de funcionalidad gestionado por especificaciones. OpenSpec es la **fuente de verdad de las specs**.

## Reglas / Pasos
OpenSpec es el motor SDD. Estructura del repo:
- `openspec/specs/<capability>/` — specs vivas (estado actual de la verdad).
- `openspec/changes/<change-name>/` — un cambio en curso, con:
  - `proposal.md` (qué/por qué)
  - `tasks.md` (pasos, con los obligatorios)
  - `design.md` (opcional)
  - `reports/` (evidencia de tests)

### Ciclo
1. **propose** → crear el change (branch + proposal + spec-delta + tasks). Skill `openspec-propose`.
2. **apply** → implementar las tasks de `tasks.md`. Skill `openspec-apply`.
3. **archive** → `openspec archive <change>` cuando está completo y testeado. Skill `openspec-archive`.
4. **sync** → mantener coherencia specs↔código/contrato. Skill `openspec-sync-specs`.

### Comandos CLI
- `openspec list` — lista changes.
- `openspec validate --strict` — valida un change.
- `openspec archive <change>` — archiva y actualiza `openspec/specs/`.

## Patrón de referencia
Nuevo feature → `openspec-propose` (branch `feature/<change>`, proposal, tasks) → `openspec-apply` (TDD, tests verdes, reports) → `openspec-archive` → `openspec-sync-specs`.

## Errores comunes
- Editar `openspec/specs/` directamente en vez de pasar por un change.
- Saltarse `openspec validate --strict` antes de implementar.
- Archivar sin tests verdes ni reports.

## Fuentes
`openspec/`, `docs/openspec-tasks-mandatory-steps.md`, skills `openspec-*`.

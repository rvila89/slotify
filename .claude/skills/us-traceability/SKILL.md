---
name: us-traceability
description: Usar cuando debas mantener trazabilidad US↔API↔ER↔casos de uso o elegir la siguiente historia a implementar.
---
# Trazabilidad de User Stories

## Cuándo usar
Al elegir la siguiente US, validar dependencias, o conectar una historia con paths OpenAPI, entidades ER y casos de uso.

## Reglas / Pasos
Trazabilidad: **US ↔ paths OpenAPI ↔ entidades ER ↔ casos de uso (UC)**. Existe tooling **determinista**, no improvises el orden a mano.

1. **Extraer el grafo:** `scripts/extract_backlog.py` lee `user-stories/US-*.md` y produce `user-stories/_analisis.json` con grafo de dependencias, `fan_out`, ciclos y huérfanos. (Skill/command `/analizar-backlog`.)
2. **Ordenar el backlog:** command `/ordenar-backlog` lee `_analisis.json` y produce `user-stories/_backlog.json` ordenado por dependencias y criticidad: **Fundacional → Spine → Soporte** (sin asignar sprints).
3. **Elegir la siguiente US:** toma del `_backlog.json` la primera con dependencias ya satisfechas.
4. Para cada US, verifica que sus paths OpenAPI (`docs/api-spec.yml`), entidades (`docs/er-diagram.md`) y UC (`docs/use-cases.md`) están alineados.

### Datos clave
- **48 historias**: `US-000`..`US-046`.
- **US-000 = scaffolding** (`fan_out` 44): se construye PRIMERO; casi todo depende de ella.

## Patrón de referencia
`/analizar-backlog` → `_analisis.json` → `/ordenar-backlog` → `_backlog.json` → implementar US-000 antes que nada por su fan_out 44.

## Errores comunes
- Ordenar el backlog a mano ignorando `_analisis.json`.
- Empezar una US con dependencias no satisfechas.
- Implementar antes que US-000 (scaffolding).
- No reflejar la US en OpenAPI/ER/UC.

## Fuentes
`scripts/extract_backlog.py`, `user-stories/_analisis.json`, `user-stories/_backlog.json`, `user-stories/US-*.md`, commands `/analizar-backlog` y `/ordenar-backlog`.

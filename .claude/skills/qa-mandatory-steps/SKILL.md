---
name: qa-mandatory-steps
description: Usar cuando el qa-verifier deba ejecutar los pasos obligatorios de QA (unit, manual curl, E2E) de una tarea de OpenSpec y generar sus reports.
---
# Pasos obligatorios de QA

## Cuándo usar
- Tras implementar una tarea de OpenSpec, antes de marcarla como completa.
- Cuando actúa el `qa-verifier`: él **EJECUTA los tests él mismo, NUNCA delega al usuario**.

## Reglas / Pasos
1. **Step N+1 — Unit tests**: ejecutar la suite unitaria + verificar estado de BD pre/post + escribir report.
2. **Step N+2 — Manual (curl)**: `curl` de GET/POST/PATCH/DELETE + casos de error **400/404/409/422** + **RESTAURAR el estado de BD tras cada CREATE/UPDATE/DELETE** + report.
3. **Step N+3 — E2E (solo si hay cambios de frontend)**: Playwright MCP (`browser_navigate`, `browser_click`, `browser_type`, `browser_snapshot`), verificar persistencia, restaurar BD + report.
4. Todos los reports van a `openspec/changes/<change>/reports/YYYY-MM-DD-step-N+X-*.md`.
5. La tarea se marca completa **SOLO** tras tests verdes + report escrito.
6. Cada mutación de prueba debe dejar la BD como estaba (sin residuos).

## Patrón de referencia
Plantilla de cada report:
```md
# Step N+X — <título>  (YYYY-MM-DD)
## Comandos ejecutados
- pnpm test ...
- curl -X POST ...
## Resultados
- <salida resumida, códigos HTTP observados>
## Comparación BD pre/post
| tabla | pre | post |
|-------|-----|------|
## Restauración
- <qué se borró/revirtió para dejar la BD intacta>
## Outcome
PASS | FAIL
```

## Errores comunes
- Pedir al usuario que ejecute los tests o que confirme manualmente.
- Marcar la tarea completa sin report o con tests en rojo.
- Dejar registros de prueba en la BD (no restaurar tras CREATE/UPDATE/DELETE).
- Omitir los casos de error 400/404/409/422 en el curl manual.
- Ejecutar Step N+3 cuando no hay cambios de frontend (o saltárselo cuando sí los hay).

## Fuentes
- `docs/openspec-tasks-mandatory-steps.md`

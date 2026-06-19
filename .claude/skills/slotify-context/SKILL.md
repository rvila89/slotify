---
name: slotify-context
description: Usar cuando necesites localizar QUÉ documento de docs/ leer antes de actuar, para cargar el slice mínimo de contexto.
---
# Slotify — Router de documentación

## Cuándo usar
Antes de leer documentación o código. Esta skill es un ÍNDICE: mapea "qué pregunta tienes" → "qué documento leer", para evitar cargar `docs/` entero. Léela primero, abre solo el slice que necesites.

## Reglas / Pasos
1. Identifica tu pregunta y salta directo al documento indicado.
2. Lee el mínimo necesario (sección concreta, no el archivo completo).
3. Si dudas del agente correcto, consulta el roster abajo.

### Mapa pregunta → documento
| Pregunta | Documento |
|----------|-----------|
| Stack, capas, decisiones | `docs/architecture.md` |
| Bloqueo atómico de fecha | `docs/architecture.md` §2.4 |
| Jobs asíncronos / barrido | `docs/architecture.md` §2.5 |
| Auth / JWT / refresh | `docs/architecture.md` §2.8 |
| Entidades, campos, tipos, constraints, `UNIQUE(tenant_id,fecha)` | `docs/er-diagram.md` + `docs/data-model.md` (17 entidades) |
| Casos de uso del MVP (UC-01..UC-36) | `docs/use-cases.md` |
| Diagramas C4 (context/container/component) | `docs/c4-diagrams.md` |
| Convenciones backend | `docs/backend-standards.md` |
| Convenciones frontend | `docs/frontend-standards.md` |
| Convenciones transversales | `docs/base-standards.md` |
| Contrato API (fuente de verdad) | `docs/api-spec.yml` (OpenAPI) |
| Cómo mantener la documentación | `docs/documentation-standards.md` |
| Pasos obligatorios de tasks.md | `docs/openspec-tasks-mandatory-steps.md` |
| Auditoría del contrato OpenAPI | `docs/audits/openapi-verificacion.md` |
| Historias de usuario (48) | `user-stories/US-*.md` |
| Orden del backlog | `user-stories/_backlog.json` |
| Grafo de dependencias | `user-stories/_analisis.json` |

### Roster de agentes
- **harness-orchestrator** — coordina el flujo, reparte trabajo.
- **spec-author** — redacta proposals y spec-deltas (OpenSpec).
- **contract-engineer** — mantiene `docs/api-spec.yml`.
- **tdd-engineer** — escribe tests primero.
- **backend-developer** — implementa NestJS/Prisma.
- **frontend-developer** — implementa Vite/React.
- **qa-verifier** — ejecuta y verifica tests/endpoints/E2E.
- **code-reviewer** — revisa el diff.
- **docs-keeper** — actualiza documentación técnica.

## Patrón de referencia
Pregunta "¿cómo bloqueo una fecha?" → abrir solo `docs/architecture.md §2.4` + entidad `FechaBloqueada` en `docs/er-diagram.md`. No leer todo `docs/`.

## Errores comunes
- Leer `docs/` completo en vez del slice indicado.
- Inventar comportamiento en vez de consultar `docs/api-spec.yml` (fuente de verdad de la API).
- Invocar al agente equivocado para la tarea.

## Fuentes
`docs/` (todos), `user-stories/`, este índice.

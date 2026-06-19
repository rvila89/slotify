---
name: openspec-propose
description: Usar cuando crees un change nuevo de OpenSpec, para generar branch, proposal, spec-delta y tasks válidos.
---
# OpenSpec — Propose (crear un change)

## Cuándo usar
Al iniciar un cambio de funcionalidad nuevo, antes de tocar código.

## Reglas / Pasos
1. **Step 0 OBLIGATORIO (PRIMERO):** crear feature branch `feature/<change-name>` ANTES de cualquier cambio. Sin branch, no continúes.
2. Crear `openspec/changes/<change-name>/proposal.md` — **qué** se cambia y **por qué**.
3. Crear el **spec-delta** — qué specs vivas (`openspec/specs/<capability>/`) cambian.
4. Crear `tasks.md` incluyendo los **pasos obligatorios** (ver más abajo).
5. `design.md` opcional si hay decisiones técnicas no triviales.
6. Validar: `openspec validate --strict`. No avances si falla.

### Pasos obligatorios en tasks.md
- **Step 0** — crear branch (PRIMERO).
- **GATE revisión humana (SDD)** — proposal + spec-delta + design aprobados por el humano (PARADA: esperar OK antes de implementar).
- **TDD** — tests primero, antes de implementación.
- **Step N** — revisar/actualizar tests unitarios.
- **Step N+1** — ejecutar tests unitarios + verificar estado BD + crear report en `changes/<change>/reports/YYYY-MM-DD-step-N+1-*.md`.
- **Step N+2** — pruebas manuales de endpoints con `curl` (AGENTE DEBE EJECUTAR; restaurar BD después).
- **Step N+3** — E2E con Playwright MCP (si aplica; AGENTE DEBE EJECUTAR).
- **Step N+4** — actualizar documentación técnica.
- **Code review (OBLIGATORIO)** — code-reviewer del diff → report `YYYY-MM-DD-step-review-code-review.md` con línea `Veredicto: APTO`.
- **GATE revisión humana final** — code-review APTO + validación manual aprobados por el humano (PARADA: esperar OK antes de archive/PR).

## Patrón de referencia
`feature/reserva-cola` → proposal + delta sobre `openspec/specs/reservas/` → tasks.md con Step 0..N+4 → `openspec validate --strict` OK.

## Errores comunes
- Tocar código antes de crear la branch (viola Step 0).
- tasks.md sin los pasos obligatorios.
- Delegar el testing al usuario (prohibido).
- No validar con `--strict`.

## Fuentes
`docs/openspec-tasks-mandatory-steps.md`, skill `openspec-workflow`.

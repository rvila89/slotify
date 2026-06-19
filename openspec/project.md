# Slotify — Contexto de proyecto para OpenSpec

SaaS multi-tenant (B2B) de gestión de espacios de eventos privados. Cliente piloto:
Masia l'Encís. **No** es un ATS ni un sistema de contratación.

## Cómo trabajamos (SDD + TDD)
1. **SDD**: cada feature nace como un *change* de OpenSpec (`openspec/changes/<name>/`)
   con `proposal.md`, spec-delta y `tasks.md`. La spec es la fuente de verdad.
2. **Contrato primero**: `docs/api-spec.yml` (OpenAPI) es la frontera back↔front; se
   congela y valida antes de implementar. El cliente del frontend se genera, no se edita.
3. **TDD**: tests primero (núcleo crítico antes que UI/CRUD). El agente ejecuta los tests.
4. **QA ejecutado por el agente**: unit + curl + Playwright, con reports en `reports/`.
5. **Docs**: se sincronizan al cerrar el change.

## Reglas de arquitectura (innegociables)
- Hexagonal + DDD: `domain/` no importa framework/infra. Agregado raíz: `Reserva`.
- Bloqueo de fecha = `UNIQUE(tenant_id, fecha)` + `SELECT ... FOR UPDATE` vía
  `bloquearFecha()`/`liberarFecha()`. Nada de Redis/locks distribuidos.
- Multi-tenancy: `tenant_id` del JWT, RLS activo.
- Máquina de estados como tabla declarativa. Jobs = estado en fila + barrido idempotente.
- Importes en `Decimal`. Dominio, comentarios y errores en español.

## Punteros
- Documentación: `docs/` (ver skill `slotify-context` para el router).
- Backlog y trazabilidad: `user-stories/`, `_backlog.json`, `scripts/extract_backlog.py`.
- Pasos obligatorios de tasks: `openspec/config.yaml` y `docs/openspec-tasks-mandatory-steps.md`.

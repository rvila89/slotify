# QA Report — Step N+3: E2E con Playwright MCP
## Change: us-012-expirar-consulta-ttl
## Date: 2026-07-01
## Executor: qa-verifier (agente)

---

## Decisión: N/A — US-012 no introduce interfaz de usuario

### Justificación

US-012 "Expirar consulta automáticamente por TTL agotado" es una funcionalidad de **sistema automático** (actor: Sistema / cron scheduler). No introduce:

1. **Ninguna pantalla nueva** en `apps/web`.
2. **Ningún flujo de usuario** que requiera interacción manual.
3. **Ninguna ruta/página** en el frontend.

El único actor es el **sistema cron** que invoca `POST /api/cron/barrido-expiracion` internamente. Este endpoint es de tipo service-to-service, protegido con `X-Cron-Token`, no accesible ni visible desde la UI.

### Efecto en UI (verificado indirectamente)

El único efecto visible en la UI es que, tras la expiración, la fecha bloqueada vuelve a aparecer disponible en el Calendario (US-039). Esta verificación de persistencia fue cubierta **indirectamente** en los tests curl (Step N+2):

- Se comprobó que `FECHA_BLOQUEADA` fue eliminada correctamente (count=0 tras el barrido).
- El calendario US-039 lee `fecha_bloqueada` vía `GET /api/calendario`, por lo que la fecha liberada quedará automáticamente disponible para reservar sin cambio adicional en frontend.

### Cobertura de calidad equivalente

| Aspecto | Cubierto en |
|---------|-------------|
| Lógica de negocio (mapa declarativo, transiciones) | Step N+1 (unit: `maquina-estados-expiracion-ttl.spec.ts`) |
| Use-case (candidatas, fallo aislado, idempotencia) | Step N+1 (unit: `expirar-consultas.use-case.spec.ts`) |
| Integración real contra Postgres | Step N+1 (integration: `expirar-consultas-integracion.spec.ts`) |
| Concurrencia real RC-1/RC-2/RC-3 | Step N+1 (concurrency: `expirar-consultas-concurrencia.spec.ts`) |
| Guard HTTP + shape de respuesta | Step N+1 (controller: `barrido-expiracion.controller.spec.ts`) |
| Endpoint 401/200 manual | Step N+2 (curl) |
| Transición BD + liberación fecha + AUDIT_LOG | Step N+2 (curl) |
| Idempotencia y TTL extendido (US-006) | Step N+2 (curl) |
| Disponibilidad de fecha en UI (indirecta) | Step N+2 (verificación `fecha_bloqueada` count=0) |

### Responsive (N/A)

No aplica. No existe superficie de UI para US-012. Los 3 viewports (390/768/1280) no son verificables porque no hay pantalla asociada.

---

## Outcome

**N/A** — E2E Playwright no ejecutado porque US-012 no introduce UI propia. La calidad equivalente queda garantizada por la batería unit/integración/concurrencia (Step N+1) y los tests curl manuales (Step N+2). Esta exención está contemplada en `tasks.md §8.1`.

# Code Review — fix-borrador-e1-cuerpo-prerelleno

**Fecha:** 2026-07-18
**Change:** fix-borrador-e1-cuerpo-prerelleno
**Branch:** feature/fix-borrador-e1-cuerpo-prerelleno (worktree aislado)
**Revisor:** code-reviewer (agente)

---

## Resumen

Fix backend puro: con comentarios en el alta, el E1 nace en `borrador` YA REDACTADO
(asunto + cuerpo renderizados con el mismo idioma y casuística `tipoE1` que el auto-envío),
en lugar de con el cuerpo vacío. Persistencia best-effort post-commit vía puerto estrecho
`ActualizarBorradorEmailPort` satisfecho por el `DespacharEmailService` ya inyectado.

## Hallazgos

- **Bloqueantes:** ninguno.
- **Mayores:** ninguno.
- **Menores:**
  - *(diseño, sin acción)* Reutilizar la instancia de `DespacharEmailService` como
    `finalizarEnvio` y `actualizarBorrador` acopla dos responsabilidades en el wiring; el
    puerto estrecho existe precisamente para poder desacoplarlo en el futuro (design D-1).
- **Nits:**
  - El test de integración cross-tenant usa `rejects.toBeDefined()` (laxo); afirmar
    `P2025`/`NotFoundError` documentaría mejor la causa. Cosmético.

## Guardrails (verificados OK)

1. **Hexagonal/DDD** — puerto nuevo en `domain/` (sin `@nestjs/*`/`@prisma/*`), adapter en
   `infrastructure/`, use-case (application) depende solo de puertos.
2. **Multi-tenancy/RLS** — `set_config('app.tenant_id')` + filtro `tenant_id` en el `where`
   (UPDATE y relectura); guard `estado='borrador'`; `tenantId` del JWT, nunca del body/path.
3. **Bloqueo atómico** — no aplica; no se introduce Redis/lock distribuido.
4. **Arrow functions / func-style** — `renderizarE1` es método de clase; helpers de test arrow.
5. **Best-effort post-commit** — el `try/catch` envuelve solo el UPDATE del borrador (no el
   commit); no propaga → 201 intacto. Rama de auto-envío sin cambios. Paridad por construcción
   (mismo helper alimenta ambas ramas).
6. **Idempotencia** — UPDATE sobre fila existente por PK + guard; reejecutar no duplica.
7. **Contrato/SDK** — `docs/api-spec.yml` solo prosa; schema y SDK sin tocar.
8. **Riesgos sutiles** — `findFirstOrThrow` con filtro tenant no lanza en el flujo legítimo;
   ningún consumidor esperaba el `cuerpo` en la respuesta inmediata del alta (se expone por el
   GET de la ficha, que ya lo precargaba).

## Cobertura de tests

- Unit (9): relleno asunto/cuerpo, no-envío, idioma, casuística `tipoE1`, paridad, best-effort,
  no-invocación en auto-envío.
- Integración BD real (3): relleno, guard de estado (`enviado` no muta), aislamiento por tenant.

## Condición previa al PR (no bloqueante para el APTO)

Rebasar/mergear la rama sobre el `master` actual (que ya contiene US-051 #81 y el fix de
calendario #80) y confirmar que el diff del PR queda reducido al fix, para no revertir esos
cambios.

---

## Veredicto: APTO

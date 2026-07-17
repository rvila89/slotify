# Tasks — us-047-borrador-e1-comportamiento

> Pasos obligatorios de `openspec/config.yaml` / `docs/openspec-tasks-mandatory-steps.md`,
> en orden. El AGENTE ejecuta él mismo todas las pruebas (unit / curl / Playwright); NUNCA
> las delega en el usuario. Cada `[x]` se marca solo tras ejecutar y verificar. Reports en
> `openspec/changes/us-047-borrador-e1-comportamiento/reports/`.

- [x] Step 0 — crear branch `feature/us-047-borrador-e1-comportamiento` ← YA HECHO
- [x] GATE humano (SDD) — `proposal` + spec-delta + `design` aprobados por el humano (PARADA)
- [x] Step 1 — Contrato: actualizar `docs/api-spec.yml` (`tieneBorradorE1Pendiente` en `ReservaPipelineItemDto`)
- [x] Step 2 — TDD RED: `EnviarBorradorUseCase` E1 adjunta dossier (test falla antes de impl)
- [x] Step 3 — TDD RED: pipeline incluye `tieneBorradorE1Pendiente` (test falla antes de impl)
- [x] Step 4 — Backend: `EnviarBorradorUseCase` adjunta dossier E1 (usa `reserva.idioma`)
- [x] Step 5 — Backend: listar-reservas adapter + DTO (campo `tieneBorradorE1Pendiente`)
- [x] Step 6 — SDK: regenerar `apps/web/src/api-client/schema.d.ts`
- [x] Step 7 — Frontend: `AccionesConsulta` oculta si `tieneBorradorE1Pendiente` + aviso
- [x] Step 8 — Frontend: eliminar botón Descartar (`ComunicacionListaItem` + `ComunicacionesCard` + `DescartarBorradorDialog`)
- [x] Step 9 — Frontend: `RevisarEnviarBorradorDialog` `max-w-2xl`
- [x] Step 10 — Frontend: badge ámbar en `ReservaKanbanCard` y `ListadoView`
- [x] Step 11 — Tests unitarios + verificar BD + report `reports/YYYY-MM-DD-step-11-unit.md`
- [x] Step 12 — Pruebas manuales curl + report `reports/YYYY-MM-DD-step-12-curl.md`
- [x] Step 13 — E2E Playwright + report `reports/YYYY-MM-DD-step-13-e2e.md`
- [x] Step 14 — Actualizar documentación técnica (`docs/`)
- [x] Code review obligatorio — report `YYYY-MM-DD-step-review-code-review.md` con `Veredicto: APTO`
- [x] GATE humano final — code-review APTO + validación manual OK (PARADA)
- [ ] Archive + PR

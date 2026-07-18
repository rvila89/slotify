# Tasks — fix-borrador-e1-cuerpo-prerelleno

> Pasos obligatorios de `openspec/config.yaml` / `docs/openspec-tasks-mandatory-steps.md`, en
> orden. El AGENTE ejecuta él mismo todas las pruebas (unit / curl / Playwright); NUNCA las
> delega en el usuario. Cada `[x]` se marca solo tras ejecutar y verificar. Reports en
> `openspec/changes/fix-borrador-e1-cuerpo-prerelleno/reports/`.

- [x] Step 0 — crear branch `feature/fix-borrador-e1-cuerpo-prerelleno` desde `master` (worktree aislado) ← YA HECHO
- [x] GATE humano (SDD) — `proposal` + spec-delta + `design` aprobados por el humano (PARADA) → "adelante"
- [x] Step 1 — Contrato: **N/A** — verificado: `Comunicacion.cuerpo` ya existe en `docs/api-spec.yml` y `ComunicacionListItem` lo hereda vía `allOf`; sin regeneración de SDK
- [x] Step 2 — TDD RED: `AltaConsultaUseCase` con comentarios rellena el borrador (asunto+cuerpo renderizados por idioma y `tipoE1`); `finalizarEnvio` NO se llama (RED verificado: falla por puerto inexistente)
- [x] Step 3 — TDD RED: paridad cuerpo borrador == cuerpo auto-envío; best-effort (fallo del UPDATE no tumba el alta) (incluido en la misma suite RED)
- [x] Step 4 — Backend: `ComunicacionRepositoryPort.actualizarContenidoBorrador` + adapter Prisma (guard `estado='borrador'` + RLS)
- [x] Step 5 — Backend: `DespacharEmailService` método delegado; `AltaConsultaUseCase` helper `renderizarE1` + ramifica el post-commit; `reservas.module.ts` cablea reutilizando el `DespacharEmailService` ya inyectado
- [x] Step 6 — Tests unitarios + typecheck + lint + verificar BD → `reports/2026-07-18-step-unit.md` (9 nuevos + 2410 unit passed, sin regresiones)
- [x] Step 7 — Test de integración (adapter SQL real, `slotify_test`) → `reports/2026-07-18-step-integration.md` (3 passed: relleno / guard estado / RLS)
- [x] Step 8 — Pruebas manuales curl (BD real) → `reports/2026-07-18-step-curl.md` (borrador con cuerpo 1452 chars en `ca`; auto-envío `enviado` sin regresión)
- [~] Step 9 — E2E Playwright: **OMITIDO justificado** — sin cambios de frontend; el diálogo de revisión ya precargaba `cuerpo` y el efecto observable (cuerpo no vacío) queda verificado por curl end-to-end (Step 8)
- [x] Step 10 — Documentación técnica: `docs/architecture.md` (flujo post-commit con comentarios ahora rellena el borrador) y `docs/api-spec.yml` (prosa de `comentarios` en `POST /reservas`: el borrador nace ya redactado). Sin cambio de esquema/SDK (solo descripciones). YAML válido.
- [x] Code review obligatorio — report `2026-07-18-step-review-code-review.md` con **`Veredicto: APTO`** (0 bloqueantes, 0 mayores)
- [x] GATE humano final — code-review APTO + "adelante" del humano (PARADA superada)
- [x] Archive + PR — rebase limpio sobre `master` (a5c1183, con US-051 #81); change archivado; delta aplicado a la spec viva `comunicaciones`; PR abierto

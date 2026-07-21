# Tasks — ficha-operativa-campos-operativos

> Ajuste de campos en la ficha operativa de una consulta confirmada: elimina
> `menu_seleccionado` y `timing_detallado`; añade `contacto_evento_correo`
> (pre-rellenado), `hora_llegada` (HH:MM) y `duracion` (texto libre). Afecta a
> contrato OpenAPI, backend NestJS/Prisma (migración) y frontend React.

## Step 0 — Feature branch (PRIMERO, OBLIGATORIO)

- [x] 0.1 Worktree `worktree-ficha-operativa-campos-operativos` creado desde
  `master` vía `EnterWorktree`. El worktree materializa la rama aislada.
- [x] 0.2 Rama verificada: `worktree-ficha-operativa-campos-operativos`.

## GATE — Revisión humana de artefactos SDD (PARADA OBLIGATORIA)

- [x] 1.1 `proposal.md` + spec-delta aprobados por el humano (OK recibido).

---

## Step 2 — Contrato OpenAPI (contract-engineer)

- [x] 2.1 `docs/api-spec.yml` actualizado: `menuSeleccionado`/`timingDetallado`
  eliminados; `contactoEventoCorreo`, `horaLlegada`, `duracion` añadidos en
  `FichaOperativa` y `GuardarFichaOperativaRequest`. Commit `4c48286`.
- [x] 2.2 `openspec validate --changes`: 3/3 passed.
- [x] 2.3 SDK regenerado (`pnpm run generate-client` → `schema.d.ts`).

## Step 3 — TDD RED (tdd-engineer — tests ANTES de implementación)

- [x] 3.1 Tests escritos en rojo (6 suites, errores de compilación TS por campos
  inexistentes en dominio). Commit `e498830`.
- [x] 3.2 RED confirmado antes de implementar.

## Step 4 — Backend: implementación (backend-developer)

- [x] 4.1 `schema.prisma`: `contactoEventoCorreo`, `horaLlegada`, `duracion`
  añadidos. `menuSeleccionado`/`timingDetallado` permanecen como legacy nullable.
- [x] 4.2 Migración SQL generada: `20260721120000_ficha_operativa_campos_operativos/migration.sql`.
  **PENDIENTE**: ejecutar `prisma migrate deploy` desde sesión principal con BD activa.
- [x] 4.3 Dominio actualizado: `ficha-operativa.ports.ts`, `maquina-estados-pre-evento.ts`.
- [x] 4.4 Mapper, DTO y controller actualizados.
- [x] 4.5 Pre-relleno `contactoEventoCorreo` desde `reserva.cliente.email` implementado
  en `confirmar-pago-senal.use-case.ts` y adaptadores. Commit `01d1c83`.
- [x] 4.6 Guardado parcial acepta los tres campos nuevos. Tests: 124/124 VERDE.

## Step 5 — Frontend: implementación (frontend-developer)

- [x] 5.1 `campos.ts`: eliminados `menuSeleccionado`/`timingDetallado`; añadidos
  `contactoEventoCorreo` (tipo email), `horaLlegada` (tipo hora), `duracion` (tipo texto).
- [x] 5.2 `schema.ts`: Zod + `valoresDesdeFicha()` + `construirRequest()` actualizados.
- [x] 5.3 `CamposFicha.tsx`: render data-driven actualizado; tipos `email`/`hora`
  añadidos al componente. Commit `a85da6d`.
- [x] 5.4 `pnpm lint` OK; `pnpm test` 377/377 VERDE.

## Step 6 — QA: unit tests + verificación BD (OBLIGATORIO — EL AGENTE DEBE EJECUTARLO)

- [ ] 6.1 Capturar baseline de BD: counts de `FICHA_OPERATIVA` y valores de los
  campos afectados.
- [ ] 6.2 Ejecutar tests dirigidos de los módulos modificados:
  `pnpm --filter api test -- --testPathPattern ficha-operativa`
  `pnpm --filter web test -- --testPathPattern ficha-operativa`
- [ ] 6.3 Ejecutar suite requerida: `pnpm test` en `apps/api` y `apps/web`.
- [ ] 6.4 Verificar estado posterior de BD; restaurar si hace falta.
- [ ] 6.5 Crear report:
  `openspec/changes/2026-07-21-ficha-operativa-campos-operativos/reports/YYYY-MM-DD-step-6-unit-test-and-db-verification.md`
- [ ] 6.6 Marcar completado solo tras tests en verde y report creado.

## Step 7 — QA: pruebas manuales con curl (OBLIGATORIO — EL AGENTE DEBE EJECUTARLO)

- [ ] 7.1 Levantar el backend (`pnpm --filter api start:dev`).
- [ ] 7.2 Obtener JWT de un Gestor del tenant piloto.
- [ ] 7.3 GET `/reservas/:id/ficha-operativa` → verificar que la respuesta incluye
  `contactoEventoCorreo` y NO incluye `menuSeleccionado` ni `timingDetallado`.
- [ ] 7.4 PATCH `/reservas/:id/ficha-operativa` con `{ horaLlegada: "19:00",
  duracion: "3h", contactoEventoCorreo: "test@example.com" }` → 200; verificar
  persistencia en BD; restaurar BD.
- [ ] 7.5 PATCH con `{ menuSeleccionado: "Menú X" }` → verificar rechazo o que el
  campo se ignora (no persiste, dado `additionalProperties: false`).
- [ ] 7.6 Verificar escenario de reserva recién confirmada: la ficha tiene
  `contactoEventoCorreo` pre-rellenado desde la reserva.
- [ ] 7.7 Probar casos de error: 404 (reserva inexistente), 409 (estado no
  permitido).
- [ ] 7.8 Crear report:
  `openspec/changes/2026-07-21-ficha-operativa-campos-operativos/reports/YYYY-MM-DD-step-7-curl-endpoint-tests.md`

## Step 8 — QA: E2E con Playwright MCP (OBLIGATORIO — EL AGENTE DEBE EJECUTARLO)

- [ ] 8.1 Levantar frontend y backend; BD en estado conocido (reserva confirmada
  con correo de contacto).
- [ ] 8.2 Navegar a la ficha operativa de una reserva confirmada.
- [ ] 8.3 Verificar que el campo "Correo de contacto" aparece pre-rellenado.
- [ ] 8.4 Verificar que los campos "Menú seleccionado" y "Timing detallado" ya NO
  aparecen en el formulario.
- [ ] 8.5 Rellenar "Hora de llegada" (ej: "19:00") y "Duración" (ej: "3h"); guardar.
- [ ] 8.6 Recargar la página y verificar que los valores persisten.
- [ ] 8.7 Verificar en 3 viewports (390 / 768 / 1280): formulario responsive sin
  overflow horizontal.
- [ ] 8.8 Restaurar entorno y estado de BD.
- [ ] 8.9 Crear report:
  `openspec/changes/2026-07-21-ficha-operativa-campos-operativos/reports/YYYY-MM-DD-step-8-e2e-playwright.md`

## Step 9 — Docs: actualizar documentación técnica (docs-keeper)

- [x] 9.1 `docs/er-diagram.md §3.14 FICHA_OPERATIVA`: nuevos campos añadidos;
  `menu_seleccionado`/`timing_detallado` marcados como legacy.
- [x] 9.2 `docs/use-cases.md` UC-20: lista de campos editables actualizada.
- [x] 9.3 `openspec/specs/ficha-operativa/spec.md`: spec viva actualizada al estado
  POST-change (lectura, guardado, pre-relleno, cierre).

## Code review (OBLIGATORIO — EL AGENTE DEBE EJECUTARLO)

- [x] 10.1 `code-reviewer` ejecutado sobre el diff completo.
- [x] 10.2 Informe en `reports/2026-07-21-step-review-code-review.md`.
  **Veredicto: APTO** — sin bloqueantes. Advertencias menores (validación HH:MM
  solo documental, responsive pendiente de confirmar en QA).

## GATE — Revisión humana final (PARADA OBLIGATORIA)

- [ ] 11.1 Tras code-review **APTO** y validación manual del humano, **esperar OK
  explícito** antes de archivar o abrir PR.

## Archive / PR (solo tras GATE final aprobado)

- [ ] 12.1 Ejecutar `openspec archive 2026-07-21-ficha-operativa-campos-operativos`.
- [ ] 12.2 Abrir PR desde `worktree-ficha-operativa-campos-operativos` → `master`.

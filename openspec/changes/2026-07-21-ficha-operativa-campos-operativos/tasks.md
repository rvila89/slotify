# Tasks — ficha-operativa-campos-operativos

> Ajuste de campos en la ficha operativa de una consulta confirmada: elimina
> `menu_seleccionado` y `timing_detallado`; añade `contacto_evento_correo`
> (pre-rellenado), `hora_llegada` (HH:MM) y `duracion` (texto libre). Afecta a
> contrato OpenAPI, backend NestJS/Prisma (migración) y frontend React.

## Step 0 — Feature branch (PRIMERO, OBLIGATORIO)

- [x] 0.1 Worktree `worktree-ficha-operativa-campos-operativos` creado desde
  `master` vía `EnterWorktree`. El worktree materializa la rama aislada.
- [ ] 0.2 Verificar que `git branch --show-current` muestra la rama correcta en
  el worktree.

## GATE — Revisión humana de artefactos SDD (PARADA OBLIGATORIA)

- [ ] 1.1 Presentar al humano `proposal.md` + spec-delta (`specs/ficha-operativa/spec.md`)
  y **esperar OK explícito** antes de avanzar a contrato/TDD/implementación.

---

## Step 2 — Contrato OpenAPI (contract-engineer)

- [ ] 2.1 Actualizar `docs/api-spec.yml`:
  - Schema `FichaOperativa`: eliminar `menuSeleccionado`, `timingDetallado`;
    añadir `contactoEventoCorreo` (string, nullable), `horaLlegada` (string,
    nullable, description "HH:MM"), `duracion` (string, nullable).
  - Schema `GuardarFichaOperativaRequest`: mismos cambios.
- [ ] 2.2 Ejecutar `openspec validate --strict` y confirmar sin errores.
- [ ] 2.3 Regenerar el SDK del frontend (`pnpm --filter api-client generate` o el
  comando configurado en el proyecto) vía `contract-engineer`.

## Step 3 — TDD RED (tdd-engineer — tests ANTES de implementación)

- [ ] 3.1 Escribir test de integración backend que verifique:
  - Al crear la ficha (al confirmar reserva), `contacto_evento_correo` se siembra
    desde `reserva.contacto_email`.
  - El guardado parcial persiste `hora_llegada` y `duracion`.
  - El guardado parcial ignora `menu_seleccionado` y `timing_detallado` (ya no en
    el DTO).
- [ ] 3.2 Confirmar que los tests están en RED antes de implementar.

## Step 4 — Backend: implementación (backend-developer)

- [ ] 4.1 Prisma schema (`apps/api/prisma/schema.prisma`): añadir campos
  `contactoEventoCorreo String?`, `horaLlegada String?`, `duracion String?` a la
  tabla `FichaOperativa`. Los campos `menuSeleccionado` y `timingDetallado` se
  mantienen en el schema como nullable (no DROP) pero se retiran de los DTOs.
- [ ] 4.2 Generar y ejecutar migración Prisma (`prisma migrate dev --name
  ficha-operativa-campos-operativos`).
- [ ] 4.3 Actualizar la entidad de dominio `FichaOperativa` (añadir campos nuevos,
  quitar campos del contrato).
- [ ] 4.4 Actualizar el repositorio/adaptador Prisma: incluir campos nuevos en
  proyección de lectura y en la mutación de escritura; excluir `menuSeleccionado`
  y `timingDetallado` del DTO de respuesta.
- [ ] 4.5 Actualizar `crearFicha` (caso de uso de creación al confirmar reserva):
  sembrar `contactoEventoCorreo` desde `reserva.contacto_email` (verificar nombre
  exacto del campo en el modelo `Reserva` antes de implementar).
- [ ] 4.6 Actualizar `guardarFicha` (caso de uso de guardado parcial): aceptar
  `horaLlegada`, `duracion`, `contactoEventoCorreo`; rechazar `menuSeleccionado` y
  `timingDetallado` (no en el DTO, `additionalProperties: false` ya en el contrato).

## Step 5 — Frontend: implementación (frontend-developer)

- [ ] 5.1 `apps/web/src/features/ficha-operativa/lib/campos.ts`: quitar
  `menuSeleccionado` y `timingDetallado`; añadir `contactoEventoCorreo` (tipo
  email, label "Correo de contacto"), `horaLlegada` (tipo time, label "Hora de
  llegada"), `duracion` (tipo text, label "Duración", placeholder "ej: 3h,
  2h 30min").
- [ ] 5.2 `apps/web/src/features/ficha-operativa/lib/schema.ts`:
  - Zod schema: añadir/quitar campos.
  - `valoresDesdeFicha()`: añadir `contactoEventoCorreo`, `horaLlegada`, `duracion`;
    quitar `menuSeleccionado`, `timingDetallado`.
  - `construirRequest()`: mismo ajuste.
- [ ] 5.3 `apps/web/src/features/ficha-operativa/components/CamposFicha.tsx`:
  - Quitar campos `menuSeleccionado` y `timingDetallado` del render.
  - Añadir `contactoEventoCorreo` junto al bloque de contacto (después de teléfono).
  - Añadir bloque "Logística" con `horaLlegada` y `duracion`.
- [ ] 5.4 Verificar que `pnpm lint` pasa en `apps/web` (sin errores de ESLint).

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

- [ ] 9.1 Actualizar `docs/er-diagram.md §3.14 FICHA_OPERATIVA`: reflejar columnas
  añadidas y las retiradas del contrato (con nota de que siguen en BD como legacy).
- [ ] 9.2 Revisar `docs/use-cases.md` (UC-20, UC-20-FA-01): actualizar si hace
  referencia a `menu_seleccionado` o `timing_detallado`.

## Code review (OBLIGATORIO — EL AGENTE DEBE EJECUTARLO)

- [ ] 10.1 Ejecutar `code-reviewer` sobre el diff completo del worktree.
- [ ] 10.2 Dejar informe en:
  `openspec/changes/2026-07-21-ficha-operativa-campos-operativos/reports/YYYY-MM-DD-step-review-code-review.md`
  con línea `Veredicto: APTO` o `Veredicto: NO APTO`.
- [ ] 10.3 Si NO APTO: volver a implementación, corregir y repetir code-review.

## GATE — Revisión humana final (PARADA OBLIGATORIA)

- [ ] 11.1 Tras code-review **APTO** y validación manual del humano, **esperar OK
  explícito** antes de archivar o abrir PR.

## Archive / PR (solo tras GATE final aprobado)

- [ ] 12.1 Ejecutar `openspec archive 2026-07-21-ficha-operativa-campos-operativos`.
- [ ] 12.2 Abrir PR desde `worktree-ficha-operativa-campos-operativos` → `master`.

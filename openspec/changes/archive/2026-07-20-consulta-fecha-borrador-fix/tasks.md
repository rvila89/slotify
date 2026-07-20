# Tasks — consulta-fecha-borrador-fix

> Orden del harness: SDD → ⏸ gate SDD → contrato (confirmar sin cambios) → TDD-RED →
> impl (back ∥ front) → QA (unit + curl + E2E) → docs → code-review (APTO) → ⏸ gate final →
> archive/PR. El AGENTE ejecuta él mismo todas las pruebas; nunca las delega.

## 0. Setup: feature branch (OBLIGATORIO — PRIMER PASO — step-0)

- [x] 0.1 Trabajamos en el worktree/rama dedicada `worktree-consulta-fecha-borrador-fix`
      (Step 0 ya satisfecho por decisión del usuario; NO crear otra rama).

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd)

- [ ] 1.1 Presentar al humano `proposal.md` + spec-delta (`consultas`, `comunicaciones`) +
      `design.md` y **ESPERAR su OK explícito**. No avanzar por defecto ni aunque se diga
      "continúa".

## 2. Contrato OpenAPI: confirmar SIN cambios (contract-engineer)

- [ ] 2.1 Auditar que `ReservaPipelineItemDto.tieneBorradorE1Pendiente`, `PATCH
      /reservas/{id}` (`UpdateReservaRequest`), los flujos de fecha y los endpoints de
      comunicaciones (`GET /reservas/:id/comunicaciones`, envío/edición de borrador) ya
      existen en `docs/api-spec.yml`.
- [ ] 2.2 Confirmar **no-diff**: NO editar `docs/api-spec.yml` ni regenerar el SDK.
      Documentar el resultado (ver `design.md §D-1`).

## 3. Tests primero — TDD RED (OBLIGATORIO — tdd-first — tdd-engineer)

- [ ] 3.1 Backend — `plantilla-transicion-fecha.spec.ts`: asunto de la rama "disponible" =
      "Pre-reserva confirmada" (ES y CA); rama "cola" sin cambios.
- [ ] 3.2 Backend — `textoPlanoAHtml()` (nuevo helper puro): escape HTML, `\n\n→<p>`,
      `\n→<br>`; idempotencia sobre entradas ya HTML NO aplicada por el helper (contrato del
      helper), y decisión del borde (heurística/flag) según `design.md §D-2`.
- [ ] 3.3 Backend — borde de envío (`resend.email.adapter.ts` / servicio de envío):
      cuerpo texto plano → `html` convertido + `text` crudo; cuerpo HTML del catálogo →
      **NO** doble-escape. Tests de **no-regresión E1/E2/E3** del catálogo (HTML intacto).
- [ ] 3.4 Backend — `actualizar-reserva.use-case.spec.ts`: con E1 en `borrador`, tras el
      PATCH se regenera el borrador (asunto/cuerpo con datos nuevos, `tipo` por sub-estado,
      idioma por `reserva.idioma`); sin borrador → no se toca ninguna comunicación; sin
      guarda 409; regeneración best-effort (fallo no revierte la edición).
- [ ] 3.5 Frontend — `AccionesConsulta.test.tsx`: con `tieneBorradorE1Pendiente=true` se
      muestran "Editar consulta" y gestión de fecha, se ocultan las acciones downstream y
      aparece el CTA junto a "Generar presupuesto"; al no haber borrador, todo visible.
- [ ] 3.6 Frontend — "Editar consulta" único (no duplicado por `AccionPresupuesto`); el
      modal de edición NO contiene la sección de fecha.
- [ ] 3.7 Frontend — `AvisosTransicion.test.tsx`: aviso **ámbar** "borrador pendiente de
      revisión/envío" (no verde "email enviado"); invalidación del query de comunicaciones
      + scroll-to-top tras mutar la fecha.
- [ ] 3.8 Verificar que TODA la batería anterior está en **RED** antes de implementar.

## 4. Backend: revisar/actualizar tests unitarios existentes (OBLIGATORIO — step-N — backend-developer)

- [ ] 4.1 Implementar el helper `textoPlanoAHtml()` (aplicación de `comunicaciones`, puro).
- [ ] 4.2 Aplicarlo en el **borde de envío** preservando el HTML del catálogo (no
      doble-escape), según `design.md §D-2` (ii).
- [ ] 4.3 Cambiar el asunto de la plantilla "disponible" a "Pre-reserva confirmada"
      (`plantilla-transicion-fecha.ts`, ES y CA).
- [ ] 4.4 En `actualizar-reserva.use-case.ts`: regenerar el borrador E1 pendiente
      post-commit vía `DespacharEmailService.actualizarContenidoBorrador()` (best-effort,
      sin guarda 409). Cablear el puerto/dep necesario sin importar infra en dominio.
- [ ] 4.5 Confirmar en verde los specs 3.1–3.4 y sin regresiones en el módulo.

## 5. Frontend: implementar (OBLIGATORIO — step-N — frontend-developer)

- [ ] 5.1 Desbloqueo PARCIAL de acciones con borrador E1 pendiente (editar + gestión de
      fecha permitidas; resto bloqueado con CTA) en `AccionesConsulta.tsx`.
- [ ] 5.2 Eliminar el "Editar consulta" duplicado de `AccionPresupuesto.tsx`; dejar un solo
      "Editar consulta"; quitar la sección de fecha del modal de edición.
- [ ] 5.3 Aviso ámbar + scroll-to-top en `AvisosTransicion.tsx`; invalidar el query de
      comunicaciones (y el de la reserva) tras asignar/cambiar fecha y tras editar.
- [ ] 5.4 Verificar responsive en 390 / 768 / 1280 (regla dura CLAUDE.md).
- [ ] 5.5 Confirmar en verde los specs 3.5–3.7.

## 6. QA: unit tests + verificación de BD (OBLIGATORIO — step-N+1 — qa-verifier — EL AGENTE DEBE EJECUTARLO)

- [ ] 6.1 Capturar baseline de BD (COMUNICACION E1 borrador, RESERVA de prueba).
- [ ] 6.2 Ejecutar tests dirigidos de los módulos cambiados (back + front).
- [ ] 6.3 Ejecutar la suite requerida (`pnpm test`) y registrar totales/flaky.
- [ ] 6.4 Verificar estado posterior de BD y restaurar si hace falta.
- [ ] 6.5 Crear report `openspec/changes/consulta-fecha-borrador-fix/reports/YYYY-MM-DD-step-N+1-unit-test-and-db-verification.md`.
- [ ] 6.6 Marcar completado solo tras tests en verde y report creado.

## 7. QA: pruebas manuales con curl (OBLIGATORIO — step-N+2 — qa-verifier — EL AGENTE DEBE EJECUTARLO)

- [ ] 7.1 Levantar el backend (BD real, transporte de email en modo fake/sandbox).
- [ ] 7.2 `POST /reservas/{id}/fecha` (2a→2b): verificar borrador E1 con asunto
      "Pre-reserva confirmada"; `GET /reservas/:id/comunicaciones` lo muestra en `borrador`.
- [ ] 7.3 `PATCH /reservas/{id}` con personas/horas: verificar que el borrador E1 se
      regenera (sin `___`); restaurar BD.
- [ ] 7.4 Enviar el borrador (flujo US-046) y verificar el `html` con `<p>`/`<br>`
      (formato preservado) sin doble-escape del catálogo; restaurar BD.
- [ ] 7.5 Casos de error (validación de `horario`, 404) coherentes con el contrato.
- [ ] 7.6 Crear report `.../reports/YYYY-MM-DD-step-N+2-curl-endpoint-tests.md`.

## 8. QA: E2E con Playwright MCP (OBLIGATORIO — hay frontend — step-N+3 — qa-verifier — EL AGENTE DEBE EJECUTARLO)

- [ ] 8.1 Levantar frontend y backend; BD en estado conocido.
- [ ] 8.2 Flujo: crear consulta 2a → asignar fecha → ver aviso ámbar + scroll → borrador
      visible sin recargar → editar consulta (personas/horas) → borrador refleja los datos.
- [ ] 8.3 Verificar "Editar consulta" único; downstream bloqueado con CTA; enviar borrador
      → acciones downstream desbloqueadas.
- [ ] 8.4 Verificar 3 viewports (390 / 768 / 1280) sin overflow.
- [ ] 8.5 Restaurar entorno y BD; mover capturas a `reports/e2e-screenshots/`.
- [ ] 8.6 Crear report `.../reports/YYYY-MM-DD-step-N+3-e2e-playwright.md`.

## 9. Docs: actualizar documentación técnica (OBLIGATORIO — step-N+4 — docs-keeper)

- [ ] 9.1 Actualizar docs técnicas afectadas (comportamiento del borrador E1 y del borde de
      envío de email); registrar la deuda del catálogo (D-2 opción i) si procede.

## 10. Code review (OBLIGATORIO — code-review — code-reviewer — EL AGENTE DEBE EJECUTARLO)

- [ ] 10.1 Ejecutar `code-reviewer` sobre el diff (hexagonal, no doble-escape, responsive,
      no locks distribuidos, contrato sin cambios).
- [ ] 10.2 Dejar informe `.../reports/YYYY-MM-DD-step-review-code-review.md` con
      `Veredicto: APTO`.

## 11. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final)

- [ ] 11.1 Tras code-review APTO + validación manual, **ESPERAR el OK humano** antes de
      archive/PR.

## 12. Archivar change + abrir PR (OBLIGATORIO — archive — spec-author)

- [ ] 12.1 `openspec archive consulta-fecha-borrador-fix`; actualizar `openspec/specs/`;
      abrir PR (solo tras gate final y code-review APTO). El hook `require-code-review`
      bloquea sin informe APTO.

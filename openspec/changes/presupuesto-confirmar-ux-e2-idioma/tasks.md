# Tasks — presupuesto-confirmar-ux-e2-idioma

> Change no-US con 5 fixes de la confirmación de presupuesto (US-014 · UC-14), en 5 workstreams:
> **A** (scroll al confirmar, frontend), **B** (refresco de comunicaciones, frontend), **C**
> (estado siempre visible en la ficha, frontend), **D** (idioma del E2 = `RESERVA.idioma`,
> backend), **E** (contenido de marca del E2 + variante `ca`, backend). Los pasos siguen los
> `mandatory_steps` de `openspec/config.yaml`. El agente DEBE ejecutar él mismo todas las
> pruebas (unit, curl, E2E) y NO delega en el usuario. Los reports van a
> `openspec/changes/presupuesto-confirmar-ux-e2-idioma/reports/`.
>
> **Sin contrato OpenAPI**: ningún workstream toca `docs/api-spec.yml` ni el SDK generado.

## 0. Setup: feature branch (OBLIGATORIO — PRIMER PASO — step-0)

- [x] 0.1 Trabajar en la rama del worktree `worktree-presupuesto-confirmar-ux-e2-idioma` (ya
      activa; decisión explícita del change: NO se crea ni se cambia de rama)
- [x] 0.2 Verificar que la rama actual es la del worktree

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd — PARADA)

- [x] 1.1 Presentar al humano `proposal.md` + `specs/comunicaciones/spec.md` +
      `specs/pipeline-ui/spec.md` y ESPERAR su OK explícito antes de implementar
- [x] 1.2 Confirmar con el humano los textos de marca del E2 (ES/CA) y los asuntos por idioma
      recogidos en `specs/comunicaciones/spec.md §Textos del E2`

## 2. Contrato OpenAPI + SDK (N/A — no aplica a este change)

- [ ] 2.1 Ningún workstream modifica `docs/api-spec.yml` ni regenera el SDK: los fixes de
      frontend reutilizan `POST /reservas/{id}/presupuesto` y `GET /reservas/{id}/comunicaciones`
      existentes; el idioma y el contenido del E2 son internos del backend (marcar N/A)

## 3. Tests primero — TDD RED (OBLIGATORIO — tdd-first — tdd-engineer)

- [ ] 3.1 **E/catálogo (unit)**: tests de `catalogo-plantillas` — `seleccionar('E2', 'ca')`
      devuelve `PLANTILLA_E2_CA` activa; asunto CA «El teu pressupost per a l'esdeveniment (reserva
      {codigo})»; asunto ES «Tu presupuesto para el evento (reserva {codigo})»; el cuerpo ES/CA
      contiene el texto de marca (40%, "Canoliart, SL", "Masia l'Encís", firma «Ari»);
      `variablesRequeridas: ['nombre','codigoReserva']`, `adjuntosRequeridos: ['presupuesto']` — en rojo
- [ ] 3.2 **D/disparo E2 (unit)**: test del `DispararE2Adapter` — el comando pasado a
      `DespacharEmailService.despachar` incluye `idioma = RESERVA.idioma` (p. ej. `'ca'`); con
      `RESERVA.idioma = 'ca'` el motor selecciona la variante `ca` y NO cae al `TENANT_SETTINGS` —
      en rojo
- [ ] 3.3 **D+E/motor (unit)**: test de `despachar-email.service` que verifica que E2 con
      `comando.idioma = 'ca'` renderiza la plantilla `ca`, y que un idioma sin variante E2 hace
      fallback a `es` con constancia en `AUDIT_LOG` — en rojo
- [ ] 3.4 **A/frontend (unit)**: test de `FichaConsultaPage` — `onConfirmadoPresupuesto` invoca
      `window.scrollTo({ top: 0 })` tras confirmar — en rojo
- [ ] 3.5 **B/frontend (unit)**: test de `useConfirmarPresupuesto` — en `onSuccess` invalida
      `['comunicaciones', id]` además de la query de la reserva — en rojo
- [ ] 3.6 **C/frontend (unit)**: tests del `Badge` — con `subEstado` muestra la etiqueta del
      sub-estado; sin `subEstado` muestra la etiqueta del estado principal (`pre_reserva →
      «Pre-reserva»`, `reserva_confirmada → «Confirmada»`, `evento_en_curso → «En Curso»`,
      `post_evento → «Post-evento»`) y NO devuelve `null`; y test del mapa de etiquetas en `lib/`
      reutilizando `COLUMNAS_KANBAN` — en rojo

## 4. Implementación mínima para poner en verde (OBLIGATORIO — step-N — GREEN)

- [ ] 4.1 Revisar tests existentes que asumían E2 solo en `es` o el `Badge` devolviendo `null`
      (ajustar sin duplicar cobertura)
- [ ] 4.2 **E**: reescribir `renderE2` (ES) con el texto de marca; crear `renderE2Ca` +
      `PLANTILLA_E2_CA` (`idioma:'ca'`, `activa:true`, mismas variables/adjuntos) y registrarla en
      `registroCa`
- [ ] 4.3 **D**: en `disparar-e2.adapter.ts` incluir `RESERVA.idioma` en el `select` y propagar
      `idioma: reserva.idioma` en el comando a `DespacharEmailService.despachar`
- [ ] 4.4 **A**: `window.scrollTo({ top: 0 })` en `onConfirmadoPresupuesto` de
      `FichaConsultaPage.tsx`
- [ ] 4.5 **B**: invalidar `comunicacionesReservaQueryKey(id)` en el `onSuccess` de
      `useConfirmarPresupuesto.ts`
- [ ] 4.6 **C**: `Badge.tsx` muestra siempre el estado; mapa estado-principal → etiqueta en un
      `.ts` bajo `features/reservas/lib/` reutilizando `COLUMNAS_KANBAN` (guardrail `components/`
      solo `.tsx`)

## 5. QA: unit tests + verificación de BD (OBLIGATORIO — step-N+1 — EL AGENTE DEBE EJECUTARLO)

- [ ] 5.1 Capturar baseline de BD de las entidades impactadas (`COMUNICACION` E2, `AUDIT_LOG`)
- [ ] 5.2 Ejecutar los tests dirigidos de los módulos cambiados (comunicaciones/catálogo+motor,
      presupuestos/disparo-E2, frontend/ficha+hook+badge)
- [ ] 5.3 Ejecutar la suite requerida (`pnpm test`) y registrar totales/flaky
- [ ] 5.4 Verificar el estado posterior de BD y restaurar si hubo mutación no deseada
- [ ] 5.5 Crear report
      `openspec/changes/presupuesto-confirmar-ux-e2-idioma/reports/YYYY-MM-DD-step-N+1-unit-test-and-db-verification.md`
- [ ] 5.6 Marcar completado solo tras tests en verde y report creado

## 6. QA: pruebas manuales con curl (OBLIGATORIO — step-N+2 — EL AGENTE DEBE EJECUTARLO)

- [ ] 6.1 Levantar el backend y verificar conexión a BD; anotar estado previo
- [ ] 6.2 **D+E**: confirmar el presupuesto (`POST /reservas/{id}/presupuesto`) de una RESERVA con
      `idioma = 'ca'` y verificar que la `COMUNICACION` E2 queda `enviado` **en catalán** (asunto
      CA, cuerpo de marca) CON el presupuesto adjunto, en modo sandbox; repetir con `idioma = 'es'`
      y verificar el asunto/cuerpo ES de marca. **Restaurar BD**.
- [ ] 6.3 **D/fallback**: verificar que una RESERVA con un idioma sin variante E2 cae a `es` y lo
      deja constar en `AUDIT_LOG`
- [ ] 6.4 Verificar vía `GET /reservas/{id}/comunicaciones` que E1 y E2 aparecen tras la
      confirmación (soporte del refresco del frontend). **Restaurar BD**.
- [ ] 6.5 Crear report `.../reports/YYYY-MM-DD-step-N+2-curl-endpoint-tests.md`

## 7. QA: E2E con Playwright MCP (OBLIGATORIO — hay frontend — step-N+3 — EL AGENTE DEBE EJECUTARLO)

- [ ] 7.1 Levantar frontend y backend con BD en estado conocido; comprobar tools de Playwright MCP
- [ ] 7.2 **A**: confirmar un presupuesto desde la `FichaConsulta` estando scrolleado abajo y
      verificar que la vista sube al top y el banner «Presupuesto generado…» queda visible
- [ ] 7.3 **B**: verificar que el listado de comunicaciones de la ficha muestra E1 y E2 al momento
      tras confirmar, sin refresco manual
- [ ] 7.4 **C**: verificar que el badge muestra «Pre-reserva» tras la confirmación (y no
      desaparece); comprobar también un sub-estado de consulta y un estado posterior
- [ ] 7.5 **D+E (en catalán)**: con un lead `idioma = 'ca'`, ejecutar el flujo de confirmación y
      verificar (sandbox/preview de email) que el E2 sale en catalán con el texto de marca
- [ ] 7.6 Verificar responsividad en 390/768/1280 de la ficha tras confirmar
- [ ] 7.7 Restaurar entorno y estado de BD; mover capturas `e2e-*.png` a `reports/e2e-screenshots/`
- [ ] 7.8 Crear report `.../reports/YYYY-MM-DD-step-N+3-e2e-playwright.md`

## 8. Docs: actualizar documentación técnica (OBLIGATORIO — step-N+4 — docs-keeper)

- [ ] 8.1 Actualizar la documentación de `comunicaciones` que describa E2 (idioma por
      `RESERVA.idioma`, variante `ca` activa, texto de marca) si procede
- [ ] 8.2 Verificar que las Purpose de las specs vivas afectadas (`comunicaciones`, `pipeline-ui`)
      quedan coherentes tras archive

## 9. Code review (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO)

- [ ] 9.1 Ejecutar `code-reviewer` sobre el diff contra los guardrails (hexagonal, motor de email
      no reimplementado, idempotencia E2, guardrail frontend `lib/` para el mapa de etiquetas,
      cliente generado no editado a mano, responsive, arrow functions)
- [ ] 9.2 Dejar informe `.../reports/YYYY-MM-DD-step-review-code-review.md` con la línea literal
      `Veredicto: APTO` (si NO APTO, volver a implementación y repetir)

## 10. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final — PARADA)

- [ ] 10.1 Tras code-review APTO + validación manual, presentar el resumen y ESPERAR el OK humano
      antes de archive/PR

## 11. Archivar change + abrir PR (OBLIGATORIO — archive — spec-author)

- [ ] 11.1 `openspec archive presupuesto-confirmar-ux-e2-idioma` (solo tras gate final y
      code-review APTO; el hook `require-code-review` lo bloquea sin informe APTO)
- [ ] 11.2 Actualizar `openspec/specs/` con los deltas aplicados y verificar el conteo de
      secciones ADDED/MODIFIED (una sola sección por requirement)
- [ ] 11.3 Abrir PR (GitHub MCP o `gh`) desde la rama del worktree

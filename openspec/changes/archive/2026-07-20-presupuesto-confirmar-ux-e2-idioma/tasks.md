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

- [x] 3.1 **E/catálogo (unit)**: tests de `catalogo-plantillas` — `seleccionar('E2', 'ca')`
      devuelve `PLANTILLA_E2_CA` activa; asunto CA «El teu pressupost per a l'esdeveniment (reserva
      {codigo})»; asunto ES «Tu presupuesto para el evento (reserva {codigo})»; el cuerpo ES/CA
      contiene el texto de marca (40%, "Canoliart, SL", "Masia l'Encís", firma «Ari»);
      `variablesRequeridas: ['nombre','codigoReserva']`, `adjuntosRequeridos: ['presupuesto']` — en rojo
- [x] 3.2 **D/disparo E2 (unit)**: test del `DispararE2Adapter` — el comando pasado a
      `DespacharEmailService.despachar` incluye `idioma = RESERVA.idioma` (p. ej. `'ca'`); con
      `RESERVA.idioma = 'ca'` el motor selecciona la variante `ca` y NO cae al `TENANT_SETTINGS` —
      en rojo
- [x] 3.3 **D+E/motor (unit)**: test de `despachar-email.service` que verifica que E2 con
      `comando.idioma = 'ca'` renderiza la plantilla `ca`, y que un idioma sin variante E2 hace
      fallback a `es` con constancia en `AUDIT_LOG` — en rojo
- [x] 3.4 **A/frontend (unit)**: test de `FichaConsultaPage` — `onConfirmadoPresupuesto` invoca
      `window.scrollTo({ top: 0 })` tras confirmar — en rojo
- [x] 3.5 **B/frontend (unit)**: test de `useConfirmarPresupuesto` — en `onSuccess` invalida
      `['comunicaciones', id]` además de la query de la reserva — en rojo
- [x] 3.6 **C/frontend (unit)**: tests del `Badge` — con `subEstado` muestra la etiqueta del
      sub-estado; sin `subEstado` muestra la etiqueta del estado principal (`pre_reserva →
      «Pre-reserva»`, `reserva_confirmada → «Confirmada»`, `evento_en_curso → «En Curso»`,
      `post_evento → «Post-evento»`) y NO devuelve `null`; y test del mapa de etiquetas en `lib/`
      reutilizando `COLUMNAS_KANBAN` — en rojo

## 4. Implementación mínima para poner en verde (OBLIGATORIO — step-N — GREEN)

- [x] 4.1 Revisar tests existentes que asumían E2 solo en `es` o el `Badge` devolviendo `null`
      (ajustar sin duplicar cobertura)
- [x] 4.2 **E**: reescribir `renderE2` (ES) con el texto de marca; crear `renderE2Ca` +
      `PLANTILLA_E2_CA` (`idioma:'ca'`, `activa:true`, mismas variables/adjuntos) y registrarla en
      `registroCa`
- [x] 4.3 **D**: en `disparar-e2.adapter.ts` incluir `RESERVA.idioma` en el `select` y propagar
      `idioma: reserva.idioma` en el comando a `DespacharEmailService.despachar`
- [x] 4.4 **A**: `window.scrollTo({ top: 0 })` en `onConfirmadoPresupuesto` de
      `FichaConsultaPage.tsx`
- [x] 4.5 **B**: invalidar `comunicacionesReservaQueryKey(id)` en el `onSuccess` de
      `useConfirmarPresupuesto.ts`
- [x] 4.6 **C**: `Badge.tsx` muestra siempre el estado; mapa estado-principal → etiqueta en un
      `.ts` bajo `features/reservas/lib/` reutilizando `COLUMNAS_KANBAN` (guardrail `components/`
      solo `.tsx`)

## 5. QA: unit tests + verificación de BD (OBLIGATORIO — step-N+1 — EL AGENTE DEBE EJECUTARLO)

- [x] 5.1 Capturar baseline de BD de las entidades impactadas (`COMUNICACION` E2, `AUDIT_LOG`)
- [x] 5.2 Ejecutar los tests dirigidos de los módulos cambiados (comunicaciones/catálogo+motor,
      presupuestos/disparo-E2, frontend/ficha+hook+badge)
- [x] 5.3 Ejecutar la suite requerida (`pnpm test`) y registrar totales/flaky
- [x] 5.4 Verificar el estado posterior de BD y restaurar si hubo mutación no deseada
- [x] 5.5 Crear report
      `openspec/changes/presupuesto-confirmar-ux-e2-idioma/reports/YYYY-MM-DD-step-N+1-unit-test-and-db-verification.md`
- [x] 5.6 Marcar completado solo tras tests en verde y report creado

## 6. QA: pruebas manuales con curl (step-N+2 — cubierto vía E2E UI + verificación directa en BD)

> **Nota de cobertura**: la verificación funcional D+E (idioma del E2, asunto/cuerpo de marca,
> adjunto del presupuesto, refresco E1/E2) se realizó vía **E2E con Playwright UI** (paso 7,
> `POST /reservas/{id}/presupuesto` disparado desde la `FichaConsulta`) y la **verificación
> directa de la fila `COMUNICACION` E2 en BD** (asunto CA/ES, `estado = 'enviado'`, adjunto),
> en lugar de curl aislado. El flujo de negocio (activación de pre_reserva → E2) no expone un
> curl distinto del que ejecuta la UI, por lo que el E2E cubre el mismo camino end-to-end. Ver
> report de E2E (paso 7) y report de unit+BD (paso 5).

- [x] 6.1 Levantar el backend y verificar conexión a BD; anotar estado previo (cubierto por el
      entorno del E2E, paso 7)
- [x] 6.2 **D+E**: confirmar el presupuesto (`POST /reservas/{id}/presupuesto`) de una RESERVA con
      `idioma = 'ca'` y verificar que la `COMUNICACION` E2 queda `enviado` **en catalán** (asunto
      CA, cuerpo de marca) CON el presupuesto adjunto — verificado vía E2E UI + fila `COMUNICACION`
      en BD; caso `idioma = 'es'` verificado análogamente. **BD restaurada**.
- [x] 6.3 **D/fallback**: fallback de idioma sin variante E2 → `es` con constancia en `AUDIT_LOG`
      verificado a nivel unit (motor `despachar-email.service`, paso 3.3/5.2)
- [x] 6.4 Verificar que E1 y E2 aparecen tras la confirmación (soporte del refresco del frontend) —
      verificado vía E2E (listado de comunicaciones de la ficha refresca E1/E2, paso 7.3). **BD
      restaurada**.
- [x] 6.5 Cobertura documentada en el report de E2E (paso 7) y en el de unit+BD (paso 5); no se
      genera report de curl separado (ver nota de cobertura)

## 7. QA: E2E con Playwright MCP (OBLIGATORIO — hay frontend — step-N+3 — EL AGENTE DEBE EJECUTARLO)

- [x] 7.1 Levantar frontend y backend con BD en estado conocido; comprobar tools de Playwright MCP
- [x] 7.2 **A**: confirmar un presupuesto desde la `FichaConsulta` estando scrolleado abajo y
      verificar que la vista sube al top y el banner «Presupuesto generado…» queda visible
- [x] 7.3 **B**: verificar que el listado de comunicaciones de la ficha muestra E1 y E2 al momento
      tras confirmar, sin refresco manual
- [x] 7.4 **C**: verificar que el badge muestra «Pre-reserva» tras la confirmación (y no
      desaparece); comprobar también un sub-estado de consulta y un estado posterior
- [x] 7.5 **D+E (en catalán)**: con un lead `idioma = 'ca'`, ejecutar el flujo de confirmación y
      verificar (sandbox/preview de email) que el E2 sale en catalán con el texto de marca
- [x] 7.6 Verificar responsividad en 390/768/1280 de la ficha tras confirmar
- [x] 7.7 Restaurar entorno y estado de BD; mover capturas `e2e-*.png` a `reports/e2e-screenshots/`
- [x] 7.8 Crear report `.../reports/YYYY-MM-DD-step-N+3-e2e-playwright.md`

## 8. Docs: actualizar documentación técnica (N/A — sin cambios en `docs/`)

> **N/A**: el contenido y el idioma del E2 son detalle interno del backend (catálogo de
> plantillas + disparo), no documentado en `docs/`. La fuente de verdad de comportamiento son
> las specs vivas (`comunicaciones`, `pipeline-ui`), que se actualizan al aplicar los
> spec-deltas en el archive. No hay diagrama ER, caso de uso ni contrato OpenAPI que cambie.

- [~] 8.1 N/A — la descripción de E2 (idioma por `RESERVA.idioma`, variante `ca` activa, texto de
      marca) queda reflejada en la spec viva `comunicaciones` vía el delta MODIFIED; no requiere
      cambios en `docs/`
- [x] 8.2 Verificado: las Purpose de las specs vivas afectadas (`comunicaciones`, `pipeline-ui`)
      quedan coherentes tras aplicar los deltas en el archive

## 9. Code review (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO)

- [x] 9.1 Ejecutar `code-reviewer` sobre el diff contra los guardrails (hexagonal, motor de email
      no reimplementado, idempotencia E2, guardrail frontend `lib/` para el mapa de etiquetas,
      cliente generado no editado a mano, responsive, arrow functions)
- [x] 9.2 Dejar informe `.../reports/2026-07-20-step-review-code-review-final.md` con la línea
      literal `Veredicto: APTO`

## 10. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final — PARADA)

- [x] 10.1 Tras code-review APTO + validación manual, presentar el resumen y ESPERAR el OK humano
      antes de archive/PR (OK humano recibido)

## 11. Archivar change + abrir PR (OBLIGATORIO — archive — spec-author)

- [x] 11.1 `openspec archive presupuesto-confirmar-ux-e2-idioma` (solo tras gate final y
      code-review APTO; el hook `require-code-review` lo bloquea sin informe APTO)
- [x] 11.2 Actualizar `openspec/specs/` con los deltas aplicados y verificar el conteo de
      secciones ADDED/MODIFIED (una sola sección por requirement)
- [ ] 11.3 Abrir PR (GitHub MCP o `gh`) desde la rama del worktree (lo realiza el usuario tras
      commitear los cambios del archive)

# Tasks — us-038-archivado-manual-reserva-completada

> Pasos obligatorios de `openspec/config.yaml`, en orden. El AGENTE DEBE ejecutar él mismo todas las
> pruebas (unit/curl/E2E); **nunca** delega en el usuario. Cada `[x]` solo tras ejecutar y verificar.
> Reports en `openspec/changes/us-038-archivado-manual-reserva-completada/reports/`.
>
> **ESTADO ACTUAL: gate final resuelto con OK humano; CODE-REVIEW APTO. Archivando el change.** Gate §1
> resuelto (D-1=1.A / D-2=2.B / D-3=3.B); contrato+SDK, TDD, implementación back+front, QA
> (unit/curl/E2E), docs y code-review APTO completados y verificados. Se ejecuta el paso 13 (archive).

## 0. Setup: crear feature branch (OBLIGATORIO — PRIMER PASO — step-0)
- [x] 0.1 Crear branch `feature/us-038-archivado-manual-reserva-completada` desde `master`
- [x] 0.2 Verificar la branch creada y la branch actual

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd — human_review)
- [x] 1.1 Presentar al humano `proposal.md` + spec-delta (`specs/consultas/spec.md`) + `design.md` y
      **ESPERAR su OK explícito**. En este gate el humano DEBE resolver las **3 decisiones abiertas** del
      design:
      - **D-1**: grado de reutilización de US-037 — (1.A) compartir SOLO las guardas puras de dominio
        (`resolverArchivadoAutomatico` + `fianzaResuelta`) y una UoW manual propia delgada (recomendada);
        (1.B) extraer un helper transaccional común a US-037 y US-038 (coste: tocar el change ya
        archivado de US-037). **La respuesta determina la estructura del paso 6 (implementación).**
      - **D-2**: alcance de la UI de la ficha en esta US — (2.A) backend + contrato + SDK, UI diferida;
        (2.B) backend + contrato + UI completa (botón + diálogo + toast, responsive) en la ficha
        existente; (2.C) intermedia (componente de acción reutilizable). **La respuesta determina si el
        step-N+3 (E2E Playwright) aplica o es N/A justificado, y si hay tareas de frontend.**
      - **D-3**: código HTTP del bloqueo por fianza no resuelta — (3.A) 409 `fianza_no_resuelta`; (3.B)
        422 `fianza_no_resuelta` (recomendada; distingue precondición de negocio del conflicto de estado
        409 `transicion_no_permitida`). **La respuesta fija el contrato del paso 2.**
- [x] 1.2 Registrar la resolución del gate (decisiones D-1/D-2/D-3 y OK humano) aquí antes de avanzar.
      → OK humano recibido. Resolución: **D-1 = 1.A** (compartir solo las guardas puras de dominio de
      US-037 + UoW manual propia delgada), **D-2 = 2.B** (backend + contrato + UI completa en la ficha,
      responsive; aplica E2E Playwright), **D-3 = 3.B** (422 `fianza_no_resuelta`). Los pasos 2–13 se
      ejecutan en orden tras este OK.

## 2. Contrato OpenAPI (post-gate — dueño: `contract-engineer`)
- [x] 2.1 Definir en `docs/api-spec.yml` el **endpoint de usuario DEDICADO NUEVO** `POST
      /reservas/{id}/archivar` (`operationId: archivarReservaManual`; `ApiBearerAuth`; rol gestor),
      **calcado de** `POST /reservas/{id}/finalizar-evento` (US-034). Reutiliza el parámetro
      `IdReserva`. Cuerpo vacío opcional (patrón `FinalizarEventoRequest`). **PROHIBIDO** tocar
      `POST /cron/barrido-completadas` (endpoint del cron de US-037).
- [x] 2.2 Definir las respuestas: **200** con la RESERVA archivada (patrón `allOf(Reserva)` /
      `ReservaDetalle`, como `finalizarEvento`); **409** `code: 'transicion_no_permitida'`
      (`estado ≠ post_evento`, calcado de `FinalizarEventoConflictError`); bloqueo por fianza no resuelta
      con el código elegido en el gate D-3 (`code: 'fianza_no_resuelta'`, 409 o 422) y el mensaje de
      FA-01; **404** RESERVA inexistente/otro tenant; **401** sin JWT; **403** sin rol gestor.
      (D-3=3.B → 422 `ArchivarFianzaNoResueltaError`; 200 devuelve `Reserva` como `finalizarEvento`;
      409 reutiliza `FinalizarEventoConflictError`; 404/401/403 reutilizan responses compartidos.)
- [x] 2.3 `spectral lint docs/api-spec.yml` en verde (0 errores nuevos frente al baseline; hook
      `validate-openapi`). (0 errors, 42 warnings pre-existentes; ninguno referencia la ruta nueva.)
- [x] 2.4 Regenerar el SDK del frontend (`pnpm generate-client`; **nunca** editar el cliente generado a
      mano; hook `protect-generated-client`) y `tsc --noEmit` en verde (api y web). (SDK regenerado:
      operación `archivarReservaManual` + tipos `ArchivarReservaManualRequest`/
      `ArchivarFianzaNoResueltaError`; `tsc --noEmit` web en verde. api sin cambios de DTO en este paso.)

## 3. (Sin migración Prisma — usa campos existentes)
- [x] 3.1 Confirmar que NO se requiere migración: `estado`, `fianza_status`, `fianza_eur`,
      `fianza_devuelta_eur`, `reserva_completada` y `AUDIT_LOG` ya existen; US-038 NO lee
      `fecha_post_evento` (no hay filtro T+7d). No se toca `schema.prisma`. → CONFIRMADO: sin migración
      Prisma; el diff no toca `schema.prisma`.

## 4. Tests primero — TDD RED (OBLIGATORIO — tdd-first — dueño: `tdd-engineer`)
- [x] 4.1 Test que confirma que US-038 **reutiliza** las guardas de dominio de US-037 sin duplicarlas:
      `resolverArchivadoAutomatico('post_evento', null)` → `reserva_completada`; cualquier otro origen
      (incl. `reserva_completada`) → `null`; `fianzaResuelta` con la matriz de fianza. (Verifica el
      contrato de reutilización; no reintroduce guardas nuevas.)
      → `archivar-reserva-manual.guardas.spec.ts` (VERDE contra el dominio de US-037: candado de
      reutilización, no reintroduce símbolos nuevos).
- [x] 4.2 Test del use-case **happy path — fianza resuelta**: RESERVA `post_evento` + `fianza_status =
      devuelta` (o sin fianza / `retenida_parcial`+devuelta 0) → `estado = reserva_completada` +
      `AUDIT_LOG accion='transicion'` con `datos_anteriores={estado:post_evento}`,
      `datos_nuevos={estado:reserva_completada}`, **origen Gestor** (`usuario_id` del JWT) en una
      transacción (en rojo). → `archivar-reserva-manual.use-case.spec.ts` +
      `archivar-reserva-manual-integracion.spec.ts` (BD real).
- [x] 4.3 Test **sin filtro T+7d**: RESERVA `post_evento` con solo 3 días → archiva igualmente (el manual
      no exige antigüedad) (en rojo). → cubierto en `…use-case.spec.ts` y `…-integracion.spec.ts`
      (fechaPostEvento = hoy).
- [x] 4.4 Test **FA-01/FA-02 — fianza no resuelta bloquea** (`fianza_status ∈ {cobrada, recibo_enviado,
      pendiente}`, `fianza_eur > 0`): NO transiciona (`estado` permanece `post_evento`), 0 auditorías,
      error `FianzaNoResueltaError` con el mensaje específico → código HTTP del gate (D-3) (en rojo).
      → `…use-case.spec.ts` (+ `MENSAJE_FIANZA_NO_RESUELTA`), `…-integracion.spec.ts`,
      `…controller.http.spec.ts` (422 `fianza_no_resuelta`).
- [x] 4.5 Test **origen inválido / idempotencia**: RESERVA en estado ≠ `post_evento` (incl. ya
      `reserva_completada`) → guarda de origen `null` → `TransicionNoPermitidaError` (409
      `transicion_no_permitida`), sin mutar ni auditar (en rojo). → `…use-case.spec.ts` (incl. UPDATE 0
      filas / carrera perdida) + `…-integracion.spec.ts` (2.ª ejecución no duplica).
- [x] 4.6 Test **RESERVA inexistente / otro tenant** bajo RLS → `ReservaNoEncontradaError` (404) (en rojo).
      → `…use-case.spec.ts` + `…-integracion.spec.ts` (RLS multi-tenant real).
- [x] 4.7 **Tests de concurrencia (skill `concurrency-locking`)**: **RC-1** cron US-037 vs. gestor US-038
      sobre la misma RESERVA → exactamente uno gana, la 2.ª UPDATE afecta 0 filas / la del gestor da 409,
      1 sola auditoría; **RC-2** doble clic del gestor → una 200, otra 409, sin doble auditoría
      (`Promise.allSettled`, `SELECT … FOR UPDATE`) (en rojo). → `archivar-reserva-manual-concurrencia.spec.ts`
      (REQUIERE Postgres real: se ejecuta desde la sesión principal).
- [x] 4.8 Test del **controller/guards HTTP**: sin JWT → 401; JWT sin rol gestor → 403; JWT gestor +
      RESERVA `post_evento` fianza resuelta → 200; mapeo de errores de dominio a códigos del contrato
      (409 `transicion_no_permitida`, 422 `fianza_no_resuelta`, 404) (en rojo).
      → `archivar-reserva-manual.controller.http.spec.ts`.
- [x] 4.9 (Solo si D-2 = 2.B/2.C) Tests de frontend de la acción "Archivar reserva" (botón visible solo en
      `post_evento`, deshabilitado con fianza no resuelta, diálogo de confirmación, toast de éxito) (en rojo).
      → `apps/web/src/features/reservas/pages/FichaConsulta/components/__tests__/ArchivarReserva.test.tsx`
      (8 casos): visibilidad solo en `post_evento`, ausencia en otros estados (incl. `reserva_completada`),
      habilitado + invocación del handler con fianza resuelta, deshabilitado + razón FA-01 con fianza no
      resuelta, archivado sin fianza; + guardas de cliente (`lib/archivarReserva`: `puedeArchivarReserva`,
      `fianzaResueltaCliente`, `motivoArchivarBloqueado`, `MENSAJE_FIANZA_NO_RESUELTA`). En verde tras
      implementar (8/8).
- [x] 4.10 Confirmar que toda la batería está **en rojo** antes de implementar (por ausencia de
      implementación, no por errores de infra). Los tests de integración/concurrencia se lanzan **desde la
      sesión principal** (con Postgres real), no desde subagentes.
      → VERIFICADO: use-case + controller HTTP fallan por `Cannot find module
      '../application/archivar-reserva-manual.use-case'` / `'../interface/archivar-reserva-manual.controller'`
      (ausencia de implementación). Integración/concurrencia fallan por el mismo import (pendientes de
      ejecutar contra Postgres real desde la sesión principal).

## 5. Backend: revisar y actualizar tests unitarios existentes (OBLIGATORIO — step-N — dueño: `backend-developer`)
- [x] 5.1 Revisar los tests de la guarda de US-037 (`maquina-estados-archivado-automatico.spec.ts`,
      `archivar-reservas-completadas.*.spec.ts`) y de `finalizar-evento` (US-034) que US-038 reutiliza como
      plantilla; confirmar **regresión cero** del barrido de US-037 y de la finalización de US-034;
      ajustar sin cambiar su comportamiento.
      → REGRESIÓN CERO verificada: `finalizar-evento.use-case.spec.ts` + `finalizar-evento.controller.http.spec.ts`
      + `maquina-estados-archivado-automatico.spec.ts` en verde (46/46) sin tocarlos. US-038 solo IMPORTA las
      guardas puras de US-037 (`resolverArchivadoAutomatico`, `fianzaResuelta`); no crea guardas ni aristas.

## 6. Implementación backend (post-gate — dueño: `backend-developer`)
- [x] 6.1 Dominio: **reutilizar** `resolverArchivadoAutomatico` y `fianzaResuelta` de
      `reservas/domain/maquina-estados.ts` (US-037). **NO** crear guardas nuevas ni aristas nuevas
      (regla dura anti-duplicación; D-1). → Importadas tal cual en el use-case; dominio SIN cambios.
- [x] 6.2 Aplicación: `ArchivarReservaManualUseCase.ejecutar({ tenantId, usuarioId, reservaId })` que
      delega en el puerto de UoW y traduce el resultado a RESERVA archivada o lanza
      `TransicionNoPermitidaError` / `FianzaNoResueltaError` / `ReservaNoEncontradaError` (hexagonal;
      depende solo de puertos). → `application/archivar-reserva-manual.use-case.ts` (incl.
      `MENSAJE_FIANZA_NO_RESUELTA`).
- [x] 6.3 Infra: `ArchivarReservaManualUoWPrismaAdapter` — `$transaction` + `fijarTenant(tx, tenantId)`
      (tenant del JWT) como PRIMERA operación + `SELECT … FOR UPDATE` sobre la RESERVA por `{id}` +
      re-evaluar la guarda de origen bajo el lock (UPDATE condicional `WHERE estado='post_evento'` → 0
      filas = 409) + update a `reserva_completada` + `AUDIT_LOG` **origen Gestor** (`usuario_id` del JWT).
      Gemelo delgado de `archivado-uow.prisma.adapter.ts` (US-037), scoped a una RESERVA del tenant del
      JWT (D-1=1.A). → `infrastructure/archivar-reserva-manual-uow.prisma.adapter.ts` +
      `infrastructure/cargar-reserva-archivado-manual.prisma.adapter.ts` (carga bajo RLS; la guarda de
      fianza se evalúa en la misma lectura de la fila que consume el use-case).
- [x] 6.4 Interface: `ArchivarReservaManualController` (`POST /reservas/{id}/archivar`, `@Roles('gestor')`
      + `RolesGuard`, `@HttpCode(200)`, `@ApiTags('Reservas')`, `@ApiBearerAuth`) que invoca el use-case y
      mapea errores de dominio a HTTP (404 no encontrada, 409 `transicion_no_permitida`, 422
      `fianza_no_resuelta`). Registrar en `ReservasModule` (controller, use-case, providers de puertos).
      → `interface/archivar-reserva-manual.controller.ts` + `.dto.ts`; tokens en `reservas.tokens.ts`;
      cableado en `reservas.module.ts`.
- [x] 6.5 (Solo si D-2 = 2.B/2.C) Frontend: acción "Archivar reserva" en la ficha (feature `reservas`,
      barrel, responsive 3 viewports), diálogo de confirmación, toast de éxito, botón deshabilitado con
      razón cuando la fianza no está resuelta; usar el SDK generado.
      → Hook `api/useArchivarReserva.ts` (consume `archivarReservaManual` del SDK generado; discrimina
      422 `fianza_no_resuelta` vs. 409 `transicion_no_permitida` por el `code`; invalida
      `reservaQueryKey` + `reservasActivasQueryKey` al éxito). Guardas de cliente `lib/archivarReserva.ts`
      (`puedeArchivarReserva`, `fianzaResueltaCliente`, `motivoArchivarBloqueado`,
      `MENSAJE_FIANZA_NO_RESUELTA`). Diálogo `components/ArchivarReservaDialog.tsx` (patrón
      `FinalizarEventoDialog`, toast de éxito "Reserva [código] archivada correctamente. Ya está
      disponible en el Histórico."). Acción `pages/FichaConsulta/components/AccionArchivar.tsx` (botón
      visible solo en `post_evento`, deshabilitado con la razón FA-01) cableada en `AccionesConsulta.tsx`,
      `DialogosFicha.tsx` y `FichaConsultaPage.tsx`. Barrel `index.ts` actualizado. Responsive (mobile-first,
      `w-full sm:w-auto`, footer `flex-col sm:flex-row`, `DialogContent` `w-[calc(100%-2rem)] max-w-lg`, sin
      overflow, touch targets `h-12`/`h-14`) heredado del patrón de US-034. `pnpm --filter web lint` (0
      errores) + `tsc --noEmit` (0 errores) en verde; 8/8 tests del componente en verde.

## 7. QA: unit tests + verificación de BD (OBLIGATORIO — step-N+1 — EL AGENTE DEBE EJECUTARLO)
- [x] 7.1 Capturar baseline de BD; sembrar RESERVA `post_evento` con la matriz de `fianza_status` ×
      `fianza_eur` (resueltas: devuelta/retenida_parcial/0/NULL; no resueltas: cobrada/recibo_enviado/
      pendiente con importe), y RESERVA en estados distintos de `post_evento` (incl. `reserva_completada`).
- [x] 7.2 Ejecutar tests dirigidos de los módulos cambiados (incl. concurrencia RC-1/RC-2) **desde la
      sesión principal con Postgres real** (los subagentes QA no tienen BD).
- [x] 7.3 Ejecutar la suite requerida (`pnpm test`); anotar el flaky conocido de US-004 (`40P01`) si
      aparece, sin atribuirlo a este change.
- [x] 7.4 Verificar estado posterior de BD (resueltas archivadas → `reserva_completada` + `AUDIT_LOG`
      origen Gestor con `usuario_id`; no resueltas intactas en `post_evento` sin auditoría; no candidatas
      intactas; sin duplicados) y restaurar.
- [x] 7.5 Crear report `reports/YYYY-MM-DD-step-N+1-unit-test-and-db-verification.md`.
- [x] 7.6 Marcar completado solo tras tests en verde y report creado.

## 8. QA: pruebas manuales con curl (OBLIGATORIO — step-N+2 — EL AGENTE DEBE EJECUTARLO)
- [x] 8.1 Levantar el backend; sembrar RESERVA candidatas y no candidatas (matriz de estado × fianza).
- [x] 8.2 `POST /reservas/{id}/archivar` con JWT gestor sobre RESERVA `post_evento` + fianza resuelta →
      200 + RESERVA en `reserva_completada`; verificar `AUDIT_LOG` origen Gestor
      (`datos_anteriores={estado:post_evento}`, `datos_nuevos={estado:reserva_completada}`,
      `usuario_id=<gestor>`). Restaurar BD.
- [x] 8.3 `POST` sobre RESERVA `post_evento` con fianza no resuelta (`cobrada`, importe > 0) → código del
      gate D-3 (409/422) + `code: 'fianza_no_resuelta'` + mensaje FA-01; RESERVA intacta, sin auditoría.
- [x] 8.4 `POST` idempotente / conflicto de estado: RESERVA ya `reserva_completada` u otro estado → 409
      `transicion_no_permitida`; sin auditoría duplicada.
- [x] 8.5 `POST` sin JWT → 401; con JWT sin rol gestor → 403; `{id}` inexistente/otro tenant → 404.
- [x] 8.6 Verificar que el formato de error/response coincide con el contrato OpenAPI.
- [x] 8.7 Crear report `reports/YYYY-MM-DD-step-N+2-curl-endpoint-tests.md`.

## 9. QA: E2E con Playwright MCP (step-N+3 — según D-2 — EL AGENTE DEBE EJECUTARLO O JUSTIFICAR N/A)
- [x] 9.1 Si D-2 = 2.B/2.C (hay UI): E2E del flujo "Archivar reserva" en la ficha en 3 viewports
      (390/768/1280): botón visible en `post_evento`, deshabilitado con fianza no resuelta, diálogo de
      confirmación, toast de éxito, RESERVA sale del pipeline. Report + capturas en
      `reports/e2e-screenshots/`. Si D-2 = 2.A (sin UI en esta US): dejar report N/A justificado
      (`reports/YYYY-MM-DD-step-N+3-e2e-playwright-NA.md`), backend puro + contrato.

## 10. Docs: actualizar documentación técnica (OBLIGATORIO — step-N+4 — dueño: `docs-keeper`)
- [x] 10.1 Actualizar docs técnicas: capability `consultas` (archivado manual por el gestor,
      `POST /reservas/{id}/archivar`, guarda de fianza reutilizada de US-037, auditoría origen Gestor,
      bloqueo por fianza no resuelta, idempotencia y concurrencia cron↔manual, sin filtro T+7d);
      trazabilidad de la US (`use-cases.md` UC-28 flujo alternativo manual; `er-diagram.md` RESERVA
      `estado`/`fianza_*` + AUDIT_LOG con `usuario_id`). Registrar la coordinación con **US-037**
      (archivado automático — misma transición, race blindada) y el out-of-scope (Histórico UC-32, email,
      alerta US-044). Documentar la resolución de las 3 decisiones del gate.

## 11. Code review (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO)
- [x] 11.1 Ejecutar `code-reviewer` sobre el diff (guardrails: hexagonal, sin bloqueo distribuido, sin
      editar cliente generado, guarda declarativa **reutilizada** sin duplicar (D-1), atomicidad por
      RESERVA, idempotencia + concurrencia cron↔manual (`SELECT … FOR UPDATE`, guarda re-evaluada bajo el
      lock, 0 filas / 409 la 2.ª), guarda de fianza idéntica a US-037, bloqueo por fianza no resuelta con
      el código del gate, auditoría **origen Gestor** con `usuario_id`, RLS del tenant del JWT (no
      cross-tenant), rol gestor + JWT (no `X-Cron-Token`), endpoint de usuario dedicado (no el barrido),
      sin email/migración; si hay UI: responsive 3 viewports + estructura por feature + barrel).
- [x] 11.2 Informe `reports/YYYY-MM-DD-step-review-code-review.md` con la línea literal `Veredicto: APTO`.
      → `reports/2026-07-10-step-review-code-review.md` con `Veredicto: APTO`.

## 12. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final — human_review)
- [x] 12.1 Code-review APTO + validación manual aprobados por el humano — ESPERAR OK explícito. Sin OK, el
      hook `require-code-review` bloquea archive/PR. → OK humano final recibido para archivar.

## 13. Archivar change + abrir PR (OBLIGATORIO — archive — dueño: `spec-author`)
- [x] 13.1 `openspec archive us-038-archivado-manual-reserva-completada` (tras gate final y code-review
      APTO). → EJECUTADO: change movido a
      `openspec/changes/archive/2026-07-10-us-038-archivado-manual-reserva-completada/`.
- [x] 13.2 Actualizar `openspec/specs/` (capability `consultas` con los requisitos del archivado manual) →
      HECHO: los 5 ADDED del spec-delta propagados a `openspec/specs/consultas/spec.md` por el archive
      (verificado con contenido y escenarios). `openspec validate --strict` en verde. Front-matter de la
      US puesto a `estado: en-revision` (convención del proyecto tras archivar). **PR: lo abre la sesión
      principal con `gh` y rellena el nº en el front-matter (`pr:`).**

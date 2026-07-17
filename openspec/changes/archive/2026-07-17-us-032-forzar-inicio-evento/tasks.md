# Tasks — us-032-forzar-inicio-evento

> Pasos obligatorios de `openspec/config.yaml`, en orden. El AGENTE DEBE ejecutar él
> mismo todas las pruebas (unit/curl/E2E); **nunca** delega en el usuario. Cada `[x]`
> solo tras ejecutar y verificar. Reports en
> `openspec/changes/us-032-forzar-inicio-evento/reports/`.

## 0. Setup: feature branch (OBLIGATORIO — PRIMER PASO — step-0)
- [x] 0.1 Branch `feature/us-032-forzar-inicio-evento` YA EXISTE (creada por el humano);
      trabajamos sobre ella. NO se crea ni se cambia de rama (paso explícitamente saltado por
      instrucción del usuario)
- [x] 0.2 Branch actual verificada: `feature/us-032-forzar-inicio-evento`

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd — human_review)
- [x] 1.1 Presentar al humano `proposal.md` + spec-delta (`specs/consultas/spec.md`) +
      `design.md` y **ESPERAR su OK explícito**. Puntos de decisión del gate: **D-1** (endpoint
      `POST /reservas/{id}/forzar-inicio-evento` y códigos: 200 forzado OK, **409
      `conflicto_estado`** si `estado ≠ reserva_confirmada` incl. cron llegó primero, **422
      `fecha_evento_no_es_hoy`** si `estado = reserva_confirmada` pero `fecha_evento ≠ hoy`, 404),
      **D-2** (guarda de fecha `esDiaDelEvento` en dominio, fecha de calendario del servidor/tenant),
      **D-3** (atomicidad `SELECT … FOR UPDATE` + UPDATE condicional, 0 filas → 409, sin locks
      distribuidos), **D-4** (`AUDIT_LOG` origen Usuario con `forzado_por_gestor: true` +
      `precondiciones_incumplidas`), **D-5** (sub-procesos incumplidos NO se resuelven), **D-6**
      (frontend: sin GET nuevo, botón visible solo `reserva_confirmada` + `fecha_evento = hoy`,
      doble confirmación no eludible)
- [x] 1.2 No avanzar a contrato/TDD/implementación sin la aprobación del humano

## 2. Contrato OpenAPI (post-gate — dueño: `contract-engineer`)
- [x] 2.1 Materializar en `docs/api-spec.yml` `POST /reservas/{id}/forzar-inicio-evento` según D-1
      aprobado (seguridad JWT rol gestor; 200 con `allOf(Reserva) + { forzadoPorGestor: boolean,
      precondicionesIncumplidas: string[] }`; 409 `conflicto_estado`; 422 `fecha_evento_no_es_hoy`;
      404), calcado de `POST /reservas/{id}/finalizar-evento` de US-034. Confirmar que
      `evento_en_curso` ya está en el enum `EstadoReserva`; NO tocar `GET /reservas/{id}`
      (`ReservaDetalle` ya expone `estado`, `fechaEvento` y los tres `*_status`)
- [x] 2.2 `spectral lint docs/api-spec.yml` en verde (0 errores nuevos frente al baseline; hook
      `validate-openapi`). Validado con `@redocly/cli lint`: baseline y post-cambio idénticos (27
      errores / 51 warnings pre-existentes del ruleset por defecto, 0 introducidos por el cambio;
      ningún hallazgo referencia `forzar-inicio-evento`) + parse limpio con `openapi-typescript`
- [x] 2.3 Regenerar el SDK del frontend (`pnpm generate-client`; nunca editar el cliente
      generado a mano) y `tsc --noEmit` en verde (web verificado; api pendiente de implementación
      backend). `schema.d.ts` incluye el path, `operations.forzarInicioEvento` y los schemas
      `ForzarInicioEvento{Request,Response,ConflictError,FechaError}`

## 3. Tests primero — TDD RED (OBLIGATORIO — tdd-first — dueño: `tdd-engineer`)
- [x] 3.1 Test de la **guarda de fecha pura** `esDiaDelEvento(fechaEvento, hoy)` en
      `maquina-estados.ts`: hoy → true; ayer/mañana → false; comparación por fecha de calendario
      (no por instante); blindaje off-by-one de TZ (evento de hoy a las 23:00 → true) (en rojo)
      → `apps/api/src/reservas/__tests__/maquina-estados-dia-del-evento.spec.ts`
- [x] 3.2 Test de **reutilización** de la guarda de origen y de precondiciones (US-031): confirmar
      que US-032 usa `resolverInicioEvento` (`reserva_confirmada → evento_en_curso`) y
      `preconditionesEventoCumplidas` SIN redefinir mapas ni añadir aristas nuevas (regresión cero
      de US-031)
- [x] 3.3 Test del use-case **happy path forzado**: RESERVA `reserva_confirmada` + `fecha_evento =
      hoy` + ≥1 precondición incumplida → `estado = evento_en_curso` + `AUDIT_LOG` (`accion =
      'transicion'`, origen **Usuario** con `usuario_id`, `datos_anteriores = {estado:
      reserva_confirmada}`, `datos_nuevos = {estado: evento_en_curso, forzado_por_gestor: true,
      precondiciones_incumplidas: [lista]}`) en una transacción (en rojo)
      → `…/forzar-inicio-evento.use-case.spec.ts` + `…/forzar-inicio-evento-integracion.spec.ts` (BD)
- [x] 3.4 Test de **múltiples precondiciones incumplidas**: las tres incumplidas → transiciona
      igualmente; `precondiciones_incumplidas` con las tres. **Caso borde**: tres cumplidas al
      forzar → transiciona, `precondiciones_incumplidas = []`, `forzado_por_gestor = true` (en rojo)
      → `…/forzar-inicio-evento.use-case.spec.ts`
- [x] 3.5 Test de **sub-procesos NO resueltos** (D-5): tras el forzado, `pre_evento_status`/
      `liquidacion_status`/`fianza_status` conservan su valor; sin side-effects en `FICHA_OPERATIVA`/
      cobros/`FECHA_BLOQUEADA`/cola (en rojo)
      → `…/forzar-inicio-evento-integracion.spec.ts`
- [x] 3.6 Test de **guarda de fecha en el use-case (422)**: RESERVA `reserva_confirmada` con
      `fecha_evento ≠ hoy` → rechazo `FechaEventoNoEsHoyError` (422 `fecha_evento_no_es_hoy`), sin
      transición, sin `AUDIT_LOG` (en rojo)
      → `…/forzar-inicio-evento.use-case.spec.ts` + `…/forzar-inicio-evento-integracion.spec.ts`
- [x] 3.7 Test de **conflicto de estado (409)**: RESERVA en estado ≠ `reserva_confirmada`
      (`evento_en_curso` incl. cron llegó primero, `pre_reserva`, `post_evento`, …) →
      `ConflictoEstadoError` (409 `conflicto_estado`), sin efectos, mensaje "El evento ya está en
      curso…"; idempotencia (segundo forzado → 409) (en rojo)
      → `…/forzar-inicio-evento.use-case.spec.ts` + `…/forzar-inicio-evento-integracion.spec.ts`
- [x] 3.8 **Test de concurrencia (skill `concurrency-locking`)**: cron (US-031) vs gestor y doble
      sesión del gestor sobre la misma RESERVA (`Promise.allSettled`) → exactamente una transición
      gana, la 2.ª UPDATE condicional afecta 0 filas y termina no-op/409 sin error, **1 sola**
      entrada de transición en `AUDIT_LOG` (`SELECT … FOR UPDATE`, sin lock distribuido) (en rojo)
      → `apps/api/src/reservas/__tests__/forzar-inicio-evento-concurrencia.spec.ts`
- [x] 3.9 Test del **endpoint/guard**: JWT ausente/rol inválido → 401/403; gestor válido con
      RESERVA en `reserva_confirmada` + `fecha_evento = hoy` → 200 con RESERVA + `forzadoPorGestor`
      + `precondicionesIncumplidas`; estado ≠ `reserva_confirmada` → 409; `fecha_evento ≠ hoy` →
      422; RESERVA de otro tenant → 404 (RLS) (en rojo)
      → `…/forzar-inicio-evento.controller.http.spec.ts` + `…/forzar-inicio-evento-integracion.spec.ts` (RLS)
- [x] 3.10 Confirmar que toda la batería está **en rojo** por AUSENCIA DE IMPLEMENTACIÓN
      (símbolo `esDiaDelEvento` inexistente; módulos `application/forzar-inicio-evento.use-case.ts`
      e `interface/forzar-inicio-evento.controller.ts` inexistentes), NO por errores de infra
      preexistente. Flaky de US-004 (`40P01`) ajeno a este change (US-032 no toca `FECHA_BLOQUEADA`)

## 4. Backend: revisar y actualizar tests unitarios existentes (OBLIGATORIO — step-N — dueño: `backend-developer`)
- [x] 4.1 Revisar tests de la máquina de estados de RESERVA (US-031 `resolverInicioEvento` /
      `preconditionesEventoCumplidas`, US-034 finalización manual, US-021 confirmar señal) y del
      patrón de acción manual del gestor de US-034 (`RolesGuard`, UoW `SELECT … FOR UPDATE`,
      auditoría origen Usuario) que US-032 reutiliza; confirmar **regresión cero** (US-032 solo
      AÑADE `esDiaDelEvento`, sin tocar las guardas de US-031). `pnpm lint` + `tsc --noEmit` verde.
      Sin migración Prisma

## 5. Implementación backend (post-gate — dueño: `backend-developer`)
- [x] 5.1 Máquina de estados (`reservas/domain/maquina-estados.ts`): AÑADIR la **guarda de fecha
      pura** `esDiaDelEvento(fechaEvento, hoy)` (comparación por fecha de calendario). REUTILIZAR
      `resolverInicioEvento` y `preconditionesEventoCumplidas` de US-031 sin redefinirlas; nada de
      `if` dispersos ni infra en dominio
- [x] 5.2 Caso de uso `ForzarInicioEventoUseCase` (`application/forzar-inicio-evento.use-case.ts`):
      (0) cargar RESERVA bajo RLS (`null` → 404); (1) guarda de origen `resolverInicioEvento`
      (estado ≠ `reserva_confirmada` → 409 sin efectos); (2) guarda de fecha `esDiaDelEvento`
      (fecha ≠ hoy → 422 sin efectos); (3) transacción (`UnidadDeTrabajoForzarInicioPort`):
      `SELECT … FOR UPDATE`, calcular `faltantes` con `preconditionesEventoCumplidas`, UPDATE
      condicional `WHERE estado='reserva_confirmada'` (0 filas → 409), `AUDIT_LOG` origen Usuario
      con `forzado_por_gestor: true` + `precondiciones_incumplidas`; (4) re-leer RESERVA post-commit
      y devolver `{ reserva, forzadoPorGestor: true, precondicionesIncumplidas }`. Espejo de
      `FinalizarEventoUseCase`
- [x] 5.3 Infra + interface: `ForzarInicioEventoController` (`POST /api/reservas/:id/forzar-inicio-
      evento`, `RolesGuard` + `@Roles('gestor')`, tenant/usuario del JWT, mapeo 404/409-
      `conflicto_estado`/422-`fecha_evento_no_es_hoy`); DTOs `@nestjs/swagger`
      (`ForzarInicioEventoResponse` = `allOf(Reserva) + { forzadoPorGestor, precondicionesIncumplidas }`).
      Adaptadores Prisma: `UnidadDeTrabajoForzarInicioPrismaAdapter` (`$transaction` + RLS +
      `SELECT … FOR UPDATE` + UPDATE condicional + AUDIT_LOG tx-bound); reuso del adaptador de
      lectura de RESERVA y de `AuditLogPort`. Cableado en `ReservasModule` por tokens Symbol,
      gemelo del de finalizar-evento

## 5bis. Implementación frontend (post-gate — dueño: `frontend-developer`)
- [x] 5bis.1 Hook de mutación `useForzarInicioEvento`
      (`apps/web/src/features/reservas/api/useForzarInicioEvento.ts`): consume el SDK generado
      `apiClient.POST('/reservas/{id}/forzar-inicio-evento')` (body `{}`), normaliza 200, 409
      `conflicto_estado` → `conflicto`, 422 `fecha_evento_no_es_hoy` → `fuera_de_dia`, 401/403/404/
      red → `generico`; `onSuccess` mergea `evento_en_curso` en la cache e **invalida**
      `reservaQueryKey(id)`. Cliente generado NO editado a mano
- [x] 5bis.2 Guarda de cliente + derivación (`lib/forzarInicioEvento.ts`):
      `puedeForzarInicioEvento(estado, fechaEvento, hoy)` (solo `reserva_confirmada` +
      `fecha_evento = hoy`, espejo de las guardas de dominio) y `precondicionesIncumplidas(reserva)`
      (deriva la lista de los `*_status` del `ReservaDetalle`, espejo de
      `preconditionesEventoCumplidas`)
- [x] 5bis.3 UI en la ficha: alerta con la **lista de precondiciones incumplidas** + botón "Forzar
      inicio del evento" (visible SOLO `reserva_confirmada` + `fecha_evento = hoy`);
      `ForzarInicioEventoDialog` con **doble confirmación** (paso 1 enumera precondiciones, paso 2
      confirma) + aviso inline del 409 ("El evento ya está en curso…") y del 422. Cableado en la
      ficha; barrel `index.ts` actualizado
- [x] 5bis.4 Mobile-first (390/768/1280): diálogo shadcn responsive, pie `flex-col gap-3
      sm:flex-row`, botones `w-full sm:w-auto` con objetivos táctiles ≥48px, sin overflow horizontal
- [x] 5bis.5 Tests de componente en verde: guarda + derivación (`lib/__tests__/`), visibilidad del
      botón por estado/fecha, doble confirmación (cancelar = no-op; confirmar = POST), invalidación
      de cache, ramificación 200/409/422. `pnpm --filter @slotify/web lint` y `typecheck` en verde

## 6. QA: unit tests + verificación de BD (OBLIGATORIO — step-N+1 — EL AGENTE DEBE EJECUTARLO)
- [x] 6.1 Capturar baseline de BD (counts/estado de `reserva`, `audit_log`); sembrar RESERVA
      `reserva_confirmada` con combinaciones de `pre_evento_status`/`liquidacion_status`/
      `fianza_status` (incumplidoras y cumplidoras), `fecha_evento` hoy/ayer/mañana, y RESERVA en
      estados distintos de `reserva_confirmada` (incl. `evento_en_curso`)
- [x] 6.2 Ejecutar tests dirigidos de los módulos cambiados (incl. concurrencia cron↔gestor/doble
      sesión)
- [x] 6.3 Ejecutar la suite requerida (`pnpm test`); anotar el flaky conocido de US-004 (`40P01`)
      si aparece, sin atribuirlo a este change
- [x] 6.4 Verificar estado posterior de BD (forzadas → `estado = evento_en_curso`; `AUDIT_LOG`
      `transicion` origen Usuario con `forzado_por_gestor: true` + `precondiciones_incumplidas`
      correctos; `*_status` intactos; no-candidatas intactas; sin duplicados) y restaurar
- [x] 6.5 Crear report `reports/YYYY-MM-DD-step-N+1-unit-test-and-db-verification.md`
- [x] 6.6 Marcar completado solo tras tests en verde y report creado

## 7. QA: pruebas manuales con curl (OBLIGATORIO — step-N+2 — EL AGENTE DEBE EJECUTARLO)
- [x] 7.1 Levantar el backend; sembrar RESERVA candidatas y no candidatas (matriz estado ×
      precondiciones × fecha_evento)
- [x] 7.2 POST `/reservas/{id}/forzar-inicio-evento` con JWT de gestor sobre RESERVA
      `reserva_confirmada` + `fecha_evento = hoy` + precondiciones incumplidas → 200 + RESERVA en
      `evento_en_curso`; verificar `AUDIT_LOG` origen Usuario (`datos_nuevos.forzado_por_gestor =
      true`, `precondiciones_incumplidas` = las esperadas) y que los `*_status` no cambiaron.
      Restaurar BD
- [x] 7.3 POST **idempotente / cron llegó primero**: RESERVA ya en `evento_en_curso` → 409
      `conflicto_estado` con el mensaje esperado; sin nueva auditoría. Restaurar BD
- [x] 7.4 POST con `fecha_evento ≠ hoy` (estado `reserva_confirmada`) → 422 `fecha_evento_no_es_hoy`;
      ninguna transición
- [x] 7.5 POST sin JWT / con rol no gestor → 401/403; RESERVA de otro tenant → 404 (RLS); ninguna
      transición
- [x] 7.6 Verificar que el formato de error/response coincide con el contrato OpenAPI (D-1)
- [x] 7.7 Crear report `reports/YYYY-MM-DD-step-N+2-curl-endpoint-tests.md`

## 8. QA: E2E con Playwright MCP (OBLIGATORIO si hay frontend — step-N+3 — EL AGENTE DEBE EJECUTARLO)
> Aplica: US-032 materializa UI (alerta de precondiciones + botón "Forzar inicio del evento" con
> doble confirmación en la ficha).
- [x] 8.1 Levantar front + back; iniciar sesión como gestor; navegar a la ficha de una RESERVA
      `reserva_confirmada` + `fecha_evento = hoy` + precondiciones incumplidas
- [x] 8.2 Verificar que la alerta lista las precondiciones incumplidas y el botón "Forzar inicio
      del evento" es visible SOLO en ese estado/fecha (probar también `fecha_evento ≠ hoy` → botón
      ausente; otro estado → botón ausente)
- [x] 8.3 Ejercer el flujo de **doble confirmación**: cancelar en el 2.º paso → no-op (estado sin
      cambios); confirmar → la ficha refleja `evento_en_curso`; verificar `AUDIT_LOG` en BD
- [x] 8.4 Verificar el caso "cron llegó primero": forzar sobre una RESERVA ya en `evento_en_curso`
      → aviso "El evento ya está en curso…" (409); la UI refresca el estado
- [x] 8.5 Mover capturas a `reports/e2e-screenshots/` y restaurar/limpiar datos de test
- [x] 8.6 Crear report `reports/YYYY-MM-DD-step-N+3-e2e-playwright.md`

## 9. Docs: actualizar documentación técnica (OBLIGATORIO — step-N+4 — dueño: `docs-keeper`)
- [x] 9.1 Actualizar docs técnicas: capability `consultas` (forzado manual del inicio de evento por
      el Gestor, reutilización de la guarda de origen y de precondiciones de US-031, guarda de fecha
      `fecha_evento = hoy`, forzado incondicional respecto a precondiciones, no-resolución de
      sub-procesos, auditoría origen Usuario con `forzado_por_gestor`, idempotencia/concurrencia
      cron↔gestor, doble confirmación en UI); trazabilidad de la US (`use-cases.md` UC-23 FA-01,
      `er-diagram.md` RESERVA `estado`/`*_status`/`fecha_evento` + AUDIT_LOG). Registrar la relación
      con **US-031** (inicio automático / coordinación cron↔gestor) y **US-033/US-034** (vista móvil
      + checklist habilitados por `evento_en_curso`), y el out-of-scope del briefing (📐). Contrato
      solo lo del `contract-engineer`; sin migración de esquema

## 10. Code review (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO)
- [ ] 10.1 Ejecutar `code-reviewer` sobre el diff (guardrails: hexagonal, sin bloqueo distribuido,
      sin editar cliente generado, reutilización de las guardas de US-031 sin duplicar la máquina de
      estados, guarda de fecha en dominio (calendario, no string), forzado incondicional respecto a
      precondiciones, `AUDIT_LOG` origen Usuario con `forzado_por_gestor: true` +
      `precondiciones_incumplidas`, sub-procesos NO resueltos, atomicidad por RESERVA (`SELECT … FOR
      UPDATE`, UPDATE condicional, 0 filas → 409), idempotencia/concurrencia cron↔gestor, códigos
      409/422/404 correctos, RLS por tenant del gestor, doble confirmación no eludible, sin
      email/briefing)
- [ ] 10.2 Dejar informe `reports/YYYY-MM-DD-step-review-code-review.md` con la línea literal
      `Veredicto: APTO` (si NO APTO, volver a implementación)

## 11. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final — human_review)
- [ ] 11.1 Tras code-review APTO + validación manual, **ESPERAR el OK humano** antes de archive/PR

## 12. Archivar change + abrir PR (OBLIGATORIO — archive — dueño: `spec-author`)
- [ ] 12.1 `openspec archive us-032-forzar-inicio-evento` (solo tras gate final y code-review APTO;
      el hook `require-code-review` lo bloquea sin APTO)
- [ ] 12.2 Actualizar `openspec/specs/` (capability `consultas` con los requisitos del forzado
      manual del inicio de evento) y abrir PR (GitHub MCP / `gh`)

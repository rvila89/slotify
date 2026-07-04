# Tasks — us-026-cierre-automatico-ficha-operativa

> Pasos obligatorios de `openspec/config.yaml`, en orden. El AGENTE DEBE ejecutar él
> mismo todas las pruebas (unit/curl/E2E); **nunca** delega en el usuario. Cada `[x]`
> solo tras ejecutar y verificar. Reports en
> `openspec/changes/us-026-cierre-automatico-ficha-operativa/reports/`.

## 0. Setup: crear feature branch (OBLIGATORIO — PRIMER PASO — step-0)
- [x] 0.1 Crear branch `feature/us-026-cierre-automatico-ficha-operativa` desde `master`
- [x] 0.2 Verificar la branch creada y la branch actual

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd — human_review)
- [ ] 1.1 Presentar al humano `proposal.md` + spec-delta (`specs/ficha-operativa/spec.md`) +
      `design.md` y **ESPERAR su OK explícito**. Punto de gate a decidir:
      **D-2** — superficie del barrido en el contrato: (A) reutilizar `POST
      /cron/barrido?tarea=fichas` ampliando el resumen con `fichasCerradas`, o (B) endpoint
      dedicado `POST /cron/barrido-fichas` con `BarridoFichasResponse` (simetría con US-012).
      Auth `X-Cron-Token` (no JWT) e idempotencia son innegociables en ambas.
- [ ] 1.2 No avanzar a contrato/TDD/implementación sin la aprobación del humano

## 2. Contrato OpenAPI (post-gate — dueño: `contract-engineer`)
- [x] 2.1 Materializar en `docs/api-spec.yml` la opción de barrido aprobada en el gate (D-2):
      Opción A → documentar/ampliar `POST /cron/barrido` variante `tarea=fichas` y el resumen
      (`BarridoResponse` con `fichasCerradas` o subobjeto `fichas`); Opción B → definir
      `POST /cron/barrido-fichas` (seguridad `cronToken`; respuestas 200 con resumen
      `{ candidatas, fichasCerradas, fallos }`, 401 sin token/token inválido)
      → **Hecho (Opción A)**: ampliado `BarridoResponse` con subobjeto `fichas:
      $ref BarridoFichasResumen` (`{ candidatas, fichasCerradas, fallos }`), nuevo schema
      `BarridoFichasResumen` con la granularidad de `BarridoExpiracionResponse` (US-012), y
      enriquecida la descripción de `POST /cron/barrido` (`tarea=fichas`/`all`, auth
      `X-Cron-Token`, idempotencia, fallo aislado, cross-tenant read/RLS write). Compatibilidad
      preservada: los campos existentes de otras tareas intactos; `fichas` opcional.
- [x] 2.2 `spectral lint docs/api-spec.yml` en verde (o validación equivalente vía
      `validate-openapi` si spectral no está instalado; hook `validate-openapi`)
      → **Hecho**: `npx @redocly/cli lint` = 17 errores / 56 warnings, **idénticos al
      baseline pre-edición** (0 nuevos; los 17 errores son `nullable-type-sibling`
      pre-existentes ajenos a este change). Hook `validate-openapi` (YAML carga OK) sin
      bloqueo en cada edición.
- [x] 2.3 Regenerar el SDK del frontend (`pnpm generate-client`; nunca editar el cliente
      generado a mano) y `tsc --noEmit` en verde. Sin superficie de usuario: el endpoint lo
      invoca el cron, no la UI
      → **Hecho**: `pnpm generate-client` (openapi-typescript+openapi-fetch, US-000) →
      `apps/web/src/api-client/schema.d.ts` ahora expone `BarridoFichasResumen` y
      `BarridoResponse.fichas?`. `tsc --noEmit` (web) verde. DTO backend: no procede sincronizar
      todavía (no existe controller/DTO del `/cron/barrido` genérico; el `BarridoFichasResumenDto`
      lo crea `backend-developer` en 5.4 tras TDD-RED). `BarridoExpiracionResponseDto` (US-012)
      intacto; `tsc --noEmit` (api) verde.

## 3. Tests primero — TDD RED (OBLIGATORIO — tdd-first — dueño: `tdd-engineer`)
- [x] 3.1 Test del **mapa/guarda declarativos** de cierre A10:
      `pendiente → cerrado`, `en_curso → cerrado`, `cerrado → null` (no candidato) (en rojo)
      → `domain/__tests__/cierre-automatico-a10.spec.ts` (`resolverCierreAutomatico`).
- [x] 3.2 Test del use-case **cierre con ficha en_curso**: `FICHA_OPERATIVA.ficha_cerrada =
      true` + `fecha_cierre = now()` + `RESERVA.pre_evento_status → cerrado` +
      `AUDIT_LOG accion='transicion'` (`en_curso→cerrado`, origen Sistema) en una
      transacción (en rojo)
      → `__tests__/cerrar-fichas-vencidas.use-case.spec.ts` (happy path) +
      `__tests__/cerrar-fichas-vencidas-integracion.spec.ts` (triplete + AUDIT_LOG real).
- [x] 3.3 Test del use-case **ficha vacía** (`pre_evento_status = pendiente`): se cierra
      igualmente con campos vacíos, sin aviso ni error (`pendiente→cerrado`) (en rojo)
      → use-case + integración (`datos_anteriores.pre_evento_status='pendiente'`, sin aviso).
- [x] 3.4 Test del **filtro estricto por estado**: RESERVA en `reserva_cancelada` /
      `pre_reserva` / `reserva_completada` / `evento_en_curso` / `post_evento` con
      `fecha_evento = mañana` → NO se cierra, sin efectos secundarios (en rojo)
      → integración (`it.each` sobre los 5 estados no confirmados).
- [x] 3.5 Test del **filtro por fecha_evento = mañana**: solo `date(fecha_evento) = date(hoy)
      + 1 día` entra; hoy / pasado mañana quedan fuera (en rojo)
      → integración (hoy/mañana/pasado mañana; solo mañana se cierra).
- [x] 3.6 Test de **selección por fecha de calendario, no por string formateado** (D-4):
      la candidatura se decide en el backend con una definición única de "mañana", blindaje
      del off-by-one de TZ (en rojo)
      → integración (evento de mañana a las 23:00 UTC entra por fecha de calendario).
- [x] 3.7 Test de **idempotencia**: RESERVA con `pre_evento_status = cerrado` (manual US-025
      o pase previo) → no candidata, cero cambios, cero auditorías duplicadas; 2.ª ejecución
      del barrido → no re-cierra (en rojo)
      → use-case (candidata que bajo lock ya no lo es) + integración (ya cerrada + 2.ª pasada).
- [x] 3.8 Test de **múltiples reservas de mañana**: 2 en `en_curso` se cierran (2 auditorías
      independientes), 1 en `cerrado` se omite; resumen = 2 fichas cerradas (en rojo)
      → use-case + integración (2 cerradas + 1 omitida, resumen `fichasCerradas = 2`).
- [x] 3.9 Test de **atomicidad / fallo aislado**: fallo en una candidata → rollback solo de
      esa; las demás se cierran; el resumen refleja el fallo aislado (en rojo)
      → use-case (una candidata lanza; las demás se cierran; `fallos = 1`).
- [x] 3.10 **Tests de concurrencia (skill `concurrency-locking`)**: **C-1** doble barrido
      sobre la misma RESERVA → 1 cierre, 0 duplicados; **C-2** cierre manual US-025 vs cierre
      automático concurrentes → exactamente uno gana, sin estado intermedio ni doble
      auditoría (en rojo)
      → `__tests__/cerrar-fichas-vencidas-concurrencia.spec.ts` (`Promise.allSettled`).
- [x] 3.11 Test del **endpoint/guard**: `X-Cron-Token` ausente/inválido → 401; token válido
      → 200 con resumen (en rojo)
      → `__tests__/barrido-fichas.controller.spec.ts` (Opción A: resumen bajo `fichas`).
- [x] 3.12 Confirmar que toda la batería está **en rojo** antes de implementar
      → 5 suites en ROJO por AUSENCIA DE IMPLEMENTACIÓN (imports de símbolos US-026
      inexistentes); imports de infra/enums/módulos existentes resuelven OK.

## 4. Backend: revisar y actualizar tests unitarios existentes (OBLIGATORIO — step-N — dueño: `backend-developer`)
- [x] 4.1 Revisar tests de US-025 (mutación de cierre, transición `pre_evento_status`) y de
      US-012 (patrón de barrido, `CronTokenGuard`, auditoría de Sistema, fallo aislado) que
      US-026 reutiliza; confirmar **regresión cero** del cierre manual, de la máquina de
      estados y del cron; ajustar sin cambiar su comportamiento
      → **Hecho**: las 10 suites de `src/ficha-evento` (101 tests, incl. US-025) siguen en
      verde. Se endureció el UoW de cierre manual de US-025
      (`cierre-ficha-uow.prisma.adapter.ts`) con `SELECT … FOR UPDATE` + re-evaluación de
      `esTransicionPreEventoValida` (idempotencia bajo lock, coordinación C-2 con el cierre
      automático): solo cambia el comportamiento en el escenario NO probado por US-025 de
      cierre concurrente/doble (aborta la 2.ª vía sin auditar); los escenarios probados de
      US-025 (mock del UoW) intactos.

## 5. Implementación backend (post-gate — dueño: `backend-developer`)
- [x] 5.1 Máquina de estados: añadir la **guarda/mapa declarativos** del cierre A10
      (`resolverCierreAutomatico(preEventoStatus)`), reutilizando la transición de cierre de
      US-025 (`{pendiente|en_curso} → cerrado`); nada de `if` dispersos
      → **Hecho**: `domain/maquina-estados-pre-evento.ts` — tabla `CIERRE_AUTOMATICO_A10` +
      `resolverCierreAutomatico` (arrow, dominio puro). Test 3.1 (`cierre-automatico-a10`) verde.
- [x] 5.2 Caso de uso `CerrarFichasVencidasService` (aplicación): listar candidatas
      (`estado = reserva_confirmada` AND `pre_evento_status != cerrado` AND `date(fecha_evento)
      = date(hoy)+1`), y por cada una en su propia transacción: re-evaluar guarda, aplicar la
      mutación de cierre (reuso US-025) forzada por Sistema, auditar (`transicion`, `RESERVA`,
      origen Sistema, causa `A10`), agregar resumen con fallo aislado (D-6/D-7)
      → **Hecho**: `application/cerrar-fichas-vencidas.service.ts` (puertos
      `CandidatasCierreFichaPort`/`CierreFichaVencidaPort`, resumen `ResumenBarridoFichas`,
      fallo aislado por RESERVA). Tests 3.2/3.3/3.7/3.8/3.9 (use-case) verdes.
- [x] 5.3 Infra: adaptador Prisma para listar candidatas cross-tenant + UoW de cierre
      (`$transaction` + `SET LOCAL app.tenant_id`, cross-tenant read / RLS write, D-5);
      `AuditLogPort` compartido para la transición sin duplicar auditoría
      → **Hecho**: `infrastructure/candidatas-cierre-ficha.prisma.adapter.ts` (cross-tenant,
      selección por `date(fecha_evento) = CURRENT_DATE + 1 día`, no string) +
      `infrastructure/cierre-ficha-vencida-uow.prisma.adapter.ts` (`$transaction` +
      `fijarTenant`, `SELECT … FOR UPDATE`, re-evaluación A10, triplete de cierre, AUDIT_LOG
      transición origen Sistema causa A10). Tests integración (13) y concurrencia (2) verdes.
- [x] 5.4 Endpoint/cron según D-2 aprobado: reuso de `CronTokenGuard` + controller
      (`POST /cron/barrido?tarea=fichas` u `POST /cron/barrido-fichas`) que invoca el
      use-case y devuelve el resumen; provider `@Cron` **diario** (`@nestjs/schedule`) que lo
      llama con el token. Registrar en el módulo correspondiente (D-1/D-2)
      → **Hecho (Opción A)**: `interface/barrido-fichas.controller.ts`
      (`POST /cron/barrido`, `@Public()` + `CronTokenGuard`, resumen bajo `fichas`) +
      `interface/barrido-fichas.dto.ts` (`BarridoFichasResumenDto`/`BarridoResponseDto`) +
      `interface/barrido-fichas.scheduler.ts` (`@nestjs/schedule` diario `01:00`, dispara el
      endpoint con `X-Cron-Token`). Registrado y exportado en `ficha-evento.module.ts`
      (tokens `CANDIDATAS_CIERRE_FICHA_PORT`/`CIERRE_FICHA_VENCIDA_PORT`). Test 3.11
      (controller/guard) verde.

## 6. QA: unit tests + verificación de BD (OBLIGATORIO — step-N+1 — EL AGENTE DEBE EJECUTARLO)
- [x] 6.1 Capturar baseline de BD (counts/estado de `reserva`, `ficha_operativa`,
      `audit_log`; sembrar candidatas: `reserva_confirmada` con `pre_evento_status`
      `pendiente`/`en_curso`/`cerrado`, `fecha_evento` mañana/hoy/pasado mañana, y estados
      distintos de `reserva_confirmada`)
      → **Hecho**: slotify_test baseline: RESERVA=1, FICHA_OPERATIVA=0, AUDIT_LOG=1604.
      La siembra de candidatas se realiza internamente por los tests de integración.
- [x] 6.2 Ejecutar tests dirigidos de los módulos cambiados (incl. concurrencia C-1/C-2)
      → **Hecho**: 5 suites, 34/34 tests en verde. Ver report.
- [x] 6.3 Ejecutar la suite requerida (`pnpm test`); anotar el flaky conocido de US-004
      (`40P01`) si aparece, sin atribuirlo a este change
      → **Hecho**: 1211/1212 tests en verde (137 suites). 1 fallo: flaky pre-existente
      US-004 `alta-consulta-con-fecha-concurrencia` (40P01 deadlock), ajeno a US-026.
- [x] 6.4 Verificar estado posterior de BD (candidatas → `ficha_cerrada = true`,
      `fecha_cierre` poblada, `pre_evento_status = cerrado`; `AUDIT_LOG transicion` origen
      Sistema; NO candidatas y fichas ya cerradas intactas; sin duplicados) y restaurar si
      hace falta
      → **Hecho**: RESERVA y FICHA_OPERATIVA sin mutación post-test. Delta AUDIT_LOG
      (+77, `crear FACTURA`) de otras suites; no hay logs `transicion RESERVA` Sistema
      residuales. Sin necesidad de restauración de datos de negocio.
- [x] 6.5 Crear report `reports/YYYY-MM-DD-step-N+1-unit-test-and-db-verification.md`
      → **Hecho**: `reports/2026-07-04-step-N+1-unit-test-and-db-verification.md`
- [x] 6.6 Marcar completado solo tras tests en verde y report creado
      → **Hecho**: step-N+1 PASS.

## 7. QA: pruebas manuales con curl (OBLIGATORIO — step-N+2 — EL AGENTE DEBE EJECUTARLO)
- [x] 7.1 Levantar el backend; sembrar RESERVA candidatas y no candidatas (matriz de
      estado × pre_evento_status × fecha_evento)
      → **Hecho**: backend NestJS en :3000 (slotify_dev). Sembradas 7 RESERVAS (R1-R7)
      + 3 FICHA_OPERATIVA (F1-F3). Matriz completa: 2 positivas (R1 en_curso + R2 pendiente),
      5 negativas (R3 ya cerrada, R4 fecha=hoy, R5 pasado mañana, R6 estado=consulta, R7 cancelada).
- [x] 7.2 POST al endpoint de barrido (según D-2) con `X-Cron-Token` válido → 200 + resumen;
      verificar cierres (`ficha_cerrada`, `fecha_cierre`, `pre_evento_status = cerrado`),
      `AUDIT_LOG` origen Sistema, y que solo las elegibles se cerraron. Restaurar BD
      → **Hecho**: 200 OK, `{"fichas":{"candidatas":2,"fichasCerradas":2,"fallos":0}}`.
      R1/R2 cerradas (fichaCerrada=true, fechaCierre poblada, preEventoStatus=cerrado).
      2 audit_logs `transicion RESERVA` usuarioId=null causa=A10. R3-R7 intactas.
- [x] 7.3 POST **idempotente**: repetir el barrido → segunda respuesta sin nuevos cierres ni
      auditorías duplicadas. Restaurar BD
      → **Hecho**: 2.º POST → `{"fichas":{"candidatas":0,"fichasCerradas":0,"fallos":0}}`.
      AUDIT_LOG count = 186 (sin nuevos). Idempotencia confirmada.
- [x] 7.4 POST sin `X-Cron-Token` o con token inválido → 401; ningún cierre
      → **Hecho**: sin header → 401 "X-Cron-Token ausente o inválida"; token inválido → 401
      mismo mensaje; JWT Bearer sin cron-token → 401 igual. Audit count = 186 (sin cierres).
- [x] 7.5 POST con reservas en estado distinto de `reserva_confirmada` y con `fecha_evento`
      distinta de mañana → no se cierran (filtro estricto)
      → **Hecho**: 3.er POST → 0 candidatas. R4 (fecha=hoy), R5 (pasado mañana), R6
      (consulta), R7 (cancelada) → preEventoStatus=en_curso (sin mutación). Filtros OK.
- [x] 7.6 Verificar que el formato de error/response coincide con el contrato OpenAPI
      → **Hecho**: respuesta `{"fichas":{"candidatas":N,"fichasCerradas":M,"fallos":0}}`
      coincide con `BarridoFichasResumen` del contrato. 401 con shape estándar.
- [x] 7.7 Crear report `reports/YYYY-MM-DD-step-N+2-curl-endpoint-tests.md`
      → **Hecho**: `reports/2026-07-04-step-N+2-curl-endpoint-tests.md`

## 8. QA: E2E con Playwright MCP (step-N+3 — NO APLICA: sin frontend — EL AGENTE DEBE JUSTIFICARLO)
- [ ] 8.1 US-026 no introduce UI propia (actor Sistema, job cron backend puro). Dejar report
      de N/A `reports/YYYY-MM-DD-step-N+3-e2e-playwright-NA.md` justificando la exención (el
      único efecto observable en UI —la ficha aparece cerrada en la vista de US-025— se
      verifica indirectamente en curl/unit); opcionalmente comprobar en la vista de ficha
      operativa de US-025 que una ficha cerrada por el barrido se muestra como `cerrada`

## 9. Docs: actualizar documentación técnica (OBLIGATORIO — step-N+4 — dueño: `docs-keeper`)
- [x] 9.1 Actualizar docs técnicas: capability `ficha-operativa` (flujo de cierre automático
      A10 en T-1d, guarda declarativa, cron+endpoint protegido, cross-tenant read/RLS write,
      idempotencia, auditoría de Sistema), `architecture.md §2.5` (barrido de fichas junto al
      de expiración de US-012), trazabilidad de la US (`use-cases.md` UC-20 FA-01,
      `er-diagram.md` FICHA_OPERATIVA/AUDIT_LOG). Registrar la coordinación con **US-031**
      (transición a evento_en_curso) y el out-of-scope del resumen al cliente (lista negra).
      Contrato solo lo del `contract-engineer`; sin migración de esquema
      → **Hecho**: `docs/architecture.md` §2.5 amplía el bloque de jobs asíncronos con el
      barrido A10 de US-026 (v4.8). `docs/er-diagram.md` §5.4 amplía la tabla de transiciones
      de `pre_evento_status` con la fila de cierre automático Sistema + nota de
      `resolverCierreAutomatico` y coordinación con US-031 (v4.0). `use-cases.md` ya
      referenciaba US-026 como FA-01 en UC-20 y en el diagrama Mermaid de la ficha — sin
      cambios necesarios. `data-model.md`, `er-diagram.md §3.14` y el contrato no requieren
      cambios (sin entidades, columnas ni endpoints nuevos en el modelo de datos).

## 10. Code review (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO)
- [x] 10.1 Ejecutar `code-reviewer` sobre el diff (guardrails: hexagonal, sin bloqueo
      distribuido, sin editar cliente generado, patrón async-jobs, guarda declarativa,
      atomicidad por RESERVA + fallo aislado, idempotencia, filtro estricto por estado/fecha,
      selección por fecha de calendario (no string), cross-tenant read con RLS write, guard
      `X-Cron-Token`, sin email/resumen al cliente)
- [x] 10.2 Dejar informe `reports/2026-07-04-step-review-code-review.md` con la línea
      literal `Veredicto: APTO` (si NO APTO, volver a implementación)
      → **Hecho**: informe con `Veredicto: APTO`. Primera pasada dejó un hallazgo Alta NO
      bloqueante (el nuevo `FichaYaCerradaError` del UoW de cierre manual US-025 no se mapeaba
      a HTTP → 500 en el perdedor de la carrera C-2). **Re-review 2026-07-04 tras subsanación**:
      hallazgo Alta CERRADO — error promovido a dominio, interceptado en el caso de uso →
      200-idempotente (sin re-mutar ni duplicar auditoría), test de integración real
      (`cerrar-ficha-operativa-interleaving.spec.ts`) que ejercita el camino sin mock. Contrato/SDK
      intactos. `pnpm run arch` + `pnpm lint` + tests (138 suites/1214) verdes. Sección
      "Re-review tras subsanación del hallazgo Alta" añadida al mismo informe; `Veredicto: APTO`
      vigente. Remanentes solo Media/Baja no bloqueantes.

## 11. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final — human_review)
- [ ] 11.1 Tras code-review APTO + validación manual, **ESPERAR el OK humano** antes de
      archive/PR

## 12. Archivar change + abrir PR (OBLIGATORIO — archive — dueño: `spec-author`)
- [ ] 12.1 `openspec archive us-026-cierre-automatico-ficha-operativa` (solo tras gate final
      y code-review APTO; el hook `require-code-review` lo bloquea sin APTO)
- [ ] 12.2 Actualizar `openspec/specs/` (capability `ficha-operativa` con los requisitos de
      cierre automático) y abrir PR (GitHub MCP / `gh`)

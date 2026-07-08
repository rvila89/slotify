# Tasks — us-031-inicio-automatico-evento

> Pasos obligatorios de `openspec/config.yaml`, en orden. El AGENTE DEBE ejecutar él
> mismo todas las pruebas (unit/curl/E2E); **nunca** delega en el usuario. Cada `[x]`
> solo tras ejecutar y verificar. Reports en
> `openspec/changes/us-031-inicio-automatico-evento/reports/`.

## 0. Setup: crear feature branch (OBLIGATORIO — PRIMER PASO — step-0)
- [x] 0.1 Crear branch `feature/us-031-inicio-automatico-evento` desde `master`
- [x] 0.2 Verificar la branch creada y la branch actual

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd — human_review)
- [x] 1.1 Presentar al humano `proposal.md` + spec-delta (`specs/consultas/spec.md`) +
      `design.md` y **ESPERAR su OK explícito**. **APROBADO 2026-07-07**. D-2 se aprobó
      inicialmente como Opción A pero se **REABRIÓ EN IMPLEMENTACIÓN y se resolvió a OPCIÓN B**
      (decisión humana 2026-07-07): endpoint dedicado **`POST /cron/barrido-eventos`** con
      `BarridoEventosResponse` (`{ candidatas, eventosIniciados, precondicionesIncumplidas,
      fallos }`), gemelo del `POST /cron/barrido-expiracion` de US-012 en el mismo módulo
      `reservas`. Motivo: el dispatch por `?tarea=` del contrato nunca se implementó; un 2.º
      controller sobre `POST /cron/barrido` colisiona con US-026 (ya mergeado). Auth
      `X-Cron-Token` (no JWT) e idempotencia innegociables. Sin endpoint/SDK de usuario nuevos.
      Ver `design.md §D-2` (RESOLUCIÓN DE GATE).
- [x] 1.2 No avanzar a contrato/TDD/implementación sin la aprobación del humano

## 2. Contrato OpenAPI (post-gate — dueño: `contract-engineer`)
> **NOTA (2026-07-07)**: 2.1–2.3 se completaron para Opción A y luego se **REHACEN para
> Opción B** (endpoint dedicado). Se revierte el subobjeto `eventos` de `BarridoResponse` y se
> define `POST /cron/barrido-eventos` + `BarridoEventosResponse`.
- [x] 2.1 Materializar en `docs/api-spec.yml` la **Opción B**: **(a)** REVERTIR el subobjeto
      `eventos` que se añadió a `BarridoResponse` (quitar `eventos: $ref BarridoEventosResumen`
      y su enriquecimiento de la descripción de `POST /cron/barrido`, dejando ese endpoint como
      estaba antes de US-031); **(b)** definir `POST /cron/barrido-eventos` (seguridad
      `cronToken` `X-Cron-Token`; 200 con `BarridoEventosResponse`; 401 sin token/token
      inválido), calcado de `POST /cron/barrido-expiracion` de US-012; **(c)** renombrar/definir
      el schema como `BarridoEventosResponse` (`{ candidatas, eventosIniciados,
      precondicionesIncumplidas, fallos }`, todos `required`), estilo `BarridoExpiracionResponse`.
- [x] 2.2 `spectral lint docs/api-spec.yml` en verde (0 errores nuevos frente al baseline; hook
      `validate-openapi`); confirmar que ya no queda referencia colgante a `BarridoEventosResumen`
- [x] 2.3 Regenerar el SDK del frontend (`pnpm generate-client`; nunca editar el cliente
      generado a mano) y `tsc --noEmit` en verde (api y web). Sin superficie de usuario: el
      endpoint lo invoca el cron, no la UI; la vista móvil consume `RESERVA.estado` de
      `GET /reservas` (US-049), sin cambios de contrato de usuario

## 3. Tests primero — TDD RED (OBLIGATORIO — tdd-first — dueño: `tdd-engineer`)
- [x] 3.1 Test del **mapa/guarda de origen declarativos** del inicio de evento en
      `maquina-estados.ts`: `reserva_confirmada → evento_en_curso`; cualquier otro estado →
      no candidato (`null`) (en rojo). → `reservas/__tests__/maquina-estados-inicio-evento.spec.ts`
      (RED: falta `resolverInicioEvento`/`MAPA_INICIO_EVENTO`/`ResultadoInicioEvento`)
- [x] 3.2 Test de la **guarda pura de las tres precondiciones**
      (`preconditionesEventoCumplidas`): cumple solo si `pre_evento_status='cerrado'` AND
      `liquidacion_status='cobrada'` AND `fianza_status='cobrada'`; devuelve la lista de
      precondiciones faltantes en los casos negativos (en rojo). →
      `reservas/__tests__/maquina-estados-precondiciones-evento.spec.ts` (RED: falta
      `preconditionesEventoCumplidas`/`PrecondicionesEvento`/`ResultadoPrecondicionesEvento`)
- [x] 3.3 Test del use-case **happy path**: candidata `reserva_confirmada` + `fecha_evento=hoy`
      + tres precondiciones → `RESERVA.estado=evento_en_curso` + `AUDIT_LOG accion='transicion'`
      (`datos_anteriores={estado:reserva_confirmada}`, `datos_nuevos={estado:evento_en_curso}`,
      origen Sistema) en una transacción (en rojo). → `iniciar-eventos-del-dia.use-case.spec.ts`
      (orquestación) + `iniciar-eventos-del-dia-integracion.spec.ts` (auditoría en BD)
- [x] 3.4 Test de **precondiciones incumplidas**: alguna de las tres distinta de su valor
      requerido → NO transiciona (`estado` permanece `reserva_confirmada`), 0 auditorías, alerta
      crítica con la lista de precondiciones incumplidas (en rojo). →
      `iniciar-eventos-del-dia.use-case.spec.ts` (alerta) + `-integracion.spec.ts` (BD no muta)
- [x] 3.5 Test de **A29 (efecto colateral no bloqueante)**: tres precondiciones cumplidas +
      `cond_part_firmadas=false` → transiciona igualmente a `evento_en_curso` + emite alerta A29
      no bloqueante; A29 se dispara con independencia del resultado (en rojo). →
      `iniciar-eventos-del-dia.use-case.spec.ts`
- [x] 3.6 Test del **filtro estricto por estado**: RESERVA en `consulta`/`pre_reserva`/
      `reserva_cancelada`/`reserva_completada`/`post_evento`/`evento_en_curso` con
      `fecha_evento=hoy` → NO se transiciona, sin efectos secundarios (en rojo). →
      `iniciar-eventos-del-dia-integracion.spec.ts` + guarda de origen en 3.1
- [x] 3.7 Test del **filtro por fecha_evento=hoy** y **selección por fecha de calendario, no por
      string formateado**: solo `date(fecha_evento)=date(hoy)` entra; ayer/mañana quedan fuera;
      blindaje del off-by-one de TZ (evento de hoy a las 23:00 UTC entra por fecha de
      calendario) (en rojo). → `iniciar-eventos-del-dia-integracion.spec.ts`
- [x] 3.8 Test de **idempotencia**: RESERVA ya en `evento_en_curso` (pase previo o gestor
      US-032) → no candidata, cero cambios, cero auditorías duplicadas; 2.ª ejecución del
      barrido → no re-transiciona (en rojo). → `iniciar-eventos-del-dia-integracion.spec.ts`
      (BD 2.ª ejecución) + `iniciar-eventos-del-dia.use-case.spec.ts` (idempotencia bajo lock)
- [x] 3.9 Test de **múltiples reservas de hoy**: 2 cumplidoras → 2 transiciones (2 auditorías
      independientes), 1 incumplidora → alerta sin transición, 1 ya `evento_en_curso` → omitida;
      resumen = 2 eventos iniciados + 1 precondiciones incumplidas (en rojo). →
      `iniciar-eventos-del-dia.use-case.spec.ts`
- [x] 3.10 Test de **atomicidad / fallo aislado**: fallo en una candidata → rollback solo de
      esa; las demás se transicionan; el resumen refleja el fallo aislado (en rojo). →
      `iniciar-eventos-del-dia.use-case.spec.ts`
- [x] 3.11 **Tests de concurrencia (skill `concurrency-locking`)**: **RC-1** doble barrido sobre
      la misma RESERVA → 1 transición, 0 duplicados; **RC-2** cron vs "segundo actor" (US-032
      simulado) concurrentes sobre la misma RESERVA → exactamente uno gana, la 2.ª UPDATE afecta
      0 filas y termina no-op sin error, 1 sola auditoría (en rojo, `Promise.allSettled`). →
      `iniciar-eventos-del-dia-concurrencia.spec.ts` (RED también por falta de `INICIO_EVENTO_PORT`)
- [x] 3.12 Test del **endpoint/guard**: `X-Cron-Token` ausente/inválido → 401; token válido →
      200 con resumen (según D-2 aprobado) (en rojo). → `barrido-eventos.controller.spec.ts`
      (`BarridoResponse.eventos`, D-2 Opción A)
- [x] 3.13 Confirmar que toda la batería está **en rojo** antes de implementar (por ausencia de
      implementación, no por errores de import de infra existente). VERIFICADO: 6 suites en rojo,
      todas por `TS2305`/`TS2307` (símbolos/módulos US-031 inexistentes); ningún fallo de infra
      preexistente. Flaky de US-004 (`40P01`) ajeno a este change, no se toca `FECHA_BLOQUEADA`.

## 4. Backend: revisar y actualizar tests unitarios existentes (OBLIGATORIO — step-N — dueño: `backend-developer`)
- [x] 4.1 Revisar tests de la máquina de estados de RESERVA (US-021 confirmar señal, US-012
      expiración, US-018/019 promoción/expiración forzosa) y del patrón de barrido de
      US-012/US-026 (`CronTokenGuard`, auditoría de Sistema, fallo aislado, cross-tenant
      read/RLS write) que US-031 reutiliza; confirmar **regresión cero** de las transiciones
      existentes, del cron y de las precondiciones de US-025/US-029/US-030; ajustar sin cambiar
      su comportamiento

## 5. Implementación backend (post-gate — dueño: `backend-developer`)
- [x] 5.1 Máquina de estados (`reservas/domain/maquina-estados.ts`): añadir la **guarda/mapa
      de origen declarativos** del inicio de evento (`resolverInicioEvento` /
      `MAPA_INICIO_EVENTO`: `reserva_confirmada → evento_en_curso`) + la **guarda pura de las
      tres precondiciones** (`preconditionesEventoCumplidas`, que devuelve las faltantes); nada
      de `if` dispersos ni infra en dominio
- [x] 5.2 Caso de uso `IniciarEventosDelDiaService` (aplicación): listar candidatas
      (`estado='reserva_confirmada'` AND `date(fecha_evento)=date(hoy)`) y por cada una en su
      propia transacción: `SELECT … FOR UPDATE` + re-evaluar guarda de origen y precondiciones;
      si cumple → transicionar a `evento_en_curso` + auditar (transicion, RESERVA, origen
      Sistema); si no → alerta crítica con precondiciones incumplidas (sin transicionar); emitir
      A29 si `cond_part_firmadas=false`; agregar resumen con fallo aislado (D-6/D-8)
- [x] 5.3 Infra: adaptador Prisma para listar candidatas cross-tenant (selección por
      `date(fecha_evento)=CURRENT_DATE`, no string) + UoW de transición (`$transaction` +
      `SET LOCAL app.tenant_id` + `SELECT … FOR UPDATE` sobre RESERVA, cross-tenant read / RLS
      write, D-5); `AuditLogPort` compartido para la transición sin duplicar auditoría
- [x] 5.4 Endpoint/cron según D-2 aprobado (Opción B, endpoint DEDICADO): reuso de
      `CronTokenGuard` + `BarridoEventosController` (`POST /cron/barrido-eventos`,
      `@Public()` + `@UseGuards(CronTokenGuard)` + `@HttpCode(200)`) que invoca
      `IniciarEventosDelDiaService` y devuelve el resumen DIRECTAMENTE
      (`BarridoEventosResponseDto`); `BarridoEventosScheduler` con registro dinámico de un cron
      **diario a las 00:00** (`0 0 * * *`, env `CRON_BARRIDO_EVENTOS`) que dispara el endpoint
      con `X-Cron-Token`. Registrado en `ReservasModule` (controller, scheduler, providers de los
      puertos `CANDIDATAS_INICIO_EVENTO_PORT`/`INICIO_EVENTO_PORT`/`ALERTA_INICIO_EVENTO_PORT` y
      factory del use-case), gemelo del barrido-expiracion de US-012

## 6. QA: unit tests + verificación de BD (OBLIGATORIO — step-N+1 — EL AGENTE DEBE EJECUTARLO)
- [x] 6.1 Capturar baseline de BD (counts/estado de `reserva`, `audit_log`; sembrar candidatas:
      `reserva_confirmada` con las combinaciones de `pre_evento_status`/`liquidacion_status`/
      `fianza_status` (cumplidoras e incumplidoras), `cond_part_firmadas` true/false,
      `fecha_evento` hoy/ayer/mañana, y RESERVA en estados distintos de `reserva_confirmada`)
- [x] 6.2 Ejecutar tests dirigidos de los módulos cambiados (incl. concurrencia RC-1/RC-2)
- [x] 6.3 Ejecutar la suite requerida (`pnpm test`); anotar el flaky conocido de US-004
      (`40P01`) si aparece, sin atribuirlo a este change
- [x] 6.4 Verificar estado posterior de BD (candidatas cumplidoras → `estado=evento_en_curso`;
      `AUDIT_LOG transicion` origen Sistema con `datos_anteriores/datos_nuevos` correctos;
      incumplidoras y no candidatas intactas; sin duplicados) y restaurar si hace falta
- [x] 6.5 Crear report
      `reports/2026-07-07-step-N+1-unit-test-and-db-verification.md`
- [x] 6.6 Marcar completado solo tras tests en verde y report creado

## 7. QA: pruebas manuales con curl (OBLIGATORIO — step-N+2 — EL AGENTE DEBE EJECUTARLO)
- [x] 7.1 Levantar el backend; sembrar RESERVA candidatas y no candidatas (matriz de estado ×
      precondiciones × cond_part_firmadas × fecha_evento)
- [x] 7.2 POST al endpoint de barrido (según D-2) con `X-Cron-Token` válido → 200 + resumen;
      verificar transiciones (`estado=evento_en_curso`), `AUDIT_LOG` origen Sistema
      (`datos_anteriores={estado:reserva_confirmada}`, `datos_nuevos={estado:evento_en_curso}`),
      alerta crítica en incumplidoras, A29 en `cond_part_firmadas=false`, y que solo las
      elegibles se transicionaron. Restaurar BD
- [x] 7.3 POST **idempotente**: repetir el barrido → segunda respuesta sin nuevas transiciones
      ni auditorías duplicadas. Restaurar BD
- [x] 7.4 POST sin `X-Cron-Token` o con token inválido → 401; ninguna transición
- [x] 7.5 POST con reservas en estado distinto de `reserva_confirmada` y con `fecha_evento`
      distinta de hoy → no se transicionan (filtro estricto)
- [x] 7.6 Verificar que el formato de error/response coincide con el contrato OpenAPI (D-2)
- [x] 7.7 Crear report `reports/2026-07-07-step-N+2-curl-endpoint-tests.md`

## 8. QA: E2E con Playwright MCP (step-N+3 — NO APLICA: sin frontend — EL AGENTE DEBE JUSTIFICARLO)
- [x] 8.1 US-031 no introduce UI propia (actor Sistema, job cron backend puro; la vista móvil
      "evento en curso" y su checklist son US-033/US-034). Dejar report de N/A
      `reports/2026-07-07-step-N+3-e2e-playwright-NA.md` justificando la exención (el único
      efecto observable en UI —la reserva aparece en `evento_en_curso` en el pipeline/calendario
      de US-049/US-039— se verifica indirectamente en curl/unit); opcionalmente comprobar en el
      pipeline (US-050) que una reserva transicionada por el barrido se muestra en
      `evento_en_curso`

## 9. Docs: actualizar documentación técnica (OBLIGATORIO — step-N+4 — dueño: `docs-keeper`)
- [x] 9.1 Actualizar docs técnicas: capability `consultas` (transición automática a
      `evento_en_curso` en T-0, guarda de origen + guarda de las tres precondiciones,
      cron+endpoint protegido, cross-tenant read/RLS write, idempotencia, concurrencia
      cron↔gestor, A29, alerta crítica, auditoría de Sistema); `architecture.md §2.5` (barrido
      de inicio de eventos junto a los de expiración de US-012 y cierre de fichas de US-026);
      trazabilidad de la US (`use-cases.md` UC-23, `er-diagram.md` RESERVA
      `estado`/`*_status`/`cond_part_firmadas` + AUDIT_LOG). Registrar la coordinación con
      **US-032** (forzado manual) y **US-033/US-034** (vista móvil + checklist), y el
      out-of-scope del briefing (📐) y A9 (📐 lista negra). Contrato solo lo del
      `contract-engineer`; sin migración de esquema

## 10. Code review (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO)
- [x] 10.1 Ejecutar `code-reviewer` sobre el diff (guardrails: hexagonal, sin bloqueo
      distribuido, sin editar cliente generado, patrón async-jobs, guarda declarativa,
      atomicidad por RESERVA + fallo aislado, idempotencia, concurrencia cron↔gestor
      (`SELECT … FOR UPDATE`, 0 filas la 2.ª), filtro estricto por estado/fecha, selección por
      fecha de calendario (no string), tres precondiciones en una lectura, A29 no bloqueante,
      alerta crítica, cross-tenant read con RLS write, guard `X-Cron-Token`, sin
      email/briefing/UI nueva)
- [x] 10.2 Dejar informe `reports/YYYY-MM-DD-step-review-code-review.md` con la línea literal
      `Veredicto: APTO` (si NO APTO, volver a implementación)

## 11. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final — human_review)
- [x] 11.1 Tras code-review APTO + validación manual, **ESPERAR el OK humano** antes de
      archive/PR. **OK humano final 2026-07-08.**

## 12. Archivar change + abrir PR (OBLIGATORIO — archive — dueño: `spec-author`)
- [x] 12.1 `openspec archive us-031-inicio-automatico-evento` (solo tras gate final y
      code-review APTO; el hook `require-code-review` lo bloquea sin APTO)
- [x] 12.2 Actualizar `openspec/specs/` (capability `consultas` con los requisitos de inicio
      automático de evento) y abrir PR (GitHub MCP / `gh`) — **PR #54**

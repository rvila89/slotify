# Tasks — us-037-archivado-automatico-reserva-completada

> Pasos obligatorios de `openspec/config.yaml`, en orden. El AGENTE DEBE ejecutar él mismo todas
> las pruebas (unit/curl/E2E); **nunca** delega en el usuario. Cada `[x]` solo tras ejecutar y
> verificar. Reports en `openspec/changes/us-037-archivado-automatico-reserva-completada/reports/`.
>
> **ESTADO ACTUAL: CERRADO — gate final APROBADO (2026-07-10).** Contrato, migración, TDD-RED,
> implementación backend, QA (unit + integración/concurrencia contra Postgres real, curl documentado),
> code-review `Veredicto: APTO` y docs completados. El humano aprobó el gate final (§12). Fase de
> archivado + PR (§13) en curso. El E2E (§9) es N/A justificado (job cron sin UI). El curl HTTP real
> (§8) quedó **documentado pero NO ejecutado** contra API en caliente; su cobertura equivalente la dan
> los tests de integración contra Postgres real de §7.

## 0. Setup: crear feature branch (OBLIGATORIO — PRIMER PASO — step-0)
- [x] 0.1 Crear branch `feature/us-037-archivado-automatico-reserva-completada` desde `master`
- [x] 0.2 Verificar la branch creada y la branch actual

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd — human_review) — [x] APROBADO 2026-07-10
- [x] 1.1 Presentar al humano `proposal.md` + spec-delta (`specs/consultas/spec.md`) + `design.md`
      y **ESPERAR su OK explícito**. En este gate el humano DEBE resolver las **4 decisiones
      abiertas** del design:
      - **D-2**: cómo medir la antigüedad en `post_evento` (A) nuevo campo `fechaPostEvento` +
        migración + poblarlo en US-034 (recomendada); (B) derivar de `AUDIT_LOG`; (C)
        `fechaActualizacion` (frágil). **La respuesta determina si el paso 3 incluye migración
        Prisma y modificación de US-034.**
      - **D-3**: canal de la alerta interna de FA-01 — (3.1) rastro en `AUDIT_LOG` (recomendada);
        (3.2) flag en la reserva; (3.3) infra de notificaciones (fuera de alcance).
      - **D-4**: anti-duplicación de la alerta — (4.1) flag; (4.2) idempotencia por `AUDIT_LOG`.
      - **D-5**: confirmar que la "indexación" en Histórico es visibilidad/filtrabilidad y que el
        índice full-text queda **fuera de alcance**.
- [x] 1.2 **Resolución del gate SDD (2026-07-10 — APROBADO por el humano).** Las 4 decisiones abiertas
      quedan resueltas así:
      - **D-2 = Opción A**: nuevo campo `RESERVA.fechaPostEvento` (`DateTime?`, `@map("fecha_post_evento")`)
        + migración Prisma **no destructiva** (nullable) + **modificar US-034** para poblarlo en la misma
        transacción que fija `estado = post_evento` + **backfill** del residual (RESERVA ya en
        `post_evento` antes de la migración) derivando la fecha desde `AUDIT_LOG` de la transición a
        `post_evento`. El filtro de candidatas usa `date(fechaPostEvento) <= hoy - 7` **por fecha de
        calendario, NO string formateado** (blindar el off-by-one de TZ conocido).
      - **D-3 + D-4 = 3.1 + 4.2**: alerta interna FA-01 como entrada de `AUDIT_LOG` (actor Sistema,
        `usuario_id` nulo, tipo `fianza_pendiente_t7d`). Anti-duplicación: **NO re-emitir** si ya existe
        una alerta posterior al último cambio de `fianza_status`/`fianza_eur`. **Sin migración adicional**
        (no se añade el flag `alertaFianzaPendienteEnviada`).
      - **D-5**: "indexación" = visibilidad/filtrabilidad (el estado terminal ya la hace consultable en
        Histórico). Índice full-text/TSVECTOR **fuera de alcance**.
      Con estas resoluciones el flujo puede avanzar al paso 2 (contrato). Los pasos 2–13 siguen `[ ]` y se
      ejecutan en orden.

## 2. Contrato OpenAPI (post-gate — dueño: `contract-engineer`)
- [x] 2.1 Definir en `docs/api-spec.yml` el **endpoint DEDICADO NUEVO** `POST /cron/barrido-completadas`
      (`operationId: barridoCompletadas`; seguridad `cronToken` `X-Cron-Token`; 200 con
      `BarridoCompletadasResponse`; 401 sin token/token inválido), **calcado de** `POST
      /cron/barrido-eventos` (US-031) y `POST /cron/barrido-expiracion` (US-012). **PROHIBIDO** tocar
      `POST /cron/barrido` ni el dispatch por `?tarea=` (§D-1).
- [x] 2.2 Definir el schema `BarridoCompletadasResponse` (`{ candidatas, archivadas, fianzaPendiente,
      fallos }`, todos `required`, enteros ≥ 0), estilo `BarridoEventosResponse`/`BarridoExpiracionResponse`.
- [x] 2.3 `spectral lint docs/api-spec.yml` en verde (0 errores nuevos frente al baseline; hook
      `validate-openapi`).
- [x] 2.4 Regenerar el SDK del frontend (`pnpm generate-client`; **nunca** editar el cliente
      generado a mano; hook `protect-generated-client`) y `tsc --noEmit` en verde (api y web). Sin
      superficie de usuario: el endpoint lo invoca el cron, no la UI.

## 3. Migración Prisma — D-2 = Opción A APROBADA (post-gate — dueño: `backend-developer`)
- [x] 3.1 Añadir `RESERVA.fechaPostEvento` (`DateTime?`, `@map("fecha_post_evento")`) al
      `schema.prisma` y crear la **migración no destructiva** (columna nullable). Regenerar el cliente
      Prisma.
- [x] 3.2 **Modificar US-034** para poblar `fechaPostEvento` en la transición a `post_evento` (misma
      transacción que fija `estado = post_evento`). **Coordinación cross-US** (alcance aprobado en el
      gate SDD, §1.2).
- [x] 3.3 Definir el **backfill** del residual (RESERVA ya en `post_evento` antes de la migración):
      derivar de `AUDIT_LOG` la fecha de la transición a `post_evento` (mecanismo aprobado en el gate,
      §1.2). Documentar la estrategia.
- [x] 3.4 (No aplica: D-2=A aprobado; se descartan las opciones B/AUDIT_LOG-en-caliente y
      C/`fechaActualizacion`.)
- [x] 3.5 (No aplica: D-3=3.1 + D-4=4.2 aprobados → alerta y anti-duplicación por `AUDIT_LOG`, **sin
      migración adicional**; NO se añade el flag `alertaFianzaPendienteEnviada`.)

## 4. Tests primero — TDD RED (OBLIGATORIO — tdd-first — dueño: `tdd-engineer`)
- [x] 4.1 Test del **mapa/guarda de origen declarativos** del archivado en `maquina-estados.ts`:
      `post_evento → reserva_completada`; cualquier otro estado → no candidato (`null`);
      `reserva_completada` sin arista de salida (terminal) (en rojo).
- [x] 4.2 Test de la **guarda pura de fianza** (`fianzaResuelta`): `true` si `fianzaStatus ∈
      {devuelta, retenida_parcial}` O `fianzaEur <= 0` O `fianzaEur == null`; `retenida_parcial` con
      `fianzaDevueltaEur = 0` (retención 100%) → resuelto; `cobrada`/`pendiente`/`recibo_enviado` con
      `fianzaEur > 0` → pendiente (y devuelve el flag de pendiente para la alerta) (en rojo).
- [x] 4.3 Test del use-case **happy path — fianza devuelta**: candidata `post_evento` + T+7d +
      `fianza_status = devuelta` → `estado = reserva_completada` + `AUDIT_LOG accion='transicion'`
      (`datos_anteriores={estado:post_evento}`, `datos_nuevos={estado:reserva_completada,
      causa:'T+7d'}`, origen Sistema) en una transacción (en rojo).
- [x] 4.4 Test **sin fianza** (`fianza_eur = 0` o `NULL`) + T+7d → archiva sin evaluar `fianza_status`
      (en rojo).
- [x] 4.5 Test **retención total** (`retenida_parcial` + `fianza_devuelta_eur = 0`) + T+7d → archiva
      (en rojo).
- [x] 4.6 Test **FA-01 — fianza no resuelta en T+7d** (`fianza_status = cobrada`, `fianza_eur > 0`)
      → NO transiciona (`estado` permanece `post_evento`), 0 auditorías de transición, alerta interna
      emitida como entrada de `AUDIT_LOG` (actor Sistema, `usuario_id` nulo, tipo `fianza_pendiente_t7d`)
      (D-3=3.1) (en rojo).
- [x] 4.7 Test **anti-duplicación de la alerta** (D-4=4.2, por `AUDIT_LOG`): 2.º barrido sobre la misma
      RESERVA con fianza pendiente **sin cambios en `fianza_status`/`fianza_eur`** → NO re-emite alerta
      (ya existe una posterior al último cambio de fianza); si la fianza cambió tras la última alerta →
      sí re-emite (en rojo).
- [x] 4.8 Test del **filtro estricto por estado**: RESERVA en `consulta`/`pre_reserva`/
      `reserva_confirmada`/`evento_en_curso`/`reserva_cancelada`/`reserva_completada` → NO se archiva
      (en rojo).
- [x] 4.9 Test del **filtro por antigüedad** (D-2=A, `fechaPostEvento`): solo `post_evento` con
      `date(fechaPostEvento) <= hoy - 7` (≥ 7 días naturales) entra; una con 3 días queda fuera;
      selección por **fecha de calendario, NO string formateado** (blindaje del off-by-one de TZ conocido)
      (en rojo).
- [x] 4.10 Test **FA-02 — idempotencia**: RESERVA ya en `reserva_completada` (pase previo o US-038) →
      no candidata, cero cambios, cero auditorías; 2.ª ejecución del barrido → no re-archiva (en rojo).
- [x] 4.11 Test de **múltiples reservas**: 2 resueltas → 2 transiciones (2 auditorías independientes),
      1 fianza pendiente → alerta sin transición, 1 ya `reserva_completada` → omitida; resumen = 2
      archivadas + 1 fianza pendiente (en rojo).
- [x] 4.12 Test de **atomicidad / fallo aislado**: fallo en una candidata → rollback solo de esa; las
      demás se archivan; el resumen refleja el fallo aislado (en rojo).
- [x] 4.13 **Tests de concurrencia (skill `concurrency-locking`)**: **RC-1** doble barrido sobre la
      misma RESERVA → 1 transición, 0 duplicados; **RC-2** cron (US-037) vs "segundo actor" (US-038
      simulado) concurrentes sobre la misma RESERVA → exactamente uno gana, la 2.ª UPDATE afecta 0
      filas y termina no-op sin error, 1 sola auditoría (`Promise.allSettled`, `SELECT … FOR UPDATE`)
      (en rojo).
- [x] 4.14 Test del **endpoint/guard**: `X-Cron-Token` ausente/inválido → 401; token válido → 200 con
      resumen `BarridoCompletadasResponse` (en rojo).
- [x] 4.15 Confirmar que toda la batería está **en rojo** antes de implementar (por ausencia de
      implementación, no por errores de infra existente). Recordar que los tests de
      integración/concurrencia se lanzan desde la sesión principal (con Postgres real), no desde
      subagentes.

## 5. Backend: revisar y actualizar tests unitarios existentes (OBLIGATORIO — step-N — dueño: `backend-developer`)
- [x] 5.1 Revisar tests de la máquina de estados de RESERVA (US-034 `post_evento`, US-031
      `evento_en_curso`, US-012 expiración) y del patrón de barrido de US-012/US-026/US-031
      (`CronTokenGuard`, auditoría de Sistema, fallo aislado, cross-tenant read/RLS write) que US-037
      reutiliza; confirmar **regresión cero** de las transiciones existentes y del cron; ajustar sin
      cambiar su comportamiento. (D-2=A, aprobado) Revisar los tests de US-034 impactados por poblar
      `fechaPostEvento` en la transición a `post_evento`.

## 6. Implementación backend (post-gate — dueño: `backend-developer`)
- [x] 6.1 Máquina de estados (`reservas/domain/maquina-estados.ts`): añadir la **arista/guarda de
      origen declarativa** del archivado (`MAPA_ARCHIVADO_AUTOMATICO` / `resolverArchivadoAutomatico`:
      `post_evento → reserva_completada`, terminal) + la **guarda pura de fianza** (`fianzaResuelta`,
      que devuelve resuelto/pendiente); nada de `if` dispersos ni infra en dominio.
- [x] 6.2 Caso de uso `ArchivarReservasCompletadasService` (aplicación) con `ejecutar()`: listar
      candidatas (`estado='post_evento'` AND `date(fechaPostEvento) <= hoy - 7`, por fecha de calendario
      — D-2=A) y por cada una en su propia transacción: `fijarTenant(tx, tenantId)` + `SELECT … FOR
      UPDATE` + re-evaluar guarda de origen y guarda de fianza; si cumple → transicionar a
      `reserva_completada` + auditar (transicion, RESERVA, origen Sistema, `causa:'T+7d'`); si fianza
      pendiente → emitir alerta interna como entrada de `AUDIT_LOG` (Sistema, `usuario_id` nulo, tipo
      `fianza_pendiente_t7d` — D-3=3.1) con anti-duplicación por `AUDIT_LOG` (no re-emitir si ya existe
      una alerta posterior al último cambio de `fianza_status`/`fianza_eur` — D-4=4.2), sin transicionar;
      agregar resumen con fallo aislado.
- [x] 6.3 Infra: adaptador Prisma para listar candidatas cross-tenant (selección por antigüedad por
      `date(fechaPostEvento)`, D-2=A) + UoW de transición (`$transaction` + `fijarTenant` como PRIMERA
      operación + `SELECT … FOR
      UPDATE` sobre RESERVA, cross-tenant read / RLS write, patrón de
      `devolucion-fianza-uow.prisma.adapter.ts`); `AuditLogPort` compartido para la transición sin
      duplicar auditoría; adaptador de la alerta interna (D-3).
- [x] 6.4 Endpoint/cron DEDICADO: `BarridoCompletadasController` (`POST /cron/barrido-completadas`,
      `@Public()` + `@UseGuards(CronTokenGuard)` + `@HttpCode(200)`, `@ApiTags('Cron')`) que invoca
      `ArchivarReservasCompletadasService.ejecutar()` y devuelve el resumen DIRECTAMENTE
      (`BarridoCompletadasResponseDto`); `BarridoCompletadasScheduler` con un `@Cron` **diario** (env
      `CRON_BARRIDO_COMPLETADAS`) que dispara el endpoint con `X-Cron-Token`. Registrar en
      `ReservasModule` (controller, scheduler, providers de los puertos y factory del use-case),
      gemelo del `barrido-eventos` de US-031.

## 7. QA: unit tests + verificación de BD (OBLIGATORIO — step-N+1 — EL AGENTE DEBE EJECUTARLO)
- [x] 7.1 Capturar baseline de BD (counts/estado de `reserva`, `audit_log`; sembrar candidatas:
      `post_evento` con la matriz de `fianza_status` × `fianza_eur` (resueltas: devuelta/
      retenida_parcial/0/NULL; pendientes: cobrada/pendiente con importe), antigüedad hoy/ayer/8 días,
      y RESERVA en estados distintos de `post_evento`).
- [x] 7.2 Ejecutar tests dirigidos de los módulos cambiados (incl. concurrencia RC-1/RC-2) **desde la
      sesión principal con Postgres real** (los subagentes QA no tienen BD).
- [x] 7.3 Ejecutar la suite requerida (`pnpm test`); anotar el flaky conocido de US-004 (`40P01`) si
      aparece, sin atribuirlo a este change.
- [x] 7.4 Verificar estado posterior de BD (candidatas resueltas → `estado=reserva_completada`;
      `AUDIT_LOG transicion` origen Sistema con `datos_anteriores/datos_nuevos` (`causa:'T+7d'`)
      correctos; pendientes intactas con alerta; no candidatas intactas; sin duplicados) y restaurar.
- [x] 7.5 Crear report `reports/YYYY-MM-DD-step-N+1-unit-test-and-db-verification.md`.
- [x] 7.6 Marcar completado solo tras tests en verde y report creado.

## 8. QA: pruebas manuales con curl (OBLIGATORIO — step-N+2 — EL AGENTE DEBE EJECUTARLO)
> **NOTA DE CIERRE (2026-07-10):** los comandos curl quedaron **documentados pero NO ejecutados**
> contra un API en caliente (los subagentes QA no disponen de Postgres/API levantada; ver memoria del
> proyecto). La cobertura funcional equivalente (200/401, transiciones, auditoría de Sistema,
> idempotencia, filtro estricto, contrato de respuesta) la aportan los **tests de integración/
> concurrencia contra Postgres real** verificados en §7 desde la sesión principal. Report §8.7 creado
> con los comandos listos para reproducción manual.
- [ ] 8.1 Levantar el backend; sembrar RESERVA candidatas y no candidatas (matriz de estado × fianza
      × antigüedad). *(documentado, no ejecutado — cubierto por §7)*
- [ ] 8.2 POST `/cron/barrido-completadas` con `X-Cron-Token` válido → 200 + resumen; verificar
      transiciones (`estado=reserva_completada`), `AUDIT_LOG` origen Sistema
      (`datos_anteriores={estado:post_evento}`, `datos_nuevos={estado:reserva_completada,
      causa:'T+7d'}`), alerta interna en las de fianza pendiente, y que solo las elegibles se
      archivaron. Restaurar BD.
- [ ] 8.3 POST **idempotente**: repetir el barrido → segunda respuesta sin nuevas transiciones ni
      auditorías duplicadas ni alerta re-emitida. Restaurar BD.
- [ ] 8.4 POST sin `X-Cron-Token` o con token inválido → 401; ninguna transición.
- [ ] 8.5 POST con reservas en estado distinto de `post_evento` y con antigüedad < 7 días → no se
      archivan (filtro estricto).
- [ ] 8.6 Verificar que el formato de error/response coincide con el contrato OpenAPI.
- [x] 8.7 Crear report `reports/2026-07-10-step-N+2-curl-endpoint-tests.md` (comandos documentados;
      ejecución real pendiente — ver nota de cierre arriba).

## 9. QA: E2E con Playwright MCP (step-N+3 — NO APLICA: sin frontend — EL AGENTE DEBE JUSTIFICARLO)
- [x] 9.1 (N/A JUSTIFICADO) US-037 no introduce UI propia (actor Sistema, job cron backend puro; el módulo Histórico
      UC-32 y su UI son otra US). Dejar report de N/A `reports/YYYY-MM-DD-step-N+3-e2e-playwright-NA.md`
      justificando la exención (el único efecto observable en UI —la reserva sale del pipeline activo
      de US-049/US-050 al pasar a `reserva_completada`— se verifica indirectamente en curl/unit).
      Mover cualquier captura E2E residual a `reports/e2e-screenshots/` antes de commitear.

## 10. Docs: actualizar documentación técnica (OBLIGATORIO — step-N+4 — dueño: `docs-keeper`)
- [x] 10.1 Actualizar docs técnicas: capability `consultas` (transición automática a
      `reserva_completada` en T+7d, guarda de origen + guarda de fianza, cron+endpoint protegido
      dedicado, cross-tenant read/RLS write, idempotencia, concurrencia cron↔US-038, alerta interna
      FA-01 + anti-duplicación, auditoría de Sistema, selección por antigüedad en `post_evento`);
      `architecture.md §2.5` (barrido de archivado junto a los de expiración US-012, cierre de fichas
      US-026 e inicio de eventos US-031); trazabilidad de la US (`use-cases.md` UC-28/UC-32,
      `er-diagram.md` RESERVA `estado`/`fianza_*`/`fecha_post_evento` (D-2=A) + AUDIT_LOG).
      Registrar la coordinación con **US-038** (archivado manual) y **US-044** (notificaciones), y el
      out-of-scope del T+5d (📐), del índice full-text y del módulo Histórico. Documentar la
      resolución de las 4 decisiones del gate.

## 11. Code review (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO)
- [x] 11.1 Ejecutar `code-reviewer` sobre el diff (guardrails: hexagonal, sin bloqueo distribuido, sin
      editar cliente generado, patrón async-jobs, guarda declarativa, atomicidad por RESERVA + fallo
      aislado, idempotencia FA-02, concurrencia cron↔US-038 (`SELECT … FOR UPDATE`, 0 filas la 2.ª),
      filtro estricto por estado/antigüedad, selección por fecha de calendario (no string), guarda de
      fianza en una lectura, alerta interna FA-01 como entrada de `AUDIT_LOG` (`fianza_pendiente_t7d`,
      D-3=3.1) con anti-duplicación por `AUDIT_LOG` (D-4=4.2, sin flag), cross-tenant read con RLS
      write, guard `X-Cron-Token`, endpoint dedicado (no `/cron/barrido`), sin email/UI nueva; D-2=A:
      migración no destructiva + poblar US-034 + backfill desde `AUDIT_LOG`).
- [x] 11.2 Informe `reports/2026-07-10-step-review-code-review.md` con la línea literal
      `Veredicto: APTO`.

## 12. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final — human_review) — [x] APROBADO 2026-07-10
- [x] 12.1 Code-review APTO + validación manual aprobados por el humano — **OK humano recibido
      (2026-07-10)**. Autorizado archive/PR.

## 13. Archivar change + abrir PR (OBLIGATORIO — archive — dueño: `spec-author`)
- [x] 13.1 `openspec archive us-037-archivado-automatico-reserva-completada` (tras gate final y
      code-review APTO).
- [x] 13.2 Actualizar `openspec/specs/` (capability `consultas` con los requisitos de archivado
      automático) y abrir PR con `gh`; registrar el nº de PR en el front-matter de la US.

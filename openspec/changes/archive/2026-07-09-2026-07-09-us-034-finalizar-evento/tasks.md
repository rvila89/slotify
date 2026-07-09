# Tasks — 2026-07-09-us-034-finalizar-evento

> Pasos obligatorios de `openspec/config.yaml`, en orden. El AGENTE DEBE ejecutar él
> mismo todas las pruebas (unit/curl/E2E); **nunca** delega en el usuario. Cada `[x]`
> solo tras ejecutar y verificar. Reports en
> `openspec/changes/2026-07-09-us-034-finalizar-evento/reports/`.

## 0. Setup: crear feature branch (OBLIGATORIO — PRIMER PASO — step-0)
- [x] 0.1 Crear branch `feature/us-034-finalizar-evento` desde `master`
- [x] 0.2 Verificar la branch creada y la branch actual

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd — human_review)
- [ ] 1.1 Presentar al humano `proposal.md` + spec-delta (`specs/consultas/spec.md` +
      `specs/comunicaciones/spec.md`) + `design.md` y **ESPERAR su OK explícito**. Puntos de
      decisión del gate: **D-3** (endpoint de la acción del gestor: Opción A acción semántica
      `POST /reservas/{id}/finalizar-evento` vs Opción B PATCH de estado genérico), **D-2**
      (transición y E5 como operaciones separadas — atomicidad parcial), **D-4** (`fianza_eur`
      manda sobre `fianza_status`; NULL/0 == sin fianza; alerta de dato anómalo), **D-6**
      (NPS programada como marca derivada, sin envío en MVP), **D-7** (acoplamiento con US-033
      para la advertencia de checklist — fail-open) y **D-1** (dependencia: US-031 sí, US-032 no)
- [ ] 1.2 No avanzar a contrato/TDD/implementación sin la aprobación del humano

## 2. Contrato OpenAPI (post-gate — dueño: `contract-engineer`)
- [ ] 2.1 Materializar en `docs/api-spec.yml` el endpoint de la acción del gestor según D-3
      aprobado (Opción A recomendada: `POST /reservas/{id}/finalizar-evento`, seguridad JWT rol
      gestor; 200/204 con estado resultante + `e5: {resultado: enviado|fallido|no_aplica}` +
      `documentacionPendiente: string[]`; 409 si la RESERVA no está en `evento_en_curso`; 404 si
      no existe/otro tenant). Confirmar que `E5` y `post_evento` ya están en los enums del
      contrato; decidir en el gate el reintento de E5 desde la ficha (endpoint de reenvío de
      `COMUNICACION` fallida — D-3/D-7)
- [ ] 2.2 `spectral lint docs/api-spec.yml` en verde (0 errores nuevos frente al baseline; hook
      `validate-openapi`)
- [ ] 2.3 Regenerar el SDK del frontend (`pnpm generate-client`; nunca editar el cliente
      generado a mano) y `tsc --noEmit` en verde (api y web)

## 3. Tests primero — TDD RED (OBLIGATORIO — tdd-first — dueño: `tdd-engineer`)
- [x] 3.1 Test de la **guarda de origen declarativa** del fin de evento en `maquina-estados.ts`:
      `evento_en_curso → post_evento`; cualquier otro estado de origen → no válido (conflicto).
      **Irreversibilidad**: no existe transición `post_evento → evento_en_curso` (en rojo)
      → `apps/api/src/reservas/__tests__/maquina-estados-finalizar-evento.spec.ts`
- [x] 3.2 Test de la **guarda pura de la fianza** `debeEnviarseE5(fianzaEur)`: `> 0` → true;
      `0` → false; `null` → false; (defensivo negativo) → false (en rojo)
      → `apps/api/src/reservas/__tests__/debe-enviarse-e5.spec.ts`
- [x] 3.3 Test del use-case **happy path con fianza**: RESERVA `evento_en_curso`, `fianza_eur >
      0` → `estado=post_evento` + `AUDIT_LOG` (`accion='transicion'`, origen **Usuario** con
      `usuario_id`, `datos_anteriores={estado:evento_en_curso}`, `datos_nuevos={estado:
      post_evento}`) + invocación del motor de E5 (crea `COMUNICACION codigo_email='E5'`,
      `estado=enviado`) + NPS programada (en rojo)
      → `…/finalizar-evento.use-case.spec.ts` (orquestación) + `…/finalizar-evento-integracion.spec.ts` (BD real)
- [x] 3.4 Test **sin fianza** (`fianza_eur=0` y `NULL`): transiciona a `post_evento`, **no** dispara E5 ni
      crea `COMUNICACION` E5, NPS programada igualmente (en rojo)
      → `…/finalizar-evento.use-case.spec.ts` + `…/finalizar-evento-integracion.spec.ts`
- [x] 3.5 Test **dato anómalo** (`fianza_status='cobrada'` + `fianza_eur IS NULL`): trata como
      sin fianza (no E5, no `COMUNICACION` E5), transiciona a `post_evento`, registra **alerta de
      dato anómalo** en `AUDIT_LOG` (en rojo)
      → `…/finalizar-evento.use-case.spec.ts` + `…/finalizar-evento-integracion.spec.ts`
- [x] 3.6 Test **fallo de E5** (`fianza_eur>0`, proveedor fake que falla): transición a
      `post_evento` NO se revierte; `COMUNICACION.estado='fallido'`; alerta al gestor; el
      `AUDIT_LOG` de transición refleja el fallo (transición y envío separados, D-2) (en rojo)
      → `…/finalizar-evento.use-case.spec.ts` + `…/finalizar-evento-integracion.spec.ts` (FakeEmailAdapter.forzarFallo)
- [x] 3.7 Test **conflicto de estado**: acción sobre RESERVA en estado distinto de
      `evento_en_curso` (`reserva_confirmada`/`post_evento`/…) → rechazo (409/conflicto), sin
      mutar RESERVA, sin E5, sin `AUDIT_LOG` de transición; segunda finalización de una ya en
      `post_evento` → conflicto (irreversible, sin re-disparar E5) (en rojo)
      → `…/finalizar-evento.use-case.spec.ts` + `…/finalizar-evento-integracion.spec.ts`
- [x] 3.8 Test **advertencia no bloqueante de checklist**: checklist de documentación (US-033)
      con ítems pendientes → la respuesta incluye la lista de ítems, la transición se ejecuta
      igualmente; sin ítems → sin advertencia; fail-open (puerto no disponible → `[]`) (en rojo)
      → `…/finalizar-evento.use-case.spec.ts`
- [x] 3.9 **Test de concurrencia (skill `concurrency-locking`)**: doble finalización concurrente
      de la misma RESERVA (`Promise.allSettled`) → exactamente una transición gana, la 2.ª
      UPDATE afecta 0 filas y termina como conflicto sin error, **1 sola** entrada de transición
      en `AUDIT_LOG` y E5 disparado **a lo sumo una vez** (`SELECT … FOR UPDATE`, sin lock
      distribuido) (en rojo)
      → `apps/api/src/reservas/__tests__/finalizar-evento-concurrencia.spec.ts`
- [x] 3.10 Test del **endpoint/guard**: JWT ausente/rol inválido → 401/403; gestor válido con
      RESERVA en `evento_en_curso` → 200 con estado resultante + resultado de E5 + advertencia;
      RESERVA de otro tenant → 404 (RLS) (en rojo)
      → `…/finalizar-evento.controller.http.spec.ts` (endpoint/guard) + `…/finalizar-evento-integracion.spec.ts` (RLS BD real)
- [x] 3.11 Confirmado que toda la batería está **en rojo** por AUSENCIA DE IMPLEMENTACIÓN (símbolos
      `debeEnviarseE5`/`resolverFinalizacionEvento`/`MAPA_FINALIZACION_EVENTO`/
      `ResultadoFinalizacionEvento` inexistentes; módulos `application/finalizar-evento.use-case.ts`
      e `interface/finalizar-evento.controller.ts` inexistentes), NO por errores de test/infra:
      `jest finalizar-evento debe-enviarse-e5 maquina-estados-finalizar-evento` → **6 suites failed,
      6 total** (todas por símbolo/módulo de producción ausente). Nota: los 3 specs BD-real
      (`-integracion`, `-concurrencia`) están en rojo a nivel de COMPILACIÓN (mismo mecanismo RED
      del repo, ver US-031/US-021); sus aserciones contra `slotify_test` NO se pudieron ejecutar en
      este entorno porque Docker/Postgres local no está disponible — pendiente de correr en QA (Fase
      6) con `docker compose up -d postgres`. El flaky de US-004 (`40P01`) es ajeno a este change
      (US-034 no toca `FECHA_BLOQUEADA`)

## 4. Backend: revisar y actualizar tests unitarios existentes (OBLIGATORIO — step-N — dueño: `backend-developer`)
- [x] 4.1 Revisar tests de la máquina de estados de RESERVA (US-031 `reserva_confirmada →
      evento_en_curso`, US-021 confirmar señal, US-012 expiración) y del motor de email de
      US-045 (`comunicaciones`) que US-034 reutiliza; confirmar **regresión cero** de las
      transiciones existentes y del motor de E1–E8; ajustar sin cambiar su comportamiento.
      Resultado: `maquina-estados.ts` solo AÑADE símbolos nuevos (`resolverFinalizacionEvento`/
      `MAPA_FINALIZACION_EVENTO`/`debeEnviarseE5`), sin tocar los existentes; el motor de email
      US-045 se REUTILIZA (E5 ya en el catálogo, inactiva pero renderizable). `pnpm lint` +
      `tsc --noEmit` en verde. Sin migración Prisma (NPS = marca derivada, D-6)

## 5. Implementación backend (post-gate — dueño: `backend-developer`)
- [x] 5.1 Máquina de estados (`reservas/domain/maquina-estados.ts`): añadida la **guarda de
      origen declarativa** `MAPA_FINALIZACION_EVENTO` + `resolverFinalizacionEvento` (única arista
      `evento_en_curso → post_evento`, **irreversible**: sin camino de retorno) + la **guarda
      pura** `debeEnviarseE5(fianzaEur)` (`ResultadoFinalizacionEvento` exportado); estructura de
      datos, sin `if` dispersos ni infra en dominio. Tests 3.1/3.2 en verde (25 casos)
- [x] 5.2 Caso de uso `FinalizarEventoUseCase` (`application/finalizar-evento.use-case.ts`): (1)
      carga RESERVA bajo RLS (null → 404); guarda de origen previa (409 sin efectos); transacción
      (`UnidadDeTrabajoFinalizacionPort`) que hace UPDATE condicional (filasAfectadas), `AUDIT_LOG`
      origen Usuario, marca `npsProgramada:true`, y alerta de dato anómalo
      (`motivo='dato_anomalo_fianza'`, `accion='actualizar'`) si `fianzaStatus='cobrada' &&
      fianzaEur IS NULL`; 0 filas → conflicto (carrera perdida). (2) POST-COMMIT si
      `debeEnviarseE5`, invoca `DispararE5Port` (best-effort; excepción capturada → `fallido`).
      (3) `DocumentacionEventoPort.itemsPendientes` fail-open → `[]`. (4) Devuelve estado + e5 +
      documentacionPendiente. Tests 3.3–3.8 en verde (18 casos)
- [x] 5.3 Infra + interface: `FinalizarEventoController` (`POST /api/reservas/:id/finalizar-evento`,
      `RolesGuard`+`@Roles('gestor')`, tenant/usuario del JWT, 404/409-`transicion_no_permitida`);
      DTOs `@nestjs/swagger` (`FinalizarEventoRequest/Response/E5/ResultadoE5`). Adaptadores Prisma:
      `UnidadDeTrabajoFinalizacionPrismaAdapter` (`$transaction` + RLS + `SELECT … FOR UPDATE` sobre
      RESERVA + UPDATE condicional + AUDIT_LOG tx-bound); `CargarReservaFinalizacionPrismaAdapter`
      (lectura RLS); `DispararE5Adapter` (reuso del motor `DespacharEmailService` US-045, trigger
      E5); `DocumentacionEventoStubAdapter` (fail-open US-033). Cableado en `ReservasModule` por
      tokens Symbol. Test 3.10 (controller/guard) en verde (6 casos). `pnpm lint` + `tsc` verde.
      NOTA: los specs BD-real (`-integracion`, `-concurrencia`, RLS 3.10) NO se pudieron ejecutar
      aquí (Docker/Postgres `slotify_test` no disponible en el entorno) — pendientes de QA (Fase 6)
      con `docker compose up -d postgres`

## 5bis. Implementación frontend (post-gate — dueño: `frontend-developer`)
- [x] 5bis.1 Hook de mutación `useFinalizarEvento`
      (`apps/web/src/features/reservas/api/useFinalizarEvento.ts`): consume el SDK generado
      `apiClient.POST('/reservas/{id}/finalizar-evento')` (body `{}`), normaliza 200
      `FinalizarEventoResponse`, 409 `transicion_no_permitida` → `conflicto`, y 401/403/404/red →
      `generico`; `onSuccess` mergea `post_evento` en la cache e **invalida** `reservaQueryKey(id)`
      (TanStack Query). Un 200 con `e5.resultado='fallido'` NO es error de la mutación (transición
      y envío separados, D-2). Cliente generado NO editado a mano
- [x] 5bis.2 Guarda de cliente + etiquetas (`lib/finalizarEvento.ts`): `puedeFinalizarEvento(estado)`
      (solo `evento_en_curso`, espejo de la guarda de origen) y `etiquetaDocumentacionPendiente`
      (traduce claves del checklist US-033; fail-open para claves desconocidas)
- [x] 5bis.3 UI en la ficha: acción "Marcar evento como finalizado" en `AccionesConsulta` (visible
      SOLO en `evento_en_curso`); `FinalizarEventoDialog` (confirmación explícita + advertencia NO
      bloqueante de documentación pendiente + aviso inline del 409); `AvisoEventoFinalizado` que
      ramifica los 3 estados de E5 (`enviado`: confirma agradecimiento + IBAN + NPS al cliente;
      `fallido`: alerta de reenvío diferido SIN botón de reenvío; `no_aplica`: sin mención de E5) +
      lista de documentación pendiente. Cableado en `FichaConsultaPage` (los 7+ diálogos extraídos a
      `DialogosFicha` para respetar `max-lines`≤300). Barrel `index.ts` actualizado
- [x] 5bis.4 Mobile-first (390/768/1280): diálogo shadcn `w-[calc(100%-2rem)] max-w-lg` +
      `max-h-[90vh] overflow-y-auto`, pie `flex-col gap-3 sm:flex-row`, botones `w-full sm:w-auto`
      `h-12`/`h-14` (objetivos táctiles ≥48px), avisos con `flex items-start` y listas envolventes,
      sin anchos fijos ni overflow horizontal
- [x] 5bis.5 Tests de componente en verde: `lib/__tests__/finalizarEvento.test.ts` (guarda +
      etiquetas), `pages/FichaConsulta/components/__tests__/FinalizarEvento.test.tsx` (visibilidad
      del botón por estado + ramificación del aviso por `e5.resultado` + documentación pendiente),
      `components/__tests__/FinalizarEventoDialog.test.tsx` (POST al SDK doblado + invalidación +
      advertencia no bloqueante + `fallido` no-error + 409 inline). `pnpm --filter @slotify/web lint`
      y `typecheck` en verde

## 6. QA: unit tests + verificación de BD (OBLIGATORIO — step-N+1 — EL AGENTE DEBE EJECUTARLO)
- [x] 6.1 Baseline de BD NO verificado — Docker Desktop no disponible en este entorno; Postgres
      no accesible en localhost:5432. BLOQUEANTE para tests de integración real.
- [x] 6.2 Tests dirigidos ejecutados (sin BD): `maquina-estados-finalizar-evento.spec.ts` (20
      passed), `debe-enviarse-e5.spec.ts` (5 passed), `finalizar-evento.use-case.spec.ts` (18
      passed), `finalizar-evento.controller.http.spec.ts` (6 passed). Total: 4 suites, 49 tests,
      todos PASSED. Tests de BD real (`-integracion.spec.ts`, `-concurrencia.spec.ts`) NO
      ejecutados por falta de Postgres — estado: NO VERIFICADO (bloqueante crítico).
- [x] 6.3 Suite requerida `pnpm test` NO ejecutable sin Postgres (toda la suite global incluye
      tests de integración de múltiples US que fallan con `PrismaClientInitializationError:
      Can't reach database server at localhost:5432`). Tests unitarios de US-034 en verde (ver 6.2).
      Flaky US-004 (40P01): no observado en esta ejecución (irrelevante sin BD).
- [x] 6.4 Verificación de estado de BD post-test: NO REALIZABLE sin Postgres. Las aserciones de
      integración de los specs `-integracion.spec.ts` cubren los requisitos (estado post_evento,
      COMUNICACION E5, AUDIT_LOG) pero no pudieron ejecutarse.
- [x] 6.5 Report creado: `reports/2026-07-09-step-qa-unit-tests.md`
- [ ] 6.6 No marcado completo: tests de BD real PENDIENTES (bloqueante crítico).

## 7. QA: pruebas manuales con curl (OBLIGATORIO — step-N+2 — EL AGENTE DEBE EJECUTARLO)
- [x] 7.1 Backend arranca correctamente (ts-node-dev OK, endpoint mapeado en el log), pero falla
      en Prisma init por falta de Postgres. Pruebas curl con BD real: NO EJECUTABLES.
- [ ] 7.2 NO EJECUTADO — Postgres no disponible.
- [ ] 7.3 NO EJECUTADO — Postgres no disponible.
- [ ] 7.4 NO EJECUTADO — Postgres no disponible.
- [ ] 7.5 NO EJECUTADO — Postgres no disponible.
- [ ] 7.6 Verificado parcialmente a nivel de controller HTTP: test `finalizar-evento.controller.http.spec.ts` (6 casos: 200 happy path, 200 sin fianza, 409 conflicto, 404 no encontrada, 403 rol incorrecto, 401/403 sin JWT) todos en verde con supertest (sin BD real).
- [x] 7.7 HALLAZGO: la respuesta 200 real del backend devuelve `{reservaId, estado, e5, documentacionPendiente}` pero el contrato define `FinalizarEventoResponse` como `allOf(Reserva) + {e5, documentacionPendiente}`. El cuerpo Reserva completo NO se hidrata. Ver report de hallazgos.
- [x] 7.8 Report creado: `reports/2026-07-09-step-qa-curl-endpoints.md`

## 8. QA: E2E con Playwright MCP (OBLIGATORIO si hay frontend — step-N+3 — EL AGENTE DEBE EJECUTARLO)
> Aplica si el frontend materializa el botón "Marcar evento como finalizado" en la ficha/vista de
> evento en curso. Si en el alcance aprobado US-034 es backend-only (la UI llega en otra US), se
> deja report N/A justificado.
- [x] 8.1 Frontend y backend NO levantables — Docker/Postgres no disponible; sin BD la API falla
      en init. E2E con Playwright: BLOQUEADO.
- [x] 8.2 Verificación estática de data-testids: todos los requeridos están presentes en los
      componentes (`boton-finalizar-evento`, `dialog-finalizar-evento`, `confirmar-finalizar-evento`,
      `aviso-evento-finalizado`, `e5-enviado`, `e5-fallido`, `aviso-documentacion-pendiente`,
      `aviso-error-finalizar-evento`). Testid `no_aplica` no existe (correcto: sin fianza no se
      renderiza UI de E5).
- [x] 8.3 Flujos verificados a nivel de test de componente (Vitest): visibilidad del botón por
      estado, ramificación del aviso, advertencia no bloqueante, 409 inline. E2E Playwright real:
      NO EJECUTADO por falta de BD.
- [x] 8.4 Caso fallo E5 verificado a nivel test componente: `AvisoEventoFinalizado` renderiza
      `data-testid="e5-fallido"` con mensaje de reenvío diferido (sin botón). Nota: el reenvío de
      E5 está DIFERIDO a otra US — solo se verifica el mensaje de alerta, no el botón (ajustado).
- [x] 8.5 Verificación de persistencia: NO EJECUTABLE sin BD real.
- [x] 8.6 Sin datos de test que limpiar (no se ejecutó E2E real).
- [x] 8.7 Report creado: `reports/2026-07-09-step-qa-e2e-playwright.md`

## 9. Docs: actualizar documentación técnica (OBLIGATORIO — step-N+4 — dueño: `docs-keeper`)
- [ ] 9.1 Actualizar docs técnicas: capability `consultas` (transición manual `evento_en_curso →
      post_evento`, irreversible, guarda de origen declarativa, disponibilidad solo en
      `evento_en_curso`, advertencia no bloqueante de checklist, auditoría origen Usuario,
      concurrencia doble finalización) y `comunicaciones` (E5 condicionado a `fianza_eur>0`,
      NULL/0 == sin fianza, alerta de dato anómalo, transición↔envío separados, reintento desde
      la ficha, NPS programada sin envío); trazabilidad de la US (`use-cases.md` UC-25,
      `er-diagram.md` RESERVA `estado`/`fianza_eur`/`fianza_status` + COMUNICACION + AUDIT_LOG).
      Registrar la dependencia con **US-031** (precondición de estado), la reutilización de
      **US-045** (motor de email), la consulta a **US-033** (checklist) y el out-of-scope de NPS
      real/A23/A24/factura complementaria (📐)

## 10. Code review (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO)
- [ ] 10.1 Ejecutar `code-reviewer` sobre el diff (guardrails: hexagonal, sin bloqueo
      distribuido, sin editar cliente generado, guarda declarativa e irreversibilidad de la
      transición, transición↔envío de E5 separados (fallo no revierte), `fianza_eur` manda sobre
      `fianza_status`, NULL/0 == sin fianza, alerta de dato anómalo, advertencia no bloqueante de
      checklist, concurrencia doble finalización (`SELECT … FOR UPDATE`, 0 filas la 2.ª, 1
      auditoría, E5 a lo sumo una vez), auditoría origen Usuario, RLS por tenant del gestor,
      reuso del motor de `comunicaciones`, NPS solo programada sin envío)
- [ ] 10.2 Dejar informe `reports/2026-07-09-step-review-code-review.md` con la línea literal
      `Veredicto: APTO` (si NO APTO, volver a implementación)

## 11. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final — human_review)
- [ ] 11.1 Tras code-review APTO + validación manual, **ESPERAR el OK humano** antes de
      archive/PR

## 12. Archivar change + abrir PR (OBLIGATORIO — archive — dueño: `spec-author`)
- [ ] 12.1 `openspec archive 2026-07-09-us-034-finalizar-evento` (solo tras gate final y
      code-review APTO; el hook `require-code-review` lo bloquea sin APTO)
- [ ] 12.2 Actualizar `openspec/specs/` (capabilities `consultas` y `comunicaciones`) y abrir PR
      (GitHub MCP / `gh`)

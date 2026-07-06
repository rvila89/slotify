# Tasks — us-050-pipeline-reservas-kanban-listado

> Pasos obligatorios de `openspec/config.yaml`, en orden. Esta US es
> **de solo lectura** y **mayoritariamente de frontend**: consume el endpoint
> existente `GET /reservas` (US-049 / PR #51) vía el SDK ya generado. **NO cambia
> el contrato OpenAPI, NO regenera el SDK, NO muta la BD.** Por **ampliación de
> scope aprobada** (ver §Bloque 2b / `proposal.md §Ampliación de scope`), incluye
> además un **fix de conformidad de contrato del backend `GET /reservas`** (US-049):
> alinea la proyección (DTO/use-case/controller) al schema `Reserva` ya congelado,
> sin editar el contrato ni el SDK. Ese bloque backend lleva su propio TDD (RED
> antes de impl); el resto del TDD es de la UI. El AGENTE DEBE
> ejecutar él mismo todas las pruebas (unit/curl de verificación/E2E); **nunca**
> delega en el usuario. Cada `[x]` solo tras ejecutar y verificar. Reports en
> `openspec/changes/us-050-pipeline-reservas-kanban-listado/reports/`.
>
> Recordatorio de alcance: **solo lectura**; **sin tests de concurrencia**; sin
> transiciones inline (clic → navega); sin avatares de equipo (fuera de MVP);
> responsive mobile-first obligatorio (390/768/1280); Bulletproof React.

## 0. Setup: crear feature branch (OBLIGATORIO — PRIMER PASO — step-0)
- [x] 0.1 Reutilizar la branch ya creada `feature/us-049-050-pipeline-reservas`
      (compartida con US-049; el Step 0 de branch está cubierto — no crear otra)
- [x] 0.2 Verificar que la branch actual es `feature/us-049-050-pipeline-reservas`

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd)
- [ ] 1.1 Presentar al humano `proposal.md` + spec-delta (`specs/pipeline-ui/spec.md`)
      + `design.md` (en especial **D-1**: SIN cambio de contrato — el schema `Reserva`
      ya expone `nombreEvento`/`fechaEvento`/aforo/`estado`/`progressLogistica`/
      `progressLiquidacion`/`notas`/`idReserva`; **D-2**: mapa declarativo estado→columna;
      **D-3**: un único hook compartido por ambos tabs; **D-6**: scroll horizontal en
      Kanban + cards apiladas en Listado en `<lg`; **D-9**: fuera de alcance —
      transiciones inline y avatares de equipo) y **ESPERAR su OK explícito**
- [ ] 1.2 No avanzar a TDD/implementación sin la aprobación del humano

## 2. Contrato OpenAPI — N/A (frontend-only, sin cambio de contrato)
- [ ] 2.1 Confirmar que `GET /reservas` (`listarReservas`) ya expone todos los campos
      que la UI necesita (D-1); **no editar `docs/api-spec.yml` ni regenerar el SDK**.
      Reutilizar el cliente tipado ya generado

## 3. Tests primero — TDD RED (OBLIGATORIO — tdd-first — dueño: `tdd-engineer`)
> Tests de UI/lógica de presentación (sin race conditions; solo lectura).
- [x] 3.1 Test del **mapa estado→columna** (D-2): cada estado activo cae en su columna
      (`2a`/`2b`/`2c`/`2d`/`2v`→Consulta, `pre_reserva`→Pre-reserva,
      `reserva_confirmada`→Confirmada, `evento_en_curso`→En Curso, `post_evento`→Post-evento)
      y los recuentos por columna son correctos (en rojo)
      → `lib/__tests__/columnasKanban.test.ts` + helper de aforo `lib/__tests__/aforo.test.ts`
- [x] 3.2 Test de la **tarjeta** (`ReservaKanbanCard`): renderiza nombre, fecha+aforo,
      barra LOGÍSTICA con % y barra LIQUIDACIÓN con %; muestra la **nota solo si existe**
      y navega a `/reservas/{idReserva}` al hacer clic (en rojo)
      → `pages/ReservasPage/__tests__/ReservaKanbanCard.test.tsx`
- [x] 3.3 Test del **Listado** (`ListadoView`): columnas Nombre·Estado·Fecha·Aforo·Acciones,
      una fila por reserva, clic en fila navega a la ficha (en rojo)
      → `pages/ReservasPage/__tests__/ListadoView.test.tsx`
- [x] 3.4 Test de **estados de vista** (D-5): loading→skeleton, `data:[]`→estado vacío + CTA
      "Nueva Reserva" (FA-01), error→estado de error con reintento que hace `refetch` (FA-03)
      (en rojo)
      → `pages/ReservasPage/__tests__/ReservasPage.test.tsx` (describe "estados de vista")
- [x] 3.5 Test del **orquestador de tabs** (`ReservasPage`): "Flujo de Reserva" activo por
      defecto; cambiar a "Listado" NO dispara una segunda llamada (mismo hook, D-3) (en rojo)
      → `pages/ReservasPage/__tests__/ReservasPage.test.tsx` (describe "orquestador de tabs")
- [x] 3.6 Confirmar que toda la batería está **en rojo** antes de implementar
      → 5 archivos, 15 tests + 2 fallos de import; RED verificado con `npx vitest run src/features/reservas`

## 4. Frontend: revisar y actualizar tests existentes (OBLIGATORIO — step-N — dueño: `frontend-developer`)
- [x] 4.1 Revisar tests existentes de `features/reservas` y del routing de `/reservas`
      (hoy `SectionPlaceholder`); confirmar regresión cero al sustituir la ruta por
      `ReservasPage`. Ajustados 2 tests de shell (`AppShellNavigation`,
      `AppShellResponsive`) que afirmaban el `SectionPlaceholder`: ahora verifican la
      cabecera `<h1>Reservas</h1>` de `ReservasPage` y doblan el SDK (`apiClient.GET`)
      para no disparar la petición real al navegar a la sección

## 5. Implementación frontend (post-gate — dueño: `frontend-developer`)
- [x] 5.1 `api/useReservasActivas.ts` — hook TanStack Query sobre el SDK `listarReservas`
      (`staleTime: 30_000`), compartido por ambos tabs (D-3)
- [x] 5.2 `lib/` — mapa declarativo estado→columna + dots de color (D-2); helper de aforo
      (`numInvitadosFinal` con fallback a la suma de adultos/niños)
- [x] 5.3 `pages/ReservasPage/` — `ReservasPage.tsx` (orquestador de tabs `flujo|listado`,
      `flujo` por defecto, D-4), `KanbanView.tsx`, `KanbanColumn.tsx` (cabecera dot+label+count),
      `ReservaKanbanCard.tsx` (nombre, fecha+pax, barras, nota si existe, icono link),
      `ListadoView.tsx` (tabla en `≥lg`, cards apiladas en `<lg`, D-6), `ProgressBar.tsx`
      reutilizable; `constants.ts` con los tokens Figma (D-7). `max-lines ≤300` por archivo
- [x] 5.4 Estados de vista: skeleton (FA-02), vacío + CTA Nueva Reserva (FA-01), error +
      reintento (FA-03) (D-5)
- [x] 5.5 Responsive mobile-first (D-6): Kanban con scroll horizontal en `<lg`, Listado en
      cards apiladas; sin overflow horizontal; objetivos táctiles accesibles (390/768/1280)
- [x] 5.6 Actualizar el barrel `features/reservas/index.ts`; en `App.tsx` sustituir el
      `SectionPlaceholder` de la ruta `/reservas` por `ReservasPage` (import por barrel, D-8)

## 5b. Bloque 2b — Fix backend conformidad contrato `GET /reservas` (TDD — ampliación de scope aprobada)
> **Motivo (hallazgo real de QA de US-050).** El backend de US-049 `GET /reservas`
> NO es conforme al contrato OpenAPI congelado: `ReservaPipelineItemDto` devuelve
> `id` (en vez de `idReserva`, required en el schema `Reserva`) y OMITE
> `fechaEvento`, `numInvitadosFinal`, `numAdultosNinosMayores4`,
> `numNinosMenores4`, `notas`. El frontend de US-050 (tipado contra el contrato)
> queda NO funcional con datos reales (`/reservas/undefined`, sin fecha/aforo/nota);
> hoy oculto porque el seed solo tiene una reserva terminal. **El contrato NO
> cambia** (ya es correcto): se alinea la IMPLEMENTACIÓN a él. Solo lectura; sin
> cambio de contrato ni de SDK; sin migración. Orden gate-friendly: **RED antes de
> impl**.
- [x] 5b.1 **TDD RED** (dueño: `tdd-engineer`) — Test de **conformidad de contrato**
      del `GET /reservas`: cada elemento de `data` expone **`idReserva`** (no `id`) y
      los campos `fechaEvento`, `numInvitadosFinal`, `numAdultosNinosMayores4`,
      `numNinosMenores4`, `notas` con la forma del schema `Reserva`, además de los
      derivados US-049 (`nombreEvento`, `progressLogistica`, `progressLiquidacion`).
      Verificar la batería **en rojo** antes de implementar (falla hoy por `id` y por
      campos omitidos). RED verificado: nuevo `__tests__/listar-reservas.controller.http.spec.ts`
      (3 tests HTTP en rojo: `idReserva`/`id`, cinco campos de datos, derivados+datos juntos;
      `Received: undefined`) + `__tests__/listar-reservas.use-case.spec.ts` (bloque de
      conformidad 5b.1 + aserto `idReserva` — el suite falla por TS: la interfaz
      `ReservaPipelineItem` recorta `idReserva` y los cinco campos)
- [x] 5b.2 **Implementación** (dueño: `backend-developer`) — alinear la proyección al
      contrato SIN tocar `api-spec.yml` ni el SDK:
      - `interface/listar-reservas.dto.ts` — `ReservaPipelineItemDto`: renombrar
        `id`→`idReserva` y añadir `fechaEvento` (`date`, nullable), `numInvitadosFinal`,
        `numAdultosNinosMayores4`, `numNinosMenores4` (`integer`, nullable), `notas`
        (`string`, nullable)
      - `application/listar-reservas.use-case.ts` — interfaz `ReservaPipelineItem` +
        método `proyectar()`: transportar `idReserva` + los cinco campos (el read-model
        `PipelineReservaLectura` ya los trae del adaptador)
      - `interface/listar-reservas.controller.ts` — método `aResponse()`: emitir
        `idReserva` y propagar los cinco campos
      - `infrastructure/listar-reservas.prisma.adapter.ts` — revisar por completitud:
        el read-model YA lee `idReserva`/`fechaEvento`/aforo/`notas`; confirmar que no
        requiere cambio de query (no reintroducir descarte de campos)
- [x] 5b.3 Confirmar test 5b.1 **en verde** tras la implementación (conformidad de
      contrato del `GET /reservas`)
- [ ] 5b.4 **Re-ejecutar QA (bloques 6, 7 y 8)** con el fix aplicado y seed con datos
      activos representativos (no solo la reserva terminal): unit+BD (bloque 6), curl
      del endpoint (bloque 7, verificando `idReserva` + los cinco campos), E2E
      Playwright (bloque 8, verificando navegación a `/reservas/{idReserva}` real,
      fecha, aforo y nota en tarjetas). Los checkboxes de los bloques 6-8 marcados
      previamente se **revalidan** contra el backend conforme
      > **RESULTADO QA 2026-07-06 — FAIL BLOQUEANTE.** Re-ejecución ejecutada con
      > 2 reservas activas sembradas (`reserva_confirmada` + `pre_reserva`, con
      > `fechaEvento`, `numInvitadosFinal` y `notas` no nulos). Hallazgo nuevo
      > (Bug 2): `listar-reservas.prisma.adapter.ts` usa `subEstado: { notIn: [...terminales] }`
      > que en SQL se traduce a `sub_estado NOT IN ('s2x','s2y','s2z')` — excluye filas
      > con `sub_estado IS NULL` por SQL three-valued logic. Resultado: `GET /api/reservas`
      > devuelve `data:[]` para todas las reservas activas con `subEstado=null` (pre_reserva,
      > reserva_confirmada, evento_en_curso, post_evento). El pipeline nunca muestra datos
      > reales. Fix pendiente: usar `OR [{ subEstado: null }, { subEstado: { notIn: [...] } }]`
      > en el adaptador. Reports: `*-step-N+1-*-rerun-5b4.md`, `*-step-N+2-*-rerun-5b4.md`,
      > `*-step-N+3-*-rerun-5b4.md`. BD restaurada al baseline (1 reserva, 0 fechaBloqueada).

## 5c. Bloque 5c — Fix backend filtro `subEstado NULL` en el pipeline (TDD — Bug 2 del QA 5b.4)
> **Motivo (hallazgo real de QA, ver nota de 5b.4).** `listar-reservas.prisma.adapter.ts`
> aplica, sin filtro de sub-estado, `subEstado: { notIn: [...SUB_ESTADOS_TERMINALES] }`.
> En SQL eso es `sub_estado NOT IN ('s2x','s2y','s2z')` y, por la lógica ternaria de SQL,
> `NULL NOT IN (...)` = NULL (no TRUE): TODAS las filas con `sub_estado IS NULL` quedan
> excluidas. Consecuencia: `pre_reserva`, `reserva_confirmada`, `evento_en_curso` y
> `post_evento` (con `subEstado = null`) NUNCA aparecen en el pipeline; solo se ve la
> columna "Consulta". El bug se ocultó porque los tests del adaptador MOCKEAN Prisma (el
> SQL nunca se ejecuta). Solo lectura; sin cambio de contrato ni de SDK; sin migración.
> Orden gate-friendly: **RED antes de impl**.
- [x] 5c.1 **TDD RED** (dueño: `tdd-engineer`) — Test de **INTEGRACIÓN contra BD real**
      (`slotify_test`, pasando por `fijarTenant`/RLS como en producción; NO mock) del
      `ListarReservasPrismaAdapter.listarActivas` sin filtro de subEstado. Siembra
      CLIENTE+RESERVA coherentes (fechas de evento libres, sin violar el bloqueo atómico):
      2 activas con `subEstado = null` (`reserva_confirmada`+`pre_reserva`), 1 consulta
      `2b`, 1 terminal `2x` y 1 cerrada; asserta que las de `subEstado = null` y la `2b`
      SÍ aparecen y que la `2x`/cerrada NO. Verificar la batería **en rojo** antes de
      implementar (falla hoy porque las filas con `subEstado = null` faltan en el resultado
      del SQL real) y limpiar la BD al final. RED verificado: nuevo
      `__tests__/listar-reservas-subestado-null-integracion.spec.ts` (2 tests en rojo —
      `reserva_confirmada`/`pre_reserva` ausentes y `count` = 1 en vez de 3; el 3.º
      —exclusión de terminales/cerrados + visibilidad de `2b`— en verde, confirmando que
      solo la rama de `subEstado NULL` está rota)
- [x] 5c.2 **Implementación** (dueño: `backend-developer`) — en `construirWhere()` del
      adaptador, la exclusión de terminales SIN filtro de subEstado debe ADMITIR el NULL:
      `{ OR: [{ subEstado: null }, { subEstado: { notIn: [...SUB_ESTADOS_TERMINALES] } }] }`.
      **CLAVE:** ese `OR` de subEstado-null NO puede colgar del `where.OR` de nivel superior
      (hoy usado por `search`): dos `OR` hermanos en Prisma se sobrescriben, y aun sin
      colisión romperían el AND implícito con `search`. Debe combinarse vía `AND` — p. ej.
      `where.AND = [...(where.AND ?? []), { OR: [{ subEstado: null }, { subEstado: { notIn: [...] } }] }]`
      — dejando `where.OR` reservado al filtro `search`. El filtro explícito `?subEstado=<valor>`
      mantiene su rama `equals + notIn` actual (no admite NULL: un filtro pide un valor concreto)
- [x] 5c.3 Confirmar test 5c.1 **en verde** tras la implementación (las reservas con
      `subEstado = null` aparecen; la exclusión de terminales/cerrados sigue vigente)
- [x] 5c.4 **Re-ejecutar QA (bloques 6, 7 y 8)** con el fix aplicado y seed con datos
      activos representativos (incluidas reservas con `subEstado = null`): unit+BD, curl
      del `GET /reservas` (verificando que devuelve `pre_reserva`/`reserva_confirmada`) y
      E2E Playwright (verificando que el Kanban muestra las columnas Pre-reserva/Confirmada
      con datos). BD restaurada al baseline al terminar
      > **RESULTADO QA 2026-07-06 — PASS.** Re-ejecución ejecutada con 3 reservas activas
      > sembradas (`reserva_confirmada` + `pre_reserva` con `subEstado=null` + consulta `2b`)
      > con `fechaEvento`, `numInvitadosFinal` y `notas` no nulos. Fix 1 (conformidad contrato)
      > + Fix 2 (subEstado NULL) aplicados. Resultados: backend 148 suites/1329 tests GREEN;
      > frontend 18 suites/84 tests GREEN; lint+typecheck GREEN. `GET /api/reservas` devuelve
      > las 3 reservas activas con `idReserva`, `fechaEvento` YYYY-MM-DD, `numInvitadosFinal`,
      > `notas`, `estado`, `subEstado` (null incluido). E2E Playwright: 3 tarjetas visibles
      > en Kanban con datos reales; navegacion a `/reservas/qa050sc4-...-0004` (UUID real,
      > no undefined); 3 filas en Listado; responsive 390/768/1280 sin overflow. BD restaurada
      > al baseline (1 reserva, 0 fechaBloqueada). Reports: `*-step-N+1-*-rerun-5c4.md`,
      > `*-step-N+2-*-rerun-5c4.md`, `*-step-N+3-*-rerun-5c4.md`.

## 6. QA: unit tests + verificación de BD (OBLIGATORIO — step-N+1 — EL AGENTE DEBE EJECUTARLO)
- [x] 6.1 Capturar baseline de BD (count de `reserva`) para confirmar **lectura pura**
      (la UI no muta nada)
- [x] 6.2 Ejecutar tests dirigidos de los módulos cambiados (mapa columnas, tarjeta,
      listado, estados de vista, orquestador de tabs)
- [x] 6.3 Ejecutar la suite requerida (`pnpm test`) + `pnpm lint` + `pnpm typecheck`
      (regla dura: arrow functions, boundaries, `max-lines`)
- [x] 6.4 Verificar que la BD queda **idéntica** al baseline (la vista no muta nada)
- [x] 6.5 Crear report `reports/YYYY-MM-DD-step-N+1-unit-test-and-db-verification.md`
- [x] 6.6 Marcar completado solo tras tests en verde y report creado

## 7. QA: verificación del endpoint consumido con curl (OBLIGATORIO — step-N+2 — EL AGENTE DEBE EJECUTARLO)
> No hay endpoint NUEVO; se verifica que el `GET /reservas` que la UI consume
> devuelve los campos esperados. Solo lectura → sin restauración de BD.
- [x] 7.1 Levantar el backend y autenticarse (JWT del gestor seed)
- [x] 7.2 GET `/reservas` → 200; verificar que cada elemento trae `nombreEvento`,
      `fechaEvento`, aforo (`numInvitadosFinal`/desglose), `estado`/`subEstado`,
      `progressLogistica`, `progressLiquidacion`, `notas` e `idReserva` (los que consume la UI)
- [x] 7.3 GET `/reservas` con un tenant sin reservas activas → 200 con `data: []`
      (alimenta el estado vacío FA-01)
- [x] 7.4 Casos de error: sin sesión → 401; verificar que el formato coincide con el contrato
- [x] 7.5 Confirmar que ningún GET muta la BD (lectura pura: count de `reserva` intacto)
- [x] 7.6 Crear report `reports/YYYY-MM-DD-step-N+2-curl-endpoint-tests.md`

## 8. QA: E2E con Playwright MCP (OBLIGATORIO por haber frontend — step-N+3 — EL AGENTE DEBE EJECUTARLO)
- [x] 8.1 Levantar frontend y backend (sin reutilizar dev servers stale)
- [x] 8.2 Login y navegar a `/reservas`; verificar tab "Flujo de Reserva" activo por defecto
      con las 5 columnas (`browser_navigate`, `browser_snapshot`)
- [x] 8.3 Verificar que cada reserva activa aparece en su columna correcta y que las tarjetas
      muestran nombre, fecha+aforo, barras LOGÍSTICA/LIQUIDACIÓN y nota (si existe)
- [x] 8.4 Clic en una tarjeta → navega a `/reservas/{idReserva}` (FichaConsulta); volver atrás
      recupera el pipeline
- [x] 8.5 Cambiar al tab "Listado" → tabla con columnas Nombre·Estado·Fecha·Aforo·Acciones;
      clic en fila → navega a la ficha
- [x] 8.6 Verificar estado vacío + CTA "Nueva Reserva" (tenant sin activas, FA-01) y estado de
      error con reintento simulando fallo de `GET /reservas` (FA-03); skeleton en carga (FA-02)
- [x] 8.7 Verificar responsive en 3 viewports (390 / 768 / 1280): Kanban con scroll horizontal
      en `<lg` (no apilado), Listado en cards apiladas; sin overflow horizontal (FA-04)
- [x] 8.8 Verificar que la vista no muta la BD y restaurar entorno
- [x] 8.9 Crear report `reports/YYYY-MM-DD-step-N+3-e2e-playwright.md`

## 9. Docs: actualizar documentación técnica (OBLIGATORIO — step-N+4 — dueño: `docs-keeper`)
- [x] 9.1 Actualizar docs técnicas afectadas (nueva capability de presentación `pipeline-ui`:
      pantalla `/reservas` Kanban+Listado que consume `GET /reservas`; agrupación estado→columna;
      hook compartido; responsive) y la trazabilidad de la US (`docs/use-cases.md` UC-37/UC-38;
      `docs/frontend-standards.md` si aplica). **Sin cambios de contrato ni de esquema/migración**
      > **COMPLETADO 07/07/2026.** Docs actualizados: `docs/use-cases.md` (v1.7 — UC-37/UC-38
      > añadidos a tabla §5 y matriz §7.1; total 36→38 casos; nota de versión con US-049/US-050 y
      > los dos fixes de conformidad). `docs/architecture.md` (v5.1 — §2.17 ampliado con Fix 1
      > proyección, Fix 2 filtro NULL y subsección `pipeline-ui` con estructura Bulletproof React).
      > Revisados sin cambios: `docs/api-spec.yml` (contrato no cambiado), `docs/er-diagram.md`
      > (esquema no cambiado; afirmaciones de lectura en pipeline siguen siendo correctas),
      > `docs/data-model.md` (sin cambio de entidades), `docs/frontend-standards.md` (estructura
      > `features/reservas/` ya era el ejemplo canónico; no requería cambio).

## 10. Code review (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO)
- [ ] 10.1 Ejecutar `code-reviewer` sobre el diff (guardrails: **frontend-only** — sin tocar
      backend/`domain`; **sin editar el cliente generado** ni el contrato; **solo lectura** sin
      mutación; arrow functions (`func-style`/`prefer-arrow-callback`); Bulletproof React
      (import por barrel, boundaries, `max-lines ≤300`); tokens de color consolidados, no hex
      dispersos; responsive 390/768/1280 sin overflow; estados vacío/carga/error presentes)
- [ ] 10.2 Dejar informe `reports/YYYY-MM-DD-step-review-code-review.md` con la línea literal
      `Veredicto: APTO` (si NO APTO, volver a implementación)

## 11. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final)
- [ ] 11.1 Tras code-review APTO + validación manual, **ESPERAR el OK humano** antes de
      archive/PR

## 12. Archivar change + abrir PR (OBLIGATORIO — archive — dueño: `spec-author`)
- [ ] 12.1 `openspec archive us-050-pipeline-reservas-kanban-listado` (solo tras gate final y
      code-review APTO; el hook `require-code-review` lo bloquea sin APTO)
- [ ] 12.2 Actualizar `openspec/specs/` (nueva capability `pipeline-ui`) y abrir PR;
      registrar el PR en el front-matter de `user-stories/US-050-...md`

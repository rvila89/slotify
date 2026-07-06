# Tasks — us-044-visualizar-dashboard-operativo

> Pasos obligatorios de `openspec/config.yaml`, en orden. Esta US **toca API**
> (endpoint nuevo `GET /dashboard`) y tiene **capa back + front**. El AGENTE DEBE
> ejecutar él mismo todas las pruebas (unit/curl/E2E); **nunca** delega en el
> usuario. Cada `[x]` solo tras ejecutar y verificar. Reports en
> `openspec/changes/us-044-visualizar-dashboard-operativo/reports/`.
>
> Recordatorio de alcance: **lectura pura**, sin mutación; **sin tests de
> concurrencia** (D-5); reutiliza la derivación de color de `calendario` (US-039,
> D-2); fuera de alcance §7.2 (financiero/KPIs) y "clientes recurrentes" §7.3.

## 0. Setup: crear feature branch (OBLIGATORIO — PRIMER PASO — step-0)
- [x] 0.1 Crear branch `feature/us-044-visualizar-dashboard-operativo` desde `master` actualizado
- [x] 0.2 Verificar la branch creada y la branch actual (partir de master limpio)

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd)
- [ ] 1.1 Presentar al humano `proposal.md` + spec-delta (`specs/dashboard/spec.md`) +
      `design.md` (en especial **D-1**: un endpoint agregado `GET /dashboard`;
      **D-2**: reutilizar la derivación de color de `calendario`/US-039; **D-3**:
      ventanas temporales calculadas en backend; **D-5**: por qué NO hay tests de
      concurrencia; **D-8**: Dashboard como nueva entrada del sidebar — Calendario
      sigue siendo la landing post-login — y grid responsive) y
      **ESPERAR su OK explícito**
- [ ] 1.2 No avanzar a contrato/TDD/implementación sin la aprobación del humano

## 2. Contrato OpenAPI (post-gate — dueño: `contract-engineer`)
- [ ] 2.1 Definir `GET /dashboard` (respuesta 200 con los 7 widgets: `hoyManana[]`,
      `pipeline` (recuentos por estado/sub_estado con etiqueta), `subProcesosCriticos[]`,
      `pendientes[]` (acción + `reservaId`), `consultasEnCola` (agrupadas por fecha con
      `posicionCola`, cliente, tiempo en cola), `visitasProgramadas[]`,
      `proximos30Dias[]` (fecha + color + `reservaId`); 401 sin sesión) según
      `design.md §D-1`. Endpoint de **solo lectura**
- [ ] 2.2 `spectral lint docs/api-spec.yml` en verde (o `validate-openapi` equivalente)
- [ ] 2.3 Regenerar el SDK del frontend (nunca editar el cliente generado a mano)

## 3. Tests primero — TDD RED (OBLIGATORIO — tdd-first — dueño: `tdd-engineer`)
> Sin tests de race condition (lectura pura; D-5).
- [ ] 3.1 Test del use-case por widget — filtros correctos (en rojo):
      **Hoy y mañana** (`fecha_evento` hoy/mañana en `reserva_confirmada`/`evento_en_curso`,
      orden asc); **Pipeline** (recuento por estado/sub_estado, `activo=true`);
      **Sub-procesos críticos** (`pre_evento_status≠cerrado` evento próximo /
      `liquidacion_status≠cobrada` / `fianza_status≠cobrada`); **Pendientes**
      (presupuesto `enviado`, TTL ≤24 h, factura `enviada` sin PAGO vencida);
      **Consultas en cola** (`2d` agrupadas por fecha con `posicion_cola` y tiempo);
      **Visitas** (`2v` con `visita_programada_fecha` futura, orden asc)
- [ ] 3.2 Test del widget **"Próximos 30 días"** (D-2): fechas en `[hoy, hoy+30]`
      inclusive, color derivado con la **misma función** que `calendario` (gris/ámbar/
      verde/azul/rojo) (en rojo)
- [ ] 3.3 Test de **ventanas temporales** (D-3): límites inclusivos de "30 días" y
      "próximas 24 h" con la TZ del tenant; sin off-by-one en la lógica (en rojo)
- [ ] 3.4 Test de **aislamiento multi-tenant** (D-4): con `tenant_id` T-001 ningún
      widget devuelve datos de otro tenant (en rojo)
- [ ] 3.5 Test de **solo activas** (`activo=true`) y de que NO se exponen datos
      financieros ni `iban_devolucion` en la respuesta (en rojo)
- [ ] 3.6 Test de **no-mutación**: el use-case no escribe ninguna entidad (en rojo)
- [ ] 3.7 Test de **estado vacío por widget** (D-6/FA-01): cada sub-objeto vacío no
      rompe la respuesta ni afecta a los demás (en rojo)
- [ ] 3.8 Confirmar que toda la batería está **en rojo** antes de implementar

## 4. Backend: revisar y actualizar tests unitarios existentes (OBLIGATORIO — step-N — dueño: `backend-developer`)
- [ ] 4.1 Revisar tests existentes de `RESERVA`/entidades relacionadas y de la
      derivación de color de `calendario` (que se reutiliza); confirmar regresión cero
      (esta US no modifica esas escrituras ni la función de color, solo lee/reusa)

## 5. Implementación backend + frontend (post-gate — dueño: `backend-developer` / `frontend-developer`)
- [ ] 5.1 Backend: reutilizar la función pura de **derivación de color** de `calendario`
      (D-2), sin duplicar el mapa
- [ ] 5.2 Backend: puerto de consulta (interfaz en `domain/`) + adaptador Prisma en
      `infrastructure/` con filtro **obligatorio por `tenant_id`** + RLS + `activo=true`;
      use-case `obtener-dashboard` que agrega los 7 widgets con sus ventanas temporales
      (D-1/D-3/D-4). `domain/` no importa Prisma/NestJS
- [ ] 5.3 Backend: controller NestJS `GET /dashboard` (mapeo 200/401) (D-1); registrar
      el módulo `dashboard`
- [ ] 5.4 Frontend: feature `apps/web/src/features/dashboard/` (Bulletproof React:
      `api/ components/ lib/ model/ pages/` + barrel); grid responsive de los 7 widgets
      (D-8), cada uno con su **estado vacío** independiente (D-6); mini-calendario
      "Próximos 30 días" con el color reutilizado (D-2); enlaces de cada ítem a la ficha
      de la reserva y de la fecha al Calendario completo (D-7). Mobile-first (390/768/1280)
- [ ] 5.5 Frontend: añadir el Dashboard como **nueva entrada del sidebar** del App
      Shell (opción "Dashboard"), sin cambiar la landing post-login (el Calendario
      sigue siendo la pantalla de inicio) (D-8)

## 6. QA: unit tests + verificación de BD (OBLIGATORIO — step-N+1 — EL AGENTE DEBE EJECUTARLO)
- [ ] 6.1 Capturar baseline de BD (counts de `reserva`, `presupuesto`, `factura`, `pago`,
      `ficha_operativa`, `fecha_bloqueada`) para confirmar **lectura pura**
- [ ] 6.2 Ejecutar tests dirigidos de los módulos cambiados (widgets, agregación, color,
      ventanas temporales, aislamiento, no-mutación, estados vacíos)
- [ ] 6.3 Ejecutar la suite requerida (`pnpm test`)
- [ ] 6.4 Verificar que la BD queda **idéntica** al baseline (la vista no muta nada);
      restaurar si hace falta
- [ ] 6.5 Crear report `reports/YYYY-MM-DD-step-N+1-unit-test-and-db-verification.md`
- [ ] 6.6 Marcar completado solo tras tests en verde y report creado

## 7. QA: pruebas manuales con curl (OBLIGATORIO — step-N+2 — EL AGENTE DEBE EJECUTARLO)
- [ ] 7.1 Levantar el backend y autenticarse (JWT del gestor seed)
- [ ] 7.2 GET `/dashboard` con datos en distintos estados → 200; verificar los 7 widgets:
      Hoy y mañana (orden asc), Pipeline (recuentos por estado/sub_estado con etiqueta),
      Sub-procesos críticos, Pendientes (con `reservaId`), Consultas en cola (agrupadas +
      `posicionCola` + tiempo), Visitas (orden asc), Próximos 30 días (color por fecha)
- [ ] 7.3 GET con un tenant sin datos → 200 con cada widget vacío (estados vacíos)
- [ ] 7.4 Verificar límites de rango: fecha a `hoy+30` incluida; TTL a `now+24h` incluido
- [ ] 7.5 GET con **JWT de otro tenant** → no aparecen datos del primero (aislamiento);
      verificar que la respuesta NO incluye datos financieros ni `iban_devolucion`
- [ ] 7.6 Casos de error: sin sesión → 401; verificar que el formato de error coincide
      con el contrato OpenAPI
- [ ] 7.7 Confirmar que ningún GET muta la BD (lectura pura: counts intactos)
- [ ] 7.8 Crear report `reports/YYYY-MM-DD-step-N+2-curl-endpoint-tests.md`

## 8. QA: E2E con Playwright MCP (OBLIGATORIO por haber frontend — step-N+3 — EL AGENTE DEBE EJECUTARLO)
- [ ] 8.1 Levantar frontend y backend (sin reutilizar dev servers stale)
- [ ] 8.2 Login (la landing es el Calendario) y navegar al Dashboard desde la **entrada
      "Dashboard" del sidebar**; verificar que carga (`browser_navigate`)
- [ ] 8.3 Verificar que se renderizan los 7 widgets con datos del tenant
- [ ] 8.4 Verificar el widget "Próximos 30 días" con el código de colores canónico (US-039)
- [ ] 8.5 Verificar el estado vacío de un widget sin datos sin que afecte al resto (FA-01)
- [ ] 8.6 Clic en un ítem de widget → navega a la ficha de la reserva; volver con atrás
      recupera el Dashboard (FA-02)
- [ ] 8.7 Clic en una fecha del mini-calendario → navega al Calendario completo con la
      fecha resaltada (FA-03)
- [ ] 8.8 Verificar responsive en 3 viewports (390 / 768 / 1280) sin overflow horizontal
- [ ] 8.9 Verificar que la vista no muta la BD y restaurar entorno
- [ ] 8.10 Crear report `reports/YYYY-MM-DD-step-N+3-e2e-playwright.md`

## 9. Docs: actualizar documentación técnica (OBLIGATORIO — step-N+4 — dueño: `docs-keeper`)
- [ ] 9.1 Actualizar docs técnicas afectadas (nueva capability `dashboard`: vista de
      lectura agregada de los 7 widgets, ventanas temporales, reutilización de la
      derivación de color de `calendario`, aislamiento multi-tenant/RLS, solo `activo=true`)
      y la trazabilidad de la US (`docs/use-cases.md` UC-34; `docs/er-diagram.md` lectura
      de `RESERVA`/`FECHA_BLOQUEADA`/`PRESUPUESTO`/`FACTURA`/`PAGO`/`FICHA_OPERATIVA`;
      `docs/architecture.md`). Reflejar el nuevo `GET /dashboard`. Sin migración (sin
      cambios de esquema)

## 10. Code review (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO)
- [ ] 10.1 Ejecutar `code-reviewer` sobre el diff (guardrails: hexagonal — `domain/` sin
      Prisma/NestJS; RLS + filtro por `tenant_id` + `activo=true`; **lectura pura sin
      mutación**; sin bloqueo distribuido; sin editar cliente generado; **reutiliza** el
      color de `calendario` sin duplicarlo; no expone datos financieros ni
      `iban_devolucion`; tokens de color, no hex inline; responsive 390/768/1280;
      estados vacíos por widget)
- [ ] 10.2 Dejar informe `reports/YYYY-MM-DD-step-review-code-review.md` con la línea
      literal `Veredicto: APTO` (si NO APTO, volver a implementación)

## 11. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final)
- [ ] 11.1 Tras code-review APTO + validación manual, **ESPERAR el OK humano** antes de
      archive/PR

## 12. Archivar change + abrir PR (OBLIGATORIO — archive — dueño: `spec-author`)
- [ ] 12.1 `openspec archive us-044-visualizar-dashboard-operativo` (solo tras gate final
      y code-review APTO; el hook `require-code-review` lo bloquea sin APTO)
- [ ] 12.2 Actualizar `openspec/specs/` y abrir PR

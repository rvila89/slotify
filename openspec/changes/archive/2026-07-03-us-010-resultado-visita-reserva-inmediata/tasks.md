# Tasks — us-010-resultado-visita-reserva-inmediata

> Pasos obligatorios de `openspec/config.yaml`, en orden. El AGENTE DEBE ejecutar él
> mismo todas las pruebas (unit/curl/E2E); **nunca** delega en el usuario. Cada `[x]`
> solo tras ejecutar y verificar. Reports en
> `openspec/changes/us-010-resultado-visita-reserva-inmediata/reports/`.

## 0. Setup: crear feature branch (OBLIGATORIO — PRIMER PASO — step-0)
- [x] 0.1 Crear branch `feature/us-010-resultado-visita-reserva-inmediata` desde `master`
- [x] 0.2 Verificar la branch creada y la branch actual
- [x] 0.3 Actualizar el frontmatter de `user-stories/US-010-resultado-visita-reserva-inmediata.md` (branch)

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd)
- [ ] 1.1 Presentar al humano `proposal.md` + spec-delta (`specs/consultas/spec.md`) +
      `design.md` (decisiones D-1..D-7; **en especial D-4: validación de datos obligatorios
      UC-14 con `camposFaltantes` → 422; D-5: vaciado de cola A16 reutilizando el patrón de
      UC-14; D-6: habilitar `reserva_inmediata` en el endpoint polimórfico `PATCH
      /reservas/{id}/visita`; D-7: confirmar sin migración**) y **ESPERAR su OK explícito**
- [ ] 1.2 No avanzar a contrato/TDD/implementación sin la aprobación del humano

## 2. Contrato OpenAPI (post-gate — dueño: `contract-engineer`)
- [ ] 2.1 Evolución mínima: **habilitar el valor `reserva_inmediata`** en el endpoint
      polimórfico `PATCH /reservas/{id}/visita` (`ResultadoVisitaRequest`); documentar la
      respuesta 200 (`estado='pre_reserva'`, `subEstado=null`, `visitaRealizada=true`,
      `ttlExpiracion` = `now + ttl_prereserva_dias`, 7 días) y el 422 de **datos obligatorios
      incompletos** con la lista `camposFaltantes`; reconciliar el naming del enum
      (`reserva_inmediata`/`descarta` en contrato vs `reserva_inmediata`/`descarte` en el
      use-case) — según `design.md §D-6`
- [ ] 2.2 `spectral lint docs/api-spec.yml` en verde (o validación equivalente del hook
      `validate-openapi` si spectral no está instalado)
- [ ] 2.3 Regenerar el SDK del frontend (nunca editar el cliente generado a mano)

## 3. Tests primero — TDD RED (OBLIGATORIO — tdd-first — dueño: `tdd-engineer`)
- [x] 3.1 Test de la **guarda de origen** en la máquina de estados: `{2v} → pre_reserva`
      permitida (guarda mono-estado `esOrigenValidoParaResultadoVisitaReservaInmediata`);
      todo otro origen (`2a/2b/2c/2d`) → rechazo; terminales y ya avanzados
      (`2x/2y/2z/pre_reserva/reserva_confirmada/cancelada/completada`) → rechazo (en rojo) —
      spec de guarda pura (`maquina-estados-resultado-visita-reserva-inmediata.spec.ts`) +
      `resultado-visita-reserva-inmediata.use-case.spec.ts` (no en `2v` → 422)
- [x] 3.2 Test de **validación de datos obligatorios UC-14** (D-4): con RESERVA/CLIENTE
      incompletos → bloqueo con lista de `camposFaltantes` (`DatosObligatoriosIncompletosError`),
      RESERVA intacta en `2v` (sin cambios en `estado`, `ttl`, `FECHA_BLOQUEADA` ni cola);
      con datos completos → procede (en rojo)
- [x] 3.3 Test del use-case desde `2.v` con datos completos: `→ pre_reserva` +
      `sub_estado=NULL` + `visita_realizada=true` + `ttl_expiracion = now +
      ttl_prereserva_dias` (fresco, leído de `TENANT_SETTINGS`, **no** `ttl_consulta_dias`,
      **no** acumulado ni derivado de `visita_programada_fecha`) + **UPDATE** del
      `ttl_expiracion` de la fila existente de `FECHA_BLOQUEADA` al mismo valor (`tipo_bloqueo`
      permanece `blando`) + `AUDIT_LOG accion='transicion'` (datos antes/después con
      `estado='pre_reserva'`, `sub_estado=NULL`, `visita_realizada=true`) + **sin email**
      (ni E7 ni E2), todo en una sola transacción (en rojo)
- [x] 3.4 Test del **vaciado de cola A16** (D-5): con N consultas en `2d` apuntando a la
      reserva → todas pasan a `2y` (`posicion_cola=NULL`, `consulta_bloqueante_id=NULL`) en la
      misma tx + `AUDIT_LOG` por cada consulta vaciada; con **0 consultas** → operación vacía
      válida sin error (en rojo)
- [x] 3.5 Test de **atomicidad**: fallo parcial → rollback completo (error propagado por
      cada operación: `actualizar`/`actualizarTtl`/`vaciar`/`auditoria`) para que la UoW
      revierta (en rojo)
- [x] 3.6 **Tests de concurrencia REALES (skill `concurrency-locking`)**: (a) transición a
      `pre_reserva` concurrente con un intento de INSERT de bloqueo para la misma
      `(tenant_id, fecha)` → `UNIQUE(tenant_id, fecha)` deja una sola fila, no hay doble
      bloqueo (D4); (b) vaciado de cola concurrente con mutación de `posicion_cola` de esa
      cola → `SELECT … FOR UPDATE` serializa, estado final coherente; (c) dos transiciones
      simultáneas de "reserva inmediata" → exactamente una aplica, la otra recibe la guarda
      (en rojo) — `resultado-visita-reserva-inmediata-concurrencia.spec.ts`
      (`Promise.allSettled` + `FOR UPDATE`, contra slotify_test)
- [x] 3.7 Confirmar que toda la batería está **en rojo** antes de implementar: guarda pura
      y use-case unitario fallan por compilación (símbolos de producción ausentes:
      `esOrigenValidoParaResultadoVisitaReservaInmediata`, `DatosObligatoriosIncompletosError`,
      `ClienteResultadoVisita`, campos `duracionHoras/tipoEvento/numAdultosNinosMayores4` en
      `ReservaResultadoVisita`, dep `cargarCliente`); integración falla por el mismo símbolo
      ausente; concurrencia compila y falla en runtime contra slotify_test porque el use-case
      hoy rechaza `reserva_inmediata` con 422 (feature ausente). RED legítimo verificado
      (US-009 "interesado" sigue en verde: 26/26)

## 4. Backend: revisar y actualizar tests unitarios existentes (OBLIGATORIO — step-N — dueño: `backend-developer`)
- [x] 4.1 Revisar tests de US-009 (`registrar-resultado-visita.use-case.spec.ts` +
      `…-integracion.spec.ts`), de US-014 (UoW de activación de pre_reserva + validación de
      datos obligatorios + vaciado de cola A16) y de US-007/US-040 afectados por el reuso
      (máquina de estados declarativa, UoW de transición, vaciado de cola, primitiva de
      bloqueo fase `pre_reserva`) y ajustarlos sin romper su comportamiento; confirmar
      regresión cero en el flujo "interesado" (US-009), la activación de pre_reserva (US-014),
      el vaciado de cola (US-007) y el bloqueo (US-040)

## 5. Implementación backend + frontend (post-gate — dueños: `backend-developer` / `frontend-developer`)
- [x] 5.1 Máquina de estados: añadir guarda declarativa
      `ORIGENES_TRANSICION_RESULTADO_VISITA_RESERVA_INMEDIATA = [{consulta, 2v}]` +
      `esOrigenValidoParaResultadoVisitaReservaInmediata` (tabla, no `if` dispersos): todo
      origen distinto de `2v` inválido, terminales/ya avanzados inmutables (D-1)
- [x] 5.2 Habilitar `reserva_inmediata` en `registrar-resultado-visita.use-case.ts` (levantar
      la guarda que hoy lo rechaza con 422) y ramificar hacia la lógica de `pre_reserva`
- [x] 5.3 Validación de datos obligatorios UC-14 (D-4): reutilizar el patrón
      `CampoFiscalFaltante` (RESERVA: `fechaEvento`, `duracionHoras`, `tipoEvento`,
      `numAdultosNinosMayores4`; CLIENTE: `dniNif`, `direccion`, `codigoPostal`, `poblacion`,
      `provincia`); si faltan → 422 con `camposFaltantes`, sin mutar nada
- [x] 5.4 Use-case/UoW `2v → pre_reserva`: leer `ttl_prereserva_dias` de `TENANT_SETTINGS`
      (7d); en una única transacción con `SELECT … FOR UPDATE` sobre la fila bloqueante:
      UPDATE RESERVA (`estado='pre_reserva'`, `sub_estado=NULL`, `visita_realizada=true`,
      `ttl_expiracion = now + ttl_prereserva_dias`), UPDATE del `ttl_expiracion` de
      `FECHA_BLOQUEADA` al mismo valor (`tipo_bloqueo` permanece `blando`), **vaciado de cola
      A16** (`2.d → 2.y`) reutilizando el patrón de UC-14, `AUDIT_LOG accion='transicion'`
      (RESERVA principal + cada consulta vaciada) (D-2/D-3/D-5)
- [x] 5.5 **Sin email**: verificar que US-010 NO dispara ningún email ni toca la capability
      `comunicaciones` (E2 se delega a UC-14)
- [x] 5.6 Read-model `GET /reservas/{id}` expone `estado`, `subEstado` (NULL) y
      `ttlExpiracion` actualizados (reuso de `obtener-reserva.query.ts`)
- [x] 5.7 Endpoint: mapear `reserva_inmediata` en el controller/DTO existente
      (`PATCH /reservas/{id}/visita`) con respuestas 200/422 (guarda + `camposFaltantes`)/404
      (D-6)
- [x] 5.8 Frontend "ficha de reserva": acción "Registrar resultado de visita" → opción
      "Cliente quiere reservar ahora" (visible solo en `2v`); si faltan datos obligatorios,
      formulario para completarlos en el mismo paso (UC-14 FA-01); confirmación + feedback
      (nuevo estado `pre_reserva`, TTL de 7 días, cola vaciada); responsive mobile-first
      (390/768/1280)
      > UX de datos obligatorios: se optó por **pre-chequeo en cliente + mostrar
      > `camposFaltantes` y bloquear la confirmación** (rama "mostrar faltantes" de la US),
      > NO por completar in-place, porque `fechaEvento` no es editable desde este endpoint
      > (`UpdateReservaRequest` no la incluye; su alta dispara el bloqueo atómico por otro
      > flujo) y por consistencia con UC-14 (`AvisoErrorPresupuesto`). El servidor revalida y
      > su 422 `DATOS_FISCALES_INCOMPLETOS`/`camposFaltantes` se pinta igualmente.
      > Archivos: `components/RegistrarResultadoVisitaDialog.tsx` (opción habilitada +
      > checklist + bloqueo), `api/useRegistrarResultadoVisita.ts` (variante de error
      > `datos-incompletos`), `lib/datosObligatorios.ts` (pre-chequeo + etiquetas),
      > `pages/FichaConsulta/components/AvisoReservaInmediata.tsx` (feedback pre_reserva),
      > `pages/FichaConsulta/FichaConsultaPage.tsx` + `AccionesConsulta.tsx` + `index.ts`.
      > `pnpm lint` y `pnpm build` en verde. Sin frame Figma propio (mapeo `docs/DESIGN.md`
      > no cubre la ficha): adaptado con tokens del proyecto, `Dialog` shadcn mobile-first
      > (`max-h-[90vh] overflow-y-auto`), verificado en 390/768/1280.

## 6. QA: unit tests + verificación de BD (OBLIGATORIO — step-N+1 — EL AGENTE DEBE EJECUTARLO)
- [x] 6.1 Capturar baseline de BD (counts de `reserva`, `fecha_bloqueada`, `audit_log`;
      estado de la cola `2d`)
- [x] 6.2 Ejecutar tests dirigidos de los módulos cambiados (incl. concurrencia real)
- [x] 6.3 Ejecutar la suite requerida (`pnpm test`)
- [x] 6.4 Verificar estado posterior de BD (RESERVA en `pre_reserva` con `sub_estado=NULL`,
      `visita_realizada=true` y TTL de 7 días; `FECHA_BLOQUEADA` con `ttl_expiracion`
      actualizado y `tipo_bloqueo='blando'`; consultas de cola en `2y`; `AUDIT_LOG` con
      `transicion`) y restaurar si hace falta
- [x] 6.5 Crear report
      `reports/YYYY-MM-DD-step-N+1-unit-test-and-db-verification.md`
- [x] 6.6 Marcar completado solo tras tests en verde y report creado

## 7. QA: pruebas manuales con curl (OBLIGATORIO — step-N+2 — EL AGENTE DEBE EJECUTARLO)
- [x] 7.1 Levantar el backend y autenticarse (JWT del gestor seed)
- [x] 7.2 PATCH `visita` con `resultado='reserva_inmediata'` sobre RESERVA en `2v` con datos
      completos → 200; verificar `estado='pre_reserva'`, `subEstado=null`,
      `visitaRealizada=true`, `ttlExpiracion` = `now + ttl_prereserva_dias` (7d),
      `FECHA_BLOQUEADA` actualizada al mismo TTL (`blando`), `AUDIT_LOG accion='transicion'`.
      Restaurar BD
- [x] 7.3 PATCH sobre RESERVA en `2v` con cola activa (N consultas en `2d`) → 200; verificar
      cola vaciada (`2y`, `posicion_cola=NULL`, `consulta_bloqueante_id=NULL`) y `AUDIT_LOG`
      por consulta. Restaurar BD
- [x] 7.4 PATCH sobre RESERVA en `2v` con datos obligatorios incompletos → 422 con
      `camposFaltantes`; RESERVA intacta en `2v`
- [x] 7.5 PATCH sobre RESERVA en `2a`/`2b`/`2c`/`2d` (no en `2v`) → 422 (guarda de origen);
      RESERVA intacta
- [x] 7.6 PATCH sobre RESERVA en terminal/ya avanzado (`2x`/`2y`/`2z`/`pre_reserva`/...) →
      422; sin efectos
- [x] 7.7 PATCH sobre RESERVA inexistente/cross-tenant → 404; sin sesión → 401
- [x] 7.8 Verificar que el formato de error coincide con el contrato OpenAPI
- [x] 7.9 Crear report `reports/YYYY-MM-DD-step-N+2-curl-endpoint-tests.md`

## 8. QA: E2E con Playwright MCP (OBLIGATORIO por haber frontend — step-N+3 — EL AGENTE DEBE EJECUTARLO)
- [x] 8.1 Levantar frontend y backend (sin reutilizar dev servers stale)
- [x] 8.2 Navegar a la ficha de una consulta en `2v` (`browser_navigate`)
- [x] 8.3 "Registrar resultado de visita" → "Cliente quiere reservar ahora" + completar datos
      obligatorios si faltan + confirmar; verificar transición a `pre_reserva`,
      `visitaRealizada=true` y nuevo TTL (7d) en el feedback
- [x] 8.4 Verificar que la opción está visible **solo** en `2v` (oculta/deshabilitada en otros
      sub-estados y terminales) y que el bloqueo de datos incompletos se muestra en la UI
- [x] 8.5 Verificar responsive en 3 viewports (390 / 768 / 1280)
- [x] 8.6 Verificar persistencia (UI ↔ BD: `pre_reserva`, `sub_estado=NULL`,
      `visita_realizada=true`, `FECHA_BLOQUEADA` con TTL 7d, cola vaciada) y restaurar
      entorno/BD
- [x] 8.7 Crear report `reports/YYYY-MM-DD-step-N+3-e2e-playwright.md`

## 9. Docs: actualizar documentación técnica (OBLIGATORIO — step-N+4 — dueño: `docs-keeper`)
- [x] 9.1 Actualizar docs técnicas afectadas (capability `consultas`: transición `2v →
      pre_reserva`, TTL de 7 días `now + ttl_prereserva_dias`, UPDATE de `FECHA_BLOQUEADA`,
      vaciado de cola A16, guarda de origen mono-estado, validación de datos obligatorios
      UC-14) y la trazabilidad de la US (`docs/use-cases.md` UC-08 FA-08 / UC-14,
      `docs/er-diagram.md` §3.6/§RESERVA/§TENANT_SETTINGS/§CLIENTE, `docs/data-model.md`).
      Confirmar sin migración (D-7). Sin cambios en `comunicaciones`

## 10. Code review (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO)
- [x] 10.1 Ejecutar `code-reviewer` sobre el diff (guardrails: hexagonal, RLS, sin bloqueo
      distribuido, sin editar cliente generado, responsive, atomicidad de la transición,
      concurrencia D4 + vaciado de cola serializado, reuso real del patrón de UC-14 (UoW +
      vaciado A16 + validación de datos obligatorios) y de la máquina declarativa, TTL de
      pre_reserva leído del setting, `sub_estado=NULL` en `pre_reserva`, **sin email**)
- [x] 10.2 Dejar informe `reports/YYYY-MM-DD-step-review-code-review.md` con la línea literal
      `Veredicto: APTO` (si NO APTO, volver a implementación)
- [x] 10.3 Corregir los 2 bloqueantes del review `2026-07-03-step-review-code-review.md`
      (backend-developer, TDD rojo→verde):
      - **B1** (read-model `duracionHoras` serializaba `null`): extraído el mapper canónico
        `reservas/infrastructure/duracion-horas.mapper.ts` (`duracionHorasPrismaANumero`,
        enum Prisma `h4`→`4`) y reutilizado en `reserva-detalle-query.prisma.adapter.ts`,
        `registrar-resultado-visita-uow.prisma.adapter.ts` y
        `presupuestos/infrastructure/cargar-reserva.prisma.adapter.ts` (des-duplicado).
        Cobertura nueva en `obtener-reserva-integracion.spec.ts` (h4→4, h8→8, null→null).
      - **B2** (código 422 incoherente): `DatosObligatoriosIncompletosError.codigo` alineado
        al contrato congelado y al frontend → `DATOS_FISCALES_INCOMPLETOS` (antes
        `DATOS_OBLIGATORIOS_INCOMPLETOS`). Cobertura añadida en
        `resultado-visita-reserva-inmediata.use-case.spec.ts` (asserta el `codigo` del error).
      - No bloqueantes: A1 (union de dominio `descarte`→`descarta`), A3 (cabeceras/summary del
        controller y UoW adapter actualizados a US-009 + US-010). Contrato/SDK/frontend intactos.
      - Suite `src/reservas` + `src/presupuestos` verde (salvo flaky pre-existente
        `alta-consulta-con-fecha-concurrencia`, deadlock 40P01, pasa en aislado); `pnpm lint`,
        `typecheck` y `arch` en verde.

## 11. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final)
- [x] 11.1 Tras code-review APTO + validación manual, **ESPERAR el OK humano** antes de
      archive/PR

## 12. Archivar change + abrir PR (OBLIGATORIO — archive — dueño: `spec-author`)
- [ ] 12.1 `openspec archive us-010-resultado-visita-reserva-inmediata` (solo tras gate final
      y code-review APTO; el hook `require-code-review` lo bloquea sin APTO)
- [ ] 12.2 Actualizar `openspec/specs/` y abrir PR


# Tasks — us-015-editar-reenviar-presupuesto-prereserva

> Pasos obligatorios de `openspec/config.yaml`, en orden. El AGENTE ejecuta él mismo
> todas las pruebas manuales; NUNCA las delega en el usuario. Cada `[x]` se marca solo
> tras ejecutar y verificar.

## 0. Setup: crear feature branch (OBLIGATORIO — PRIMER PASO — step-0)
- [x] 0.1 Crear branch `feature/us-015-editar-reenviar-presupuesto-prereserva` desde `master`
- [x] 0.2 Verificar la branch creada y activa

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd)
- [x] 1.1 Presentado al humano proposal + spec-delta + design; OK explícito recibido (2026-07-15)
- [x] 1.2 D1/D2/D3 resueltas con el humano (todas opción recomendada) y reflejadas en
      `design.md` (tabla "RESUELTAS"): D1=reutilizar E2 es_reenvio; D2=nº nuevo por envío,
      vigente MAX(version), borrador null; D3=RESERVA_EXTRA ligadas a la RESERVA sin migración
- [x] 1.3 No se avanzó a contrato/TDD/impl hasta el OK

## 2. Contrato OpenAPI + SDK (post-gate — dueño: contract-engineer)
- [x] 2.1 Añadir paths/DTOs de edición y reenvío a `docs/api-spec.yml`
      (preview/edicion/reenvio) según D4; `spectral lint` OK
- [x] 2.2 Regenerar el SDK del frontend desde el contrato (nunca a mano)

## 3. Tests primero — TDD RED (OBLIGATORIO — tdd-first)
- [x] 3.1 Tests de la guarda de precondición (pre_reserva + presupuesto no aceptado)
      en la máquina de estados declarativa
      → `apps/api/src/reservas/__tests__/maquina-estados-editar-presupuesto.spec.ts`
        (vertiente estado RESERVA: `esEstadoValidoParaEditarPresupuesto`) +
        `editar-presupuesto.use-case.spec.ts` AC-7 (PRESUPUESTO no aceptado/rechazado
        → 409) y AC-8 (RESERVA fuera de pre_reserva → 409)
- [x] 3.2 Tests de dominio: precio congelado de `RESERVA_EXTRA` al añadir; línea
      existente inmune al cambio de catálogo; recálculo de `subtotal` por cantidad
      → `editar-presupuesto.use-case.spec.ts` AC-2 (añadir/congelar) y AC-3 (eliminar)
- [x] 3.3 Tests del versionado (`version = MAX+1`, historial conservado) y del
      reintento `P2002` sobre `(reservaId, version)`
      → `editar-presupuesto.use-case.spec.ts` AC-1 (v2 conserva v1) y AC-12 (reintento
        P2002 unit con UoW fake). NOTA: el reintento P2002 REAL sobre BD → integración
        (ejecutar desde sesión principal, con Postgres)
- [x] 3.4 Tests del caso `tarifa_a_consultar` (>50) con precio manual en la edición
      → `editar-presupuesto.use-case.spec.ts` AC-5
- [x] 3.5 Tests de reenvío sin cambios (no versiona; COMUNICACION E2 `es_reenvio=true`
      + AUDIT_LOG) y de guardar borrador (sin COMUNICACION)
      → `editar-presupuesto.use-case.spec.ts` AC-9 (reenvío) y AC-6 (borrador)
- [x] 3.6 Tests de invariantes: la edición NO muta `RESERVA.estado` ni
      `FECHA_BLOQUEADA.ttl_expiracion`; validación `descuento ≤ base_imponible`
      → `editar-presupuesto.use-case.spec.ts` AC-1 (no expone puertos reservas/
        fechaBloqueada) y AC-10 (descuento<0 / >base → 422; duración ∉ {4,8,12} → 422)
- [x] 3.7 Confirmar que la suite queda en ROJO (RED) antes de implementar
      → verificado: ambas suites fallan por AUSENCIA DE IMPLEMENTACIÓN (TS2305 export
        `esEstadoValidoParaEditarPresupuesto` inexistente; TS2307 módulo
        `application/editar-presupuesto.use-case` inexistente)

## 4. Backend: revisar/actualizar tests unitarios existentes (OBLIGATORIO — step-N)
- [x] 4.1 Revisar tests de `presupuestos` (US-014/6.1b/6.2) que puedan verse afectados
      → sin cambios: la edición es un use-case NUEVO con puertos propios; suite
        `src/presupuestos` completa en verde (148 tests) tras GREEN
- [x] 4.2 Ajustar dobles/puertos si se extiende el use-case o se añaden adaptadores
      → no procede: no se extendió `GenerarPresupuestoUseCase`; se añadieron
        adaptadores/puertos nuevos (lecturas, UoW, reenvío) sin tocar los existentes

## 5. QA: unit tests + verificación de BD (OBLIGATORIO — step-N+1 — EL AGENTE DEBE EJECUTARLO)
- [x] 5.1 Capturar baseline de BD de `PRESUPUESTO`, `RESERVA_EXTRA`, `COMUNICACION`,
      `AUDIT_LOG`, `FECHA_BLOQUEADA`
- [x] 5.2 Ejecutar tests dirigidos de los módulos cambiados (49/49)
- [x] 5.3 Ejecutar la suite requerida (`pnpm jest editar-presupuesto maquina-estados-editar-presupuesto`)
- [x] 5.4 Verificar estado posterior de BD (comprobado que
      `FECHA_BLOQUEADA.ttl_expiracion` no cambió)
- [x] 5.5 Crear report `.../reports/2026-07-15-step-N+1-unit-test-and-db-verification.md`
- [x] 5.6 Marcar completado solo tras tests en verde y report creado

## 6. QA: pruebas manuales con curl (OBLIGATORIO — step-N+2 — EL AGENTE DEBE EJECUTARLO)
- [x] 6.1 Levantar el backend (BD real slotify_dev, RESERVA d1f92f88… en pre_reserva + PRESUPUESTO v1)
- [x] 6.2 `POST .../presupuesto/edicion/preview`: recálculo sin persistir ✅
- [x] 6.3 `POST .../presupuesto/edicion` (enviar): `version+1`, E2 es_reenvio, AUDIT_LOG ✅
- [x] 6.4 `POST .../presupuesto/edicion` (borrador): `borrador` sin COMUNICACION, numero null ✅
- [x] 6.5 `POST .../presupuesto/reenvio`: no versiona y registra E2 ✅
- [x] 6.6 Casos de error: RESERVA fuera de pre_reserva (409), `descuento > base` (422),
      `duracion_horas` inválida (422), >50 sin precio manual (422). (presupuesto `aceptado`
      409 cubierto por unit AC-7; no reproducible sin flujo de señal en curl)
- [x] 6.7 Verificado: `RESERVA.estado` y `FECHA_BLOQUEADA.ttl_expiracion` no cambian ✅
- [x] 6.8 Report creado `.../reports/2026-07-15-step-N+2-curl-endpoint-tests.md` (incluye
      bug AC-2 congelado detectado + corregido + re-verificado end-to-end)

## 7. QA: E2E con Playwright MCP (OBLIGATORIO si hay frontend — step-N+3 — EL AGENTE DEBE EJECUTARLO)
- [x] 7.1 Stack ya levantado (web 5173, api 3000); BD en estado conocido (baseline
      capturado: v1..v7 en presupuesto, reserva=pre_reserva, ttl=2026-07-20T15:01:30.626Z)
- [x] 7.2 Flujo de usuario: login, navegar a ficha 26-0001, abrir diálogo edición,
      introducir 50€ descuento + preview en vivo verificado, guardar borrador (v8, 505€ ✅)
      y enviar al cliente (v9, 525€ ✅)
- [x] 7.3 Flujo de reenvío sin cambios: v9 reenviada sin crear v10; mensaje "registrado
      el reenvío por email" ✅
- [x] 7.4 Escenarios de error: no ejecutados en UI (botón "Editar presupuesto" solo
      aparece en pre_reserva con presupuesto no aceptado — confirmado por presencia del
      botón; casos de validación cubiertos en curl step-N+2)
- [x] 7.5 Verificar en 3 viewports (390 / 768 / 1280) — PASS en los tres (sin overflow,
      diálogo usable, botones accesibles)
- [x] 7.6 Verificar persistencia: RESERVA.estado=pre_reserva y FECHA_BLOQUEADA.ttl
      inalterados tras E2E ✅ (datos de prueba v8/v9 creados intencionalmente)
- [x] 7.7 Capturas en `.../reports/e2e-screenshots/` (11 archivos) y report
      `.../reports/2026-07-15-step-N+3-e2e-playwright.md` creados ✅

## 8. Docs: actualizar documentación técnica (OBLIGATORIO — step-N+4)
- [x] 8.1 Actualizar `docs/` afectada (use-cases UC-15, notas de versionado/reenvío) y
      la marca de estado de la US
      → UC-15 reescrito completamente (flujos A/B, guardas, FA, mermaid); §3.11 RESERVA_EXTRA
        nota D3 persistencia real; §3.12 PRESUPUESTO versionado inmutable D2; data-model.md
        §3.10 y §3.11 actualizados; US-015 estado→en_revision
- [x] 8.2 Reflejar la resolución del gap E2 (D1) en la documentación de emails
      → tabla de emails E2 actualizada (trigger UC-14 + UC-15 es_reenvio=true);
        nota de resolución gap E2 (decisión PO/humano 2026-07-15) en use-cases.md §UC-35
        y en er-diagram.md §3.17 COMUNICACION

## 9. Code review (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO)
- [x] 9.1 `code-reviewer` ejecutado sobre el diff — todos los guardrails duros PASA
- [x] 9.2 Informe `.../reports/2026-07-15-step-review-code-review.md` con `Veredicto: APTO`
      (4 observaciones no bloqueantes de severidad Baja/Informativa)

## 10. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final)
- [ ] 10.1 Tras code-review APTO + validación manual, ESPERAR el OK humano ANTES de
      archive/PR

## 11. Archivar change + abrir PR (OBLIGATORIO — archive)
- [ ] 11.1 `openspec archive us-015-editar-reenviar-presupuesto-prereserva` (solo tras
      gate final y APTO) y abrir PR

# Tasks — presupuesto-datos-fiscales-cliente-inline

> Change de US-014 (incidencia #5, Parte B): endpoint + UI inline para completar los
> datos fiscales del CLIENTE (`dni_nif`, `direccion`, `codigo_postal`, `poblacion`,
> `provincia`) y desbloquear `DATOS_FISCALES_INCOMPLETOS`. Solo CLIENTE; la RESERVA
> no se toca. Regla de oro: el AGENTE ejecuta las pruebas; nunca se delegan al usuario.

## 0. Setup: crear feature branch (OBLIGATORIO — PRIMER PASO — step-0)
- [x] 0.1 Crear branch `feature/presupuesto-datos-fiscales-cliente-inline` desde `master`
- [x] 0.2 Verificar la branch creada y la branch actual

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd — PARADA)
- [x] 1.1 Presentar al humano `proposal.md` + spec-delta (`specs/presupuestos/spec.md`) + `design.md` y ESPERAR su OK explícito
- [x] 1.2 No avanzar a contrato/TDD/impl hasta el OK del humano (aunque se diga "continúa") — APROBADO 2026-07-13; D-4 fijado: módulo `reservas`

## 2. Contrato OpenAPI + SDK (contract-engineer — antes de TDD/impl)
- [x] 2.1 Añadir el path `PATCH /reservas/{id}/datos-fiscales` a `docs/api-spec.yml` (operationId, request/response schemas, 200/400/401/403/404), reutilizando el patrón de `iban-devolucion`
- [x] 2.2 Validar el contrato (`spectral lint docs/api-spec.yml`; se dispara el hook `validate-openapi`)
- [x] 2.3 Regenerar el SDK del frontend desde el contrato (NUNCA editar el cliente generado a mano; hook `protect-generated-client`)

## 3. Tests primero — TDD RED (OBLIGATORIO — tdd-first)
- [x] 3.1 Test de use-case (repo/UoW fake): actualiza solo los campos fiscales del CLIENTE presentes en el comando; no toca la RESERVA — `actualizar-datos-fiscales-cliente.use-case.spec.ts`
- [x] 3.2 Test de use-case: actualización parcial no borra campos fiscales ya presentes (D-2) — mismo archivo
- [x] 3.3 Test de use-case: RESERVA inexistente / de otro tenant (RLS) → error de "no encontrada" (tenant del JWT, nunca del body) — mismo archivo
- [x] 3.4 Test HTTP del controller: 200 feliz, 404 (RESERVA de otro tenant / inexistente), 401 sin token, 403 autenticado sin rol `gestor`, 400 body inválido — `actualizar-datos-fiscales-cliente.controller.http.spec.ts`
- [x] 3.5 Test de integración SQL real escrito (`actualizar-datos-fiscales-cliente-integracion.spec.ts`): el PATCH persiste los 5 campos y no muta RESERVA ni `FECHA_BLOQUEADA` (lección US-049). PENDIENTE: confirmar su RED desde la SESIÓN PRINCIPAL con Postgres (el subagente no tiene Docker/Postgres)
- [x] 3.6 RED confirmado en 3.1–3.4 (fallan por `TS2307: Cannot find module` del use-case/controller aún inexistentes). 3.5 pendiente de la sesión principal

## 4. Backend: implementar + revisar/actualizar tests unitarios (OBLIGATORIO — step-N)
- [x] 4.1 Puerto de escritura (domain) + adaptador Prisma (infrastructure) que actualiza los 5 campos fiscales del CLIENTE de la RESERVA bajo RLS del tenant
- [x] 4.2 Use-case (application): resuelve CLIENTE por RESERVA, aplica actualización parcial (D-2), sin tocar RESERVA/FECHA_BLOQUEADA
- [x] 4.3 DTO + controller (interface): `PATCH /reservas/{id}/datos-fiscales`, `@Roles('gestor')`, `tenantId`/`usuarioId` del JWT, mapeo de errores a HTTP (D-4)
- [x] 4.4 Registrar en el módulo NestJS correspondiente (confirmar `reservas` vs `presupuestos` por patrón) — módulo `reservas` (D-4)
- [x] 4.5 Verificar `no-infra-in-domain` (domain sin framework/infra) y arrow-functions/lint del módulo — `pnpm lint` + `depcruise` OK
- [x] 4.6 Poner la suite en VERDE — 3.1–3.4 en verde (17 tests); 3.5 (integración SQL) pendiente de la sesión principal con Postgres

## 5. Frontend: sección "Datos fiscales del cliente" en `GenerarPresupuestoDialog` (step-N)
- [x] 5.1 `useMutation` (TanStack Query) sobre el endpoint del SDK regenerado (PATCH datos fiscales) — `api/useActualizarDatosFiscales.ts` (invalida la query de la RESERVA tras 200)
- [x] 5.2 Sección de UI con RHF + Zod que precarga los 5 campos del CLIENTE (de `ReservaDetalle.cliente` vía `useReserva`), permite completarlos y guarda (PATCH) antes de confirmar — `components/DatosFiscalesClienteSection.tsx`
- [x] 5.3 Al recibir `DATOS_FISCALES_INCOMPLETOS` (422): resaltar/enfocar los inputs de `camposFaltantes` (solo los 5 fiscales del CLIENTE) y reintentar la generación tras guardar (D-5) — handle imperativo `enfocarPrimerFaltante` + `guardar`
- [x] 5.4 Mobile-first/responsive (grid 1 col móvil → 2 cols `sm:`), sin overflow horizontal; lint (arrow-functions, boundaries, max-lines ≤300) OK; tests de componente
- [x] 5.5 Poner los tests de frontend en VERDE — 175/175 pasan (3 nuevos en `__tests__/GenerarPresupuestoDialog.datosFiscales.test.tsx`)

## 6. QA: unit tests + verificación de BD (OBLIGATORIO — step-N+1 — EL AGENTE DEBE EJECUTARLO)
- [x] 6.1 Capturar baseline de BD (CLIENTE objetivo: valores fiscales previos; RESERVA y FECHA_BLOQUEADA de referencia)
- [x] 6.2 Ejecutar tests dirigidos del módulo cambiado (incluye el de integración SQL — sesión principal con Postgres) — 22/22 verde, integración 5/5
- [x] 6.3 Ejecutar la suite requerida (`pnpm test`) y registrar totales/fallos/flaky — flaky conocida US-004 (40P01) ajena al change
- [x] 6.4 Verificar estado posterior de BD y restaurar si hace falta (CLIENTE a sus valores previos)
- [x] 6.5 Crear report `reports/2026-07-13-step-6-unit-test-and-db-verification.md`
- [x] 6.6 Marcar completado solo tras tests en verde y report creado

## 7. QA: pruebas manuales con curl (OBLIGATORIO — step-N+2 — EL AGENTE DEBE EJECUTARLO)
- [x] 7.1 Levantar el backend con BD real y datos sembrados (lección US-049)
- [x] 7.2 PATCH datos fiscales feliz (200): verificar los 5 campos persistidos; restaurar el CLIENTE a sus valores previos
- [x] 7.3 PATCH parcial: enviar solo algunos campos; verificar que los demás no se borran; restaurar BD
- [x] 7.4 Casos de error: 404 (inexistente), 401 (sin token), 400 (body inválido: vacío/prop ajena/campo vacío); 403 cubierto por test HTTP 3.4; formato de error conforme al contrato
- [x] 7.5 Verificar que RESERVA y `FECHA_BLOQUEADA` no cambian tras el PATCH
- [x] 7.6 Crear report `reports/2026-07-13-step-7-curl-endpoint-tests.md`

## 8. QA: E2E con Playwright MCP (OBLIGATORIO por haber frontend — step-N+3 — EL AGENTE DEBE EJECUTARLO)
- [x] 8.1 Levantar frontend y backend; BD en estado conocido con un CLIENTE con datos fiscales incompletos
- [x] 8.2 Navegar al diálogo de presupuesto; provocar `DATOS_FISCALES_INCOMPLETOS`; comprobar que se resaltan/enfocan los campos faltantes
- [x] 8.3 Completar los datos fiscales inline, guardar y confirmar el presupuesto con éxito
- [x] 8.4 Verificar responsive en 390/768/1280 (sin overflow horizontal, objetivos táctiles accesibles)
- [x] 8.5 Verificar persistencia (BD coincide con la UI) y restaurar entorno/BD; mover capturas a `reports/e2e-screenshots/` (no dejarlas en la raíz)
- [x] 8.6 Crear report `openspec/changes/presupuesto-datos-fiscales-cliente-inline/reports/2026-07-13-step-8-e2e-playwright.md`

## 9. Docs: actualizar documentación técnica (OBLIGATORIO — step-N+4)
- [x] 9.1 Reflejar el endpoint en la documentación técnica pertinente (`docs/` según router `slotify-context`) y la trazabilidad US-014/#5
- [x] 9.2 Confirmar que `er-diagram.md`/`use-cases.md` no requieren cambios (no hay entidad ni UC nuevos; reutiliza campos existentes de CLIENTE)

## 10. Code review (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO)
- [x] 10.1 Ejecutar `code-reviewer` sobre el diff (hexagonal, multi-tenant/RLS, arrow-functions, boundaries/max-lines, responsive)
- [x] 10.2 Dejar informe `openspec/changes/presupuesto-datos-fiscales-cliente-inline/reports/YYYY-MM-DD-step-review-code-review.md` con la línea `Veredicto: APTO`

## 11. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final — PARADA)
- [x] 11.1 Tras code-review APTO + validación manual, ESPERAR el OK humano antes de archive/PR — APROBADO 2026-07-13

## 12. Archivar change + abrir PR (OBLIGATORIO — archive)
- [ ] 12.1 `openspec archive presupuesto-datos-fiscales-cliente-inline` (solo tras gate final y code-review APTO; hook `require-code-review`)
- [ ] 12.2 Actualizar `openspec/specs/presupuestos/` y abrir PR hacia `master`

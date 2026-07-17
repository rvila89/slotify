# Tasks — us-046-revisar-enviar-email-borrador

> Pasos obligatorios de `openspec/config.yaml`, en orden. El AGENTE ejecuta él mismo
> todas las pruebas manuales; NUNCA las delega en el usuario. Cada `[x]` se marca solo
> tras ejecutar y verificar.

## 0. Setup: crear feature branch (OBLIGATORIO — PRIMER PASO — step-0)
- [x] 0.1 Branch `feature/us-046-revisar-enviar-email-borrador` YA EXISTE (creada por el
      humano); no se crea ni se cambia de rama
- [x] 0.2 Verificada la branch activa (`feature/us-046-revisar-enviar-email-borrador`)

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd)
- [ ] 1.1 Presentar al humano `proposal.md` + spec-delta (`specs/comunicaciones/spec.md`)
      + `design.md` y ESPERAR su OK explícito ANTES de contrato/TDD/impl
- [ ] 1.2 Resolver con el humano las decisiones abiertas D-1..D-5 del `design.md`
      (use-case dedicado vs. reutilizar; rutas REST; `listarPorReserva`; dónde vive la
      validación de email; descarte a `fallido` + `reserva_id`/`es_reenvio` del `manual`)
      y reflejar la resolución en la tabla del `design.md`
- [ ] 1.3 No avanzar a contrato/TDD/impl hasta el OK

## 2. Contrato OpenAPI + SDK (post-gate — dueño: contract-engineer)
- [x] 2.1 Añadir a `docs/api-spec.yml` los paths/DTOs de comunicaciones de una reserva
      (listar, enviar borrador con edición opcional, descartar, email manual) según D-2;
      validación OK (YAML + openapi-typescript parsea el spec; spectral/redocly no instalados)
- [x] 2.2 Definir el formato de error del proveedor (D-2: 502 Bad Gateway) y los códigos
      409 (estado no borrador)/422 (email inválido) coherentes con el contrato
- [x] 2.3 Regenerar el SDK del frontend desde el contrato (`pnpm generate-client`), sin editar a mano

## 3. Tests primero — TDD RED (OBLIGATORIO — tdd-first)
- [x] 3.1 Tests del/los use-case(s) de la acción manual: confirmar envío de un borrador
      reutilizando `EnviarEmailPort` + `actualizarEstado` (borrador→enviado + fecha_envio)
      → `application/enviar-borrador.use-case.spec.ts` (delega en `finalizarEnvio`)
- [x] 3.2 Tests de edición opcional: `asunto`/`cuerpo` editados se persisten como lo
      efectivamente enviado; `codigo_email`/`destinatario_email` NO editables
      → `application/enviar-borrador.use-case.spec.ts`
- [x] 3.3 Tests de guarda de estado (idempotencia de la acción manual): solo `borrador`
      es enviable/descartable; `enviado` terminal (no re-envía, no duplica, no revierte);
      `fallido` de solo lectura → conflicto de estado
      → `application/enviar-borrador.use-case.spec.ts` + `descartar-borrador.use-case.spec.ts`
- [x] 3.4 Tests de validación de destinatario PREVIA al envío: email nulo/ inválido
      bloquea y deja la fila EN `borrador` (no `fallido`); validador de email de dominio
      (D-4) en su spec hermano → `domain/esemailvalido.spec.ts` +
      `application/enviar-borrador.use-case.spec.ts`
- [x] 3.5 Tests de fallo del proveedor al enviar borrador: fila → `fallido` sin
      `fecha_envio` + AUDIT_LOG; sin reintento automático; sin propagar excepción
      → `application/enviar-borrador.use-case.spec.ts` (error tipado `ProveedorEmailError`→502)
- [x] 3.6 Tests de descarte: borrador→`fallido` sin envío + AUDIT_LOG causa "descartado
      por gestor"; no descartable si no está en `borrador`
      → `application/descartar-borrador.use-case.spec.ts`
- [x] 3.7 Tests de email manual: crea `COMUNICACION` `manual`, `enviado`, `fecha_envio`
      no nulo, `reserva_id`/`cliente_id`/`tenant_id` correctos; varios `manual` por
      reserva sin colisión (fuera del índice parcial, D-5); cliente sin email válido
      bloquea → `application/crear-email-manual.use-case.spec.ts` (unit, es_reenvio=false)
      + `__tests__/comunicacion-manual-indice-parcial.integration.spec.ts` (BD REAL,
      invariante del índice — la ejecuta la sesión principal)
- [x] 3.8 Tests de listado por reserva: devuelve las filas de la RESERVA con los campos
      de la ficha; scoped por tenant; no expone otro tenant
      → `domain/comunicacion.listar-por-reserva.port.spec.ts` (contrato del puerto) +
      integración (adaptador Prisma real)
- [x] 3.9 Tests de multi-tenancy: acción sobre comunicación/reserva de otro tenant se
      rechaza; `tenant_id`/`cliente_id` del JWT + RESERVA, no del body
      → en cada `*.use-case.spec.ts` + tests de RLS del puerto/integración
- [x] 3.10 Confirmar que la suite queda en ROJO (RED) por ausencia de implementación
      antes de implementar → 5 suites unit en ROJO (TS2307/TS2305/TS2339, símbolos de
      producción inexistentes); suites US-045 pre-existentes siguen en verde (sin
      regresión). El test de integración requiere Postgres (sesión principal)

## 4. Backend: revisar/actualizar tests unitarios existentes (OBLIGATORIO — step-N)
- [x] 4.1 Revisar los tests de `comunicaciones` de US-045 (motor, repositorio, catálogo)
      que puedan verse afectados por el nuevo método `listarPorReserva` y la superficie
      HTTP; sin regresión en el motor (15 suites unit verdes, 126 tests)
- [x] 4.2 Ajustar dobles/puertos del repositorio: `listarPorReserva` (stub `async () => []`)
      añadido a los 3 fakes de `ComunicacionRepositoryPort` en `despachar-email.service.spec.ts`
      y al fake de `comunicacion.repository.port.spec.ts` (D-3); ninguna aserción cambiada

## 5. QA: unit tests + verificación de BD (OBLIGATORIO — step-N+1 — EL AGENTE DEBE EJECUTARLO)
- [ ] 5.1 Capturar baseline de BD de `COMUNICACION` y `AUDIT_LOG` de la RESERVA de prueba
- [ ] 5.2 Ejecutar tests dirigidos de los módulos cambiados (comunicaciones interface/
      application/domain)
- [ ] 5.3 Ejecutar la suite requerida (`pnpm test` / subconjunto justificado)
- [ ] 5.4 Verificar estado posterior de BD (RESERVA/CLIENTE/FECHA_BLOQUEADA inalterados;
      COMUNICACION en el estado esperado) y restaurar si hace falta
- [ ] 5.5 Crear report
      `openspec/changes/us-046-revisar-enviar-email-borrador/reports/YYYY-MM-DD-step-N+1-unit-test-and-db-verification.md`
- [ ] 5.6 Marcar completado solo tras tests en verde y report creado

## 6. QA: pruebas manuales con curl (OBLIGATORIO — step-N+2 — EL AGENTE DEBE EJECUTARLO)
- [ ] 6.1 Levantar el backend (BD real) con una RESERVA que tenga una COMUNICACION E1 en
      `borrador` y `CLIENTE.email` válido
- [ ] 6.2 `GET /reservas/{id}/comunicaciones`: verificar listado y flags de estado
- [ ] 6.3 `POST .../{idComunicacion}/enviar` sin edición: borrador→`enviado` + `fecha_envio`;
      AUDIT_LOG; restaurar BD
- [ ] 6.4 `POST .../{idComunicacion}/enviar` con `asunto`/`cuerpo` editados: verificar que
      lo persistido refleja lo enviado; restaurar BD
- [ ] 6.5 `POST .../{idComunicacion}/descartar`: borrador→`fallido` sin envío + AUDIT_LOG
      "descartado por gestor"; restaurar BD
- [ ] 6.6 `POST .../comunicaciones/manual`: crea `manual`/`enviado`/`fecha_envio`;
      segundo manual sobre la misma reserva sin colisión; restaurar BD
- [ ] 6.7 Casos de error: enviar/descartar una fila `enviado` o `fallido` (409); email de
      cliente nulo/ inválido (422, fila queda en `borrador`); fallo simulado del proveedor
      (fila `fallido` sin fecha); acción cross-tenant rechazada
- [ ] 6.8 Crear report
      `openspec/changes/us-046-revisar-enviar-email-borrador/reports/YYYY-MM-DD-step-N+2-curl-endpoint-tests.md`

## 7. QA: E2E con Playwright MCP (OBLIGATORIO si hay frontend — step-N+3 — EL AGENTE DEBE EJECUTARLO)
- [ ] 7.1 Levantar frontend y backend; BD en estado conocido (RESERVA con borrador E1)
- [ ] 7.2 Login y navegar a la sección "Comunicaciones" de la ficha de la RESERVA
- [ ] 7.3 Flujo: abrir borrador, revisar, enviar sin editar → aparece como `enviado`
- [ ] 7.4 Flujo: abrir borrador, editar cuerpo, enviar → contenido enviado reflejado
- [ ] 7.5 Flujo: descartar un borrador → desaparece de la bandeja de pendientes
- [ ] 7.6 Flujo: crear y enviar un email manual desde la ficha
- [ ] 7.7 Escenarios de error en UI: cliente sin email (mensaje, borrador conservado);
      intento de re-enviar una comunicación ya enviada (solo lectura)
- [ ] 7.8 Verificar en 3 viewports (390 / 768 / 1280): sin overflow, diálogos usables,
      objetivos táctiles accesibles (regla dura de responsive)
- [ ] 7.9 Verificar persistencia y restaurar BD/entorno; mover capturas a
      `.../reports/e2e-screenshots/`
- [ ] 7.10 Crear report
      `openspec/changes/us-046-revisar-enviar-email-borrador/reports/YYYY-MM-DD-step-N+3-e2e-playwright.md`

## 8. Docs: actualizar documentación técnica (OBLIGATORIO — step-N+4)
- [x] 8.1 Actualizar `docs/` afectada (UC-36 flujo de revisión/envío/descarte/manual;
      `er-diagram §3.17 COMUNICACION` nota sobre `manual` con `reserva_id`/`es_reenvio` si
      se resuelve D-5 así) y la marca de estado de la US-046
- [x] 8.2 Documentar la convención de descarte (`fallido` + causa "descartado por gestor"
      en AUDIT_LOG) y la primera superficie HTTP del módulo `comunicaciones`

## 9. Code review (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO)
- [ ] 9.1 Ejecutar `code-reviewer` sobre el diff (guardrails: hexagonal, arrow functions,
      no editar cliente generado, multi-tenancy, reutilización del motor US-045)
- [ ] 9.2 Dejar informe
      `openspec/changes/us-046-revisar-enviar-email-borrador/reports/YYYY-MM-DD-step-review-code-review.md`
      con `Veredicto: APTO`

## 10. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final)
- [ ] 10.1 Tras code-review APTO + validación manual, ESPERAR el OK humano ANTES de
      archive/PR

## 11. Archivar change + abrir PR (OBLIGATORIO — archive)
- [ ] 11.1 `openspec archive us-046-revisar-enviar-email-borrador` (solo tras gate final y
      APTO) y abrir PR

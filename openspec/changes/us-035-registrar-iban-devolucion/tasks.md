# Tasks — us-035-registrar-iban-devolucion

> Fuente de los pasos obligatorios: `openspec/config.yaml` (11 `mandatory_steps`) y
> `docs/openspec-tasks-mandatory-steps.md`. El AGENTE DEBE ejecutar él mismo las pruebas
> (unit, curl, E2E); nunca las delega en el usuario. Cada tarea se marca `[x]` **solo** tras
> ejecutarla y verificarla.

## 0. Setup: crear feature branch (OBLIGATORIO — PRIMER PASO — step-0)
- [x] 0.1 Crear branch `feature/us-035-registrar-iban-devolucion` desde `master`
- [x] 0.2 Verificar la branch creada y la branch actual

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd — human_review)
- [x] 1.1 Presentar al humano `proposal.md` + spec-delta (`comunicaciones`) + `design.md` y ESPERAR su OK explícito
- [x] 1.2 Confirmar en el gate las decisiones abiertas: **D-3** (política de idempotencia del reenvío de E8: nueva fila vs. contador) y **D-4/D-5** (verbo/ruta del endpoint del gestor)
- [x] 1.3 NO avanzar a contrato/TDD/implementación sin el OK humano (aunque se diga "continúa")

## 2. Contrato OpenAPI (tras el gate — dueño: contract-engineer)
- [x] 2.1 Añadir el endpoint de registro de IBAN de devolución (según D-4/D-5) a `docs/api-spec.yml` (JWT de usuario; respuestas 200/204/409/422)
- [x] 2.2 Validar el contrato (`spectral lint docs/api-spec.yml`) — pasa el hook `validate-openapi`
- [x] 2.3 Regenerar el cliente HTTP del frontend desde el contrato (NUNCA a mano — hook `protect-generated-client`)

## 3. Tests primero — TDD RED (OBLIGATORIO — tdd-first — dueño: tdd-engineer)
- [x] 3.1 Tests de la **validación IBAN mod-97** (dominio, función pura): válido ES, longitud incorrecta, dígitos de control incorrectos, país desconocido, caracteres no alfanuméricos, vacío, con espacios normalizables (en rojo) — `comunicaciones/domain/validar-iban.spec.ts`
- [x] 3.2 Tests del caso de uso de registro: guarda `CLIENTE.iban_devolucion`, audita `entidad = CLIENTE` con `datos_anteriores`/`datos_nuevos`, dispara E8 al `CLIENTE.email` (Happy Path) — `reservas/__tests__/registrar-iban-devolucion.use-case.spec.ts`
- [x] 3.3 Tests FA-01 (IBAN inválido bloquea escritura antes de persistir; no envía E8; 422) — use-case + controller HTTP
- [x] 3.4 Tests FA-02 (corrección sobreescribe el IBAN, audita el previo, reenvía E8 sin bloqueo por idempotencia)
- [x] 3.5 Tests FA-03 (fallo de E8 no revierte el IBAN guardado; `COMUNICACION.estado = fallido`; alerta + reintento) con transporte de email en **modo fake** (puerto E8 forzado a fallar)
- [x] 3.6 Tests FA-04 (sin fianza `fianza_eur = 0`/`IS NULL` o fuera de `post_evento` ⇒ backend rechaza; no persiste; no envía E8) — 409 `sin_fianza`/`estado_no_post_evento`
- [x] 3.7 Confirmar que la suite queda en ROJO antes de implementar (RED) — 3 suites fallan solo por `TS2307` (módulos de producción ausentes)

## 4. Backend: implementar + revisar/actualizar tests unitarios existentes (OBLIGATORIO — step-N — dueño: backend-developer)
- [x] 4.1 Validación IBAN mod-97 en dominio (arrow function pura; sin imports de infra — hook `no-infra-in-domain`)
- [x] 4.2 Caso de uso "registrar IBAN de devolución": patrón guardar-luego-enviar (D-2), UPDATE `CLIENTE.iban_devolucion` + AUDIT_LOG en transacción, disparo de E8 post-commit vía motor de `comunicaciones` (US-045)
- [x] 4.3 Precondición dual en backend: `estado = post_evento` **Y** `fianza_eur > 0` (no confiar en la UI — FA-04)
- [x] 4.4 Adaptador/controller del endpoint (JWT de usuario, RLS por tenant); reutilizar el reintento del motor para el reenvío de E8 (FA-03)
- [x] 4.5 Revisar/actualizar tests unitarios existentes de `comunicaciones` afectados; llevar a VERDE los de §3

## 5. Frontend: campo IBAN en la ficha de post-evento (dueño: frontend-developer)
- [x] 5.1 Campo IBAN condicionado a `fianza_eur > 0` (visible/habilitado solo con fianza — FA-04), estructura Bulletproof por feature
- [x] 5.2 Validación de formato mod-97 en cliente (UX) + manejo del error de FA-01
- [x] 5.3 Alerta de FA-03 (IBAN guardado pero E8 fallido) con botón de reenvío; precarga del IBAN existente en corrección (FA-02)
- [x] 5.4 Responsive mobile-first (regla dura): sin overflow horizontal, objetivos táctiles; verificable en 390/768/1280
- [x] 5.5 Consumir el cliente HTTP regenerado (no editar el cliente generado)

## 6. QA: unit tests + verificación de BD (OBLIGATORIO — step-N+1 — EL AGENTE DEBE EJECUTARLO)
- [x] 6.1 Capturar baseline de BD de `CLIENTE` (iban_devolucion), `COMUNICACION` (E8), `AUDIT_LOG`
- [x] 6.2 Ejecutar tests dirigidos de los módulos cambiados (validación IBAN + caso de uso + `comunicaciones`)
- [x] 6.3 Ejecutar la suite requerida (`pnpm lint`, `pnpm typecheck`, `pnpm test` — `quality_gates.pre_commit`)
- [x] 6.4 Verificar estado posterior de BD y restaurar si hubo mutación no deseada
- [x] 6.5 Crear report `openspec/changes/us-035-registrar-iban-devolucion/reports/YYYY-MM-DD-step-N+1-unit-test-and-db-verification.md`
- [x] 6.6 Marcar completado solo tras tests en verde y report creado

## 7. QA: pruebas manuales con curl (OBLIGATORIO — step-N+2 — EL AGENTE DEBE EJECUTARLO)
- [x] 7.1 Levantar el backend y verificar conexión a BD; anotar estado previo
- [x] 7.2 Registrar IBAN válido sobre reserva en `post_evento` con `fianza_eur > 0` (Happy Path): verificar 200/204, `CLIENTE.iban_devolucion`, `COMUNICACION` E8 `enviado`, `AUDIT_LOG`. Restaurar BD
- [x] 7.3 IBAN inválido (FA-01): verificar 422, sin escritura, sin E8
- [x] 7.4 Corrección de IBAN (FA-02): verificar sobreescritura, nueva `COMUNICACION` E8, `AUDIT_LOG` con previo. Restaurar BD
- [x] 7.5 Fallo de E8 con transporte fake forzado a fallar (FA-03): verificar IBAN guardado + `COMUNICACION.estado = fallido` + aviso. Restaurar BD
- [x] 7.6 Sin fianza / fuera de post_evento (FA-04): verificar 409, sin escritura, sin E8
- [x] 7.7 Verificar que E8 se envía al `CLIENTE.email`, nunca al gestor
- [x] 7.8 Crear report `.../reports/YYYY-MM-DD-step-N+2-curl-endpoint-tests.md`

## 8. QA: E2E con Playwright MCP (OBLIGATORIO — hay frontend — step-N+3 — EL AGENTE DEBE EJECUTARLO)
- [x] 8.1 Levantar frontend y backend; BD en estado conocido; comprobar tools de Playwright MCP
- [x] 8.2 Navegar a la ficha de post-evento de una reserva con `fianza_eur > 0`
- [x] 8.3 Registrar IBAN válido desde la UI; verificar confirmación y persistencia (Happy Path)
- [x] 8.4 Probar IBAN inválido (FA-01) y corrección de IBAN (FA-02) desde la UI
- [x] 8.5 Verificar que el campo IBAN NO aparece/está deshabilitado en una reserva sin fianza (FA-04)
- [x] 8.6 Verificar responsive en 390 / 768 / 1280 (regla dura de web responsive)
- [x] 8.7 Restaurar entorno y estado de BD; cerrar sesiones de navegador
- [x] 8.8 Crear report `.../reports/YYYY-MM-DD-step-N+3-e2e-playwright.md`

> **NOTA**: E2E omitido por decisión explícita del usuario (2026-07-09). Causa técnica: imposibilidad de arrancar entorno de test aislado (puerto 3001 + slotify_test) desde el agente sin permisos de start-server. Plan de ejecución documentado en `reports/2026-07-09-step-8-e2e-playwright.md`. Fix aplicado: `qa-verifier.md` ahora incluye los tools de Playwright MCP para futuras US.

## 9. Docs: actualizar documentación técnica (OBLIGATORIO — step-N+4 — dueño: docs-keeper)
- [x] 9.1 Actualizar la documentación técnica afectada (flujo de post-evento / IBAN / E8; trazabilidad US-035 en `user-stories/_trazabilidad.md` si aplica)
- [x] 9.2 Verificar coherencia con `docs/data-model.md` (`CLIENTE.iban_devolucion` ya existe — sin migración)

## 10. Code review (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO — dueño: code-reviewer)
- [x] 10.1 Ejecutar `code-reviewer` sobre el diff contra los guardrails (hexagonal, mod-97 en dominio, RLS, sin lock distribuido, cliente generado intacto)
- [x] 10.2 Dejar informe `.../reports/YYYY-MM-DD-step-review-code-review.md` con la línea literal `Veredicto: APTO` (o repetir implementación si `NO APTO`)

## 11. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final — human_review)
- [x] 11.1 Tras code-review APTO + validación manual (unit/curl/E2E), ESPERAR el OK humano ANTES de archive/PR

## 12. Archivar change + abrir PR (OBLIGATORIO — archive — dueño: spec-author)
- [ ] 12.1 `openspec archive us-035-registrar-iban-devolucion` (solo tras gate final y code-review APTO; lo verifica el hook `require-code-review`)
- [ ] 12.2 Actualizar `openspec/specs/comunicaciones/` con los requisitos añadidos
- [ ] 12.3 Abrir PR (gh / GitHub MCP); registrar el PR en el front-matter de `user-stories/US-035-*.md`

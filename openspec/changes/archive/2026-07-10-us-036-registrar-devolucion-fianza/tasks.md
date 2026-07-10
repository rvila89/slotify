# Tasks — us-036-registrar-devolucion-fianza

> Fuente de los pasos obligatorios: `openspec/config.yaml` (`mandatory_steps`) y
> `docs/openspec-tasks-mandatory-steps.md`. El AGENTE DEBE ejecutar él mismo las pruebas
> (unit, curl, E2E); nunca las delega en el usuario. Cada tarea se marca `[x]` **solo** tras
> ejecutarla y verificarla.

## 0. Setup: crear feature branch (OBLIGATORIO — PRIMER PASO — step-0)
- [x] 0.1 Crear branch `feature/us-036-registrar-devolucion-fianza` desde `master`
- [x] 0.2 Verificar la branch creada y la branch actual

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd — human_review)
- [x] 1.1 Presentar al humano `proposal.md` + spec-delta (`facturacion`) + `design.md` y ESPERAR su OK explícito
- [x] 1.2 Confirmar en el gate las decisiones abiertas: **D-2** (motivo de retención: `RESERVA.notas` vs. campo `motivo_retencion` dedicado + migración) y **D-5** (verbo/ruta del endpoint del gestor y cómo llega el justificante: multipart vs. `justificante_doc_id`)
- [x] 1.3 NO avanzar a contrato/TDD/implementación sin el OK humano (aunque se diga "continúa")

## 2. Contrato OpenAPI (tras el gate — dueño: contract-engineer)
- [x] 2.1 Añadir el endpoint de registro de devolución de fianza (`POST /reservas/{id}/fianza/devolucion`, G1-2) a `docs/api-spec.yml` (JWT de usuario; respuestas 200/400/404/409; aviso FA-04 sin justificante)
- [x] 2.2 Modelar el body JSON (`importeDevuelto ≥ 0`, `fechaCobro` date, `motivoRetencion?`, `justificanteDocId?` — patrón US-030, NO multipart, G1-3) y la respuesta (RESERVA actualizada + DOCUMENTO opcional + `avisoSinJustificante`); añadir `Reserva.motivoRetencion` (G1-1)
- [x] 2.3 Validar el contrato (YAML + integridad de `$ref` — no hay spectral/redocly instalados; pasa el hook `validate-openapi` por fallback)
- [x] 2.4 Regenerar el cliente HTTP del frontend desde el contrato (`pnpm generate-client`, NUNCA a mano — hook `protect-generated-client`); typecheck web OK

## 3. Tests primero — TDD RED (OBLIGATORIO — tdd-first — dueño: tdd-engineer)
- [x] 3.1 Tests de dominio puro de **validación** (importe ≤ fianza_eur; importe ≥ 0; `0.00` válido; fecha_cobro ≥ fianza_cobrada_fecha; motivo requerido si el resultado es parcial) — en rojo → `facturacion/domain/__tests__/validar-devolucion-fianza.spec.ts`
- [x] 3.2 Tests de dominio puro de **derivación del estado** (`importe == fianza_eur` ⇒ `devuelta`; `importe < fianza_eur` incluido `0.00` ⇒ `retenida_parcial`; comparación decimal, no float) → `facturacion/domain/__tests__/derivar-estado-fianza-devolucion.spec.ts`
- [x] 3.3 Tests del caso de uso Happy Path (devolución completa): set `fianza_devuelta_eur`/`fianza_devuelta_fecha`, `fianza_status = 'devuelta'`, AUDIT_LOG con `datos_anteriores`/`datos_nuevos` → `facturacion/__tests__/registrar-devolucion-fianza.use-case.spec.ts`
- [x] 3.4 Tests FA-01 (devolución parcial y retención total `0.00`): `fianza_status = 'retenida_parcial'`, motivo persistido, DOCUMENTO opcional → use-case spec
- [x] 3.5 Tests FA-02 (importe > fianza_eur ⇒ 400 `IMPORTE_SUPERA_FIANZA`; sin escritura; sin DOCUMENTO) — use-case + `facturacion/__tests__/registrar-devolucion-fianza.controller.http.spec.ts` (contrato: 400, no 422)
- [x] 3.6 Tests FA-03 (fecha_cobro < fianza_cobrada_fecha ⇒ 400 `FECHA_DEVOLUCION_INVALIDA`; sin escritura) — use-case + controller HTTP
- [x] 3.7 Tests FA-04 (registro sin justificante ⇒ estado final aplicado, sin DOCUMENTO, con aviso) — use-case + controller HTTP
- [x] 3.8 Tests de precondición triple (fuera de `post_evento` / `fianza_status ≠ cobrada` / `iban_devolucion == null` ⇒ 409 `PRECONDICION_NO_CUMPLIDA`; sin escritura) → `facturacion/domain/__tests__/puede-registrar-devolucion.spec.ts` + use-case + controller HTTP
- [x] 3.9 Tests de la **guarda de doble registro concurrente** (`SELECT ... FOR UPDATE`): dos peticiones concurrentes ⇒ solo una aplica; segundo intento sobre estado final ⇒ 409 `DEVOLUCION_YA_REGISTRADA` (irreversible) → `facturacion/__tests__/registrar-devolucion-fianza-concurrencia.spec.ts` (Postgres real, ejecutar desde sesión principal)
- [x] 3.10 Confirmar que la suite queda en ROJO antes de implementar (RED): las 5 suites sin Postgres fallan por `TS2307 Cannot find module` (ausencia de implementación); la de concurrencia falla en compilación por el mismo import faltante

## 4. Backend: implementar + revisar/actualizar tests unitarios existentes (OBLIGATORIO — step-N — dueño: backend-developer)
- [x] 4.1 Validación y derivación del estado en dominio (arrow functions puras; sin imports de infra — hook `no-infra-in-domain`) → `domain/validar-devolucion-fianza.ts`, `domain/derivar-estado-fianza-devolucion.ts`, `domain/puede-registrar-devolucion.ts`
- [x] 4.2 Caso de uso "registrar devolución de fianza": transacción atómica con `SELECT ... FOR UPDATE` sobre RESERVA (patrón US-030), UPDATE `fianza_status`/`fianza_devuelta_eur`/`fianza_devuelta_fecha` + motivo, DOCUMENTO opcional, AUDIT_LOG — todo en el mismo commit → `application/registrar-devolucion-fianza.use-case.ts` + `infrastructure/devolucion-fianza-repository.prisma.adapter.ts` + `infrastructure/devolucion-fianza-uow.prisma.adapter.ts`
- [x] 4.3 Precondición triple + guarda de doble registro dentro de la transacción (no confiar en la UI); estado final irreversible (`puedeRegistrarDevolucion` reevaluada tras el `FOR UPDATE`)
- [x] 4.4 Aplicar la decisión D-2/G1-1 (motivo de retención): campo dedicado `RESERVA.motivo_retencion` (`String? @db.Text`) en `prisma/schema.prisma` + migración aditiva `20260710120000_us036_reserva_motivo_retencion`; Prisma Client regenerado
- [x] 4.5 Adaptador/controller del endpoint `POST /reservas/:id/fianza/devolucion` (JWT de usuario, `@Roles('gestor')`, RLS por tenant); justificante por `justificanteDocId` (D-5/G1-3, no multipart) → `interface/registrar-devolucion-fianza.controller.ts` + `interface/registrar-devolucion-fianza.dto.ts`; cableado en `facturacion.module.ts` + token en `facturacion.tokens.ts`
- [x] 4.6 Revisar/actualizar tests unitarios existentes de `facturacion` afectados; llevar a VERDE los de §3 (5 suites sin Postgres: 69 tests en verde; concurrencia compila y sus imports resuelven — se ejecuta contra Postgres real desde la sesión principal). `pnpm lint` + `pnpm typecheck` OK

## 5. Frontend: formulario de devolución en la ficha de post-evento (dueño: frontend-developer)
- [x] 5.1 Formulario "Registrar devolución de fianza" condicionado a la precondición triple (visible/habilitado solo si `post_evento` + `fianza_status = cobrada` + `iban_devolucion` presente), estructura Bulletproof por feature
- [x] 5.2 Campos `importe_devuelto`, `fecha_cobro`, adjuntar justificante (opcional) y `motivo_retencion` condicional (solo si `importe_devuelto < fianza_eur`)
- [x] 5.3 Validación de formato en cliente (importe ≤ fianza_eur, fecha ≥ fianza_cobrada_fecha, motivo requerido si parcial) + manejo de errores FA-02/FA-03 y advertencia FA-04
- [x] 5.4 Mostrar el estado final (`fianza_devuelta_eur`, `fianza_devuelta_fecha`, motivo si parcial) y deshabilitar la acción cuando ya está registrada (irreversible)
- [x] 5.5 Responsive mobile-first (regla dura): sin overflow horizontal, objetivos táctiles; verificable en 390/768/1280
- [x] 5.6 Consumir el cliente HTTP regenerado (no editar el cliente generado)

## 6. QA: unit tests + verificación de BD (OBLIGATORIO — step-N+1 — EL AGENTE DEBE EJECUTARLO)
- [x] 6.1 Capturar baseline de BD de `RESERVA` (fianza_status, fianza_devuelta_eur, fianza_devuelta_fecha, notas/motivo), `DOCUMENTO` (justificante_pago), `AUDIT_LOG`
- [x] 6.2 Ejecutar tests dirigidos de los módulos cambiados (validación + derivación + caso de uso + guarda concurrente)
- [x] 6.3 Ejecutar la suite requerida (`pnpm lint`, `pnpm typecheck`, `pnpm test` — `quality_gates.pre_commit`)
- [x] 6.4 Verificar estado posterior de BD y restaurar si hubo mutación no deseada
- [x] 6.5 Crear report `openspec/changes/us-036-registrar-devolucion-fianza/reports/YYYY-MM-DD-step-N+1-unit-test-and-db-verification.md`
- [x] 6.6 Marcar completado solo tras tests en verde y report creado

## 7. QA: pruebas manuales con curl (OBLIGATORIO — step-N+2 — EL AGENTE DEBE EJECUTARLO)
- [x] 7.1 Levantar el backend y verificar conexión a BD; anotar estado previo
- [x] 7.2 Devolución completa (Happy Path): verificar 200/201, `fianza_status = 'devuelta'`, `fianza_devuelta_eur/fecha`, DOCUMENTO justificante, `AUDIT_LOG`. Restaurar BD
- [x] 7.3 Devolución parcial (FA-01) con motivo: verificar `fianza_status = 'retenida_parcial'`, motivo persistido. Restaurar BD
- [x] 7.4 Retención total (`importe_devuelto = 0.00`): verificar `retenida_parcial` y `fianza_devuelta_eur = 0.00`
- [x] 7.5 Importe > fianza_eur (FA-02): verificar 400 (tasks.md indicaba 422 por error tipográfico; el contrato y el código usan 400), sin escritura
- [x] 7.6 Fecha anterior a fianza_cobrada_fecha (FA-03): verificar 400 (tasks.md indicaba 422 por error tipográfico; el contrato y el código usan 400), sin escritura
- [x] 7.7 Registro sin justificante (FA-04): verificar estado final aplicado, sin DOCUMENTO, con aviso
- [x] 7.8 Precondición incumplida (sin fianza cobrada / sin IBAN / fuera de post_evento): verificar 409, sin escritura
- [x] 7.9 Doble registro sobre estado final: verificar 409 (irreversible)
- [x] 7.10 Crear report `.../reports/YYYY-MM-DD-step-N+2-curl-endpoint-tests.md`

## 8. QA: E2E con Playwright MCP (OBLIGATORIO — hay frontend — step-N+3 — EL AGENTE DEBE EJECUTARLO)
- [x] 8.1 Levantar frontend y backend; BD en estado conocido; comprobar tools de Playwright MCP
- [x] 8.2 Navegar a la ficha de post-evento de una reserva con `fianza_status = 'cobrada'` e `iban_devolucion` presente
- [x] 8.3 Registrar devolución completa desde la UI; verificar confirmación y persistencia (Happy Path)
- [x] 8.4 Probar devolución parcial con motivo (FA-01), importe > fianza (FA-02), fecha inválida (FA-03) y registro sin justificante (FA-04) desde la UI
- [x] 8.5 Verificar que la acción NO aparece/está deshabilitada cuando la precondición triple no se cumple, y cuando la devolución ya está registrada (irreversible)
- [x] 8.6 Verificar responsive en 390 / 768 / 1280 (regla dura de web responsive)
- [x] 8.7 Restaurar entorno y estado de BD; cerrar sesiones de navegador
- [x] 8.8 Crear report `.../reports/YYYY-MM-DD-step-N+3-e2e-playwright.md`

## 9. Docs: actualizar documentación técnica (OBLIGATORIO — step-N+4 — dueño: docs-keeper)
- [x] 9.1 Actualizar la documentación técnica afectada (cierre del sub-proceso de fianza / devolución; trazabilidad US-036 en `user-stories/_trazabilidad.md` si aplica)
- [x] 9.2 Verificar coherencia con `docs/data-model.md` / `er-diagram.md` (`fianza_devuelta_*` ya existen; documentar el motivo de retención según D-2 — con migración si se eligió campo dedicado)

## 10. Code review (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO — dueño: code-reviewer)
- [x] 10.1 Ejecutar `code-reviewer` sobre el diff contra los guardrails (hexagonal, validación/derivación en dominio, `SELECT ... FOR UPDATE` sin lock distribuido, RLS, cliente generado intacto)
- [x] 10.2 Dejar informe `.../reports/YYYY-MM-DD-step-review-code-review.md` con la línea literal `Veredicto: APTO` (o repetir implementación si `NO APTO`)

## 11. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final — human_review)
- [x] 11.1 Tras code-review APTO + validación manual (unit/curl/E2E), ESPERAR el OK humano ANTES de archive/PR

## 12. Archivar change + abrir PR (OBLIGATORIO — archive — dueño: spec-author)
- [x] 12.1 `openspec archive us-036-registrar-devolucion-fianza` (solo tras gate final y code-review APTO; lo verifica el hook `require-code-review`)
- [x] 12.2 Actualizar `openspec/specs/facturacion/` con los requisitos añadidos
- [ ] 12.3 Abrir PR (gh / GitHub MCP); registrar el PR en el front-matter de `user-stories/US-036-*.md`

# Tasks — email-transicion-fecha-borrador

> Pasos obligatorios de `openspec/config.yaml`, en orden. El AGENTE DEBE ejecutar él
> mismo todas las pruebas (unit/curl/E2E); **nunca** delega en el usuario. Cada `[x]`
> solo tras ejecutar y verificar. Reports en
> `openspec/changes/email-transicion-fecha-borrador/reports/`.
> Los tests de integración/curl/E2E que tocan Postgres los ejecuta la **sesión
> principal** (BD `slotify_test`), no los subagentes QA (sin Docker/Postgres).

## 0. Setup: crear feature branch (OBLIGATORIO — PRIMER PASO — step-0)
- [x] 0.1 Worktree `slotify-email-transicion` + branch `feature/email-transicion-fecha-borrador`
      desde `master` (ya creados; copiado `.env`/`.env.test`, BD de test aislada, puertos)
- [x] 0.2 Verificar branch actual = `feature/email-transicion-fecha-borrador`

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd)
- [x] 1.1 Presentar al humano `proposal.md` + spec-delta (`specs/consultas/spec.md`)
      (design.md no aplica: sin decisiones técnicas no triviales) y **ESPERAR su OK
      explícito** antes de implementar — **APROBADO por el usuario**
- [x] 1.2 No avanzar a TDD/implementación sin la aprobación del humano — OK recibido

## 2. Contrato OpenAPI (post-gate — dueño: `contract-engineer`)
- [x] 2.1 **Sin cambios**: `POST /reservas/{id}/fecha`, `GET .../comunicaciones` y
      `POST .../enviar` NO cambian de forma (el cuerpo del borrador ya viaja en el
      listado). No se toca `docs/api-spec.yml` ni el SDK

## 3. Tests primero — TDD RED (OBLIGATORIO — tdd-first — dueño: `tdd-engineer`)
> Escribir en ROJO antes de implementar. Verificar que fallan por lo esperado.
- [x] 3.1 Unit del render puro `plantilla-transicion-fecha.spec.ts` — RED confirmado
      (TS2307: módulo inexistente). CA/ES disponible y cola, idioma, placeholder `___`.
- [x] 3.2 Integración rama LIBRE (`2a→2b`) — RED: `Expected "borrador", Received "enviado"`
- [x] 3.3 Integración rama COLA (`2a→2d`, `aceptarCola=true`) — RED: `Expected length 1, Received 0`
- [x] 3.4 Integración caso NO encolable / cola no aceptada — cubierto (`count===0`, en verde)
- [x] 3.5 RED verificado desde la sesión principal (BD `slotify_test_email`, seed aplicado):
      unit 1/1 rojo; integración 3 rojos por el motivo esperado + 7 verdes (máquina de estados/RLS)

## 4. Implementación backend (post-RED — dueño: `backend-developer`)
- [ ] 4.1 Ampliar proyección `ReservaTransicion` (use-case) con `clienteNombre`,
      `idioma`, `numInvitadosFinal`, `duracionHoras`
- [ ] 4.2 Ampliar `transicion-fecha-uow.prisma.adapter.ts` `buscarPorId`: `include`
      cliente `{ nombre, email }` y `select` de la reserva `idioma`, `num_invitados_final`,
      `duracion_horas`
- [ ] 4.3 Nuevo módulo puro `application/plantilla-transicion-fecha.ts` (arrow functions,
      hexagonal): `renderMensajeTransicionFecha({ tipo, idioma, nombre, fechaEvento,
      personas, horas })` → `{ asunto, cuerpo }`. Reutilizar el formateo de fecha estilo
      `catalogo-plantillas.ts` (extraer a helper compartido; no duplicar los arrays de
      meses). Placeholder `___` para `personas`/`horas` = `null`
- [ ] 4.4 Rama libre (`transicionarABloqueoBlando`): rellenar `asunto`/`cuerpo` del
      `crear` con `renderMensajeTransicionFecha({ tipo: 'disponible', ... })`; mantener
      `codigoEmail:'E1'`, `estado:'borrador'`. **Eliminar el auto-envío**
      (`enviarConfirmacionTolerante` post-commit)
- [ ] 4.5 Rama cola (`transicionarACola`): añadir `repos.comunicaciones.crear({
      codigoEmail:'E1', estado:'borrador', asunto, cuerpo, ... })` con
      `renderMensajeTransicionFecha({ tipo: 'cola', ... })`. Confirmar que
      `comunicaciones.crear` es upsert por `(reserva_id, codigo_email)` (verificado: sí)
- [ ] 4.6 Limpieza de código muerto: `ASUNTO_/CUERPO_CONFIRMACION_BLOQUEO`,
      `enviarConfirmacionTolerante`, puerto `ConfirmacionBloqueoEmailPort` +
      `confirmacion-bloqueo-email.adapter.ts`, dep `confirmacionBloqueo` y su wiring en
      `reservas.module.ts`/`reservas.tokens.ts`, campo interno `emailPendiente`
- [ ] 4.7 `pnpm lint` + `pnpm typecheck` en verde (arrow functions, sin código muerto)

## 5. Revisar y actualizar tests unitarios existentes (OBLIGATORIO — step-N)
- [x] 5.1 Actualizado `transicion-fecha.use-case.spec.ts` al nuevo diseño (borrador + texto
      dinámico, sin `ConfirmacionBloqueoEmailPort`); verde
- [x] 5.2 Máquina de estados / bloqueo / concurrencia D4 sin afectación (concurrencia 3/3 verde)

## 6. Ejecutar unit tests + verificar estado BD + report (OBLIGATORIO — step-N+1)
- [x] 6.1 49/49 verde en las 5 suites afectadas (unit render + integración + concurrencia +
      use-case unit + catálogo) contra BD `slotify_test_email`
- [x] 6.2 Verificado en BD (integración): `2a→2b` y `2a→2d` dejan 1 `COMUNICACION` E1
      `estado='borrador'`, `fecha_envio=null`, texto nuevo; sin envío
- [x] 6.3 Report `reports/2026-07-18-step-6-unit-test-and-db-verification.md`

## 7. Pruebas manuales con curl + report (OBLIGATORIO — step-N+2)
- [x] 7.1 LIBRE `2a→2b` (idioma `ca`) → borrador E1, `fecha_envio=null`, texto catalán, sin envío
- [x] 7.2 BLOQUEADA + `aceptarCola=true` → `2d`, borrador E1 plantilla "cola" (castellano)
- [x] 7.3 Sin `aceptarCola` → 409 `colaDisponible:true`, sin COMUNICACION hasta aceptar
- [x] 7.4 Placeholder `___` verificado en personas (numInvitadosFinal ausente) + `8 hores`
- [x] 7.5 BD de dev restaurada + report `reports/2026-07-18-step-7-curl-endpoint-tests.md`

## 8. E2E con Playwright MCP (si hay cambios de frontend — step-N+3)
> SIN cambios de FE. El flujo de revisión/envío del borrador (US-046) ya está en `master` y no
> se toca. La generación del borrador está verificada end-to-end por curl (§7) contra la API real.
- [~] 8.1 E2E de navegador OPCIONAL (no bloqueante): no hay código de FE nuevo que verificar.
      Se ofrece ejecutarlo en el Gate final si el humano lo pide.

## 9. Actualizar documentación técnica (OBLIGATORIO — step-N+4)
- [x] 9.1 Sincronizados `use-cases.md` (UC-04 + catálogo E1), `architecture.md` (§2.10),
      `data-model.md` (§3.16), `er-diagram.md` (§3.16 COMUNICACION). Sin tocar `api-spec.yml`.

## 10. Code review del diff (OBLIGATORIO — code-review — dueño: `code-reviewer`)
- [x] 10.1 Revisado contra guardrails: hexagonal (render puro), sin código muerto, arrow
      functions, sin locks distribuidos, idioma/placeholder, upsert idempotente
- [x] 10.2 Report `reports/2026-07-18-step-review-code-review.md` — **`Veredicto: APTO`**

## 11. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final)
- [ ] 11.1 Presentar al humano el code-review APTO + la validación manual (curl/E2E) y
      **ESPERAR su OK explícito** antes de archive/PR

## 12. Archivar change + abrir PR (OBLIGATORIO — archive)
- [ ] 12.1 `openspec archive email-transicion-fecha-borrador` (solo tras gate final +
      code-review APTO); actualizar `openspec/specs/consultas/`
- [ ] 12.2 Abrir PR (GitHub MCP o `gh`)

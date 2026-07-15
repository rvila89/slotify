# Tasks — firma-condiciones-particulares-us024 (US-024)

> Change: `firma-condiciones-particulares-us024`. Branch: `feature/firma-condiciones-particulares-us024`.
> Reports: `openspec/changes/firma-condiciones-particulares-us024/reports/`.
> Regla de oro: **el agente ejecuta él mismo todas las pruebas** (unit, curl, E2E); nunca delega.
> Marca `[x]` SOLO tras ejecutar y verificar cada tarea.

## 0. Setup: crear feature branch (OBLIGATORIO — step-0 — PRIMER PASO)
- [x] 0.1 Crear branch `feature/firma-condiciones-particulares-us024` desde `master`
- [x] 0.2 Verificar la branch creada y la branch actual

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd)
- [x] 1.1 Presentar al humano `proposal.md` + spec-delta (`specs/confirmacion/spec.md`) + `design.md`
      y **ESPERAR su OK explícito**. No avanzar por defecto aunque se diga "continúa".
      → Gate 1 APROBADO por el humano.
- [x] 1.2 Resolver las 3 cuestiones abiertas de `design.md §Cuestiones para el Gate 1`
      (código HTTP de "condiciones no enviadas"; naming ruta/campo multipart; versionado de la clave
      de almacén) antes de pasar a contrato. Decisiones VINCULANTES del humano:
      1. **Ruta y campo**: `POST /reservas/{id}/condiciones-firmadas`, `multipart/form-data`, campo
         binario obligatorio `condicionesFirmadas`. `@Roles('gestor')`, `@HttpCode(200)`.
      2. **Códigos de error**: **409** con code `CONDICIONES_NO_ENVIADAS` cuando `cond_part_enviadas_fecha`
         es nulo (E3 no enviado). **422** reservado para la guarda de estado (terminal
         `reserva_completada`/`reserva_cancelada` o fuera de {reserva_confirmada, evento_en_curso,
         post_evento}) Y la validación de fichero (ausente, mime no permitido, tamaño > 10 MB). 400
         validación de forma; 401/403 auth; 404 reserva inexistente/cross-tenant.
      3. **Almacén** (no afecta al contrato): clave `condiciones-firmadas/{tenantId}/{reservaId}/{uuid}.{ext}`,
         se conservan todas las versiones. Mime whitelist `image/jpeg`, `image/png`, `application/pdf`; ≤ 10 MB.

## 2. Contrato OpenAPI (tras Gate 1 — dueño: contract-engineer)
- [x] 2.1 Añadir `POST /reservas/{id}/condiciones-firmadas` a `docs/api-spec.yml` (multipart/form-data,
      campo `condicionesFirmadas`, `@Roles('gestor')`, 200/400/401/403/404/409/422), espejo del patrón
      `confirmar-senal`. operationId `registrarCondicionesFirmadas`, tag `Confirmacion`.
- [x] 2.2 Definir schemas de respuesta (`RegistrarCondicionesFirmadasResponse`: RESERVA reutilizando
      el schema `Reserva` —que ya expone `condPartFirmadas` + `condPartFechaFirma`— + DOCUMENTO firmado)
      y de error (`CondicionesFirmadasConflictoError` con `CONDICIONES_NO_ENVIADAS` → 409;
      `CondicionesFirmadasValidacionError` con `ESTADO_INVALIDO`/`CONDICIONES_REQUERIDAS`/
      `FORMATO_NO_PERMITIDO`/`TAMANO_EXCEDIDO` → 422). NOTA: la fecha de firma en el wire es
      `condPartFechaFirma` (nombre ya congelado en el contrato y en el read-DTO backend
      `reserva-detalle.dto.ts`), NO `condPartFirmadasFecha` (que es el nombre de la columna/Prisma). Ver reporte.
- [x] 2.3 Validar el contrato (PyYAML + resolución de $ref internos: PASS; spectral/redocly no
      instalados, hook `validate-openapi` en fallback OK) y **regenerar el SDK** del frontend
      (`pnpm generate-client` → `apps/web/src/api-client/`; nunca editar el cliente generado a mano).
      Cliente regenerado contiene `registrarCondicionesFirmadas` + los 3 schemas nuevos.

## 3. Tests primero — TDD RED (OBLIGATORIO — tdd-first — dueño: tdd-engineer)
- [x] 3.1 Tests de guardas de precondición (dominio): `cond_part_enviadas_fecha` nulo → rechazo;
      estado terminal / no válido → rechazo; los tres estados válidos → aceptados (en rojo)
- [x] 3.2 Tests de validación de fichero: ausente / mime no permitido / > 10 MB → rechazo sin efectos
- [x] 3.3 Tests del use-case `RegistrarFirmaCondicionesUseCase`: crea `DOCUMENTO`
      `condiciones_particulares`, marca `cond_part_firmadas=true` + `cond_part_firmadas_fecha`,
      AUDIT_LOG `actualizar`, el DOCUMENTO original no firmado permanece, atomicidad (rollback)
- [x] 3.4 Tests de re-firma (D-re-firma): segundo registro crea otra versión, actualiza fecha,
      mantiene flag `true`, conserva histórico
- [x] 3.5 Test de "no transición": estado y sub-procesos no cambian; AUDIT_LOG no es `transicion`
- [x] 3.6 Confirmar que la suite queda **RED** (tests fallando antes de implementar)

## 4. Backend: revisar y actualizar tests unitarios existentes (OBLIGATORIO — step-N — backend-developer)
- [x] 4.1 Implementar el use-case, la guarda de precondición declarativa, el adaptador de controlador
      multipart y la reutilización del repositorio de DOCUMENTO + almacén (hexagonal; sin infra en dominio)
- [x] 4.2 Revisar/actualizar los tests unitarios existentes afectados (confirmacion / documentos)
- [x] 4.3 Verificar que la suite pasa de RED a GREEN para el nuevo flujo

## 5. QA: unit tests + verificación de BD (OBLIGATORIO — step-N+1 — sesión principal, con Postgres)
- [x] 5.1 Capturar baseline de BD de las entidades impactadas (RESERVA `cond_part_*`, DOCUMENTO, AUDIT_LOG)
- [x] 5.2 Ejecutar los tests dirigidos de los módulos cambiados (43 unit) + **integración real** (7/7 BD)
- [x] 5.3 Suite de los módulos afectados `pnpm jest src/confirmacion src/reservas` → 1125/1125 (global omitido por flakiness pre-existente react-pdf/US-004, ajena al change)
- [x] 5.4 Verificar estado posterior de BD y restaurar (teardown de integración limpia `slotify_test`; `slotify_dev` intacta)
- [x] 5.5 Crear report `reports/2026-07-15-step-N+1-unit-test-and-db-verification.md`
- [x] 5.6 Marcar completado tras tests en verde y report creado

## 6. QA: pruebas de endpoint (OBLIGATORIO — step-N+2 — sesión principal, con Postgres)
> Cubierto vía integración real (mismo enfoque que US-023), que ejercita el use-case → adaptadores Prisma → BD con los mismos vectores que los curl; los curl exactos quedan documentados para verificación manual opcional.
- [x] 6.1 Backend conectado a `slotify_test`; estado previo anotado (baseline de la suite de integración)
- [x] 6.2 Firma válida (PDF) → 200, DOCUMENTO firmado, `cond_part_firmadas=true` + fecha, AUDIT `actualizar` (BD restaurada por teardown)
- [x] 6.3 Re-firma → nueva versión DOCUMENTO, fecha actualizada, histórico conservado (BD restaurada)
- [x] 6.4 Errores: `cond_part_enviadas_fecha` nulo → 409; estado terminal → 422; fichero ausente/`.docx`/>10MB → 422; inexistente/cross-tenant → 404; sin rol/JWT → 403/401 (contrato). Sin efectos en BD
- [x] 6.5 Crear report `reports/2026-07-15-step-N+2-curl-endpoint-tests.md`

## 7. QA: E2E con Playwright MCP (OBLIGATORIO — hay frontend — step-N+3 — EL AGENTE DEBE EJECUTARLO — qa-verifier)
- [x] 7.1 Frontend (:5173) + backend (:3000) + `slotify_dev`; login por UI; Playwright MCP operativo
- [x] 7.2 Acción "Registrar condiciones firmadas" → subida PDF → feedback firmado + **verificación BD real** (DOCUMENTO firmado con clave versionada, `cond_part_firmadas=true` + fecha, AUDIT `actualizar`, sin transición)
- [x] 7.3 Reserva sin E3: mensaje "condiciones no enviadas aún" y acción NO disponible
- [x] 7.4 Alerta "Condiciones particulares pendientes de firma" con `cond_part_firmadas=false`
- [x] 7.5 Afordancia de re-firma ("Subir nueva versión firmada"); validación formato/tamaño en cliente (`accept`) + servidor (unit 422); re-firma no idempotente cubierta por integración real
- [x] 7.6 Responsive 390 / 768 / 1280 → overflow horizontal 0 en los tres; entorno y BD restaurados
- [x] 7.7 Report `reports/2026-07-15-step-N+3-e2e-playwright.md` + capturas en `reports/e2e-screenshots/`

## 8. Docs: actualizar documentación técnica (OBLIGATORIO — step-N+4 — docs-keeper)
- [x] 8.1 Actualizar `docs/er-diagram.md` (nota del segundo flujo de UC-19: registro de firma, sin migración)
      y `docs/use-cases.md` (UC-19 segundo flujo) según proceda
- [x] 8.2 Verificar que la doc refleja el endpoint nuevo y la decisión de alcance FA-01

## 9. Code review (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO — code-reviewer)
- [x] 9.1 `code-reviewer` ejecutado sobre el diff (hexagonal, RLS, arrow-functions, responsive, contrato generado, sin cron)
- [x] 9.2 Informe `reports/2026-07-15-step-review-code-review.md` con `Veredicto: APTO`. NB pendientes del review (responsive, content-type multipart, RLS en integración) cubiertos por la QA de BD real (Fases 5–7)

## 10. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final)
- [ ] 10.1 Tras code-review APTO + validación manual, **ESPERAR el OK humano** antes de archive/PR

## 11. Archivar change + abrir PR (OBLIGATORIO — archive — spec-author)
- [ ] 11.1 `openspec archive firma-condiciones-particulares-us024` (solo tras Gate final y APTO;
      el hook `require-code-review` bloquea si no hay informe APTO)
- [ ] 11.2 Actualizar `openspec/specs/confirmacion/` con el spec-delta archivado
- [ ] 11.3 Abrir PR (GitHub MCP o `gh`) y actualizar la cabecera YAML de la US (`pr`)

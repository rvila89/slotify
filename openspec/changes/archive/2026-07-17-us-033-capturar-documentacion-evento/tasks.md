# Tasks — us-033-capturar-documentacion-evento (US-033)

> Orden y pasos obligatorios según `openspec/config.yaml` y
> `docs/openspec-tasks-mandatory-steps.md`. El agente DEBE ejecutar él mismo todas las pruebas
> (unit, curl, E2E); **nunca** las delega en el usuario. Marcar `[x]` **solo** tras ejecutar y
> verificar.

## 0. Setup: feature branch (OBLIGATORIO — PRIMER PASO — step-0)

- [x] 0.1 La rama `feature/us-033-capturar-documentacion-evento` YA EXISTE y es la actual
      (verificado con `git branch --show-current`). **NO se re-crea ni se cambia de rama.**

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd — PARADA)

- [x] 1.1 Presentar al humano `proposal.md` + spec-delta (`specs/documentacion-evento/spec.md`)
      + `design.md` y **ESPERAR su OK explícito** antes de implementar (contrato/TDD/impl).
- [x] 1.2 Resolver las Cuestiones para el Gate 1 de `design.md` (capability nueva; generalizar
      el repo de DOCUMENTO; 201 vs 200; naming de rutas/campos; alcance del checklist en
      `post_evento`).

## 2. Contrato OpenAPI (tras el Gate 1 — dueño: contract-engineer)

- [x] 2.1 Añadir a `docs/api-spec.yml` `POST /reservas/{id}/documentos-evento`
      (multipart/form-data; campos `archivo` binario + `tipo` enum
      `dni_anverso|dni_reverso|clausula_responsabilidad`; `@Roles('gestor')`) con respuestas
      201 / 400 / 401 / 403 / 404 / 422 (formato de error del proyecto con `codigo`).
- [x] 2.2 Añadir `GET /reservas/{id}/documentos-evento/checklist` con respuesta 200
      (`{ items: [{ tipo, completado, documento? }] }`) y 401 / 403 / 404.
- [x] 2.3 Validar el contrato (`spectral lint docs/api-spec.yml`; hook `validate-openapi`).
- [x] 2.4 Regenerar el SDK del frontend desde el contrato (NUNCA editar el cliente a mano;
      hook `protect-generated-client`).

## 3. Tests primero — TDD RED (OBLIGATORIO — tdd-first — dueño: tdd-engineer)

- [x] 3.1 Tests de la **guarda de precondición de estado**
      (`esEstadoQuePermiteDocumentacionEvento`): acepta `evento_en_curso`, rechaza el resto
      (incluidos terminales). (Máquina de estados / guarda declarativa.)
- [x] 3.2 Tests del **use-case de subida** (dominio/aplicación) con puertos dobles: happy path
      (crea DOCUMENTO + audita + checklist), no-idempotencia (2ª subida del mismo tipo → 2 filas,
      histórico preservado), transacción all-or-nothing (fallo → rollback), `tenant_id` heredado
      de la reserva.
- [x] 3.3 Tests de **validación autoritativa**: formato no admitido, `tamano_bytes = 0`
      (vacío/corrupto), fichero ausente, tamaño > 10 MB, `tipo` no permitido → sin efectos.
- [x] 3.4 Tests del **checklist** (derivación por lectura): existencia ≥ 1 por tipo, ítem
      completado toma el más reciente, RLS (no cuenta otro tenant).
- [x] 3.5 Tests de la **generalización del `DocumentoRepositoryPort`**: `crear` acepta los tres
      tipos del evento; el método de listado devuelve las filas por reserva/tipo ordenadas;
      US-023 (`condiciones_particulares`) sigue verde (sin regresión).
- [x] 3.6 Confirmar que TODOS los tests nuevos están en **ROJO** antes de implementar
      (hook `require-tests-first`).

## 4. Backend: implementación (dueño: backend-developer) + revisar tests unitarios (OBLIGATORIO — step-N)

- [x] 4.1 Generalizar `DocumentoRepositoryPort` (union de tipos de dominio + método de listado)
      y su adaptador Prisma, sin romper US-023 (hexagonal: puerto puro en `documentos/domain`,
      adaptador en infra).
- [x] 4.2 Guarda de precondición declarativa de estado (`evento_en_curso`).
- [x] 4.3 Use-case de subida (transacción atómica + RLS: subir al almacén durable, crear
      DOCUMENTO, AUDIT_LOG `crear`) y servicio de checklist (lectura derivada).
- [x] 4.4 Controller multipart `POST /reservas/{id}/documentos-evento` (FileInterceptor, mapeo de
      errores de dominio a 422/404) y `GET .../checklist`, reutilizando el patrón de
      `confirmar-senal`.
- [x] 4.5 Revisar/actualizar tests unitarios existentes impactados (repositorio de DOCUMENTO,
      US-023); poner en verde los nuevos.
- [x] 4.6 `pnpm lint` + `pnpm typecheck` en verde (arrow functions; hexagonal; sin locks
      distribuidos).

## 5. Frontend: implementación (dueño: frontend-developer)

- [x] 5.1 Feature `documentacion-evento` (o dentro de la feature de la ficha) con barrel:
      vista de checklist mobile-first (tres ítems ✅/pendiente) alimentada por el GET.
- [x] 5.2 Acción de subida por ítem (captura de cámara móvil / selección de fichero) con
      validación de formato en frontend (JPEG/PNG/PDF) y mensaje de error; usa el SDK generado.
- [x] 5.3 Refresco del checklist en tiempo real tras cada subida; permitir re-subida (N3).
- [x] 5.4 Responsive verificada (390 / 768 / 1280); `components/` solo `.tsx`; `pnpm lint` verde.

## 6. QA: unit tests + verificación de BD (OBLIGATORIO — step-N+1 — EL AGENTE DEBE EJECUTARLO)

- [x] 6.1 Capturar baseline de BD (`DOCUMENTO`, `AUDIT_LOG`) de la reserva de prueba.
- [x] 6.2 Ejecutar tests dirigidos de los módulos cambiados (documentacion-evento + documentos).
- [x] 6.3 Ejecutar la suite requerida (`pnpm test`); registrar totales/flaky.
- [x] 6.4 Verificar estado posterior de BD y restaurar si hace falta.
- [x] 6.5 Crear report
      `openspec/changes/us-033-capturar-documentacion-evento/reports/YYYY-MM-DD-step-N+1-unit-test-and-db-verification.md`.
- [x] 6.6 Marcar completado solo tras tests en verde y report creado.

## 7. QA: pruebas manuales con curl (OBLIGATORIO — step-N+2 — EL AGENTE DEBE EJECUTARLO)

- [x] 7.1 Levantar el backend con BD real (los subagentes sin Postgres no bastan; ejecutar desde
      sesión con Postgres) y una RESERVA en `evento_en_curso`.
- [x] 7.2 `POST /reservas/{id}/documentos-evento` (multipart) con JPEG/PNG/PDF válido por tipo →
      201, verificar DOCUMENTO creado, `url`, checklist; restaurar BD.
- [x] 7.3 `GET /reservas/{id}/documentos-evento/checklist` → 200, verificar los tres ítems.
- [x] 7.4 Re-subir el mismo tipo → 201 y 2 filas DOCUMENTO (histórico); restaurar BD.
- [x] 7.5 Casos de error: formato no admitido, `tamano_bytes = 0`, fichero ausente, > 10 MB,
      `tipo` no permitido, estado ≠ `evento_en_curso` → 422; reserva de otro tenant → 404;
      verificar formato de error del contrato.
- [x] 7.6 Crear report
      `.../reports/YYYY-MM-DD-step-N+2-curl-endpoint-tests.md` con comandos y respuestas.

## 8. QA: E2E con Playwright MCP (OBLIGATORIO — hay frontend — step-N+3 — EL AGENTE DEBE EJECUTARLO)

- [x] 8.1 Levantar frontend + backend con una RESERVA en `evento_en_curso`.
- [x] 8.2 Navegar a la ficha, abrir el checklist de documentación (mobile-first).
- [x] 8.3 Subir los tres documentos y verificar que el checklist pasa a ✅ en tiempo real.
- [x] 8.4 Probar formato no admitido (mensaje de error) y re-subida del mismo tipo.
- [x] 8.5 Verificar persistencia (BD coincide con la UI) y responsive en 390 / 768 / 1280.
- [x] 8.6 Restaurar entorno y BD; mover capturas a `reports/e2e-screenshots/` del change.
- [x] 8.7 Crear report `.../reports/YYYY-MM-DD-step-N+3-e2e-playwright.md`.

## 9. Docs: actualizar documentación técnica (OBLIGATORIO — step-N+4 — dueño: docs-keeper)

- [x] 9.1 Actualizar la doc técnica afectada (endpoints, capability `documentacion-evento`,
      nota de reutilización del almacén y del repo de DOCUMENTO generalizado) sin desalinear
      `er-diagram.md`/`use-cases.md`.

## 10. Code review (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO)

- [x] 10.1 Ejecutar `code-reviewer` sobre el diff contra los guardrails (hexagonal, RLS, sin
      locks distribuidos, contrato/SDK, arrow-functions, responsive, `components/` solo `.tsx`).
- [x] 10.2 Dejar informe `.../reports/YYYY-MM-DD-step-review-code-review.md` con la línea literal
      `Veredicto: APTO` (si NO APTO → volver a implementación y repetir).

## 11. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final — PARADA)

- [x] 11.1 Tras code-review APTO + validación manual, **ESPERAR el OK humano** antes de
      archive/PR.

## 12. Archivar change + abrir PR (OBLIGATORIO — archive — solo tras gate final y APTO)

- [x] 12.1 `openspec archive us-033-capturar-documentacion-evento` (el hook `require-code-review`
      bloquea sin informe APTO); actualizar `openspec/specs/` (verificar una sola sección ADDED
      por requirement).
- [x] 12.2 Abrir PR (GitHub MCP o `gh`) y actualizar frontmatter de la US (estado/pr).

# Tasks — documentos-config-tenant-storage (6.1a)

> Rebanada de **solo cimientos**: NO genera PDF, NO instala `@react-pdf/renderer`,
> NO toca los adapters *fake*, **NO** tiene endpoint HTTP. Por eso este `tasks.md`
> **salta** las fases de contrato OpenAPI/SDK, frontend y E2E Playwright. El QA es
> unit tests + un **test de integración SQL real** ejecutado desde la sesión
> principal (que tiene Postgres). El agente DEBE ejecutar él mismo las pruebas;
> nunca las delega en el usuario.

## 0. Setup: crear feature branch (OBLIGATORIO — step-0 — PRIMER PASO)

- [x] 0.1 Crear branch `feature/documentos-config-tenant-storage` desde `master`
- [x] 0.2 Verificar la branch creada y la branch actual

## 1. ⏸ Gate revisión humana SDD (OBLIGATORIO — review-gate-sdd)

- [x] 1.1 Presentar al humano `proposal.md` + spec-delta (`specs/documentos/spec.md`)
      + `design.md` y **ESPERAR su OK explícito** — APROBADO 2026-07-13
- [x] 1.2 Decisión cuestión A: **A1 (duplicar)** — la config es fuente de verdad para documentos; Tenant no se toca
- [x] 1.3 Decisión cuestión B: **B1 (local ahora, cloud luego)** — adaptador dev/local por env `ALMACEN_PROVIDER=local|s3`; cloud cuando haya credenciales

## 2. Tests primero — TDD RED (OBLIGATORIO — tdd-first)

- [x] 2.1 Test unitario del contrato de `AlmacenDocumentosPort` con doble/adaptador
      local: `subir(bytes, clave)` resuelve una URL; `urlPublica(clave)` devuelve
      URL para esa clave. **Sin credenciales cloud.** (RED) →
      `src/documentos/domain/__tests__/almacen-documentos.port.spec.ts`
- [x] 2.2 Test unitario del repositorio de lectura de `PlantillaDocumentoTenant`
      con doble (resuelve la config del tenant; aísla por tenant). (RED) →
      `src/documentos/application/__tests__/obtener-configuracion-documento.service.spec.ts`
- [x] 2.3 Test que verifica que el `plantilla_concepto_fiscal` sembrado usa
      "espai" y **nunca** "lloguer". (RED) →
      `src/documentos/infrastructure/__tests__/configuracion-documento-piloto.spec.ts`
- [x] 2.4 Confirmar que los tests fallan por ausencia de implementación (RED real:
      `TS2307`, módulos de producción inexistentes). Integración SQL real esbozada
      con `describe.skip` (fase 4 QA, Postgres):
      `src/documentos/infrastructure/__tests__/configuracion-documento-integracion.spec.ts`

## 3. Backend: implementación + revisar/actualizar tests unitarios (OBLIGATORIO — step-N)

- [x] 3.1 **Dominio**: definir `AlmacenDocumentosPort` (interfaz) y el tipo/VO de
      configuración de documento en `domain/` (sin imports de framework/infra;
      hook `no-infra-in-domain`)
- [x] 3.2 **Prisma**: añadir modelo `PlantillaDocumentoTenant` (1-1 con `Tenant`,
      `tenant_id UNIQUE` + FK, PK uuid) y la relación inversa en `Tenant`
- [x] 3.3 **Migración Prisma**: generar la migración de la tabla
      `plantilla_documento_tenant` **incluyendo `ENABLE ROW LEVEL SECURITY` + POLICY
      por `current_setting('app.tenant_id')`** (patrón del resto de tablas)
      — SQL escrito a mano en `prisma/migrations/20260713140000_documento_config_tenant/`
      (NO aplicada: sin Postgres; la aplica la sesión principal en fase 4)
- [x] 3.4 **Infraestructura**: adaptador Prisma del repositorio de lectura de la
      config + adaptador de `AlmacenDocumentosPort` seleccionable por env
      (según decisión de la cuestión abierta B)
- [x] 3.5 **Aplicación**: servicio/caso de uso de lectura de la config del tenant
      (para que 6.1b lo consuma) + wiring de puertos en el módulo NestJS
- [x] 3.6 **Seed**: sembrar la `PlantillaDocumentoTenant` del piloto Masia l'Encís
      con los datos reales (razón social "Canoliart, SL", nombre comercial "Masia
      l'Encís", NIF "B10874287", dirección, web, email, IBAN
      "ES30 0182 1683 4002 0172 9599", beneficiario, concepto, textos). Idempotente
      (`deleteMany` + `create`) — NO ejecutado (sin Postgres; lo corre fase 4)
- [x] 3.7 Revisar/actualizar tests unitarios existentes afectados; poner en VERDE
      los tests de la fase 2. `pnpm lint` + `pnpm typecheck` en verde (arrow-functions)

## 4. QA: unit tests + verificación de BD e integración SQL real (OBLIGATORIO — step-N+1 — EL AGENTE DEBE EJECUTARLO)

> El **test de integración SQL real** (tabla + `UNIQUE` + RLS + seed idempotente)
> se ejecuta desde la **sesión principal** (que tiene Postgres); los subagentes QA
> no tienen BD. Base de datos aislada `slotify_test` (`.env.test`).

- [x] 4.1 Baseline de BD capturado (tabla creada por migración; counts por tenant)
- [x] 4.2 Tests dirigidos del módulo `documentos` en verde
- [x] 4.3 Suite del módulo (`documentos`) 21/21 verde; flaky conocida US-004 (40P01) ajena al change
- [x] 4.4 Migración aplicada a Postgres real (`slotify_test`+`slotify_dev`); integración SQL 6/6: tabla + `UNIQUE(tenant_id)` + FK + RLS habilitada + policy `tenant_isolation`; aislamiento verificado a nivel de aplicación (hallazgo: RLS bypaseada para el owner sin FORCE — patrón preexistente de todo el schema; ver report)
- [x] 4.5 `pnpm db:seed` ejecutado 2× contra `slotify_dev`: 1 sola fila del piloto con datos reales; concepto "espai", sin "lloguer" → **idempotente**
- [x] 4.6 Estado posterior verificado (dev con seed canónico; test limpio en afterAll)
- [x] 4.7 Report creado: `reports/2026-07-13-step-4-unit-test-and-db-verification.md`
- [x] 4.8 Completado: tests verde + BD verificada + report

## 5. QA: pruebas manuales con curl (OBLIGATORIO — step-N+2 — NO APLICA en 6.1a)

- [x] 5.1 **NO APLICA** (sin endpoint HTTP): constancia dejada en el report de fase 4. BD/RLS/seed cubiertos por la integración SQL.

## 6. QA: E2E con Playwright MCP (OBLIGATORIO si hay frontend — step-N+3 — NO APLICA en 6.1a)

- [x] 6.1 **NO APLICA** (sin frontend; la UI de ajustes es 6.5). Sin E2E.

## 7. Docs: actualizar documentación técnica (OBLIGATORIO — step-N+4)

- [x] 7.1 Documentar la nueva entidad `PlantillaDocumentoTenant` en `docs/er-diagram.md`
      (bloques branding/identidad/banca/textos, 1-1 con Tenant, RLS) y su relación
      — docs-keeper 13/07/2026: añadidos §3.3, §5.7, decisión n.º 11, entidad Mermaid, relación TENANT||--||PLANTILLA_DOCUMENTO_TENANT, versión 4.5
- [x] 7.2 Documentar el puerto `AlmacenDocumentosPort` y la selección de adaptador
      por env (variables de entorno) en la doc de arquitectura/infra que corresponda
      — docs-keeper 13/07/2026: añadido §2.19 en docs/architecture.md; actualizada fila Storage en §2.3
- [x] 7.3 Roadmap del épico (`epico-6-documentos-pdf-roadmap` en memoria) marcado 6.1a EN PROGRESO

## 8. Code review (OBLIGATORIO — code-review — EL AGENTE DEBE EJECUTARLO)

- [x] 8.1 Ejecutar `code-reviewer` sobre el diff (guardrails: hexagonal —puerto en
      dominio sin infra—, multi-tenant + RLS, arrow-functions, sin PDF/adapters fake
      tocados, alcance 6.1a respetado)
- [x] 8.2 Dejar informe `openspec/changes/documentos-config-tenant-storage/reports/YYYY-MM-DD-step-review-code-review.md`
      con la línea literal `Veredicto: APTO` (si NO APTO, volver a fase 3)

## 9. ⏸ Gate revisión humana final (OBLIGATORIO — review-gate-final)

- [x] 9.1 Tras code-review APTO + verificación de BD/seed — **OK humano APROBADO 2026-07-13**

## 10. Archivar change + abrir PR (OBLIGATORIO — archive)

- [x] 10.1 `openspec archive documentos-config-tenant-storage` — archivado 2026-07-13; spec viva `openspec/specs/documentos/` creada (+5 requirements)
- [x] 10.2 PR de `feature/documentos-config-tenant-storage` a `master` abierto

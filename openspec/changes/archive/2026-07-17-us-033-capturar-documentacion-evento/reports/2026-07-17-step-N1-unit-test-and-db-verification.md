# QA · Paso N+1 — Tests unitarios/integración + verificación de estado BD (US-033)

Fecha: 2026-07-17 · Change: `us-033-capturar-documentacion-evento` · Ejecutado desde la **sesión principal** (con Docker/Postgres).

## Tests backend (Jest)

Ejecutados solo los ficheros de US-033 + regresiones del puerto DOCUMENTO generalizado (no `pnpm test` global, para evitar las suites flaky pre-existentes: react-pdf ESM y US-004 concurrency).

| Suite | Resultado |
|---|---|
| `reservas/domain/__tests__/guarda-documentacion-evento.spec.ts` | ✅ |
| `documentacion-evento/__tests__/subir-documento-evento.use-case.spec.ts` | ✅ |
| `documentacion-evento/__tests__/obtener-checklist-documentacion-evento.query.spec.ts` | ✅ |
| `documentos/domain/__tests__/documento.repository.port.spec.ts` | ✅ |
| `documentacion-evento/__tests__/documentos-evento.controller.http.spec.ts` | ✅ |
| **Total unit/http US-033** | **7 suites / 145 tests PASS** (reporte backend-developer) |

### Integración con BD real (Postgres aislado `slotify_test_033`, `.env.test`)

`documentacion-evento/__tests__/documentacion-evento-integracion.spec.ts` → **7/7 PASS**.
Cubre: persistencia real de la fila DOCUMENTO (url/mime/tamaño/tenant heredado) + `AUDIT_LOG` `crear`/`DOCUMENTO`; no-idempotencia real (2 filas mismo tipo); checklist derivado por lectura; consultable en `post_evento`; guarda de estado real; RLS cross-tenant (404).

> La BD de test estaba sin sembrar (worktree nuevo): fallaba `cliente_tenant_id_fkey`. Resuelto ejecutando el seed (`prisma db seed`) contra `slotify_test_033` (tenant piloto `…0001`). Tras el seed, 7/7 verde.

### Regresión del puerto DOCUMENTO generalizado (US-023 / US-024) contra BD real

`registrar-firma-condiciones-integracion.spec.ts` + `reenviar-e3-integracion.spec.ts` → **2 suites / 13 tests PASS**.
Confirma que relajar `tipo` (literal → union `TipoDocumentoDominio`) y añadir `listarPorReservaYTipos` **no rompe** el flujo idempotente de condiciones particulares.

## Lint + build

- `apps/api`: `pnpm lint` limpio; `pnpm --filter api build` (tsc) limpio (reporte backend-developer).
- `apps/web`: `pnpm lint` limpio; `pnpm typecheck` sin errores; `pnpm build` OK; 213 tests verdes (reporte frontend-developer).

## Verificación de estado BD (tras las pruebas curl del paso N+2)

Reserva de prueba `d46fda4c-…` (estado `evento_en_curso`):

- `SELECT count(*) FROM documento WHERE reserva_id = …` → **3** (`dni_anverso`×2 + `clausula_responsabilidad`×1). Las subidas rechazadas (422/404) dejaron **0** filas → validación autoritativa previa a mutar confirmada.
- `AUDIT_LOG` `accion='crear'`, `entidad='DOCUMENTO'` para la reserva → **3** (una por subida exitosa).
- No-idempotencia confirmada en BD: 2 filas `dni_anverso` (histórico preservado, sin sobrescritura).

**Veredicto paso N+1: OK.**

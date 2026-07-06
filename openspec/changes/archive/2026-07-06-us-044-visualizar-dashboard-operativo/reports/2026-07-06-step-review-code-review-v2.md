# Code-review v2 — US-044 Visualizar Dashboard Operativo

- **Fecha**: 2026-07-06
- **Rama**: `feature/us-044-visualizar-dashboard-operativo`
- **Alcance**: segunda pasada. Verificación del fix del hallazgo H1 (v1 emitió `NO APTO`).
- **Modo**: solo lectura (sin edición de código, sin archive, sin PR).

## Antecedente

La primera pasada (`2026-07-06-step-review-code-review.md`) emitió **NO APTO** por H1:
`DashboardItem.fechaEvento` era no-nullable en el contrato, pero una reserva en
estado `2a` (sin fecha de evento) emite `null` → mismatch contrato ↔ datos y
riesgo de `Invalid Date` en el frontend.

## Verificación del fix H1 (3 capas)

Coherencia confirmada en las tres capas; `fechaEvento` es nullable de extremo a extremo:

1. **Contrato** — `docs/api-spec.yml:4444-4449`: `fechaEvento` con `type: string`,
   `format: date`, `nullable: true`, y descripción del caso `null` (estado 2a). Se
   mantiene en `required` (líneas 4430), coherente con "presente pero anulable".
2. **SDK generado** — `apps/web/src/api-client/schema.d.ts:3754`: `fechaEvento: string | null`.
   Regenerado, no editado a mano (commit `cacfe11`).
3. **Backend**
   - Dominio `apps/api/src/dashboards/domain/dashboard.types.ts:33,62`: `fechaEvento: string | null`.
   - DTO `apps/api/src/dashboards/interface/dashboard.dto.ts:35-36`: `@ApiProperty({ ..., nullable: true })` + `fechaEvento!: string | null`.
   - Use-case `application/consultar-dashboard.use-case.ts:135-138,239-243`: filtra
     `r.fechaEvento !== null` antes de comparar ventanas temporales; orden con guardas non-null correctas.
4. **Frontend**
   - `features/dashboard/lib/fecha.ts:11-18`: `formatearFechaEvento(iso: string | null)` devuelve `"Sin fecha"` cuando `iso === null` (evita `Invalid Date`); mantiene el anclaje a mediodía UTC contra el off-by-one de TZ.
   - `features/dashboard/components/WidgetItem.tsx:26`: prop `fechaEvento: string | null`.
   - `features/dashboard/components/WidgetCard.tsx:73`: pasa `item.fechaEvento` (tipado del SDK) sin cast; el tipo fluye limpio.

**Conclusión H1: RESUELTO y consistente en las 3 capas.**

## Regresiones

- **Backend unit tests**: `pnpm jest src/dashboards` → **19/19 passed** (2 suites). Sin regresión.
- **Frontend typecheck**: `pnpm tsc --noEmit` → **sin errores**. El tipo `string | null` fluye contrato → SDK → WidgetCard → WidgetItem → formatearFechaEvento sin cast ni mismatch.
- **Hexagonal**: `dashboards/domain/` y `dashboards/application/` sin imports de `@nestjs/*`, `@prisma/*` ni `infrastructure/` (verificado). El filtrado `tenant_id` + `activo` vive en el adaptador Prisma; el use-case no cruza tenants.
- Los commits de fix (`cacfe11`, `077bee3`) son quirúrgicos (contrato+SDK y frontend respectivamente) y no tocan lógica ajena a H1.

## Estado de commits (git)

- Módulo backend `apps/api/src/dashboards/`: **commiteado** (`c9905d8`, fixes en `cacfe11`).
- Contrato + SDK: **commiteado** (`fcb0413`, `cacfe11`).
- Frontend dashboard: **commiteado** (`cde5bc5`, `077bee3`).
- **Sin `??` para el módulo dashboards** en `git status`. Confirmado.
- Untracked (aceptable, se commitean al archivar):
  - `e2e/us-044-dashboard.spec.ts`
  - `openspec/changes/us-044-visualizar-dashboard-operativo/` (incluye `reports/`)
  - `.playwright-mcp/` (artefacto de herramienta, ajeno a la US)

## Recomendaciones no bloqueantes

- **R1 (Baja)**: al archivar, incluir en el commit `e2e/us-044-dashboard.spec.ts` y el
  directorio `openspec/changes/us-044-.../` (specs vivas + reports), como es el flujo habitual.
- **R2 (Baja/informativa)**: `.playwright-mcp/` no está en `.gitignore`; conviene ignorarlo
  para que no aparezca como untracked en futuras ramas (fuera del alcance de esta US).

## Veredicto

**Veredicto: APTO**

H1 resuelto y verificado en contrato, backend y frontend. Sin regresiones (19/19 backend, tsc limpio). Sin nuevos bloqueantes. Las observaciones son menores y no condicionan el merge.

# Change: us-050-pipeline-reservas-kanban-listado

## Why

US-050 (UC-37 Kanban, UC-38 Listado, prioridad **Alta**) reemplaza el
`SectionPlaceholder` de la ruta `/reservas` por la **pantalla funcional del
pipeline de reservas**: una vista con dos tabs — **"Flujo de Reserva"** (Kanban
de 5 columnas) y **"Listado"** (tabla responsive) — que dan al gestor visibilidad
global del estado de todas sus reservas activas sin navegar ficha a ficha.

Resuelve dos dolores: **D2** (cero visibilidad del pipeline — imposible priorizar
follow-ups) y **D7** (sin dashboards — gestión por intuición). (Fuente:
`US-050 §Historia`, `§Contexto de Negocio`, `§Impacto de Negocio`.)

Es una US **fundamentalmente de frontend y de solo lectura**: **consume el
endpoint existente `GET /reservas`** (`operationId: listarReservas`, entregado por
US-049 / PR #51) vía el **SDK generado**. NO añade ni modifica endpoints, NO muta
estado y NO introduce transiciones de la máquina de estados (el clic en tarjeta o
fila solo **navega** a la FichaConsulta). (Fuente: `US-050 §Notas de alcance`,
`§Reglas de Validación`.)

> **Sin impacto en el contrato OpenAPI.** El schema `Reserva` (`docs/api-spec.yml`
> ~L2721) ya expone **todos** los campos que la UI necesita — ver §Impacto. Este
> es un change **frontend-only, sin cambio de contrato ni regeneración de SDK**.

> Dependencias duras satisfechas: **US-049** (`GET /reservas` — COMPLETADA, PR #51)
> y **US-001** (sesión activa con `tenant_id` en el JWT). Se reutiliza la branch ya
> creada `feature/us-049-050-pipeline-reservas` (Step 0 de branch cubierto).

## Ampliación de scope (aprobada por el humano)

> **Hallazgo de QA de US-050 (verificado contra las fuentes de verdad, real).**
> Durante la verificación de la pantalla se detectó que **el backend de US-049
> `GET /reservas` NO es conforme al contrato OpenAPI congelado**. El frontend de
> US-050 está tipado correctamente contra el contrato, así que la vista queda **NO
> funcional con datos reales** (navegación a `/reservas/undefined`, sin fecha, sin
> aforo, sin nota). Hoy el defecto está **oculto** porque el seed solo contiene una
> reserva terminal (pipeline vacío → `data: []`). Por decisión aprobada, **US-050
> AMPLÍA su scope** para incluir el **fix de conformidad de contrato del backend
> `GET /reservas`** entregado por US-049.

- **El contrato NO cambia** — ya es correcto. `ReservaListResponse.data` son objetos
  `Reserva` (`docs/api-spec.yml` ~L2721), cuyo `id` es **`idReserva`** (required) y
  que exponen `fechaEvento`, `numInvitadosFinal`, `numAdultosNinosMayores4`,
  `numNinosMenores4`, `notas` (opcionales) además de los derivados US-049
  (`nombreEvento`, `progressLogistica`, `progressLiquidacion`). **No se edita
  `api-spec.yml` ni se regenera el SDK.**
- **Lo que cambia es la implementación** que proyecta la respuesta, para alinearla
  al contrato ya existente. La divergencia está en la **capa de proyección**, no en
  la lectura de datos:
  - `apps/api/src/reservas/interface/listar-reservas.dto.ts` — la clase
    `ReservaPipelineItemDto` declara `id` (en vez de `idReserva`) y **omite**
    `fechaEvento`, `numInvitadosFinal`, `numAdultosNinosMayores4`,
    `numNinosMenores4`, `notas`. Debe **renombrar `id`→`idReserva`** y **añadir**
    esos cinco campos con su forma del contrato (`fechaEvento` `date` nullable;
    aforo `integer` nullable; `notas` `string` nullable).
  - `apps/api/src/reservas/interface/listar-reservas.controller.ts` — el método
    `aResponse()` mapea `id: item.id` y no reenvía los cinco campos: debe emitir
    `idReserva` y propagarlos.
  - `apps/api/src/reservas/application/listar-reservas.use-case.ts` — la interfaz
    `ReservaPipelineItem` y el método `proyectar()` deben transportar `idReserva` +
    los cinco campos (el read-model ya los trae).
  - **Adaptador Prisma** (`listar-reservas.prisma.adapter.ts`): su read-model
    `PipelineReservaLectura` **YA lee** `idReserva`, `fechaEvento`,
    `numInvitadosFinal`, `numAdultosNinosMayores4`, `numNinosMenores4` y `notas`
    de la BD; **no requiere cambios de query salvo confirmación** — solo hay que
    dejar de descartarlos aguas arriba (use-case + controller). Se revisa por
    completitud.
- **TDD primero (gate-friendly):** un test RED de **conformidad de contrato** del
  `GET /reservas` (cada elemento de `data` expone `idReserva` y los cinco campos)
  antes de la implementación; luego se re-ejecuta QA (unit + curl + E2E) sobre el
  seed con datos activos representativos.
- **Guardrails que este fix SÍ toca:** es un cambio de **backend** (rompe el
  supuesto original "frontend-only" **solo** para este fix de conformidad). Sigue
  siendo **solo lectura** (sin mutación, sin transiciones, sin cambio de contrato
  ni de SDK, sin migración de esquema).
- Trazabilidad del fix: **US-049** (`GET /reservas`, contrato congelado), **US-050**
  (consumidor que expone el defecto), **UC-37/UC-38**; schema `Reserva`
  (`docs/api-spec.yml` ~L2721).

## What Changes

> Alcance estricto: **construir la pantalla `/reservas`** (Kanban + Listado) que
> consume `GET /reservas`. Sin cambios de backend, sin cambios de contrato, sin
> mutación. Los avatares de equipo del Figma quedan **fuera de MVP** (requieren
> entidad de asignación de equipo aún inexistente). Las transiciones de estado
> inline en el Kanban quedan **fuera de alcance** (por ahora, clic → navega).
> (Fuente: `US-050 §Notas de alcance`.)

- **Pantalla `/reservas` con dos tabs** (nueva capability de presentación
  `pipeline` en la capa de vista; la capability backend `pipeline` de US-049 sigue
  siendo dueña de la lectura del endpoint):
  - **Tab "Flujo de Reserva" (Kanban)** — activo por defecto — con **5 columnas**
    agrupadas por fase y **scroll horizontal**: `Consulta` · `Pre-reserva` ·
    `Confirmada` · `En Curso` · `Post-evento`. (Fuente: `US-050 §Happy Path — Kanban`.)
  - **Tab "Listado"** — tabla responsive con columnas `Nombre · Estado · Fecha ·
    Aforo · Acciones`, alimentada por el **mismo hook** que el Kanban.
    (Fuente: `US-050 §Happy Path — Listado`.)
- **Agrupación fase → columna Kanban** (mapa declarativo, no lógica dispersa):
  - `2a`, `2b`, `2c`, `2d`, `2v` → **Consulta**
  - `pre_reserva` → **Pre-reserva**
  - `reserva_confirmada` → **Confirmada**
  - `evento_en_curso` → **En Curso**
  - `post_evento` → **Post-evento**
  (Fuente: `US-050 §Happy Path`, `§Mapping fase → columna Kanban`.)
- **Tarjeta de reserva (Kanban)**: nombre del evento (`nombreEvento`), fecha
  (`fechaEvento`) + aforo (pax), barra de progreso **LOGÍSTICA** (`progressLogistica` %)
  y barra **LIQUIDACIÓN** (`progressLiquidacion` %), y **nota de estado** si existe
  (`notas`). Icono de enlace / clic en tarjeta → **navega** a `/reservas/{idReserva}`.
  (Fuente: `US-050 §Happy Path — Kanban`.)
- **Estados de la vista** (sobre la misma carga de `GET /reservas`):
  - **Vacío** (FA-01): columnas Kanban vacías con estado descriptivo + CTA
    "Nueva Reserva".
  - **Carga** (FA-02): skeleton (columnas con tarjetas fantasma), sin errores de UI.
  - **Error** (FA-03): estado de error con opción de **reintento** cuando
    `GET /reservas` falla (red o 5xx).
  (Fuente: `US-050 §FA-01`, `§FA-02`, `§FA-03`.)
- **Responsive mobile-first (regla dura)** (FA-04): en `<lg` el Kanban conserva
  **scroll horizontal** (no columnas apiladas) y el Listado adapta las filas a
  **tarjetas apiladas**. Verificado en 390 / 768 / 1280. (Fuente: `US-050 §FA-04`;
  `CLAUDE.md §Web responsive`.)
- **Filtrado de reservas activas**: la vista muestra únicamente las reservas que
  `GET /reservas` ya devuelve (US-049 **excluye siempre** terminales `2x`/`2y`/`2z`,
  `reserva_completada`, `reserva_cancelada` y aísla por `tenant_id` + RLS). La UI
  **no reimplementa** ese filtro; confía en el endpoint. (Fuente: `US-050 §Reglas
  de Validación`; spec viva `pipeline`.)

## Impact

- **Contrato OpenAPI (`docs/api-spec.yml`): SIN CAMBIOS.** El schema `Reserva`
  (~L2721) que devuelve `GET /reservas` (`ReservaListResponse`) ya expone **todo**
  lo que la UI consume:
  - nombre del evento → `nombreEvento` (derivado, añadido en US-049)
  - fecha → `fechaEvento`
  - aforo / pax → `numInvitadosFinal` (+ `numAdultosNinosMayores4`,
    `numNinosMenores4` como desglose)
  - estado / fase → `estado` (`EstadoReserva`) + `subEstado` (`SubEstadoConsulta`)
  - progreso logística % → `progressLogistica` (0-100, derivado, US-049)
  - progreso liquidación % → `progressLiquidacion` (0-100, derivado, US-049)
  - nota de estado → `notas` (nullable)
  - navegación a ficha → `idReserva`
  No falta ningún campo → **no se añade nada al contrato ni se regenera el SDK**;
  se reutiliza el cliente tipado ya existente (`listarReservas`).
- Specs afectadas: **nueva capability de presentación `pipeline-ui`** (pantalla
  Kanban + Listado que consume `GET /reservas`). NO modifica la capability backend
  `pipeline` (US-049, dueña de la lectura del endpoint), ni `consultas` (dueña del
  ciclo de vida del agregado `RESERVA`), ni `app-shell`, `dashboard`, `calendario`.
- Código afectado (implementación posterior, fuera de este change de spec) —
  **solo frontend** (`US-050 §Scope técnico / Frontend`):
  - `apps/web/src/features/reservas/pages/ReservasPage/` — `ReservasPage.tsx`
    (orquestador de tabs `flujo | listado`), `KanbanView.tsx`, `KanbanColumn.tsx`,
    `ReservaKanbanCard.tsx`, `ListadoView.tsx`, `ProgressBar.tsx`.
  - `apps/web/src/features/reservas/api/useReservasActivas.ts` — hook TanStack Query
    (`staleTime: 30_000`) sobre el SDK `listarReservas`.
  - `apps/web/src/features/reservas/index.ts` — actualizar el barrel.
  - `apps/web/src/App.tsx` — sustituir `SectionPlaceholder` en la ruta `/reservas`
    por `ReservasPage`.
  - Diseño Figma node `0:523` (`rBCYMkAoQQRVnWhOxXatio`) con los tokens de §Tokens.
- Trazabilidad: **US-050**, **UC-37** (Kanban), **UC-38** (Listado); entidad
  `RESERVA` (solo lectura, vía US-049); estados activos vs terminales
  (`CLAUDE.md §Máquina de estados`); campos `preEventoStatus`/`liquidacionStatus`
  (origen de los progresos, `er-diagram.md`).
- Dependencias: **US-049** (`GET /reservas` — COMPLETADA, PR #51), **US-001**
  (sesión — implementada).
- Código afectado por la **ampliación de scope** (fix de conformidad de contrato
  del `GET /reservas` de US-049 — ver §Ampliación de scope): DTO/controller/
  use-case de `apps/api/src/reservas/` (proyección), NO el contrato ni el SDK.
- **No-objetivos (fuera de alcance):**
  - Cualquier **cambio de contrato OpenAPI o de SDK** (el contrato ya es correcto;
    NO se edita `api-spec.yml` ni se regenera el cliente). El único cambio de
    backend admitido es el **fix de conformidad de la proyección del `GET /reservas`**
    descrito en §Ampliación de scope; ninguna otra lógica de backend entra.
  - Cualquier **mutación** de `RESERVA` (vista de solo lectura).
  - **Transiciones de estado inline** en el Kanban (arrastrar tarjeta entre
    columnas): fuera por ahora; el clic solo navega a la ficha.
  - **Avatares de equipo** de la columna "Confirmada" del Figma (requieren entidad
    de asignación de equipo — fuera de MVP).
  - **Tests de concurrencia / bloqueo atómico**: no aplica (UI de solo lectura;
    sin mutación).
  - **Filtros/paginación adicionales en la UI**: se muestran las reservas activas
    que devuelve `GET /reservas`; no se rediseñan los query params del endpoint.

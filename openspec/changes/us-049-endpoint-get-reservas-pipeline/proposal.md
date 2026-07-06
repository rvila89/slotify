# Change: us-049-endpoint-get-reservas-pipeline

## Why

US-049 (UC-37, UC-38, prioridad **Alta**) implementa el endpoint `GET /reservas`
que devuelve la **lista de reservas activas del pipeline** con los datos de
progreso ya derivados, para alimentar las vistas de **Kanban** y **Listado** de
la pantalla de Reservas **sin múltiples llamadas adicionales**. El path ya está
declarado en `docs/api-spec.yml` (~línea 194) pero **no tiene implementación** ni
`operationId`.

Resuelve dos dolores: **D2** (cero visibilidad del pipeline — imposible priorizar
follow-ups) y **D7** (sin dashboards — gestión por intuición). El gestor pasa de
no tener ninguna vista de pipeline activo a ver todas sus reservas en curso desde
un único endpoint optimizado. (Fuente: `US-049 §Historia`, `§Contexto de
Negocio`, `§Impacto de Negocio`.)

Es una operación de **lectura pura**: NO muta estado, NO produce bloqueos, NO
tiene concurrencia mutante. Refleja el estado actual de `RESERVA` (join a
`CLIENTE` para el nombre) filtrado por el `tenant_id` del JWT y reforzado por RLS.
(Fuente: `US-049 §Concurrencia / Race Conditions`.)

> Dependencias duras satisfechas: **US-001** (sesión activa con `tenant_id` en el
> JWT) y **US-003** (existen reservas en la BD). Comparte la branch
> `feature/us-049-050-pipeline-reservas` con **US-050** (ya creada; el Step 0 de
> feature branch está cubierto).

## What Changes

> Alcance estricto: **implementar la lectura del pipeline** que ya declara el
> contrato y **enriquecer aditivamente** el schema `Reserva` con tres campos de
> presentación derivados. NO muta ninguna entidad; NO cambia el `POST /reservas`
> ni las transiciones; NO rompe contratos existentes (los campos nuevos son
> opcionales). (Fuente: `US-049 §Notas de alcance`, `§Scope técnico`.)

- **Endpoint `GET /reservas` de solo lectura** (capability nueva `pipeline`):
  devuelve la lista paginada de reservas **activas** del tenant, filtrada por el
  `tenant_id` del JWT + RLS, **excluyendo** los estados terminales/cerrados `2x`,
  `2y`, `2z`, `reserva_completada` y `reserva_cancelada`, ordenada por
  `fechaCreacion` **descendente**. Reutiliza los parámetros de query ya definidos
  en la spec: `estado`, `subEstado`, `fechaDesde`, `fechaHasta`, `search`, `page`,
  `limit`. (Fuente: `US-049 §Happy Path`, `§FA-02`, `§FA-04`, `§Reglas de Negocio`.)
- **`operationId: listarReservas`** en el path `GET /reservas` existente (hoy sin
  operationId), para que el SDK del frontend genere el cliente tipado.
  (Fuente: `US-049 §Scope técnico / Contrato OpenAPI`.)
- **Cambio aditivo al schema `Reserva`** (tres campos **opcionales**, no rompen
  `ReservaDetalle`, `CreateReservaResponse`, `FichaConsulta` ni otros consumidores):
  - `nombreEvento: string` — `{cliente.nombre} {cliente.apellidos}`, con **fallback
    a `codigo`** cuando no hay cliente resoluble.
  - `progressLogistica: integer (0-100)` — derivado de `preEventoStatus`:
    `pendiente=0`, `en_curso=50`, `cerrado=100`.
  - `progressLiquidacion: integer (0-100)` — derivado de `liquidacionStatus`:
    `pendiente=0`, `facturada=50`, `cobrada=100`.
  (Fuente: `US-049 §Notas de alcance`, `§Reglas de Negocio`, `§Scope técnico`.)
- **Derivación de progreso en estados tempranos**: para consulta (`2a`, `2b`,
  `2c`, `2d`, `2v`) y `pre_reserva`, ambos progresos arrancan en **0%** (aún no
  hay sub-procesos de pre-evento ni liquidación en curso).
  (Fuente: `US-049 §Reglas de Negocio`.)
- **Scope hexagonal completo** (implementación posterior, fuera de este change de
  spec): puerto de dominio + caso de uso + adaptador Prisma (query de activas +
  join a `CLIENTE`, filtro por `tenant_id` + RLS) + controller `GET /reservas`.
  La derivación de progreso y de `nombreEvento` se modela como **función pura de
  dominio** (mapa declarativo estado→progreso), no como código disperso.
  (Fuente: `US-049 §Scope técnico / Backend (hexagonal)`; `CLAUDE.md` Arquitectura
  hexagonal / DDD.)

## Impact

- Specs afectadas: **nueva capability `pipeline`** (lectura del pipeline de
  reservas activas). NO modifica `consultas` (que sigue siendo dueña del ciclo de
  vida y las transiciones del agregado `RESERVA`), ni `ficha-operativa`,
  `facturacion`, `bloqueo-fecha` ni `app-shell`.
- Contrato OpenAPI (`docs/api-spec.yml`): añadir `operationId: listarReservas` al
  `GET /reservas` existente y **tres propiedades opcionales** al schema `Reserva`
  (`nombreEvento`, `progressLogistica`, `progressLiquidacion`); `ReservaListResponse`
  ya existe y se reutiliza. SDK del frontend regenerado (nunca editado a mano).
- Código afectado (implementación posterior, fuera de este change de spec):
  - Backend: `apps/api/src/reservas/domain/listar-reservas.port.ts` (puerto),
    `apps/api/src/reservas/application/listar-reservas.use-case.ts` (caso de uso +
    derivación pura de progreso/nombre), `apps/api/src/reservas/infrastructure/`
    `listar-reservas.prisma.adapter.ts` (query activas + join cliente, RLS por
    `tenant_id`), `apps/api/src/reservas/interface/listar-reservas.controller.ts`
    (`GET /reservas`).
  - Frontend: consumido por la pantalla de Reservas (Kanban + Listado) —
    **fuera del alcance de US-049** (US aparte); este change solo entrega el
    endpoint y el contrato.
- Trazabilidad: **US-049**, **UC-37**, **UC-38**; entidades `RESERVA`, `CLIENTE`
  (join para nombre) y campos `preEventoStatus`/`liquidacionStatus` del ER
  (`er-diagram.md`); máquina de estados (`CLAUDE.md` §Máquina de estados de
  reserva) para el conjunto de estados activos vs terminales.
- Dependencias: **US-001** (sesión con `tenant_id` en JWT — implementada),
  **US-003** (reservas en BD — implementada).
- **No-objetivos (fuera de alcance):**
  - Cualquier **mutación** de `RESERVA` o entidades relacionadas (lectura pura).
  - **Frontend** de la pantalla de Reservas (Kanban/Listado) — US aparte; sin
    E2E de Playwright en este change (no hay cambios de frontend).
  - **Concurrencia / race conditions**: no aplica (lectura pura; sin tests de
    bloqueo atómico propios). (Fuente: `US-049 §Concurrencia / Race Conditions`.)
  - Redefinir los parámetros de query ya existentes en el contrato (se mantienen
    tal cual): `estado`, `subEstado`, `fechaDesde`, `fechaHasta`, `search`,
    `page`, `limit`.

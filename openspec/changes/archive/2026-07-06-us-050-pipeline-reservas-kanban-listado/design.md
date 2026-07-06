# Design — us-050-pipeline-reservas-kanban-listado

> Decisiones técnicas de la pantalla de pipeline (Kanban + Listado). US
> **frontend-only** que consume `GET /reservas` (US-049). Sin backend, sin
> contrato, sin mutación.

## D-1 — Sin cambio de contrato: se reutiliza `GET /reservas` y su SDK

El schema `Reserva` (`docs/api-spec.yml`, envoltorio `ReservaListResponse`) ya
expone todo lo que la UI consume, por lo que **no se toca el contrato ni se
regenera el SDK**:

| Dato UI | Campo del contrato |
|---------|--------------------|
| Nombre del evento | `nombreEvento` (derivado en US-049) |
| Fecha del evento | `fechaEvento` (nullable) |
| Aforo / pax | `numInvitadosFinal` (fallback: `numAdultosNinosMayores4 + numNinosMenores4`) |
| Fase / estado | `estado` (`EstadoReserva`) + `subEstado` (`SubEstadoConsulta`) |
| Progreso logística % | `progressLogistica` (0-100, derivado en US-049) |
| Progreso liquidación % | `progressLiquidacion` (0-100, derivado en US-049) |
| Nota de estado | `notas` (nullable) — se renderiza solo si existe |
| Navegación a ficha | `idReserva` |

**Consecuencia**: el hook usa el cliente tipado `listarReservas` ya generado. El
hook `protect-generated-client` no se activa (no se edita el cliente a mano).

## D-2 — Mapa declarativo estado → columna Kanban (no lógica dispersa)

La agrupación en 5 columnas se modela como una **estructura de datos** en
`lib/` de la feature (coherente con `CLAUDE.md §Máquina de estados`: transiciones
y agrupaciones como datos, no código disperso):

```
Consulta    ← 2a, 2b, 2c, 2d, 2v      dot #6a5c52
Pre-reserva ← pre_reserva             dot #d98b74
Confirmada  ← reserva_confirmada      dot #8d4d39
En Curso    ← evento_en_curso         dot #8d4d39
Post-evento ← post_evento             dot #6a5c52
```

Una reserva se ubica por `subEstado` cuando `estado` es una consulta (los `2x`),
y por `estado` en el resto. Los estados terminales/cerrados **no llegan** a la UI
(los excluye `GET /reservas`), así que no necesitan columna; si por robustez
llegara un estado sin columna, la tarjeta se omite silenciosamente (defensivo).

## D-3 — Un único hook de datos compartido por ambos tabs

`useReservasActivas` (TanStack Query, `staleTime: 30_000`) es la **única** fuente
de datos: el Kanban y el Listado consumen el mismo `queryKey`, de modo que cambiar
de tab NO dispara una segunda llamada (satisface el criterio "mismo hook que el
Kanban" de la US). El agrupado por columnas se deriva en cliente (memoizado) a
partir de `data`.

## D-4 — Estado de tab en el orquestador (no en la URL, por ahora)

`ReservasPage` mantiene el tab activo (`flujo | listado`) en estado local, con
`flujo` por defecto. No se persiste en query param en esta iteración (la US no lo
pide); si más adelante se necesita deep-link al Listado, se añade en un change
aparte. Decisión reversible y de bajo coste.

## D-5 — Estados de vista (loading / empty / error) sobre la misma carga

Los tres estados (FA-01/02/03) se derivan del estado del query:
- `isLoading` → skeleton (columnas con tarjetas fantasma).
- éxito con `data.length === 0` → estado vacío + CTA "Nueva Reserva".
- `isError` → estado de error + botón de reintento (`refetch`).

El estado vacío y el de error se renderizan a nivel de vista (no por columna), ya
que aplican a todo el pipeline.

## D-6 — Responsive: scroll horizontal en Kanban, cards apiladas en Listado (regla dura)

Mobile-first. El Kanban usa un contenedor con overflow-x y columnas de ancho fijo
(`min-w-[320px] w-[320px]`), de modo que en `<lg` **no se apilan** sino que se
desplazan horizontalmente (criterio explícito de FA-04). El Listado usa tabla en
`≥lg` y **tarjetas apiladas** en `<lg`. Se verifica en 390 / 768 / 1280 en el E2E
y en code-review (regla dura de `CLAUDE.md §Web responsive`).

## D-7 — Tokens de diseño Figma (node 0:523)

Se aplican los tokens de `US-050 §Tokens de diseño Figma`: fondo de columna
`bg-[#f6f3ee]`, tarjeta `bg-[#fcf9f4]` con borde y sombra especificados, progress
LOGÍSTICA `#8d4d39` sobre `#eae1d6`, progress LIQUIDACIÓN `#6a5c52` sobre `#eae1d6`,
dots por columna. Se prefieren tokens/utilidades del proyecto; los hex del Figma se
consolidan en `constants.ts` de la página (no dispersos por el JSX), a validar en
code-review.

## D-8 — Estructura Bulletproof React (regla dura)

La feature vive en `apps/web/src/features/reservas/` con la página compleja como su
propia carpeta `pages/ReservasPage/` co-localizando sus partes (`KanbanView`,
`KanbanColumn`, `ReservaKanbanCard`, `ListadoView`, `ProgressBar`, `constants.ts`,
`lib/` del mapa de columnas). El barrel `features/reservas/index.ts` es la única
API pública; `App.tsx` importa `ReservasPage` solo por el barrel. `max-lines ≤300`
por archivo (lo impone ESLint). `ProgressBar` es reutilizable (label, valor %, color).

## D-9 — Fuera de alcance (registrado para trazabilidad)

- **Transiciones inline** (drag&drop entre columnas): el clic solo navega; sin
  mutación en esta US.
- **Avatares de equipo** de la columna "Confirmada" (Figma): requieren entidad de
  asignación de equipo, inexistente en el MVP.
- **Sin tests de concurrencia/bloqueo**: UI de solo lectura.

## Decisión de naming de capability

Se crea la capability de presentación **`pipeline-ui`** para no colisionar con la
capability backend **`pipeline`** (US-049, dueña de la lectura del endpoint).
`pipeline` = contrato/lectura; `pipeline-ui` = pantalla que la consume. Separa
claramente responsabilidades backend vs presentación en `openspec/specs/`.

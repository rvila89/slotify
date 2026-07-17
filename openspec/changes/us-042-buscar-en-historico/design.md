# Design — us-042-buscar-en-historico

Decisiones técnicas de la fase SDD. Sujeto al **gate de revisión humana** antes
de implementar.

## D-1 — Endpoint dedicado `GET /historico`, NO reutilizar `GET /reservas`

**Decisión**: exponer un endpoint nuevo `GET /historico`
(`operationId: listarHistorico`) en una capability nueva `historico`, en lugar de
ampliar `GET /reservas` (pipeline, US-049).

**Motivo**: la spec viva de `pipeline`
(`openspec/specs/pipeline/spec.md` §"Exclusión de estados terminales y cerrados")
declara como **invariante duro** que `GET /reservas` **excluye siempre**
`reserva_completada` y `reserva_cancelada`, "incluso cuando no se pasa filtro de
estado". El Histórico necesita el **conjunto complementario exacto**. Meter ambos
mundos en el mismo endpoint obligaría a romper esa invariante o a un modo dual
frágil. Un endpoint dedicado deja los dos contratos limpios y sin acoplar.

**Qué SÍ se reutiliza de US-049/US-050** (no reinventamos):
- El **patrón de lista paginada de solo lectura**: envoltorio `{ data[], metadata }`,
  parámetros `Page`/`Limit`, validación `page >= 1`, `limit` 1..100.
- El **adaptador Prisma de solo lectura** con aislamiento por `tenant_id` + RLS
  (mismo enfoque que el repositorio del pipeline).
- El schema `ReservaDetalle` ya existente para el **modo lectura** del detalle
  (`GET /reservas/{id}`) — no se crea endpoint de detalle nuevo.
- La feature frontend de solo lectura (patrón `features/reservas` de US-050).

**Alternativa descartada**: parámetro `incluirCerradas=true` en `GET /reservas`.
Rechazada por romper la invariante de la spec `pipeline` y mezclar campos
derivados del pipeline (`progressLogistica`/`progressLiquidacion`) que el
histórico no necesita.

## D-2 — Búsqueda full-text en PostgreSQL (`to_tsvector` + `plainto_tsquery`)

**Decisión**: búsqueda full-text nativa de PostgreSQL, sin motor externo
(Elastic/OpenSearch fuera de alcance del MVP).

**Campos**: `CLIENTE.nombre`, `CLIENTE.apellidos`, `CLIENTE.email`,
`RESERVA.codigo`, `RESERVA.notas` (y solo esos, `US-042 §Reglas de Validación`).

**Enfoque**:
- Query parametrizada vía Prisma `$queryRaw` (nunca interpolación de strings →
  sin inyección), construyendo un documento `tsvector` combinado de los cinco
  campos y aplicando `plainto_tsquery` sobre el término del gestor.
  ```sql
  WHERE to_tsvector('spanish',
          coalesce(c.nombre,'') || ' ' || coalesce(c.apellidos,'') || ' ' ||
          coalesce(c.email,'')  || ' ' || coalesce(r.codigo,'')   || ' ' ||
          coalesce(r.notas,''))
        @@ plainto_tsquery('spanish', $termino)
  ```
- **Configuración `spanish`** para stemming (p. ej. "García" tolera acentos y
  variantes según `unaccent`; se evaluará añadir `unaccent` en la implementación).
- **Índice GIN** para no degradar con históricos grandes: se crea vía **migración
  Prisma** un índice funcional GIN sobre el `tsvector` combinado. Es la **única
  mutación de esquema** del change (índice, no columna nueva). Se documenta como
  índice de rendimiento; el aislamiento por `tenant_id` sigue precediendo al match
  full-text en el plan.
- **Fallback pragmático**: si el índice funcional multi-tabla resulta inviable en
  Prisma migrate, se admite `ILIKE` acumulado sobre los cinco campos con índice
  `pg_trgm` como plan B (decisión a confirmar por `backend-developer` con datos
  reales; no cambia el contrato). El TDD fija el comportamiento observable
  (coincidencia por término), no la implementación interna.

**Highlight del término**: el destacado visual es **responsabilidad del
frontend** (marcar coincidencias en la tabla). El backend no devuelve fragmentos
resaltados; devuelve las filas que casan.

## D-3 — Filtros estructurados y su combinación

Parámetros de query de `GET /historico` (todos opcionales salvo paginación):

| Parámetro | Tipo | Semántica |
|-----------|------|-----------|
| `estadoFinal` | enum `reserva_completada \| reserva_cancelada` | Ausente → **solo** `reserva_completada`. Opt-in de canceladas. |
| `fechaDesde` | `date` | Límite inferior inclusivo de `fecha_evento`. |
| `fechaHasta` | `date` | Límite superior inclusivo de `fecha_evento`. |
| `tipoEvento` | enum `boda\|corporativo\|privado\|otro` | Filtro exacto sobre `RESERVA.tipo_evento`. |
| `importeMin` | `number` | Límite inferior de `RESERVA.importe_total`. |
| `importeMax` | `number` | Límite superior de `RESERVA.importe_total`. |
| `search` | `string` | Búsqueda full-text (D-2). |
| `page` | `integer >= 1` | Por defecto `1`. |
| `limit` | `integer 1..100` | Por defecto `20`. |

- **Combinación**: todos los filtros presentes se combinan con **AND** (cada uno
  reduce el conjunto). El filtro base inmutable (`tenant_id` + estado cerrado
  según `estadoFinal`) se aplica **siempre** antes que los filtros del usuario.
- **Orden por defecto**: `fecha_evento DESC` (`US-042 §Reglas de Negocio`). No se
  expone parámetro de orden en este change (fuera de alcance).
- **Validación**: `class-validator` en el DTO de query (rangos de fecha coherentes
  no se fuerzan; un rango invertido simplemente devuelve `data: []`). `limit`
  fuera de `1..100` → `400`.

## D-4 — Contrato OpenAPI (frontera back ∥ front)

- Nuevo path `GET /historico` con `operationId: listarHistorico`, sus parámetros
  de query y respuesta paginada. Reutiliza los parámetros `Page`/`Limit` y el
  patrón de `ReservaListResponse`. Se evaluará si la fila del histórico necesita
  un schema propio (`ReservaHistorico`, sin `progressLogistica`/
  `progressLiquidacion`) o si reutiliza `Reserva`; **decisión del
  `contract-engineer`** en la fase de contrato, sin afectar a esta spec.
- El detalle reutiliza `GET /reservas/{id}` (`ReservaDetalle`) — **sin cambio de
  contrato para el detalle**.
- Cambio de contrato ⇒ **regeneración del SDK**. El cliente HTTP del frontend se
  genera, nunca se edita a mano (hook `protect-generated-client`).

## D-5 — Modo lectura en el frontend

- Nueva ruta `/historico` y nuevo `navItem` "Histórico" (icono lucide, p. ej.
  `Archive`/`History`), añadido a `apps/web/src/components/layout/navigation.ts`
  y a `App.tsx` (hoy la nav es Dashboard · Calendario · Reservas · Métricas).
- Feature `apps/web/src/features/historico/` (Bulletproof React, barrel
  `index.ts`; `api/ components/ lib/ model/ pages/`). `components/` solo `.tsx`;
  helpers/constantes/tipos en `lib/`/`model/` (guardrail ESLint del proyecto).
- **Tabla paginada** con columnas: código, cliente (nombre+apellidos),
  `fechaEvento`, `tipoEvento`, `importeTotal`, `estado`. Barra de filtros
  estructurados + input de búsqueda con **destacado del término**.
- **Estados vacíos** diferenciados (`US-042 §edge cases`): (a) sin resultados por
  filtros → "No hay reservas completadas en el período seleccionado" + "Limpiar
  filtros"; (b) búsqueda sin coincidencias → mensaje específico; (c) tenant sin
  histórico → "Aún no hay reservas archivadas" + accesos directos a Calendario y
  Pipeline.
- **Detalle modo lectura**: reutiliza la presentación de la ficha con
  `ReservaDetalle`, renderizando **sin ningún control de edición** (no se montan
  botones de acción/transición). La inmutabilidad es de UI + ausencia de endpoint
  de mutación para estados cerrados; no hay guardas nuevas de dominio.
- **Responsive obligatorio** (regla dura del proyecto): mobile-first, verificado
  en 390/768/1280; tabla adapta a tarjetas/scroll controlado en `<lg` sin
  overflow horizontal.

## D-6 — Concurrencia

Ninguna. US-042 es **lectura pura** sobre datos en estado terminal e inmutable
(`reserva_completada`, `reserva_cancelada`); no hay ventanas de carrera. Las
garantías de atomicidad viven en US-040 (bloqueo de fecha) y US-018/019 (cola);
el histórico solo consulta el resultado final. Los tests TDD se centran en:
aislamiento multi-tenant, exclusión de estados no cerrados, opt-in de canceladas,
AND de filtros, full-text (match/no-match) y paginación/validación.

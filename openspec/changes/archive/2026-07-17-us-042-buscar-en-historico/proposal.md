# Change: us-042-buscar-en-historico

## Why

US-042 (UC-32, prioridad **Alta**) da al Gestor una **vista de Histórico** donde
**buscar y filtrar** las reservas que ya terminaron su ciclo de vida
(`reserva_completada` por defecto, opcionalmente `reserva_cancelada`) mediante
**filtros estructurados + búsqueda full-text**, y **acceder al detalle de
cualquier registro en modo lectura** (sin controles de edición).

Resuelve **D5** (histórico centralizado y consultable, fin de la dispersión entre
correos y hojas de cálculo), **D1** (gestión integral en un único sistema) y
**D9** (el gestor accede al historial de un cliente sin búsquedas manuales entre
archivos). (Fuente: `US-042 §Historia`, `§Contexto de Negocio`, `§Impacto de
Negocio`.)

Es una funcionalidad de **lectura pura** sobre datos en estado **terminal e
inmutable**. No introduce transiciones de la máquina de estados, no muta ninguna
entidad y no produce bloqueos de fecha. (Fuente: `US-042 §Concurrencia`,
`§Reglas de Validación`.)

## What Changes

### Backend — nuevo endpoint `GET /historico` (`operationId: listarHistorico`)

- **NO se reutiliza `GET /reservas`** (US-049/pipeline). Ese endpoint **excluye
  siempre** los estados cerrados `reserva_completada` y `reserva_cancelada` como
  invariante de su spec (`openspec/specs/pipeline/spec.md` §"Exclusión de estados
  terminales y cerrados"). Histórico necesita **exactamente el conjunto
  complementario**, así que exponemos un endpoint dedicado en una capability
  nueva `historico` en lugar de romper el contrato del pipeline. (Fuente:
  `US-042 §Reglas de Negocio`; decisión en `design.md §D-1`.)
- **Se reutiliza la infraestructura de lectura de US-049/US-050**: envoltorio
  paginado `ListResponse` (`data[] + metadata`), parámetros `Page`/`Limit`, el
  patrón de adaptador Prisma de solo lectura con aislamiento por `tenant_id` +
  RLS, y el schema `ReservaDetalle` ya existente para el modo lectura.
- **Filtros estructurados** (AND acumulativo): rango de `fechaEvento`
  (`fechaDesde`/`fechaHasta`), `tipoEvento` (`boda|corporativo|privado|otro`),
  `estadoFinal` (`reserva_completada` por defecto | `reserva_cancelada`),
  `importeMin`/`importeMax` (sobre `RESERVA.importe_total`).
- **Búsqueda full-text** (`search`) sobre `CLIENTE.nombre`, `CLIENTE.apellidos`,
  `CLIENTE.email`, `RESERVA.codigo` y `RESERVA.notas`, con PostgreSQL
  full-text search (`to_tsvector`/`plainto_tsquery`, ver `design.md §D-2`).
- **Orden** por `RESERVA.fecha_evento` **descendente** por defecto.
- **Paginación obligatoria** (`page >= 1`, `limit` 1..100); nunca devolución
  ilimitada.
- **Detalle en modo lectura**: se reutiliza `GET /reservas/{id}` (schema
  `ReservaDetalle`, que ya incluye `cliente`, `presupuestos`, `facturas`,
  `extras`). El modo lectura es una **responsabilidad del frontend**: no se
  exponen mutaciones para reservas en estados cerrados.

### Frontend — nueva sección "Histórico"

- Nueva entrada de navegación **"Histórico"** en `navItems` y nueva ruta
  `/historico` (hoy la nav es Dashboard · Calendario · Reservas · Métricas; no
  existe Histórico). Sustituye a nada previo; se añade limpia. (Fuente:
  `US-042 §Happy Path` "accede a la sección Histórico".)
- Feature `apps/web/src/features/historico/` (estilo Bulletproof React con barrel
  `index.ts`): tabla paginada, barra de filtros estructurados, input de búsqueda
  full-text con término destacado, estados vacíos informativos y navegación al
  detalle en **modo lectura**.
- Vista de **detalle en modo lectura**: reutiliza la ficha (`ReservaDetalle`)
  renderizando **sin ningún control de edición**. Mobile-first (390/768/1280).
- El cliente HTTP se **regenera** desde el contrato (dueño: `contract-engineer`);
  no se edita a mano.

### Contrato OpenAPI

- Se añade `GET /historico` (`listarHistorico`) con sus parámetros de query y el
  schema de respuesta paginado. Cambio de contrato → regeneración del SDK.

## Impact

- **Specs**: nueva capability `historico` (`openspec/specs/historico/spec.md`).
- **Contrato**: `docs/api-spec.yml` — nuevo path `GET /historico` + parámetros +
  respuesta. Regeneración del SDK del frontend.
- **Backend** (`apps/api`): nuevo caso de uso de lectura `listar-historico`,
  puerto de repositorio de solo lectura + adaptador Prisma (full-text + filtros +
  paginación), controller. Sin migración de esquema salvo la creación de índices
  full-text (GIN) — ver `design.md §D-2`.
- **Frontend** (`apps/web`): feature `historico`, nueva ruta y nav item,
  regeneración del cliente API.
- **Datos**: solo lectura; ninguna mutación. Aislamiento multi-tenant obligatorio
  (`tenant_id` del JWT + RLS).

## Trazabilidad

| Artefacto | Fuente |
|-----------|--------|
| US | `user-stories/US-042-buscar-en-historico.md` |
| Caso de uso | UC-32 (`docs/use-cases.md`) |
| Entidades | `RESERVA`, `CLIENTE`, `FACTURA`, `PRESUPUESTO`, `FICHA_OPERATIVA`, `DOCUMENTO` (`docs/er-diagram.md`) |
| Dependencias (satisfechas) | US-037 (archivado automático), US-038 (archivado manual), US-001 (sesión) |
| Reutiliza | US-049 (`GET /reservas` pipeline: patrón de lista paginada de solo lectura), US-050 (feature de lectura + `ReservaDetalle`) |

## Fuera de alcance

- **Edición** de reservas del histórico (son inmutables por diseño; no se exponen
  mutaciones para estados cerrados). (Fuente: `US-042 §Reglas de Validación`.)
- Estados terminales de consulta `2x`/`2y`/`2z`: NO forman parte del Histórico
  (se consultan desde el Pipeline por código). (Fuente: `US-042 §Supuestos`.)
- Exportación (CSV/PDF) del histórico, gráficas o métricas agregadas.
- Cualquier cambio en `GET /reservas` (pipeline) o su spec `pipeline`.

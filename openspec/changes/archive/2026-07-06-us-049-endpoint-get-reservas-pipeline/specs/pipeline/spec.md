# Spec Delta — Capability `pipeline`

> Capability de **lectura del pipeline de reservas activas**: expone el endpoint
> `GET /reservas` que devuelve la lista paginada de reservas en curso del tenant,
> con `nombreEvento` y los dos progresos (`progressLogistica`,
> `progressLiquidacion`) ya derivados, para alimentar el Kanban y el Listado de la
> pantalla de Reservas. Lectura pura sobre `RESERVA` (join a `CLIENTE`), aislada
> por `tenant_id` + RLS. NO muta estado. La capability `consultas` sigue siendo
> dueña del ciclo de vida y las transiciones del agregado `RESERVA`; `pipeline`
> solo lo lee. Fuente: US-049, UC-37, UC-38; entidades `RESERVA`/`CLIENTE` y
> `preEventoStatus`/`liquidacionStatus` en `er-diagram.md`; estados activos vs
> terminales en `CLAUDE.md §Máquina de estados`.

## ADDED Requirements

### Requirement: Listar las reservas activas del pipeline del tenant

El sistema SHALL (DEBE) exponer el endpoint `GET /reservas` (`operationId:
listarReservas`) que devuelve, para el gestor autenticado, la lista **paginada**
de reservas **activas** de su tenant. La respuesta usa el envoltorio
`ReservaListResponse` (`data[]` de `Reserva` + `metadata` de paginación) y cada
elemento incluye los campos derivados `nombreEvento`, `progressLogistica` y
`progressLiquidacion`. Las reservas se devuelven ordenadas por `fechaCreacion`
**descendente**. La operación es de **lectura pura**: NO muta ninguna entidad ni
produce bloqueos. (Fuente: `US-049 §Historia`, `§Happy Path`, `§Concurrencia /
Race Conditions`.)

#### Scenario: El gestor autenticado lista sus reservas activas con datos de progreso

- **GIVEN** el Gestor autenticado en su tenant, con reservas activas en la BD
- **WHEN** llama a `GET /reservas` sin filtros adicionales
- **THEN** el sistema devuelve todas las reservas activas del tenant (excluyendo
  terminales y completadas/canceladas)
- **AND** cada reserva incluye `nombreEvento`, `progressLogistica` y
  `progressLiquidacion`
- **AND** no se produce ninguna mutación de datos

#### Scenario: Todos los estados activos aparecen ordenados por fechaCreacion descendente

- **GIVEN** reservas en todos los estados activos (`2a`, `2b`, `2c`, `2d`, `2v`,
  `pre_reserva`, `reserva_confirmada`, `evento_en_curso`, `post_evento`)
- **WHEN** el Gestor llama a `GET /reservas`
- **THEN** todas aparecen en la respuesta
- **AND** están ordenadas por `fechaCreacion` descendente

### Requirement: Exclusión de estados terminales y cerrados

El endpoint `GET /reservas` SHALL (DEBE) **excluir siempre** las reservas en los
estados terminales de consulta `2x`, `2y`, `2z` y en los estados cerrados
`reserva_completada` y `reserva_cancelada`, incluso cuando no se pasa filtro de
estado. Estas reservas NO PUEDEN aparecer en la lista del pipeline. (Fuente:
`US-049 §Reglas de Negocio`, `§FA-02`.)

#### Scenario: Las reservas terminales y cerradas no aparecen

- **GIVEN** existen reservas en `2x`, `2y`, `2z`, `reserva_completada` y
  `reserva_cancelada`, además de reservas activas
- **WHEN** el Gestor llama a `GET /reservas` sin filtro de estado
- **THEN** las reservas en `2x`, `2y`, `2z`, `reserva_completada` y
  `reserva_cancelada` NO aparecen en la respuesta
- **AND** sí aparecen las reservas activas

### Requirement: Aislamiento multi-tenant por tenant_id del JWT y RLS

Todas las consultas de `GET /reservas` SHALL (DEBE) filtrar **siempre** por el
`tenant_id` extraído del payload del JWT, reforzado por Row-Level Security (RLS).
El `tenant_id` NO es configurable por el usuario. Ninguna reserva de otro tenant
PUEDE aparecer en la respuesta. Sin JWT válido, el sistema responde `401`.
(Fuente: `US-049 §FA-03`, `§Reglas de Validación`; `CLAUDE.md` Multi-tenancy/RLS.)

#### Scenario: Solo se devuelven reservas del tenant del JWT

- **GIVEN** existen reservas del tenant A y del tenant B
- **WHEN** el Gestor del tenant A llama a `GET /reservas`
- **THEN** solo aparecen las reservas del tenant A
- **AND** ninguna reserva del tenant B aparece en la respuesta

#### Scenario: Petición sin sesión es rechazada

- **GIVEN** una petición a `GET /reservas` sin JWT válido
- **WHEN** el sistema procesa la petición
- **THEN** responde `401` sin devolver datos de ninguna reserva

### Requirement: Derivación de progressLogistica desde preEventoStatus

El sistema SHALL (DEBE) derivar `progressLogistica` (entero 0-100) a partir del
`preEventoStatus` de la reserva con el mapa declarativo: `pendiente = 0`,
`en_curso = 50`, `cerrado = 100`. Para reservas en estados de consulta (`2a`,
`2b`, `2c`, `2d`, `2v`) y en `pre_reserva`, `progressLogistica` SHALL ser `0`
(aún no hay sub-proceso de pre-evento en curso). (Fuente: `US-049 §Reglas de
Negocio`, `§Happy Path`.)

#### Scenario: preEventoStatus en_curso deriva progressLogistica 50

- **GIVEN** una reserva activa con `preEventoStatus = en_curso`
- **WHEN** aparece en el listado de `GET /reservas`
- **THEN** su `progressLogistica` es `50`

#### Scenario: preEventoStatus cerrado deriva progressLogistica 100

- **GIVEN** una reserva activa con `preEventoStatus = cerrado`
- **WHEN** aparece en el listado de `GET /reservas`
- **THEN** su `progressLogistica` es `100`

#### Scenario: Consulta y pre_reserva arrancan en 0

- **GIVEN** reservas en `2a`, `2b`, `2c`, `2d`, `2v` o `pre_reserva`
- **WHEN** aparecen en el listado de `GET /reservas`
- **THEN** su `progressLogistica` es `0`

### Requirement: Derivación de progressLiquidacion desde liquidacionStatus

El sistema SHALL (DEBE) derivar `progressLiquidacion` (entero 0-100) a partir del
`liquidacionStatus` de la reserva con el mapa declarativo: `pendiente = 0`,
`facturada = 50`, `cobrada = 100`. Para reservas en estados de consulta (`2a`,
`2b`, `2c`, `2d`, `2v`) y en `pre_reserva`, `progressLiquidacion` SHALL ser `0`
(aún no hay liquidación en curso). (Fuente: `US-049 §Reglas de Negocio`,
`§Happy Path`.)

#### Scenario: liquidacionStatus cobrada deriva progressLiquidacion 100

- **GIVEN** una reserva activa con `liquidacionStatus = cobrada`
- **WHEN** aparece en el listado de `GET /reservas`
- **THEN** su `progressLiquidacion` es `100`

#### Scenario: liquidacionStatus facturada deriva progressLiquidacion 50

- **GIVEN** una reserva activa con `liquidacionStatus = facturada`
- **WHEN** aparece en el listado de `GET /reservas`
- **THEN** su `progressLiquidacion` es `50`

#### Scenario: Consulta sin liquidación deriva progressLiquidacion 0

- **GIVEN** una reserva en estado de consulta o `pre_reserva` sin liquidación
- **WHEN** aparece en el listado de `GET /reservas`
- **THEN** su `progressLiquidacion` es `0`

### Requirement: Derivación de nombreEvento desde el cliente con fallback a codigo

El sistema SHALL (DEBE) derivar `nombreEvento` como la concatenación
`{cliente.nombre} {cliente.apellidos}` del CLIENTE asociado a la reserva. Cuando
no exista un cliente resoluble, `nombreEvento` SHALL usar el `codigo` de la
reserva como **fallback**. (Fuente: `US-049 §Reglas de Negocio`, `§Scope
técnico / Tests TDD`.)

#### Scenario: nombreEvento se compone del nombre y apellidos del cliente

- **GIVEN** una reserva activa con un cliente `nombre = "Ana"`,
  `apellidos = "García López"`
- **WHEN** aparece en el listado de `GET /reservas`
- **THEN** su `nombreEvento` es `"Ana García López"`

#### Scenario: Sin cliente resoluble se usa el codigo como fallback

- **GIVEN** una reserva activa sin cliente resoluble, con `codigo = "SLO-2026-0001"`
- **WHEN** aparece en el listado de `GET /reservas`
- **THEN** su `nombreEvento` es `"SLO-2026-0001"`

### Requirement: Filtros de query del pipeline

El endpoint `GET /reservas` SHALL (DEBE) aceptar los parámetros de query ya
definidos en el contrato — `estado`, `subEstado`, `fechaDesde`, `fechaHasta`,
`search`, `page`, `limit` — y aplicarlos **sobre el conjunto de reservas activas
del tenant** (el filtro de exclusión de terminales/cerrados y de aislamiento por
`tenant_id` se aplica siempre, con independencia de los filtros). La paginación
SHALL validar `page >= 1` y `limit` entre 1 y 100. (Fuente: `US-049 §FA-04`,
`§Reglas de Validación`, `§Notas de alcance`.)

#### Scenario: Filtro por estado devuelve solo ese estado

- **GIVEN** reservas activas en varios estados, incluyendo `pre_reserva`
- **WHEN** el Gestor llama a `GET /reservas?estado=pre_reserva`
- **THEN** solo aparecen reservas en `pre_reserva`

#### Scenario: Sin reservas activas devuelve lista vacía con status 200

- **GIVEN** que no hay reservas activas para el tenant
- **WHEN** el Gestor llama a `GET /reservas`
- **THEN** el sistema responde `200` con `data: []` y
  `metadata: { total: 0, page: 1, limit: 20 }`

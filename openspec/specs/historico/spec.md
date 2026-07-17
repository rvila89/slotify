# historico Specification

## Purpose
TBD - created by archiving change us-042-buscar-en-historico. Update Purpose after archive.
## Requirements
### Requirement: Listar el histórico de reservas cerradas del tenant

El sistema SHALL (DEBE) exponer el endpoint `GET /historico`
(`operationId: listarHistorico`) que devuelve, para el gestor autenticado, la
lista **paginada** de reservas en **estado cerrado** de su tenant. Por defecto,
sin filtro de estado final, SHALL devolver **solo** reservas con
`estado = reserva_completada`. La respuesta usa un envoltorio paginado
(`data[]` de reserva + `metadata` de paginación) y las reservas se devuelven
ordenadas por `fechaEvento` **descendente** por defecto. La operación es de
**lectura pura**: NO muta ninguna entidad ni produce bloqueos. (Fuente:
`US-042 §Happy Path`, `§Reglas de Negocio`, `§Concurrencia`.)

#### Scenario: El gestor lista su histórico de reservas completadas

- **GIVEN** el Gestor autenticado en su tenant, con reservas en
  `reserva_completada` en la BD
- **WHEN** llama a `GET /historico` sin filtros adicionales
- **THEN** el sistema devuelve `200` con las reservas del tenant en
  `reserva_completada`, ordenadas por `fechaEvento` descendente
- **AND** cada elemento incluye al menos `codigo`, nombre y apellidos del
  cliente, `fechaEvento`, `tipoEvento`, `importeTotal` y `estado`
- **AND** no se produce ninguna mutación de datos

#### Scenario: Tenant sin reservas completadas recibe lista vacía

- **GIVEN** un tenant sin ninguna reserva en estado cerrado
- **WHEN** el Gestor llama a `GET /historico`
- **THEN** el sistema responde `200` con `data: []` y
  `metadata: { total: 0, page: 1, limit: 20 }`
- **AND** no se devuelve error

### Requirement: Exclusión de estados activos y terminales de consulta

El endpoint `GET /historico` SHALL (DEBE) devolver **únicamente** reservas en los
estados cerrados `reserva_completada` y `reserva_cancelada`. NO PUEDE devolver
reservas en estados **activos** (`2a`, `2b`, `2c`, `2d`, `2v`, `pre_reserva`,
`reserva_confirmada`, `evento_en_curso`, `post_evento`) ni en los **estados
terminales de consulta** `2x`, `2y`, `2z` (que nunca llegaron a
`reserva_confirmada` y se consultan desde el Pipeline). (Fuente:
`US-042 §Reglas de Negocio`, `§Supuestos`.)

#### Scenario: Solo aparecen estados cerrados

- **GIVEN** existen reservas en estados activos, en `2x`/`2y`/`2z`, en
  `reserva_completada` y en `reserva_cancelada`
- **WHEN** el Gestor llama a `GET /historico` con el filtro de estado final que
  incluya ambos cerrados
- **THEN** solo aparecen las reservas en `reserva_completada` y
  `reserva_cancelada`
- **AND** ninguna reserva activa ni en `2x`/`2y`/`2z` aparece en la respuesta

### Requirement: Aislamiento multi-tenant por tenant_id del JWT y RLS

Todas las consultas de `GET /historico` SHALL (DEBE) filtrar **siempre** por el
`tenant_id` extraído del payload del JWT, reforzado por Row-Level Security (RLS).
El `tenant_id` NO es configurable por el usuario. Ninguna reserva de otro tenant
PUEDE aparecer en la respuesta. Sin JWT válido, el sistema responde `401`.
(Fuente: `US-042 §Aislamiento multi-tenant`, `§Reglas de Validación`;
`CLAUDE.md` Multi-tenancy/RLS.)

#### Scenario: Solo se devuelven reservas del tenant del JWT

- **GIVEN** existen reservas cerradas del tenant A y del tenant B
- **WHEN** el Gestor del tenant A llama a `GET /historico`
- **THEN** solo aparecen las reservas del tenant A
- **AND** ninguna reserva del tenant B aparece en la respuesta

#### Scenario: Petición sin sesión es rechazada

- **GIVEN** una petición a `GET /historico` sin JWT válido
- **WHEN** el sistema procesa la petición
- **THEN** responde `401` sin devolver datos de ninguna reserva

### Requirement: Filtro de estado final con opt-in de canceladas

El endpoint `GET /historico` SHALL (DEBE) aceptar el parámetro `estadoFinal`
(`reserva_completada | reserva_cancelada`). Cuando se omite, el sistema DEBE
devolver **solo** `reserva_completada`. Cuando se especifica
`reserva_cancelada`, el sistema DEBE devolver las reservas canceladas del tenant.
La inclusión de canceladas es **opt-in** explícito; nunca se mezclan por defecto.
(Fuente: `US-042 §Filtrar incluyendo reservas canceladas`, `§Reglas de Negocio`.)

#### Scenario: Sin filtro solo aparecen completadas

- **GIVEN** existen reservas en `reserva_completada` y en `reserva_cancelada`
- **WHEN** el Gestor llama a `GET /historico` sin `estadoFinal`
- **THEN** solo aparecen reservas en `reserva_completada`

#### Scenario: Filtro de canceladas devuelve solo canceladas

- **GIVEN** existen reservas en `reserva_completada` y en `reserva_cancelada`
- **WHEN** el Gestor llama a `GET /historico?estadoFinal=reserva_cancelada`
- **THEN** solo aparecen reservas en `reserva_cancelada`

### Requirement: Filtros estructurados acumulativos (AND lógico)

El endpoint `GET /historico` SHALL (DEBE) aceptar los filtros estructurados
`fechaDesde`/`fechaHasta` (rango sobre `RESERVA.fecha_evento`, inclusivo),
`tipoEvento` (`boda | corporativo | privado | otro`) e `importeMin`/`importeMax`
(rango sobre `RESERVA.importe_total`). Cuando varios filtros están presentes, el
sistema DEBE combinarlos con **AND lógico**: cada resultado cumple **todas** las
condiciones a la vez. Los filtros se aplican **sobre el conjunto cerrado del
tenant** (el aislamiento por `tenant_id` y el filtro de estado cerrado se aplican
siempre). (Fuente: `US-042 §Happy Path`, `§Combinación de múltiples filtros
activos`, `§Reglas de Negocio`.)

#### Scenario: Filtro por rango de fecha de evento

- **GIVEN** reservas completadas con distintas `fechaEvento`
- **WHEN** el Gestor llama a `GET /historico?fechaDesde=2026-01-01&fechaHasta=2026-03-31`
- **THEN** solo aparecen reservas cuya `fechaEvento` cae dentro del rango
  (inclusivo)
- **AND** el `metadata.total` refleja el número de resultados filtrados

#### Scenario: Combinación de rango de fecha, tipo de evento y búsqueda

- **GIVEN** reservas completadas de varios tipos y fechas
- **WHEN** el Gestor combina `fechaDesde`/`fechaHasta`, `tipoEvento=boda` y
  `search=García`
- **THEN** solo aparecen reservas que cumplen **todas** las condiciones a la vez

#### Scenario: Rango de fecha sin coincidencias devuelve vacío

- **GIVEN** ninguna reserva completada cae en el rango de fechas indicado
- **WHEN** el Gestor aplica ese filtro de rango
- **THEN** el sistema responde `200` con `data: []` y `metadata.total = 0`

### Requirement: Búsqueda full-text sobre cliente, código y notas

El endpoint `GET /historico` SHALL (DEBE) aceptar el parámetro `search` que
ejecuta una **búsqueda full-text** sobre `CLIENTE.nombre`, `CLIENTE.apellidos`,
`CLIENTE.email`, `RESERVA.codigo` y `RESERVA.notas` (y **solo** sobre esos
campos). La búsqueda DEBE operar de forma parametrizada, sin exponer SQL raw ni
permitir inyección de queries. Cuando el término no coincide con ningún registro
del tenant, el sistema DEBE responder `200` con `data: []`. (Fuente:
`US-042 §Happy Path`, `§Búsqueda full-text sin coincidencias`,
`§Reglas de Validación`.)

#### Scenario: Búsqueda por apellido del cliente

- **GIVEN** reservas completadas con un cliente de apellidos "García López"
- **WHEN** el Gestor llama a `GET /historico?search=García`
- **THEN** aparecen las reservas del tenant donde "García" coincide en
  `CLIENTE.nombre`, `CLIENTE.apellidos`, `CLIENTE.email`, `RESERVA.codigo` o
  `RESERVA.notas`

#### Scenario: Búsqueda sin coincidencias devuelve vacío sin error

- **GIVEN** un término de búsqueda que no coincide con ningún registro del tenant
- **WHEN** el Gestor llama a `GET /historico?search=<término-inexistente>`
- **THEN** el sistema responde `200` con `data: []` y `metadata.total = 0`

### Requirement: Paginación obligatoria del histórico

El endpoint `GET /historico` SHALL (DEBE) aplicar **siempre** paginación con los
parámetros `page` y `limit`. El sistema DEBE validar `page >= 1` y `limit` entre
`1` y `100` (por defecto `page = 1`, `limit = 20`). NO PUEDE devolver un conjunto
ilimitado de registros en una única respuesta. El `metadata` de la respuesta
DEBE reflejar `total`, `page` y `limit`. (Fuente: `US-042 §Reglas de
Validación`.)

#### Scenario: Paginación por defecto

- **GIVEN** el tenant tiene más de 20 reservas completadas
- **WHEN** el Gestor llama a `GET /historico` sin `page` ni `limit`
- **THEN** el sistema devuelve como mucho 20 elementos con
  `metadata: { page: 1, limit: 20, total: <n> }`

#### Scenario: limit fuera de rango es rechazado

- **GIVEN** una petición con `limit=500`
- **WHEN** el sistema valida los parámetros
- **THEN** responde `400` sin devolver un conjunto ilimitado

### Requirement: Detalle en modo lectura de una reserva del histórico

El sistema SHALL (DEBE) permitir al gestor acceder al **detalle completo** de
cualquier reserva del histórico reutilizando `GET /reservas/{id}` (schema
`ReservaDetalle`), que incluye los datos del cliente, el presupuesto aceptado,
las facturas, la ficha operativa y los documentos adjuntos. El detalle se
presenta en **modo lectura**: la interfaz NO expone ningún control de edición y
NO se exponen endpoints de mutación para reservas en estados cerrados
(`reserva_completada`, `reserva_cancelada`). Las reservas del histórico son
**inmutables**. (Fuente: `US-042 §Happy Path`, `§Notas de alcance`,
`§Reglas de Validación`.)

#### Scenario: El gestor abre el detalle en modo lectura

- **GIVEN** una reserva del histórico del tenant del gestor
- **WHEN** el Gestor abre su detalle
- **THEN** ve datos del cliente, presupuesto aceptado, facturas, ficha operativa
  y documentos adjuntos
- **AND** la interfaz NO muestra ningún control de edición
- **AND** no existe forma de mutar la reserva desde esta vista


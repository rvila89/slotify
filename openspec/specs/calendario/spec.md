# calendario Specification

## Purpose
TBD - created by archiving change us-039-consultar-calendario. Update Purpose after archive.
## Requirements
### Requirement: Vista mensual de disponibilidad con código de colores canónico

El sistema SHALL (DEBE) ofrecer una vista de Calendario, accesible como **página
de inicio tras el login** (sidebar → primera opción), que para el mes en curso
muestre cada fecha con bloqueo activo coloreada según el código de colores
canónico de SlotifyGeneralSpecs §11.3, derivado del `estado`/`sub_estado` de la
reserva bloqueante de esa fecha:

- **Gris** → consulta activa (`sub_estado` `2a`, `2b`, `2c` o `2v`).
- **Ámbar** → `pre_reserva`.
- **Verde** → `reserva_confirmada`, `evento_en_curso` o `post_evento`.
- **Azul** → `reserva_completada` (histórica).
- **Rojo** → `reserva_cancelada`.
- **Sin color** (neutro) → fecha libre, sin bloqueo activo.

La vista es de **lectura pura**: NO muta estado. (Fuente: `US-039 §Happy Path`,
`§Reglas de Negocio`, `§Reglas de Validación`.)

#### Scenario: Mes en curso con reservas en distintos estados

- **GIVEN** el Gestor autenticado en el tenant y reservas en distintos estados
  para el mes en curso
- **WHEN** accede a la sección Calendario
- **THEN** el sistema muestra la vista mensual del mes actual
- **AND** cada fecha con bloqueo activo se colorea según el código canónico
  (gris consulta activa, ámbar pre_reserva, verde confirmada/en_curso/post_evento,
  azul completada, rojo cancelada)
- **AND** las fechas sin bloqueo activo se muestran sin color (disponibles)

#### Scenario: evento_en_curso y post_evento heredan el verde de confirmada

- **GIVEN** fechas con reservas en `evento_en_curso` y en `post_evento`
- **WHEN** el Gestor visualiza el calendario
- **THEN** ambas fechas se muestran en verde, igual que `reserva_confirmada`
- **AND** la diferenciación de detalle entre estos estados solo se ve en la ficha

### Requirement: Indicador de cola de espera sobre la fecha bloqueante

El sistema SHALL (DEBE) superponer sobre la celda de una fecha el indicador
`🔁 N en cola` cuando esa fecha tiene una reserva bloqueante en `sub_estado`
`2b` y existe ≥ 1 `RESERVA` en `sub_estado` `2d` con `consulta_bloqueante_id`
apuntando a esa reserva bloqueante, donde `N` es el número de reservas en cola.
El color base de la celda permanece **gris** (consulta activa). (Fuente:
`US-039 §Happy Path` 2º escenario, `§Reglas de Validación`, `§Notas de alcance`.)

#### Scenario: Fecha en 2.b con reservas en cola muestra el indicador

- **GIVEN** una fecha con reserva bloqueante en `sub_estado` `2b` y ≥ 1 reserva
  en `sub_estado` `2d` con `consulta_bloqueante_id` apuntando a esa reserva
- **WHEN** el Gestor visualiza el calendario
- **THEN** la celda de esa fecha muestra el color gris (consulta activa)
- **AND** muestra el indicador `🔁 N en cola`, con `N` = número de reservas en cola

#### Scenario: Sin reservas en cola no se muestra el indicador

- **GIVEN** una fecha bloqueante sin ninguna reserva en `sub_estado` `2d`
  apuntando a ella
- **WHEN** el Gestor visualiza el calendario
- **THEN** la celda no muestra el indicador `🔁`

### Requirement: Detalle resumido al hacer clic en una fecha con bloqueo activo

Al hacer clic en una fecha con reserva/bloqueo activo, el sistema SHALL (DEBE)
mostrar un panel/popover de **detalle resumido en modo lectura** con al menos:
nombre del cliente, `sub_estado` actual (etiqueta legible), TTL restante y un
enlace a la ficha completa de la reserva. Esta acción NO muta estado. (Fuente:
`US-039 §Clic en fecha con reserva activa`.)

#### Scenario: Clic en fecha con consulta activa muestra el detalle

- **GIVEN** la fecha D con una consulta activa en `sub_estado` `2b`, cliente
  "Ana García" y TTL restante de 2 días
- **WHEN** el Gestor hace clic sobre la celda D
- **THEN** el sistema muestra un panel/popover con el nombre del cliente,
  el `sub_estado` actual ("2.b — Con fecha"), el TTL restante ("2 días") y un
  enlace a la ficha completa de la reserva
- **AND** no se produce ninguna mutación de estado

### Requirement: Clic en el indicador de cola abre la vista de cola

El sistema SHALL (DEBE) navegar/abrir la vista de cola de espera de esa fecha al
hacer clic en una fecha que muestra el indicador `🔁` o directamente sobre el
indicador. La visualización de la cola se **delega en US-017 / UC-11** (fuera del
alcance de esta capability). (Fuente: `US-039 §Clic en indicador de cola`.)

#### Scenario: Clic en el indicador navega a la cola

- **GIVEN** la fecha D que muestra `🔁 2 en cola`
- **WHEN** el Gestor hace clic sobre la celda D o sobre el indicador `🔁`
- **THEN** el sistema navega/abre la vista de cola de esa fecha (US-017 / UC-11)
- **AND** la visualización de la cola la entrega US-017 (delegación, no implementada aquí)

### Requirement: Cambio de vista (mes / semana / día / lista) con código de colores consistente

El Gestor SHALL (DEBE) poder cambiar la vista entre **mes, semana, día y lista**
y navegar entre períodos. El código de colores SHALL (DEBE) ser **idéntico en
todas las vistas**: no puede variar por vista. El cambio de vista no recarga
datos innecesariamente. (Fuente: `US-039 §Cambio de vista`,
`§Reglas de Validación`.)

#### Scenario: Cambiar a semana o lista mantiene el código de colores

- **GIVEN** el Gestor en la vista mensual
- **WHEN** selecciona la vista "semana" o "lista"
- **THEN** el sistema muestra las mismas fechas con el mismo código de colores
  adaptado a la nueva vista
- **AND** no recarga datos innecesariamente

#### Scenario: Navegación entre períodos

- **GIVEN** el Gestor en cualquier vista del calendario
- **WHEN** navega al período anterior o siguiente
- **THEN** el sistema muestra las fechas de ese período con el código de colores
  canónico, conservando la vista seleccionada

### Requirement: Mes sin bloqueos muestra calendario vacío pero funcional

El sistema SHALL (DEBE) mostrar todas las celdas sin color (disponibles) cuando
el mes seleccionado no tiene ningún bloqueo en `FECHA_BLOQUEADA` para el tenant,
manteniendo el calendario interactivo y navegable, sin errores. (Fuente:
`US-039 §Mes sin reservas / fechas libres`.)

#### Scenario: Mes sin bloqueos sigue siendo navegable

- **GIVEN** un mes sin ningún bloqueo en `FECHA_BLOQUEADA` para el tenant
- **WHEN** el Gestor navega a ese mes
- **THEN** todas las celdas se muestran sin color (disponibles)
- **AND** el calendario sigue siendo interactivo y navegable sin errores

### Requirement: Histórico — completadas en azul, canceladas en rojo, terminales liberadas sin color

Al navegar a un mes anterior, el sistema SHALL (DEBE) mostrar las fechas de
`reserva_completada` en azul y las de `reserva_cancelada` en rojo. Las fechas de
sub-estados terminales de consulta (`2x`, `2y`, `2z`) NO ocupan fecha (su bloqueo
ya fue liberado) y por tanto se muestran **sin color**, no bloqueadas. La consulta
es de lectura (`RESERVA.estado`, `RESERVA.fecha_evento`, `FECHA_BLOQUEADA`).
(Fuente: `US-039 §Navegación a mes pasado`, `§Supuestos`, `§Reglas de Validación`.)

#### Scenario: Mes pasado con completadas, canceladas y terminales

- **GIVEN** un mes anterior con reservas completadas, canceladas y consultas
  terminadas (`2x`/`2y`/`2z`)
- **WHEN** el Gestor visualiza ese mes
- **THEN** las fechas de `reserva_completada` se muestran en azul
- **AND** las de `reserva_cancelada` se muestran en rojo
- **AND** las fechas de consultas terminales (`2x`/`2y`/`2z`) aparecen sin color
  (su bloqueo ya fue liberado)

### Requirement: Aislamiento multi-tenant obligatorio en la consulta del calendario

La consulta del calendario SHALL (DEBE) filtrar **siempre** por el `tenant_id`
del JWT activo, reforzada por Row-Level Security (RLS). Solo se muestran fechas
con `FECHA_BLOQUEADA.tenant_id` y `RESERVA.tenant_id` iguales al tenant
autenticado; ningún dato de otros tenants es visible. (Fuente:
`US-039 §Aislamiento multi-tenant`, `§Reglas de Validación`; `CLAUDE.md`
Multi-tenancy/RLS.)

#### Scenario: Solo se muestran fechas del tenant del JWT

- **GIVEN** el `tenant_id` del JWT es "T-001"
- **WHEN** el sistema carga el calendario
- **THEN** solo se muestran fechas con `FECHA_BLOQUEADA.tenant_id = 'T-001'` y
  `RESERVA.tenant_id = 'T-001'`
- **AND** ningún dato de otros tenants es visible


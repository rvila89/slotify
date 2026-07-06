# Spec Delta — Capability `dashboard`

> Capability de **vista de lectura agregada operativa**: una vista accesible
> desde su propia entrada del sidebar del App Shell que resume el estado de todas
> las reservas del tenant en 7 widgets temáticos (el Calendario permanece como
> pantalla de inicio tras el login). Lectura pura sobre `RESERVA`, `FECHA_BLOQUEADA`,
> `PRESUPUESTO`, `FACTURA`, `PAGO` y `FICHA_OPERATIVA`, aislada por `tenant_id`.
> No muta estado. Fuente: US-044, UC-34; widgets §7.1 SlotifyGeneralSpecs;
> código de colores §11.3 / US-039; entidades en `er-diagram.md`.

## ADDED Requirements

### Requirement: Dashboard operativo con los 7 widgets accesible desde el sidebar

El sistema SHALL (DEBE) ofrecer un Dashboard Operativo, accesible desde una
**entrada propia del sidebar del App Shell** (el Calendario permanece como
pantalla de inicio tras el login; el Dashboard NO es la landing post-login), que
renderice los **7 widgets** de §7.1 SlotifyGeneralSpecs con datos actualizados
del tenant autenticado: **Hoy y mañana**, **Pipeline**, **Sub-procesos
críticos**, **Pendientes**, **Consultas en cola**, **Visitas programadas** y
**Próximos 30 días**. La vista es de **lectura pura**: NO muta estado y NO
permite modificar datos desde los widgets.
(Fuente: `US-044 §Happy Path`, `§Reglas de Negocio`, `§Reglas de Validación`.)

#### Scenario: El gestor autenticado ve los 7 widgets al abrir el Dashboard

- **GIVEN** el Gestor autenticado en su tenant
- **WHEN** selecciona la entrada "Dashboard" del menú lateral del App Shell
- **THEN** el sistema renderiza los 7 widgets con datos actualizados del tenant:
  Hoy y mañana, Pipeline, Sub-procesos críticos, Pendientes, Consultas en cola,
  Visitas programadas y Próximos 30 días
- **AND** no se produce ninguna mutación de datos

### Requirement: Widget "Hoy y mañana"

El widget "Hoy y mañana" SHALL (DEBE) mostrar las reservas con `fecha_evento`
igual a hoy o mañana en estado `reserva_confirmada` o `evento_en_curso`, cada
una con nombre del cliente, tipo de evento, estado actual y hora de inicio,
ordenadas por `fecha_evento` ascendente. (Fuente: `US-044 §Happy Path`.)

#### Scenario: Eventos de hoy y mañana ordenados

- **GIVEN** reservas con `fecha_evento` = hoy o mañana en `reserva_confirmada` o
  `evento_en_curso`
- **WHEN** el Gestor visualiza el widget "Hoy y mañana"
- **THEN** aparecen esas reservas con nombre del cliente, tipo de evento, estado
  actual y hora de inicio
- **AND** están ordenadas por `fecha_evento` ascendente

### Requirement: Widget "Pipeline" con recuento por estado/sub-estado

El widget "Pipeline" SHALL (DEBE) mostrar el recuento de reservas **con
`activo = true`** agrupado por `estado`/`sub_estado`, con etiquetas legibles:
"Exploratoria" (`2a`), "Con fecha" (`2b`), "Pendiente invitados" (`2c`), "En
cola" (`2d`), "Visita programada" (`2v`), "Pre-reserva" (`pre_reserva`) y
"Confirmada" (`reserva_confirmada`). (Fuente: `US-044 §Happy Path`,
`§Reglas de Validación`.)

#### Scenario: Recuento agrupado con etiquetas legibles

- **GIVEN** consultas en `2a`, `2b`, `2c`, `2d`, `2v`, reservas en `pre_reserva`
  y en `reserva_confirmada`, todas con `activo = true`
- **WHEN** el Gestor visualiza el widget "Pipeline"
- **THEN** el widget muestra el recuento agrupado por `estado`/`sub_estado` con
  etiquetas legibles (Exploratoria, Con fecha, Pendiente invitados, En cola,
  Visita programada, Pre-reserva, Confirmada)

### Requirement: Widget "Sub-procesos críticos"

El widget "Sub-procesos críticos" SHALL (DEBE) mostrar las reservas en
`reserva_confirmada` con algún sub-proceso atrasado — `pre_evento_status ≠
cerrado` con fecha de evento próxima, `liquidacion_status ≠ cobrada` o
`fianza_status ≠ cobrada` — cada una con un indicador visual del sub-proceso
pendiente (pre-evento / liquidación / fianza) y la fecha del evento para
priorizar. (Fuente: `US-044 §Happy Path`.)

#### Scenario: Reservas con sub-proceso atrasado con indicador

- **GIVEN** reservas en `reserva_confirmada` con `pre_evento_status ≠ cerrado`
  (evento próximo), `liquidacion_status ≠ cobrada` o `fianza_status ≠ cobrada`
- **WHEN** el Gestor visualiza el widget "Sub-procesos críticos"
- **THEN** aparecen esas reservas con indicador del sub-proceso pendiente
  (pre-evento / liquidación / fianza) y la fecha del evento

### Requirement: Widget "Pendientes" con acciones requeridas

El widget "Pendientes" SHALL (DEBE) listar cada acción pendiente — presupuestos
con `estado = 'enviado'` sin respuesta, TTLs con `ttl_expiracion` dentro de las
próximas 24 horas, o facturas con `estado = 'enviada'` sin `PAGO` registrado y
vencimiento superado — con la descripción de la acción requerida y **enlace
directo a la reserva** correspondiente. (Fuente: `US-044 §Happy Path`.)

#### Scenario: Acciones pendientes con descripción y enlace

- **GIVEN** presupuestos `enviado` sin respuesta, TTLs con `ttl_expiracion` en
  las próximas 24 h, o facturas `enviada` sin pago con vencimiento superado
- **WHEN** el Gestor visualiza el widget "Pendientes"
- **THEN** el widget lista cada acción con su descripción y un enlace directo a
  la reserva correspondiente

### Requirement: Widget "Consultas en cola"

El widget "Consultas en cola" SHALL (DEBE) mostrar las reservas en
`sub_estado = 2d` agrupadas por `fecha_evento`, cada una con su `posicion_cola`,
el nombre del cliente y el tiempo acumulado en cola (calculado desde
`fecha_creacion` del registro). (Fuente: `US-044 §Happy Path`.)

#### Scenario: Consultas en cola agrupadas por fecha

- **GIVEN** reservas con `sub_estado = 2d`
- **WHEN** el Gestor visualiza el widget "Consultas en cola"
- **THEN** aparecen agrupadas por `fecha_evento`, con `posicion_cola`, nombre del
  cliente y tiempo acumulado en cola (desde `fecha_creacion`)

### Requirement: Widget "Visitas programadas"

El widget "Visitas programadas" SHALL (DEBE) listar las reservas en
`sub_estado = 2v` con `visita_programada_fecha` futura, ordenadas por
`visita_programada_fecha` ascendente, con nombre del cliente y fecha/hora de la
visita. (Fuente: `US-044 §Happy Path`.)

#### Scenario: Visitas futuras ordenadas ascendente

- **GIVEN** reservas con `sub_estado = 2v` y `visita_programada_fecha` futura
- **WHEN** el Gestor visualiza el widget "Visitas programadas"
- **THEN** se listan ordenadas por `visita_programada_fecha` ascendente, con
  nombre del cliente y fecha/hora de la visita

### Requirement: Widget "Próximos 30 días" con código de colores del Calendario

El widget "Próximos 30 días" SHALL (DEBE) mostrar un mini-calendario de las
reservas con `fecha_evento` en el rango **`[hoy, hoy + 30 días]` (inclusive)**,
donde cada fecha se colorea según el estado de su reserva usando el **mismo
código de colores canónico que el Calendario completo (US-039 / §11.3)**: gris =
consulta activa, ámbar = `pre_reserva`, verde = `reserva_confirmada` /
`evento_en_curso` / `post_evento`, azul = `reserva_completada`, rojo =
`reserva_cancelada`. (Fuente: `US-044 §Happy Path`, `§Reglas de Negocio`,
`§Reglas de Validación`.)

#### Scenario: Mini-calendario coloreado por estado con el código canónico

- **GIVEN** reservas con `fecha_evento` en `[hoy, hoy + 30 días]` en distintos
  estados
- **WHEN** el Gestor visualiza el widget "Próximos 30 días"
- **THEN** cada fecha ocupada se colorea según el estado de su reserva usando el
  mismo código cromático que el Calendario completo (US-039)

### Requirement: Cada ítem de widget enlaza a la ficha de la reserva

Cada ítem de cualquier widget SHALL (DEBE) enlazar a la ficha de detalle de la
`RESERVA` correspondiente. El Dashboard NO permite modificar datos desde los
widgets: toda acción requiere navegar a la ficha. Al volver con el botón atrás
del navegador, el Dashboard se recupera desde el historial del navegador.
(Fuente: `US-044 §FA-02`, `§Reglas de Validación`.)

#### Scenario: Clic en un ítem navega a la ficha de la reserva

- **GIVEN** un ítem visible en cualquier widget (p. ej. una reserva en
  "Sub-procesos críticos")
- **WHEN** el Gestor hace clic sobre ese ítem
- **THEN** el sistema navega a la ficha de detalle de esa `RESERVA`
- **AND** al volver con el botón atrás del navegador se recupera el Dashboard

### Requirement: El mini-calendario Próximos 30 días enlaza al Calendario completo

El sistema SHALL (DEBE) navegar al Calendario completo (US-039 / UC-29) con la
fecha resaltada o seleccionada al hacer clic sobre una fecha del mini-calendario
"Próximos 30 días" que tenga al menos una reserva asociada. El mini-calendario
NO duplica la lógica de disponibilidad del Calendario.
(Fuente: `US-044 §FA-03`.)

#### Scenario: Clic en una fecha con reserva abre el Calendario

- **GIVEN** una fecha del mini-calendario "Próximos 30 días" con al menos una
  reserva asociada
- **WHEN** el Gestor hace clic sobre esa fecha
- **THEN** el sistema navega al Calendario completo con esa fecha resaltada o
  seleccionada

### Requirement: Estado vacío independiente por widget

Cada widget SHALL (DEBE) gestionar su propio estado vacío de forma
independiente: cuando no existen datos que satisfagan sus criterios, el widget
se renderiza con un mensaje de estado vacío descriptivo (p. ej. "No hay eventos
hoy ni mañana") sin errores, y el resto de widgets muestran sus datos con
normalidad. La carga de un widget NO bloquea ni afecta a los demás.
(Fuente: `US-044 §FA-01`.)

#### Scenario: Un widget sin datos muestra estado vacío sin afectar al resto

- **GIVEN** que no existen reservas que satisfagan los criterios de un widget
  concreto (p. ej. ningún evento hoy ni mañana)
- **WHEN** el Gestor visualiza ese widget
- **THEN** el widget se renderiza con un mensaje de estado vacío descriptivo sin
  errores
- **AND** el resto de widgets muestran sus datos con normalidad

### Requirement: Aislamiento multi-tenant y solo reservas activas

Todas las consultas de todos los widgets del Dashboard SHALL (DEBE) filtrar
**siempre** por el `tenant_id` extraído del payload del JWT, reforzado por
Row-Level Security (RLS), y considerar únicamente reservas con `activo = true`.
Ningún dato de otro tenant PUEDE aparecer en ningún widget. El Dashboard NO
expone datos financieros del tenant ni `CLIENTE.iban_devolucion` (§7.2, fuera de
MVP). (Fuente: `US-044 §FA-04`, `§Reglas de Validación`; `CLAUDE.md`
Multi-tenancy/RLS.)

#### Scenario: Solo se muestran datos del tenant del JWT y reservas activas

- **GIVEN** el Gestor del tenant X autenticado
- **WHEN** el sistema construye las consultas de todos los widgets
- **THEN** todas las queries incluyen `WHERE tenant_id = :tenantId` (del JWT) y
  solo consideran reservas con `activo = true`
- **AND** ningún dato del tenant Y aparece en ningún widget
- **AND** el Dashboard no expone datos financieros ni `iban_devolucion`

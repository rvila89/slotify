# pipeline-ui Specification

## Purpose
TBD - created by archiving change us-050-pipeline-reservas-kanban-listado. Update Purpose after archive.
## Requirements
### Requirement: Pantalla de pipeline con tabs Kanban y Listado en `/reservas`

El sistema SHALL (DEBE) reemplazar el placeholder de la ruta `/reservas` por una
pantalla funcional que ofrezca **dos vistas conmutables por tabs** de las mismas
reservas activas del tenant: **"Flujo de Reserva"** (Kanban) — activo por defecto —
y **"Listado"** (tabla). Ambos tabs se alimentan de la **misma carga** de
`GET /reservas` (un único hook de datos). La pantalla es de **solo lectura**: NO
muta ninguna entidad. (Fuente: `US-050 §Historia`, `§Happy Path`, `§Notas de
alcance`.)

#### Scenario: El gestor abre `/reservas` y ve el tab Kanban por defecto

- **GIVEN** el Gestor autenticado en su tenant
- **WHEN** navega a `/reservas`
- **THEN** el sistema muestra la pantalla con el tab **"Flujo de Reserva"** activo
  por defecto y **5 columnas** Kanban visibles: `Consulta`, `Pre-reserva`,
  `Confirmada`, `En Curso`, `Post-evento`
- **AND** no se produce ninguna mutación de datos

#### Scenario: El gestor cambia al tab Listado sin recargar datos

- **GIVEN** el Gestor en `/reservas` con datos ya cargados en el Kanban
- **WHEN** selecciona el tab **"Listado"**
- **THEN** el sistema muestra una tabla de las mismas reservas activas usando el
  **mismo hook** de datos (sin una segunda llamada innecesaria)

### Requirement: Agrupación de reservas por fase en las 5 columnas del Kanban

El Kanban SHALL (DEBE) ubicar cada reserva activa en la columna correspondiente a
su fase, según el mapa declarativo estado → columna: los estados de consulta
(`2a`, `2b`, `2c`, `2d`, `2v`) en **Consulta**; `pre_reserva` en **Pre-reserva**;
`reserva_confirmada` en **Confirmada**; `evento_en_curso` en **En Curso**;
`post_evento` en **Post-evento**. La cabecera de cada columna SHALL mostrar su
etiqueta, su dot de color y el recuento de tarjetas. (Fuente: `US-050 §Happy
Path — Kanban`, `§Mapping fase → columna Kanban`.)

#### Scenario: Cada reserva aparece en la columna de su fase

- **GIVEN** reservas activas en distintos estados (`2b`, `pre_reserva`,
  `reserva_confirmada`, `evento_en_curso`, `post_evento`)
- **WHEN** el Gestor visualiza el Kanban
- **THEN** cada reserva aparece en la columna correcta: las de `2a`/`2b`/`2c`/`2d`/
  `2v` en **Consulta**, `pre_reserva` en **Pre-reserva**, `reserva_confirmada` en
  **Confirmada**, `evento_en_curso` en **En Curso** y `post_evento` en **Post-evento**
- **AND** la cabecera de cada columna muestra el recuento correcto de tarjetas

### Requirement: Contenido de la tarjeta del Kanban

Cada tarjeta del Kanban SHALL (DEBE) mostrar, con los datos que ya devuelve
`GET /reservas`: el **nombre del evento** (`nombreEvento`), la **fecha**
(`fechaEvento`) junto al **aforo/pax**, una barra de progreso **LOGÍSTICA** con su
porcentaje (`progressLogistica`), una barra de progreso **LIQUIDACIÓN** con su
porcentaje (`progressLiquidacion`) y una **nota de estado** (`notas`) **solo si
existe**. NO SHALL requerir campos adicionales del contrato. (Fuente: `US-050
§Happy Path — Kanban`; schema `Reserva`.)

#### Scenario: La tarjeta muestra nombre, fecha+aforo, progresos y nota

- **GIVEN** una reserva activa con `nombreEvento`, `fechaEvento`, aforo,
  `progressLogistica`, `progressLiquidacion` y una `notas` no vacía
- **WHEN** el Gestor visualiza su tarjeta en el Kanban
- **THEN** la tarjeta muestra el nombre del evento, la fecha con el aforo, la barra
  de progreso LOGÍSTICA con su %, la barra LIQUIDACIÓN con su % y la nota de estado

#### Scenario: Sin nota de estado la tarjeta no muestra el bloque de nota

- **GIVEN** una reserva activa con `notas` vacío o ausente
- **WHEN** el Gestor visualiza su tarjeta
- **THEN** la tarjeta muestra el resto de datos sin renderizar el bloque de nota

### Requirement: Tabla del Listado con columnas Nombre, Estado, Fecha, Aforo y Acciones

El tab **Listado** SHALL (DEBE) mostrar una tabla de todas las reservas activas
del tenant con las columnas **Nombre** (`nombreEvento`), **Estado**, **Fecha**
(`fechaEvento`), **Aforo** y **Acciones**, usando los mismos datos que el Kanban.
(Fuente: `US-050 §Happy Path — Listado`.)

#### Scenario: El Listado muestra las reservas activas con sus columnas

- **GIVEN** existen reservas activas para el tenant
- **WHEN** el Gestor selecciona el tab "Listado"
- **THEN** ve una tabla con columnas **Nombre · Estado · Fecha · Aforo · Acciones**
  y una fila por cada reserva activa

### Requirement: Navegación a la FichaConsulta desde tarjeta o fila

El sistema SHALL (DEBE) **navegar** a la FichaConsulta de la reserva en
`/reservas/{idReserva}` cuando el Gestor hace clic en su tarjeta del Kanban (o en
el icono de enlace) o en su fila del Listado. El clic NO SHALL ejecutar ninguna
transición de estado ni mutar datos. (Fuente: `US-050 §Happy Path`.)

#### Scenario: Clic en tarjeta del Kanban navega a la ficha

- **GIVEN** una tarjeta del Kanban de la reserva con `idReserva = X`
- **WHEN** el Gestor hace clic en la tarjeta o en su icono de enlace
- **THEN** el sistema navega a `/reservas/X` (FichaConsultaPage)
- **AND** no se ejecuta ninguna transición de estado

#### Scenario: Clic en fila del Listado navega a la ficha

- **GIVEN** una fila del Listado de la reserva con `idReserva = X`
- **WHEN** el Gestor hace clic en la fila
- **THEN** el sistema navega a la FichaConsulta de esa reserva

### Requirement: Estado vacío del pipeline con CTA de Nueva Reserva

La pantalla SHALL (DEBE) mostrar las columnas del Kanban vacías con un **estado
vacío descriptivo** y un **CTA "Nueva Reserva"** cuando `GET /reservas` devuelve
una lista vacía de reservas activas. (Fuente: `US-050 §FA-01`.)

#### Scenario: Sin reservas activas se muestra el estado vacío con CTA

- **GIVEN** que no hay reservas activas para el tenant (`GET /reservas` → `data: []`)
- **WHEN** el Gestor accede a `/reservas`
- **THEN** las columnas del Kanban aparecen vacías con un mensaje descriptivo y un
  CTA "Nueva Reserva"

### Requirement: Estado de carga con skeleton

Mientras `GET /reservas` está en curso, la pantalla SHALL (DEBE) mostrar un
**skeleton de carga** (columnas con tarjetas fantasma) sin errores de interfaz.
(Fuente: `US-050 §FA-02`.)

#### Scenario: Durante la carga se muestra un skeleton

- **GIVEN** que el sistema está cargando las reservas
- **WHEN** el Gestor accede a `/reservas`
- **THEN** se muestra un skeleton (columnas con tarjetas fantasma) sin errores de UI

### Requirement: Estado de error con opción de reintento

Cuando `GET /reservas` falla con error de red o `5xx`, la pantalla SHALL (DEBE)
mostrar un **estado de error** con **opción de reintento** que reejecuta la carga.
(Fuente: `US-050 §FA-03`.)

#### Scenario: Error de red muestra estado de error con reintento

- **GIVEN** que `GET /reservas` falla con error de red o `5xx`
- **WHEN** el Gestor accede a `/reservas`
- **THEN** se muestra un estado de error con un botón de reintento
- **AND** al reintentar se vuelve a ejecutar la carga de reservas

### Requirement: Comportamiento responsive mobile-first del pipeline

La pantalla `/reservas` SHALL (DEBE) ser **mobile-first** y funcionar sin romperse
en móvil, tablet y escritorio. En viewports `<lg` (< 1024px) el Kanban SHALL
conservar **scroll horizontal** (NO apilar las columnas verticalmente) y el
Listado SHALL adaptar las filas a **tarjetas apiladas**. NO SHALL producirse
overflow horizontal indebido ni objetivos táctiles inaccesibles. Se verifica en
los viewports 390 / 768 / 1280. (Fuente: `US-050 §FA-04`; `CLAUDE.md §Web
responsive`.)

#### Scenario: En móvil el Kanban mantiene scroll horizontal

- **GIVEN** el Gestor en un viewport < 1024px
- **WHEN** visualiza el tab "Flujo de Reserva"
- **THEN** el Kanban se muestra con scroll horizontal (columnas no apiladas)

#### Scenario: En móvil el Listado apila las filas como tarjetas

- **GIVEN** el Gestor en un viewport < 1024px
- **WHEN** visualiza el tab "Listado"
- **THEN** las filas se adaptan a tarjetas apiladas legibles sin overflow horizontal

### Requirement: La vista muestra solo las reservas activas que devuelve el endpoint

La pantalla SHALL (DEBE) mostrar **exactamente** el conjunto de reservas que
devuelve `GET /reservas` — que la capability backend `pipeline` (US-049) ya filtra
como **activas** (excluyendo `2x`, `2y`, `2z`, `reserva_completada`,
`reserva_cancelada`) y aísla por `tenant_id` + RLS. La UI NO SHALL reimplementar
ese filtrado ni exponer reservas de otros tenants. (Fuente: `US-050 §Reglas de
Validación`; spec viva `pipeline`.)

#### Scenario: No aparecen reservas terminales ni de otros tenants

- **GIVEN** que `GET /reservas` devuelve solo las reservas activas del tenant del JWT
- **WHEN** el Gestor visualiza el Kanban o el Listado
- **THEN** aparecen únicamente esas reservas activas, sin terminales/cerradas ni
  reservas de otros tenants

### Requirement: La vista consume una proyección de `GET /reservas` conforme al contrato

La pantalla `/reservas` SHALL (DEBE) consumir la respuesta de `GET /reservas`
(`ReservaListResponse`) **conforme al contrato OpenAPI congelado**: cada elemento
de `data` (schema `Reserva`) SHALL exponer **`idReserva`** (identificador de la
reserva, base de la navegación a la ficha) y los campos que la vista usa —
`fechaEvento`, aforo (`numInvitadosFinal` con desglose `numAdultosNinosMayores4`/
`numNinosMenores4`) y `notas` — además de los derivados `nombreEvento`,
`progressLogistica` y `progressLiquidacion`. El backend del endpoint (capability
`pipeline`, US-049) SHALL proyectar esos campos con esos nombres; la UI NO SHALL
compensar renombrados ni campos ausentes. (Fuente: `US-050 §Reglas de Validación`;
schema `Reserva` en `docs/api-spec.yml`; hallazgo de conformidad — ver
`proposal.md §Ampliación de scope`.)

#### Scenario: La respuesta expone idReserva y los campos que consume la tarjeta y el listado

- **GIVEN** el Gestor con reservas activas y `GET /reservas` respondiendo `200`
- **WHEN** la vista recibe cada elemento de `data`
- **THEN** cada elemento expone `idReserva` (no `id`), `fechaEvento`, el aforo
  (`numInvitadosFinal`/desglose) y `notas`, además de `nombreEvento`,
  `progressLogistica` y `progressLiquidacion`
- **AND** la tarjeta muestra fecha, aforo y nota, y el clic navega a
  `/reservas/{idReserva}` con un id real (no `undefined`)

### Requirement: Scroll al top tras confirmar el presupuesto en la FichaConsulta

La `FichaConsulta` SHALL (DEBE), tras **confirmar el presupuesto** (US-014 · UC-14) y cerrarse
el modal de confirmación, **desplazar la vista al inicio** (`window.scrollTo({ top: 0 })`) en el
callback `onConfirmadoPresupuesto`, de modo que el **banner de éxito** «Presupuesto generado…»
—que se renderiza en la parte superior de la ficha— quede **visible** para el gestor sin scroll
manual. El comportamiento replica el precedente vivo de `NuevaConsultaPage` (`scrollTo({ top: 0
})` tras el alta). El scroll NO SHALL ejecutar ninguna mutación ni recarga de datos adicional.
(Fuente: workstream A del change; `FichaConsulta/FichaConsultaPage.tsx`
`onConfirmadoPresupuesto`; `NuevaConsultaPage.tsx:78`.)

#### Scenario: Al confirmar el presupuesto la vista sube al banner de éxito

- **GIVEN** la `FichaConsulta` de una consulta con el gestor scrolleado hacia abajo, que confirma
  el presupuesto con éxito
- **WHEN** el modal de confirmación se cierra y se fija el resultado en la ficha
- **THEN** la vista se desplaza al top (`window.scrollTo({ top: 0 })`)
- **AND** el banner «Presupuesto generado…» queda visible sin que el gestor tenga que hacer
  scroll manual

#### Scenario: El scroll no dispara mutaciones ni recargas extra

- **GIVEN** una confirmación de presupuesto exitosa
- **WHEN** se ejecuta el `scrollTo` en `onConfirmadoPresupuesto`
- **THEN** no se produce ninguna mutación de datos ni una recarga adicional atribuible al scroll

### Requirement: Refresco inmediato del listado de comunicaciones al confirmar el presupuesto

El hook de **confirmación del presupuesto** (`useConfirmarPresupuesto`) SHALL (DEBE), en su
`onSuccess`, **invalidar** —además de la query de la RESERVA— la query de **comunicaciones** de
esa reserva (`comunicacionesReservaQueryKey(id)` = `['comunicaciones', id]`), de modo que el
listado de comunicaciones de la `FichaConsulta` muestre **al momento** las entradas recién
trazadas por la confirmación: **E1** (confirmación de consulta) y **E2** (presupuesto). El
refresco reutiliza el patrón vivo de invalidación de comunicaciones (`useCrearEmailManual`,
`useDescartarBorrador`). El hook NO SHALL editar el cliente HTTP generado a mano ni añadir una
segunda llamada innecesaria: solo invalida la query existente
(`GET /reservas/{id}/comunicaciones`). (Fuente: workstream B del change;
`useConfirmarPresupuesto.ts` `onSuccess`; `comunicaciones/api/useComunicacionesReserva.ts`;
patrón `useCrearEmailManual.ts`/`useDescartarBorrador.ts`.)

#### Scenario: Confirmar el presupuesto refresca el listado de comunicaciones con E1 y E2

- **GIVEN** la `FichaConsulta` de una consulta cuyo listado de comunicaciones ya está cargado
- **WHEN** el gestor confirma el presupuesto con éxito
- **THEN** el hook invalida `['comunicaciones', id]` además de la query de la reserva
- **AND** el listado de comunicaciones muestra al momento las nuevas entradas E1 (confirmación de
  consulta) y E2 (presupuesto) sin refresco manual

#### Scenario: El refresco reutiliza la operación existente sin editar el SDK

- **GIVEN** la mutación de confirmación de presupuesto
- **WHEN** se refresca el listado de comunicaciones tras el éxito
- **THEN** se invalida la query servida por `GET /reservas/{id}/comunicaciones` (operación
  existente)
- **AND** no se edita el cliente HTTP generado a mano ni se añade una segunda llamada innecesaria

### Requirement: El estado de la reserva es siempre visible en la FichaConsulta

El `Badge` de estado de la `FichaConsulta` SHALL (DEBE) mostrar **siempre** el estado de la
reserva: si la reserva tiene **sub-estado** de consulta (`2a`…`2z`), muestra la etiqueta del
**sub-estado** (comportamiento actual); si **no** tiene sub-estado (`pre_reserva`,
`reserva_confirmada`, `evento_en_curso`, `post_evento`, …), muestra la etiqueta del **estado
principal** (`pre_reserva → «Pre-reserva»`, `reserva_confirmada → «Confirmada»`, `evento_en_curso
→ «En Curso»`, `post_evento → «Post-evento»`). Los estados **TERMINALES** sin columna en el
pipeline TAMBIÉN SHALL etiquetarse (el estado ha de verse SIEMPRE): `reserva_cancelada →
«Cancelada»`, `reserva_completada → «Completada»`. El badge NO SHALL devolver `null` para un
estado principal ni terminal (solo devuelve `null` para `consulta` sin sub-estado, que se
etiqueta por sub-estado). El **mapa de etiquetas por estado principal** SHALL vivir en `lib/`
(no en `components/`, guardrail «`components/` solo `.tsx`»), **reutilizando** las etiquetas de
`COLUMNAS_KANBAN` (`features/reservas/lib/columnasKanban.ts`) como fuente declarativa única de
las fases del pipeline (las etiquetas terminales, que no tienen columna, se declaran junto a él
en el mismo `lib/`), para no duplicar/divergir las etiquetas. (Fuente: workstream C del change;
`FichaConsulta/components/Badge.tsx`; `features/reservas/lib/columnasKanban.ts` `COLUMNAS_KANBAN`;
`CLAUDE.md §Estructura del frontend por dominio` guardrail `components/` solo `.tsx`.)

#### Scenario: Una consulta con sub-estado muestra la etiqueta del sub-estado

- **GIVEN** una RESERVA en `estado = 'consulta'`, `subEstado = '2b'`
- **WHEN** el gestor abre su `FichaConsulta`
- **THEN** el badge muestra la etiqueta del sub-estado («Consulta con fecha»), como hasta ahora

#### Scenario: Una pre_reserva muestra la etiqueta del estado principal

- **GIVEN** una RESERVA en `estado = 'pre_reserva'` sin sub-estado (p. ej. tras confirmar el
  presupuesto)
- **WHEN** el gestor abre su `FichaConsulta`
- **THEN** el badge muestra «Pre-reserva» (etiqueta del estado principal, reutilizada de
  `COLUMNAS_KANBAN`)
- **AND** el badge NO desaparece (no devuelve `null`)

#### Scenario: Estados posteriores sin sub-estado también muestran su etiqueta

- **GIVEN** RESERVAS en `reserva_confirmada`, `evento_en_curso` y `post_evento`
- **WHEN** el gestor abre sus fichas
- **THEN** el badge muestra respectivamente «Confirmada», «En Curso» y «Post-evento»

#### Scenario: Los estados terminales también muestran su etiqueta

- **GIVEN** RESERVAS en `reserva_cancelada` y `reserva_completada` (terminales, sin sub-estado
  ni columna en el pipeline)
- **WHEN** el gestor abre sus fichas
- **THEN** el badge muestra respectivamente «Cancelada» y «Completada»
- **AND** el badge NO desaparece (no devuelve `null`)

#### Scenario: El mapa de etiquetas de estado principal vive en lib/ (guardrail)

- **WHEN** se inspecciona el origen del mapa estado-principal → etiqueta
- **THEN** vive en un `.ts` bajo `features/reservas/lib/` (no en `components/`) y reutiliza las
  etiquetas de `COLUMNAS_KANBAN`, respetando el guardrail «`components/` solo `.tsx`»


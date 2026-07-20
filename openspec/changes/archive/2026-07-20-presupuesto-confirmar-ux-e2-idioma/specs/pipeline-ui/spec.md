# Spec Delta — Capability `pipeline-ui`

> **Workstreams A, B y C (UX/bugfix frontend)** — Tres carencias de la `FichaConsulta` (la
> pantalla de detalle de una reserva a la que navega el pipeline, `/reservas/{idReserva}`)
> detectadas al confirmar un presupuesto: (A) la vista no hace scroll al top tras confirmar, así
> que el banner de éxito queda fuera de pantalla; (B) el listado de comunicaciones de la ficha no
> se refresca al momento con E1/E2 recién trazados; (C) el badge de estado desaparece cuando la
> reserva pasa a un estado sin sub-estado (`pre_reserva`…). Este delta **AÑADE** tres requisitos
> de comportamiento de UI a la capability del frontend de reservas. Ninguno toca el contrato
> OpenAPI ni el backend: reutilizan `POST /reservas/{id}/presupuesto` y
> `GET /reservas/{id}/comunicaciones` existentes, y respetan el guardrail «`components/` solo
> `.tsx`» (los mapas/guards viven en `lib/`).
>
> Fuente: workstreams A/B/C del change; `FichaConsulta/FichaConsultaPage.tsx`
> (`onConfirmadoPresupuesto`), `NuevaConsultaPage.tsx:78` (precedente `scrollTo`),
> `useConfirmarPresupuesto.ts` (`onSuccess`), `comunicaciones/api/useComunicacionesReserva.ts`
> (`comunicacionesReservaQueryKey`), `FichaConsulta/components/Badge.tsx`,
> `features/reservas/lib/columnasKanban.ts` (`COLUMNAS_KANBAN`); `CLAUDE.md §Estructura del
> frontend por dominio`.

## ADDED Requirements

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

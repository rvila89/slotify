# Spec Delta — Capability `presupuestos`

> **US-051 §Punto 3** — Gating de "Generar presupuesto" por completitud de datos. La ficha
> NO ofrece (o deshabilita) "Generar presupuesto" hasta que la RESERVA tiene los datos
> mínimos para presupuestar —`fechaEvento`, `numAdultosNinosMayores4`, `duracionHoras` y
> `horario`— e indica **qué falta**, sugiriendo "Editar consulta". Esto adelanta a la UI
> una comprobación que hoy revienta tarde (422 en cascada del motor de tarifa) sin permitir
> corregir.
>
> Nota de forma: se modela como **ADDED** (nuevo requirement sobre *cuándo se ofrece el
> botón* en la ficha), NO como cambio del requirement server-side existente "Validación
> síncrona de completitud de datos y datos fiscales antes del cálculo", que sigue vigente e
> intacto como red de seguridad defensiva.
>
> Fuente: `US-051 §Punto 3`; UC-14; spec viva `presupuestos` "Validación síncrona de
> completitud de datos y datos fiscales antes del cálculo"; `AccionPresupuesto.tsx`,
> `puedeGenerarPresupuesto`.

## ADDED Requirements

### Requirement: "Generar presupuesto" requiere completitud de datos (fecha, invitados, duración, hora de inicio)

El sistema SHALL (DEBE), además de la guarda de origen por estado/sub-estado ya existente
(`estado='consulta'`, `subEstado ∈ {2a,2b,2c,2v}`, sin PRESUPUESTO `enviado`/`aceptado`
previo), **NO ofrecer ni habilitar** en la ficha la acción "Generar presupuesto" hasta que
la RESERVA tenga presentes **todos** estos datos mínimos: `fechaEvento` (no nula),
`numAdultosNinosMayores4` (≥ 1), `duracionHoras` (∈ {4, 8, 12}) y `horario` (`HH:MM`). Si
falta cualquiera, el botón DEBE quedar **deshabilitado** y la ficha DEBE **enumerar los
campos que faltan** y sugerir "Editar consulta" (que abre la edición de datos de la
RESERVA, US-051 §Punto 2). Esta es una guarda de **UI** que evita ofrecer un botón que el
servidor rechazaría; NO sustituye la validación de servidor: el backend sigue revalidando
la completitud (y los datos fiscales del CLIENTE) de forma defensiva antes de delegar en el
motor de tarifa. Los datos fiscales del CLIENTE **no** forman parte de este gate de UI (se
resuelven con el flujo de datos fiscales existente). (Fuente: `US-051 §Punto 3`; UC-14;
spec viva `presupuestos` "Validación síncrona de completitud de datos y datos fiscales
antes del cálculo".)

#### Scenario: Faltan datos → botón deshabilitado con la lista de lo que falta

- **GIVEN** una RESERVA en `2b` con `fechaEvento` definida y `numAdultosNinosMayores4=30`,
  pero sin `duracionHoras` ni `horario`
- **WHEN** el gestor abre la ficha
- **THEN** el botón "Generar presupuesto" aparece **deshabilitado**
- **AND** la ficha enumera que faltan la duración y la hora de inicio
- **AND** sugiere "Editar consulta" para completarlos

#### Scenario: Datos completos → el botón se ofrece habilitado

- **GIVEN** una RESERVA en `2b` con `fechaEvento`, `numAdultosNinosMayores4=30`,
  `duracionHoras=8` y `horario='11:00'`
- **WHEN** el gestor abre la ficha
- **THEN** el botón "Generar presupuesto" aparece **habilitado**

#### Scenario: Falta la hora de inicio → el botón queda deshabilitado

- **GIVEN** una RESERVA en `2b` con `fechaEvento`, `numAdultosNinosMayores4=30` y
  `duracionHoras=8`, pero **sin** `horario`
- **WHEN** el gestor abre la ficha
- **THEN** el botón "Generar presupuesto" aparece deshabilitado y la ficha indica que falta
  la hora de inicio

#### Scenario: La guarda de UI no reemplaza la validación de servidor

- **GIVEN** una RESERVA con todos los datos de evento completos pero con datos fiscales del
  CLIENTE incompletos
- **WHEN** el gestor pulsa "Generar presupuesto" (habilitado por el gate de UI)
- **THEN** el servidor revalida y rechaza enumerando los campos fiscales faltantes, sin
  crear PRESUPUESTO (comportamiento de la spec viva "Validación síncrona…" intacto)

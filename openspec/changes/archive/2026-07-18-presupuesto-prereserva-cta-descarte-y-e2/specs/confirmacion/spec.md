# Spec Delta — Capability `confirmacion`

> **Workstream A (UX, solo frontend)** — Jerarquía visual de la sección "Acciones" de la
> fase `pre_reserva`: el CTA "Confirmar pago de señal" (US-021 / UC-17) se convierte en la
> acción **primaria y primera**, con el token semántico verde `accent-success` (el mismo que
> "Generar presupuesto" en `consulta`), y "Editar presupuesto" (US-015) queda debajo como
> acción secundaria (`brand-primary`). Cambio presentacional y de orden: NO altera las
> guardas de estado (`puedeConfirmarSenal` / `puedeEditarPresupuesto`), ni los handlers, ni
> el contrato, ni la validación autoritativa del servidor (409/422).
>
> Fuente: workstream A del change; `AccionesPreReserva.tsx`, `AccionPresupuesto.tsx`
> (token verde de referencia), `ConfirmarSenalDialog.tsx`; spec viva `confirmacion`
> (confirmación del pago de la señal, US-021); `CLAUDE.md §Estructura del frontend`,
> `§Web responsive`; `DESIGN.md` (tokens `accent-success`).

## ADDED Requirements

### Requirement: El CTA de confirmar la señal es la acción primaria y primera de la fase pre_reserva

El sistema (frontend) SHALL (DEBE) presentar, en la sección "Acciones" de una RESERVA en
`estado = 'pre_reserva'`, el botón **"Confirmar pago de señal"** como la **primera** acción y
con el **tratamiento visual primario verde** del sistema de diseño (tokens semánticos
`accent-success` de fondo y `accent-success-foreground` de texto, #5f7d52), el **mismo** token
que usa "Generar presupuesto" en la fase `consulta`. El botón **"Editar presupuesto"** (US-015)
SHALL (DEBE) mostrarse **debajo**, con el tratamiento **secundario** `brand-primary`
(terracota). El botón "Confirmar" del diálogo `ConfirmarSenalDialog` SHALL (DEBE) usar también
el verde `accent-success` (coherencia del CTA de principio a fin, D-3); su botón "Cancelar"
conserva el tratamiento secundario. Este cambio es **presentacional y de orden**: NO modifica
las guardas de visibilidad/habilitación (`puedeConfirmarSenal`, `puedeEditarPresupuesto`), los
handlers, el flujo multipart de confirmación ni la validación autoritativa del servidor
(409/422). La UI es **mobile-first** (botones a ancho completo en `<sm`), sin overflow
horizontal y con objetivos táctiles accesibles. (Fuente: workstream A; `AccionPresupuesto.tsx`
token verde; `AccionesPreReserva.tsx`; `ConfirmarSenalDialog.tsx`; `CLAUDE.md §Web responsive`.)

#### Scenario: En pre_reserva "Confirmar pago de señal" aparece primero y en verde

- **GIVEN** una RESERVA en `estado = 'pre_reserva'` cuya ficha muestra la sección "Acciones"
- **WHEN** se renderiza la sección con las dos acciones disponibles
- **THEN** "Confirmar pago de señal" es el **primer** botón y usa el fondo `accent-success` con
  texto `accent-success-foreground`
- **AND** "Editar presupuesto" aparece **debajo**, con el tratamiento secundario `brand-primary`

#### Scenario: El botón "Confirmar" del diálogo de la señal usa el verde (D-3)

- **GIVEN** el diálogo `ConfirmarSenalDialog` abierto con un justificante válido adjunto
- **WHEN** se renderiza el pie del diálogo
- **THEN** el botón "Confirmar" usa el tratamiento verde `accent-success`
- **AND** el botón "Cancelar" conserva el tratamiento secundario

#### Scenario: El recoloreado y el reorden no cambian las guardas ni el flujo de confirmación

- **GIVEN** una RESERVA en `pre_reserva` en la que `puedeConfirmarSenal` y
  `puedeEditarPresupuesto` determinan qué acciones se ofrecen
- **WHEN** el usuario pulsa "Confirmar pago de señal"
- **THEN** se abre el mismo flujo multipart de confirmación (US-021) sin cambios de
  comportamiento
- **AND** el servidor sigue revalidando de forma autoritativa (409/422) con independencia del
  color o el orden de los botones

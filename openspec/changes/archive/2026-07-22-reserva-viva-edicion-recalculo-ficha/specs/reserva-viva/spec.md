# Spec Delta — Capability `reserva-viva`

> **reserva-viva-edicion-recalculo-ficha** — Nueva capability que define la **ventana de edición
> viva** de una RESERVA: el intervalo en que el aforo y la duración estructurados siguen
> editables CON recálculo del precio tras confirmar la señal. Se modela como **guarda
> declarativa** en la máquina de estados (`reservas/domain/maquina-estados.ts`, tabla de
> guardas junto a `esOrigenValidoParaEditarPresupuesto`, `esOrigenValidoParaConfirmarSenal`,
> etc.), NO como `if` dispersos. Esta guarda gobierna todos los efectos de recálculo de las
> capabilities `ficha-operativa`, `presupuestos`, `facturacion` y `comunicaciones`.
>
> Fuente: petición de usuario (feature "Reserva viva"); `US-021` congelado al confirmar;
> `US-025` cierre de ficha (`pre_evento_status`); `US-029` cobro de liquidación
> (`liquidacion_status = cobrada`); `CLAUDE.md §Máquina de estados`; skill `state-machine`.

## ADDED Requirements

### Requirement: Ventana de edición viva de la reserva (guarda declarativa)

El sistema SHALL (DEBE) permitir editar los campos estructurados que afectan al precio
(`RESERVA.duracionHoras`, `RESERVA.numAdultosNinosMayores4`, `RESERVA.numNinosMenores4`) **con
recálculo en cascada** solo cuando la RESERVA está dentro de la **ventana de edición viva**,
definida por la conjunción: `estado = 'reserva_confirmada'` **AND**
`pre_evento_status != 'cerrado'` **AND** `liquidacion_status != 'cobrada'`. La guarda SHALL
(DEBE) modelarse como una **función de guarda declarativa** de la máquina de estados
(`esEditableEnVentanaViva(estado, preEventoStatus, liquidacionStatus)` o equivalente en la tabla
de guardas), no como condicionales dispersos por los casos de uso. Cuando la RESERVA está FUERA
de la ventana viva (p. ej. sigue en `consulta`/`pre_reserva`, o la ficha ya está `cerrado`, o la
liquidación ya está `cobrada`), el sistema DEBE **rechazar** el cambio de aforo/duración con
recálculo, devolviendo un error de guarda (422), sin mutar la RESERVA ni disparar recálculo. La
edición de los campos operativos NO estructurales de la ficha (contacto, hora, notas, briefing)
NO está sujeta a esta guarda y sigue permitida como hoy (incluida la edición post-cierre de
US-025). La FECHA del evento NO es editable por esta vía (mantiene su flujo de bloqueo atómico
propio, US-040/041). (Fuente: petición de usuario; `US-021` congelado; `US-025 §Edición de la
ficha tras cerrarla`; `US-029` `liquidacion_status = cobrada`; `CLAUDE.md §Máquina de estados`.)

#### Scenario: Reserva confirmada, ficha abierta y liquidación no cobrada permite recálculo

- **GIVEN** una RESERVA en `estado = 'reserva_confirmada'` con `pre_evento_status = 'en_curso'`
  y `liquidacion_status = 'pendiente'`
- **WHEN** el Gestor cambia `duracionHoras` o el desglose de invitados desde la ficha
- **THEN** la guarda de ventana viva se satisface y el sistema ejecuta el recálculo en cascada

#### Scenario: Ficha ya cerrada bloquea el recálculo

- **GIVEN** una RESERVA en `estado = 'reserva_confirmada'` con `pre_evento_status = 'cerrado'` y
  `liquidacion_status = 'pendiente'`
- **WHEN** el Gestor intenta cambiar `duracionHoras` con recálculo
- **THEN** el sistema rechaza la operación (422 guarda) sin mutar la RESERVA ni recalcular

#### Scenario: Liquidación ya cobrada bloquea el recálculo

- **GIVEN** una RESERVA en `estado = 'reserva_confirmada'` con `pre_evento_status = 'en_curso'` y
  `liquidacion_status = 'cobrada'`
- **WHEN** el Gestor intenta cambiar el desglose de invitados con recálculo
- **THEN** el sistema rechaza la operación (422 guarda) sin mutar la RESERVA ni recalcular

#### Scenario: Reserva anterior a reserva_confirmada no está en la ventana viva

- **GIVEN** una RESERVA en `estado = 'pre_reserva'`
- **WHEN** se evalúa la guarda de ventana viva
- **THEN** la guarda NO se satisface (el aforo/duración se editan por el editor de consulta/
  presupuesto, no por esta vía de recálculo)

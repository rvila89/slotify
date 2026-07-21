# Change: reserva-viva-edicion-recalculo-ficha

## Why

Tras confirmar la señal (US-021), la RESERVA **se congela y muere para el precio**:
`importe_total`, `importe_senal` (40 % MVP) e `importe_liquidacion` (60 % = total − señal)
quedan fijados en la transacción de confirmación (`congelarImportes` en
`confirmar-pago-senal.use-case.ts`), y el borrador de liquidación (FACTURA `tipo='liquidacion'`)
se genera una única vez (`generar-borradores-liquidacion-fianza.use-case.ts`, disparo
post-commit) **sin recálculo posterior**. Los campos estructurados que determinan el precio
(`duracionHoras` enum `{4,8,12}`, `numAdultosNinosMayores4`, `numNinosMenores4`) solo son
editables mientras la RESERVA está en `consulta` (editor de consulta / `EditarConsultaDialog`).

Pero la operativa real sigue viva **después** de confirmar: el cliente añade o quita invitados
y cambia la duración durante la preparación del evento. Hoy la ficha operativa
(`apps/api/src/ficha-evento/`) tiene campos operativos DESACOPLADOS de la reserva:
`numInvitadosConfirmado` (entero suelto), `duracion` (texto libre), contacto, `horaLlegada`,
`notasOperativas`. Al cambiarlos NO recalcula nada: el gestor tiene que rehacer a mano el
presupuesto y la liquidación, y el importe congelado deja de reflejar la realidad. Además la
ficha solo pre-rellena hoy `contactoEventoCorreo` (desde `Cliente.email`, change
`ficha-operativa-campos-operativos`) y `notasOperativas` (desde `Reserva.comentarios`,
`mejoras-detalle-consulta`), y **solo al crearla**: si la ficha ya existía, el resto de campos
salen vacíos aunque el dato viva en la RESERVA/CLIENTE.

Este change hace que la reserva siga **"viva"** —editable con recálculo en cascada— hasta que
la ficha se cierra Y la liquidación se cobra (antes del día del evento), reutilizando el motor
de tarifa (`CalculadoraTarifaService`) y el patrón de "presupuesto de modificación"
(inspirado en `EditarPresupuestoUseCase`: nueva versión inmutable + reenvío E2). La FECHA del
evento NO se toca aquí (sigue su flujo de bloqueo atómico propio, US-040/041).

(Fuente: `US-021 §Reglas de negocio` congelado 40/60 y ficha vacía 1:1; `US-025` ficha
operativa y precondición de cierre; `US-016` motor de tarifa; `confirmar-pago-senal.use-case.ts
§congelarImportes`; `generar-borradores-liquidacion-fianza.use-case.ts`;
`calculadora-tarifa.service.ts`; `editar-presupuesto.use-case.ts`; `er-diagram.md §3.6 RESERVA`,
`§3.14 FICHA_OPERATIVA`; memoria del proyecto "aforo/personas es campo derivado",
"importe_total nunca escrito", "columna nueva → enhebrar todo el read path".)

## What Changes

### A — La ficha operativa edita los campos REALES de la reserva (capabilities `ficha-operativa`, `reservas`)
- Los inputs de **invitados** y **duración** de la ficha dejan de escribir los campos operativos
  sueltos y pasan a editar los campos ESTRUCTURADOS de la RESERVA, IGUAL que el editor de
  consulta: `duracionHoras ∈ {4,8,12}` y el desglose de invitados
  `numAdultosNinosMayores4` + `numNinosMenores4` (fiel al tarifario, que corta por
  `numAdultosNinosMayores4`).
- El **"nº de invitados confirmado"** pasa a ser **DERIVADO**, nunca escrito directamente:
  `numInvitadosFinal ?? (numAdultosNinosMayores4 + numNinosMenores4)` (reutiliza
  `derivarNumPersonas` de `presupuestos/domain`). `FICHA_OPERATIVA.numInvitadosConfirmado`
  queda como campo legacy no escrito por esta vía (soft-deprecate, la columna permanece).
- El resto de campos operativos de la ficha (`contactoEventoNombre`, `contactoEventoTelefono`,
  `contactoEventoCorreo`, `horaLlegada`, `notasOperativas`, `briefingEquipo`) siguen igual.

### B — Pre-relleno completo de la ficha al LEER (capability `ficha-operativa`)
- El pre-relleno se aplica **al leer** la ficha (no solo al crearla), derivado desde
  RESERVA/CLIENTE, para campos que aún no tengan valor propio en la ficha:
  - Nº personas (derivado, ver A), Duración = `Reserva.duracionHoras`, Hora =
    `Reserva.horario`, Contacto nombre = `Cliente.nombre` (+ `apellidos`), Teléfono =
    `Cliente.telefono`, Correo = `Cliente.email` (ya existía), Notas = `Reserva.comentarios`
    (ya existía en creación; ahora también como fallback de lectura).
- El pre-relleno es de PRESENTACIÓN/conveniencia: no muta la ficha al leer; un guardado
  posterior persiste el valor definitivo.

### C — Ventana de edición viva + recálculo en cascada (capabilities `reservas`, `ficha-operativa`, `presupuestos`, `facturacion`, `comunicaciones`)
- **Guarda de ventana viva** (declarativa en la máquina de estados, no `if` dispersos):
  `estado = reserva_confirmada` **AND** `pre_evento_status != cerrado` **AND**
  `liquidacion_status != cobrada`. Fuera de esa ventana, editar invitados/duración se rechaza
  (los demás campos operativos siguen editándose siempre, como hoy).
- **Recálculo en cascada** al guardar un cambio de invitados o duración dentro de la ventana,
  en UNA transacción idempotente:
  a. **Recalcular el TOTAL** con `CalculadoraTarifaService` (temporada × duración × tramo +
     extras VIGENTES de RESERVA_EXTRA `factura_id IS NULL`). `>50` invitados o sin tarifa
     configurada → TOTAL **manual** ("tarifa a consultar"), mismo fallback que el flujo de
     presupuesto.
  b. **Nueva versión de PRESUPUESTO "de modificación"** (`version = MAX+1`, inmutable) y
     **reenvío al cliente**. A diferencia del presupuesto normal (40/60), NO reparte el 40 %
     sobre el nuevo total: muestra **"Pago inicial ya realizado"** = `importe_senal` congelado
     (importe FIJO) y **"Liquidación restante"** = `nuevo_total − importe_senal`.
  c. **Re-congelar en la RESERVA**: `importe_total = nuevo_total`,
     `importe_liquidacion = nuevo_total − importe_senal`. **`importe_senal` NO cambia.**
  d. **Regenerar el borrador de liquidación** (FACTURA `tipo='liquidacion'`) con el nuevo
     importe, INCLUSO si estaba `enviada` (mientras no `cobrada`).
  e. **Email al cliente** en el IDIOMA de la reserva (`Reserva.idioma`) notificando la
     modificación (cambio de personas o de duración) y el nuevo restante a liquidar. Reutiliza
     el patrón i18n del catálogo de plantillas (es/ca) de E2/E3; se añade una plantilla nueva.

### Contrato (lo ejecutará `contract-engineer` tras el gate)
- `GET /reservas/{id}/ficha-operativa` (`FichaOperativa`): el response añade/expone los campos
  estructurados editables `duracionHoras` (`enum 4/8/12`) y el desglose de invitados
  (`numAdultosNinosMayores4`, `numNinosMenores4`), y `numInvitadosConfirmado` pasa a ser el
  valor **derivado** (read-only). Pre-relleno reflejado en la respuesta.
- `PATCH /reservas/{id}/ficha-operativa` (`GuardarFichaOperativaRequest`): el body acepta
  `duracionHoras` y el desglose de invitados; deja de aceptar `numInvitadosConfirmado` y
  `duracion` (texto libre) como campos de escritura de aforo/duración estructural. Respuesta de
  guardado enriquecida con el resultado del recálculo (nuevo total, restante, presupuesto y
  liquidación regenerados, o `tarifaAConsultar`). Cambios aditivos + soft-deprecate.
- El SDK del frontend se **regenera** desde el contrato (nunca a mano; hook
  `protect-generated-client`).

## Impact

- **Specs afectadas**:
  - `specs/ficha-operativa/spec.md` — ADDED "Edición de los campos estructurados de aforo y
    duración de la RESERVA desde la ficha"; ADDED "Nº de invitados confirmado como campo
    derivado"; ADDED "Pre-relleno completo de la ficha al leer desde RESERVA y CLIENTE".
  - `specs/reservas/spec.md` — ADDED "Ventana de edición viva de la reserva (guarda
    declarativa)".
  - `specs/presupuestos/spec.md` — ADDED "Presupuesto de modificación tras confirmar (pago
    inicial fijo + liquidación restante)".
  - `specs/facturacion/spec.md` — ADDED "Recálculo en cascada del importe congelado y
    regeneración del borrador de liquidación en la ventana viva".
  - `specs/comunicaciones/spec.md` — ADDED "Email de modificación de reserva en el idioma de la
    reserva".
- **Código afectado (tras el gate; no en este change)**:
  - Backend: guarda de ventana viva en `reservas/domain/maquina-estados`; `ficha-evento`
    (lectura con pre-relleno derivado, guardado que enruta aforo/duración a la RESERVA);
    orquestador de recálculo transaccional (motor de tarifa + nueva versión de presupuesto +
    re-congelado de importes + regeneración de liquidación); plantilla de email nueva
    (`CodigoEmail` E9 es/ca) en `comunicaciones/infrastructure/plantillas`.
  - Frontend: `features/ficha-operativa/` (inputs de invitados desglosados + duración enum,
    nº personas derivado read-only, avisos de recálculo/tarifa a consultar), pre-relleno.
  - Contrato: `FichaOperativa` / `GuardarFichaOperativaRequest`; SDK regenerado.
- **NO cambia**: el bloqueo atómico de fecha (US-040/041), la FECHA del evento, la máquina de
  estados PRINCIPAL de la reserva (no hay aristas nuevas de estado; solo una guarda de
  ventana), el porcentaje de señal, ni la edición de EXTRAS (el recálculo usa los extras
  vigentes tal cual — fuera de alcance).
- **Riesgo principal**: medio. Puntos sensibles: (1) atomicidad e idempotencia del recálculo
  (nueva versión de presupuesto + re-congelado + regeneración de liquidación en una sola
  transacción, reintento acotado ante `P2002` de `@@unique([reservaId, version])`, sin locks
  distribuidos); (2) no re-congelar `importe_senal`; (3) respetar `liquidacion_status = cobrada`
  como frontera dura → TDD del orquestador y de la guarda primero.

### Fuera de alcance (decisión de producto)
- **Editar EXTRAS desde la ficha**: no entra; el recálculo usa los RESERVA_EXTRA vigentes tal
  cual (`factura_id IS NULL`).
- **Cambiar la FECHA del evento**: no se edita en esta superficie (flujo de bloqueo atómico
  propio).
- **Recalcular el 40 % sobre el nuevo total**: NO; la señal es fija (importe ya cobrado).
- **Regenerar la fianza**: no; solo la liquidación depende del total.

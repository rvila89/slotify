# Spec-delta: condiciones-idioma-e2-firma-banner (capability `comunicaciones`)

## MODIFIED Requirements

### Requirement: E2 adjunta el PDF de condicions particulars en el idioma de la reserva

El sistema SHALL (DEBE) adjuntar el PDF de condicions particulars al email E2 (presupuesto
enviado) en el idioma de la reserva (`RESERVA.idioma`). `DispararE2Adapter` DEBE pasar
`idioma: reserva.idioma` a `generarCondiciones.generar()`.

Dado que la guarda de "condicions configuradas" se verifica ANTES del commit (en
`GenerarPresupuestoUseCase.confirmar()`), si `generar()` devuelve `null` post-commit es
un fallo transitorio de render/subida (no ausencia de config). En ese caso el email E2
se envía sin el adjunto de condicions (tolerancia a fallos transitorios, misma semántica
que el `catch(() => null)` ya existente), trazando el fallo en `COMUNICACION` sin revertir
la pre-reserva ya commiteada.

#### Scenario: E2 adjunta condicions en español

- **GIVEN** una RESERVA con `idioma = 'es'` y un tenant con condicions configuradas
- **WHEN** se confirma el presupuesto y se dispara E2
- **THEN** el email E2 lleva adjunto el PDF de condicions generado en español
- **AND** la clave del PDF en el almacén es `condiciones/{tenantId}-es.pdf`

#### Scenario: E2 adjunta condicions en catalán

- **GIVEN** una RESERVA con `idioma = 'ca'` y un tenant con condicions configuradas
- **WHEN** se confirma el presupuesto y se dispara E2
- **THEN** el email E2 lleva adjunto el PDF de condicions generado en catalán
- **AND** la clave del PDF en el almacén es `condiciones/{tenantId}-ca.pdf`

---

### Requirement: E3 ya no adjunta condicions particulars

El sistema SHALL (DEBE) enviar el email E3 (factura de señal) **únicamente** con el PDF
de la factura de señal como adjunto. E3 ya NO adjunta el PDF de condicions particulars.
`EnviarFacturaSenalUseCase` elimina toda dependencia sobre `GenerarCondicionesPort` y
`ReservasSenalEmisionPort.fijarCondicionesEnviadas`. El array de adjuntos del envío E3
solo contiene la clave `'senal'`.

El guard `CONDICIONES_NO_CONFIGURADAS` deja de ser un error posible de E3. El campo
`condPartAdjuntada` se elimina del resultado `EnviarFacturaSenalResultado`.

#### Scenario: E3 se envía sin adjunto de condicions

- **GIVEN** una RESERVA confirmada (cond_part_enviadas_fecha ya fijado por E2) lista para
  enviar la factura de señal
- **WHEN** el gestor envía la factura de señal (E3)
- **THEN** el email E3 lleva solo el adjunto de la factura de señal
- **AND** no se genera ni adjunta ningún PDF de condicions en E3

#### Scenario: E3 no bloquea por condicions no configuradas

- **GIVEN** un tenant sin condicions configuradas y una RESERVA en estado enviable de señal
- **WHEN** el gestor intenta enviar la factura de señal (E3)
- **THEN** el sistema no responde 409 `CONDICIONES_NO_CONFIGURADAS` (esa guarda ya no vive en E3)
- **AND** E3 se envía normalmente con la factura de señal como único adjunto

# Spec-delta: condiciones-idioma-e2-firma-banner (capability `confirmacion`)

## MODIFIED Requirements

### Requirement: Envío de factura de señal (E3) sin lógica de condicions

`EnviarFacturaSenalUseCase` SHALL (DEBE) eliminar toda responsabilidad relacionada con las
condicions particulars. Específicamente:

- Elimina la dependencia `GenerarCondicionesPort` de `EnviarFacturaSenalDeps`.
- Elimina `CondicionesNoConfiguradasError` como error posible del use case.
- Elimina la llamada a `repos.reservas.fijarCondicionesEnviadas()`.
- Elimina el adjunto `condiciones` del array de adjuntos de E3.
- Elimina `condPartAdjuntada` de `EnviarFacturaSenalResultado`.
- Elimina la persistencia idempotente del `DOCUMENTO condiciones_particulares` de la tx
  de E3 (el documento de condicions se genera en E2, no en E3).

El array de adjuntos de E3 MUST (DEBE) contener solo `{ clave: 'senal', nombre:
'factura-senal.pdf', pdfUrl: senal.pdfUrl }`. La idempotencia de E3 (`E3YaEnviadoError`),
la guarda de estado enviable y el resto de la lógica de señal permanecen sin cambios.

El campo `RESERVA.cond_part_enviadas_fecha` estará ya fijado cuando E3 se ejecuta (lo
fijó E2 al confirmar el presupuesto). E3 SHALL NOT (NO DEBE) modificarlo.

#### Scenario: E3 sin dependencia de condicions no lanza CondicionesNoConfiguradasError

- **GIVEN** un tenant sin condicions configuradas y una RESERVA con factura de señal en
  borrador lista para enviar
- **WHEN** el gestor ejecuta el envío E3
- **THEN** el sistema no lanza 409 `CONDICIONES_NO_CONFIGURADAS`
- **AND** E3 se envía con el adjunto de la señal únicamente
- **AND** `cond_part_enviadas_fecha` permanece como lo fijó E2

#### Scenario: E3 adjunta solo la factura de señal

- **GIVEN** una RESERVA confirmada lista para enviar la factura de señal
- **WHEN** el gestor envía E3
- **THEN** el email E3 lleva exactamente un adjunto: la factura de señal
- **AND** no se genera ni adjunta ningún PDF de condicions en E3

#### Scenario: Tests de E3 existentes no esperan adjunto de condicions

- **GIVEN** tests del use case `EnviarFacturaSenalUseCase` que verificaban que el adjunto
  `condiciones` se pasaba a `enviarE3`
- **WHEN** se actualiza el use case sin lógica de condicions
- **THEN** esos tests se actualizan para esperar solo el adjunto `senal` en el array

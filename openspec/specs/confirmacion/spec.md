# confirmacion Specification

## Purpose
TBD - created by archiving change us-021-confirmar-pago-senal-activar-reserva. Update Purpose after archive.
## Requirements
### Requirement: Precondición y validación del justificante de pago antes de confirmar

El sistema SHALL (DEBE) validar en el servidor, **antes** de cualquier mutación, que la
RESERVA está en `estado = 'pre_reserva'`, que `RESERVA.importe_total > 0` (hay un
presupuesto aceptado previo) y que el Gestor ha adjuntado **exactamente un** fichero
justificante con `mime_type ∈ {'image/jpeg', 'image/png', 'application/pdf'}` y tamaño ≤
10 MB. Si **no** se adjunta fichero, el sistema DEBE devolver el error **"Es obligatorio
adjuntar el justificante de pago"**. Si el fichero tiene un formato no permitido o excede
10 MB, el sistema DEBE rechazarlo con un mensaje específico (formato no permitido / tamaño
excedido). En cualquiera de estos rechazos **no** se produce cambio de estado de la
RESERVA, **no** se crea DOCUMENTO y **no** se modifica la `FECHA_BLOQUEADA`. (Fuente:
`US-021 §Reglas de negocio`, `§Reglas de Validación`, `§Justificante no adjuntado`,
`§Fichero justificante con formato no válido`; UC-17.)

#### Scenario: Justificante no adjuntado se rechaza sin efectos

- **GIVEN** una RESERVA en `pre_reserva` y el gestor que selecciona "Confirmar pago de
  señal" sin adjuntar ningún fichero
- **WHEN** intenta confirmar el formulario
- **THEN** el sistema muestra "Es obligatorio adjuntar el justificante de pago"
- **AND** no se produce cambio de estado ni modificación de la `FECHA_BLOQUEADA` ni se
  crea DOCUMENTO

#### Scenario: Fichero con formato no permitido o tamaño excedido se rechaza

- **GIVEN** una RESERVA en `pre_reserva` y un fichero con extensión `.exe` o de tamaño >
  10 MB
- **WHEN** el gestor intenta confirmar
- **THEN** el sistema rechaza el fichero con un mensaje de error específico (formato no
  permitido / tamaño excedido)
- **AND** no se procesa ningún cambio de estado ni se crea DOCUMENTO

### Requirement: Creación del DOCUMENTO del justificante de pago

El sistema SHALL (DEBE), al confirmar el pago de la señal con un fichero válido, crear en
la **misma transacción** de la confirmación una fila de DOCUMENTO con `tipo =
'justificante_pago'`, `reserva_id` de la RESERVA que se confirma, `tenant_id` del gestor,
`url` del fichero almacenado y `mime_type` del fichero subido. Se crea **un único**
DOCUMENTO de justificante por confirmación; una segunda confirmación concurrente de la
misma RESERVA no crea un segundo justificante (ver `consultas` §Concurrencia). (Fuente:
`US-021 §Happy Path`, `§Reglas de negocio`, `§Double-click`; `er-diagram.md §3.15
DOCUMENTO`.)

#### Scenario: Confirmar crea el DOCUMENTO justificante_pago

- **GIVEN** una RESERVA en `pre_reserva` y un justificante válido (PDF < 10 MB)
- **WHEN** el gestor confirma el pago de la señal
- **THEN** se crea una fila de DOCUMENTO con `tipo = 'justificante_pago'`, `reserva_id`,
  `tenant_id`, `url` del fichero almacenado y `mime_type`

### Requirement: Congelado de importes de señal y liquidación al confirmar

El sistema SHALL (DEBE), al confirmar, fijar `RESERVA.importe_senal = round(importe_total
× TENANT_SETTINGS.pct_senal / 100, 2)` (40% en MVP, **derivado del setting, nunca
hardcodeado**) y `RESERVA.importe_liquidacion = importe_total − importe_senal` (60%),
usando la resta para el complemento de modo que `importe_senal + importe_liquidacion =
importe_total` exactamente (sin desajuste de céntimos). El cálculo se realiza en el momento
de la confirmación a partir de `RESERVA.importe_total` fijado en la pre-reserva (US-014); el
sistema NO recalcula la tarifa. (Fuente: `US-021 §Happy Path` `importe_senal = 1.200,00 €`
/ `importe_liquidacion = 1.800,00 €`, `§Reglas de negocio` pct_senal 40/60, `§Supuestos`;
`er-diagram.md §RESERVA importe_senal/importe_liquidacion`, `§TENANT_SETTINGS pct_senal`.)

#### Scenario: 3.000 € con pct_senal 40% congela 1.200/1.800

- **GIVEN** una RESERVA en `pre_reserva` con `importe_total = 3.000,00 €` y
  `TENANT_SETTINGS.pct_senal = 40,00`
- **WHEN** el gestor confirma el pago de la señal
- **THEN** `RESERVA.importe_senal = 1.200,00 €` y `RESERVA.importe_liquidacion = 1.800,00 €`
- **AND** `importe_senal + importe_liquidacion = importe_total`

#### Scenario: El porcentaje se deriva de TENANT_SETTINGS, no hardcodeado

- **GIVEN** `TENANT_SETTINGS.pct_senal = 50,00` para el tenant y una RESERVA con
  `importe_total = 2.000,00 €`
- **WHEN** el sistema confirma la reserva
- **THEN** `RESERVA.importe_senal = 1.000,00 €` e `importe_liquidacion = 1.000,00 €`,
  derivados del setting vigente del tenant

### Requirement: Inicialización de los tres sub-procesos paralelos al confirmar

El sistema SHALL (DEBE), al confirmar, inicializar los tres sub-procesos paralelos de la
RESERVA en la misma transacción: `pre_evento_status = 'pendiente'`, `liquidacion_status =
'pendiente'` y `fianza_status = 'pendiente'`. Estos estados quedan listos para que las US
posteriores (UC-20/21/22) los avancen; este change **solo los inicializa**. (Fuente:
`US-021 §Happy Path`, `§Reglas de negocio` sub-procesos inicializados, `§Automatización
relacionada`; UC-17 paso 10; `er-diagram.md §RESERVA` enums de sub-procesos.)

#### Scenario: Confirmar deja los tres sub-procesos en pendiente

- **GIVEN** una RESERVA en `pre_reserva` que se confirma con justificante válido
- **WHEN** el sistema completa la transición a `reserva_confirmada`
- **THEN** `RESERVA.pre_evento_status = 'pendiente'`, `liquidacion_status = 'pendiente'` y
  `fianza_status = 'pendiente'`

### Requirement: Creación idempotente de la FICHA_OPERATIVA vacía (relación 1:1)

El sistema SHALL (DEBE), al confirmar, crear en la misma transacción una FICHA_OPERATIVA
con `reserva_id` de la RESERVA confirmada, **todos los campos de contenido a `NULL`**
(`num_invitados_confirmado`, `menu_seleccionado`, `timing_detallado`,
`contacto_evento_nombre`, `contacto_evento_telefono`, `notas_operativas`,
`briefing_equipo`) y `ficha_cerrada = false`. La relación es **1:1** (`reserva_id
@unique`). La creación DEBE ser **idempotente**: si ya existe una FICHA_OPERATIVA con ese
`reserva_id` (por un error previo o reintento), el sistema DEBE **detectarla y no
duplicarla**, continuando la transición sin error. (Fuente: `US-021 §Happy Path`,
`§Reglas de negocio` ficha vacía 1:1, `§FICHA_OPERATIVA ya existente (idempotencia)`;
UC-17 paso 12, UC-20; `er-diagram.md §3.14 FICHA_OPERATIVA` `reserva_id @unique`.)

#### Scenario: Confirmar crea la FICHA_OPERATIVA vacía

- **GIVEN** una RESERVA en `pre_reserva` sin FICHA_OPERATIVA
- **WHEN** el gestor confirma el pago de la señal
- **THEN** se crea una FICHA_OPERATIVA con `reserva_id`, todos los campos de contenido
  `NULL` y `ficha_cerrada = false`

#### Scenario: FICHA_OPERATIVA ya existente no se duplica (idempotencia)

- **GIVEN** una RESERVA en `pre_reserva` que ya tiene una FICHA_OPERATIVA con su
  `reserva_id` (por un error previo)
- **WHEN** el sistema intenta crear la ficha operativa durante la confirmación
- **THEN** detecta el registro existente y **no** crea un duplicado
- **AND** la transición a `reserva_confirmada` continúa sin error

### Requirement: Presentación de la factura de señal en borrador tras confirmar (disparo US-022)

El sistema SHALL (DEBE), **tras el commit** de la confirmación, generar automáticamente la
factura de señal en `borrador` (agregado FACTURA, capability `facturacion`) para su revisión
por el Gestor. Esta generación es un efecto **posterior al commit** de la transición a
`reserva_confirmada`: su ausencia o fallo **no revierte** la confirmación ya realizada (la
RESERVA permanece en `reserva_confirmada` y el sistema reintenta la generación / el PDF). Este
change **no** genera las condiciones particulares (US-023/UC-19) y **no** envía el email E3:
E3 se dispara únicamente después de que el Gestor **apruebe** la factura de señal (US-022) y el
sistema genere las condiciones particulares (US-023); mientras la factura esté en `borrador`
(o sea inválida, o su PDF esté pendiente, o haya sido rechazada), **E3 queda bloqueado**.
(Fuente: `US-022 §Historia`, `§Happy Path`, `§Email relacionado`; `US-021 §Happy Path`
"presenta la factura de señal en borrador"; UC-18.)

#### Scenario: Tras confirmar se genera la factura de señal en borrador sin enviar E3

- **GIVEN** una confirmación de señal exitosa que dejó la RESERVA en `reserva_confirmada`
- **WHEN** el sistema completa el commit
- **THEN** genera automáticamente la factura de señal en `borrador` (capability `facturacion`)
  y la presenta al Gestor para revisión
- **AND** no genera las condiciones particulares ni envía el email E3 en este change

#### Scenario: El fallo al generar la factura no revierte la confirmación

- **GIVEN** una RESERVA que ya ha transitado a `reserva_confirmada` (commit realizado)
- **WHEN** la generación de la factura de señal (o de su PDF) falla temporalmente tras el commit
- **THEN** la RESERVA permanece en `reserva_confirmada` (la confirmación no se revierte)
- **AND** el sistema reintenta la generación y E3 permanece bloqueado hasta que la factura sea
  aprobada


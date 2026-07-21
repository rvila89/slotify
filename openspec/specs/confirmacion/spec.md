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

El sistema SHALL (DEBE), al confirmar el pago de la señal y **dentro de la misma
transacción atómica** de la confirmación (bajo `SELECT ... FOR UPDATE` sobre la
fila de `FECHA_BLOQUEADA` y contexto RLS del tenant), **antes** de calcular los
importes de señal y liquidación:

1. **Obtener el total del PRESUPUESTO vigente** de la RESERVA: el de mayor
   `version` (`MAX(version)`, vigencia **derivada**, no almacenada) con `estado =
   'enviado'`.
2. **Validar `total > 0`.** Si **no** existe un presupuesto vigente válido (no
   hay presupuesto en `estado = 'enviado'`, o su `total ≤ 0`), el sistema DEBE
   lanzar `ImporteTotalInvalidoError` → **HTTP 422 `IMPORTE_TOTAL_INVALIDO`**
   ("El importe total de la reserva no es válido / no hay presupuesto aceptado")
   **sin producir ningún efecto**: no cambia `RESERVA.estado`, no crea DOCUMENTO,
   no modifica `FECHA_BLOQUEADA`, no crea FICHA_OPERATIVA, no marca el presupuesto
   y no congela `importe_total`. La guarda `validarImporteTotal` valida este total
   del presupuesto vigente y **ya no** lee un `RESERVA.importe_total` prefijado
   (que ninguna operación de producción poblaba).
3. **Congelar `RESERVA.importe_total = presupuesto.total`.**
4. **Marcar ese PRESUPUESTO como `estado = 'aceptado'`.**

A partir de ese `importe_total` recién congelado, el sistema DEBE fijar
`RESERVA.importe_senal = round(importe_total × TENANT_SETTINGS.pct_senal / 100,
2)` (40% en MVP, **derivado del setting, nunca hardcodeado**) y
`RESERVA.importe_liquidacion = importe_total − importe_senal` (60%), usando la
resta para el complemento de modo que `importe_senal + importe_liquidacion =
importe_total` exactamente (sin desajuste de céntimos). El sistema NO recalcula la
tarifa: usa el `total` ya congelado del presupuesto vigente. El congelado de
`importe_total` y el marcado del presupuesto a `aceptado` ocurren en la misma
transacción all-or-nothing que el resto de la confirmación; si cualquier
escritura falla, revierten por completo. La operación DEBE ser **coherente ante
double-click / confirmación concurrente**: solo la primera transacción congela el
importe y acepta el presupuesto; la segunda detecta que la RESERVA ya está en
`reserva_confirmada` y no re-congela ni re-acepta (ver `consultas` §Concurrencia).
(Fuente: `US-021 §Happy Path` `importe_senal = 1.200,00 €` / `importe_liquidacion
= 1.800,00 €`, `§Reglas de negocio` pct_senal 40/60, `§Supuestos`, `§Reglas de
Validación` `importe_total > 0`; UC-17; `er-diagram.md §3.12 PRESUPUESTO` vigente
= `MAX(version)`, `total`, `estado`; `§3.6 RESERVA` `importe_total`,
`importe_senal`/`importe_liquidacion`; `§TENANT_SETTINGS pct_senal`; US-022/US-027
dependen de `PRESUPUESTO(estado='aceptado')`.)

#### Scenario: Confirmar con presupuesto vigente enviado congela el total y lo acepta

- **GIVEN** una RESERVA en `pre_reserva` cuyo PRESUPUESTO vigente
  (`MAX(version)`) está en `estado = 'enviado'` con `total = 3.000,00 €`, y
  `TENANT_SETTINGS.pct_senal = 40,00`
- **WHEN** el gestor confirma el pago de la señal con un justificante válido
- **THEN** la RESERVA transiciona a `reserva_confirmada`
- **AND** `RESERVA.importe_total = 3.000,00 €` (congelado desde el presupuesto vigente)
- **AND** ese PRESUPUESTO pasa a `estado = 'aceptado'`
- **AND** `RESERVA.importe_senal = 1.200,00 €` y `RESERVA.importe_liquidacion = 1.800,00 €`
- **AND** `importe_senal + importe_liquidacion = importe_total`

#### Scenario: Sin presupuesto vigente válido se rechaza con 422 sin efectos

- **GIVEN** una RESERVA en `pre_reserva` que **no** tiene ningún PRESUPUESTO en
  `estado = 'enviado'` (o cuyo presupuesto vigente tiene `total ≤ 0`)
- **WHEN** el gestor intenta confirmar el pago de la señal con un justificante válido
- **THEN** el sistema responde **HTTP 422 `IMPORTE_TOTAL_INVALIDO`** ("no hay
  presupuesto aceptado")
- **AND** no cambia `RESERVA.estado`, no congela `importe_total`, no marca ningún
  presupuesto como `aceptado`, no crea DOCUMENTO, no modifica `FECHA_BLOQUEADA` ni
  crea FICHA_OPERATIVA

#### Scenario: El porcentaje se deriva de TENANT_SETTINGS, no hardcodeado

- **GIVEN** `TENANT_SETTINGS.pct_senal = 50,00` y una RESERVA en `pre_reserva`
  cuyo presupuesto vigente `enviado` tiene `total = 2.000,00 €`
- **WHEN** el sistema confirma la reserva
- **THEN** `RESERVA.importe_total = 2.000,00 €` congelado y el presupuesto pasa a `aceptado`
- **AND** `RESERVA.importe_senal = 1.000,00 €` e `importe_liquidacion = 1.000,00 €`,
  derivados del setting vigente del tenant

#### Scenario: Con varias versiones se toma el total de la vigente (MAX(version))

- **GIVEN** una RESERVA en `pre_reserva` con dos versiones de PRESUPUESTO —
  `version = 1` (`total = 3.000,00 €`) y `version = 2` (`total = 3.500,00 €`,
  `estado = 'enviado'`, vigente)
- **WHEN** el gestor confirma el pago de la señal
- **THEN** `RESERVA.importe_total = 3.500,00 €` (el total de la versión vigente)
- **AND** el PRESUPUESTO `version = 2` pasa a `estado = 'aceptado'`

#### Scenario: Double-click no re-congela ni re-acepta

- **GIVEN** dos confirmaciones concurrentes de la misma RESERVA en `pre_reserva`
  con presupuesto vigente `enviado`
- **WHEN** ambas se ejecutan sobre la misma fila de `FECHA_BLOQUEADA` (`SELECT ...
  FOR UPDATE`)
- **THEN** exactamente una congela `importe_total` y marca el presupuesto como
  `aceptado`
- **AND** la segunda detecta que la RESERVA ya está en `reserva_confirmada` y no
  re-congela el importe ni vuelve a marcar el presupuesto

### Requirement: Inicialización de los tres sub-procesos paralelos al confirmar

El sistema SHALL (DEBE), al confirmar, inicializar los tres sub-procesos paralelos de la
RESERVA en la misma transacción: `pre_evento_status = 'pendiente'`, `liquidacion_status =
'pendiente'` y `fianza_status = 'pendiente'`. Estos estados quedan listos para que las US
posteriores los avancen. **Tras el commit** de la confirmación, la activación de los
sub-procesos de liquidación y fianza **dispara** —como efecto posterior al commit, espejo del
disparo de la factura de señal (US-022)— la generación automática de los **borradores de la
factura de liquidación y del recibo de fianza** (agregado FACTURA, capability `facturacion`;
US-027). Esa generación es **posterior al commit**: su ausencia o fallo **no revierte** la
confirmación ya realizada (la RESERVA permanece en `reserva_confirmada` y la generación es
reintentable por idempotencia). Este change de `confirmacion` **solo** inicializa los estados y
dispara la generación; la lógica de creación de los documentos (cálculo del total, desglose
fiscal, idempotencia, alerta y auditoría) se especifica en la capability `facturacion`. (Fuente:
`US-021 §Happy Path`, `§Reglas de negocio` sub-procesos inicializados; `US-027 §Historia`,
`§Reglas de negocio`; UC-17 paso 10, UC-21, UC-22; `er-diagram.md §RESERVA` enums de
sub-procesos.)

#### Scenario: Confirmar deja los tres sub-procesos en pendiente

- **GIVEN** una RESERVA en `pre_reserva` que se confirma con justificante válido
- **WHEN** el sistema completa la transición a `reserva_confirmada`
- **THEN** `RESERVA.pre_evento_status = 'pendiente'`, `liquidacion_status = 'pendiente'` y
  `fianza_status = 'pendiente'`

#### Scenario: La activación de los sub-procesos dispara los borradores de liquidación y fianza tras el commit

- **GIVEN** una confirmación de señal exitosa que dejó la RESERVA en `reserva_confirmada` con
  `liquidacion_status = 'pendiente'` y `fianza_status = 'pendiente'`
- **WHEN** el sistema completa el commit
- **THEN** genera automáticamente los borradores de la factura de liquidación y del recibo de
  fianza (capability `facturacion`, US-027) y alerta al Gestor para su revisión

#### Scenario: El fallo al generar los borradores no revierte la confirmación

- **GIVEN** una RESERVA que ya ha transitado a `reserva_confirmada` (commit realizado)
- **WHEN** la generación de los borradores de liquidación/fianza falla temporalmente tras el commit
- **THEN** la RESERVA permanece en `reserva_confirmada` (la confirmación no se revierte)
- **AND** el sistema puede reintentar la generación sin duplicar (idempotencia por `(reserva_id,
  tipo)`)

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

### Requirement: Precondiciones y validación del fichero antes de registrar la firma

El sistema SHALL (DEBE) validar en el servidor, **antes** de cualquier mutación, que: (1)
`RESERVA.cond_part_enviadas_fecha` **no es nulo** (las condiciones se enviaron al cliente en E2,
al confirmar el presupuesto — change `condiciones-idioma-e2-firma-banner`); (2) `RESERVA.estado ∈
{reserva_confirmada, evento_en_curso, post_evento}` (nunca un estado
terminal `reserva_completada` / `reserva_cancelada` ni ningún otro); y (3) el Gestor ha adjuntado
**exactamente un** fichero con `mime_type ∈ {image/jpeg, image/png, application/pdf}` y tamaño ≤ 10 MB.
Si `cond_part_enviadas_fecha` es nulo, el sistema DEBE rechazar la operación con el mensaje **"Las
condiciones particulares no han sido enviadas al cliente aún"**. Si el estado es terminal (u otro no
permitido), el sistema DEBE rechazar con **"No se puede registrar la firma en una reserva en estado
terminal"**. Si el fichero está ausente, tiene formato no permitido o excede 10 MB, el sistema DEBE
rechazarlo con un mensaje específico. En cualquiera de estos rechazos **no** se crea `DOCUMENTO`,
**no** se modifica `RESERVA.cond_part_firmadas` ni `cond_part_firmadas_fecha`, y **no** se registra
`AUDIT_LOG`. La validación es **autoritativa en servidor**, independiente del frontend. (Fuente:
`US-024 §Reglas de negocio`, `§Reglas de Validación`, `§Condiciones no enviadas`, `§Reserva en estado
no esperado`, `§Formato de fichero no válido`; UC-19; patrón `US-021 confirmar-senal`.)

#### Scenario: Condiciones no enviadas se rechaza sin efectos

- **GIVEN** una RESERVA con `cond_part_enviadas_fecha = null`
- **WHEN** el Gestor intenta registrar la firma subiendo un fichero válido
- **THEN** el sistema muestra "Las condiciones particulares no han sido enviadas al cliente aún"
- **AND** no se crea `DOCUMENTO`, no se modifica `RESERVA.cond_part_firmadas` ni
  `cond_part_firmadas_fecha`, y no se registra `AUDIT_LOG`

#### Scenario: Reserva en estado terminal se rechaza sin efectos

- **GIVEN** una RESERVA en `reserva_completada` o `reserva_cancelada` con `cond_part_enviadas_fecha`
  informado
- **WHEN** se intenta registrar la firma de condiciones particulares
- **THEN** el sistema rechaza con "No se puede registrar la firma en una reserva en estado terminal"
- **AND** no se crea `DOCUMENTO` y no se modifica la RESERVA

### Requirement: Registro de la firma con creación del DOCUMENTO firmado y actualización de la reserva

El sistema SHALL (DEBE), al registrar la firma con precondiciones y fichero válidos, ejecutar en una
**única transacción atómica** (bajo el contexto RLS del tenant del JWT) all-or-nothing: (1) subir el
fichero firmado al almacén de documentos y **crear una nueva fila `DOCUMENTO`** con
`tipo = 'condiciones_particulares'`, `reserva_id` de la RESERVA, `tenant_id` del Gestor, `url` del
fichero almacenado, `mime_type` del fichero subido, `nombre_archivo` y `tamano_bytes`; (2) actualizar
`RESERVA.cond_part_firmadas = true` y `RESERVA.cond_part_firmadas_fecha = now()`; y (3) registrar
`AUDIT_LOG` con `accion = 'actualizar'`, `entidad = 'RESERVA'`,
`datos_anteriores.cond_part_firmadas` (su valor previo), `datos_nuevos.cond_part_firmadas = true` y
`datos_nuevos.cond_part_firmadas_fecha`. El `DOCUMENTO` **original NO firmado** (persistido en US-023
con el mismo `tipo = 'condiciones_particulares'`) **permanece** en BD: la copia firmada se añade como
fila nueva, no lo sustituye ni lo elimina. Si el envío al almacén o cualquier escritura falla, la
transacción **revierte por completo** (no queda `DOCUMENTO` huérfano ni `RESERVA` mutada). (Fuente:
`US-024 §Happy Path`, `§Reglas de negocio`; `er-diagram.md §DOCUMENTO`, `§RESERVA cond_part_*`;
`design.md §D-documento-repo, §D-almacenamiento`.)

#### Scenario: Registrar la firma crea el DOCUMENTO firmado y marca la reserva

- **GIVEN** una RESERVA en `reserva_confirmada`, `cond_part_enviadas_fecha` informado y
  `cond_part_firmadas = false`
- **WHEN** el Gestor sube la copia firmada (PDF o imagen ≤ 10 MB) y confirma
- **THEN** se crea una fila `DOCUMENTO` con `tipo = 'condiciones_particulares'`, `reserva_id`,
  `tenant_id`, `url` del fichero almacenado y `mime_type` del fichero
- **AND** `RESERVA.cond_part_firmadas = true` y `RESERVA.cond_part_firmadas_fecha` queda con el
  timestamp del registro
- **AND** `AUDIT_LOG` registra `accion = 'actualizar'`, `entidad = 'RESERVA'`,
  `datos_anteriores.cond_part_firmadas = false`, `datos_nuevos.cond_part_firmadas = true` y
  `datos_nuevos.cond_part_firmadas_fecha`

#### Scenario: El DOCUMENTO original no firmado permanece tras registrar la firma

- **GIVEN** una RESERVA con un `DOCUMENTO` `condiciones_particulares` original no firmado (US-023)
- **WHEN** el Gestor registra la firma subiendo la copia firmada
- **THEN** existen **dos** filas `DOCUMENTO` de `tipo = 'condiciones_particulares'` para la reserva
  (el original no firmado y la copia firmada)
- **AND** el original no se elimina ni se sobrescribe

#### Scenario: Un fallo al persistir revierte todo (sin DOCUMENTO huérfano)

- **GIVEN** una RESERVA válida y un fichero firmado válido
- **WHEN** una escritura de la transacción de registro de firma falla
- **THEN** la RESERVA conserva sus valores previos de `cond_part_firmadas` y `cond_part_firmadas_fecha`
- **AND** no queda persistida ninguna fila `DOCUMENTO` de la copia firmada de esa transacción

### Requirement: La firma no transiciona el estado de la reserva y es válida en tres estados

El sistema SHALL (DEBE) tratar el registro de la firma como una **actualización de campos, no como
una transición de máquina de estados**: `RESERVA.estado` y todos los sub-procesos
(`pre_evento_status`, `liquidacion_status`, `fianza_status`) **permanecen inalterados**; solo cambian
`cond_part_firmadas` y `cond_part_firmadas_fecha`. La operación es **válida en los tres estados**
`reserva_confirmada`, `evento_en_curso` y `post_evento` (la firma puede registrarse hasta el cierre
del post-evento, incluida la firma presencial el día del evento). El `AUDIT_LOG` de esta operación usa
`accion = 'actualizar'` (nunca `'transicion'`), coherente con otras mutaciones de campos que no
cambian estado (p. ej. la prórroga de TTL de US-006). (Fuente: `US-024 §Reglas de negocio` "puede
extenderse hasta `evento_en_curso`", `§Reglas de Validación` `estado ∈ {reserva_confirmada,
evento_en_curso, post_evento}`, `§FA-01` "la reserva no queda bloqueada y puede progresar a
`evento_en_curso`"; `design.md §D-no-transicion`; `er-diagram.md` prórroga TTL "no es una transición
de máquina de estados".)

#### Scenario: Registrar la firma no cambia el estado ni los sub-procesos

- **GIVEN** una RESERVA en `evento_en_curso` con `cond_part_enviadas_fecha` informado
- **WHEN** el Gestor registra la firma presencial subiendo la foto del documento firmado
- **THEN** `RESERVA.cond_part_firmadas = true` y `cond_part_firmadas_fecha` queda registrado
- **AND** `RESERVA.estado` sigue siendo `evento_en_curso` y `pre_evento_status` /
  `liquidacion_status` / `fianza_status` no cambian
- **AND** el `AUDIT_LOG` usa `accion = 'actualizar'`, no `'transicion'`

#### Scenario: La firma se acepta en post_evento

- **GIVEN** una RESERVA en `post_evento` con `cond_part_enviadas_fecha` informado y
  `cond_part_firmadas = false`
- **WHEN** el Gestor registra la firma con un fichero válido
- **THEN** el sistema acepta la operación y marca `cond_part_firmadas = true`

### Requirement: Re-registro de la firma permitido conservando el histórico de documentos

El sistema SHALL (DEBE) permitir **registrar la firma de nuevo** aunque `RESERVA.cond_part_firmadas`
ya sea `true` (p. ej. subir una versión más legible del documento firmado). En ese caso el sistema
DEBE **crear otra fila `DOCUMENTO`** de `tipo = 'condiciones_particulares'` (la nueva versión),
**actualizar** `cond_part_firmadas_fecha` al nuevo timestamp, **mantener** `cond_part_firmadas = true`,
y **conservar** todas las filas `DOCUMENTO` anteriores (el histórico no se elimina; el `DOCUMENTO` más
reciente es el de referencia). El `AUDIT_LOG` registra `accion = 'actualizar'` con
`datos_anteriores.cond_part_firmadas = true`. La creación del `DOCUMENTO` firmado es **no idempotente
por diseño** (a diferencia del `DOCUMENTO` original no firmado de US-023, que sí es único por reserva):
cada registro de firma añade una versión nueva. (Fuente: `US-024 §Firma ya registrada — intento de
doble registro`; `design.md §D-re-firma`.)

#### Scenario: Un segundo registro crea otra versión y actualiza la fecha sin borrar el histórico

- **GIVEN** una RESERVA con `cond_part_firmadas = true` y una copia firmada ya registrada
- **WHEN** el Gestor sube una versión más legible del documento firmado y confirma
- **THEN** se crea una **nueva** fila `DOCUMENTO` de `tipo = 'condiciones_particulares'` (la copia
  anterior permanece en BD)
- **AND** `RESERVA.cond_part_firmadas_fecha` se actualiza al nuevo timestamp y
  `cond_part_firmadas` sigue siendo `true`
- **AND** `AUDIT_LOG` registra `accion = 'actualizar'` con `datos_anteriores.cond_part_firmadas = true`

### Requirement: Señal consultable de firma pendiente para la alerta del día del evento (FA-01)

El sistema SHALL (DEBE) exponer `RESERVA.cond_part_firmadas` y `RESERVA.cond_part_firmadas_fecha` como
**señal consultable** en la lectura de la reserva, de modo que el frontend pueda mostrar una **alerta
informativa no bloqueante** "Condiciones particulares pendientes de firma" cuando
`cond_part_firmadas = false`. Esta alerta **NO bloquea** la reserva ni impide su progreso (incluida la
futura transición a `evento_en_curso`). El **disparo automático por cron el día del evento** (FA-01
completo) queda **FUERA del alcance de US-024**: es responsabilidad de UC-23 (Iniciar Evento), no se
crea ningún barrido ni endpoint de cron en este flujo. US-024 solo garantiza que la señal (flag +
fecha) es consultable y que la alerta puede mostrarse en la ficha. (Fuente: `US-024 §FA-01`,
`§Automatización relacionada`, `§Notas de alcance` "el disparo de la alerta automática por cron es
parte de la lógica de UC-23 … no cubierto en este lote"; `design.md §D-fa01-alcance`.)

#### Scenario: La señal de firma pendiente es consultable sin bloquear la reserva

- **GIVEN** una RESERVA en `reserva_confirmada` con `cond_part_enviadas_fecha` informado y
  `cond_part_firmadas = false`
- **WHEN** se lee la reserva
- **THEN** la respuesta expone `cond_part_firmadas = false` y `cond_part_firmadas_fecha = null`
- **AND** la reserva no queda bloqueada por la ausencia de firma (puede progresar a `evento_en_curso`)

#### Scenario: US-024 no introduce el cron de la alerta

- **WHEN** se inspecciona el alcance implementado de US-024
- **THEN** no existe ningún endpoint `/cron/...` ni barrido nuevo asociado a la alerta de firma
  pendiente
- **AND** el disparo automático de la alerta el día del evento queda diferido a UC-23

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


# Spec Delta — Capability `confirmacion` (US-024)

> US-024 añade el **segundo flujo de UC-19**: el registro de la **firma** de las condiciones
> particulares. El Gestor sube la copia firmada; el sistema crea una nueva fila `DOCUMENTO`
> `condiciones_particulars`, marca `RESERVA.cond_part_firmadas = true`, fija
> `cond_part_firmadas_fecha` y audita, **sin transicionar el estado** de la reserva. Reutiliza el
> patrón multipart de US-021 (`confirmar-senal`), la entidad `DOCUMENTO` (enum
> `condiciones_particulares` ya existente), el almacén de documentos y los campos `cond_part_*` del
> modelo. **No hay migración.** Fuente: `US-024` (§Happy Path, §Reglas de negocio, §Reglas de
> Validación, §FA-01, §Condiciones no enviadas, §Firma ya registrada, §Reserva en estado no
> esperado); UC-19 (segundo flujo); `er-diagram.md §RESERVA cond_part_*`, `§DOCUMENTO`;
> `design.md §D-no-transicion, §D-documento-repo, §D-almacenamiento, §D-re-firma`.

## ADDED Requirements

### Requirement: Precondiciones y validación del fichero antes de registrar la firma

El sistema SHALL (DEBE) validar en el servidor, **antes** de cualquier mutación, que: (1)
`RESERVA.cond_part_enviadas_fecha` **no es nulo** (las condiciones se enviaron al cliente en E3,
US-023); (2) `RESERVA.estado ∈ {reserva_confirmada, evento_en_curso, post_evento}` (nunca un estado
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
- **AND** no se modifica ninguna entidad

#### Scenario: Fichero ausente, con formato no permitido o tamaño excedido se rechaza

- **GIVEN** una RESERVA válida (`cond_part_enviadas_fecha` informado, estado
  `reserva_confirmada`/`evento_en_curso`/`post_evento`) y un fichero `.docx`, un fichero > 10 MB, o
  ningún fichero
- **WHEN** el Gestor intenta confirmar el registro
- **THEN** el sistema muestra un error de validación específico (formato no permitido / tamaño
  excedido / fichero obligatorio)
- **AND** no se crea `DOCUMENTO`, no se modifica `RESERVA` y no se registra `AUDIT_LOG`

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

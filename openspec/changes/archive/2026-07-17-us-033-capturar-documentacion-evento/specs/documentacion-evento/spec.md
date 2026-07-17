# Spec Delta — Capability `documentacion-evento` (US-033)

> US-033 introduce la **captura de la documentación obligatoria del evento** (foto DNI
> anverso, foto DNI reverso y cláusula de responsabilidad firmada) con un **checklist en
> tiempo real**. El Gestor/Equipo sube cada documento mientras la RESERVA está en
> `evento_en_curso`; el sistema crea una fila `DOCUMENTO` por subida (no idempotente, conserva
> histórico), audita, y expone el estado del checklist. Reutiliza el patrón multipart de
> US-021 (`confirmar-senal`), la entidad `DOCUMENTO` (enum `dni_anverso` / `dni_reverso` /
> `clausula_responsabilidad` ya existente), el puerto de almacén durable
> `AlmacenDocumentosPort` y el puerto de repositorio de `DOCUMENTO` (generalizado). **No hay
> migración.** Fuente: `US-033` (§Happy Path, §Reglas de negocio, §Reglas de Validación, §FA-01,
> §Sustitución de un documento ya subido, §Acceso desde escritorio, §Formato de archivo no
> admitido, §Archivo vacío o corrupto); UC-24; A30; `er-diagram.md §DOCUMENTO`,
> `TipoDocumento`; `documentos` `AlmacenDocumentosPort` / `DocumentoRepositoryPort`;
> `design.md §D-capability, §D-endpoints, §D-documento-repo, §D-checklist, §D-no-idempotencia,
> §D-almacenamiento, §D-no-transicion, §D-validacion-servidor, §D-fa01-alcance`.

## ADDED Requirements

### Requirement: Guarda de estado — la documentación del evento solo se captura en evento_en_curso

El sistema SHALL (DEBE) permitir la **subida** de un documento obligatorio del evento
(`dni_anverso`, `dni_reverso`, `clausula_responsabilidad`) para una RESERVA **solo** cuando
`RESERVA.estado = evento_en_curso`. La guarda se valida **en el servidor, de forma
autoritativa, antes** de cualquier subida al almacén o escritura en BD. Si la RESERVA está en
cualquier otro estado (anterior o posterior, incluidos los terminales), el sistema DEBE
rechazar la subida con el mensaje **"La documentación del evento solo puede capturarse mientras
el evento está en curso"** (código `ESTADO_NO_PERMITE_DOCUMENTACION`), **sin** subir el
fichero, **sin** crear `DOCUMENTO` y **sin** registrar `AUDIT_LOG`. La subida **no es una
transición** de la máquina de estados: `RESERVA.estado` y sus sub-procesos permanecen
inalterados. Toda operación filtra por el `tenant_id` del JWT (multi-tenancy/RLS): una RESERVA
de otro tenant no es visible (404) ni operable. (Fuente: `US-033 §Reglas de negocio` "Solo
disponible cuando `RESERVA.estado = evento_en_curso`", `§Reglas de Validación`; UC-24;
`design.md §D-no-transicion`; `CLAUDE.md` multi-tenancy.)

#### Scenario: Subida aceptada en evento_en_curso

- **GIVEN** una RESERVA en `estado = evento_en_curso` bajo el tenant del JWT
- **WHEN** el Gestor sube un documento válido (`tipo = dni_anverso`, JPEG ≤ 10 MB)
- **THEN** la subida se admite y el sistema procede a crear el `DOCUMENTO`
- **AND** `RESERVA.estado` sigue siendo `evento_en_curso` y sus sub-procesos no cambian

#### Scenario: Subida rechazada fuera de evento_en_curso sin efectos

- **GIVEN** una RESERVA en `estado = reserva_confirmada` (o cualquier estado distinto de
  `evento_en_curso`, incluidos terminales)
- **WHEN** el Gestor intenta subir un documento del evento
- **THEN** el sistema rechaza con "La documentación del evento solo puede capturarse mientras
  el evento está en curso" (`ESTADO_NO_PERMITE_DOCUMENTACION`)
- **AND** no se sube ningún fichero al almacén, no se crea `DOCUMENTO` y no se registra
  `AUDIT_LOG`

#### Scenario: RESERVA de otro tenant no es operable

- **GIVEN** una RESERVA que pertenece a un tenant distinto del JWT
- **WHEN** el Gestor intenta subir un documento del evento a esa RESERVA
- **THEN** el sistema responde 404 (no visible bajo RLS) y no muta ninguna entidad

### Requirement: Validación autoritativa del fichero y del tipo antes de persistir

El sistema SHALL (DEBE) validar en el servidor, **antes** de cualquier mutación: (1) que se
adjunta **exactamente un** fichero; (2) que su `mime_type ∈ {image/jpeg, image/png,
application/pdf}`; (3) que su `tamano_bytes > 0` (rechazo de archivo vacío o corrupto) y su
tamaño ≤ 10 MB; y (4) que el `tipo` indicado pertenece al conjunto de tipos obligatorios del
evento `{dni_anverso, dni_reverso, clausula_responsabilidad}`. Si el fichero está ausente, su
formato no está admitido, está vacío/corrupto (`tamano_bytes = 0`) o excede 10 MB, el sistema
DEBE rechazar con un mensaje específico —incluyendo **"Formato no admitido. Por favor, usa
JPEG, PNG o PDF."** para el formato y **"El archivo no pudo procesarse. Por favor, inténtalo de
nuevo con un archivo válido."** para el archivo vacío/corrupto—. Si el `tipo` no es uno de los
tres obligatorios, el sistema DEBE rechazar con `TIPO_DOCUMENTO_NO_PERMITIDO`. En cualquiera de
estos rechazos **no** se crea `DOCUMENTO`, **no** se sube el fichero al almacén y **no** se
registra `AUDIT_LOG`. La validación es **autoritativa en servidor**, independiente de la
validación de conveniencia del frontend. (Fuente: `US-033 §Reglas de Validación` (formatos,
`tamano_bytes > 0`), `§Formato de archivo no admitido`, `§Archivo vacío o corrupto`; patrón
`US-021 confirmar-senal`; `design.md §D-validacion-servidor`.)

#### Scenario: Formato no admitido se rechaza sin efectos

- **GIVEN** una RESERVA en `evento_en_curso` y un fichero `.docx` o `.heic`
- **WHEN** el Gestor intenta subirlo como `dni_anverso`
- **THEN** el sistema responde con "Formato no admitido. Por favor, usa JPEG, PNG o PDF."
- **AND** no se crea `DOCUMENTO`, no se sube al almacén y no se registra `AUDIT_LOG`

#### Scenario: Archivo vacío o corrupto se rechaza sin efectos

- **GIVEN** una RESERVA en `evento_en_curso` y un fichero con `tamano_bytes = 0` (o corrupto,
  ilegible)
- **WHEN** el Gestor intenta subirlo
- **THEN** el sistema responde con "El archivo no pudo procesarse. Por favor, inténtalo de
  nuevo con un archivo válido."
- **AND** no se crea ningún registro `DOCUMENTO`

#### Scenario: Fichero ausente o tamaño excedido se rechaza

- **GIVEN** una RESERVA en `evento_en_curso`
- **WHEN** el Gestor confirma la subida sin adjuntar fichero, o con un fichero > 10 MB
- **THEN** el sistema rechaza con un mensaje específico (fichero obligatorio / tamaño excedido)
- **AND** no se crea `DOCUMENTO` ni se muta ninguna entidad

#### Scenario: Tipo de documento no permitido se rechaza

- **GIVEN** una RESERVA en `evento_en_curso` y un fichero válido
- **WHEN** el Gestor indica un `tipo` que no es `dni_anverso` / `dni_reverso` /
  `clausula_responsabilidad`
- **THEN** el sistema rechaza con `TIPO_DOCUMENTO_NO_PERMITIDO`
- **AND** no se crea `DOCUMENTO`

### Requirement: Subida de un documento del evento crea el DOCUMENTO y lo audita

El sistema SHALL (DEBE), al subir un documento válido con las precondiciones satisfechas,
ejecutar en una **única transacción atómica** (bajo el contexto RLS del tenant del JWT)
all-or-nothing: (1) subir los bytes del fichero al almacén de documentos **durable**
(`AlmacenDocumentosPort.subir(bytes, clave)`) con una clave que **incluye el `tenant_id`**, el
`reserva_id` y el `tipo` (aislamiento y agrupación); (2) **crear una fila `DOCUMENTO`** con
`tipo` (uno de `dni_anverso` / `dni_reverso` / `clausula_responsabilidad`), `reserva_id` de la
RESERVA, `tenant_id` del Gestor (heredado de la RESERVA, nunca del input), `url` del fichero
almacenado, `mime_type` del fichero, `nombre_archivo` y `tamano_bytes > 0`; y (3) registrar
`AUDIT_LOG` con `accion = 'crear'`, `entidad = 'DOCUMENTO'` y `datos_nuevos` (tipo, reservaId,
url, mimeType, tamanoBytes). Si la subida al almacén o cualquier escritura falla, la
transacción **revierte por completo** (no queda `DOCUMENTO` huérfano ni fichero referenciado
por una fila inexistente). La respuesta de la operación DEBE incluir el `DOCUMENTO` creado y el
**checklist actualizado** de la reserva. (Fuente: `US-033 §Happy Path` (crear `DOCUMENTO` con
`tipo`/`reserva_id`/`tenant_id`/`url`/`mime_type`/`tamano_bytes > 0` + ✅ checklist +
`AUDIT_LOG`), `§Reglas de Validación` (`tenant_id` heredado, `reserva_id` obligatorio); A30;
`er-diagram.md §DOCUMENTO`; `documentos` `AlmacenDocumentosPort`; `design.md §D-almacenamiento,
§D-documento-repo`.)

#### Scenario: Subir el DNI anverso crea el DOCUMENTO, marca el checklist y audita

- **GIVEN** una RESERVA en `evento_en_curso` sin ningún documento del evento subido
- **WHEN** el Gestor sube la foto del DNI anverso (JPEG) indicando `tipo = dni_anverso`
- **THEN** se crea una fila `DOCUMENTO` con `tipo = dni_anverso`, `reserva_id` de la reserva,
  `tenant_id` del tenant, `url` del almacenamiento, `mime_type = image/jpeg` y
  `tamano_bytes > 0`
- **AND** el ítem "DNI anverso" del checklist queda `completado = true`
- **AND** `AUDIT_LOG` registra `accion = 'crear'`, `entidad = 'DOCUMENTO'`

#### Scenario: Completar los tres documentos deja el checklist sin pendientes

- **GIVEN** una RESERVA en `evento_en_curso` con el DNI anverso ya subido
- **WHEN** el Gestor sube el DNI reverso (imagen) y la cláusula de responsabilidad firmada
  (PDF)
- **THEN** se crean filas `DOCUMENTO` con `tipo = dni_reverso` y `tipo =
  clausula_responsabilidad`
- **AND** los tres ítems del checklist quedan `completado = true` y no hay pendientes

#### Scenario: Un fallo al persistir revierte todo (sin DOCUMENTO huérfano)

- **GIVEN** una RESERVA en `evento_en_curso` y un fichero válido
- **WHEN** una escritura de la transacción de subida falla
- **THEN** no queda persistida ninguna fila `DOCUMENTO` de esa transacción
- **AND** el checklist de la reserva no refleja el documento fallido

### Requirement: Re-subida del mismo tipo crea una nueva fila conservando el histórico

El sistema SHALL (DEBE) permitir **subir de nuevo** un documento del mismo `tipo` para la misma
RESERVA aunque ya exista uno (p. ej. sustituir una foto borrosa). En ese caso el sistema DEBE
**crear una nueva fila `DOCUMENTO`** con la nueva `url`, **sin** eliminar ni sobrescribir las
filas anteriores (histórico preservado en la tabla `DOCUMENTO` para trazabilidad). El checklist
DEBE mostrar el ítem como **completado** (basado en "existe ≥ 1 documento del tipo") y tomar el
documento **más reciente** (por `fecha_creacion`) como referencia. La creación es **no
idempotente por diseño**: a diferencia del `DOCUMENTO` de condiciones particulares de US-023
(único por reserva, busca-antes-de-crear), la documentación del evento se versiona sin
buscar-antes-de-crear. (Fuente: `US-033 §Sustitución de un documento ya subido`, `§Reglas de
negocio` "se crea un nuevo registro DOCUMENTO (no se sobreescribe)"; `design.md
§D-no-idempotencia`.)

#### Scenario: Segunda foto del mismo tipo crea otra fila sin borrar la anterior

- **GIVEN** una RESERVA en `evento_en_curso` con un `DOCUMENTO` `tipo = dni_anverso` ya subido
  (la foto anterior está desenfocada)
- **WHEN** el Gestor sube una nueva foto del DNI anverso
- **THEN** existen **dos** filas `DOCUMENTO` de `tipo = dni_anverso` para la reserva (la
  anterior permanece)
- **AND** el ítem "DNI anverso" del checklist sigue `completado = true` y su documento de
  referencia es el más reciente
- **AND** no se elimina ni se sobrescribe el registro anterior

### Requirement: Checklist consultable del estado de la documentación del evento

El sistema SHALL (DEBE) exponer un **checklist consultable** del estado de la documentación
obligatoria del evento de una RESERVA, con los **tres ítems** `dni_anverso`, `dni_reverso` y
`clausula_responsabilidad`. Para cada ítem, `completado = existe ≥ 1 DOCUMENTO de ese `tipo` +
`reserva_id` bajo RLS del tenant`; opcionalmente se incluye el documento **más reciente** (por
`fecha_creacion`) como referencia. El checklist se **deriva por lectura** de las filas
`DOCUMENTO` (no se materializa como estado agregado en la RESERVA) y DEBE devolverse tanto en un
**endpoint de lectura dedicado** como en la **respuesta de cada subida**, para refresco en
tiempo real. El checklist filtra por `tenant_id` del JWT (RLS): nunca incluye documentos de otro
tenant. La documentación incompleta se refleja como ítems pendientes, pero es una **señal
informativa**: NO bloquea ninguna transición de la reserva (ver FA-01). (Fuente: `US-033
§Happy Path` (checklist en tiempo real, tres ítems ✅), `§Reglas de Validación` (el checklist
refleja el estado por existencia de ≥ 1 DOCUMENTO por tipo + reserva); `design.md §D-checklist`.)

#### Scenario: El checklist refleja el estado por existencia de documento por tipo

- **GIVEN** una RESERVA con un `DOCUMENTO` `dni_anverso` y sin documentos `dni_reverso` ni
  `clausula_responsabilidad`
- **WHEN** se consulta el checklist de la reserva
- **THEN** el ítem `dni_anverso` es `completado = true` y `dni_reverso` /
  `clausula_responsabilidad` son `completado = false`
- **AND** el ítem completado referencia el documento `dni_anverso` más reciente

#### Scenario: El checklist se actualiza en la respuesta de cada subida

- **GIVEN** una RESERVA en `evento_en_curso` con el checklist con los tres ítems pendientes
- **WHEN** el Gestor sube el DNI reverso
- **THEN** la respuesta de la subida incluye el checklist con `dni_reverso` ya `completado = true`
  (sin necesitar una segunda petición)

#### Scenario: El checklist no incluye documentos de otro tenant

- **GIVEN** dos tenants A y B, cada uno con su RESERVA y sus documentos del evento
- **WHEN** se consulta el checklist bajo el contexto RLS del tenant A
- **THEN** solo se cuentan los documentos del tenant A
- **AND** los del tenant B no son visibles ni afectan al `completado`

### Requirement: La documentación incompleta no bloquea el flujo del evento (FA-01)

El sistema SHALL (DEBE) tratar la documentación incompleta como una condición **informativa, no
bloqueante**: la ausencia de uno o más documentos obligatorios **NO** impide la progresión de la
RESERVA (en particular, no bloquea la futura transición a `post_evento`, que es responsabilidad
de US-034). US-033 **solo** garantiza que el checklist (señal consultable) refleja los ítems
pendientes para que el frontend pueda mostrar una **advertencia informativa**; **no** implementa
la transición a `post_evento`, **no** implementa la advertencia al finalizar el evento, y **no**
crea ningún cron/barrido. Tras finalizar el evento, los ítems pendientes DEBEN seguir siendo
**consultables** en la ficha para permitir la subida tardía. (Fuente: `US-033 §FA-01 —
Documentación incompleta al finalizar el evento` "la documentación incompleta no bloquea el
flujo; la alerta es informativa", `§Dependencias` (US-034 dueño de la transición); `design.md
§D-fa01-alcance`.)

#### Scenario: Documentación incompleta no bloquea la reserva

- **GIVEN** una RESERVA en `evento_en_curso` con solo el DNI anverso subido (reverso y cláusula
  pendientes)
- **WHEN** se consulta el estado de la reserva y su checklist
- **THEN** el checklist muestra `dni_reverso` y `clausula_responsabilidad` pendientes
- **AND** la reserva no queda bloqueada por la documentación incompleta (puede progresar a
  `post_evento`, cuya transición pertenece a US-034)

#### Scenario: US-033 no introduce cron ni la transición de finalización

- **WHEN** se inspecciona el alcance implementado de US-033
- **THEN** no existe ningún endpoint `/cron/...` ni barrido nuevo asociado a la documentación
  del evento
- **AND** la transición a `post_evento` y su advertencia de documentación pendiente quedan
  diferidas a US-034

#### Scenario: El checklist sigue consultable en post_evento para subida tardía

- **GIVEN** una RESERVA que transicionó a `post_evento` con documentación incompleta
- **WHEN** se consulta el checklist de la reserva
- **THEN** el sistema devuelve el estado de los tres ítems con los pendientes marcados
- **AND** los ítems pendientes permanecen accesibles en la ficha para subida tardía

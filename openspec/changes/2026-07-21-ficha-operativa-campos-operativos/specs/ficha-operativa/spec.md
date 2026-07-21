# Spec Delta — Capability `ficha-operativa`

> Ajusta el conjunto de campos de la **FICHA_OPERATIVA** de una consulta
> confirmada: elimina `menu_seleccionado` y `timing_detallado` (texto libre sin
> estructura), añade `contacto_evento_correo` (pre-rellenado desde la reserva),
> `hora_llegada` (HH:MM) y `duracion` (texto libre estructurado). Afecta al
> contrato OpenAPI, al backend NestJS/Prisma y al frontend React.
> Fuente: petición de usuario; specs `ficha-operativa/spec.md` (US-025, US-026).

## MODIFIED Requirements

### Requirement: Lectura de la ficha operativa de una RESERVA confirmada

El sistema SHALL (DEBE) devolver la FICHA_OPERATIVA asociada a una RESERVA
accesible (ver guarda de acceso), incluyendo los campos de contenido
(`num_invitados_confirmado`, `contacto_evento_nombre`, `contacto_evento_telefono`,
`contacto_evento_correo`, `hora_llegada`, `duracion`, `notas_operativas`,
`briefing_equipo`), el flag `ficha_cerrada`, la `fecha_cierre` (nullable mientras
no se haya cerrado) y el `RESERVA.pre_evento_status` vigente, sin mutar ningún
estado. Los campos `menu_seleccionado` y `timing_detallado` se eliminan del
contrato y de la respuesta (las columnas permanecen en la BD como nullable). La
relación es 1:1 (`FICHA_OPERATIVA.reserva_id @unique`). (Fuente: `US-025 §Historia`,
`§Reglas de Validación`; `er-diagram.md §3.14 FICHA_OPERATIVA`.)

#### Scenario: Leer la ficha devuelve los nuevos campos de contenido sin mutar estado

- **GIVEN** una RESERVA confirmada con `pre_evento_status = pendiente` y su
  FICHA_OPERATIVA con `contacto_evento_correo` sembrado desde la reserva y el
  resto de campos nulos
- **WHEN** el Gestor lee la ficha operativa
- **THEN** el sistema devuelve los campos de contenido (incluyendo
  `contacto_evento_correo` pre-rellenado, y `hora_llegada = NULL`,
  `duracion = NULL`), `ficha_cerrada = false`, `fecha_cierre = NULL` y
  `pre_evento_status = pendiente`
- **AND** la respuesta NO incluye `menu_seleccionado` ni `timing_detallado`
- **AND** `pre_evento_status` permanece `pendiente` (leer no dispara la transición)

### Requirement: Guardado parcial de campos de la ficha operativa

El sistema SHALL (DEBE) permitir al Gestor persistir en la FICHA_OPERATIVA cualquier
subconjunto de los campos `num_invitados_confirmado`, `contacto_evento_nombre`,
`contacto_evento_telefono`, `contacto_evento_correo`, `hora_llegada`, `duracion`,
`notas_operativas`, `briefing_equipo`. Los campos `menu_seleccionado` y
`timing_detallado` ya no forman parte del DTO de escritura. Todos los campos son
opcionales: el guardado es parcial/progresivo (varias pasadas), ningún campo es
bloqueante para guardar. El sistema registra el guardado en `AUDIT_LOG`. (Fuente:
`US-025 §Happy Path`, `§Reglas de Validación`; `er-diagram.md §3.14
FICHA_OPERATIVA`.)

#### Scenario: Guardar hora_llegada y duracion persiste solo esos campos

- **GIVEN** una RESERVA confirmada con su FICHA_OPERATIVA vacía (excepto
  `contacto_evento_correo` pre-rellenado desde la reserva)
- **WHEN** el Gestor guarda `num_invitados_confirmado = 85`,
  `hora_llegada = "18:00"`, `duracion = "4h"`,
  `contacto_evento_nombre = "María López"` y `notas_operativas = "Alergia a los
  frutos secos"`
- **THEN** el sistema persiste esos campos en la FICHA_OPERATIVA
- **AND** registra el cambio en `AUDIT_LOG`

### Requirement: Cierre de la ficha no bloqueado por campos vacíos

El sistema SHALL (DEBE), cuando el Gestor activa "Cerrar ficha" sobre una
FICHA_OPERATIVA accesible con `RESERVA.pre_evento_status = en_curso`, fijar en la
misma transacción `FICHA_OPERATIVA.ficha_cerrada = true`,
`FICHA_OPERATIVA.fecha_cierre = now()` y transicionar
`RESERVA.pre_evento_status: en_curso → cerrado`, registrando la transición en
`AUDIT_LOG`. El cierre NO está bloqueado por campos vacíos: si faltan campos
opcionales como `hora_llegada`, `duracion` o `briefing_equipo`, el sistema permite
el cierre y devuelve un aviso puramente informativo sobre los campos vacíos; ese
aviso no es un error. (Fuente: `US-025 §Happy Path`, `§Cierre con campos opcionales
vacíos`, `§Reglas de negocio`.)

#### Scenario: Cerrar con hora_llegada y duracion vacíos se permite con aviso informativo

- **GIVEN** una FICHA_OPERATIVA con `num_invitados_confirmado` relleno pero
  `hora_llegada`, `duracion` y `briefing_equipo` vacíos, y `pre_evento_status =
  en_curso`
- **WHEN** el Gestor hace clic en "Cerrar ficha"
- **THEN** el sistema permite el cierre sin bloqueo, `pre_evento_status` pasa a
  `cerrado` y muestra un aviso informativo sobre los campos vacíos (no es error)

## ADDED Requirements

### Requirement: Pre-relleno de contacto_evento_correo desde la reserva al crear la ficha

El sistema SHALL (DEBE), en el mismo momento en que crea la `FICHA_OPERATIVA` al
confirmar una reserva (US-021), sembrar el campo `contacto_evento_correo` con el
valor del correo de contacto del lead/cliente disponible en la `RESERVA`. Si la
reserva no dispone de correo de contacto, el campo se inicia como `NULL`. El Gestor
puede modificar `contacto_evento_correo` posteriormente como cualquier otro campo
editable de la ficha. (Fuente: petición de usuario; `US-025 §Guardado parcial`;
US-021 creación de ficha al confirmar.)

#### Scenario: Al confirmar la reserva la ficha incluye el correo de contacto pre-rellenado

- **GIVEN** una RESERVA en `pre_reserva` con correo de contacto registrado
  (`contacto_email = "maria@example.com"`) que pasa a `reserva_confirmada` (US-021)
- **WHEN** el sistema crea la FICHA_OPERATIVA asociada
- **THEN** la ficha se crea con `contacto_evento_correo = "maria@example.com"`
- **AND** el resto de campos de contenido son `NULL`

#### Scenario: Si la reserva no tiene correo de contacto el campo queda nulo

- **GIVEN** una RESERVA en `pre_reserva` sin correo de contacto registrado que
  pasa a `reserva_confirmada`
- **WHEN** el sistema crea la FICHA_OPERATIVA asociada
- **THEN** la ficha se crea con `contacto_evento_correo = NULL`

## REMOVED Requirements

- `menu_seleccionado` y `timing_detallado` se eliminan de los campos editables y
  de la respuesta del contrato. No se eliminan requirements completos; los cambios
  se reflejan en los MODIFIED Requirements de arriba.

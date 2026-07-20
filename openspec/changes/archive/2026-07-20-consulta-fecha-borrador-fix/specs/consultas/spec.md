# Spec Delta — Capability `consultas`

> Este change **corrige el flujo de la consulta sin fecha** cuando existe un **borrador E1
> pendiente** (US-005 asignación de fecha + US-047 borrador manual). Cambia el
> comportamiento de UI del **bloqueo de acciones** (de total a parcial: editar y gestionar
> fecha quedan permitidos), **regenera** el borrador E1 al editar los campos, ajusta el
> **aviso de resultado** de la transición (de "email enviado" a "borrador pendiente de
> revisión/envío", ámbar + scroll) y renombra el **asunto** de la plantilla "disponible" a
> "Pre-reserva confirmada".
> Fuente: US-005 §Email relacionado; US-047; US-051 §Punto 2/§Punto 4; US-046/UC-36; plan
> aprobado del usuario.

## MODIFIED Requirements

### Requirement: Las acciones de la consulta se bloquean mientras el E1 sigue en borrador

El sistema SHALL (DEBE), mientras exista una `COMUNICACION` con `codigo_email = 'E1'` y
`estado = 'borrador'` asociada a la RESERVA, **bloquear las acciones de avance de la
consulta pero MANTENER disponibles la edición de la consulta y la gestión de la fecha**.
Concretamente: DEBEN permanecer disponibles **"Editar consulta"** (edición de campos
simples vía `PATCH /reservas/{id}`) y la **gestión de la fecha** (asignar/cambiar fecha por
el flujo atómico), porque son las acciones que introducen personas/horario/duración —los
datos que el propio borrador necesita (placeholder `___`)— y que el gestor debe poder
reflejar en el borrador antes de enviarlo. El **resto** de acciones downstream (p. ej.
"Generar presupuesto", "Programar visita", "Marcar como descartada") NO DEBEN ofrecerse
mientras el E1 siga en `borrador`; en su lugar, junto a "Generar presupuesto" DEBE mostrarse
un **aviso/CTA** que dirige a **revisar y enviar el correo de confirmación** antes de
continuar. En cuanto el borrador E1 pasa a `estado = 'enviado'` o `'fallido'` (deja de
haber E1 en `borrador`), **todas** las acciones vuelven a mostrarse. Este bloqueo es una
guarda de UI sobre la lectura de la existencia del borrador; las guardas de servidor de las
transiciones (US-046 y máquina de estados) permanecen intactas. (Fuente: `US-047` bloqueo
de acciones; `US-051`; plan aprobado del usuario; spec viva `comunicaciones` "Confirmación
de envío de un borrador".)

#### Scenario: Con un E1 en borrador, la ficha permite editar y gestionar fecha pero bloquea el resto

- **GIVEN** una RESERVA en sub-estado de consulta con una `COMUNICACION`
  `codigo_email = 'E1'`, `estado = 'borrador'`
- **WHEN** el gestor abre la ficha de la consulta
- **THEN** siguen disponibles "Editar consulta" y la gestión de la fecha
  (asignar/cambiar fecha)
- **AND** NO se ofrecen las acciones downstream (p. ej. "Generar presupuesto", "Programar
  visita", "Marcar como descartada")
- **AND** junto a "Generar presupuesto" se muestra el aviso/CTA "Revisa y envía el correo
  de confirmación antes de continuar."

#### Scenario: Al enviar el borrador E1, todas las acciones vuelven a estar disponibles

- **GIVEN** una RESERVA cuya `COMUNICACION` E1 estaba en `borrador` y las acciones
  downstream estaban bloqueadas
- **WHEN** el gestor revisa y envía el borrador E1 (pasa a `estado = 'enviado'`) y la ficha
  se recarga
- **THEN** ya no existe ninguna `COMUNICACION` E1 en `borrador` para la RESERVA
- **AND** todas las acciones (incluidas las downstream) vuelven a renderizarse con
  normalidad

#### Scenario: Sin borrador E1, la ficha muestra las acciones con normalidad

- **GIVEN** una RESERVA en sub-estado de consulta sin ninguna `COMUNICACION` E1 en
  `borrador` (E1 ya enviado, o alta sin comentarios)
- **WHEN** el gestor abre la ficha de la consulta
- **THEN** el bloque de acciones se renderiza normalmente y no aparece el aviso/CTA de
  borrador pendiente

### Requirement: Edición de los datos de una consulta/reserva

El sistema SHALL (DEBE) permitir a un gestor autenticado editar, desde la ficha, los
**campos simples** de la RESERVA mediante `PATCH /reservas/{id}`: `tipoEvento`,
`duracionHoras`, `numAdultosNinosMayores4`, `numNinosMenores4`, `numInvitadosFinal`,
`notas` y `horario`. La edición se ejecuta bajo el contexto RLS del tenant, escribe
`AUDIT_LOG` (`accion='actualizar'`, `entidad='RESERVA'`) y **NO cambia el estado ni el
sub-estado** de la RESERVA. El PATCH **NO DEBE** mutar `fechaEvento` ni el bloqueo de
fecha: toda mutación de fecha pasa por el bloqueo atómico (`bloquearFecha()`/
`liberarFecha()`), nunca por este endpoint. La validación de `horario` (`HH:MM`) es
**cruzada**: solo es válido si la RESERVA tiene `duracionHoras` (ya presente o fijada en el
mismo PATCH); en caso contrario el servidor rechaza con error de validación en `horario` y
no persiste nada. **Además**, cuando exista una `COMUNICACION` con `codigo_email = 'E1'` y
`estado = 'borrador'` para la RESERVA, el sistema DEBE, **tras** actualizar los campos,
**regenerar** el `asunto` y el `cuerpo` de ese borrador re-renderizando la plantilla de
transición (`tipo` según el sub-estado: `2b → 'disponible'`, `2d → 'cola'`; idioma según
`Reserva.idioma`) con los datos ya actualizados, y actualizar el borrador manteniéndolo en
`estado = 'borrador'`. Editar con borrador E1 pendiente **SÍ está permitido** (no hay guarda
409). La regeneración es **best-effort post-commit** (fuera de la transacción del PATCH): si
falla, el PATCH responde igualmente con éxito y el borrador queda editable. La regeneración
**sobrescribe** ediciones manuales previas del borrador (aceptable: el correo aún no se ha
enviado). (Fuente: `US-051 §Punto 2`; `US-005`; `US-047`; plan aprobado del usuario;
`api-spec.yml PATCH /reservas/{id}`, `UpdateReservaRequest`; `CLAUDE.md §Regla crítica:
bloqueo atómico de fecha`; spec viva `consultas` "Plantillas dinámicas de la transición de
fecha".)

#### Scenario: Editar el nº de invitados actualiza la RESERVA sin cambiar de estado

- **GIVEN** una RESERVA en `2b` con `numAdultosNinosMayores4=30`
- **WHEN** el gestor edita el nº de invitados a 20 y confirma
- **THEN** el sistema persiste `numAdultosNinosMayores4=20`
- **AND** la RESERVA permanece en `estado='consulta'` y `subEstado='2b'`
- **AND** no se modifica `FECHA_BLOQUEADA`
- **AND** se registra `AUDIT_LOG` `accion='actualizar'`, `entidad='RESERVA'`

#### Scenario: El PATCH no muta la fecha del evento aunque se intente

- **GIVEN** una RESERVA en `2b` con una `fechaEvento` bloqueada
- **WHEN** el gestor envía un `PATCH /reservas/{id}` con `duracionHoras=12` (y, si el
  cliente incluyera `fechaEvento`, ese campo)
- **THEN** el sistema persiste `duracionHoras=12`
- **AND** NO altera `fechaEvento` ni `FECHA_BLOQUEADA` por la vía del PATCH

#### Scenario: horario sin duracionHoras se rechaza en servidor

- **GIVEN** una RESERVA sin `duracionHoras`
- **WHEN** el gestor envía un `PATCH /reservas/{id}` con `horario='10:00'` y sin
  `duracionHoras`
- **THEN** el servidor retorna un error de validación en el campo `horario`
- **AND** no persiste ningún cambio en la RESERVA

#### Scenario: Asignar la fecha en 2.a reutiliza el flujo atómico existente

- **GIVEN** una RESERVA exploratoria en `2a` (sin fecha, `ttl_expiracion = NULL`)
- **WHEN** el gestor asigna una fecha del evento desde la ficha
- **THEN** el sistema NO usa el `PATCH /reservas/{id}` para la fecha, sino el flujo
  `POST /reservas/{id}/fecha` (transición `2a → 2b/2d` con bloqueo atómico y cola)

#### Scenario: Editar los campos con un E1 en borrador regenera el borrador con los datos nuevos

- **GIVEN** una RESERVA en `2b` con una `COMUNICACION` `codigo_email = 'E1'`,
  `estado = 'borrador'` cuyo cuerpo tiene el placeholder `___` en `personas` y `horas`
- **WHEN** el gestor edita `numInvitadosFinal=40` y `duracionHoras=8` y confirma
- **THEN** tras persistir los campos, el sistema re-renderiza la plantilla "disponible"
  con `personas=40` y `horas=8` y actualiza el `asunto`/`cuerpo` del borrador
- **AND** la `COMUNICACION` E1 permanece en `estado = 'borrador'` (no se envía)
- **AND** el cuerpo del borrador ya no contiene `___` en `personas` ni en `horas`

#### Scenario: La regeneración del borrador es best-effort y no revierte la edición

- **GIVEN** una RESERVA en `2d` con un borrador E1 pendiente y una edición de campos válida
- **WHEN** la edición se persiste correctamente pero la regeneración posterior del borrador
  falla
- **THEN** el PATCH responde con éxito y los campos quedan actualizados
- **AND** la edición no se revierte y el borrador queda editable para un reintento

#### Scenario: Sin borrador E1 en borrador, editar no toca ninguna comunicación

- **GIVEN** una RESERVA en `2b` cuya `COMUNICACION` E1 ya está `enviado` (o no existe)
- **WHEN** el gestor edita los campos simples y confirma
- **THEN** el sistema persiste los campos sin regenerar ni crear ninguna `COMUNICACION`

### Requirement: Email de confirmación de bloqueo provisional vía el motor de US-045

El sistema SHALL (DEBE), tras una transición exitosa `2.a → 2.b` (fecha libre), registrar
una `COMUNICACION` E1 dirigida al cliente **en estado `borrador`** con la plantilla de
transición "fecha disponible" (asunto y cuerpo renderizados dinámicamente, ver
"Plantillas dinámicas de la transición de fecha") y **NO enviarla automáticamente**: el
correo queda pendiente de **revisión y envío manual por el gestor** mediante el flujo ya
existente de US-046 (`GET /reservas/:id/comunicaciones` → *"Revisar y enviar borrador"*
→ `POST /reservas/:id/comunicaciones/.../enviar`). La `COMUNICACION` se crea en la
**misma transacción** que la mutación de la RESERVA y el bloqueo (atomicidad), con
`codigo_email = 'E1'`, `estado = 'borrador'` y `fecha_envio = null`; la creación es
**idempotente** (upsert por `(reserva_id, codigo_email)`) para no colisionar con un E1
de alta previo. Este email es una **extensión de E1** para el caso de actualización de
fecha y **no tiene un código `E` propio** en el catálogo §9.3 (E1–E8). El sistema **NO
invoca ningún proveedor de email** en este flujo; en consecuencia, no existe ya el envío
post-commit ni su manejo de fallo. Tras la transición, la UI DEBE comunicar al gestor que
**se ha generado un borrador de confirmación pendiente de revisión y envío** (NO "se ha
enviado un email"): el aviso de resultado DEBE ser un aviso **ámbar** (pendiente/acción
requerida), NO un aviso verde de éxito de envío, y la ficha DEBE **desplazar la vista al
aviso** (scroll-to-top) e **invalidar la lectura de comunicaciones** para que el borrador
recién creado sea visible sin recargar. (Fuente: `US-005 §Email relacionado`; US-046 flujo
de revisión/envío de borradores; UC-04 paso 8; catálogo §9.3 E1; plan aprobado del usuario.)

#### Scenario: Transición a 2.b crea el borrador E1 sin enviarlo

- **GIVEN** una transición `2.a → 2.b` que se completa con su bloqueo blando
- **WHEN** el sistema registra la comunicación de la transición
- **THEN** crea una `COMUNICACION` E1 con `estado = 'borrador'` y `fecha_envio = null`
  dirigida al cliente, con el asunto y cuerpo de la plantilla "fecha disponible"
  renderizados
- **AND** NO invoca ningún proveedor de email ni cambia el estado a `enviado`
- **AND** la `COMUNICACION` queda disponible para revisión/envío manual por el flujo de
  US-046

#### Scenario: La transición a 2.d (cola) crea un borrador E1 con la plantilla "fecha bloqueada"

- **GIVEN** una RESERVA propia en `sub_estado = '2a'` y una `fecha_evento` bloqueada por
  una consulta en `2.b`, y el gestor **acepta** entrar en cola (`aceptarCola = true`)
- **WHEN** la RESERVA transiciona a `sub_estado = '2d'`
- **THEN** el sistema crea, en la **misma transacción**, una `COMUNICACION` E1 con
  `estado = 'borrador'` y `fecha_envio = null`, con el asunto y cuerpo de la plantilla
  "fecha bloqueada" renderizados
- **AND** NO invoca ningún proveedor de email

#### Scenario: El caso no encolable no crea ninguna comunicación

- **GIVEN** una RESERVA propia en `sub_estado = '2a'` y una `fecha_evento` bloqueada por
  un estado no encolable (`2.c`/`2.v`/`pre_reserva`/`reserva_confirmada` o posterior), o
  bloqueada por `2.b` sin que el gestor acepte la cola
- **WHEN** el sistema rechaza la asignación inmediata (permanece en `2.a`, HTTP 409)
- **THEN** NO crea ninguna `COMUNICACION` ni muta la RESERVA

#### Scenario: El aviso de resultado indica "borrador pendiente", no "email enviado"

- **GIVEN** una transición de fecha (`2.a → 2.b` o `2.a → 2.d`) que crea el borrador E1
- **WHEN** la ficha muestra el resultado de la transición al gestor
- **THEN** el aviso es **ámbar** e indica que se ha generado un **borrador de confirmación
  pendiente de revisión y envío** (no un aviso verde de "email enviado al cliente")
- **AND** la ficha desplaza la vista hasta el aviso (scroll-to-top)
- **AND** el borrador recién creado queda visible sin recargar (la lectura de
  comunicaciones se invalida y se recarga)

### Requirement: Plantillas dinámicas de la transición de fecha (disponible / cola)

El sistema SHALL (DEBE) renderizar el asunto y el cuerpo del borrador E1 de la transición
de fecha mediante un **módulo puro y testeable** (sin importar framework ni infra),
seleccionando **una de dos plantillas** según la rama de la transición: **"fecha
disponible"** (rama libre, `2.a → 2.b`) y **"fecha bloqueada"** (rama cola, `2.a → 2.d`).
El **asunto de la rama "fecha disponible"** DEBE ser **"Pre-reserva confirmada"** en
castellano y su equivalente en catalán (**"Pre-reserva confirmada"**); el asunto de la rama
"fecha bloqueada" NO cambia. El render interpola las variables: `nombre` (nombre de pila del
cliente, `Cliente.nombre`), `fechaEvento` (formateada según el idioma, estilo *"19 de
juliol de 2026"* / *"19 de julio de 2026"*, reutilizando el formateo del catálogo de
US-045), `personas` (= `Reserva.num_invitados_final`) y `horas` (= `Reserva.duracion_horas`).
La firma es **hardcodeada** *"Ari — Masia l'Encís"* (coherente con el catálogo E1/E3
actual; parametrizar por tenant es deuda futura). El "40 %" del pago y la solicitud de datos
fiscales son **texto fijo** de la plantilla "disponible". (Fuente: US-005 §Email
relacionado; plan aprobado del usuario; catálogo §9.3 E1.)

#### Scenario: Rama libre renderiza la plantilla "fecha disponible" con asunto "Pre-reserva confirmada"

- **GIVEN** una transición `2.a → 2.b` de una RESERVA con `nombre`, `fecha_evento`,
  `num_invitados_final` y `duracion_horas` conocidos
- **WHEN** el sistema renderiza el borrador E1
- **THEN** el asunto es "Pre-reserva confirmada" y el cuerpo corresponde a la plantilla
  "fecha disponible" con el `nombre`, la `fechaEvento` formateada, `personas` y `horas`
  interpolados, y la firma "Ari — Masia l'Encís"

#### Scenario: Rama cola renderiza la plantilla "fecha bloqueada" sin cambiar su asunto

- **GIVEN** una transición `2.a → 2.d` (cola aceptada) de una RESERVA con `nombre` y
  `fecha_evento` conocidos
- **WHEN** el sistema renderiza el borrador E1
- **THEN** el asunto y el cuerpo corresponden a la plantilla "fecha bloqueada" (asunto sin
  cambios) con el `nombre` y la `fechaEvento` formateada interpolados, y la firma
  "Ari — Masia l'Encís"

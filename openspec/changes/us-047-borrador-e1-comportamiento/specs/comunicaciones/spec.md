# Spec Delta — Capability `comunicaciones`

> **US-047 / UC-35 / UC-36** — Refinamientos de comportamiento del borrador E1 en el
> módulo de comunicaciones: al enviar un borrador E1 desde la ficha se adjunta el dossier
> PDF (paridad con el alta, US-045); el modal de revisión se ensancha; y el botón
> "Descartar" se retira de la UI conservando el endpoint backend. Reutiliza el motor de
> email, el catálogo de plantillas y el mecanismo de adjuntos por referencia de US-045; NO
> reimplementa el transporte de email ni la máquina de estados de la RESERVA.
>
> Fuente: `US-047`; UC-35; UC-36; `er-diagram §3.17 COMUNICACION`, `§3.6 RESERVA`; spec
> viva `comunicaciones` ("Cableado real de E1 … dossier adjunto", "Interfaz de adjuntos por
> referencia documental", "Confirmación de envío de un borrador", "Descarte de un borrador
> por el gestor"); `CLAUDE.md §Web responsive`.

## ADDED Requirements

### Requirement: El envío de un borrador E1 adjunta el dossier PDF según el idioma de la reserva

El sistema SHALL (DEBE), cuando el gestor confirma el envío de una `COMUNICACION` en
`estado = 'borrador'` cuyo `codigo_email === 'E1'`, adjuntar **siempre** el dossier PDF del
espacio en el idioma de la RESERVA (`Dossier-Masia-Encis-{reserva.idioma}.pdf`), obtenido
por **referencia de URL** desde el almacén del tenant, reutilizando el mismo mecanismo de
adjuntos de US-045 usado por el alta de consulta (`AltaConsultaUseCase`). El idioma se toma
de `RESERVA.idioma` (la reserva que el use-case ya carga para validar el envío); en su
ausencia degrada al idioma por defecto (`'es'`), igual que el alta. Si `dossierBaseUrl` no
está configurado, el envío **procede sin adjunto** (degradación graceful idéntica a la de
`AltaConsultaUseCase`), sin bloquear el envío del borrador. Para códigos de email distintos
de `E1` (p. ej. borradores `manual`), el envío NO adjunta el dossier. Esta regla no altera
las transiciones de estado de US-046 (`borrador → enviado`/`fallido`): solo añade el adjunto
al camino de envío. (Fuente: `US-047` PDF adjunto al enviar borrador E1; spec viva
`comunicaciones` "Cableado real de E1 … dossier adjunto", "Interfaz de adjuntos por
referencia documental".)

#### Scenario: Enviar un borrador E1 en catalán adjunta el dossier en catalán

- **GIVEN** una `COMUNICACION` `codigo_email = 'E1'`, `estado = 'borrador'`, vinculada a una
  RESERVA con `idioma = 'ca'`, y `dossierBaseUrl` configurado
- **WHEN** el gestor confirma el envío del borrador
- **THEN** el sistema envía el email adjuntando `Dossier-Masia-Encis-ca.pdf` por referencia
  de URL
- **AND** actualiza la `COMUNICACION` a `estado = 'enviado'` con `fecha_envio` no nulo

#### Scenario: Sin dossierBaseUrl configurado, el envío del borrador E1 procede sin adjunto

- **GIVEN** una `COMUNICACION` `codigo_email = 'E1'`, `estado = 'borrador'`, y
  `dossierBaseUrl` **no** configurado
- **WHEN** el gestor confirma el envío del borrador
- **THEN** el sistema envía el email **sin** adjunto (degradación graceful)
- **AND** el envío no se bloquea por la ausencia del dossier

#### Scenario: Un borrador que no es E1 se envía sin adjuntar el dossier

- **GIVEN** una `COMUNICACION` en `estado = 'borrador'` cuyo `codigo_email` no es `'E1'`
- **WHEN** el gestor confirma el envío del borrador
- **THEN** el sistema envía el email sin adjuntar el dossier del espacio

### Requirement: El modal de revisión del borrador usa un ancho amplio para leer el cuerpo

El sistema SHALL (DEBE) presentar el diálogo de revisión y envío del borrador
(`RevisarEnviarBorradorDialog`) con un ancho amplio (`max-w-2xl`) para facilitar la lectura
y edición del `cuerpo` del email, manteniendo el diseño **responsive** (mobile-first) sin
provocar overflow horizontal en móvil, tablet ni escritorio. El contenido del cuerpo
mostrado en el modal es el que el borrador ya tiene **almacenado** (plantilla renderizada en
el alta, US-045); el modal no re-renderiza la plantilla. (Fuente: `US-047` modal más ancho;
`CLAUDE.md §Web responsive`.)

#### Scenario: El diálogo de revisión se muestra con ancho amplio y sin overflow

- **GIVEN** una `COMUNICACION` en `estado = 'borrador'` accionable en la ficha
- **WHEN** el gestor abre el diálogo de revisión y envío
- **THEN** el diálogo se presenta con ancho `max-w-2xl`
- **AND** no produce overflow horizontal en los viewports 390 / 768 / 1280

## MODIFIED Requirements

### Requirement: Descarte de un borrador por el gestor lo lleva a fallido sin envío y con causa auditada

El sistema SHALL (DEBE) permitir al gestor **descartar** una `COMUNICACION` en
`estado = 'borrador'`: la fila pasa a `estado = 'fallido'` (no existe un estado
"descartado" en el enum), **sin** enviar ningún email y **sin** `fecha_envio`, y el
sistema DEBE registrar la acción en `AUDIT_LOG` con la **causa "descartado por
gestor"** (distinguible de un fallo del proveedor por dicha causa). Tras el descarte, el
borrador **desaparece de la bandeja de borradores pendientes** de la ficha; la RESERVA
puede continuar su ciclo de vida con normalidad y el gestor puede crear un email manual
si lo necesita. Solo se puede descartar una fila en `estado = 'borrador'`.

**El endpoint backend de descarte se conserva** (misma lógica, misma guarda de estado y
misma auditoría de US-046), pero **desde US-047 ya no se expone en la interfaz de usuario**:
el botón "Descartar" se retira de `ComunicacionListaItem`/`ComunicacionesCard` y el
componente `DescartarBorradorDialog` se elimina. El descarte deja de ofrecerse como acción
manual del gestor en la UI porque, para un E1, la expectativa de negocio es enviar el
correo de confirmación, no descartarlo; la capacidad backend permanece disponible para
usos programáticos o futuras superficies. (Fuente: `US-046 §Gestor descarta el borrador sin
enviar`, `§Reglas de negocio` descarte; UC-36; `US-047` retirada del botón "Descartar" de la
UI conservando el endpoint.)

#### Scenario: Descartar un borrador lo pasa a fallido y lo audita como descartado

- **GIVEN** una `COMUNICACION` en `estado = 'borrador'` vinculada a una RESERVA
- **WHEN** se invoca el endpoint de descarte del borrador
- **THEN** la `COMUNICACION` pasa a `estado = 'fallido'` sin `fecha_envio` y sin enviar
  ningún email
- **AND** se registra en `AUDIT_LOG` con la causa "descartado por gestor"
- **AND** el borrador deja de aparecer en la bandeja de borradores pendientes

#### Scenario: No se puede descartar una comunicación que no está en borrador

- **GIVEN** una `COMUNICACION` en `estado = 'enviado'` o `'fallido'`
- **WHEN** se invoca el endpoint de descarte sobre ella
- **THEN** el sistema rechaza la acción como conflicto de estado sin efectos

#### Scenario: El descarte no se ofrece como acción en la interfaz de usuario

- **GIVEN** una `COMUNICACION` en `estado = 'borrador'` mostrada en la ficha de la RESERVA
- **WHEN** el gestor visualiza las acciones del borrador en la UI
- **THEN** no se muestra ningún botón "Descartar" (retirado en US-047)
- **AND** el endpoint backend de descarte permanece disponible pero sin exposición en la UI

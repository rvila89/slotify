# Spec Delta — Capability `documentos` (MODIFICADA)

> US-023 completa la trazabilidad documental del envío E3: (1) **persiste la fila `DOCUMENTO`**
> de las condiciones particulares (GAP 1, ADDED), que 6.4b generaba y adjuntaba pero **no
> persistía**; y (2) **endurece** el trato del adjunto de condiciones, que 6.4b había fijado como
> tolerante/opcional (GAP 2, MODIFIED): en US-023 las condiciones son
> **requisito duro** del envío E3. No hay migración: `Documento` y `TipoDocumento.condiciones_particulares`
> ya existen. Fuente: US-023 (§Happy Path — crear DOCUMENTO + AUDIT_LOG `crear`, §Reglas de
> Validación — un único DOCUMENTO por reserva, §Condiciones particulares del tenant no
> configuradas); `er-diagram.md §DOCUMENTO`; `design.md §D-persistencia-documento,
> §D-condiciones-bloqueante`; reutiliza `GenerarPdfCondicionesPort` (6.4a).

## ADDED Requirements

### Requirement: Persistencia idempotente del DOCUMENTO de condiciones particulares al enviar E3

El sistema SHALL (DEBE), al enviar E3 (envío de la factura de señal), **persistir una fila
`DOCUMENTO`** con `tipo = 'condiciones_particulares'`, `reserva_id`, `tenant_id`, `url` (la URL del
PDF de condiciones ya generado por `GenerarPdfCondicionesPort`, clave `condiciones/{tenantId}.pdf`)
y `mime_type = 'application/pdf'`. La persistencia DEBE ocurrir **dentro de la misma transacción
atómica** del envío E3 (si E3 falla, la fila `DOCUMENTO` **revierte** junto al resto). La operación
DEBE ser **idempotente por reserva**: solo puede existir **un** `DOCUMENTO` de
`tipo = 'condiciones_particulares'` por `reserva_id`; si ya existe, el sistema DEBE **reutilizarlo**
(no crea una segunda fila ni registra un segundo AUDIT_LOG). Cuando se crea la fila por primera vez,
el sistema DEBE registrar `AUDIT_LOG` con `accion = 'crear'` para ese `DOCUMENTO`. El acceso DEBE
respetar RLS multi-tenant (la búsqueda de idempotencia filtra por `tenant_id`; nunca reutiliza un
documento de otro tenant). (Fuente: `US-023 §Happy Path`, `§Reglas de Validación`; `design.md
§D-persistencia-documento`; `er-diagram.md §DOCUMENTO`.)

#### Scenario: El primer envío de E3 crea el DOCUMENTO de condiciones y lo audita

- **GIVEN** una RESERVA sin `DOCUMENTO` de `tipo = 'condiciones_particulares'` y un tenant con las
  condiciones configuradas (el PDF de condiciones se genera correctamente)
- **WHEN** el Gestor envía la factura de señal (E3) y el envío se confirma
- **THEN** se persiste una fila `DOCUMENTO` con `tipo = 'condiciones_particulares'`, `reserva_id`,
  `tenant_id`, `url` del PDF y `mime_type = 'application/pdf'`
- **AND** la fila se consolida en la misma transacción que la emisión de la factura y la
  actualización de `RESERVA.cond_part_enviadas_fecha`
- **AND** `AUDIT_LOG` registra `accion = 'crear'` para ese `DOCUMENTO`

#### Scenario: Un DOCUMENTO de condiciones ya existente se reutiliza sin duplicar

- **GIVEN** una RESERVA que ya tiene un `DOCUMENTO` de `tipo = 'condiciones_particulares'`
- **WHEN** el flujo de envío/reenvío de E3 vuelve a resolver el documento de condiciones
- **THEN** el sistema reutiliza la fila existente y **no** crea una segunda fila `DOCUMENTO`
- **AND** no registra un segundo `AUDIT_LOG accion = 'crear'` para el documento

#### Scenario: El rollback del envío de E3 no deja DOCUMENTO huérfano

- **GIVEN** una RESERVA sin `DOCUMENTO` de condiciones y un envío de E3 en curso
- **WHEN** el envío de E3 falla dentro de la transacción
- **THEN** no queda persistida ninguna fila `DOCUMENTO` de `tipo = 'condiciones_particulares'`
  (la creación revierte junto al resto de la transacción)

## MODIFIED Requirements

### Requirement: El fallo del adjunto de condicions particulars no tumba el envío confirmado de E3

El sistema SHALL (DEBE), en el envío CONFIRMADO/rollback de E3, tratar las **condicions
particulars** como **adjunto imprescindible**: DEBE obtener el PDF vía
`GenerarPdfCondicionesPort.generar`. Si devuelve `null` (tenant sin configuración/sin secciones),
el sistema NO DEBE enviar E3, NO DEBE persistir el `DOCUMENTO` de condiciones y DEBE **abortar** la
operación con un **error de negocio** (`CONDICIONES_NO_CONFIGURADAS`, recuperable), dejando la
RESERVA sin `cond_part_enviadas_fecha` y la factura de señal en `borrador` (rollback total); el
Gestor recibe la alerta "Configura las condiciones particulares del espacio para poder enviar E3".
Si la generación **lanza** un error transitorio (p. ej. fallo de render/subida), el sistema DEBE
tratarlo como error **recuperable** (reintentable) con rollback total, sin consolidar la emisión.
En el camino feliz, E3 SIEMPRE se envía con **ambos** adjuntos (factura de señal + condiciones) y la
respuesta expone `condPartAdjuntada = true`. (Fuente: `US-023 §Condiciones particulares del tenant
no configuradas`, `§Reglas de negocio`; `design.md §D-condiciones-bloqueante`; reemplaza el criterio
tolerante de 6.4b `§D-adjunto-condiciones`.)

> **US-023 endurece el criterio de 6.4b (decisión cerrada — `design.md
> §D-condiciones-bloqueante`).** 6.4b trataba el adjunto de condiciones como **tolerante/opcional**
> (si degradaba a `null`, E3 se enviaba igual con `condPartAdjuntada = false`). US-023 revierte esa
> concesión: las condiciones son el **contrato** del evento y pasan a ser **requisito duro** del
> envío E3.

#### Scenario: Sin condiciones configuradas, E3 no se envía y se alerta al Gestor

- **GIVEN** un tenant SIN condicions particulars configuradas y una factura de señal enviable con su
  PDF
- **WHEN** el Gestor envía la factura de señal (E3)
- **THEN** `GenerarPdfCondicionesPort.generar` devuelve `null` y el sistema aborta con
  `CONDICIONES_NO_CONFIGURADAS`
- **AND** no se envía E3, no se persiste el `DOCUMENTO` de condiciones, la factura permanece en
  `borrador` y `RESERVA.cond_part_enviadas_fecha` permanece `NULL`
- **AND** el Gestor recibe la alerta "Configura las condiciones particulares del espacio para poder
  enviar E3"

#### Scenario: Un fallo de render de condiciones aborta la emisión de forma recuperable

- **GIVEN** un tenant con condiciones configuradas cuya generación de PDF **lanza** un error
  transitorio
- **WHEN** el Gestor envía la factura de señal (E3)
- **THEN** el sistema aborta con un error recuperable y hace rollback total (factura en `borrador`,
  sin COMUNICACION E3 `enviado`, sin `DOCUMENTO` de condiciones)
- **AND** el Gestor puede reintentar el envío

#### Scenario: Con condiciones configuradas, E3 se envía con ambos adjuntos

- **GIVEN** un tenant con condiciones configuradas y una factura de señal enviable con su PDF
- **WHEN** el Gestor envía la factura de señal (E3) y el envío se confirma
- **THEN** E3 se envía con dos adjuntos (factura de señal + condiciones particulares)
- **AND** la respuesta expone `condPartAdjuntada = true` y se persiste el `DOCUMENTO` de condiciones

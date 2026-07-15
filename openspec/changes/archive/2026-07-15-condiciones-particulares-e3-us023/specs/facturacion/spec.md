# Spec Delta — Capability `facturacion` (MODIFICADA)

> US-023 añade el **reenvío manual de E3** (GAP 3) como acción del Gestor dedicada, espejo del
> reenvío de la liquidación (E4, US-028): un `ReenviarE3UseCase` + endpoint
> `POST /reservas/{id}/facturas/senal/reenviar`. 6.4b bloqueaba el re-disparo con `E3_YA_ENVIADO`
> (409) y dejó el reenvío explícitamente fuera de alcance; US-023 lo habilita **sin re-emitir la
> factura ni regenerar/duplicar documentos**. El endpoint de primer envío `.../senal/enviar` no
> cambia su firma. Fuente: US-023 (§E3 ya enviado previamente — reenvío, §Fallo en el envío — el
> Gestor puede reenviar manualmente); patrón US-028 `reenviar-liquidacion`; `design.md §D-reenvio-e3`.

## ADDED Requirements

### Requirement: Reenvío manual de E3 sin re-emitir la factura ni duplicar documentos

El sistema SHALL (DEBE) ofrecer al Gestor una acción **dedicada** de "Reenviar E3" sobre una RESERVA
cuya factura de señal ya fue **enviada** (E3 enviado previamente). El reenvío DEBE crear una
**nueva** `COMUNICACION` `codigo_email = 'E3'`, `estado = 'enviado'`, `es_reenvio = true`,
`fecha_envio = now()` (ver delta `comunicaciones`), **reutilizando** el PDF de la factura de señal
ya emitido y el `DOCUMENTO` de condiciones ya persistido (**sin regenerar ni duplicar** ningún
documento). El reenvío DEBE actualizar `RESERVA.cond_part_enviadas_fecha` al nuevo timestamp y NO
DEBE modificar la `FACTURA` (ni `numero_factura` ni `estado`) ni el resto de status de la RESERVA
(no transiciona la máquina de estados). El envío DEBE ser síncrono por el puerto directo y ocurrir
**antes** de tocar la BD (espejo del reenvío de E4 `reenviar-liquidacion`): si el proveedor falla,
el reenvío aborta con un error recuperable y **no crea** la COMUNICACION de reenvío **ni actualiza**
`cond_part_enviadas_fecha` (como el email va primero, no queda estado parcial que revertir). El
acceso DEBE respetar RLS (una reserva de otro tenant → no
encontrada). (Fuente: `US-023 §E3 ya enviado previamente (idempotencia — reenvío)`; patrón US-028
`reenviar-liquidacion`; `design.md §D-reenvio-e3`.)

#### Scenario: El reenvío de E3 crea una nueva comunicación reutilizando los documentos

- **GIVEN** una RESERVA con la factura de señal `enviada`, una `COMUNICACION` E3 `enviado`
  (`es_reenvio = false`) previa y un `DOCUMENTO` de condiciones ya persistido
- **WHEN** el Gestor pulsa "Reenviar E3"
- **THEN** se crea una nueva `COMUNICACION` `codigo_email = 'E3'`, `estado = 'enviado'`,
  `es_reenvio = true`, `fecha_envio` no nulo
- **AND** se reutilizan la factura de señal y el `DOCUMENTO` de condiciones existentes (no se
  regenera ni duplica ningún documento)
- **AND** `RESERVA.cond_part_enviadas_fecha` se actualiza al nuevo timestamp y la `FACTURA` (número
  y estado) no cambia

#### Scenario: Un fallo del proveedor en el reenvío no consolida nada

- **GIVEN** una RESERVA con E3 ya enviado y factura de señal `enviada`
- **WHEN** el Gestor pulsa "Reenviar E3" pero el proveedor de email falla
- **THEN** no se crea la `COMUNICACION` de reenvío y `RESERVA.cond_part_enviadas_fecha` no se
  actualiza (el email va primero: al fallar no se toca la BD)
- **AND** el sistema devuelve un error recuperable y el Gestor puede reintentar

### Requirement: Endpoint dedicado de reenvío de E3 en el controlador de facturación

El sistema SHALL (DEBE) exponer el reenvío de E3 en un endpoint **dedicado**
`POST /reservas/{id}/facturas/senal/reenviar` (espejo de `.../facturas/liquidacion/reenviar`),
`@Roles('gestor')`, `@HttpCode(200)`, cuerpo vacío `{}`. Este endpoint es **distinto** del primer
envío `.../senal/enviar` (que sigue devolviendo `E3_YA_ENVIADO` ante un re-disparo). La respuesta
200 DEBE incluir el resultado del reenvío (nueva `cond_part_enviadas_fecha`). Los errores DEBEN
seguir el envelope del contrato con `codigo`: 404 `FACTURA_SENAL_NO_ENCONTRADA` (no existe factura
de señal / reserva cross-tenant); 409 `E3_NO_ENVIADO_PREVIAMENTE` (no hay un E3 previo que reenviar);
502 `EMISION_ENVIO_FALLIDO` (fallo del proveedor). El contrato OpenAPI DEBE describir este nuevo
path antes de la implementación (dueño: `contract-engineer`). (Fuente: US-023; convención viva del
controller `reservas/:id/facturas/{tipo}/{accion}`; `design.md §D-reenvio-e3`.)

#### Scenario: El endpoint de reenvío responde 200 con la nueva fecha de envío

- **GIVEN** una RESERVA con E3 ya enviado y factura de señal `enviada`, y un Gestor autenticado
- **WHEN** hace `POST /reservas/{id}/facturas/senal/reenviar` con cuerpo `{}`
- **THEN** responde 200 con la nueva `cond_part_enviadas_fecha`

#### Scenario: Reenviar sin un E3 previo se rechaza

- **GIVEN** una RESERVA cuya factura de señal aún NO tiene un E3 enviado
- **WHEN** el Gestor hace `POST /reservas/{id}/facturas/senal/reenviar`
- **THEN** el sistema rechaza con 409 `E3_NO_ENVIADO_PREVIAMENTE` y no crea ninguna `COMUNICACION`

#### Scenario: Reenviar sobre una reserva sin factura de señal o de otro tenant

- **GIVEN** una RESERVA sin `FACTURA` `tipo = 'senal'` (o perteneciente a otro tenant, RLS)
- **WHEN** el Gestor hace `POST /reservas/{id}/facturas/senal/reenviar`
- **THEN** el sistema rechaza con 404 `FACTURA_SENAL_NO_ENCONTRADA` y no reenvía E3

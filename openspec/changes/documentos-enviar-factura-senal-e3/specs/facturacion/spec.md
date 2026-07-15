# Spec Delta — Capability `facturacion` (MODIFICADA)

> 6.4b (Bloque C) **extiende** la capability `facturacion` con la acción **manual del
> Gestor "Enviar factura de señal"** (US-023 / UC-19, patrón US-028/UC-21): sobre la
> FACTURA `tipo = 'senal'` en `borrador` (creada por US-022), el Gestor la **aprueba y
> envía** al cliente en un único email **E3** junto con las condicions particulars, con
> **atomicidad estado↔E3** (si E3 falla, rollback total: la factura permanece en
> `borrador`). La emisión pasa `FACTURA(senal).estado = 'enviada'`, fija `fecha_emision`
> si aún era nula (reutilizando la numeración de US-022 sin reasignar número), registra
> `RESERVA.cond_part_enviadas_fecha = now()` y `RESERVA.cond_part_firmadas = false`. El
> re-disparo tras un E3 ya enviado se rechaza (idempotencia). El cableado del email E3,
> su registro en `COMUNICACION` y el adjunto de condiciones se especifican en los deltas
> de `comunicaciones` y `documentos`.
> Fuente: US-023 (§Happy Path, §Reglas de negocio, §Reglas de Validación), UC-19 (primer
> flujo), patrón US-028/UC-21; `er-diagram.md §3.12 FACTURA`, `§RESERVA cond_part_*`;
> `design.md §D-guarda-estado, §D-idempotencia, §D-num`.

## ADDED Requirements

### Requirement: Emisión y envío de la factura de señal al aprobar y enviar E3 (borrador → enviada)

El sistema SHALL (DEBE), cuando el Gestor pulsa "Enviar factura de señal" sobre una
FACTURA con `tipo = 'senal'` en `estado = 'borrador'`, **emitir y enviar** la factura:
pasar `FACTURA(senal).estado = 'enviada'`, fijar `fecha_emision` con el timestamp actual
si era nula, **conservando el `numero_factura` `F-YYYY-NNNN` ya asignado en US-022** (no
se reasigna; si excepcionalmente el borrador no tuviera número, se asigna con la
numeración de US-022, `UNIQUE(tenant_id, numero_factura)` + reintento aplicativo ante
`P2002`, **nunca** locks distribuidos). Todo ello ocurre **solo si el envío del email E3
se confirma** (ver atomicidad). El sistema DEBE registrar `AUDIT_LOG` con `accion =
'actualizar'`, `datos_anteriores.estado = 'borrador'` y `datos_nuevos.estado = 'enviada'`.
(Fuente: `US-023 §Happy Path`, `§Reglas de Validación`; US-022 numeración; UC-19;
`design.md §D-guarda-estado, §D-num`.)

#### Scenario: Enviar factura de señal emite la factura y la deja enviada

- **GIVEN** una FACTURA `tipo = 'senal'` en `estado = 'borrador'` con `numero_factura =
  'F-{año}-NNNN'` (asignado en US-022), PDF disponible, y una RESERVA con
  `cond_part_enviadas_fecha = NULL`
- **WHEN** el Gestor pulsa "Enviar factura de señal" y el envío de E3 se confirma
- **THEN** `FACTURA(senal).estado = 'enviada'`, `fecha_emision` con el timestamp actual y
  `numero_factura` sin cambios
- **AND** `RESERVA.cond_part_enviadas_fecha` queda con el timestamp del envío y
  `RESERVA.cond_part_firmadas = false`
- **AND** `AUDIT_LOG` registra `accion = 'actualizar'` con `datos_anteriores.estado =
  'borrador'` y `datos_nuevos.estado = 'enviada'`

### Requirement: Atomicidad entre la emisión de la señal y el envío de E3 (rollback ante fallo)

El sistema SHALL (DEBE) hacer **atómicos** la emisión de la factura de señal y el envío
del email E3: la transición `FACTURA(senal).estado = 'enviada'`, la fijación de
`fecha_emision`, la actualización de `RESERVA.cond_part_enviadas_fecha` /
`cond_part_firmadas` y el registro de `COMUNICACION` E3 se consolidan **solo si el envío
de E3 se confirma**. Si el **PDF de la factura de señal no está disponible** o el **envío
de E3 falla**, el sistema DEBE hacer **rollback** de todos los cambios: la FACTURA
**permanece en `borrador`**, `RESERVA.cond_part_enviadas_fecha` **no** se actualiza; el
sistema muestra un **error recuperable** y el Gestor puede **reintentar**. Esta atomicidad
**invierte** deliberadamente el patrón "post-commit, fallo no revierte" de E2 (US-045),
igual que hizo E4 en US-028. El fallo del adjunto de **condicions particulars** NO tumba
el envío (ver delta `documentos`). (Fuente: `US-023 §Fallo en el envío del email E3`;
`design.md §D-adjunto-condiciones`; patrón `US-028 §atomicidad`.)

#### Scenario: Fallo del envío de E3 deja la factura en borrador y permite reintento

- **GIVEN** una FACTURA `tipo = 'senal'` en `borrador` y `RESERVA.cond_part_enviadas_fecha
  = NULL`
- **WHEN** el Gestor pulsa "Enviar factura de señal" pero el envío de E3 falla en el
  proveedor
- **THEN** la FACTURA permanece en `estado = 'borrador'`
- **AND** `RESERVA.cond_part_enviadas_fecha` permanece `NULL` y no se crea `COMUNICACION`
  E3 en `enviado`
- **AND** el sistema muestra un error recuperable y el Gestor puede reintentar

#### Scenario: El PDF de la señal ausente impide el envío

- **GIVEN** una FACTURA `tipo = 'senal'` en `borrador` con `pdf_url = NULL` (PDF pendiente)
- **WHEN** el Gestor pulsa "Enviar factura de señal"
- **THEN** el sistema no envía E3 y devuelve un error recuperable (el PDF de la señal es
  el adjunto imprescindible)
- **AND** la FACTURA permanece en `borrador` y no se registra `COMUNICACION` E3 `enviado`

### Requirement: Solo se envía desde borrador enviable; el re-disparo tras E3 enviado se rechaza

El sistema SHALL (DEBE) permitir la acción "Enviar factura de señal" **solo si** existe
una `FACTURA(senal)` para la reserva y su estado es **enviable**: `borrador` (camino
feliz), o `enviada` **sin** una `COMUNICACION` E3 `enviado` previa. Si ya existe una
`COMUNICACION` E3 en `estado = 'enviado'` para la reserva, el sistema DEBE **rechazar** el
re-disparo (`E3_YA_ENVIADO`) **sin** re-enviar el email, **sin** duplicar la comunicación y
**sin** regenerar documentos (el **reenvío explícito** de E3 queda fuera de esta rebanada).
Si no existe factura de señal → `FACTURA_SENAL_NO_ENCONTRADA`.

> **Nota de alcance (verificada en QA de integración, 6.4b).** Dos estados que un diseño
> teórico contemplaría **no son alcanzables** con la arquitectura de esta rebanada, por lo
> que la guarda `FACTURA_SENAL_NO_ENVIABLE` es **defensiva** y no tiene escenario
> reproducible:
> - **`rechazada` no existe como estado de FACTURA.** El enum `EstadoFactura` es
>   `borrador | enviada | cobrada`; el rechazo del borrador de señal (US-022) **no
>   transiciona** (permanece `borrador`, solo registra `AUDIT_LOG`). Por tanto una señal
>   "rechazada" seguiría siendo `borrador` y **enviable**; si el producto exige impedirlo,
>   requeriría modelar el rechazo con una marca real (fuera de alcance de 6.4b).
> - **"E3 `fallido` previa → reintento" no se reproduce.** El envío usa el adaptador
>   `EnviarEmailPort` **directo** dentro de la tx con **rollback total** ante fallo, de modo
>   que este flujo **nunca persiste** una `COMUNICACION` E3 `fallido` (solo el motor
>   `DespacharEmailService`, no usado aquí, lo haría). Además el índice único **parcial**
>   `(reserva_id, codigo_email) WHERE reserva_id IS NOT NULL AND es_reenvio = false` haría
>   colisionar (`P2002`) un segundo `crear` sobre un `fallido` preexistente. Un futuro flujo
>   por motor que pudiera dejar un `fallido` requeriría un `upsert` (deuda anotada).

(Fuente: `US-023 §Reglas de Validación`, `§E3 ya enviado previamente`; `design.md
§D-guarda-estado, §D-idempotencia`; hallazgos de code-review y QA de integración 6.4b.)

#### Scenario: El re-disparo cuando E3 ya fue enviado se rechaza sin duplicar

- **GIVEN** una RESERVA con una `COMUNICACION` `codigo_email = 'E3'` en `estado =
  'enviado'` y la factura de señal ya `enviada`
- **WHEN** el Gestor vuelve a pulsar "Enviar factura de señal"
- **THEN** el sistema rechaza con `E3_YA_ENVIADO`
- **AND** no se re-envía el email, no se crea una segunda `COMUNICACION` E3 `enviado` ni
  se regeneran documentos

#### Scenario: Sin factura de señal la acción no encuentra qué enviar

- **GIVEN** una RESERVA sin `FACTURA` `tipo = 'senal'` (o de otro tenant, RLS)
- **WHEN** el Gestor pulsa "Enviar factura de señal"
- **THEN** el sistema rechaza con `FACTURA_SENAL_NO_ENCONTRADA` y no envía E3

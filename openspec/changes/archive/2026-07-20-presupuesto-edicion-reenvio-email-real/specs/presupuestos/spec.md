# Spec Delta — Capability `presupuestos`

> **Corrección de US-015 / UC-15** — Envío REAL del correo E2 en la edición y en el
> reenvío sin cambios, y **marca de edición** del email. Endurece dos requisitos vivos
> de US-015 (envío E2 en edición; reenvío sin cambios) para exigir que el **proveedor de
> email se invoque de verdad** (hoy no ocurre: idempotencia en edición + stub en
> reenvío) y que exista **una única** `COMUNICACION` por envío; añade un requisito nuevo
> para la marca de edición (asunto + párrafo, ES/CA). NO reimplementa el motor de email
> (US-045) ni el versionado del presupuesto (US-015).
>
> Fuente: `US-015 §Happy Path`, `§Sin cambios — reenvío de versión existente`,
> `§Email relacionado`; UC-15; US-045 (motor de email); US-014 (E2);
> `er-diagram §3.11 PRESUPUESTO`, `§COMUNICACION`; `CLAUDE.md §Regla crítica: bloqueo
> atómico de fecha`, `§Multi-tenancy`.

## MODIFIED Requirements

### Requirement: Envío explícito de la edición registra COMUNICACION E2 y AUDIT_LOG

El sistema SHALL (DEBE), cuando el Gestor confirma la edición **con envío explícito**,
regenerar el PDF de la nueva versión y **enviar realmente** el email **E2** invocando el
proveedor de correo a través del camino de reenvío del motor
(`DespacharEmailService.despacharReenvio`), que **salta la idempotencia** — no como el
camino `despachar`, que al encontrar el E2 original (`es_reenvio = false`) por el índice
UNIQUE parcial `(reserva_id, codigo_email) WHERE es_reenvio = false` devolvía
`motivo = 'idempotente'` y **nunca invocaba al proveedor**. El envío DEBE persistir **una
única** `COMUNICACION` con `codigo_email = 'E2'`, `es_reenvio = true` y
`estado ∈ {'enviado', 'fallido'}` según el resultado real del proveedor (fuente única =
el motor post-commit; NO se registra además una fila "contable" duplicada dentro de la
transacción). El sistema DEBE fijar `PRESUPUESTO.estado = 'enviado'` en la nueva versión
y registrar en `AUDIT_LOG` con `accion = 'actualizar'` referenciando el nuevo
`id_presupuesto`. El envío es **best-effort post-commit**: un fallo del proveedor deja la
`COMUNICACION` en `estado = 'fallido'` y **NO** revierte la versión ya creada ni el
`AUDIT_LOG`. (Fuente: `US-015 §Happy Path`, `§Reglas de negocio` envío explícito; UC-15;
US-045 motor de email; `er-diagram §COMUNICACION`, `§AUDIT_LOG`; patrón `es_reenvio` de
US-028/US-023.)

#### Scenario: Confirmar con envío invoca al proveedor y registra una única COMUNICACION E2

- **GIVEN** una RESERVA en `pre_reserva` con PRESUPUESTO `version = 1` en `enviado`
  (ya existe la `COMUNICACION` E2 original con `es_reenvio = false`)
- **WHEN** el gestor confirma una edición y la envía
- **THEN** el proveedor de email se invoca realmente (transporte ejecutado) y NO se
  cortocircuita por idempotencia
- **AND** se registra **exactamente una** nueva `COMUNICACION` con `codigo_email = 'E2'`,
  `es_reenvio = true` y `estado = 'enviado'` (sin fila contable duplicada en la
  transacción)
- **AND** `PRESUPUESTO version = 2` queda en `estado = 'enviado'` y se registra un
  `AUDIT_LOG` con `accion = 'actualizar'` que referencia el nuevo `id_presupuesto`

#### Scenario: Fallo del proveedor no revierte la versión (best-effort post-commit)

- **GIVEN** una edición confirmada que crea PRESUPUESTO `version = 2`
- **WHEN** el envío post-commit del E2 falla en el proveedor
- **THEN** la `COMUNICACION` E2 queda en `estado = 'fallido'` (`es_reenvio = true`)
- **AND** `PRESUPUESTO version = 2` y el `AUDIT_LOG` `actualizar` persisten (no se
  revierten) y la versión puede reenviarse después

### Requirement: Reenvío sin cambios de la versión vigente

El sistema SHALL (DEBE), cuando el Gestor confirma el envío **sin modificar ningún
campo**, **NO** crear una versión nueva: reenvía el PDF de la versión vigente **enviando
realmente** el email E2 a través de `DespacharEmailService.despacharReenvio` (el
adaptador de reenvío NO debe ser un no-op / stub que omita el transporte), registra **una
única** nueva `COMUNICACION` E2 (`es_reenvio = true`, `estado ∈ {'enviado', 'fallido'}`
según el proveedor) y un `AUDIT_LOG`, y deja la versión vigente en `estado = 'enviado'`.
No se crea ni modifica ninguna `RESERVA_EXTRA` ni se recalcula el desglose. El reenvío
sin cambios usa el texto **E2 estándar** (no la marca de edición). (Fuente: `US-015 §Sin
cambios — reenvío de versión existente`; UC-15; US-045 motor de email; patrón reenvío de
US-023/US-028.)

#### Scenario: Reenvío sin cambios invoca al proveedor y no crea versión nueva

- **GIVEN** una RESERVA en `pre_reserva` con PRESUPUESTO `version = 2` en `enviado`
- **WHEN** el gestor abre el presupuesto, no modifica nada y confirma el envío
- **THEN** el proveedor de email se invoca realmente (transporte ejecutado) — el envío
  NO es un no-op
- **AND** no se crea una versión nueva; se reenvía el PDF de la `version = 2`
- **AND** se registra **una única** `COMUNICACION` E2 (`es_reenvio = true`,
  `estado = 'enviado'`) con el asunto/cuerpo estándar de E2 y un `AUDIT_LOG`, y la
  versión sigue en `estado = 'enviado'`

## ADDED Requirements

### Requirement: Marca de edición en el email E2 (asunto y párrafo, ES/CA)

El sistema SHALL (DEBE) permitir que la plantilla **E2** reciba una variable `esEdicion`
(booleana, **derivada en servidor**, default `false`; NO entra por el contrato ni por el
body) y, cuando sea `true` (envío disparado por una **edición** del presupuesto),
renderizar la variante "presupuesto actualizado":

- **Asunto (ES)**: «Hemos actualizado tu presupuesto para el evento (reserva
  {codigoReserva})».
- **Asunto (CA)**: «Hem actualitzat el teu pressupost per a l'esdeveniment (reserva
  {codigoReserva})».
- **Párrafo inicial** insertado inmediatamente tras el saludo «Hola {nombre},» (ES):
  «Hemos actualizado el presupuesto que te enviamos con los cambios solicitados. Te
  adjuntamos la versión revisada.»; **CA** equivalente: «Hem actualitzat el pressupost
  que et vam enviar amb els canvis sol·licitats. T'adjuntem la versió revisada.».

El resto del texto de marca del tenant (pago anticipado del 40%, transferencia con
destinatario "Canoliart, SL" y concepto "Masia l'Encís", condiciones particulares a
firmar, firma "Ari — Masia l'Encís") se mantiene **idéntico** al E2 estándar. Cuando
`esEdicion` es `false` o está ausente (envío original de US-014 o reenvío sin cambios),
la plantilla E2 renderiza el **texto estándar** sin cambios. `variablesRequeridas` de E2
y E2-CA permanece `['nombre', 'codigoReserva']` (`esEdicion` NO es requerida). (Fuente:
`US-015 §Email relacionado`; UC-15; US-014/US-045 plantilla E2 `renderE2`/`renderE2Ca`;
`catalogo-plantillas.ts`.)

#### Scenario: Edición renderiza asunto y párrafo de "presupuesto actualizado" (ES)

- **GIVEN** un envío E2 en español con `esEdicion = true`, `nombre = 'Marta'`,
  `codigoReserva = '26-0001'`
- **WHEN** se renderiza la plantilla E2
- **THEN** el asunto es «Hemos actualizado tu presupuesto para el evento (reserva 26-0001)»
- **AND** tras el saludo «Hola Marta,» aparece el párrafo «Hemos actualizado el
  presupuesto que te enviamos con los cambios solicitados. Te adjuntamos la versión
  revisada.»
- **AND** el resto del texto de marca (pago 40%, transferencia Canoliart, firma Ari) se
  mantiene sin cambios

#### Scenario: Edición renderiza la marca de edición en catalán (CA)

- **GIVEN** un envío E2 en catalán con `esEdicion = true` y `codigoReserva = '26-0001'`
- **WHEN** se renderiza la plantilla E2-CA
- **THEN** el asunto es «Hem actualitzat el teu pressupost per a l'esdeveniment (reserva
  26-0001)»
- **AND** tras el saludo aparece el párrafo «Hem actualitzat el pressupost que et vam
  enviar amb els canvis sol·licitats. T'adjuntem la versió revisada.»

#### Scenario: Sin marca de edición se conserva el E2 estándar

- **GIVEN** un envío E2 con `esEdicion = false` o ausente (envío original / reenvío sin
  cambios)
- **WHEN** se renderiza la plantilla E2
- **THEN** el asunto es «Tu presupuesto para el evento (reserva {codigoReserva})» (o su
  variante CA) y NO se inserta el párrafo de "presupuesto actualizado"
- **AND** `variablesRequeridas` sigue siendo `['nombre', 'codigoReserva']`

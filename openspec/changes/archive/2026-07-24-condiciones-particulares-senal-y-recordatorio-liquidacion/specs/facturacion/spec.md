# Spec Delta — Capability `facturacion`

> **condiciones-particulares-senal-y-recordatorio-liquidacion** — Las condiciones
> particulares (PDF en blanco a firmar) pasan a adjuntarse en la **factura de la señal
> (E3)** en lugar del presupuesto (E2, ver delta `presupuestos`). El adjunto es
> **degradable**: solo se añade si el tenant tiene condiciones configuradas
> (`GenerarPdfCondicionesPort` devuelve URL); si no, la señal se envía igual. Cuando se
> adjuntan, la emisión de E3 fija `RESERVA.cond_part_enviadas_fecha` dentro de la
> transacción. El reenvío de E3 regenera el PDF en blanco (en vez de buscar un DOCUMENTO
> stale). La factura de **liquidación (E4)** añade un **párrafo recordatorio** al cliente
> cuando `RESERVA.cond_part_firmadas = false`.
>
> **Dos conceptos distintos**: *condiciones en blanco* (`GenerarPdfCondicionesPort`, lo que
> se ENVÍA, gobierna el adjunto de E3) vs *condiciones firmadas*
> (`RESERVA.cond_part_firmadas`, lo que se RECIBE, gobierna el recordatorio de E4).
>
> Fuente: petición de usuario; `US-023`, `US-024`, `US-028`; change
> `condiciones-idioma-e2-firma-banner` (revertido en E2); `enviar-factura-senal.use-case.ts`;
> `reenviar-e3.use-case.ts`; `enviar-factura-liquidacion.use-case.ts`;
> `catalogo-plantillas.ts`; `er-diagram.md §3.6 RESERVA`, `§3.12 FACTURA`.

## MODIFIED Requirements

### Requirement: Emisión y envío de la factura de señal al aprobar y enviar E3 (borrador → enviada)

El sistema SHALL (DEBE), cuando el Gestor pulsa "Enviar factura de señal" sobre una
FACTURA con `tipo = 'senal'` en `estado = 'borrador'`, **emitir y enviar** la factura:
pasar `FACTURA(senal).estado = 'enviada'`, fijar `fecha_emision` con el timestamp actual
si era nula, **conservando el `numero_factura` `F-YYYY-NNNN` ya asignado en US-022** (no
se reasigna; si excepcionalmente el borrador no tuviera número, se asigna con la
numeración de US-022, `UNIQUE(tenant_id, numero_factura)` + reintento aplicativo ante
`P2002`, **nunca** locks distribuidos). Todo ello ocurre **solo si el envío del email E3
se confirma** (ver atomicidad).

El envío de E3 SHALL (DEBE) **adjuntar el PDF de "Condicions particulars"** del tenant en
el idioma de la reserva (`RESERVA.idioma`, normalizado a `'es' | 'ca'`), generado vía el
puerto **`GenerarPdfCondicionesPort`** con `{ tenantId, idioma }` (capability `documentos`).
La generación del PDF de condiciones ocurre **antes de la transacción** (pre-tx) y es
**degradable** (`.catch(() => null)`): si el tenant **no** tiene condiciones configuradas
o el render/subida falla, la URL es `null`, el adjunto de condiciones se **OMITE** y la
señal se **envía igual** (sin bloquear la operación con ningún `409`). Cuando la URL **no**
es `null`, el sistema añade al array de adjuntos de E3 el adjunto
`{ clave: 'condiciones', nombre: 'condiciones-particulares.pdf' (es) | 'condicions-particulars.pdf' (ca), pdfUrl }`
y, **solo en ese caso**, dentro de la misma transacción de emisión, fija
`RESERVA.cond_part_enviadas_fecha = now()` y `RESERVA.cond_part_firmadas = false`
(vía `fijarCondicionesEnviadas`). Si **no** se adjuntaron condiciones,
`cond_part_enviadas_fecha` **no** se modifica. La plantilla de E3
(`renderE3` / `renderE3Ca`) incluye el párrafo sobre las condiciones **solo si**
`condicionesAdjuntas === true`.

El sistema DEBE registrar `AUDIT_LOG` con `accion = 'actualizar'`,
`datos_anteriores.estado = 'borrador'` y `datos_nuevos.estado = 'enviada'`. (Fuente:
`US-023 §Happy Path`, `§Reglas de Validación`; US-022 numeración; UC-19; `design.md
§D-guarda-estado, §D-num, §D-adjunto-condiciones`; change
`condiciones-particulares-senal-y-recordatorio-liquidacion` — condiciones movidas de E2
a E3, adjunto degradable sin guarda dura.)

#### Scenario: Enviar factura de señal con condiciones configuradas las adjunta y fija cond_part_enviadas_fecha

- **GIVEN** una FACTURA `tipo = 'senal'` en `estado = 'borrador'` con `numero_factura =
  'F-{año}-NNNN'` (asignado en US-022), PDF disponible, una RESERVA con `idioma = 'es'` y
  `cond_part_enviadas_fecha = NULL`, y un tenant **con** condiciones particulares
  configuradas
- **WHEN** el Gestor pulsa "Enviar factura de señal" y el envío de E3 se confirma
- **THEN** `FACTURA(senal).estado = 'enviada'`, `fecha_emision` con el timestamp actual y
  `numero_factura` sin cambios
- **AND** el motor de email recibe dos adjuntos: la factura de señal y `condiciones`
  (`condiciones-particulares.pdf`, generado con `idioma = 'es'`)
- **AND** `RESERVA.cond_part_enviadas_fecha` queda con el timestamp del envío y
  `RESERVA.cond_part_firmadas = false`
- **AND** `AUDIT_LOG` registra `accion = 'actualizar'` con `datos_anteriores.estado =
  'borrador'` y `datos_nuevos.estado = 'enviada'`

#### Scenario: Enviar factura de señal sin condiciones configuradas se envía igual (degradación)

- **GIVEN** una FACTURA `tipo = 'senal'` en `estado = 'borrador'` con PDF disponible y una
  RESERVA con `cond_part_enviadas_fecha = NULL`, y un tenant **sin** condiciones
  particulares configuradas (`GenerarPdfCondicionesPort` devuelve `null`)
- **WHEN** el Gestor pulsa "Enviar factura de señal" y el envío de E3 se confirma
- **THEN** `FACTURA(senal).estado = 'enviada'` y el email E3 se envía con **solo** el
  adjunto de la factura de señal (sin adjunto de condiciones), **sin** ningún error `409`
- **AND** `RESERVA.cond_part_enviadas_fecha` permanece `NULL` (no se fija porque no hubo
  adjunto de condiciones)
- **AND** la plantilla de E3 no incluye el párrafo de condiciones

### Requirement: Reenvío manual de E3 sin re-emitir la factura ni duplicar documentos

El sistema SHALL (DEBE) ofrecer al Gestor una acción **dedicada** de "Reenviar E3" sobre una
RESERVA cuya factura de señal ya fue **enviada** (E3 enviado previamente). El reenvío DEBE
crear una **nueva** `COMUNICACION` `codigo_email = 'E3'`, `estado = 'enviado'`,
`es_reenvio = true`, `fecha_envio = now()` (ver delta `comunicaciones`), **reutilizando** el
PDF de la factura de señal ya emitido (**sin regenerar ni duplicar** la factura). Para el
adjunto de condiciones, el reenvío DEBE **regenerar el PDF en blanco** de "Condicions
particulars" del tenant vía el puerto **`GenerarPdfCondicionesPort`** con
`{ tenantId, idioma }` (en el idioma de la reserva), **no** buscar un `DOCUMENTO`
persistido (que tras mover las condiciones de E2 a E3 ya no se persiste como tal). La
generación es **degradable**: si devuelve `null`, el reenvío adjunta solo la factura de
señal. El reenvío DEBE actualizar `RESERVA.cond_part_enviadas_fecha` al nuevo timestamp
**cuando** se adjuntaron las condiciones y NO DEBE modificar la `FACTURA` (ni
`numero_factura` ni `estado`) ni el resto de status de la RESERVA (no transiciona la máquina
de estados). El envío DEBE ser síncrono por el puerto directo y ocurrir **antes** de tocar
la BD (espejo del reenvío de E4 `reenviar-liquidacion`): si el proveedor falla, el reenvío
aborta con un error recuperable y **no crea** la COMUNICACION de reenvío **ni actualiza**
`cond_part_enviadas_fecha` (como el email va primero, no queda estado parcial que revertir).
El acceso DEBE respetar RLS (una reserva de otro tenant → no encontrada). (Fuente: `US-023
§E3 ya enviado previamente (idempotencia — reenvío)`; patrón US-028 `reenviar-liquidacion`;
`design.md §D-reenvio-e3`; change `condiciones-particulares-senal-y-recordatorio-liquidacion`
— reenvío regenera el PDF en blanco en vez de buscar el DOCUMENTO stale.)

#### Scenario: El reenvío de E3 crea una nueva comunicación regenerando el PDF de condiciones

- **GIVEN** una RESERVA con la factura de señal `enviada`, una `COMUNICACION` E3 `enviado`
  (`es_reenvio = false`) previa y un tenant con condiciones configuradas
- **WHEN** el Gestor pulsa "Reenviar E3"
- **THEN** se crea una nueva `COMUNICACION` `codigo_email = 'E3'`, `estado = 'enviado'`,
  `es_reenvio = true`, `fecha_envio` no nulo
- **AND** se reutiliza la factura de señal ya emitida y el PDF de condiciones se **regenera**
  en blanco vía `GenerarPdfCondicionesPort` en el idioma de la reserva (no se busca un
  `DOCUMENTO` persistido)
- **AND** `RESERVA.cond_part_enviadas_fecha` se actualiza al nuevo timestamp y la `FACTURA`
  (número y estado) no cambia

#### Scenario: El reenvío de E3 sin condiciones configuradas reenvía solo la factura

- **GIVEN** una RESERVA con E3 ya enviado y un tenant **sin** condiciones configuradas
  (`GenerarPdfCondicionesPort` devuelve `null`)
- **WHEN** el Gestor pulsa "Reenviar E3" y el envío se confirma
- **THEN** se crea la nueva `COMUNICACION` E3 `es_reenvio = true` reenviando **solo** la
  factura de señal (sin adjunto de condiciones), sin error
- **AND** `RESERVA.cond_part_enviadas_fecha` no se actualiza (no hubo adjunto de condiciones)

#### Scenario: Un fallo del proveedor en el reenvío no consolida nada

- **GIVEN** una RESERVA con E3 ya enviado y factura de señal `enviada`
- **WHEN** el Gestor pulsa "Reenviar E3" pero el proveedor de email falla
- **THEN** no se crea la `COMUNICACION` de reenvío y `RESERVA.cond_part_enviadas_fecha` no se
  actualiza (el email va primero: al fallar no se toca la BD)
- **AND** el sistema devuelve un error recuperable y el Gestor puede reintentar

### Requirement: Emisión standalone de la factura de liquidación (flujo espejo de la señal)

El sistema SHALL (DEBE) permitir al Gestor **aprobar y enviar** la factura de liquidación como
un flujo **independiente** de la fianza y **espejo del flujo de la señal** (US-023), sobre una
FACTURA `tipo = 'liquidacion'` en `estado = 'borrador'`: pasar `FACTURA(liquidacion).estado =
'enviada'`, asignar `numero_factura` `F-YYYY-NNNN` **en la emisión** (secuencial y único por
`tenant_id` + año, reutilizando la numeración de US-022 con `UNIQUE(tenant_id, numero_factura)`
+ reintento ante `P2002`, **nunca** locks distribuidos), fijar `fecha_emision = now()`, marcar
los `RESERVA_EXTRA` sumados al borrador con el `factura_id` de la liquidación, y transicionar
`RESERVA.liquidacion_status = 'facturada'`, **solo si el envío del email E4 se confirma** (E4 =
solo liquidación; ver capability `comunicaciones`).

El email E4 SHALL (DEBE) incluir un **párrafo recordatorio al cliente** de que las
**condiciones particulares firmadas** están **pendientes de devolver** **si y solo si**
`RESERVA.cond_part_firmadas = false`; si `cond_part_firmadas = true` (ya se recibieron
firmadas), el párrafo se **omite**. El flag se deriva de `RESERVA.cond_part_firmadas`
(populado por US-024, `POST /reservas/{id}/condiciones-firmadas`), se propaga como
`recordarCondicionesPendientes = !condPartFirmadas` al render de E4, y la plantilla
(`renderE4` / `renderE4Ca`) incluye el párrafo recordatorio **solo si**
`recordarCondicionesPendientes === true`. El recordatorio es un **párrafo condicional en el
email al cliente**, **no** un aviso interno al gestor. No modifica ningún estado ni entidad.

El sistema DEBE registrar `AUDIT_LOG` con `accion = 'actualizar'`, `datos_anteriores.estado =
'borrador'`, `datos_nuevos.estado = 'enviada'`. Este flujo **NO** emite ningún recibo de
fianza, **NO** toca `RESERVA.fianza_status` y **NO** adjunta ningún PDF de fianza. La ficha
DEBE mostrar un **banner permanente** "Liquidación enviada el {fecha/hora}" (derivado de
`fecha_emision`), espejo del banner de la señal. (Fuente: plan §Liquidación standalone;
patrón `US-023 §Emisión y envío de la factura de señal`; `US-024` flag `cond_part_firmadas`;
`US-028 §Email relacionado` E4; `er-diagram.md §3.12 FACTURA`, `§3.6 RESERVA`; change
`condiciones-particulares-senal-y-recordatorio-liquidacion` — recordatorio condicional en E4.)

#### Scenario: Aprobar y enviar la liquidación la emite con número y la deja enviada (solo liquidación)

- **GIVEN** una FACTURA `tipo = 'liquidacion'` en `estado = 'borrador'` con `numero_factura =
  NULL`, PDF disponible y datos fiscales válidos
- **WHEN** el Gestor aprueba y envía la liquidación y el envío de E4 se confirma
- **THEN** `FACTURA(liquidacion).estado = 'enviada'`, `numero_factura = 'F-{año}-NNNN'` y
  `fecha_emision` con el timestamp actual
- **AND** `RESERVA.liquidacion_status = 'facturada'` y los `RESERVA_EXTRA` sumados quedan
  marcados con el `factura_id`
- **AND** `RESERVA.fianza_status` no cambia y no se emite ningún recibo ni PDF de fianza
- **AND** `AUDIT_LOG` registra `accion = 'actualizar'` con `datos_anteriores.estado =
  'borrador'` y `datos_nuevos.estado = 'enviada'`

#### Scenario: E4 recuerda las condiciones pendientes cuando no están firmadas

- **GIVEN** una RESERVA con `cond_part_firmadas = false` y su factura de liquidación en
  `borrador` lista para emitir
- **WHEN** el Gestor aprueba y envía la liquidación y el envío de E4 se confirma
- **THEN** el email E4 al cliente incluye el párrafo recordatorio de que las condiciones
  particulares firmadas están pendientes de devolver
- **AND** el recordatorio es un párrafo del email al cliente, no un aviso interno al gestor

#### Scenario: E4 omite el recordatorio cuando las condiciones ya están firmadas

- **GIVEN** una RESERVA con `cond_part_firmadas = true` (condiciones firmadas ya recibidas) y
  su factura de liquidación en `borrador` lista para emitir
- **WHEN** el Gestor aprueba y envía la liquidación y el envío de E4 se confirma
- **THEN** el email E4 al cliente **no** incluye el párrafo recordatorio de condiciones
  pendientes

#### Scenario: El banner permanente muestra la fecha y hora de envío de la liquidación

- **GIVEN** una FACTURA `tipo = 'liquidacion'` en `estado = 'enviada'` con `fecha_emision`
  informado
- **WHEN** se lee la ficha de la reserva
- **THEN** la sección de liquidación muestra un banner permanente "Liquidación enviada el
  {fecha/hora}" derivado de `fecha_emision`

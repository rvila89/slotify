# Change: us-028-enviar-factura-liquidacion-cliente

## Why

US-028 (Crítica, M5 Facturación & Cobros / Slotify Pay, UC-21 pasos 3–6 / UC-22 pasos 3–4):
tras la generación de los **borradores** de la factura de liquidación (60 % + extras) y del
recibo de fianza (US-027), el **Gestor revisa** esos borradores, opcionalmente los **ajusta**
(descuento negociado / corrección de extras), y con una única acción **"Aprobar y enviar"**
**emite la factura de liquidación** —asignándole un `numero_factura` secuencial y único por
tenant— y **envía al cliente el email E4** con **ambos PDFs** (factura de liquidación + recibo
de fianza). Como efecto del envío, el recibo de fianza también pasa a `enviada` y la RESERVA
avanza sus sub-procesos (`liquidacion_status = facturada`, `fianza_status = recibo_enviado`).
Resuelve **D6** (elimina las facturas manuales en Drive), **D9** (envío automatizado de
documentos de cobro desde Slotify) y **D1** (trazabilidad completa del ciclo de cobro).
(Fuente: `US-028 §Historia`, `§Contexto de Negocio`, `§Impacto de Negocio`; UC-21, UC-22;
`er-diagram.md §3.12 FACTURA`, `§3.16 COMUNICACION`, `§RESERVA liquidacion_status/fianza_status`;
`data-model.md §3.12`, `§3.16`.)

El cimiento ya existe en `master` / en las specs vivas y **se reutiliza, no se recrea**:

- **Capability `facturacion` (US-022, US-027)**: ya define el agregado FACTURA, el desglose
  fiscal (base derivada del total, IVA 21 %, redondeo contable), la **numeración `F-YYYY-NNNN`
  secuencial y única por `tenant_id` + año con reintento aplicativo ante `P2002`** (jamás locks
  distribuidos), la **aprobación del borrador (borrador → enviada + `fecha_emision`)** para la
  factura de señal, y la creación de los **borradores** de liquidación y fianza con
  `numero_factura = NULL` (US-027). Este change **extiende** la aprobación/emisión al tipo
  `liquidacion` (asignando el número que US-027 dejó nulo) y al tipo `fianza`, **reutilizando**
  exactamente esa numeración y esos estados; NO redefine el agregado.
- **Capability `comunicaciones` (US-045)**: ya provee el **motor de email** `DespacharEmailService`
  (selección de plantilla por `codigo_email`, sustitución de variables, **interfaz de adjuntos por
  `pdf_url`**, envío por puerto de dominio, registro en `COMUNICACION` + `AUDIT_LOG`, idempotencia
  por índice UNIQUE parcial `(reserva_id, codigo_email)`), con **E4 declarada pero su cableado con
  adjuntos diferido a su US** (US-045 dejó "el cableado de los emails con adjuntos E2/E3/E4 diferido
  a sus US"). Este change **activa y cablea E4** reutilizando ese motor; NO crea un motor nuevo.
- **RESERVA `liquidacion_status` / `fianza_status`** (`data-model.md §159–160`): enums ya en el
  modelo (`liquidacion_status: pendiente | facturada | cobrada`; `fianza_status: pendiente |
  recibo_enviado | cobrada | devuelta | retenida_parcial`). Este change **avanza** los estados a
  `facturada` y `recibo_enviado`; NO añade estados.
- **PDF (US-014/US-022)**: puerto de dominio + adaptador de PDF ya existente; se **reutiliza**
  para generar los PDFs de liquidación y fianza que se adjuntan a E4.
- **RESERVA_EXTRA (`er-diagram.md §3.10`)**: las líneas con `factura_id IS NULL` sumadas en el
  borrador (US-027) se **marcan** con el `factura_id` de la liquidación **al emitir** (US-028).
- **AUDIT_LOG (US-003+)**: `accion = 'actualizar'` en la transición de estado y `accion = 'crear'`
  para la COMUNICACION E4.

(Fuente: ver `design.md` para el punto de enganche transaccional atómico estado↔email, la
numeración y las decisiones de reuso.)

## What Changes

> Slice vertical (backend + contrato + frontend "editor de borrador + Aprobar y enviar").
> Sujeto al **Gate de revisión humana SDD** (decisiones en `design.md`).

- **Aprobar y enviar la factura de liquidación (acción única del Gestor, atómica estado↔email)**:
  precondición `FACTURA(liquidacion).estado = 'borrador'` Y `RESERVA.liquidacion_status =
  'pendiente'`. Al ejecutar la acción, en una unidad transaccional coordinada:
  - `FACTURA(liquidacion).estado = 'enviada'`, se asigna `numero_factura = 'F-YYYY-NNNN'`
    (secuencial y único por `tenant_id` + año, reutilizando la numeración de US-022) y
    `fecha_emision = now()`.
  - `RESERVA.liquidacion_status = 'facturada'`.
  - `FACTURA(fianza).estado = 'enviada'` (efecto del envío conjunto) y `RESERVA.fianza_status =
    'recibo_enviado'`.
  - Los `RESERVA_EXTRA` incluidos en la liquidación (`factura_id IS NULL`) se **marcan** con el
    `factura_id` de la liquidación emitida.
  - Se envía el **email E4** a `CLIENTE.email` con los PDFs de **factura de liquidación** y
    **recibo de fianza** adjuntos, vía el motor de `comunicaciones` (US-045).
  - Se crea `COMUNICACION` con `codigo_email = 'E4'`, `estado = 'enviado'`, `fecha_envio = now()`.
  - `AUDIT_LOG` con `accion = 'actualizar'` (transición de estados) y con la traza del envío.
  (Fuente: `US-028 §Happy Path`, `§Reglas de negocio`.)
- **Atomicidad estado↔email (rollback total ante fallo de PDF/email)**: si falla la generación
  del PDF o el envío de E4, **ninguno** de los cambios de estado se persiste: las FACTURA
  permanecen en `borrador`, `RESERVA.liquidacion_status` sigue `pendiente`, `fianza_status`
  sigue `pendiente`, **no** se asigna `numero_factura`, **no** se marcan los `RESERVA_EXTRA` y el
  Gestor recibe un error recuperable y puede reintentar. (Fuente: `US-028 §Fallo en la generación
  del PDF o en el envío del email`, `§Reglas de Validación`.)
- **Ajuste del importe/descuento antes de aprobar (descuento negociado)**: el editor de borrador
  permite ajustar el total/descuento de la factura de liquidación **mientras está en `borrador`**.
  Al aplicar un descuento, se **recalcula** el total y el desglose fiscal (base derivada del nuevo
  total, IVA 21 %), se actualiza `RESERVA.importe_liquidacion` con el nuevo importe y el ajuste
  queda trazado en `AUDIT_LOG` (`accion = 'actualizar'`). El resto del flujo de "Aprobar y enviar"
  procede igual con el importe ajustado. Ejemplo del AC: `4.100,00 €` − `200 €` descuento =
  `3.900,00 €`. (Fuente: `US-028 §Gestor ajusta el importe antes de aprobar`.)
- **Envío del recibo de fianza por separado (edge case, sin liquidación)**: el Gestor puede,
  desde la ficha de reserva, enviar **solo** el recibo de fianza en un email al cliente (con el
  PDF del recibo adjunto). Este envío pasa `RESERVA.fianza_status = 'recibo_enviado'` (y
  `FACTURA(fianza).estado = 'enviada'`), **no cambia** `liquidacion_status`, y **no usa el código
  E4**: se registra como `COMUNICACION` con `codigo_email = 'manual'`. El posterior "Aprobar y
  enviar" de la liquidación, si la fianza ya fue enviada, adjunta en E4 **solo** la factura de
  liquidación (no vuelve a adjuntar/enviar el recibo ya enviado ni retrocede `fianza_status`).
  (Fuente: `US-028 §Envío del recibo de fianza por separado`.)
- **Reenvío de una factura ya enviada**: si `FACTURA(liquidacion).estado = 'enviada'`, el Gestor
  puede "Reenviar factura de liquidación": el sistema **reenvía** el PDF ya emitido al email del
  cliente y crea una **nueva** `COMUNICACION` de reenvío, **sin** reasignar `numero_factura`, sin
  cambiar `FACTURA.estado` ni `RESERVA.liquidacion_status`. (Fuente: `US-028 §Factura ya enviada
  (reenvío)`.)
- **Reglas de validación**: solo se puede aprobar y enviar si `FACTURA(liquidacion).estado =
  'borrador'`; `numero_factura` se genera **en la emisión** (nunca en borrador) y es único por
  `tenant_id`; la transición `liquidacion_status: pendiente → facturada` requiere el **éxito** del
  envío de E4 (atomicidad); `liquidacion_status` no retrocede de `facturada` a `pendiente` sin
  acción explícita del Gestor (no modelada en MVP). (Fuente: `US-028 §Reglas de Validación`.)
- **Frontend "Revisar y enviar liquidación"**: en la ficha de una RESERVA `reserva_confirmada`
  con `liquidacion_status = pendiente`, el Gestor ve el editor de los borradores de liquidación
  (con campo de descuento editable, total y desglose recalculados) y de fianza, y las acciones
  "Aprobar y enviar", "Enviar recibo de fianza por separado" y —cuando ya está enviada—
  "Reenviar factura de liquidación". Estados y mensajes de error recuperable claros. Responsive
  mobile-first (390/768/1280).

## Impact

- Specs: **modifica la capability `facturacion`** (ADDED requirements para la aprobación/emisión
  de la factura de liquidación —asignación del `numero_factura` secuencial diferido de US-027,
  `fecha_emision`, `borrador → enviada`, marcado de `RESERVA_EXTRA`—, el avance de
  `RESERVA.liquidacion_status → facturada`, la emisión del recibo de fianza
  `FACTURA(fianza).estado → enviada` + `RESERVA.fianza_status → recibo_enviado`, la **atomicidad
  estado↔email con rollback total**, el ajuste de importe/descuento antes de aprobar con
  recálculo del desglose y actualización de `RESERVA.importe_liquidacion`, el envío separado del
  recibo de fianza y el reenvío de la factura ya emitida). **Modifica la capability
  `comunicaciones`** (ADDED requirement que **activa y cablea E4**: envío tras aprobación con los
  **dos PDFs** adjuntos, `COMUNICACION(codigo_email = 'E4', estado = 'enviado')`, el envío
  separado del recibo de fianza como `codigo_email = 'manual'`, y el reenvío como nueva
  `COMUNICACION`; reutiliza el motor y la interfaz de adjuntos de US-045). La numeración
  `F-YYYY-NNNN`, el desglose fiscal, la generación de PDF y la aprobación (borrador → enviada) se
  **reutilizan** de los requisitos ya vivos de `facturacion` (US-022) sin redefinirlos.
- Contrato OpenAPI (`docs/api-spec.yml`): se prevé **añadir** los endpoints de acción sobre las
  facturas de la reserva —aprobar-y-enviar la liquidación, ajustar el borrador (descuento), enviar
  el recibo de fianza por separado y reenviar la factura emitida— (ver `design.md §D-6`, input para
  la fase de contrato). El `contract-engineer` (post-gate) los definirá; **no se toca
  `docs/api-spec.yml` en este change de spec**. No se edita el cliente generado a mano.
- Código (implementación posterior, fuera de este change de spec):
  `apps/api/src/facturacion/{domain,application,infrastructure,interface}/**` (use-case de
  aprobar-y-enviar con la coordinación atómica estado↔email + numeración + marcado de
  `RESERVA_EXTRA` + AUDIT_LOG, use-case de ajuste del descuento con recálculo del desglose en
  dominio puro, use-case de envío separado del recibo de fianza, use-case de reenvío),
  integración con el motor de `comunicaciones` (`apps/api/src/comunicaciones/**`, plantilla y
  cableado de E4 con dos adjuntos), y `apps/web/src/features/facturacion/**` (editor de borrador +
  acciones). La ubicación exacta se fija en `design.md`.
- **Migración**: **no prevista**. La tabla FACTURA ya soporta `numero_factura` nullable (US-027),
  `estado` incluye `enviada`, `fecha_emision` existe; RESERVA ya tiene los enums
  `liquidacion_status`/`fianza_status`; COMUNICACION ya tiene `codigo_email` con `E4`/`manual` y su
  índice de idempotencia. Si el desarrollo detectara una carencia, se evalúa en implementación.
- Trazabilidad: **US-028**, **UC-21** (pasos 3–6), **UC-22** (pasos 3–4), **E4**; entidades
  FACTURA, RESERVA, RESERVA_EXTRA, CLIENTE, COMUNICACION, AUDIT_LOG.
- Dependencias (todas archivadas en `master`): **US-027** (borradores de liquidación y fianza
  generados = punto de partida), **US-022** (agregado FACTURA, numeración, desglose, aprobación),
  **US-045** (motor de email + interfaz de adjuntos), US-014 (PDF), US-021 (`importe_liquidacion`
  congelado, sub-procesos inicializados), US-003+ (AUDIT_LOG).

## Lo que NO entra (anti-scope)

- **Recordatorio automático T-1d sin cobro** (FA-01 de UC-21, "Política Negociable, alerta crítica
  al gestor"): **lista negra 📐** del MVP (recordatorios de cobro automáticos). La política de
  cancelación por liquidación tardía queda hardcoded como "Negociable"; **no** hay lógica
  automática de penalización. (Fuente: `US-028 §Notas de alcance`.)
- **Conciliación / cobro de la liquidación o la fianza** (`enviada → cobrada`, `liquidacion_status
  → cobrada`, `fianza_status → cobrada`, `devuelta`, `retenida_parcial`): US posteriores. Este
  change llega hasta `facturada` / `recibo_enviado`.
- **Retroceso de `liquidacion_status` de `facturada` a `pendiente`**: no modelado en MVP
  (`US-028 §Reglas de Validación`).
- **Factura complementaria post-evento** (extras pedidos tras la emisión de la liquidación):
  lista negra 📐 del MVP.
- **Motor de tarifa / recálculo del porcentaje**: el total de la liquidación parte del borrador de
  US-027 (`importe_liquidacion` congelado + Σ extras). El único recálculo de este change es la
  **resta del descuento negociado** aplicada por el Gestor y su nuevo desglose fiscal; NO se
  recalcula tarifa ni porcentaje del 60 %.
- **Cambio del motor de email de US-045**: se **reutiliza** tal cual (plantilla + interfaz de
  adjuntos); este change solo activa/cablea E4.

## Decisiones de alcance pendientes de aprobación humana

Las decisiones de diseño están **razonadas con recomendación** en `design.md` y quedan
**abiertas hasta el OK del Gate SDD**. En particular:
- **D-1**: **atomicidad estado↔email** — cómo se coordina la transición de estados (con
  asignación de `numero_factura`) con el envío de E4 para lograr rollback total ante fallo de
  PDF/email, sin sostener el `FOR UPDATE` del bloqueo de fecha ni recurrir a locks distribuidos.
- **D-2**: **generación del `numero_factura` secuencial** en la emisión, reutilizando la
  numeración de US-022 (`UNIQUE(tenant_id, numero_factura)` + reintento ante `P2002`).
- **D-3**: **ajuste de descuento antes de aprobar** — recálculo del desglose (dominio puro) y
  actualización de `RESERVA.importe_liquidacion`, solo en `borrador`, trazado en AUDIT_LOG.
- **D-4**: **envío separado del recibo de fianza** — `codigo_email = 'manual'`, avanza solo
  `fianza_status`; E4 posterior adjunta solo la liquidación.
- **D-5**: **reenvío** de la factura ya emitida — nueva `COMUNICACION` sin cambiar número ni
  estado; conciliación con el índice UNIQUE parcial `(reserva_id, codigo_email)` de US-045.
- **D-6**: **contrato** — endpoints de acción (aprobar-y-enviar, ajustar descuento, enviar fianza
  separada, reenviar) sobre las facturas de la reserva.

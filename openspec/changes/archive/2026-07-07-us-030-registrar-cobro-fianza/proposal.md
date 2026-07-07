# Change: us-030-registrar-cobro-fianza

## Why

US-030 (Alta, M5 Facturación & Cobros / Slotify Pay, UC-22 pasos 5–9): tras el envío del **recibo de
la fianza** al cliente (US-028, que dejó `RESERVA.fianza_status = 'recibo_enviado'` y
`FACTURA(fianza).estado = 'enviada'`), el **Gestor registra el cobro** de la fianza (depósito
reembolsable) **antes o el mismo día del evento**, cuando recibe la transferencia bancaria externa o el
efectivo. Al registrar el cobro se crea un registro `PAGO` conciliado contra la factura de fianza,
opcionalmente se adjunta el **justificante de pago** como `DOCUMENTO (tipo = justificante_pago)`, y
ambos avanzan a `cobrada`: `FACTURA(fianza).estado = 'cobrada'` y `RESERVA.fianza_status = 'cobrada'`.
Además se materializa el registro financiero del depósito en la RESERVA: `RESERVA.fianza_eur = importe
cobrado` y `RESERVA.fianza_cobrada_fecha = fecha_cobro`. Esto **habilita la tercera de las tres
precondiciones** de la futura transición a `evento_en_curso` (junto con `pre_evento_status = cerrado`
y `liquidacion_status = cobrada`). Resuelve **D6** (registro centralizado de cobros, elimina la gestión
de fianzas en Excel), **D1** (trazabilidad completa del depósito reembolsable para su posterior
devolución en UC-26/UC-27) y **D11**. El pago se realiza por **transferencia bancaria externa o
efectivo**: Slotify **registra** el justificante pero **NO procesa** el cobro (sin integración de
pasarela en MVP).
(Fuente: `US-030 §Historia`, `§Contexto de Negocio`, `§Impacto de Negocio`; UC-22 pasos 5–9;
`er-diagram.md §3.13 PAGO`, `§3.15 DOCUMENTO`, `§3.12 FACTURA (estado cobrada)`, `§RESERVA
fianza_status / fianza_eur / fianza_cobrada_fecha`.)

El cimiento ya existe en `master` / en las specs vivas y **se reutiliza, no se recrea**:

- **Capability `facturacion` (US-022, US-027, US-028, US-029)**: ya define el agregado FACTURA con el
  ciclo `borrador → enviada → cobrada`, la generación del **recibo de fianza en borrador** y su
  **emisión** (`FACTURA(fianza).estado = 'enviada'`, `RESERVA.fianza_status = 'recibo_enviado'`, US-027
  + US-028), y —decisivo— la **fase de cobro** ya introducida por **US-029** para la liquidación:
  entidad `PAGO` conciliada contra FACTURA, justificante opcional como `DOCUMENTO`, transición atómica
  `enviada → cobrada` con guarda de doble cobro vía `SELECT ... FOR UPDATE` sobre RESERVA. Este change
  **extiende** esa fase de cobro al **recibo de fianza** (`fianza_status: recibo_enviado → cobrada`),
  reutilizando entidad, puertos, transacción y convenciones. NO redefine el agregado ni la entidad PAGO.
- **Entidad `PAGO`** (`er-diagram.md §3.13`; ya **materializada** por US-029): `id_pago`, `factura_id`,
  `importe`, `fecha_cobro`, `justificante_doc_id` (FK nullable → DOCUMENTO), `fecha_creacion` y
  `tenant_id` (D-1 de US-029, aprobado en su gate). El cobro de fianza crea un `PAGO` con
  `factura_id = <id recibo fianza>`. NO se toca el modelo de PAGO (misma tabla, migración ya aplicada).
- **Entidad `DOCUMENTO` polimórfica** (`er-diagram.md §3.15`): `tipo = justificante_pago` ya en uso
  (US-029). El justificante de la fianza se almacena reutilizando esta entidad; NO se crea modelo nuevo.
- **`RESERVA.fianza_status`** (`er-diagram.md`): el enum ya incluye `cobrada` (`pendiente |
  recibo_enviado | cobrada | ...`). Este change **avanza** el estado a `cobrada`; NO añade estados.
- **`RESERVA.fianza_eur` y `RESERVA.fianza_cobrada_fecha`** (`er-diagram.md §RESERVA`): campos ya
  modelados; este change los **actualiza** en la misma transacción del cobro. NO añade columnas.
- **`FACTURA.estado`** (`er-diagram.md §286`): el enum ya incluye `cobrada`. Este change lo **usa**.
- **AUDIT_LOG (US-003+)**: `accion = 'crear'` para el `PAGO` (y el `DOCUMENTO` del justificante si se
  adjunta) y `accion = 'actualizar'` para la transición de estados de FACTURA y RESERVA (incluidos
  `fianza_eur` y `fianza_cobrada_fecha`).

(Fuente: ver `design.md` para la transición de estado, la política "Negociable" no bloqueante, el
endpoint y la idempotencia/concurrencia contra el doble cobro.)

## What Changes

> Slice vertical de **backend + contrato + frontend ligero** (US talla S/M). El registro del cobro de
> fianza es una acción del Gestor desde la ficha de la reserva, con un pequeño formulario. Sujeto al
> **Gate de revisión humana SDD** (decisiones en `design.md`).

- **Registrar el cobro de la fianza (acción del Gestor)**: precondición `RESERVA.fianza_status =
  'recibo_enviado'` Y `FACTURA(fianza).estado = 'enviada'`. Al registrar el cobro, en una unidad
  transaccional atómica:
  - Se crea un registro `PAGO` con `factura_id = <id recibo fianza>`, `importe`, `fecha_cobro` y, si
    se adjunta, `justificante_doc_id`.
  - Si el Gestor adjunta un justificante, se almacena como `DOCUMENTO (tipo = 'justificante_pago')`
    vinculado a la reserva, y su `id_documento` se referencia desde `PAGO.justificante_doc_id`.
  - `RESERVA.fianza_eur = importe` cobrado y `RESERVA.fianza_cobrada_fecha = fecha_cobro`.
  - `FACTURA(fianza).estado = 'cobrada'`.
  - `RESERVA.fianza_status = 'cobrada'`.
  - `AUDIT_LOG` con `accion = 'crear'` (el PAGO y, si aplica, el DOCUMENTO) y `accion = 'actualizar'`
    (transición de estados de FACTURA y RESERVA, incluidos `fianza_eur`/`fianza_cobrada_fecha`).
  (Fuente: `US-030 §Happy Path`, `§Reglas de negocio`.)
- **Justificante opcional**: el cobro puede registrarse **sin** adjuntar documento (p. ej. efectivo el
  día del evento). En ese caso `PAGO.justificante_doc_id = NULL`; el estado avanza igualmente a
  `cobrada`. (Fuente: `US-030 §Cobro sin justificante`.)
- **Cobro en cualquier momento antes o el mismo día del evento (T-0 incluido)**: no hay fecha mínima de
  cobro; cualquier `fecha_cobro ≤ fecha_evento` es válida. El cobro en el día del evento (`fecha_cobro
  = fecha_evento`) se acepta sin diferencia respecto al happy path. (Fuente: `US-030 §Cobro el mismo
  día del evento (T-0)`, `§Reglas de Validación`.)
- **Guarda contra doble cobro (bloquea si ya `cobrada`)**: si `RESERVA.fianza_status = 'cobrada'` (el
  cobro ya fue registrado), un nuevo intento se **rechaza** con el mensaje "La fianza ya está marcada
  como cobrada"; **no se crea ningún PAGO adicional**. (Fuente: `US-030 §Intento de doble cobro`.)
- **Cobro con `fianza_status = 'pendiente'` — política "Negociable" (aviso NO bloqueante, con
  confirmación)**: si el recibo de fianza nunca fue enviado (`fianza_status = 'pendiente'`), el sistema
  **no bloquea** duramente: emite un aviso ("El recibo de fianza no ha sido enviado al cliente. ¿Desea
  registrar el cobro igualmente?"). Si el Gestor **confirma**, el cobro se registra igualmente
  (avanzando a `cobrada`) y el flujo excepcional queda **trazado en `AUDIT_LOG`** (registro del cobro
  sobre fianza no enviada); si **cancela**, no se realiza ninguna acción. (Fuente: `US-030 §Cobro con
  fianza_status = pendiente`.) Esto **contrasta** con la liquidación (US-029), donde el estado
  `pendiente` bloqueaba de forma dura: la fianza aplica la política "Negociable".
- **FA-01 (T-0 sin cobro) — alerta NO bloqueante para la transición a `evento_en_curso`**: si en el día
  del evento `fianza_status ≠ 'cobrada'`, la política hardcoded es "Negociable": el sistema genera una
  **alerta crítica no bloqueante** ("⚠️ Fianza pendiente de cobro. Puede registrarla ahora o proceder
  sin ella (política Negociable)") y el Gestor decide manualmente si registrar el cobro o avanzar sin
  él. El inicio del evento **no se bloquea** por fianza impagada. (Fuente: `US-030 §Evento en T-0 con
  fianza sin cobrar (FA-01)`.)
- **Reglas de validación**: `PAGO.fecha_cobro` debe ser **≤ `RESERVA.fecha_evento`** (no se registra
  cobro de fianza después del evento); `PAGO.importe` debe ser **> 0**; `RESERVA.fianza_eur` y
  `RESERVA.fianza_cobrada_fecha` se actualizan **simultáneamente** con el `PAGO`; `FACTURA(fianza).estado
  = 'cobrada'` solo si se crea el `PAGO` correspondiente (misma transacción). (Fuente: `US-030 §Reglas
  de Validación`.)
- **Habilita la tercera precondición del inicio del evento sin transicionar la reserva**: al dejar
  `fianza_status = 'cobrada'`, se habilita **una de las tres** precondiciones de `evento_en_curso`
  (junto con `pre_evento_status = 'cerrado'` y `liquidacion_status = 'cobrada'`). Este change **NO**
  implementa la guarda de transición ni las otras dos precondiciones. (Fuente: `US-030 §Reglas de
  negocio`.)

## Impact

- Specs: **modifica la capability `facturacion`** (ADDED requirements para: registro del cobro de la
  **fianza** con creación de `PAGO`, la transición atómica `FACTURA(fianza).estado: enviada → cobrada`
  + `RESERVA.fianza_status: recibo_enviado → cobrada` + actualización de `fianza_eur`/`fianza_cobrada_fecha`,
  el justificante opcional como `DOCUMENTO (tipo = justificante_pago)`, la guarda contra doble cobro,
  la validación `fecha_cobro ≤ fecha_evento` e `importe > 0`, la política "Negociable" no bloqueante
  para `fianza_status = pendiente` con confirmación y traza en AUDIT_LOG, y la habilitación de la
  tercera precondición de `evento_en_curso`). El ciclo previo de la fianza (generación del recibo,
  emisión `borrador → enviada` con `fianza_status: pendiente → recibo_enviado`) se **reutiliza** de
  US-027/US-028 sin redefinirlo. La fase de cobro (entidad PAGO, justificante opcional, transacción
  atómica con `FOR UPDATE`) **reutiliza** el patrón de US-029.
- Contrato OpenAPI (`docs/api-spec.yml`): se prevé **añadir** un endpoint de acción de cobro sobre la
  factura de fianza de la reserva —análogo al de liquidación de US-029— (ver `design.md §D-3`, input
  para la fase de contrato). El `contract-engineer` (post-gate) lo definirá; **no se toca
  `docs/api-spec.yml` en este change de spec**. No se edita el cliente generado a mano.
- Código (implementación posterior, fuera de este change de spec):
  `apps/api/src/facturacion/{domain,application,infrastructure,interface}/**` (use-case
  `RegistrarCobroFianza` con la transición atómica estado↔PAGO reutilizando el puerto de PAGO ya
  materializado por US-029, validaciones de dominio puro `fecha_cobro ≤ fecha_evento` / `importe > 0`,
  guarda de doble cobro, y la política "Negociable" con flag de confirmación + traza AUDIT_LOG),
  reutilización de `DOCUMENTO` para el justificante. **Frontend SÍ en alcance**: pequeño formulario de
  registro de cobro de fianza en la ficha de la reserva (importe, fecha de cobro, justificante opcional)
  y el aviso "Negociable" con confirmación. La ubicación exacta se fija en `design.md`.
- **Migración**: **NO requerida**. La tabla `PAGO` (con `tenant_id`), los valores de enum
  (`FACTURA.estado = cobrada`, `fianza_status = cobrada`, `DOCUMENTO.tipo = justificante_pago`) y los
  campos `RESERVA.fianza_eur`/`RESERVA.fianza_cobrada_fecha` **ya existen** (US-029 materializó PAGO;
  el modelo de RESERVA ya trae los campos de fianza). Si el desarrollo detectara una columna faltante,
  la migración sería aditiva.
- Trazabilidad: **US-030**, **UC-22** (pasos 5–9); entidades PAGO, DOCUMENTO, FACTURA, RESERVA
  (`fianza_status`, `fianza_eur`, `fianza_cobrada_fecha`), AUDIT_LOG.
- Dependencias (todas satisfechas): **US-028** (`fianza_status = recibo_enviado`,
  `FACTURA(fianza).estado = enviada` = punto de partida; su change está **archivado** en
  `openspec/changes/archive/2026-07-04-us-028-enviar-factura-liquidacion-cliente/` aunque su
  front-matter aún diga `backlog`), **US-029** (fase de cobro: entidad PAGO materializada, justificante
  opcional, patrón de transacción atómica con `FOR UPDATE`), **US-022/US-027** (agregado FACTURA, ciclo
  de vida, recibo de fianza), US-003+ (AUDIT_LOG), US-024/US-019 (entidad DOCUMENTO polimórfica).

## Lo que NO entra (anti-scope)

- **Integración con Stripe o pasarela de pago**: **lista negra 📐** del MVP. La fianza se cobra por
  transferencia bancaria externa o efectivo; Slotify solo **registra** el justificante, no cobra.
  (Fuente: `US-030 §Supuestos`.)
- **Recordatorios automáticos de cobro de fianza** (A25 T-3d, A26 T-1d): **lista negra 📐** del MVP
  (recordatorios automáticos extendidos). La política de fianza impagada queda hardcoded como
  "Negociable"; **no** hay lógica automática de recordatorio ni penalización. (Fuente: `US-030 §Notas
  de alcance`.)
- **Devolución de la fianza post-evento** (`fianza_status → devuelta` / `retenida_parcial`, UC-26
  solicitar IBAN, UC-27 procesar devolución): pertenece al **área Post-evento**; US posterior. Este
  change cubre **solo** el **cobro** de la fianza. (Fuente: `US-030 §Notas de alcance`.)
- **Transición a `evento_en_curso`** (US-031): este change **solo deja** `fianza_status = cobrada` como
  la tercera precondición; **NO** implementa la guarda de transición ni evalúa las otras dos
  (`pre_evento_status = cerrado`, `liquidacion_status = cobrada`). La alerta FA-01 de fianza sin cobrar
  se especifica aquí como comportamiento no bloqueante, pero su **integración en el flujo de transición**
  es de US-031.
- **Adjuntar el justificante en un momento posterior al registro del cobro** (editar el PAGO para
  añadir `justificante_doc_id` a posteriori): diferido a una US posterior; este change cubre el registro
  con justificante opcional **en el momento del registro**.
- **Discrepancia de importe fianza vs. `fianza_default_eur`**: a diferencia de la liquidación (US-029),
  la US-030 **no** exige una alerta de discrepancia sobre el importe de la fianza (`RESERVA.fianza_eur`
  se define como el importe cobrado, sin comparación obligatoria); **no** se implementa alerta de
  discrepancia en este change.
- **Retroceso de `fianza_status` de `cobrada` a `recibo_enviado`** (anulación de cobro): no modelado en
  MVP.

## Decisiones de alcance (Gate SDD APROBADO)

El **Gate de revisión humana SDD quedó aprobado** con las decisiones cerradas que se recogen abajo (ya
**no** hay preguntas abiertas sobre D-2). Las decisiones de diseño detalladas viven en `design.md`. En
particular:
- **D-1**: **transición atómica estado↔PAGO** — creación del PAGO + `FACTURA(fianza).estado = cobrada` +
  `fianza_status = cobrada` + `fianza_eur`/`fianza_cobrada_fecha` en una única `$transaction`; guarda
  contra doble cobro con `SELECT ... FOR UPDATE` sobre RESERVA (reuso del patrón US-029).
- **D-2**: **política "Negociable" para `fianza_status = pendiente`** — aviso NO bloqueante que requiere
  **confirmación explícita del Gestor** (flag `confirmarSinRecibo` en el body; sin flag/`false` sobre
  `pendiente` → "confirmación requerida", NO crea PAGO), con traza en AUDIT_LOG; contrasta con el bloqueo
  duro de la liquidación en US-029. **DECISIÓN CERRADA D-2(b) (aprobada en el gate)** sobre la
  FACTURA(fianza) en el salto `pendiente → cobrada`: si la `FACTURA(fianza)` está en **`borrador`**, el
  cobro confirmado la lleva **directamente a `cobrada`** (`borrador → cobrada`, documentando el salto de
  estado en AUDIT_LOG); si **no existe** `FACTURA(fianza)` (fianza omitida por `fianza_default_eur = 0`),
  se **crea una al vuelo** y se marca **`cobrada`** (con la traza de creación en AUDIT_LOG). Esto sustituye
  al antiguo "a validar en el gate".
- **D-3**: **contrato** — endpoint `POST /reservas/{id}/facturas/fianza/cobro` con body `{ importe,
  fecha_cobro, justificante_doc_id?, confirmarSinRecibo? }`; validación `fecha_cobro ≤ fecha_evento`.
- **D-4**: **frontend** — formulario de registro de cobro de fianza en la ficha de la reserva + el aviso
  "Negociable" con confirmación (¿modal de confirmación reutilizable?).
- **D-5**: **justificante como DOCUMENTO** — reuso de la entidad polimórfica con `tipo =
  justificante_pago`; referencia a documento ya subido vs. `multipart` en la petición.

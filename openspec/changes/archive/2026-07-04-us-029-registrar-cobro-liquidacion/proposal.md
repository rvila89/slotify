# Change: us-029-registrar-cobro-liquidacion

## Why

US-029 (Crítica, M5 Facturación & Cobros / Slotify Pay, UC-21 pasos 7–10): tras el envío de la
factura de liquidación al cliente (US-028, que dejó `RESERVA.liquidacion_status = 'facturada'` y
`FACTURA(liquidacion).estado = 'enviada'`), el **Gestor registra el cobro** del 60 % restante del
evento cuando recibe la transferencia bancaria externa. Al registrar el cobro se crea un registro
`PAGO` conciliado contra la factura de liquidación, opcionalmente se adjunta el **justificante de
pago** como `DOCUMENTO (tipo = justificante_pago)`, y ambos documentos avanzan a `cobrada`:
`FACTURA(liquidacion).estado = 'cobrada'` y `RESERVA.liquidacion_status = 'cobrada'`. Esto **habilita
una de las tres precondiciones** para la futura transición a `evento_en_curso` (US-031, junto con
`pre_evento_status = cerrado` y `fianza_status = cobrada`). Resuelve **D6** (registro centralizado de
cobros, elimina el seguimiento en Excel), **D1** (trazabilidad completa del ciclo de cobro) y **D11**.
El pago se realiza por **transferencia bancaria externa**: Slotify **registra** el justificante pero
**NO procesa** el pago (sin integración de pasarela en MVP).
(Fuente: `US-029 §Historia`, `§Contexto de Negocio`, `§Impacto de Negocio`; UC-21 pasos 7–10;
`er-diagram.md §3.13 PAGO`, `§3.15 DOCUMENTO`, `§3.12 FACTURA (estado cobrada)`, `§RESERVA
liquidacion_status`; `data-model.md §3.13`, `§3.15`.)

El cimiento ya existe en `master` / en las specs vivas y **se reutiliza, no se recrea**:

- **Capability `facturacion` (US-022, US-027, US-028)**: ya define el agregado FACTURA con el
  ciclo `borrador → enviada`, el desglose fiscal, la numeración `F-YYYY-NNNN` y la transición
  `RESERVA.liquidacion_status: pendiente → facturada` en la emisión. Este change **extiende** la
  capability con la fase de **cobro** (`enviada → cobrada`, `liquidacion_status: facturada →
  cobrada`) y con la nueva entidad `PAGO` conciliada contra la factura. NO redefine el agregado.
- **Entidad `PAGO`** (`er-diagram.md §3.13`): ya **modelada** en el diagrama ER
  (`id_pago`, `factura_id`, `importe`, `fecha_cobro`, `justificante_doc_id`, `fecha_creacion`) con
  las relaciones `FACTURA ||--o{ PAGO : "concilia"` y `DOCUMENTO ||--o| PAGO : "justifica"`. Este
  change **materializa** su tabla y su persistencia (migración aditiva); NO inventa el modelo.
- **Entidad `DOCUMENTO` polimórfica** (`er-diagram.md §3.15`): ya modela `tipo = justificante_pago`
  y la relación `DOCUMENTO ||--o| PAGO`. El justificante de cobro se almacena reutilizando esta
  entidad; NO se crea un modelo de documento nuevo.
- **`RESERVA.liquidacion_status`** (`data-model.md §163`, `er-diagram.md §489`): el enum ya incluye
  `cobrada` (`pendiente | facturada | cobrada`). Este change **avanza** el estado a `cobrada`; NO
  añade estados.
- **`FACTURA.estado`** (`er-diagram.md §286`): el enum ya incluye `cobrada` (`borrador | enviada |
  cobrada`). Este change **usa** ese valor; NO añade estados.
- **AUDIT_LOG (US-003+)**: `accion = 'crear'` para el `PAGO` (y el `DOCUMENTO` del justificante si
  se adjunta) y `accion = 'actualizar'` para la transición de estados de FACTURA y RESERVA.

(Fuente: ver `design.md` para el modelado de PAGO/DOCUMENTO, la transición de estado, el endpoint,
y la idempotencia/concurrencia contra el doble cobro.)

## What Changes

> Slice vertical de **backend + contrato** (US talla S). El registro del cobro es una acción del
> Gestor desde la ficha de la reserva. Sujeto al **Gate de revisión humana SDD** (decisiones en
> `design.md`).

- **Registrar el cobro de la liquidación (acción del Gestor)**: precondición `RESERVA.liquidacion_status
  = 'facturada'` Y `FACTURA(liquidacion).estado = 'enviada'`. Al registrar el cobro, en una unidad
  transaccional atómica:
  - Se crea un registro `PAGO` con `factura_id = <id factura liquidacion>`, `importe`, `fecha_cobro`
    y, si se adjunta, `justificante_doc_id`.
  - Si el Gestor adjunta un justificante, se almacena como `DOCUMENTO (tipo = 'justificante_pago')`
    vinculado a la reserva, y su `id_documento` se referencia desde `PAGO.justificante_doc_id`.
  - `FACTURA(liquidacion).estado = 'cobrada'`.
  - `RESERVA.liquidacion_status = 'cobrada'`.
  - `AUDIT_LOG` con `accion = 'crear'` (el PAGO y, si aplica, el DOCUMENTO) y `accion = 'actualizar'`
    (transición de estados de FACTURA y RESERVA).
  (Fuente: `US-029 §Happy Path`, `§Reglas de negocio`.)
- **Justificante opcional**: el cobro puede registrarse **sin** adjuntar documento. En ese caso
  `PAGO.justificante_doc_id = NULL`; el estado avanza igualmente a `cobrada`. El Gestor puede adjuntar
  el justificante en cualquier momento posterior (adjuntar posterior fuera del alcance de este change:
  ver anti-scope). (Fuente: `US-029 §Cobro registrado sin justificante`.)
- **Discrepancia de importe (alerta, NO bloquea)**: si el `importe` introducido difiere del `FACTURA.total`
  de la liquidación, el sistema devuelve una **alerta informativa de discrepancia** pero **crea igualmente
  el PAGO con el importe real** introducido y avanza a `cobrada`. La discrepancia queda registrada en
  `AUDIT_LOG`. El sistema **no bloquea** por diferencias de importe (delega la conciliación al Gestor).
  (Fuente: `US-029 §Importe cobrado diferente al facturado`.)
- **Guarda contra doble cobro (bloquea si ya `cobrada`)**: si `RESERVA.liquidacion_status = 'cobrada'`
  (el cobro ya fue registrado), un nuevo intento de registrar cobro se **rechaza** con el mensaje "La
  liquidación ya está marcada como cobrada"; **no se crea ningún PAGO adicional**. (Fuente: `US-029
  §Intento de doble cobro`.)
- **Precondición de estado `pendiente` (bloquea)**: si `RESERVA.liquidacion_status = 'pendiente'` (la
  factura de liquidación aún no fue enviada, US-028 no ejecutada), el sistema **bloquea** la acción con
  el mensaje "La factura de liquidación debe estar enviada antes de registrar su cobro". (Fuente:
  `US-029 §liquidacion_status = pendiente`.)
- **Reglas de validación**: solo se puede registrar cobro si `RESERVA.liquidacion_status = 'facturada'`;
  `PAGO.fecha_cobro` debe ser una fecha válida **≤ hoy** (no futura); `PAGO.importe` debe ser **> 0**;
  `FACTURA.estado` solo pasa a `cobrada` cuando se crea el `PAGO` correspondiente (en la misma
  transacción). (Fuente: `US-029 §Reglas de Validación`.)

## Impact

- Specs: **modifica la capability `facturacion`** (ADDED requirements para: registro del cobro de la
  liquidación con creación de `PAGO`, la transición atómica `FACTURA(liquidacion).estado: enviada →
  cobrada` + `RESERVA.liquidacion_status: facturada → cobrada`, el justificante opcional como `DOCUMENTO
  (tipo = justificante_pago)`, la alerta de discrepancia de importe que NO bloquea, la guarda contra
  doble cobro, la precondición de estado `facturada` que bloquea desde `pendiente`, y las validaciones
  de `fecha_cobro ≤ hoy` e `importe > 0`). El ciclo de vida previo de FACTURA (`borrador → enviada`,
  numeración, desglose) y `liquidacion_status: pendiente → facturada` se **reutilizan** de los
  requisitos ya vivos (US-022/US-027/US-028) sin redefinirlos.
- Contrato OpenAPI (`docs/api-spec.yml`): se prevé **añadir** un endpoint de acción de cobro sobre la
  factura de liquidación de la reserva —`POST /reservas/{id}/facturas/liquidacion/cobro`— (ver `design.md
  §D-4`, input para la fase de contrato). El `contract-engineer` (post-gate) lo definirá; **no se toca
  `docs/api-spec.yml` en este change de spec**. No se edita el cliente generado a mano.
- Código (implementación posterior, fuera de este change de spec):
  `apps/api/src/facturacion/{domain,application,infrastructure,interface}/**` (entidad/puerto `PAGO`,
  use-case `RegistrarCobroLiquidacion` con la transición atómica estado↔PAGO, validaciones de dominio
  puro `fecha_cobro ≤ hoy` / `importe > 0`, detección de discrepancia, guarda de doble cobro y
  precondición de estado, AUDIT_LOG), reutilización de `DOCUMENTO` para el justificante. Frontend
  **fuera del alcance de este change** (ver anti-scope). La ubicación exacta se fija en `design.md`.
- **Migración**: **prevista, aditiva**. Se crea la tabla `PAGO` (`id_pago`, `factura_id` FK,
  `importe DECIMAL(10,2)`, `fecha_cobro DATE`, `justificante_doc_id` FK nullable → DOCUMENTO,
  `fecha_creacion`), con la relación `FACTURA 1—N PAGO` y `DOCUMENTO 1—0..1 PAGO`. Los enums
  `FACTURA.estado = cobrada` y `RESERVA.liquidacion_status = cobrada` **ya existen** en el modelo (no
  requieren migración). `DOCUMENTO.tipo = justificante_pago` **ya existe** en el enum. Si el desarrollo
  detectara que la tabla PAGO ya está en el schema Prisma, se omite la migración.
- Trazabilidad: **US-029**, **UC-21** (pasos 7–10); entidades PAGO, DOCUMENTO, FACTURA, RESERVA,
  AUDIT_LOG.
- Dependencias (todas archivadas en `master`): **US-028** (`liquidacion_status = facturada`,
  `FACTURA(liquidacion).estado = enviada` = punto de partida), **US-022/US-027** (agregado FACTURA,
  ciclo de vida), US-003+ (AUDIT_LOG), US-024/US-019 (entidad DOCUMENTO polimórfica ya usada para otros
  tipos).

## Lo que NO entra (anti-scope)

- **Integración con Stripe o pasarela de pago**: **lista negra 📐** del MVP. El pago es por
  transferencia bancaria externa; Slotify solo **registra** el justificante, no cobra. (Fuente: `US-029
  §Notas de alcance`.)
- **Recordatorio automático T-1d sin cobro** (FA-01 de UC-21, "alerta crítica al gestor"): **lista negra
  📐** del MVP (recordatorios de cobro automáticos). La política de liquidación tardía queda hardcoded
  como "Negociable"; **no** hay lógica automática de penalización. (Fuente: `US-029 §Notas de alcance`.)
- **Cobro de la fianza** (`fianza_status → cobrada`, `devuelta`, `retenida_parcial`): US posterior. Este
  change cubre **solo** el cobro de la **liquidación**.
- **Transición a `evento_en_curso`** (US-031): este change **solo deja** `liquidacion_status = cobrada`
  como una de las tres precondiciones; **NO** implementa la guarda de transición ni las otras dos
  precondiciones (`pre_evento_status = cerrado`, `fianza_status = cobrada`).
- **Adjuntar el justificante en un momento posterior al registro del cobro** (edición del PAGO para
  añadir `justificante_doc_id` a posteriori): la US lo menciona como posibilidad ("el gestor puede
  adjuntar el justificante en cualquier momento posterior"), pero su endpoint de actualización se difiere
  a una US posterior; este change cubre el registro del cobro con justificante opcional **en el momento
  del registro**.
- **Retroceso de `liquidacion_status` de `cobrada` a `facturada`** (anulación de cobro): no modelado en
  MVP.
- **Frontend / UI del registro de cobro**: fuera del alcance de este change (talla S de backend +
  contrato). El E2E de Playwright (`step-N+3`) por tanto **no aplica** salvo que el gate decida incluir
  UI.

## Decisiones de alcance pendientes de aprobación humana

Las decisiones de diseño están **razonadas con recomendación** en `design.md` y quedan **abiertas hasta
el OK del Gate SDD**. En particular:
- **D-1**: **modelado de PAGO** — tabla nueva conciliada contra FACTURA; `1—N` (previendo cobros
  parciales futuros) vs. `1—1` en MVP; `tenant_id` en PAGO (RLS) vs. derivado de FACTURA.
- **D-2**: **transición atómica estado↔PAGO** — creación del PAGO y `FACTURA.estado = cobrada` +
  `liquidacion_status = cobrada` en una única `$transaction`; guarda contra doble cobro dentro de la
  transacción (idempotencia) vs. constraint de BD.
- **D-3**: **discrepancia de importe** — alerta informativa que NO bloquea; se devuelve en la respuesta
  y se registra en AUDIT_LOG; el PAGO se crea con el importe real.
- **D-4**: **contrato** — endpoint `POST /reservas/{id}/facturas/liquidacion/cobro` con `multipart`
  (justificante opcional) vs. `justificante_doc_id` ya subido; body `{ importe, fecha_cobro,
  justificante_doc_id? }`.
- **D-5**: **justificante como DOCUMENTO** — reuso de la entidad polimórfica con `tipo =
  justificante_pago`; subida de archivo vs. referencia a documento ya existente.

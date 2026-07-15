# Design — condiciones-particulares-e3-us023 (US-023)

Decisiones técnicas no triviales de la rebanada incremental de US-023. Cada decisión cita el
código vivo que la fundamenta. **D-condiciones-bloqueante (GAP 2) es una decisión CERRADA/APROBADA
por el humano en el gate SDD**: endurecer las condiciones como requisito duro (revierte la
concesión tolerante de 6.4b).

## Grounding del código actual (verificado)

- **Envío E3 vivo**: `apps/api/src/facturacion/application/enviar-factura-senal.use-case.ts`
  (cabecera "US-023 / UC-18"): dentro de UNA tx (`tx + RLS`, reintento `P2002`) genera/omite el
  adjunto de condiciones (`GenerarPdfCondicionesPort.generar(...).catch(() => null)`), **envía E3
  DENTRO de la tx** por el adaptador directo `EnviarE3EmisionAdapter`
  (`infrastructure/emision-email.adapter.ts`, `EnviarEmailPort`, propaga); si E3 falla → rollback
  total; tras confirmar E3 pasa `FACTURA(senal) borrador → enviada`, fija
  `RESERVA.cond_part_enviadas_fecha = now()` y `cond_part_firmadas = false`, crea COMUNICACION E3
  `enviado` y AUDIT_LOG. **NO persiste ninguna fila `DOCUMENTO` de condiciones.**
- **Endpoint vivo**: `POST /reservas/:id/facturas/senal/enviar` en `factura.controller.ts`
  (`@Roles('gestor')`, 200/404/409/502).
- **PDF condiciones**: `GenerarPdfCondicionesPort.generar({ tenantId }) => string | null`
  (`PdfCondicionesRealAdapter`, clave fija `condiciones/{tenantId}.pdf`; degrada a `null` si el
  tenant no tiene config/secciones). Almacén durable `AlmacenDocumentosPort`.
- **Espejo del reenvío (E4)**: `apps/api/src/facturacion/application/reenviar-liquidacion.use-case.ts`
  + `POST /reservas/:id/facturas/liquidacion/reenviar` en el controller: crea una NUEVA
  `COMUNICACION` (`codigoEmail='E4'`, `estado='enviado'`) por cada reenvío reutilizando el PDF ya
  emitido; NO reasigna número ni cambia estados; NO expone puertos de emisión/renumeración.
- **Modelo de datos** (`schema.prisma`, verificado): `Documento`
  (`tipo/reservaId/tenantId/url/mimeType/nombreArchivo/tamanoBytes/fechaCreacion`); enum
  `TipoDocumento` incluye `condiciones_particulares`; RESERVA `cond_part_enviadas_fecha`,
  `cond_part_firmadas`, `cond_part_firmadas_fecha`; `COMUNICACION.esReenvio` (default false) +
  índice UNIQUE parcial `(reserva_id, codigo_email) WHERE reserva_id IS NOT NULL AND es_reenvio =
  false`. **Ninguna migración en este change.**

---

## D-persistencia-documento (GAP 1) — Persistir la fila DOCUMENTO de condiciones

**Decisión: se persiste **un único** `DOCUMENTO` `tipo='condiciones_particulares'` por reserva,
DENTRO de la tx atómica del envío E3, vía un puerto de dominio nuevo, e idempotente por reserva.**

- **Puerto de dominio (capability `documentos`)**: `DocumentoRepositoryPort` (nombre a fijar en
  implementación) con, como mínimo:
  - `buscarPorReservaYTipo({ reservaId, tenantId, tipo }): Documento | null` — para idempotencia.
  - `crear({ reservaId, tenantId, tipo, url, mimeType, nombreArchivo?, tamanoBytes? }): Documento`.
  El puerto es **tx-bound**: la firma acepta/usa la unidad de trabajo (tx) del envío E3 para
  consolidarse o revertir con el resto. Hexagonal: el use-case depende solo del puerto inyectado;
  Prisma queda en el adaptador (`infrastructure/`), nunca en dominio (hook `no-infra-in-domain`).
- **Adaptador Prisma**: `DocumentoPrismaAdapter` sobre `tx.documento` (create/findFirst), con RLS
  del tenant activo. `url` = la URL que devuelve `GenerarPdfCondicionesPort` (clave
  `condiciones/{tenantId}.pdf`); `mime_type='application/pdf'`.
- **Idempotencia**: antes de crear, `buscarPorReservaYTipo`. Si existe → se **reutiliza** (no se
  crea otra fila; no se registra un segundo AUDIT_LOG `crear`). Si no existe → se crea + AUDIT_LOG
  `accion='crear'` para el DOCUMENTO. Esto cubre US-023 §Reglas de Validación ("solo un DOCUMENTO
  de condiciones por reserva; si existe, se reutiliza en reenvíos") y evita duplicados en el
  reenvío (GAP 3).
- **Atomicidad**: la creación del DOCUMENTO se **integra en la tx existente** del
  `EnviarFacturaSenalUseCase` (paso posterior al éxito confirmado de E3, junto a la transición de
  factura y la actualización de RESERVA). Si E3 falla → rollback total, incluida la fila DOCUMENTO.
  **No se rompe la atomicidad actual**: se añade una escritura más a la misma unidad de trabajo.
- **Orden dentro de la tx** (extiende el orden de 6.4b): guardas → obtener PDF de condiciones
  (ver D-condiciones-bloqueante) → **envío E3 síncrono (propaga si falla)** → factura
  `borrador → enviada` + RESERVA `cond_part_*` + **crear/reutilizar DOCUMENTO** + COMUNICACION E3
  + AUDIT_LOG (`FACTURA actualizar`, `RESERVA actualizar`, `DOCUMENTO crear`).

**Multi-tenancy/RLS**: `DOCUMENTO.tenant_id` = tenant activo del JWT; el adaptador opera bajo la
sesión RLS de la tx. La búsqueda de idempotencia filtra por `tenant_id` (no se ven documentos de
otro tenant). **Máquina de estados**: no cambia; la reserva sigue en `reserva_confirmada`; el
DOCUMENTO es un efecto lateral trazado, no una transición.

**Alternativa descartada**: persistir el DOCUMENTO en un paso post-commit separado (fuera de la
tx). Rechazada porque rompería la garantía "todo o nada" y podría dejar un DOCUMENTO sin E3 o E3
sin DOCUMENTO, contradiciendo la trazabilidad exigida por la US.

---

## D-condiciones-bloqueante (GAP 2) — DECISIÓN CERRADA/APROBADA: ENDURECER (revierte 6.4b)

**Estado.** Decisión **CERRADA y APROBADA por el humano en el gate SDD**: las condiciones pasan a
ser **requisito duro** del envío E3 (se endurece, se revierte la concesión tolerante de 6.4b). Se
mantiene registrada abajo la **tensión histórica** con 6.4b `§D-adjunto-condiciones` como contexto,
pero la decisión ya está tomada; no queda nada pendiente de validar.

**Tensión (contexto histórico).** 6.4b `design.md §D-adjunto-condiciones` + spec-delta `documentos` decidieron que el
fallo/degradación a `null` de las condiciones **NO tumba** E3: el adjunto se **omite** y E3 se
envía solo con la factura de señal (`condPartAdjuntada=false`), trazando en AUDIT_LOG. **US-023
§Condiciones particulares del tenant no configuradas dice lo CONTRARIO**: si no hay condiciones,
**no se genera DOCUMENTO, no se envía E3**, la reserva permanece sin `cond_part_enviadas_fecha` y
el gestor recibe la alerta "Configura las condiciones particulares del espacio para poder enviar E3".

**Decisión (aprobada en el gate SDD):** para US-023 las **condiciones pasan a ser requisito
duro** del envío E3.

- La obtención del PDF de condiciones deja de ser `.catch(() => null)` tolerante y pasa a ser una
  **guarda**: si `GenerarPdfCondicionesPort.generar` devuelve `null` (tenant sin config/sin
  secciones) → el use-case **aborta** con un **error de negocio** (p. ej.
  `CondicionesNoConfiguradasError`, mapeado a 409 con `codigo = CONDICIONES_NO_CONFIGURADAS`) y
  **rollback total**: no se genera DOCUMENTO, no se envía E3, la factura permanece en `borrador`,
  `cond_part_enviadas_fecha` sigue nulo. El mensaje al gestor es la alerta de la US.
- Un **fallo transitorio de render/subida** (excepción, p. ej. flakiness ESM de react-pdf) se
  trata como error **recuperable** (502 `EMISION_ENVIO_FALLIDO` o equivalente reintentable),
  también con rollback — coherente con el trato del PDF de la señal ausente en 6.4b.
- Esto **alinea** el comportamiento con: (a) la US (condiciones imprescindibles), (b) el GAP 1
  (no tiene sentido persistir un DOCUMENTO de condiciones si no hay condiciones), y (c) la
  trazabilidad contractual del email.

**Por qué se endurece y no se mantiene 6.4b.** El adjunto de condiciones es el **contrato**
del evento; enviar E3 sin él entrega al cliente una factura pagada sin el documento vinculante,
que es justo el dolor D1/D3 que la US quiere evitar. La degradación de 6.4b era una concesión de
esa rebanada; US-023, como dueña del flujo de condiciones, la revierte de forma explícita.

**Impacto en las specs.** Esto **MODIFICA** el requisito de 6.4b "El fallo del adjunto de
condicions particulars no tumba el envío confirmado de E3" (capability `documentos`) — el
spec-delta lo recoge como `MODIFIED`. El campo de respuesta `condPartAdjuntada` deja de poder ser
`false` en un 200 (si no hay condiciones, no hay 200): pasa a ser siempre `true` en el camino feliz.

**Alternativa descartada (mantener 6.4b).** Se evaluó mantener 6.4b (condiciones opcionales) y
limitar US-023 al GAP 1 (persistir DOCUMENTO solo cuando el PDF exista) + GAP 3. **Descartada por
el humano en el gate SDD**: se opta por endurecer, por lo que el spec-delta de `documentos` SÍ
lleva el `MODIFIED` y `condPartAdjuntada` nunca puede ser `false` en un 200.

> **DECISIÓN CERRADA (gate SDD superado):** el humano aprobó **endurecer** las condiciones como
> requisito duro. La implementación procede con este criterio; ya no hay nada pendiente de validar
> en este punto.

---

## D-reenvio-e3 (GAP 3) — Caso de uso y endpoint dedicados de reenvío

**Decisión: un `ReenviarE3UseCase` + endpoint `POST /reservas/{id}/facturas/senal/reenviar`
dedicados (espejo literal de `ReenviarLiquidacionUseCase` / `.../liquidacion/reenviar`), que
NO reutilizan el endpoint "enviar señal".**

- **Precondición**: debe existir E3 ya enviado previamente para la reserva (COMUNICACION E3
  `enviado`, `es_reenvio=false`) y la factura de señal `enviada`; si no → error (no hay nada que
  reenviar; `E3_NO_ENVIADO_PREVIAMENTE` 409 o `FACTURA_SENAL_NO_ENCONTRADA` 404 según el caso).
- **Efecto**: crea una **nueva** `COMUNICACION` `codigo_email='E3'`, `estado='enviado'`,
  `es_reenvio=true`, `fecha_envio=now()`. Al ir con `es_reenvio=true` **esquiva el índice UNIQUE
  parcial** (que solo aplica a `es_reenvio=false`), por lo que no colisiona (`P2002`) con el E3
  original ni entre reenvíos. **Reutiliza los documentos existentes**: el PDF de la factura de
  señal ya emitido y el `DOCUMENTO` de condiciones ya persistido (GAP 1) — **NO regenera ni
  duplica** DOCUMENTO. Actualiza `RESERVA.cond_part_enviadas_fecha = now()` (nuevo timestamp).
  Registra AUDIT_LOG del reenvío.
- **No muta**: `FACTURA` (ni número ni estado), ni el resto de status de la RESERVA, ni el
  `DOCUMENTO` (se reutiliza tal cual). Espejo exacto de la garantía de `ReenviarLiquidacionUseCase`.
- **Envío**: por el mismo adaptador directo `EnviarEmailPort` (`codigo_email='E3'`). Si el
  proveedor falla → propaga → rollback del reenvío (no se crea la COMUNICACION de reenvío ni se
  actualiza `cond_part_enviadas_fecha`). Coherente con la atomicidad del primer envío.
- **Endpoint**: `POST /reservas/{id}/facturas/senal/reenviar`, `@Roles('gestor')`,
  `@HttpCode(200)`, cuerpo vacío `{}`. Errores: 404 `FACTURA_SENAL_NO_ENCONTRADA`; 409
  `E3_NO_ENVIADO_PREVIAMENTE`; 502 `EMISION_ENVIO_FALLIDO`. **Contrato nuevo → contract-engineer.**

**Relación con la idempotencia de 6.4b.** El re-disparo de `.../senal/enviar` sigue devolviendo
409 `E3_YA_ENVIADO` (no cambia). El reenvío intencionado es una **acción distinta y explícita**
(`.../senal/reenviar`), exactamente como E4 separa "aprobar-enviar" de "reenviar". Esto **MODIFICA**
el requisito de 6.4b que dejaba el reenvío "fuera de alcance" (capabilities `facturacion` y
`comunicaciones`): ahora el reenvío tiene su requisito propio.

**Multi-tenancy/RLS**: el use-case carga la reserva bajo RLS (404 cross-tenant). **Máquina de
estados**: el reenvío no transiciona la reserva (permanece en su estado); solo actualiza
`cond_part_enviadas_fecha` y añade una COMUNICACION.

**Alternativa descartada**: reutilizar `.../senal/enviar` con un flag `?reenviar=true`. Rechazada
por divergir del patrón vivo de E4 (endpoint dedicado) y por mezclar dos semánticas (emitir vs
reenviar) en una sola ruta, complicando las guardas.

---

## Atomicidad — resumen

**Primer envío (extiende 6.4b, GAP 1 + GAP 2):** una unidad de trabajo `tx + RLS`, reintento
`P2002`:
1. Guardas (existencia factura, estado enviable, idempotencia E3, PDF señal presente).
2. **Obtener PDF de condiciones — GUARDA (D-condiciones-bloqueante):** si `null` → abortar
   (`CondicionesNoConfiguradasError`, rollback). (GAP 2 aprobado en el gate SDD: endurecer.)
3. **Enviar E3 síncrono por el puerto directo**; si falla → rollback total.
4. Solo tras confirmar E3: factura `borrador → enviada`; `RESERVA.cond_part_enviadas_fecha =
   now()`, `cond_part_firmadas = false`; **crear/reutilizar `DOCUMENTO` condiciones (GAP 1)**;
   COMUNICACION E3 `enviado`; AUDIT_LOG (`FACTURA actualizar`, `RESERVA actualizar`,
   `DOCUMENTO crear`).

**Reenvío (GAP 3):** reenvío síncrono, **espejo exacto del patrón E4 `reenviar-liquidacion` ya
aceptado**: precondición → se **envía E3 (`es_reenvio`) PRIMERO** por el puerto directo; si el
proveedor falla → error recuperable (502/503) y **NO** se registra la COMUNICACION ni se actualiza
`cond_part_enviadas_fecha` (no hay estado parcial en BD que revertir, porque el único efecto externo
—el email— ocurre antes de tocar BD). Solo **tras confirmar** el envío se crea la nueva COMUNICACION
`es_reenvio=true`, se actualiza `cond_part_enviadas_fecha = now()` y se audita (AUDIT_LOG). Estos
escritos post-envío **NO forman una única tx conjunta** (misma semántica que el reenvío de
liquidación ya aceptado): van en transacciones separadas por adaptador. **Sin** re-emitir factura ni
regenerar/duplicar DOCUMENTO.

## Hexagonal / guardrails

- El dominio (`DocumentoRepositoryPort`, `ReenviarE3UseCase`, `EnviarFacturaSenalUseCase`) NO
  importa Prisma ni `@nestjs/*` (hook `no-infra-in-domain`). Adaptadores en `infrastructure/`.
- **Sin locks distribuidos** (CLAUDE.md §Regla crítica): idempotencia por UNIQUE parcial + reintento
  `P2002`, nunca Redis/Redlock (hook `no-distributed-lock`).
- El cliente HTTP del frontend se **regenera** desde el contrato; nunca se edita a mano
  (hook `protect-generated-client`).

# Design — us-028-enviar-factura-liquidacion-cliente

> Decisiones técnicas no triviales. Abiertas hasta el **Gate SDD**. El punto más delicado es
> **D-1** (atomicidad estado↔email E4), que **invierte** el patrón post-commit de US-045.

## Contexto y reuso (qué NO se recrea)

- **`facturacion` (US-022 + US-027)**: agregado FACTURA; estados `borrador`/`enviada`;
  numeración `F-YYYY-NNNN` secuencial y única por `tenant_id`+año vía
  `UNIQUE(tenant_id, numero_factura)` + reintento aplicativo ante `P2002` (sin locks
  distribuidos); desglose fiscal en dominio puro (`base = round(total/1,21, 2)`, `iva = total −
  base`); PDF post-commit reutilizando el puerto/adaptador de US-014; aprobación por el Gestor
  (`borrador → enviada` + `fecha_emision`). US-027 dejó las FACTURA `liquidacion` y `fianza` en
  `borrador` con `numero_factura = NULL`.
- **`comunicaciones` (US-045)**: motor de email; `COMUNICACION` con `estado`/`fecha_envio`
  coherentes; idempotencia `(reserva_id, codigo_email)` (índice UNIQUE parcial); **interfaz de
  adjuntos por referencia a `pdf_url`** que verifica que el PDF existe antes de enviar; modo
  fake en `test`/CI; catálogo con **E4 declarada** (diseñada/inactiva).
- **RESERVA**: `liquidacion_status` (`pendiente` → **`facturada`**), `fianza_status`
  (`pendiente` → **`recibo_enviado`**), `importe_liquidacion` (congelado en US-021, ajustable
  aquí solo por descuento negociado).
- **RESERVA_EXTRA**: `factura_id` nullable; se marca al emitir.
- **AUDIT_LOG**.

## D-1 — Punto de enganche transaccional: atomicidad estado↔email E4 (INVIERTE el patrón post-commit)

**Problema.** US-045/US-014/US-008 establecieron el patrón "**el email es post-commit y su
fallo NO revierte el estado**" (E2/E6/E7). La US-028 exige lo **contrario**: *"la transición de
estado y el envío de E4 son atómicos: si el email falla, los estados no se actualizan"* y *"si
el email falla, se hace rollback de los cambios de estado"* (`§Reglas de negocio`, `§Fallo en
la generación del PDF o en el envío del email`). No es una contradicción con US-045: es un
**modo de disparo distinto del mismo motor** (envío síncrono con confirmación, no fire-and-forget).

**Opciones.**
- **(A) Envío síncrono dentro del alcance transaccional de la emisión** (recomendada): el
  use-case abre la UoW, prepara/verifica los PDFs adjuntos (ambos `pdf_url` existentes), llama
  al motor de email E4 de forma **síncrona esperando la confirmación del proveedor**, y **solo
  si E4 se confirma** hace commit de: `numero_factura` asignado, `estado = 'enviada'` (ambas
  facturas), `liquidacion_status = 'facturada'`, `fianza_status = 'recibo_enviado'`, marcado de
  `RESERVA_EXTRA`, `COMUNICACION` E4 `enviado`, `AUDIT_LOG`. Si E4 falla → rollback total:
  nada cambia, sin `numero_factura`, todo sigue en `borrador`/`pendiente`, error recuperable.
  - *Matiz de la numeración*: el `numero_factura` se **asigna en la emisión** y se consolida
    solo al commit; ante `P2002` (colisión de número por otra emisión concurrente del mismo
    tenant) se reintenta con el siguiente número (reuso de US-022) **antes** del envío o dentro
    del reintento del use-case, de modo que un número "quemado" por un envío fallido no deja
    huecos consolidados (se asigna en el intento que finalmente commitea).
- **(B) Compensación post-commit** (transaccional local + saga): commit del estado y, si E4
  falla, transacción compensatoria que revierte. Más frágil (ventana de inconsistencia) y peor
  encaje con "los estados no se actualizan". Descartada salvo indicación humana.

**Recomendación**: **(A)**. El envío E4 es **bloqueante y confirmado**; el motor de US-045 se
invoca en su **modo síncrono con verificación de adjuntos**; en `test`/CI el transporte es
**fake** (confirmación simulada, sin red). Se documenta explícitamente que esta atomicidad es
la **excepción justificada** al patrón post-commit de US-045 (US-028 lo exige).

**Riesgo a validar en el gate**: mantener una llamada de red (proveedor de email) dentro del
alcance transaccional. Mitigación: la transacción de BD es corta; la verificación de adjuntos
y el render se hacen antes de tocar estados; el commit ocurre tras la confirmación del
proveedor. Si el humano prefiere no tener red en la transacción, se adopta un patrón
"reservar-número + enviar + commit-de-consolidación" con el borrador intacto hasta la
confirmación (variante de A sin `$transaction` abierta durante la llamada de red).

## D-2 — Descuento negociado (ajuste de importe antes de aprobar)

- El ajuste se realiza **mientras la factura está en `borrador`** (editor de borrador). Al
  aplicar un descuento (o corregir extras), se recalcula el `total` y el sistema **reutiliza el
  desglose fiscal de dominio puro de US-022** (`base = round(total/1,21, 2)`, `iva = total −
  base`) — NO se duplica lógica de IVA.
- Al emitir con descuento: `FACTURA.total` = nuevo total; `RESERVA.importe_liquidacion` se
  **actualiza** con el nuevo importe; el **descuento** (importe/motivo) queda en `AUDIT_LOG`
  (`accion = 'actualizar'`, `datos_anteriores`/`datos_nuevos` del total).
- Ejemplo del AC: 4.100 € − 200 € = 3.900 € ⇒ base `round(3900/1,21,2) = 3.223,14 €`,
  `iva = 3900 − 3223,14 = 676,86 €`.
- El descuento es **manual del Gestor**; no hay recálculo de tarifa ni de porcentaje.

## D-3 — Envío separado del recibo de fianza (email manual, sin código E)

- Endpoint/acción independiente: envía al cliente **solo** el recibo de fianza adjunto.
- Efectos: `FACTURA (fianza).estado = 'enviada'`, `RESERVA.fianza_status = 'recibo_enviado'`;
  `RESERVA.liquidacion_status` **no cambia**.
- El envío se registra en `COMUNICACION` con `codigo_email = 'manual'` (enum de US-045 admite
  `manual`), **NO** `E4`. Al ser `manual` sin `reserva_id`-únicoE4, no colisiona con la
  idempotencia `(reserva_id, codigo_email)` de E4.
- Interacción con E4 posterior: si la fianza ya fue enviada por separado, el posterior E4 (al
  aprobar la liquidación) incluye **solo** la factura de liquidación (la fianza ya está
  `enviada`/`recibo_enviado`); E4 no vuelve a cambiar `fianza_status`.

## D-4 — Reenvío de una factura ya enviada

- Precondición: `FACTURA (liquidacion).estado = 'enviada'`.
- Reenvía el **PDF ya emitido** (no regenera contenido fiscal ni reasigna nada): `numero_factura`
  y `estado` **intactos**; RESERVA sin cambios de status.
- Crea un **nuevo** registro `COMUNICACION` con `codigo_email = 'E4'`, `estado = 'enviado'`.
  Esto **relaja** la idempotencia `(reserva_id, codigo_email)` de US-045 para el caso de
  reenvío explícito: se documenta como excepción (reenvío manual del Gestor genera una nueva
  fila de comunicación / traza; alternativamente, un `COMUNICACION` con marca de reenvío). La
  decisión concreta (nueva fila vs. contador de reenvíos) se fija en el gate; recomendación:
  **nueva fila** por trazabilidad de cada envío.

## D-5 — Contrato OpenAPI (SÍ toca API → activar contract-engineer tras el gate)

Endpoints previstos (nombres a fijar por `contract-engineer`):
- `POST /reservas/{id}/facturas/liquidacion/aprobar-enviar` — body opcional
  `{ descuento?: number, extrasCorregidos?: [...] , motivo?: string }`; emite + envía E4;
  devuelve la factura emitida (`numero_factura`, `estado = 'enviada'`, total/desglose) y el
  estado actualizado de la reserva. Errores: `409` si no está en `borrador`; `422` datos
  fiscales/PDF; `502/503` fallo de PDF/email (recuperable, sin cambios de estado); `404`; `401`.
- `POST /reservas/{id}/facturas/fianza/enviar` — envío separado del recibo de fianza (email
  manual). Devuelve `fianza_status = 'recibo_enviado'`.
- `POST /reservas/{id}/facturas/liquidacion/reenviar` — reenvío de la factura ya emitida
  (`409` si no está `enviada`).
- La `GET` de facturas de la reserva (US-027) se **reutiliza** para reflejar `numero_factura`,
  `estado` y los status de la reserva tras la emisión.
- No se edita el cliente generado a mano; el SDK se regenera desde el contrato.

## D-6 — Numeración en la emisión (nunca en borrador)

- `numero_factura` se asigna **solo al emitir** (US-028), reutilizando la numeración de US-022:
  `F-YYYY-NNNN` reiniciada por año, secuencial y única por `tenant_id`+año; colisión concurrente
  resuelta por `UNIQUE(tenant_id, numero_factura)` + reintento aplicativo (`P2002`), **nunca**
  con locks distribuidos.
- El recibo de fianza (`tipo = 'fianza'`) también recibe su `numero_factura` al pasar a
  `enviada` (por E4 o por envío separado), coherente con la numeración de facturas emitidas.
  Confirmar en el gate si la fianza lleva número propio o el mismo criterio de emisión (recom.:
  número propio secuencial, igual que cualquier FACTURA emitida).

## Firmas previstas de casos de uso (dominio/aplicación)

```ts
// application — atomicidad estado↔E4 (D-1, opción A)
type AprobarYEnviarLiquidacionInput = {
  reservaId: string;
  tenantId: string;
  ajuste?: { descuento?: number; extrasCorregidos?: ExtraCorreccion[]; motivo?: string };
};
type AprobarYEnviarLiquidacionResult = {
  liquidacion: Factura;            // estado 'enviada', numero_factura F-YYYY-NNNN
  fianza: Factura | null;          // 'enviada' si aplicaba y no se envió por separado
  liquidacionStatus: 'facturada';
  fianzaStatus: 'recibo_enviado';
  comunicacionE4: Comunicacion;    // estado 'enviado'
};
const aprobarYEnviarLiquidacion:
  (deps: AprobarYEnviarDeps) => (i: AprobarYEnviarLiquidacionInput)
    => Promise<AprobarYEnviarLiquidacionResult>;

const enviarReciboFianzaSeparado:
  (deps) => (i: { reservaId; tenantId }) => Promise<{ fianza: Factura; fianzaStatus: 'recibo_enviado' }>;

const reenviarLiquidacion:
  (deps) => (i: { reservaId; tenantId }) => Promise<{ comunicacion: Comunicacion }>;

// domain puro — reuso del desglose de US-022 con el total ajustado
const aplicarDescuentoLiquidacion:
  (borrador: FacturaLiquidacion, descuento: number) => FacturaLiquidacion; // recalcula total + desglose
```

`AprobarYEnviarDeps` incluye: puerto de FACTURA (repo + numeración de US-022), puerto de RESERVA
(status + importe_liquidacion), puerto de RESERVA_EXTRA (marcar factura_id), **puerto del motor
de email de US-045 en modo síncrono/confirmado con adjuntos**, puerto de PDF (US-014), UoW/
transacción, reloj, AUDIT_LOG. El dominio **no** importa infraestructura (hexagonal).

## Guardrails que aplican

- **Hexagonal**: dominio puro para descuento/desglose; puertos en dominio, adaptadores en infra.
- **Bloqueo/numeración sin locks distribuidos**: numeración por `UNIQUE` + reintento `P2002`.
- **Multi-tenancy/RLS**: `tenant_id` en toda mutación; numeración por tenant+año.
- **Motor de email de US-045**: E4 se cablea reutilizando el motor; en `test`/CI, transporte
  fake (sin red). La atomicidad síncrona (D-1) es la excepción documentada al post-commit.
- **Frontend mobile-first** (390/768/1280); cliente HTTP generado, nunca editado a mano.

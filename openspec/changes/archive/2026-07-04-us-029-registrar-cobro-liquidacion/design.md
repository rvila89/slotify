# Design — us-029-registrar-cobro-liquidacion

> Decisiones técnicas no triviales. Abiertas hasta el **Gate SDD**. El punto más delicado es
> **D-2** (atomicidad estado↔PAGO + guarda contra doble cobro concurrente).

## Contexto y reuso (qué NO se recrea)

- **`facturacion` (US-022 + US-027 + US-028)**: agregado FACTURA con ciclo `borrador → enviada →
  cobrada`; `estado` ya admite `cobrada` en el enum (`er-diagram.md §286`). US-028 dejó la
  liquidación en `enviada` con `numero_factura` asignado y `RESERVA.liquidacion_status = 'facturada'`.
  Este change añade la fase de **cobro**.
- **`PAGO` (`er-diagram.md §3.13`, `§293`)**: ya modelada en el diagrama con
  `id_pago`, `factura_id`, `importe DECIMAL(10,2)`, `fecha_cobro DATE`, `justificante_doc_id`
  (FK nullable → DOCUMENTO), `fecha_creacion`; relaciones `FACTURA ||--o{ PAGO : "concilia"` y
  `DOCUMENTO ||--o| PAGO : "justifica"`. Se **materializa** su tabla (migración aditiva).
- **`DOCUMENTO` polimórfica (`er-diagram.md §3.15`, `§326`)**: `tipo` ya incluye `justificante_pago`;
  el justificante de cobro reutiliza esta entidad. No se crea modelo de documento nuevo.
- **`RESERVA.liquidacion_status`**: enum ya incluye `cobrada` (`pendiente | facturada | cobrada`,
  `er-diagram.md §163`, `§489`). Se avanza a `cobrada`; no se añaden estados.
- **AUDIT_LOG (US-003+)**: `accion = 'crear'` (PAGO/DOCUMENTO), `accion = 'actualizar'` (transición
  de FACTURA y RESERVA).

## D-1 — Modelado de PAGO (materializar la tabla)

**Estructura** (siguiendo `er-diagram.md §3.13`):
`PAGO { id_pago PK, factura_id FK → FACTURA, importe DECIMAL(10,2), fecha_cobro DATE,
justificante_doc_id FK nullable → DOCUMENTO, fecha_creacion TIMESTAMP DEFAULT now() }`.

- **Cardinalidad**: `FACTURA 1 — N PAGO` en el modelo ER (`||--o{`), previendo cobros parciales
  futuros. **En el MVP de US-029 hay a lo sumo un cobro por liquidación**: la guarda de doble cobro
  (D-2) impide un segundo PAGO mientras `liquidacion_status = 'cobrada'`. Recomendación: **no** añadir
  `UNIQUE(factura_id)` a nivel de BD (rompería cobros parciales futuros); la unicidad de cobro en MVP la
  garantiza la guarda de estado (`liquidacion_status`) dentro de la transacción. **A validar en el gate**:
  si se prefiere blindar con `UNIQUE(factura_id)` en MVP y relajarlo en la US de cobros parciales.
- **`tenant_id` en PAGO (RLS)**: `PAGO` en `er-diagram.md §3.13` NO lista `tenant_id` explícito (se
  deriva de `FACTURA.tenant_id`). Recomendación: **añadir `tenant_id` a PAGO** por coherencia con la
  regla dura de multi-tenancy/RLS del proyecto ("`tenant_id` en toda tabla de negocio", CLAUDE.md), y
  filtrarlo en toda query. **A validar en el gate**: aceptar `tenant_id` en PAGO (recomendado) vs.
  derivarlo por join a FACTURA. Si se acepta, es una desviación menor y aditiva sobre el ER que se
  documentará en `docs-keeper`.
- El `PAGO` **no** lleva desglose fiscal propio: es un registro de conciliación de cobro contra la
  factura ya emitida, cuyo desglose fiscal (base/IVA) es inmutable desde la emisión (US-028).

## D-2 — Atomicidad estado↔PAGO y guarda contra doble cobro concurrente

**Problema.** El registro del cobro debe crear el `PAGO`, opcionalmente el `DOCUMENTO`, y transicionar
`FACTURA.estado = 'cobrada'` + `RESERVA.liquidacion_status = 'cobrada'` de forma **atómica** (nada a
medias), y **evitar el doble cobro** incluso ante dos peticiones concurrentes del mismo Gestor.

**Opciones.**
- **(A) `$transaction` con relectura del estado dentro de la transacción** (recomendada): el use-case
  abre una `$transaction`, **relee** `RESERVA.liquidacion_status` (y `FACTURA.estado`) dentro de la
  transacción; si ya es `cobrada`, aborta con error de doble cobro (409) y **no** crea PAGO; si es
  `facturada`, crea el `DOCUMENTO` (si hay justificante) + el `PAGO`, y actualiza `FACTURA.estado =
  'cobrada'` + `RESERVA.liquidacion_status = 'cobrada'` + AUDIT_LOG, todo en el mismo commit. La guarda
  de estado dentro de la transacción, combinada con el aislamiento del motor, evita el doble cobro. Para
  blindar la carrera exacta (dos transacciones que leen `facturada` a la vez), se usa
  `SELECT ... FOR UPDATE` sobre la fila de RESERVA (o de FACTURA) al releer el estado, serializando las
  dos transacciones: la segunda ve `cobrada` y aborta. **Sin locks distribuidos** (regla dura del
  proyecto): es un lock de fila del propio PostgreSQL, coherente con el patrón `SELECT ... FOR UPDATE`
  del bloqueo de fecha.
- **(B) Constraint `UNIQUE(factura_id)` en PAGO**: la segunda inserción falla por `P2002`. Descartada
  como mecanismo principal porque colisiona con los cobros parciales futuros (D-1); se puede sumar como
  red de seguridad, pero la guarda de estado (A) es la fuente de verdad del "ya cobrada".

**Recomendación**: **(A)** con `SELECT ... FOR UPDATE` sobre RESERVA al releer `liquidacion_status`
dentro de la `$transaction`. Es coherente con el patrón de bloqueo del proyecto (lock de fila
PostgreSQL, jamás Redis/Redlock) y con la máquina de estados como estructura de datos. **A validar en el
gate**: FOR UPDATE sobre RESERVA vs. sobre FACTURA (recom.: RESERVA, que es el agregado raíz y quien
porta `liquidacion_status`).

**Precondición de estado** (validación previa, dentro de la transacción):
- `liquidacion_status = 'pendiente'` → **bloquea** (409): "La factura de liquidación debe estar enviada
  antes de registrar su cobro".
- `liquidacion_status = 'cobrada'` → **bloquea** (409, doble cobro): "La liquidación ya está marcada
  como cobrada".
- `liquidacion_status = 'facturada'` → **procede**.

## D-3 — Discrepancia de importe (alerta, NO bloquea)

- Al registrar el cobro, si `importe !== FACTURA(liquidacion).total`, el sistema **crea igualmente** el
  `PAGO` con el `importe` real introducido y **avanza a `cobrada`**; NO bloquea.
- La respuesta incluye una **alerta informativa de discrepancia** (p. ej. `alertaDiscrepancia:
  { importeFacturado, importeCobrado, diferencia }`) para que el frontend/Gestor la muestre.
- La discrepancia queda registrada en `AUDIT_LOG` (junto al `accion = 'crear'` del PAGO), con el importe
  facturado y el cobrado.
- **Decisión**: la conciliación de la diferencia se **delega al Gestor**; el MVP no ajusta la factura ni
  genera nota de crédito (fuera de alcance).

## D-4 — Contrato OpenAPI (SÍ toca API → activar contract-engineer tras el gate)

Endpoint previsto (nombre a fijar por `contract-engineer`):
- `POST /reservas/{id}/facturas/liquidacion/cobro`
  - Body `{ importe: number (> 0), fecha_cobro: string (date, ≤ hoy), justificante_doc_id?: string }`.
  - Devuelve el `PAGO` creado, la `FACTURA` actualizada (`estado = 'cobrada'`), el
    `liquidacion_status = 'cobrada'` de la reserva y, si la hubo, la `alertaDiscrepancia`.
  - Errores: `409` doble cobro (`liquidacion_status` ya `cobrada`); `409`/`422` precondición no
    cumplida (`liquidacion_status = 'pendiente'`); `422` validación (`importe ≤ 0`, `fecha_cobro`
    futura o inválida); `404` reserva/factura inexistente; `401` sin auth.
- **Justificante**: dos variantes a decidir en el gate — (a) el archivo se sube antes por el flujo de
  documentos existente y aquí se pasa `justificante_doc_id`; (b) `multipart/form-data` con el archivo
  adjunto en la misma petición, creando el `DOCUMENTO` en el use-case. **Recomendación**: (a) para MVP
  (menos superficie; reutiliza el flujo de subida de DOCUMENTO ya existente), con `justificante_doc_id`
  opcional en el body. **A validar en el gate.**
- La `GET /reservas/{id}/facturas` (US-027) se **reutiliza** para reflejar `FACTURA.estado = 'cobrada'`
  tras el cobro. No se edita el cliente generado a mano; el SDK se regenera desde el contrato.

## D-5 — Justificante como DOCUMENTO (tipo = justificante_pago)

- El justificante se almacena como `DOCUMENTO` con `tipo = 'justificante_pago'`, `reserva_id` de la
  reserva, `tenant_id` correcto, y los metadatos de archivo (`url`, `mime_type`, `nombre_archivo`,
  `tamano_bytes`). Su `id_documento` se referencia desde `PAGO.justificante_doc_id`.
- **Opcional**: si el Gestor no adjunta justificante, `PAGO.justificante_doc_id = NULL` y el cobro es
  igualmente válido (avanza a `cobrada`).
- Reuso de la entidad polimórfica ya viva (US-024/US-019 la usan para DNI y condiciones particulares);
  este change añade el uso del `tipo = justificante_pago` sin cambiar el modelo de DOCUMENTO.

## Firmas previstas de casos de uso (dominio/aplicación)

```ts
// application — transición atómica estado↔PAGO (D-2, opción A)
type RegistrarCobroLiquidacionInput = {
  reservaId: string;
  tenantId: string;
  importe: number;            // > 0 (validación de dominio)
  fechaCobro: string;         // ISO date, ≤ hoy (validación de dominio)
  justificanteDocId?: string; // opcional
};
type RegistrarCobroLiquidacionResult = {
  pago: Pago;                       // id_pago, factura_id, importe, fecha_cobro, justificante_doc_id?
  facturaLiquidacion: Factura;      // estado 'cobrada'
  liquidacionStatus: 'cobrada';
  alertaDiscrepancia?: {            // presente solo si importe !== factura.total
    importeFacturado: number;
    importeCobrado: number;
    diferencia: number;
  };
};
const registrarCobroLiquidacion:
  (deps: RegistrarCobroDeps) => (i: RegistrarCobroLiquidacionInput)
    => Promise<RegistrarCobroLiquidacionResult>;

// domain puro — validaciones e invariantes del cobro
const validarCobro:
  (i: { importe: number; fechaCobro: Date; hoy: Date }) => void; // lanza si importe<=0 o fechaCobro>hoy
const detectarDiscrepancia:
  (importeCobrado: number, totalFactura: number) => Discrepancia | null;
const puedeRegistrarCobro:
  (liquidacionStatus: 'pendiente' | 'facturada' | 'cobrada') => Resultado; // guarda de precondición
```

`RegistrarCobroDeps` incluye: puerto de FACTURA (repo, transición `enviada → cobrada`), puerto de RESERVA
(lectura con `FOR UPDATE` + transición `liquidacion_status: facturada → cobrada`), puerto de PAGO (crear),
puerto de DOCUMENTO (crear el justificante si aplica), UoW/transacción, reloj (`hoy` para la validación
de `fecha_cobro`), AUDIT_LOG. El dominio **no** importa infraestructura (hexagonal).

## Guardrails que aplican

- **Hexagonal**: validaciones y detección de discrepancia en dominio puro; puertos (PAGO, DOCUMENTO,
  FACTURA, RESERVA) en dominio, adaptadores en infra.
- **Bloqueo sin locks distribuidos**: la guarda de doble cobro usa `SELECT ... FOR UPDATE` de PostgreSQL
  sobre la fila de RESERVA dentro de la `$transaction`; **jamás** Redis/Redlock (regla dura + hook
  `no-distributed-lock`).
- **Multi-tenancy/RLS**: `tenant_id` en toda mutación y query; recomendación de añadir `tenant_id` a
  PAGO (D-1).
- **TDD**: tests primero de la guarda de doble cobro concurrente (`FOR UPDATE`), de la máquina de estados
  del cobro (`facturada → cobrada`, bloqueo desde `pendiente`/`cobrada`) y de las validaciones de dominio
  (`importe > 0`, `fecha_cobro ≤ hoy`) antes de implementar.
- **Migración aditiva**: nueva tabla PAGO; los valores de enum (`estado = cobrada`, `liquidacion_status =
  cobrada`, `tipo = justificante_pago`) ya existen.
- **Cliente HTTP generado, nunca editado a mano**; el SDK se regenera desde el contrato.

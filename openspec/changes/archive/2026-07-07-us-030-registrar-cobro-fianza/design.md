# Design — us-030-registrar-cobro-fianza

> Decisiones técnicas no triviales. Abiertas hasta el **Gate SDD**. Los puntos delicados son
> **D-1** (atomicidad estado↔PAGO + guarda contra doble cobro concurrente, reuso del patrón US-029)
> y **D-2** (política "Negociable": aviso no bloqueante con confirmación explícita para
> `fianza_status = pendiente`, que diverge del bloqueo duro de la liquidación).

## Contexto y reuso (qué NO se recrea)

- **`facturacion` (US-022 + US-027 + US-028 + US-029)**: agregado FACTURA con ciclo `borrador →
  enviada → cobrada`; el **recibo de fianza** ya se genera en borrador (US-027) y se emite (US-028:
  `FACTURA(fianza).estado = 'enviada'`, `RESERVA.fianza_status = 'recibo_enviado'`). La **fase de
  cobro** (entidad PAGO, justificante opcional, transacción atómica `enviada → cobrada` con guarda de
  doble cobro por `SELECT ... FOR UPDATE`) ya fue introducida por **US-029** para la liquidación. Este
  change la **aplica al recibo de fianza**.
- **`PAGO`** (`er-diagram.md §3.13`; tabla ya materializada por US-029, incl. `tenant_id`): se crea un
  `PAGO` con `factura_id = <id recibo fianza>`, `importe`, `fecha_cobro`, `justificante_doc_id?`,
  `tenant_id`. **No se toca el modelo ni la migración**. La cardinalidad `FACTURA 1—N PAGO` sin
  `UNIQUE(factura_id)` (D-1 de US-029) se mantiene; la unicidad de cobro de fianza la garantiza la
  guarda de estado (`fianza_status`) dentro de la transacción.
- **`DOCUMENTO` polimórfica (`er-diagram.md §3.15`)**: `tipo = 'justificante_pago'` ya en uso (US-029);
  el justificante de la fianza reutiliza esta entidad.
- **`RESERVA.fianza_status`**: enum ya incluye `cobrada`. Se avanza `recibo_enviado → cobrada`; no se
  añaden estados.
- **`RESERVA.fianza_eur` / `RESERVA.fianza_cobrada_fecha`**: campos ya modelados; se actualizan en la
  misma transacción del cobro. No se añaden columnas.
- **AUDIT_LOG (US-003+)**: `accion = 'crear'` (PAGO/DOCUMENTO), `accion = 'actualizar'` (transición de
  FACTURA y RESERVA, incluidos `fianza_eur`/`fianza_cobrada_fecha`; y la traza del flujo excepcional
  "Negociable" cuando se cobra sobre `pendiente`).

## D-1 — Atomicidad estado↔PAGO y guarda contra doble cobro concurrente (reuso del patrón US-029)

**Problema.** El registro del cobro de fianza debe crear el `PAGO`, opcionalmente el `DOCUMENTO`, y
transicionar `FACTURA(fianza).estado = 'cobrada'` + `RESERVA.fianza_status = 'cobrada'` + actualizar
`RESERVA.fianza_eur` y `RESERVA.fianza_cobrada_fecha` de forma **atómica** (nada a medias), evitando el
**doble cobro** incluso ante dos peticiones concurrentes.

**Recomendación** (idéntico patrón validado en US-029, opción A): el use-case abre una `$transaction`,
**relee** `RESERVA.fianza_status` (y `FACTURA(fianza).estado`) dentro de la transacción con
`SELECT ... FOR UPDATE` sobre la fila de RESERVA (agregado raíz, portador de `fianza_status`); si ya es
`cobrada`, aborta con error de doble cobro (409) y **no** crea PAGO; si procede, crea el `DOCUMENTO` (si
hay justificante) + el `PAGO`, actualiza `FACTURA(fianza).estado = 'cobrada'` + `fianza_status =
'cobrada'` + `fianza_eur` + `fianza_cobrada_fecha` + AUDIT_LOG, todo en el mismo commit. El bloqueo de
fila del propio PostgreSQL serializa dos transacciones concurrentes: la segunda ve `cobrada` y aborta.
**Sin locks distribuidos** (regla dura + hook `no-distributed-lock`): es el mismo `SELECT ... FOR UPDATE`
del bloqueo de fecha, jamás Redis/Redlock.

**Guarda de precondición** (dentro de la transacción, tras el `FOR UPDATE`):
- `fianza_status = 'cobrada'` → **bloquea** (409, doble cobro): "La fianza ya está marcada como cobrada".
- `fianza_status = 'recibo_enviado'` → **procede** (happy path).
- `fianza_status = 'pendiente'` → **política "Negociable"** (ver D-2): NO bloquea de forma dura.

## D-2 — Política "Negociable": `fianza_status = pendiente` no bloquea (diverge de US-029)

A diferencia de la liquidación (US-029), donde `liquidacion_status = 'pendiente'` **bloqueaba** de forma
dura, la fianza aplica la política **"Negociable"** (hardcoded en el MVP): registrar el cobro con el
recibo aún **no enviado** es un **flujo excepcional permitido**, no un error.

- El sistema **avisa** (no bloquea): "El recibo de fianza no ha sido enviado al cliente. ¿Desea registrar
  el cobro igualmente?".
- Para materializar el aviso en una API sin estado, el registro exige un **flag de confirmación explícita**
  en la petición (recomendado: `confirmarSinRecibo: boolean`). Si `fianza_status = 'pendiente'` y el flag
  **no** viene (o es `false`), el endpoint responde con un aviso/confirmación requerida (**NO** crea PAGO)
  para que el frontend muestre el diálogo; si el Gestor **confirma** (reintento con `confirmarSinRecibo:
  true`), el cobro se registra igualmente avanzando a `cobrada`.
- El flujo excepcional queda **trazado en AUDIT_LOG** (registro del cobro sobre fianza no enviada), para
  auditoría del salto de estado `pendiente → cobrada` sin pasar por `recibo_enviado`.
- **DECISIÓN TOMADA — Gate SDD APROBADO** (ya **no** es pregunta abierta):
  - **(a) Mecanismo del aviso**: flag **`confirmarSinRecibo` en el body** (sin estado de servidor). Sobre
    `fianza_status = 'pendiente'` sin el flag (o `false`) → respuesta "confirmación requerida", **NO** crea
    PAGO; reintento con `confirmarSinRecibo: true` → registra el cobro.
  - **(b) D-2(b) — tratamiento de la FACTURA(fianza) en el salto `pendiente → cobrada`** (RESUELTO):
    - Si la `FACTURA(fianza)` está en **`borrador`** (recibo generado, nunca emitido): el cobro confirmado
      la lleva **DIRECTAMENTE a `cobrada`** (`borrador → cobrada`, sin pasar por `enviada`), documentando
      el **salto de estado** de la FACTURA en `AUDIT_LOG`.
    - Si **NO existe** `FACTURA(fianza)` (fianza omitida por `fianza_default_eur = 0`): se **crea una
      FACTURA(fianza) al vuelo** y se marca directamente **`cobrada`**, con la traza de **creación** en
      `AUDIT_LOG`.
    - En ambos casos, el resto del cobro es idéntico al happy path (PAGO conciliado, `fianza_status =
      'cobrada'`, `fianza_eur`, `fianza_cobrada_fecha`) y la traza del flujo excepcional (cobro sobre
      fianza no enviada) se mantiene.
  - El **Gate SDD quedó aprobado por el humano con esta resolución**; procede la fase de contrato.

## D-3 — Contrato OpenAPI (SÍ toca API → activar contract-engineer tras el gate)

Endpoint previsto (nombre a fijar por `contract-engineer`, análogo a US-029):
- `POST /reservas/{id}/facturas/fianza/cobro`
  - Body `{ importe: number (> 0), fecha_cobro: string (date, ≤ fecha_evento), justificante_doc_id?:
    string, confirmarSinRecibo?: boolean }`.
  - Devuelve el `PAGO` creado, la `FACTURA(fianza)` actualizada (`estado = 'cobrada'`), el
    `fianza_status = 'cobrada'`, `fianza_eur` y `fianza_cobrada_fecha` de la reserva.
  - Errores/avisos: `409` doble cobro (`fianza_status` ya `cobrada`); respuesta de **confirmación
    requerida** cuando `fianza_status = 'pendiente'` sin `confirmarSinRecibo` (política Negociable, NO es
    error 4xx de bloqueo duro — a modelar como respuesta específica o `409` reintentable con el flag);
    `422`/`400` validación (`importe ≤ 0`, `fecha_cobro` futura respecto al evento o inválida); `404`
    reserva/factura/justificante inexistente; `401`/`403` sin auth/rol.
- **Validación de fecha**: `fecha_cobro ≤ RESERVA.fecha_evento` (no `≤ hoy` como en la liquidación de
  US-029, sino relativo al evento). La `fecha_evento` se lee de la RESERVA en el use-case.
- **Justificante**: recomendación (a) — `justificante_doc_id` opcional en el body, referenciando un
  DOCUMENTO ya subido por el flujo de documentos existente. **A validar en el gate.**
- La `GET /reservas/{id}/facturas` (US-027) se **reutiliza** para reflejar `FACTURA(fianza).estado =
  'cobrada'`. El SDK del frontend se **regenera** desde el contrato; nunca se edita a mano.

## D-4 — Frontend (SÍ en alcance → activar frontend-developer; E2E de Playwright aplica)

- **Formulario de registro de cobro de fianza** en la ficha de la reserva (acción del Gestor): campos
  `importe`, `fecha_cobro`, adjuntar justificante (opcional), botón "Registrar cobro de fianza".
- **Aviso "Negociable"**: si `fianza_status = 'pendiente'`, el frontend muestra un **diálogo de
  confirmación** ("El recibo de fianza no ha sido enviado al cliente. ¿Desea registrar el cobro
  igualmente?"); al confirmar, reenvía con `confirmarSinRecibo: true`.
- **Guardas de UI**: si `fianza_status = 'cobrada'`, la acción de cobro se deshabilita/oculta y se
  muestra el estado cobrado (`fianza_eur`, `fianza_cobrada_fecha`).
- **Responsive (regla dura)**: el formulario y el diálogo funcionan mobile-first (390/768/1280),
  siguiendo la estructura por dominio de `apps/web/src/features/reservas/` (o la feature de facturación
  correspondiente); barrel `index.ts`, `max-lines ≤ 300`. **A validar en el gate**: en qué feature vive
  el formulario y si se reutiliza un modal de confirmación existente.
- Al haber frontend, el **step E2E con Playwright (step-N+3) SÍ aplica** (a diferencia de US-029).

## D-5 — Justificante como DOCUMENTO (tipo = justificante_pago)

- El justificante se almacena como `DOCUMENTO` con `tipo = 'justificante_pago'`, `reserva_id`,
  `tenant_id` correcto y metadatos de archivo; su `id_documento` se referencia desde
  `PAGO.justificante_doc_id`.
- **Opcional**: si el Gestor no adjunta justificante (p. ej. efectivo en T-0), `PAGO.justificante_doc_id
  = NULL` y el cobro es igualmente válido (avanza a `cobrada`).
- Reuso de la entidad polimórfica ya viva (US-024/US-019 la usan para DNI/condiciones; US-029 para
  justificantes de liquidación); este change añade el uso del `tipo = justificante_pago` para la fianza
  **sin** cambiar el modelo de DOCUMENTO. El puerto endurecido de US-029 (`buscarJustificante` acotado
  por `tipo` Y `reservaId` Y tenant) se reutiliza.

## Firmas previstas de casos de uso (dominio/aplicación)

```ts
// application — transición atómica estado↔PAGO (D-1, patrón US-029)
type RegistrarCobroFianzaInput = {
  reservaId: string;
  tenantId: string;
  importe: number;              // > 0 (validación de dominio)
  fechaCobro: string;           // ISO date, ≤ fecha_evento (validación de dominio)
  justificanteDocId?: string;   // opcional
  confirmarSinRecibo?: boolean; // política "Negociable" (D-2): confirmación explícita si pendiente
};
type RegistrarCobroFianzaResult = {
  pago: Pago;                       // id_pago, factura_id (recibo fianza), importe, fecha_cobro, justificante_doc_id?
  facturaFianza: Factura;           // estado 'cobrada'
  fianzaStatus: 'cobrada';
  fianzaEur: number;                // = importe cobrado
  fianzaCobradaFecha: string;       // = fecha_cobro
};

const registrarCobroFianza:
  (deps: RegistrarCobroFianzaDeps) => (i: RegistrarCobroFianzaInput)
    => Promise<RegistrarCobroFianzaResult>;

// domain puro — validaciones e invariantes del cobro de fianza
const validarCobroFianza:
  (i: { importe: number; fechaCobro: Date; fechaEvento: Date }) => void; // lanza si importe<=0 o fechaCobro>fechaEvento
const puedeRegistrarCobroFianza:
  (i: { fianzaStatus: 'pendiente' | 'recibo_enviado' | 'cobrada'; confirmarSinRecibo: boolean })
    => Resultado; // 'cobrada' bloquea (doble cobro); 'recibo_enviado' procede;
                  // 'pendiente' requiere confirmarSinRecibo=true (Negociable) o pide confirmación
```

`RegistrarCobroFianzaDeps` incluye: puerto de FACTURA (repo, transición `enviada → cobrada` sobre la
factura de fianza), puerto de RESERVA (lectura con `FOR UPDATE` + transición `fianza_status:
recibo_enviado → cobrada` + set de `fianza_eur`/`fianza_cobrada_fecha`, y lectura de `fecha_evento` para
la validación de fecha), puerto de PAGO (crear, reuso US-029), puerto de DOCUMENTO (buscar/crear el
justificante si aplica, reuso endurecido US-029), UoW/transacción, AUDIT_LOG. El dominio **no** importa
infraestructura (hexagonal).

## Guardrails que aplican

- **Hexagonal**: validaciones y guarda de precondición en dominio puro; puertos (PAGO, DOCUMENTO,
  FACTURA, RESERVA) en dominio, adaptadores en infra. Hook `no-infra-in-domain`.
- **Bloqueo sin locks distribuidos**: la guarda de doble cobro usa `SELECT ... FOR UPDATE` de PostgreSQL
  sobre la fila de RESERVA dentro de la `$transaction`; **jamás** Redis/Redlock (hook
  `no-distributed-lock`).
- **Multi-tenancy/RLS**: `tenant_id` en toda mutación y query (PAGO ya lo lleva desde US-029; DOCUMENTO
  y FACTURA por tenant; RESERVA por tenant).
- **TDD**: tests primero de la guarda de doble cobro concurrente (`FOR UPDATE`), de la máquina de estados
  del cobro de fianza (`recibo_enviado → cobrada`, bloqueo desde `cobrada`, política "Negociable" desde
  `pendiente` con confirmación) y de las validaciones de dominio (`importe > 0`, `fecha_cobro ≤
  fecha_evento`) antes de implementar.
- **Sin migración**: la tabla PAGO y los valores de enum ya existen; los campos `fianza_eur`/
  `fianza_cobrada_fecha` ya están en RESERVA.
- **Arrow-functions** (regla dura ESLint): todo helper/factory/hook/handler como expresión de flecha.
- **Web responsive** (regla dura): el formulario y el diálogo de confirmación mobile-first (390/768/1280).
- **Cliente HTTP generado, nunca editado a mano**; el SDK se regenera desde el contrato.

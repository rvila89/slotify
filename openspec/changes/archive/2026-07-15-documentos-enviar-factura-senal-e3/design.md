# Design — documentos-enviar-factura-senal-e3 (6.4b — Bloque C)

Decisiones técnicas no triviales de la rebanada. Cada decisión está **cerrada**
(no es una pregunta abierta) y cita el código vivo que la fundamenta.

## Grounding del código actual (verificado)

- **Espejo (E4)**: `apps/api/src/facturacion/application/aprobar-y-enviar-liquidacion.use-case.ts`
  — acción manual del Gestor, síncrona y confirmada, atómica estado↔email: carga
  reserva (RLS)→404; unidad de trabajo `tx + RLS` con reintento `P2002`; **envío E4
  DENTRO de la tx** (si falla → `EmisionEnvioFallidoError`, rollback total); solo
  tras confirmar E4 emite la factura (`borrador → enviada`), avanza status, crea
  COMUNICACION E4 y AUDIT_LOG.
- **Ruta E4 (síncrona/confirmada, PROPAGA si falla)**:
  `apps/api/src/facturacion/infrastructure/emision-email.adapter.ts` →
  `EnviarE4EmisionAdapter` usa `EnviarEmailPort` **directo** con `codigoEmail: 'E4'`,
  **NO** pasa por el motor/catálogo. Un fallo del proveedor **propaga**.
- **Ruta E2 (post-commit, idempotente, NO propaga)**:
  `apps/api/src/presupuestos/infrastructure/disparar-e2.adapter.ts` →
  `DispararE2Adapter` usa `DespacharEmailService` (motor + catálogo). El motor
  **traza el fallo en COMUNICACION** (`estado='fallido'`) y **NO lanza excepción**
  (ver cabecera de `despachar-email.service.ts`, paso 8).
- **Factura de señal de partida**:
  `apps/api/src/facturacion/application/generar-factura-senal.use-case.ts` — crea
  `tipo='senal'` en `borrador` + PDF post-commit, idempotente por reserva, concepto
  `Señal reserva {codigo}`. **Nunca se despacha hoy.**
- **Condiciones (patrón vivo de adjunto)**: `GenerarPdfCondicionesPort.generar({tenantId})`
  (`documentos/domain/generar-pdf-condiciones.port.ts`) devuelve `string | null`
  (degrada a `null`). `DispararE2Adapter` lo consume con `.catch(() => null)`.
- **Catálogo**: `apps/api/src/comunicaciones/infrastructure/plantillas/catalogo-plantillas.ts`
  — **E1 ACTIVA**, **E2–E8 inactivas** (`renderInactivo`). Comentario: "E3→US-021/022/023".
- **Controller / rutas vivas**: `apps/api/src/facturacion/interface/factura.controller.ts`
  — `POST reservas/:id/facturas/liquidacion/aprobar-enviar`,
  `POST reservas/:id/facturas/fianza/enviar`, `GET reservas/:id/factura-senal`.
  `@Roles('gestor')`.
- **Estado RESERVA**: `schema.prisma` §RESERVA ya tiene `condPartFirmadas`
  (`cond_part_firmadas`, default false), `condPartEnviadasFecha`
  (`cond_part_enviadas_fecha`), `condPartFirmadasFecha`. Enum `CodigoEmail` incluye
  `E3`. **No hace falta migración.**

---

## D-ruta-email — Cómo se envía E3 (puerto directo vs motor/catálogo)

**Decisión: E3 se envía por `EnviarEmailPort` DIRECTO (espejo literal de E4), NO por
`DespacharEmailService`.** Además, la **plantilla E3 pasa a ACTIVA** en el catálogo,
pero el catálogo solo cubre el registro/consistencia y flujos futuros
automáticos/idempotentes; el **envío atómico de esta acción manual usa el puerto
directo**.

**Por qué (reconciliación de "plantilla E3 ACTIVA" con "envío síncrono/confirmado
con rollback"):**

- El requisito de negocio (espejo de E4, US-023 §Fallo en el envío) exige que si E3
  falla, **nada se consolide** (rollback: factura no pasa a `enviada`,
  `cond_part_enviadas_fecha` no se fija, no hay COMUNICACION `enviado`).
- `DespacharEmailService` (motor + catálogo) **por diseño NO propaga** el fallo del
  proveedor: lo traza como `COMUNICACION.estado='fallido'` y **retorna sin lanzar**
  (paso 8 de su cabecera). Ese contrato es **incompatible** con el rollback: si se
  usara el motor dentro de la tx, el fallo del proveedor no abortaría la tx y la
  factura quedaría `enviada` sin email. Es exactamente el patrón "post-commit, fallo
  no revierte" de E2 — que E3 debe **invertir**, igual que hizo E4.
- Por eso el envío atómico usa `EnviarEmailPort` **directo** (que sí propaga),
  replicando `EnviarE4EmisionAdapter`. El motor/catálogo se reservan para el disparo
  automático post-commit (fuera del alcance de esta acción manual).

**¿Por qué activar entonces la plantilla E3?** El roadmap lo exige y aporta valor:
(1) deja el catálogo coherente (E3 deja de ser `renderInactivo`), (2) permite que el
adaptador directo tome de la plantilla el asunto/cuerpo canónicos (o, como mínimo,
que exista para un futuro disparo por motor sin re-tocar el catálogo). El
`adjuntosRequeridos` de E3 declara la factura de señal como requerida y las
condiciones como opcionales (coherente con §D-adjunto-condiciones).

**Alternativa descartada**: envolver el motor en un modo "propaga" solo para E3.
Rechazada por complejidad y por divergir del patrón ya probado de E4; el espejo
literal minimiza riesgo.

---

## D-guarda-estado — Qué guardas permiten enviar E3

**Decisión: la acción FUNDE "aprobar + enviar" en una sola operación atómica
(espejo de E4), sobre la factura de señal en `borrador`.** No reutiliza el use-case
`aprobar-factura` por separado.

- **Guarda de existencia**: debe existir `FACTURA tipo='senal'` para la reserva; si
  no → `FacturaSenalNoEncontradaError` (404).
- **Guarda de estado enviable**:
  - Si la factura está en **`borrador`** → la acción la emite (`borrador → enviada`,
    fija `fecha_emision` si es null) y envía E3. Es el camino feliz.
  - Si la factura ya está en **`enviada`** → NO es un error de estado *per se*
    (puede ser un reenvío), pero la **idempotencia de E3** (§D-idempotencia) decide:
    si además ya hay COMUNICACION E3 `enviado` → 409 `E3_YA_ENVIADO`; si la factura
    está `enviada` pero **no** hay COMUNICACION E3 (p. ej. un fallo previo de E3 tras
    aprobar por otra vía) → se permite enviar E3 sin re-emitir la factura.
  - Si la factura está en **`rechazada`** → `FacturaSenalNoEnviableError` (409): un
    borrador rechazado no se envía (hay que regenerar/aprobar antes).

> **Corrección post-QA (6.4b):** el estado `rechazada` **no existe** en el enum
> `EstadoFactura` (`borrador | enviada | cobrada`) y el rechazo de US-022 **no
> transiciona** (permanece `borrador`, solo AUDIT_LOG). La guarda `rechazada`→409 queda
> como **defensiva/inalcanzable**; una señal rechazada seguiría siendo enviable. Impedirlo
> exigiría modelar el rechazo con una marca real (fuera de alcance). Ver spec-delta
> `facturacion` §Nota de alcance y el informe de code-review.
- **Guarda de datos**: el envío requiere `factura.pdf_url` no nulo (el PDF de la
  señal es el adjunto imprescindible); si es null → se trata como fallo de emisión
  (`EmisionEnvioFallidoError`, 502, reintentable tras regenerar el PDF), no como
  éxito silencioso. Espejo del "adjunto requerido no disponible" de E4.

**Por qué fundir aprobar+enviar (y no aprobar aparte):** US-023 modela E3 como el
**cierre del hito de confirmación** (factura de señal → `enviada` + envío del
contrato). El espejo de E4 (que hace aprobar+enviar en una sola acción atómica) es
el patrón vivo y garantiza que la factura no quede `enviada` sin que el cliente haya
recibido el email. Nota: existe ya `aprobar-factura.use-case.ts` (aprobación
independiente del borrador de señal, US-022); esta acción es un camino distinto y
explícito ("Enviar factura 40%") — la coexistencia se resuelve con la guarda de
idempotencia (no re-emitir ni duplicar E3 si ya se envió).

---

## D-idempotencia — Qué pasa si E3 ya se envió

**Decisión: idempotencia por existencia de `COMUNICACION` E3 `enviado`; el
re-disparo devuelve 409 `E3_YA_ENVIADO` (no re-envía, no duplica).**

- Antes de enviar, dentro de la tx, se comprueba si existe `COMUNICACION` con
  `reserva_id` = la reserva y `codigo_email = 'E3'` en `estado = 'enviado'`.
- Si existe → `E3YaEnviadoError` (409). **No** se re-envía el email ni se crea una
  segunda COMUNICACION `enviado` ni se regenera el PDF.
- Si existe una COMUNICACION E3 previa en `estado = 'fallido'` (envío anterior que
  falló) → **NO** bloquea: se permite el reenvío (crea/actualiza a `enviado`).

> **Corrección post-QA (6.4b):** este sub-caso **no es reproducible** con el adaptador
> DIRECTO (`§D-ruta-email`): el envío va dentro de la tx con **rollback total**, de modo que
> este flujo **nunca persiste** un `fallido` E3 (solo lo haría el motor
> `DespacharEmailService`, no usado aquí). Además el índice único **parcial**
> `(reserva_id, codigo_email) WHERE reserva_id IS NOT NULL AND es_reenvio = false` haría
> colisionar (`P2002`) un `crear` de reintento sobre un `fallido` preexistente. Si un futuro
> flujo por motor pudiera dejar un `fallido` E3, `crear` debería ser un **upsert** (deuda
> anotada). La lógica de la guarda queda cubierta por el spec unitario con dobles.

**Matiz frente a US-023 §E3 ya enviado (reenvío):** US-023 contempla un **reenvío
manual** desde la ficha que sí crea una nueva COMUNICACION E3. En **6.4b (Bloque C)**
el alcance es el **primer envío** manual con atomicidad (equivalente a
"aprobar+enviar" de E4, que NO reenvía desde borrador). El **reenvío explícito** de
E3 (nueva COMUNICACION sin re-emitir, análogo a `reenviar-liquidacion` de US-028)
queda **fuera de esta rebanada**; si se necesita, será una acción/endpoint aparte.
Por eso aquí el segundo disparo es 409, no un reenvío silencioso. Esta acotación se
declara explícitamente en la spec-delta y evita re-litigar el reenvío ahora.

**Alternativa descartada**: idempotencia silenciosa (200 devolviendo la factura ya
enviada sin re-enviar). Rechazada porque oculta al Gestor que no se ha vuelto a
enviar nada; el 409 explícito es coherente con `FacturaNoBorradorError` (409) de E4
al re-aprobar una factura ya enviada.

---

## D-endpoint — Ruta HTTP

**Decisión: `POST /reservas/{id}/facturas/senal/enviar`** (NO el literal del roadmap
`POST /reservas/{id}/factura-senal/enviar`).

- **Justificación**: alinea con la **convención viva** del controller, que agrupa las
  acciones por `reservas/:id/facturas/{tipo}/{accion}`:
  `reservas/:id/facturas/liquidacion/aprobar-enviar`,
  `reservas/:id/facturas/fianza/enviar`. La ruta `senal/enviar` es el hermano natural
  de `fianza/enviar`. El GET existente `reservas/:id/factura-senal` (guion) es previo
  a esa convención; no se toca para no romper el contrato, pero la **acción nueva**
  sigue la convención `facturas/senal/...`.
- **Verbo/semántica**: `POST` (acción con efectos), `@HttpCode(200)` (como los demás
  `enviar`/`aprobar-enviar`), `@Roles('gestor')`.
- **Request**: cuerpo vacío `{}` (no admite descuento; la señal no se negocia aquí,
  a diferencia de la liquidación).
- **Respuesta 200**: la factura de señal emitida (`FacturaDto`) + `condPartEnviadasFecha`
  (ISO) + `condPartAdjuntada: boolean` (si las condiciones se adjuntaron o degradaron).
- **Errores**: 404 `FACTURA_SENAL_NO_ENCONTRADA`; 409 `FACTURA_SENAL_NO_ENVIABLE` /
  `E3_YA_ENVIADO`; 502 `EMISION_ENVIO_FALLIDO`.

---

## D-adjunto-condiciones — Fallo de condiciones en un envío confirmado

**Decisión: el fallo (o degradación a `null`) de las condicions particulars NO tumba
el envío de E3; el adjunto simplemente se omite.** La factura de señal es el único
adjunto **imprescindible**.

- Se llama `GenerarPdfCondicionesPort.generar({ tenantId }).catch(() => null)` (mismo
  criterio defensivo que `DispararE2Adapter`). Si devuelve `null` (sin config/sin
  secciones) o **lanza** (fallo de render/subida react-pdf, p. ej. la flakiness ESM),
  se **omite** el adjunto de condiciones y E3 se envía **solo con la factura de
  señal**.
- **Diferencia con E2**: en E2 (post-commit) el fallo de *cualquier* adjunto se traga
  porque la pre_reserva ya está commiteada. En **E3 (confirmado/rollback)** el fallo
  del adjunto **de la factura** (PDF de señal nulo) **SÍ** tumba el envío (§D-guarda-estado:
  502), pero el fallo del adjunto **de condiciones** NO — porque el contrato de
  condicions es deseable pero no bloquea la entrega de la factura pagada, y su
  ausencia es un estado de negocio conocido (tenant sin condiciones configuradas,
  6.4a §D3). La respuesta expone `condPartAdjuntada: false` para trazarlo.
- **Trazabilidad**: cuando las condiciones se omiten, se registra en `AUDIT_LOG`
  (`datos_nuevos.condPartAdjuntada = false`) para que el Gestor sepa que el cliente
  no recibió el contrato y pueda configurarlo/reenviarlo (coherente con US-023
  §Condiciones no configuradas → alerta al gestor).

**Alternativa descartada**: tumbar E3 si faltan condiciones (rollback total).
Rechazada porque penalizaría el envío de la factura por un documento opcional y
divergiría del comportamiento de 6.4a (degrada a `null` sin romper).

---

## D-num — Reintento de numeración `P2002`

**Decisión: se conserva el bucle de reintento `P2002` del espejo E4**, aunque la
factura de señal normalmente ya trae su `F-YYYY-NNNN` de US-022.

- El use-case NO re-numera si la factura ya tiene `numero_factura` (solo emite estado
  y `fecha_emision`). El reintento `P2002` cubre el caso defensivo de un borrador aún
  sin número (si en un flujo futuro se enviara antes de que US-022 numerara), y
  mantiene el patrón homogéneo con E4. **Nunca** locks distribuidos (CLAUDE.md
  §Regla crítica).

---

## Atomicidad — resumen (espejo de US-028 §D-1)

Dentro de UNA unidad de trabajo (`tx + RLS`):

1. Guardas (existencia, estado enviable, idempotencia E3, PDF de señal presente).
2. Genera/omite adjunto de condiciones (`.catch(() => null)`).
3. **Envía E3 síncrono por el puerto directo**. Si falla → `EmisionEnvioFallidoError`
   → la tx **revierte** (rollback total).
4. Solo tras confirmar E3: factura `borrador → enviada` (+ `fecha_emision`),
   `RESERVA.cond_part_enviadas_fecha = now()`, `cond_part_firmadas = false`,
   COMUNICACION E3 `enviado`, AUDIT_LOG (`FACTURA` actualizar + `RESERVA` actualizar).

Hexagonal: el use-case depende SOLO de puertos inyectados; no importa Prisma ni
`@nestjs/*` (hook `no-infra-in-domain`).

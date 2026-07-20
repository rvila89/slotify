# Change: presupuesto-edicion-reenvio-email-real

## Why

Corrección funcional y de UX sobre **US-015 — Editar y Reenviar Presupuesto en
Pre-reserva** (Área: Pre-reserva y Presupuestos; Módulo M4; UC-15), ya archivada
(`2026-07-15-us-015-editar-reenviar-presupuesto-prereserva`). En producción el flujo
de edición/reenvío del presupuesto tiene **tres defectos** que rompen la promesa de la
US (D8 — sustituir el Excel externo; visibilidad del pipeline D2):

1. **El correo "presupuesto actualizado" NUNCA se envía de verdad (crítico).** La US-015
   registra la `COMUNICACION` E2 (`es_reenvio=true`, `estado='enviado'`) en la
   transacción, pero **el proveedor de email no se invoca**. El cliente cree que envió
   la versión revisada y el destinatario no recibe nada — regresión silenciosa que la
   contabilidad de `COMUNICACION` enmascara.
2. **El diálogo de edición sale sin prefill.** Los campos "nº de invitados" y "duración"
   aparecen vacíos/por defecto pese a existir ya en la RESERVA, obligando al gestor a
   re-teclear datos y arriesgando ediciones erróneas.
3. **El banner de éxito queda fuera de vista.** Tras "Enviar al cliente" el diálogo se
   cierra pero no hay scroll-to-top, así que el gestor no ve la confirmación (a
   diferencia del flujo de generar presupuesto de US-014).

Además, el **reenvío sin cambios** comparte el defecto crítico por otra vía: su
adaptador es un **stub** que no llama al motor de email.

Esta historia parte del estado de US-015 (archivada), US-045 (motor de email
`DespacharEmailService`) y US-014 (email E2). **No** reimplementa el tarifario, el
versionado del presupuesto ni el motor de email: solo corrige el **cableado del envío
real**, la **marca de edición** de la plantilla E2 y dos detalles de **UX** del
frontend. (Fuente: `US-015`; UC-15; US-045; US-014.)

## What Changes

Se **MODIFICA** la capability **`presupuestos`** (specs vivas de US-015) para exigir
**envío real** del correo en edición y reenvío, y **marca de edición** en el email E2.

### Backend — la parte crítica

- **Envío real por `despacharReenvio` (no por `despachar` idempotente ni por el stub).**
  - CAUSA RAÍZ verificada: el `EditarPresupuestoUseCase` está cableado al adaptador
    idempotente `DispararE2Adapter` (`presupuestos.module.ts` token `DISPARAR_E2_PORT`).
    En edición, `DespacharEmailService.despachar()` encuentra el E2 original
    (`es_reenvio=false`) por el índice UNIQUE parcial `(reserva_id, codigo_email)` y
    devuelve `motivo:'idempotente'` → **el proveedor nunca se invoca**. La fila que sí
    se escribe en la transacción (`registrarE2Reenvio`) solo marca `estado='enviado'`
    en BD (contabilidad, no envío real).
  - CAUSA RAÍZ verificada del reenvío sin cambios: `ReenviarE2PresupuestoAdapter.reenviar`
    es un **stub** (`reenviar-presupuesto.prisma.adapter.ts`, `void this.motorEmail;`)
    que no llama al motor.
  - Solución: enrutar el envío por `DespacharEmailService.despacharReenvio()` (ya
    existe: salta la idempotencia, crea fila `es_reenvio=true` y SÍ envía por
    `enviarYFinalizar`), tanto en **edición con envío** como en **reenvío sin cambios**.
  - Reconciliar el **doble registro** de `COMUNICACION`: hoy la tx persiste una fila
    (`registrarE2Reenvio`) y `despacharReenvio` crearía otra. Fuente única = el motor
    post-commit. Ver `design.md` D1.
  - Semántica **best-effort post-commit**: un fallo del proveedor NO revierte la versión
    ya comprometida (queda `COMUNICACION.estado='fallido'`, reintentable por reenvío).
- **Marca de edición en la plantilla E2** (`catalogo-plantillas.ts`, `renderE2`/
  `renderE2Ca`): se pasa una variable `esEdicion`. Cuando es `true`:
  - **Asunto ES**: «Hemos actualizado tu presupuesto para el evento (reserva {codigoReserva})».
  - **Asunto CA**: «Hem actualitzat el teu pressupost per a l'esdeveniment (reserva {codigoReserva})».
  - **Párrafo inicial** tras el saludo (ES): «Hemos actualizado el presupuesto que te
    enviamos con los cambios solicitados. Te adjuntamos la versión revisada.» (CA
    equivalente).
  - El resto del texto de marca del tenant (pago 40%, transferencia "Canoliart, SL" /
    concepto "Masia l'Encís", condiciones particulares, firma Ari) se mantiene idéntico.
  - `variablesRequeridas` de E2/E2-CA permanecen `['nombre', 'codigoReserva']`
    (`esEdicion` es opcional, default `false`).

### Frontend — UX

- **Prefill**: el diálogo de edición pre-rellena "nº de invitados" con
  `reserva.numAdultosNinosMayores4` (el campo que el editor escribe) y "duración" con
  `reserva.duracionHoras` acotada al enum `{4, 8, 12}` (fallback `4`).
- **Scroll al enviar**: tras confirmar edición o reenvío sin cambios, el diálogo se
  cierra y la vista hace scroll-to-top para dejar visible el banner de éxito (mismo
  patrón que el flujo de generar presupuesto de US-014).

### Entidades tocadas

- `COMUNICACION`: **una única** fila E2 por envío/reenvío (`es_reenvio=true`,
  `estado ∈ {'enviado','fallido'}`), escrita por el motor post-commit; se **elimina/
  ajusta** el `registrarE2Reenvio` de la transacción para no duplicar. Sin cambio de
  esquema.
- `PRESUPUESTO`, `RESERVA_EXTRA`, `RESERVA`, `FECHA_BLOQUEADA`, `AUDIT_LOG`: **sin
  cambios** respecto de US-015 (mismas invariantes: la edición no muta `RESERVA.estado`
  ni `ttl_expiracion`).

**Sin migración de esquema.**

### Trazabilidad

- **US**: mejora/corrección de `US-015` (§Happy Path, §Sin cambios — reenvío,
  §Email relacionado). Identidad del cambio = nombre del change
  (`presupuesto-edicion-reenvio-email-real`); no se crea un número de US nuevo.
- **UC**: UC-15 (editar/reenviar presupuesto en pre_reserva).
- **ER**: `er-diagram §3.11 PRESUPUESTO`, `§COMUNICACION`.
- **Depende de**: US-015 (archivada), US-045 (motor de email, archivada), US-014
  (E2, archivada).

## Impact

- **Specs afectadas**: `openspec/specs/presupuestos/spec.md` — **MODIFIED** de dos
  requisitos vivos de US-015 (envío E2 en edición; reenvío sin cambios), para exigir
  **envío real** vía `despacharReenvio` y **fila única** de `COMUNICACION`; **ADDED**
  de un requisito nuevo para la **marca de edición** del email E2 (asunto + párrafo,
  ES/CA).
- **Contrato OpenAPI — SIN cambios.** Los endpoints `/presupuesto/edicion` y
  `/presupuesto/reenvio` y el flag `enviar` ya existen; `esEdicion` se **deriva en el
  servidor** (es edición cuando el envío proviene de `EditarPresupuestoUseCase`), no
  entra por el body. **No** se proponen endpoints nuevos. Decisión abierta: si la
  reconciliación de la fila de `COMUNICACION` obliga a ajustar la proyección
  `EdicionPresupuestoResponse.comunicacion`, se marca en `design.md` D1 y lo cierra
  `contract-engineer` tras el gate (posible ajuste no rompedor de la respuesta HTTP).
- **Código (post-gate, fuera de este SDD)**:
  - Backend: re-cableado del envío en edición y reenvío a `despacharReenvio`;
    propagación de `esEdicion` (use-case → adaptador de disparo → `DespacharEmailComando`
    / `construirVariables` → `render`); reconciliación de la fila de `COMUNICACION`;
    ampliación de `renderE2`/`renderE2Ca`.
  - Frontend: prefill del diálogo de edición y scroll-to-top al enviar/reenviar.
- **Frontend E2E** aplica (edición y reenvío desde la ficha de pre_reserva; 3 viewports).
- **Decisiones que requieren visto bueno humano** (ver `design.md`): **D1** fuente única
  de la fila `COMUNICACION` (post-commit vs tx) + impacto en `EdicionPresupuestoResponse`;
  **D2** propagación de `esEdicion`; **D3** prefill de invitados/duración en frontend.

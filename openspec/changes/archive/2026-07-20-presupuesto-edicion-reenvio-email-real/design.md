# Design — presupuesto-edicion-reenvio-email-real

> Decisiones técnicas no triviales de la corrección de envío/UX de la edición y reenvío
> de presupuesto (mejora de US-015). **Gate SDD APROBADO** (2026-07-20): D1/D2/D3
> resueltas por el humano con las recomendaciones (ver cada sección y la tabla final).

## Contexto verificado en el código (worktree)

- `EditarPresupuestoUseCase` (US-015) está inyectado con el adaptador **idempotente**
  `DispararE2Adapter` vía el token `DISPARAR_E2_PORT` en `presupuestos.module.ts`.
- `DespacharEmailService` (US-045) tiene DOS caminos:
  - `despachar(comando)` — idempotente: si existe la `COMUNICACION` E2 original
    (`es_reenvio=false`) por el índice UNIQUE parcial `(reserva_id, codigo_email) WHERE
    es_reenvio=false`, devuelve `{ comunicacion: existente, motivo: 'idempotente' }`
    **sin invocar el proveedor**.
  - `despacharReenvio(...)` — **salta la idempotencia**, resuelve idioma/variables/
    adjuntos igual que `despachar`, crea fila `es_reenvio=true` y SÍ envía por el único
    camino real `enviarYFinalizar` (deja `estado ∈ {'enviado','fallido'}`).
- La fila que hoy escribe la edición en la transacción proviene de `registrarE2Reenvio`
  (marca `estado='enviado'` en BD, sin transporte real).
- `ReenviarE2PresupuestoAdapter.reenviar` es un **stub**: hace `void this.motorEmail;`
  y retorna sin llamar al motor (`reenviar-presupuesto.prisma.adapter.ts`).
- Plantillas E2: `renderE2` (ES) y `renderE2Ca` (CA) en `catalogo-plantillas.ts`.
  Hoy el asunto es «Tu presupuesto para el evento (reserva {codigoReserva})» /
  «El teu pressupost per a l'esdeveniment (reserva {codigoReserva})»; el primer párrafo
  es el saludo «Hola {nombre},». `variablesRequeridas: ['nombre', 'codigoReserva']`.
- Frontend: el diálogo de edición y el flujo de generar presupuesto viven en
  `apps/web/src/features/reservas/` (ficha de pre_reserva). El editor escribe
  `numAdultosNinosMayores4` (no `numInvitadosFinal`) — ver memoria "aforo/personas es
  campo derivado".

## D1 — Fuente ÚNICA de la fila COMUNICACION + envío real ✅ RESUELTA (Opción A + respuesta optimista)

**Problema.** Si enrutamos el envío por `despacharReenvio` **sin** tocar la transacción,
tendremos **dos** filas `COMUNICACION` E2 (`es_reenvio=true`) por cada envío: la de
`registrarE2Reenvio` (tx, contable) y la del motor post-commit (real). Doble registro
= contabilidad inflada y ambigüedad de cuál refleja el envío real.

**Opciones.**
- **Opción A (recomendada):** **fuente única = el motor post-commit.** `despacharReenvio`
  persiste la fila real (asunto/cuerpo renderizados, `estado ∈ {'enviado','fallido'}`,
  `es_reenvio=true`) tras el commit de la versión. Se **elimina/ajusta** el
  `registrarE2Reenvio` de la transacción para no duplicar. La creación de la versión y
  el registro del `AUDIT_LOG` (`accion='actualizar'`) siguen en la tx; **solo** la fila
  de `COMUNICACION` pasa a escribirla el motor.
- **Opción B:** mantener la fila contable en la tx y que `despacharReenvio` **actualice**
  esa misma fila (patch `estado` + cuerpo) en vez de crear una nueva. Menos
  reescritura, pero acopla el motor a un id preexistente y complica el idioma/render.

**Recomendación:** Opción A (fuente única post-commit).

**Semántica de fallo.** Best-effort **post-commit**: la versión del PRESUPUESTO ya está
comprometida; si el proveedor falla, la fila queda `estado='fallido'` y el 201/200 NO
se revierte (reenviable). Igual que el disparo E2 post-commit de US-014/US-015.

**Impacto en el contrato (decisión abierta, la cierra `contract-engineer` post-gate).**
`EdicionPresupuestoResponse` hoy puede proyectar `comunicacion` desde la fila de la tx.
Si esa fila desaparece (Opción A), la respuesta HTTP se emite **antes** del envío
post-commit, así que la proyección debe reflejar el **encolado** (p. ej.
`comunicacion` con `estado='enviado'` optimista o el estado de la fila creada por el
motor si se espera al post-commit). **No** se cierra aquí: se marca como ajuste posible
y **no rompedor** de la respuesta (mismo shape); si obligara a cambiar el shape, se
eleva de nuevo. **No** hay endpoints nuevos.

**DECISIÓN DEL HUMANO (2026-07-20):** (a) **Opción A** — fuente única post-commit;
`despacharReenvio` escribe la única fila `COMUNICACION`, se elimina el `registrarE2Reenvio`
de la tx. (b) La respuesta HTTP proyecta `comunicacion` con **estado optimista `enviado`**
al confirmar la versión (el estado real fallido queda auditado en la fila `COMUNICACION`
post-commit). **Contrato sin cambios** (mismo shape); no interviene `contract-engineer`.

**CORRECCIÓN (2026-07-20, hallazgo de QA):** la premisa "el PDF vigente viaja por
referencia (`pdf_url`)" era **FALSA**: el módulo de presupuestos **nunca persistía**
`presupuesto.pdf_url` (a diferencia de facturación, que sí lo hace con `guardarPdfUrl`).
El PDF generado post-commit solo se usaba de forma transitoria para el adjunto del E2.
Consecuencia: el **reenvío sin cambios** leía `vigente.pdfUrl = null` → sin adjunto → el
motor **BLOQUEABA** el E2 (`adjunto_no_disponible`) → reenvío no enviaba. **Fix aprobado
(Opción A "persistir pdf_url"):** tras generar el PDF post-commit en **generar** y
**editar**, se guarda la URL en la fila del PRESUPUESTO (best-effort, no bloqueante,
patrón `guardarPdfUrl` de facturación). Así el reenvío reutiliza el PDF guardado y se
cierra el hueco latente. La EDICIÓN ya funcionaba porque pasa el PDF recién generado
en memoria (no desde BD).

## D2 — Propagación de `esEdicion` hasta el render ✅ RESUELTA (server-side; reenvío sin marca)

**Problema.** La plantilla E2 debe cambiar asunto + párrafo inicial **solo** cuando el
disparo proviene de una **edición** (no del envío original de US-014 ni de un reenvío
"sin cambios" que no es edición). `esEdicion` debe llegar hasta `renderE2`/`renderE2Ca`.

**Decisión de diseño.**
1. `esEdicion` se **deriva en servidor**, NO entra por el body ni por el contrato: es
   `true` cuando el envío lo dispara `EditarPresupuestoUseCase` (edición con envío) y
   `false` en el resto.
2. Ruta de propagación: use-case → adaptador de disparo (el que hoy es
   `DispararE2Adapter`, ahora llamando a `despacharReenvio`) → `DespacharEmailComando`
   (nuevo flag opcional `esEdicion?: boolean`, default `false`) → `construirVariables`
   (inyecta `esEdicion` en el mapa de variables) → `render(variables)`.
3. `renderE2`/`renderE2Ca` leen `variables.esEdicion`; si `true` cambian **asunto** y
   **anteponen el párrafo** tras el saludo; si `false`/ausente, comportamiento actual
   intacto.
4. `variablesRequeridas` se mantiene `['nombre', 'codigoReserva']` (`esEdicion` NO es
   requerida; su ausencia = no-edición).

**DECISIÓN DEL HUMANO (2026-07-20):** (a) confirmada la propagación **server-side** de
`esEdicion`; (b) el **reenvío sin cambios usa texto E2 estándar SIN marca** de edición
(solo la edición con cambios dispara asunto/párrafo «actualizado»).

## D3 — Prefill de invitados/duración en el frontend ✅ RESUELTA (confirmada)

**Problema.** El diálogo de edición sale con "nº de invitados" y "duración" vacíos/por
defecto pese a existir en la RESERVA.

**Decisión de diseño.**
1. **Invitados**: prefill con `reserva.numAdultosNinosMayores4` — el mismo campo que el
   editor **escribe** (no `numInvitadosFinal`, que es derivado; ver memoria
   "aforo/personas es campo derivado" para no repetir el bug del `___`).
2. **Duración**: prefill con `reserva.duracionHoras` **acotada** al enum `{4, 8, 12}`;
   si el valor no pertenece al enum o es `null`, **fallback `4`**.
3. **Scroll al enviar**: al confirmar edición o reenvío sin cambios, cerrar diálogo y
   `scroll-to-top` para dejar visible el banner de éxito (reutilizar el patrón vivo del
   flujo de generar presupuesto de US-014, no inventar uno nuevo).
4. Responsive (regla dura): el diálogo y el banner funcionan en 390 / 768 / 1280 sin
   overflow (se verifica en QA E2E).

**DECISIÓN DEL HUMANO (2026-07-20):** confirmada. Prefill = `numAdultosNinosMayores4` +
`duracionHoras` (acotada {4,8,12}, fallback 4); scroll-to-top = patrón de generar presupuesto.

## D4 — Alcance sin migración / sin contrato nuevo

- **Sin migración de esquema.** Solo cambia el **cableado** (qué método del motor se
  llama), el **render** de E2 y la **UX**. `COMUNICACION` no cambia de columnas; el
  índice UNIQUE parcial ya soporta `es_reenvio=true`.
- **Sin endpoints nuevos.** `/presupuesto/edicion`, `/presupuesto/reenvio` y `enviar` ya
  existen. El único posible toque de contrato es la proyección `comunicacion` de la
  respuesta (D1), no rompedor.

## D5 — Hexagonal / guardas / bloqueo atómico

- El adaptador de disparo sigue en `infrastructure/`; el use-case depende solo de
  puertos (hook `no-infra-in-domain`). `renderE2`/`renderE2Ca` son funciones puras del
  catálogo (arrow functions, regla dura).
- **No** se introduce Redis/locks distribuidos (no aplica; no se toca el bloqueo atómico
  de fecha). La edición **no** muta `FECHA_BLOQUEADA` (invariante heredada de US-015).
- El envío es **post-commit best-effort**: un fallo del proveedor no revierte la versión
  ni el `AUDIT_LOG` (idéntica semántica que US-014/US-015).

## Resumen de decisiones al gate ✅ APROBADAS (2026-07-20)

| ID | Decisión | Resolución aprobada |
|----|----------|----------------------------|
| D1 | Fuente de la fila `COMUNICACION` + `EdicionPresupuestoResponse` | Fuente única **post-commit** (`despacharReenvio`); **eliminar `registrarE2Reenvio` de la tx**; respuesta HTTP proyecta `comunicacion` con **estado optimista `enviado`**; **contrato sin cambios** |
| D2 | Propagación de `esEdicion` + reenvío sin cambios | `esEdicion` **derivado en servidor**, propagado hasta `render`; **reenvío sin cambios SIN marca** (E2 estándar) |
| D3 | Prefill frontend + scroll | Invitados = `numAdultosNinosMayores4`; duración = `duracionHoras` acotada {4,8,12} fallback 4; scroll = patrón de generar presupuesto |

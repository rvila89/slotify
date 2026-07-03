# Design — us-014-generar-presupuesto-activar-prereserva

> Decisiones técnicas para la **generación del presupuesto y la activación de la
> pre-reserva** (US-014 / UC-14), el **nodo de mayor complejidad del camino feliz** (XL,
> concurrencia crítica, tipo Spine). Todo se apoya en código real ya en `master`; se
> prioriza **DRY + hexagonal** y la garantía de **atomicidad** de la transacción que
> coordina PRESUPUESTO + RESERVA + FECHA_BLOQUEADA + vaciado de cola + AUDIT_LOG en el motor
> PostgreSQL. Este documento es el corazón del **Gate de revisión humana SDD**: las
> decisiones quedan abiertas a tu OK antes de tocar contrato/TDD/código. En especial **D-1**
> (nueva capability/módulo), **D-3** (insert-o-update del bloqueo), **D-5** (E2 post-commit),
> **D-6** (generación del PDF) y **D-7** (congelado de tarifa) requieren decisión humana.

Rutas reales citadas (todas en `apps/api/src/`, ya en `master` tras
US-004/005/007/008/016/040/041/045):
- `reservas/domain/maquina-estados.ts` — máquina declarativa (`ORIGENES_TRANSICION_*` +
  tablas de reglas; US-004/005/007/008)
- `reservas/domain/bloquear-fecha.service.ts` — `resolverPlanBloqueo` + puerto, con fase
  `pre_reserva` ya en el mapa canónico (US-040)
- `reservas/infrastructure/fecha-bloqueada.prisma.adapter.ts` — `bloquearEnTx(tx, …)`
  reutilizable con rama insert-o-update (US-040/004/008)
- `reservas/infrastructure/transicion-fecha-uow.prisma.adapter.ts` — UoW de transición con
  `SELECT … FOR UPDATE` sobre la fila bloqueante + retry-on-conflict (US-005/007/008)
- `reservas/infrastructure/tenant-settings.prisma.adapter.ts` — `obtener()`
  (`ttl_prereserva_dias`)
- `reservas/application/**` — use-cases de transición + vaciado de cola A16 (US-007)
- el **motor de tarifa** de US-016 (capability `calculo-tarifa`) — cálculo delegado
- el **motor de email E1–E8** de US-045 (capability `comunicaciones`) — disparo de E2 + su
  interfaz de adjuntos por `pdf_url`
- `prisma/schema.prisma` — tabla `PRESUPUESTO`, estado `pre_reserva`, seed de
  `ttl_prereserva_dias`

**Diferencia esencial con las transiciones previas de consulta**: US-014 no solo transiciona
la RESERVA, sino que **coordina tres agregados/capabilities** en una sola transacción —
crear PRESUPUESTO (`presupuestos`), transicionar + bloquear + vaciar cola (`consultas`) y,
post-commit, enviar E2 (`comunicaciones`)— y **delega el cálculo** al motor de tarifa
(`calculo-tarifa`). El motor atómico (transacción + `FOR UPDATE` sobre la fila bloqueante /
`UNIQUE(tenant_id, fecha)`) es **el mismo y se reutiliza**.

---

## D-1. Nueva capability `presupuestos` + módulo backend, vs extender `consultas`

**Decisión (recomendada)**: **crear una nueva capability `presupuestos`** y,
previsiblemente, un **módulo backend `apps/api/src/presupuestos/**`** para el agregado
PRESUPUESTO, dejando en `consultas`/`reservas` la **transición de estado** de la RESERVA.

- **Por qué separar**: el agregado raíz de la generación del presupuesto es **PRESUPUESTO**
  (no RESERVA): tiene su ciclo de vida (`borrador`/`enviado`/`aceptado`/`rechazado`), su
  versionado (`version`), su desglose fiscal congelado y su PDF, y crecerá con UC-15 (editar
  presupuesto → `version = 2…`), la facturación (FACTURA de señal/liquidación/fianza) y los
  pagos. Mantenerlo aparte del ciclo de vida del lead (`consultas`) preserva la cohesión y
  evita un `consultas` sobredimensionado.
- **Qué queda en `consultas`/`reservas`**: la **transición** `{2a,2b,2c,2v} → pre_reserva`,
  la elevación del TTL a 7 días, el bloqueo insert-o-update y el vaciado de cola A16 — todo
  eso muta el agregado **RESERVA** y reutiliza la máquina de estados y la UoW de transición
  ya existentes. Por eso el delta de `consultas` lleva esos requisitos.
- **Coordinación**: un **use-case de aplicación de UC-14** orquesta ambas capabilities
  dentro de **una sola transacción de BD** (Unit of Work): calcula (motor de tarifa), crea
  el PRESUPUESTO congelado, transiciona la RESERVA, hace el insert-o-update del bloqueo,
  vacía la cola y escribe la auditoría; el E2 se dispara post-commit.
- **Riesgo hexagonal**: el módulo `presupuestos` **no** debe importar de `reservas/domain`
  ni viceversa fuera de puertos; la coordinación transaccional se hace en la capa de
  aplicación con un **puerto de transición de RESERVA** que el módulo de presupuesto invoca,
  o un use-case en `reservas` que recibe un **puerto de creación de PRESUPUESTO**. La
  dirección exacta del puerto (¿quién orquesta a quién?) se decide en implementación; el
  hook `no-infra-in-domain` seguirá vigilando.
- **Alternativa descartada**: meter todo en `consultas` acoplaría el ciclo de vida del lead
  con la facturación futura y rompería la cohesión; se descarta salvo indicación humana.

**Abierto al Gate SDD**: (a) confirmar la nueva capability `presupuestos`; (b) confirmar el
módulo backend `presupuestos/` (o alojarlo transitoriamente bajo `reservas/`).

## D-2. Guarda de origen multi-estado — extender la máquina declarativa

**Decisión**: añadir a `maquina-estados.ts`, **como dato** (tabla declarativa, no
condicionales dispersos), las transiciones permitidas
`{consulta,2a|2b|2c|2v} → {pre_reserva}`, modeladas como un conjunto de orígenes válidos
(`ORIGENES_TRANSICION_ACTIVAR_PRERESERVA = {2a,2b,2c,2v}`). Todo origen distinto —`2.d`
(cola), los terminales `2.x`/`2.y`/`2.z`, `pre_reserva`/`reserva_confirmada`/posteriores— se
rechaza **antes** de entrar en la transacción y **antes** de llamar al motor de tarifa. Mismo
patrón que `ORIGENES_TRANSICION_*` de US-005/007/008. Skill `state-machine`.

- La precondición adicional "no existe PRESUPUESTO enviado/aceptado" (US-014 §Reglas de
  Validación) se comprueba en la capa de aplicación (lectura de PRESUPUESTO), no en la
  máquina de estados; remite a UC-15 si existe.

## D-3. Bloqueo `FECHA_BLOQUEADA` insert-o-update en fase `pre_reserva`

**Decisión**: reutilizar `bloquearFecha(fase = 'pre_reserva')` de US-040, cuyo mapa canónico
ya define `pre_reserva → {blando, now() + TENANT_SETTINGS.ttl_prereserva_dias}`, con la rama
**insert-o-update** ya introducida por US-008 (`bloquearEnTx`):

- **Origen `2.a` (sin fila previa)** → **INSERT** de una fila nueva con `(tenant_id, fecha)`
  único, `tipo_bloqueo = 'blando'`, `ttl = now() + ttl_prereserva_dias`, `reserva_id`.
- **Origen `2.b`/`2.c`/`2.v` (fila activa)** → **UPDATE** del `ttl_expiracion` de la fila
  existente al nuevo valor de 7 días; `tipo_bloqueo` permanece `'blando'`.
- El bloqueo permanece **blando** (la pre-reserva **no** es firme; el upgrade a `firme` es la
  US de confirmación de reserva). Todo dentro de la **misma transacción** que la transición,
  serializado por `SELECT … FOR UPDATE` sobre la fila bloqueante y `UNIQUE(tenant_id, fecha)`
  en el INSERT (regla dura: PostgreSQL, nunca Redis/Redlock).

**Abierto al Gate SDD**: confirmar que la primitiva `pre_reserva` ya está cableada en
`bloquearEnTx` con la rama insert-o-update (introducida por US-008); si no, es un pequeño
refinamiento de reuso, no una reimplementación.

## D-4. Vaciado de cola A16 — reuso de la mecánica de US-007

**Decisión**: reutilizar la **misma operación de vaciado de cola** que US-007 aplica en la
transición a `2.c` (UPDATE de todas las RESERVA con `consulta_bloqueante_id = id` y
`sub_estado = '2d'` → `2y`, `posicion_cola = NULL`, `consulta_bloqueante_id = NULL`), dentro
de la misma transacción, serializada por el `FOR UPDATE` sobre la fila bloqueante. Una
entrada de `AUDIT_LOG` por cada consulta descartada. Los **emails A16 a la cola son solo
diseñados y NO se envían** en MVP (anti-scope del proposal).

## D-5. Congelado de tarifa y desglose fiscal — persistencia del cálculo

**Decisión**: al confirmar, persistir en PRESUPUESTO el **desglose fiscal congelado**
derivado del resultado del motor de tarifa:
- `base_imponible` y `iva_importe` se derivan del `precio_tarifa_eur` (que **incluye IVA 21%**
  según la capability `calculo-tarifa`): `base_imponible = total / 1.21`, `iva_importe =
  total - base_imponible`, con `iva_porcentaje = 21`. (A confirmar en implementación si el
  motor expone base/IVA por separado o solo el total con IVA incluido.)
- `total = precio_tarifa_eur + extras_total_eur` (o el **precio manual** del caso
  `tarifa_a_consultar`), menos `descuento_eur` si el gestor aplicó descuento.
- `tarifa_congelada = true`, `estado = 'enviado'`, `version = 1`, y `tarifa_id` (referencia
  a la TARIFA vigente usada) para trazabilidad; en el caso `tarifa_a_consultar`, `tarifa_id`
  es `null` y el `total` es el precio manual.
- Una vez congelado, un cambio posterior del tarifario **no recalcula** el PRESUPUESTO.

**Abierto al Gate SDD**: confirmar la fórmula base/IVA (¿el motor devuelve base+IVA o solo
total con IVA?) y el tratamiento del descuento en el desglose 40%/60%/fianza.

## D-6. Generación del PDF — proveedor y momento

**Decisión (recomendada)**: generar el PDF **dentro de la transacción de confirmación** solo
si es barato/determinista; si la generación es pesada o depende de un servicio externo, se
recomienda generarlo **antes de abrir la transacción** (con los datos del borrador ya
validados) o **post-commit** y guardar `pdf_url` con un segundo UPDATE idempotente, para no
alargar la transacción crítica que sostiene el `FOR UPDATE` sobre la fila bloqueada.
- Proveedor: **Puppeteer o react-pdf** (stack del proyecto, `CLAUDE.md`); el adaptador de PDF
  vive **solo en infraestructura** (puerto de dominio `PdfPresupuestoPort`).
- El PDF incluye base+IVA 21%, extras, total, reparto 40%/60%/fianza e instrucciones de
  transferencia (IBAN/beneficiario/concepto del tenant), como **texto informativo**.

**Abierto al Gate SDD**: (a) momento de generación (dentro vs antes vs post-commit); (b)
proveedor (Puppeteer vs react-pdf); (c) almacenamiento del `pdf_url` (local/objeto/servicio).

## D-7. E2 como efecto posterior al commit

**Decisión**: disparar E2 **después** del commit de la transacción de confirmación,
reutilizando el motor de email de US-045 y su interfaz de adjuntos por `pdf_url`. Un fallo del
proveedor **no revierte** la pre-reserva; queda trazado en `COMUNICACION` (`estado ≠
'enviado'`) para reintento. En `test`/CI, transporte en **modo fake**. La idempotencia
`(reserva_id, codigo_email)` de US-045 garantiza una sola E2 por RESERVA (protege del doble
clic). Mismo patrón que E6 en US-008 (`design.md §D-6` de US-008).

## D-8. Endpoints API previstos (input para el `contract-engineer`)

> **No se toca `docs/api-spec.yml` en este change de spec.** El `contract-engineer` los
> formalizará tras el Gate SDD. Se listan aquí como input.

- **`POST /reservas/{id}/presupuesto/preview`** — calcula el **borrador** invocando el motor
  de tarifa; **no persiste** nada. Body opcional: `{ extras?: [{extra_id, cantidad}],
  descuento_eur?, precio_manual_eur? }` (para el caso `tarifa_a_consultar`). Respuesta: el
  desglose (temporada, base, IVA, extras, total, reparto 40/60/fianza, `tarifa_a_consultar`).
  - Errores: 422 datos fiscales incompletos (con lista de campos); 409/422 `TARIFA_NO_
    CONFIGURADA`/`TEMPORADA_NO_CONFIGURADA`; 409 guarda de origen (`2.d`/terminal/presupuesto
    existente).
- **`POST /reservas/{id}/presupuesto`** — **confirma**: crea PRESUPUESTO congelado, transiciona
  la RESERVA a `pre_reserva`, insert-o-update del bloqueo a 7 días, vacía la cola A16, escribe
  AUDIT_LOG (transacción única), y dispara E2 post-commit. Body: `{ extras, descuento_eur?,
  descuento_motivo?, precio_manual_eur? }`. Respuesta: el PRESUPUESTO creado (id, version,
  total, `pdf_url`, estado) + nuevo estado/TTL de la RESERVA.
  - Errores: 409 "Fecha no disponible" (`UNIQUE(tenant_id, fecha)` / lock — race condition);
    409 guarda de origen / presupuesto existente (remite a UC-15); 422 datos fiscales; 422
    precio manual requerido y ausente (`tarifa_a_consultar` sin `precio_manual_eur`).
- **Read-model** `GET /reservas/{id}` ya existe (US-005) y expone el estado de la RESERVA; se
  extenderá para exponer el PRESUPUESTO asociado si el frontend lo necesita (a decidir).

**Abierto al Gate SDD**: confirmar la partición preview/confirm (dos endpoints) vs un único
endpoint con `dry_run`, y el mapeo exacto de códigos HTTP de error.

## D-9. Migración — a confirmar

**Decisión (recomendada)**: **no** se prevé migración estructural. La tabla `PRESUPUESTO`
(`er-diagram.md §3.11`), el estado `pre_reserva` (enum de RESERVA) y
`TENANT_SETTINGS.ttl_prereserva_dias` (mapa canónico US-040) ya están en el modelo. A
confirmar en implementación que en `prisma/schema.prisma` de `master` existen las columnas
`PRESUPUESTO.descuento_motivo` y `PRESUPUESTO.fecha_envio`, y el **seed** de
`ttl_prereserva_dias` (default 7); si faltara alguno, será la única migración/seed.

**Abierto al Gate SDD**: confirmar el estado del esquema/seed en `master`.

---

## Resumen de decisiones abiertas al Gate humano SDD

| # | Decisión | Recomendación |
|---|----------|---------------|
| D-1 | Capability + módulo backend | Nueva capability `presupuestos` + módulo `presupuestos/` |
| D-3 | Bloqueo insert-o-update fase `pre_reserva` | Reuso de `bloquearFecha` (INSERT en `2.a`, UPDATE en `2.b/2.c/2.v`), TTL 7d, blando |
| D-5 | Congelado/desglose fiscal | Persistir base/IVA/total + `tarifa_id`, `tarifa_congelada = true`; confirmar fórmula base/IVA |
| D-6 | Generación del PDF | Fuera de la transacción crítica (antes/post-commit); Puppeteer/react-pdf; puerto en infra |
| D-7 | E2 post-commit | Sí, con idempotencia de US-045; fake en test/CI |
| D-8 | Endpoints | `preview` (no persiste) + `presupuesto` (confirma) |
| D-9 | Migración | No prevista; confirmar columnas de PRESUPUESTO + seed `ttl_prereserva_dias` |

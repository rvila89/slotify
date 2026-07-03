# Change: us-014-generar-presupuesto-activar-prereserva

## Why

US-014 es el **nodo de mayor complejidad del camino feliz** (talla XL, tipo Spine): la
**generación de un presupuesto formal y la activación de la pre-reserva**. Cuando el
cliente ha confirmado los datos necesarios, el Gestor genera un presupuesto (borrador
editable), lo revisa y lo aprueba; al confirmar, la RESERVA transiciona de un sub-estado
de consulta (`2.a`/`2.b`/`2.c`/`2.v`) a `estado = 'pre_reserva'`, el **bloqueo de la
fecha se eleva a 7 días** de forma atómica, se **congela la tarifa** en un PRESUPUESTO,
se genera el **PDF** con el desglose 40%/60%/fianza + instrucciones de pago de la señal,
se **envía el email E2** con el PDF adjunto, y se **vacía la cola de espera** (consultas
en `2.d` bloqueadas por esta RESERVA pasan a `2.y`, A16). Resuelve **D8** (presupuestos
manuales de 30–60 min → segundos), **D3** (estado `pre_reserva` inequívoco), **D2** (la
reserva avanza a un estado visible del pipeline) y **D4** (bloqueo elevado de 3 a 7 días
de forma atómica, eliminando la ventana de doble reserva). (Fuente: `US-014 §Historia`,
`§Contexto de Negocio`; UC-14; A16; E2.)

El cimiento ya existe en `master` y **se reutiliza, no se recrea**:

- **Motor de cálculo de tarifa (US-016, capability `calculo-tarifa`)**: se **invoca**
  con `{ fecha_evento, duracion_horas, num_adultos_ninos_mayores4, extras }`. Devuelve
  el esquema canónico `{ temporada, tarifa_a_consultar, precio_tarifa_eur,
  extras_total_eur, total_eur, tarifa_id }`. El motor es **stateless/lectura pura** y
  declara explícitamente que **la congelación de la tarifa es responsabilidad de
  UC-14/US-014** (este change). Ya cubre `TARIFA_NO_CONFIGURADA`, `TEMPORADA_NO_
  CONFIGURADA`, `EXTRA_NO_ENCONTRADO` y el caso `tarifa_a_consultar` (>50 invitados).
- **Bloqueo atómico de fecha (US-040/041, capability `bloqueo-fecha`)**: la primitiva
  `bloquearFecha()` ya soporta la **fase `pre_reserva` → `{blando, ttl = now() +
  TENANT_SETTINGS.ttl_prereserva_dias (7)}`** (declarada en su mapa canónico) y la rama
  **insert-o-update** sobre `FECHA_BLOQUEADA` con `SELECT … FOR UPDATE` + `UNIQUE(
  tenant_id, fecha)`. La race condition (exactamente una gana) es **determinista y
  reside en PostgreSQL** (regla dura: nunca Redis/Redlock).
- **Motor de email E1–E8 (US-045, capability `comunicaciones`)**: **E2 está declarada
  como diseñada/inactiva** con su interfaz de **adjuntos por referencia a `pdf_url`**
  (de PRESUPUESTO). Este change **cablea el trigger E2** y su registro en
  `COMUNICACION`/`AUDIT_LOG`, reutilizando el motor sin reinventar envío ni trazado.
- **Máquina de estados declarativa (US-004/005/007/008)** (`maquina-estados.ts`,
  `ORIGENES_TRANSICION_*` + tablas de reglas): se **extiende** con la guarda de origen
  multi-estado `{2a,2b,2c,2v} → pre_reserva`, modelada como dato.
- **Mecánica de vaciado de cola A16 (US-007)**: la transición a `2.c` ya vacía la cola
  (`2.d → 2.y`, `posicion_cola = NULL`, `consulta_bloqueante_id = NULL`) en la misma
  transacción, serializada por `SELECT … FOR UPDATE` sobre la fila bloqueante. Aquí se
  **reutiliza el mismo patrón** al activar `pre_reserva`.
- **AUDIT_LOG (US-003+)**: `accion = 'transicion'` para la RESERVA principal y para cada
  consulta descartada de la cola, en la misma transacción.

(Fuente: ver `design.md` para firmas previstas, rutas reales y decisiones de reuso.)

## What Changes

> Slice vertical (backend + contrato + frontend "generar presupuesto / borrador
> editable"). Sujeto al **Gate de revisión humana SDD** (decisiones en `design.md`).

- **Nueva acción "Generar presupuesto" sobre una RESERVA en `2.a`/`2.b`/`2.c`/`2.v`**:
  el Gestor solicita el borrador. El servidor **valida el sub_estado de origen** (excluye
  `2.d`, `pre_reserva` y todos los terminales/posteriores), la **completitud de datos**
  (`fecha_evento`, `duracion_horas ∈ {4,8,12}`, `num_adultos_ninos_mayores4 ≥ 1`,
  `tipo_evento`) y los **datos fiscales del CLIENTE** (`dni_nif`, `direccion`,
  `codigo_postal`, `poblacion`, `provincia`), y **delega el cálculo al motor de tarifa
  (US-016)**. (Fuente: `US-014 §Reglas de negocio`, `§Reglas de Validación`; UC-14.)
- **Borrador editable de presupuesto (fase previa a la confirmación)**: el sistema
  presenta el desglose (base imponible + IVA 21% + extras + descuentos + total y el
  reparto 40%/60%/fianza). El Gestor puede ajustar cantidades, extras y descuentos.
  **En esta fase no se muta la RESERVA ni la `FECHA_BLOQUEADA`.**
- **FA-02 — >50 invitados (tarifa a consultar)**: el motor devuelve
  `{ tarifa_a_consultar: true, precio_total_eur: null }`; el sistema **habilita un campo
  de precio total manual**; el Gestor lo introduce y el flujo continúa con ese valor en
  `PRESUPUESTO.total`.
- **Confirmar el borrador → transición a `pre_reserva` (transacción única
  all-or-nothing)**:
  - Crea `PRESUPUESTO` con `version = 1`, `tarifa_congelada = true`,
    `estado = 'enviado'`, `iva_porcentaje = 21`, `base_imponible`, `iva_importe`,
    `total`, `descuento_eur`/`descuento_motivo` (si aplica) y `pdf_url`.
  - `RESERVA.estado → 'pre_reserva'` y `RESERVA.ttl_expiracion = now() +
    TENANT_SETTINGS.ttl_prereserva_dias` (7 por defecto).
  - **Bloqueo `FECHA_BLOQUEADA` insert-o-update (fase `pre_reserva`)**: si la RESERVA
    tenía bloqueo previo (`2.b`/`2.c`/`2.v`) → **UPDATE** del `ttl_expiracion` de la fila
    existente al nuevo TTL de 7 días; si venía de `2.a` (sin bloqueo) → **INSERT** de una
    fila nueva con `(tenant_id, fecha)` único, `tipo_bloqueo = 'blando'`, `reserva_id`
    apuntando a la RESERVA. `tipo_bloqueo` permanece/es `'blando'` (la pre-reserva no es
    firme; el upgrade a `firme` es US posterior).
  - **Vaciado de cola A16**: todas las RESERVA con `consulta_bloqueante_id = id de esta
    RESERVA` y `sub_estado = '2d'` pasan a `sub_estado = '2y'`, `posicion_cola = NULL`,
    `consulta_bloqueante_id = NULL`, en la **misma transacción**.
  - `AUDIT_LOG`: `accion = 'transicion'`, `datos_anteriores.estado = '<sub_estado
    origen>'`, `datos_nuevos.estado = 'pre_reserva'` para la principal; una entrada por
    cada consulta descartada de la cola.
- **Email E2 (posterior al commit)**: se dispara el motor de email de US-045 para enviar
  el PDF del presupuesto (desglose 40%/60%/fianza + instrucciones de transferencia) y se
  registra `COMUNICACION` con `codigo_email = 'E2'`, `estado = 'enviado'`. El envío es
  **posterior al commit** de la transición: su fallo **no revierte** la pre-reserva
  (queda trazado en `COMUNICACION` para reintento). En `test`/CI el transporte opera en
  **modo fake**.
- **FA-01 — datos fiscales incompletos**: validación **síncrona antes** de llamar al
  motor; el sistema enumera los campos fiscales faltantes; **no** crea PRESUPUESTO; la
  RESERVA permanece en su sub_estado; `FECHA_BLOQUEADA` no se modifica.
- **FA-03 — cancelar en fase de borrador**: no se crea PRESUPUESTO; la RESERVA permanece
  en su sub_estado; `FECHA_BLOQUEADA` no se modifica; no se envía ningún email.
- **Motor sin tarifa vigente**: el motor lanza `TARIFA_NO_CONFIGURADA` (o
  `TEMPORADA_NO_CONFIGURADA`); el sistema muestra "Tarifa no configurada para los
  parámetros indicados"; no se crea PRESUPUESTO; la RESERVA permanece en su sub_estado.
- **Guarda de origen y estados inmutables**: petición sobre `2.d` (cola) o sobre
  terminales (`2.x`/`2.y`/`2.z`, `reserva_cancelada`/`reserva_completada`) o sobre una
  RESERVA ya en `pre_reserva`/posterior → **rechazo sin ejecutar el motor de tarifa ni
  mutar nada**. Si ya existe un PRESUPUESTO en `enviado`/`aceptado` → se indica usar
  UC-15 (editar), fuera de este change.
- **Concurrencia (zona crítica)**: dos confirmaciones concurrentes sobre la misma
  `(tenant_id, fecha)` —una en `2.a` sin bloqueo (INSERT) y otra en `2.b` con bloqueo
  (UPDATE), o un doble clic sobre el mismo presupuesto— se serializan por `SELECT … FOR
  UPDATE` + `UNIQUE(tenant_id, fecha)`: **exactamente una** confirma; la otra recibe
  violación de unicidad (`P2002`) o falla al adquirir el lock, y el sistema devuelve
  "Fecha no disponible"; **nunca** doble bloqueo ni incoherencia RESERVA↔FECHA_BLOQUEADA.
  Cubierto con **tests de concurrencia reales** en TDD-RED (skill `concurrency-locking`).
- **Frontend "Generar presupuesto"**: acción sobre la ficha de consulta (deshabilitada
  en `2.d`/terminales/`pre_reserva`), borrador editable con desglose (base, IVA 21%,
  extras, descuentos, total, reparto 40%/60%/fianza), campo de precio manual cuando
  `tarifa_a_consultar`, y botones **Confirmar** / **Cancelar**. Muestra los errores de
  datos fiscales incompletos y de tarifa no configurada. Responsive mobile-first
  (390/768/1280).

## Impact

- Specs: **crea una nueva capability `presupuestos`** con los requisitos propios de la
  generación del presupuesto (borrador editable, congelado de tarifa, cálculo del
  desglose 40%/60%/fianza + IVA 21%, PDF, precio manual >50 invitados, validación de datos
  fiscales, guarda de precondición "no existe PRESUPUESTO enviado/aceptado"). **Modifica
  la capability `consultas`** (añade el requisito de la **transición
  `{2a,2b,2c,2v} → pre_reserva`**: guarda de origen multi-estado, elevación del TTL a 7
  días, bloqueo insert-o-update fase `pre_reserva`, vaciado de cola A16 al activar
  `pre_reserva`, atomicidad de las N operaciones, concurrencia anti-doble-reserva y
  auditoría `accion='transicion'`). **Modifica la capability `comunicaciones`** (añade el
  requisito del **disparo de E2** con el PDF del presupuesto adjunto + registro en
  `COMUNICACION`/`AUDIT_LOG`, reutilizando el motor de US-045 y su interfaz de adjuntos).
  **Reutiliza sin modificar** la capability `bloqueo-fecha` (la fase `pre_reserva` con TTL
  `ttl_prereserva_dias` ya está en su mapa canónico) y la capability `calculo-tarifa` (el
  motor ya expone el esquema y los errores necesarios) — **no se crea delta ni de
  `bloqueo-fecha` ni de `calculo-tarifa`**.
  - **Justificación de la nueva capability `presupuestos`** (ver `design.md §D-1`): la
    generación/congelación del presupuesto y el cálculo del desglose fiscal (base+IVA,
    reparto 40%/60%/fianza, PDF, precio manual) son un **dominio propio** (agregado
    PRESUPUESTO, no RESERVA) que crecerá con UC-15 (editar presupuesto), la facturación y
    los pagos; mantenerlo separado de `consultas` (ciclo de vida del lead) preserva la
    cohesión y evita un `consultas` sobredimensionado. La **transición de estado** de la
    RESERVA (que sí es del agregado RESERVA/ciclo de vida) permanece en `consultas`, igual
    que las transiciones `2.a→2.b`, `2.b→2.c`, `→2.v`. Ambas capabilities se coordinan en
    una sola transacción del use-case de UC-14.
- Contrato OpenAPI (`docs/api-spec.yml`): se prevén endpoints nuevos (ver `design.md §D-8`,
  input para la fase de contrato): `POST /reservas/{id}/presupuesto/preview` (calcula el
  borrador vía motor de tarifa, **no persiste**), `POST /reservas/{id}/presupuesto`
  (confirma: crea PRESUPUESTO + transición a `pre_reserva` + bloqueo + vaciado de cola +
  E2). El `contract-engineer` (post-gate) los definirá; **no se toca `docs/api-spec.yml`
  en este change de spec**. No se edita el cliente generado a mano.
- Código (implementación posterior, fuera de este change de spec):
  `apps/api/src/reservas/{domain,application,infrastructure,interface}/**` (use-case de
  generación de presupuesto + transición a `pre_reserva`, guarda de origen declarativa,
  reuso de `bloquearFecha(fase='pre_reserva')` + rama insert-o-update en la UoW, reuso del
  vaciado de cola A16, disparo del motor E2, AUDIT_LOG), previsiblemente un módulo
  `apps/api/src/presupuestos/**` para el agregado PRESUPUESTO (borrador, congelado de
  tarifa, cálculo del desglose fiscal, generación de PDF), `apps/web/src/features/**`
  (acción "Generar presupuesto" + borrador editable + confirmación). La ubicación exacta
  del módulo backend se decide en `design.md §D-1`.
- **Migración**: **a confirmar en `design.md §D-9`**. La tabla `PRESUPUESTO` y el estado
  `pre_reserva` de la RESERVA ya están en el modelo (`er-diagram.md §3.11`,
  `§estados de RESERVA`) y `TENANT_SETTINGS.ttl_prereserva_dias` está en el mapa canónico
  de US-040. Si alguna columna de PRESUPUESTO (`descuento_motivo`, `fecha_envio`) o el seed
  de `ttl_prereserva_dias` faltara en `prisma/schema.prisma` de `master`, será la única
  migración; en principio **no se prevé migración estructural**.
- Trazabilidad: **US-014**, **UC-14** (principal), **UC-16** (motor delegado, US-016);
  entidades RESERVA, CLIENTE, PRESUPUESTO, TARIFA, TEMPORADA_CALENDARIO, EXTRA,
  RESERVA_EXTRA, FECHA_BLOQUEADA, COMUNICACION, AUDIT_LOG; automatización **A16** (vaciado
  de cola al activar `pre_reserva`); email **E2**.
- Dependencias (todas en `master`): US-003/US-004/US-005/US-007/US-008 (existe una RESERVA
  en `2.a`/`2.b`/`2.c`/`2.v`), US-016 (motor de tarifa), US-040/US-041 (bloqueo atómico /
  liberación con fase `pre_reserva`), US-045 (motor de email E1–E8, E2 declarada).

## Lo que NO entra (anti-scope)

- **📐 Solo diseñado — Emails a la cola vaciada (A16, parte "email a cada uno")**: cuando
  la cola se vacía (`2.d → 2.y`), la US describe un email de notificación a cada cliente
  descartado. Ese envío es **solo diseñado y NO se implementa en MVP**; solo se implementa
  la **mecánica** del vaciado (transición `2.d → 2.y` + auditoría), verificable por el
  gestor. (Fuente: `US-014 §Automatización A16`, `§Notas de alcance`.)
- **📐 Solo diseñado — Recordatorios de seguimiento del presupuesto (T-15d, T-3d)**: los
  recordatorios automáticos tras enviar el presupuesto son **solo diseñados y fuera del
  MVP**. (Fuente: `US-014 §Notas de alcance`.)
- **Editar un presupuesto ya enviado/aceptado (UC-15)**: si ya existe un PRESUPUESTO en
  `enviado`/`aceptado`, este change **rechaza** la generación y remite a UC-15 (otra US).
  Este change solo cubre la **primera** generación (`version = 1`).
- **Facturación y pagos (FACTURA / PAGO)**: el PDF del presupuesto incluye el **desglose**
  40%/60%/fianza y las instrucciones de transferencia (IBAN/beneficiario/concepto del
  tenant) como **texto informativo**; la creación de FACTURA de señal y la conciliación de
  PAGO son US posteriores.
- **Upgrade del bloqueo a `firme`**: la pre-reserva mantiene `tipo_bloqueo = 'blando'`; la
  promoción a `firme` (al confirmar la reserva) es US posterior (`reserva_confirmada`,
  US-040 ya modela la primitiva).
- **Barrido/expiración del TTL de 7 días de la pre-reserva (A4)**: la expiración de la
  pre-reserva la ejecuta el barrido de US-012/US-041 (reutilizado, no redefinido aquí);
  este change solo **fija** el TTL a 7 días.

## Decisiones de alcance pendientes de aprobación humana

Las decisiones de diseño están **razonadas con recomendación** en `design.md` y quedan
**abiertas hasta el OK del Gate SDD**. En particular:
- **D-1**: nueva capability `presupuestos` (+ módulo backend `presupuestos/`) vs extender
  `consultas`. Recomendación: **nueva capability** por cohesión del agregado PRESUPUESTO.
- **D-3**: rama **insert-o-update** de `FECHA_BLOQUEADA` en fase `pre_reserva` según
  origen (`2.a` sin bloqueo → INSERT; `2.b`/`2.c`/`2.v` con bloqueo → UPDATE del TTL a 7d).
- **D-5**: E2 como **efecto posterior al commit** (la atomicidad cubre PRESUPUESTO +
  RESERVA + FECHA_BLOQUEADA + vaciado de cola + auditoría; el email no revierte el estado
  si el proveedor falla).
- **D-6**: **generación del PDF** — dentro o fuera de la transacción, y proveedor
  (Puppeteer vs react-pdf) + almacenamiento del `pdf_url`.
- **D-7**: **congelado de tarifa** — persistir el desglose calculado (base, IVA, total,
  `tarifa_id`) en el PRESUPUESTO con `tarifa_congelada = true` en el momento de confirmar,
  de modo que un cambio posterior del tarifario no lo recalcule.
- **D-9**: confirmar si hace falta migración (columnas de PRESUPUESTO / seed de
  `ttl_prereserva_dias`).

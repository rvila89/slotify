# Change: us-021-confirmar-pago-senal-activar-reserva

## Why

US-021 es el **cierre del camino feliz previo al evento** (Crítica, UC-17): la
**confirmación del pago de la señal** que eleva la RESERVA de `pre_reserva` a
`reserva_confirmada`. El Gestor sube el justificante de pago del cliente, y al
confirmar la RESERVA transiciona a `reserva_confirmada`, el **bloqueo blando de la
fecha se promueve a `firme` sin TTL** de forma atómica (upgrade, no delete+insert), se
**inicializan los tres sub-procesos paralelos** (`pre_evento_status`,
`liquidacion_status`, `fianza_status` = `pendiente`), se **crea la FICHA_OPERATIVA
vacía** (1:1, idempotente) y se **congelan los importes** `importe_senal` (pct_senal,
40% MVP) e `importe_liquidacion` (60%) a partir de `RESERVA.importe_total` fijado en la
pre-reserva. Resuelve **D4** (el bloqueo firme sin TTL elimina la última ventana de
doble reserva), **D3** (el estado `reserva_confirmada` hace inequívoco el pipeline) y
**D1** (la activación automática de los sub-procesos evita olvidar iniciar liquidación
o fianza). (Fuente: `US-021 §Historia`, `§Contexto de Negocio`, `§Impacto de Negocio`;
UC-17; `er-diagram.md §estados de RESERVA`, `§3.16 FECHA_BLOQUEADA mapa canónico`.)

El cimiento ya existe en `master` y **se reutiliza, no se recrea**:

- **Bloqueo atómico de fecha (US-040/041, capability `bloqueo-fecha`)**: la primitiva
  `bloquearFecha()` ya declara en su **mapa canónico** la fase `reserva_confirmada →
  {firme, ttl = NULL, modo = upgrade}`, y su spec ya cubre el requisito **"Upgrade de
  bloqueo blando a firme al confirmar"** (UPDATE de la fila existente, sin alterar
  `reserva_id`), la **idempotencia del bloqueo firme por `reserva_id`** y las **race
  conditions** sobre `(tenant_id, fecha)` (`SELECT … FOR UPDATE` + `UNIQUE`). Los
  constraints `chk_firme_sin_ttl`/`chk_blando_con_ttl` los impone la BD. Este change
  **invoca** esa primitiva; **no crea delta de `bloqueo-fecha`** (regla dura: nunca
  Redis/Redlock).
- **Máquina de estados declarativa (US-004/005/007/008/010/014)** (`maquina-estados.ts`,
  tablas de reglas de transición): se **extiende** con la guarda de origen
  `pre_reserva → reserva_confirmada`, modelada como dato (no condicionales dispersos).
- **Estado `pre_reserva` + `importe_total` (US-014, capability `presupuestos`/
  `consultas`)**: la pre-reserva fija `RESERVA.importe_total` desde el presupuesto
  aceptado. Este change lo **consume** para calcular los importes de señal y
  liquidación; no recalcula tarifa.
- **AUDIT_LOG (US-003+)**: `accion = 'transicion'` en la misma transacción, con
  `datos_anteriores.estado = 'pre_reserva'` y `datos_nuevos.estado =
  'reserva_confirmada'`.

(Fuente: ver `design.md` para firmas previstas, rutas reales y decisiones de reuso.)

## What Changes

> Slice vertical (backend + contrato + frontend "confirmar pago de señal / subir
> justificante"). Sujeto al **Gate de revisión humana SDD** (decisiones en `design.md`).

- **Nueva acción "Confirmar pago de señal" sobre una RESERVA en `pre_reserva`**: el
  Gestor sube un fichero justificante (imagen/PDF) y confirma. El servidor **valida el
  estado de origen** (`estado = 'pre_reserva'`; cualquier otro estado la rechaza sin
  efectos), la **presencia y el formato/tamaño del fichero** (`image/jpeg`, `image/png`
  o `application/pdf`, ≤ 10 MB) y que `RESERVA.importe_total > 0`. (Fuente: `US-021
  §Reglas de negocio`, `§Reglas de Validación`, `§Reserva no está en pre_reserva`,
  `§Justificante no adjuntado`, `§Fichero justificante con formato no válido`.)
- **Creación de DOCUMENTO del justificante**: se crea una fila `DOCUMENTO` con
  `tipo = 'justificante_pago'`, `reserva_id`, `tenant_id`, `url` del fichero almacenado y
  `mime_type`. (Fuente: `US-021 §Reglas de negocio`, `§Happy Path`; `er-diagram.md §3.15
  DOCUMENTO`.)
- **Confirmar → transición a `reserva_confirmada` (transacción única all-or-nothing)**:
  - `RESERVA.estado → 'reserva_confirmada'` y `RESERVA.ttl_expiracion = NULL` (la
    reserva confirmada no expira por TTL).
  - **Upgrade del bloqueo a firme (fase `reserva_confirmada`)**: en la misma transacción
    se **promueve** la fila existente de `FECHA_BLOQUEADA(tenant_id, fecha_evento)` a
    `tipo_bloqueo = 'firme'`, `ttl_expiracion = NULL`, sin alterar `reserva_id`,
    reutilizando la primitiva atómica de US-040 (`bloquearFecha(fase =
    'reserva_confirmada')`) con `SELECT … FOR UPDATE` + `UNIQUE(tenant_id, fecha)`.
  - **Inicialización de sub-procesos**: `pre_evento_status = 'pendiente'`,
    `liquidacion_status = 'pendiente'`, `fianza_status = 'pendiente'`.
  - **Congelado de importes**: `RESERVA.importe_senal = importe_total ×
    TENANT_SETTINGS.pct_senal` (40% MVP) e `RESERVA.importe_liquidacion = importe_total −
    importe_senal` (60%), derivados del setting (**nunca hardcodeados**) en el momento de
    la confirmación.
  - **Creación idempotente de FICHA_OPERATIVA**: fila con `reserva_id` de la RESERVA
    confirmada (relación 1:1), todos los campos de contenido `NULL` y `ficha_cerrada =
    false`. Si ya existe una FICHA_OPERATIVA con ese `reserva_id`, **no se duplica** y la
    transición continúa sin error.
  - `AUDIT_LOG`: `accion = 'transicion'`, `entidad = 'RESERVA'`,
    `datos_anteriores.estado = 'pre_reserva'`, `datos_nuevos.estado =
    'reserva_confirmada'`, con el usuario del Gestor.
- **Guarda de origen y estados no permitidos**: petición sobre una RESERVA ya en
  `reserva_confirmada`/posterior, en cualquier sub-estado de `consulta`, o en
  `reserva_cancelada` → **rechazo con "La reserva no está en estado pre_reserva"** sin
  crear DOCUMENTO, sin mutar RESERVA/FECHA_BLOQUEADA y sin registrar transición.
- **Concurrencia (zona crítica)**: dos confirmaciones concurrentes sobre la misma
  RESERVA (doble clic del gestor / dos sesiones) se serializan por `SELECT … FOR UPDATE`
  sobre la fila de `FECHA_BLOQUEADA`: **exactamente una** completa el upgrade a firme y la
  transición; la segunda, al adquirir el lock, observa que la RESERVA ya está en
  `reserva_confirmada` y devuelve **"La reserva ya ha sido confirmada"** sin crear un
  segundo DOCUMENTO ni una segunda FICHA_OPERATIVA. Un intento de confirmar sobre una
  fecha ya en bloqueo firme de **otra** RESERVA choca con `UNIQUE(tenant_id, fecha)`
  (`P2002`) y devuelve **"Fecha no disponible"** sin doble reserva confirmada (D4).
  Cubierto con **tests de concurrencia reales** en TDD-RED (skill `concurrency-locking`).
- **Frontend "Confirmar pago de señal"**: acción sobre la ficha de `pre_reserva`
  (deshabilitada en otros estados), formulario de subida del justificante con validación
  de formato/tamaño en cliente y mensaje de error de justificante obligatorio, botón
  **Confirmar**. Tras el commit muestra el estado `reserva_confirmada` y la factura de
  señal en borrador para revisión (disparo de US-022). Responsive mobile-first
  (390/768/1280).

## Impact

- Specs: **crea una nueva capability `confirmacion`** con los requisitos propios de la
  **subida y validación del justificante de pago** (DOCUMENTO `tipo =
  'justificante_pago'`, formato/tamaño), la **creación idempotente de FICHA_OPERATIVA**
  (relación 1:1) y la **inicialización de los tres sub-procesos** (`pre_evento_status`/
  `liquidacion_status`/`fianza_status = 'pendiente'`) más el **congelado de importes**
  (`importe_senal`/`importe_liquidacion` desde `pct_senal`). **Modifica la capability
  `consultas`** (añade el requisito de la **transición `pre_reserva →
  reserva_confirmada`**: guarda de origen `pre_reserva`, upgrade del bloqueo a firme sin
  TTL, atomicidad all-or-nothing de las N operaciones, concurrencia anti-doble-reserva y
  auditoría `accion = 'transicion'`). **Reutiliza sin modificar** la capability
  `bloqueo-fecha` (la fase `reserva_confirmada` con upgrade a firme ya está en su mapa
  canónico y su spec) — **no se crea delta de `bloqueo-fecha`**.
  - **Justificación de la nueva capability `confirmacion`** (ver `design.md §D-1`): la
    gestión documental del justificante (agregado DOCUMENTO) y la FICHA_OPERATIVA
    (agregado propio 1:1 con la RESERVA) son un **dominio propio** que crecerá con UC-18
    (aprobación de factura de señal), UC-19 (condiciones particulares) y UC-20/21/22 (los
    tres sub-procesos operativos); mantenerlo separado de `consultas` (ciclo de vida del
    lead/RESERVA) preserva la cohesión, igual que US-014 separó `presupuestos`. La
    **transición de estado** de la RESERVA (que sí es del agregado RESERVA/ciclo de vida)
    permanece en `consultas`. Ambas capabilities se coordinan en una sola transacción del
    use-case de UC-17.
- Contrato OpenAPI (`docs/api-spec.yml`): se prevé un endpoint nuevo (ver `design.md
  §D-6`, input para la fase de contrato): `POST /reservas/{id}/confirmar-senal`
  (multipart: fichero justificante) que crea DOCUMENTO + upgrade a firme + transición a
  `reserva_confirmada` + init sub-procesos + FICHA_OPERATIVA + AUDIT_LOG en una
  transacción. El `contract-engineer` (post-gate) lo definirá; **no se toca
  `docs/api-spec.yml` en este change de spec**. No se edita el cliente generado a mano.
- Código (implementación posterior, fuera de este change de spec):
  `apps/api/src/reservas/{domain,application,infrastructure,interface}/**` (use-case de
  confirmación de señal + transición a `reserva_confirmada`, guarda de origen
  declarativa, reuso de `bloquearFecha(fase='reserva_confirmada')` en la UoW, congelado de
  importes, AUDIT_LOG), previsiblemente un módulo `apps/api/src/confirmacion/**` (o
  `documentos/` + `fichas-operativas/`) para DOCUMENTO y FICHA_OPERATIVA, y
  `apps/web/src/features/**` (acción "Confirmar pago de señal" + subida del justificante).
  La ubicación exacta del módulo backend se decide en `design.md §D-1`.
- **Migración**: **a confirmar en `design.md §D-7`**. Los estados de RESERVA
  (`reserva_confirmada`), los enums de sub-procesos, `importe_senal`/`importe_liquidacion`,
  `TENANT_SETTINGS.pct_senal`, DOCUMENTO (`tipo = 'justificante_pago'`) y FICHA_OPERATIVA
  ya están en el modelo (`er-diagram.md §RESERVA, §3.14, §3.15, §TENANT_SETTINGS`) y la
  fase `reserva_confirmada` en el mapa canónico de US-040. En principio **no se prevé
  migración estructural**; si faltara alguna columna o el seed de `pct_senal` en
  `prisma/schema.prisma` de `master`, será la única migración.
- Trazabilidad: **US-021**, **UC-17** (principal); UC-20 (FICHA_OPERATIVA para el
  sub-proceso de pre-evento); entidades RESERVA, FECHA_BLOQUEADA, DOCUMENTO,
  FICHA_OPERATIVA, TENANT_SETTINGS, AUDIT_LOG.
- Dependencias (todas en `master`): US-014 (establece `pre_reserva` y fija
  `importe_total`), US-040/US-041 (bloqueo atómico / upgrade a firme fase
  `reserva_confirmada`), US-003/US-004/US-005 (existe una RESERVA con su AUDIT_LOG y
  máquina de estados declarativa).

## Lo que NO entra (anti-scope)

- **Factura de señal (US-022 / UC-18)**: este change deja la RESERVA en
  `reserva_confirmada` y **dispara la presentación** de la factura de señal en borrador,
  pero la **generación/aprobación** de la FACTURA es US-022, fuera de este change.
- **Condiciones particulares (US-023 / UC-19)**: la generación del documento de
  condiciones particulares es US-023, fuera de este change.
- **Email E3**: E3 se dispara **únicamente después** de que el Gestor apruebe la factura
  de señal (US-022) y el sistema genere las condiciones particulares (US-023). En este
  change **NO se envía E3**; los artefactos quedan en preparación. (Fuente: `US-021
  §Email relacionado`, `§Reglas de negocio`.)
- **Checklist pre-evento (UC-20 paso 11)**: la generación del checklist operativo es del
  sub-proceso de pre-evento (UC-20), fuera de este change; aquí solo se crea la
  FICHA_OPERATIVA **vacía** y se marca `pre_evento_status = 'pendiente'`.
- **Ejecución de los sub-procesos (UC-20/21/22)**: este change solo **inicializa** los
  tres estados a `pendiente`; su avance (`en_curso`/`cerrado`, `facturada`/`cobrada`,
  `recibo_enviado`/`cobrada`/…) es de US posteriores.
- **Liberación del bloqueo firme**: la promoción a firme se realiza aquí; su liberación
  (solo si la RESERVA pasa a `reserva_cancelada`) la modela `bloqueo-fecha` (US-041),
  reutilizada, no redefinida aquí.

## Decisiones de alcance pendientes de aprobación humana

Las decisiones de diseño están **razonadas con recomendación** en `design.md` y quedan
**abiertas hasta el OK del Gate SDD**. En particular:
- **D-1**: nueva capability `confirmacion` (+ módulo backend) vs extender `consultas`.
  Recomendación: **nueva capability** por cohesión de los agregados DOCUMENTO/
  FICHA_OPERATIVA.
- **D-2**: **upgrade a firme** reutilizando `bloquearFecha(fase='reserva_confirmada')`
  (UPDATE de la fila existente, `firme`/`NULL`), no delete+insert.
- **D-3**: **cálculo de importes** — `importe_senal = round(importe_total × pct_senal/100,
  2)`, `importe_liquidacion = importe_total − importe_senal` (evita desajuste de céntimos),
  derivados del setting en el momento de confirmar.
- **D-4**: **idempotencia de FICHA_OPERATIVA** — garantizada por `reserva_id @unique` +
  guarda "si existe, no crear" dentro de la transacción.
- **D-5**: **subida y almacenamiento del justificante** — validación de formato/tamaño y
  proveedor de almacenamiento (`DOCUMENTO.url`).
- **D-6**: **endpoint** (`POST /reservas/{id}/confirmar-senal`, multipart) e input para la
  fase de contrato.
- **D-7**: confirmar si hace falta migración (columnas de RESERVA/DOCUMENTO/FICHA_OPERATIVA
  o seed de `pct_senal`).
- **D-8**: **concurrencia** — la serialización por `SELECT … FOR UPDATE` sobre
  `FECHA_BLOQUEADA` y la detección "ya confirmada" vs la violación de `UNIQUE` por otra
  reserva ("Fecha no disponible").

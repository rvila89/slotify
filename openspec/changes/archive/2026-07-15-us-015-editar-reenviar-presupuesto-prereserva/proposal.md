# Change: us-015-editar-reenviar-presupuesto-prereserva

## Why

**US-015 — Editar y Reenviar Presupuesto en Pre-reserva** (Área: Pre-reserva y
Presupuestos; Módulo M4; UC-15). El Gestor necesita **ajustar la oferta económica**
de un presupuesto ya generado (cantidades de invitados, extras, descuento) y
**reenviar la versión actualizada** al cliente mientras la RESERVA está en
`pre_reserva`, **sin perder el historial de versiones** ni rehacer todo desde cero.
Sustituye el flujo Excel externo (dolor D8) y mantiene la visibilidad del pipeline
(D2). (Fuente: `US-015 §Historia`, `§Impacto de Negocio`.)

US-014 (crear pre_reserva + primer PRESUPUESTO `version=1`) y US-016 (motor de
tarifa) están **archivadas**; esta historia parte de su estado y **reutiliza sus
patrones** (motor de tarifa, desglose fiscal por régimen, numeración `AAAANNN` de
doble secuencia, disparo E2 post-commit, congelado de tarifa). No reimplementa el
tarifario ni el envío de email.

## What Changes

Se añade a la capability **`presupuestos`** la operación de **edición versionada**
de un presupuesto en `pre_reserva`, más el **reenvío sin cambios**. En síntesis:

- **Precondición** (guarda de servidor, sin efectos si falla): `RESERVA.estado =
  'pre_reserva'` y **último** `PRESUPUESTO.estado ∈ {'borrador','enviado'}` (nunca
  `aceptado`/`rechazado`). Origen modelado en la máquina de estados declarativa.
- **Campos editables**: `num_adultos_ninos_mayores4` (recalcula tarifa vía motor
  UC-16/US-016), líneas `RESERVA_EXTRA` (añadir/quitar/modificar cantidad),
  `descuento_eur`. También `duracion_horas ∈ {4,8,12}` (recalcula tarifa).
- **Precio congelado de extras**: el `precio_unitario` de cada `RESERVA_EXTRA` se
  **congela al añadir la línea**; una línea existente no se recalcula si el catálogo
  cambia; solo las líneas **nuevas** de esta edición toman el precio actual del EXTRA.
- **Nueva versión al confirmar**: se crea un `PRESUPUESTO` nuevo con `version =
  anterior + 1`, `tarifa_congelada = true`, recalculando `base_imponible`,
  `iva_importe` (21% en CON IVA; 0% en SIN IVA), `total`; se **regenera el PDF**. El
  presupuesto anterior **persiste como historial** (no se borra).
- **Envío explícito** → nueva `COMUNICACION` (template **E2**, reenvío) +
  `AUDIT_LOG` (`accion='actualizar'`, referencia al nuevo `id_presupuesto`);
  `PRESUPUESTO.estado='enviado'`. `RESERVA.estado` permanece `pre_reserva` y
  `FECHA_BLOQUEADA.ttl_expiracion` **NO** cambia (UC-15 no extiende el bloqueo).
- **Guardar borrador sin enviar**: nueva versión en `estado='borrador'`, sin
  COMUNICACION ni email.
- **Reenvío sin cambios**: NO crea versión nueva; reenvía el PDF de la versión
  actual, registra `COMUNICACION` (E2) + `AUDIT_LOG`.
- **Precio manual >50 invitados**: si el cambio de invitados dispara
  `tarifa_a_consultar = true`, se habilita precio manual (patrón US-014).
- **Validaciones**: `descuento_eur ≥ 0` y `≤ base_imponible`; `duracion_horas ∈
  {4,8,12}`; importes derivados del motor (salvo precio manual).

### Endpoints propuestos (contrato — lo cierra `contract-engineer` tras el gate)

- `POST /reservas/{id}/presupuesto/edicion/preview` → 200. Recalcula el borrador de
  la edición **sin persistir** (mismo patrón que el preview de US-014, ahora sobre
  una pre_reserva existente).
- `POST /reservas/{id}/presupuesto/edicion` → 201. Confirma la edición: crea
  `PRESUPUESTO version=anterior+1` (+ líneas `RESERVA_EXTRA`), `enviado` o
  `borrador` según `enviar`. Envío ⇒ E2 + AUDIT_LOG post-commit.
- `POST /reservas/{id}/presupuesto/reenvio` → 200. Reenvío sin cambios de la versión
  vigente (no crea versión; COMUNICACION E2 + AUDIT_LOG).

### Entidades tocadas

- `PRESUPUESTO`: **nuevas filas** (versión incremental); lectura del último por
  `(reservaId, version)`. **Sin cambios de esquema** (todos los campos ya existen).
- `RESERVA_EXTRA`: **primera persistencia real** de líneas de extras (US-014 nunca
  creó filas; solo pasaba extras al motor). Campos ya existen (`precio_unitario`,
  `origen`, `factura_id`, `cantidad`, `subtotal`). Ver `design.md` D3.
- `COMUNICACION`: nueva fila E2 en cada envío/reenvío (`es_reenvio=true` para
  esquivar el índice UNIQUE parcial `(reserva_id, codigo_email) WHERE es_reenvio=
  false`, patrón US-028/US-023).
- `AUDIT_LOG`: `accion='actualizar'` en cada edición confirmada / reenvío.
- `RESERVA` y `FECHA_BLOQUEADA`: **NO se mutan** (estado y `ttl_expiracion` intactos).

**Sin migración de esquema prevista** salvo lo que decida el gate sobre `RESERVA_EXTRA`
(ver `design.md`).

### Trazabilidad

- **US**: `US-015` (todos los criterios BDD §Happy Path, §Flujos Alternativos,
  §Reglas de Validación).
- **UC**: UC-15 (editar/reenviar presupuesto en pre_reserva).
- **ER**: `er-diagram §3.11 PRESUPUESTO`, `§RESERVA_EXTRA`, `§COMUNICACION`,
  `§AUDIT_LOG`.
- **Depende de**: US-014 (archivada), US-016 (archivada).

## Impact

- Specs afectadas: `openspec/specs/presupuestos/spec.md` (ADDED: requisitos de
  edición versionada, precio congelado de extras, reenvío sin cambios, invariantes
  de no-mutación de RESERVA/FECHA_BLOQUEADA).
- Código (post-gate, fuera de este SDD): capability `presupuestos` (nuevo use-case
  de edición + reenvío, DTOs, controller, adaptadores UoW/reenvío), reutilizando
  motor de tarifa, desglose fiscal, numeración y disparo E2.
- Frontend: acción "Editar presupuesto" / "Reenviar" en la ficha de pre_reserva
  (E2E aplica).
- **Decisiones que requieren visto bueno humano** (ver `design.md`): (D1) gap de
  spec E2, (D2) modelo de versionado, (D3) primera persistencia de `RESERVA_EXTRA`.

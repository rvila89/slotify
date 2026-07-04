# Change: us-027-generar-borradores-liquidacion-fianza

## Why

US-027 (Crítica, UC-21 pasos 1–2 / UC-22 pasos 1–2, Automatización **A7**): **cuando la
RESERVA transita a `reserva_confirmada` y se activan los sub-procesos paralelos** de
liquidación y fianza (`liquidacion_status = pendiente` Y `fianza_status = pendiente`,
inicializados por US-021), el sistema genera automáticamente **dos documentos de cobro en
borrador** —la **factura de liquidación** (60 % + extras pendientes) y el **recibo de
fianza**— y **alerta al Gestor** para su revisión. Resuelve **D8** (elimina el cálculo
manual de la liquidación 60 % + extras y las hojas de cálculo externas), **D6**
(facturación centralizada y trazable desde el primer momento) y **D9**. (Fuente:
`US-027 §Historia`, `§Contexto de Negocio`, `§Impacto de Negocio`; UC-21, UC-22;
`er-diagram.md §3.12 FACTURA`, `§3.10 RESERVA_EXTRA`, `§TENANT_SETTINGS fianza_default_eur`,
`§RESERVA importe_liquidacion/liquidacion_status/fianza_status`.)

El cimiento ya existe en `master` / en las specs vivas y **se reutiliza, no se recrea**:

- **Trigger `reserva_confirmada` + activación de sub-procesos (US-021, capability
  `confirmacion`)**: la spec viva de `confirmacion` ya declara el requisito
  "Inicialización de los tres sub-procesos paralelos al confirmar" (`liquidacion_status =
  'pendiente'`, `fianza_status = 'pendiente'`) y el patrón "efecto posterior al commit"
  para la generación de facturas (mismo requisito de disparo de US-022). Este change
  **engancha** en ese mismo punto de activación la generación de los borradores de
  liquidación y fianza; su fallo NO revierte la confirmación ya realizada.
- **Importes congelados (US-021)**: la confirmación ya fijó `RESERVA.importe_liquidacion =
  importe_total − importe_senal` (60 % MVP, derivado del setting). Este change **consume**
  ese valor como base de la factura de liquidación; NO recalcula el porcentaje ni la tarifa.
- **Capability `facturacion` (US-022)**: ya define el agregado FACTURA, su desglose fiscal
  (base + IVA 21 % con redondeo contable derivando la base del total), la numeración
  `F-YYYY-NNNN`, la idempotencia por `(reserva_id, tipo)`, la generación de PDF post-commit
  reutilizando el mecanismo de US-014, el borrador inválido por datos fiscales y la
  aprobación/rechazo por el Gestor. Este change **extiende** esa capability a los tipos
  `liquidacion` y `fianza` **reutilizando** exactamente esa terminología, esos estados,
  ese desglose fiscal y esa numeración; NO redefine el agregado.
- **RESERVA_EXTRA (`er-diagram.md §3.10`)**: las líneas de extra con `factura_id IS NULL`
  se **leen** para sumarlas al total de la liquidación; su marcado con `factura_id` al
  emitir es de US posteriores (fuera de este change de borrador).
- **TENANT_SETTINGS.fianza_default_eur / iva_porcentaje**: ya en el modelo; se **leen**
  para el total del recibo de fianza y el desglose fiscal.
- **AUDIT_LOG (US-003+)**: `accion = 'crear'` al crear cada FACTURA (liquidación y fianza).

(Fuente: ver `design.md` para firmas previstas, punto de enganche transaccional y
decisiones de reuso.)

## What Changes

> Slice vertical (backend + contrato + frontend "alerta + visualización de los borradores
> de liquidación y fianza"). Sujeto al **Gate de revisión humana SDD** (decisiones en
> `design.md`).

- **Generación automática de la FACTURA de liquidación (efecto de la activación de
  sub-procesos de US-021)**: al detectar `estado = 'reserva_confirmada'` Y
  `liquidacion_status = 'pendiente'`, el sistema crea **una** fila FACTURA con:
  - `tipo = 'liquidacion'`, `estado = 'borrador'`, `reserva_id`, `tenant_id`,
    `numero_factura = NULL`.
  - `total = RESERVA.importe_liquidacion + Σ(RESERVA_EXTRA.subtotal WHERE factura_id IS
    NULL)` de esa reserva.
  - Desglose fiscal derivado del total (mismo criterio que US-022): `base_imponible =
    round(total / 1,21, 2)`, `iva_importe = total − base_imponible`, `iva_porcentaje =
    21,00`.
  - Ejemplo del AC: `importe_liquidacion = 3.600 €` + extras `300 + 200 = 500 €` ⇒
    `total = 4.100,00 €`; `base_imponible = round(4100 / 1,21, 2) = 3.388,43 €`;
    `iva_importe = 4100 − 3388,43 = 711,57 €`.
  (Fuente: `US-027 §Happy Path`, `§Reglas de negocio`, `§Reglas de Validación`.)
- **Generación automática del recibo de fianza (FACTURA `tipo = 'fianza'`)**: el sistema
  crea **una** fila FACTURA con `tipo = 'fianza'`, `estado = 'borrador'`, `numero_factura =
  NULL`, `total = TENANT_SETTINGS.fianza_default_eur`, `reserva_id`, `tenant_id`.
- **Edge case `fianza_default_eur = 0` → NO se genera el recibo de fianza**: si el importe
  de fianza configurado es 0, el sistema **omite** la creación de la FACTURA de fianza;
  `RESERVA.fianza_status` **permanece `pendiente`** (el Gestor puede generarla luego con un
  importe negociado); la alerta al Gestor menciona **solo** la factura de liquidación.
  (Fuente: `US-027 §TENANT_SETTINGS.fianza_default_eur = 0`.)
- **Edge case sin RESERVA_EXTRA pendientes**: si no hay líneas con `factura_id IS NULL`, la
  factura de liquidación tiene `total = RESERVA.importe_liquidacion` (solo el 60 % sin
  extras); el recibo de fianza se genera igualmente. (Fuente: `US-027 §Reserva sin
  RESERVA_EXTRA pendientes`.)
- **Idempotencia (una liquidación y una fianza por reserva)**: antes de crear cada
  documento, el sistema comprueba si ya existe una FACTURA con ese `reserva_id` y ese
  `tipo` en `borrador`/`enviada`; si existe, **no duplica**. Garantizado a nivel de BD por
  el constraint `UNIQUE(reserva_id, tipo)` (ya introducido en US-022; cubre `senal`,
  `liquidacion` y `fianza`). Reinvocación del trigger sin efecto secundario. (Fuente:
  `US-027 §Idempotencia — trigger duplicado`, `§Reglas de Validación`.)
- **Alerta al Gestor en la UI**: tras generar los borradores, el sistema alerta al Gestor
  "Documentos de liquidación y fianza pendientes de revisión". Si la fianza se omitió
  (`fianza_default_eur = 0`), la alerta menciona **solo** la liquidación. (Fuente:
  `US-027 §Happy Path`, `§fianza_default_eur = 0`.)
- **Auditoría**: `AUDIT_LOG` con `accion = 'crear'`, `entidad = 'FACTURA'` por cada
  documento creado (liquidación y, si procede, fianza). (Fuente: `US-027 §Happy Path`.)
- **Frontend "Documentos de liquidación y fianza (borrador)"**: en la ficha de una RESERVA
  en `reserva_confirmada`, el Gestor ve la **alerta** de documentos pendientes y los
  borradores de liquidación y fianza (tipo, desglose, total, estado `borrador`, número
  `NULL` hasta emitir). Responsive mobile-first (390/768/1280). La **aprobación/emisión**
  de estos borradores (asignación de `numero_factura`, marcado de RESERVA_EXTRA, envío E4)
  es US-028, fuera de este change.

## Impact

- Specs: **modifica la capability `facturacion`** (ADDED requirements para la generación
  automática de la **factura de liquidación** —total = 60 % + extras pendientes— y del
  **recibo de fianza** en borrador al activar los sub-procesos, el edge case
  `fianza_default_eur = 0`, la idempotencia por `(reserva_id, tipo)` extendida a los nuevos
  tipos, la alerta al Gestor y la auditoría). **Modifica la capability `confirmacion`**
  (ADDED requirement que concreta que la activación de los sub-procesos de liquidación y
  fianza —ya inicializados por US-021— **dispara** la generación de los borradores como
  efecto posterior al commit, cuyo fallo no revierte la confirmación). El desglose fiscal,
  la numeración diferida a la emisión y el borrador inválido por datos fiscales **reutilizan**
  los requisitos ya vivos de `facturacion` (US-022) sin redefinirlos.
- Contrato OpenAPI (`docs/api-spec.yml`): se prevé **extender** el recurso de facturas de la
  reserva para exponer los borradores de liquidación y fianza (ver `design.md §D-5`, input
  para la fase de contrato). La **creación** no es un endpoint público: es efecto de la
  activación de sub-procesos de US-021 (post-commit). El `contract-engineer` (post-gate) lo
  definirá; **no se toca `docs/api-spec.yml` en este change de spec**. No se edita el cliente
  generado a mano.
- Código (implementación posterior, fuera de este change de spec):
  `apps/api/src/facturacion/{domain,application,infrastructure,interface}/**` (use-case de
  generación de los borradores de liquidación y fianza, cálculo del total de liquidación
  —60 % + Σ extras pendientes— en dominio puro reutilizando el desglose fiscal de US-022,
  guarda de idempotencia por `(reserva_id, tipo)`, AUDIT_LOG), integración con el punto de
  activación post-commit de `confirmacion` (`apps/api/src/confirmacion/**`), y
  `apps/web/src/features/facturacion/**` (alerta + visualización de los borradores). La
  ubicación exacta se fija en `design.md`.
- **Migración**: **no prevista**. La tabla FACTURA ya tiene todas las columnas necesarias y
  los constraints `UNIQUE(reserva_id, tipo)` y `UNIQUE(tenant_id, numero_factura)` se
  introdujeron en US-022; `numero_factura` es nullable (borrador). Los tipos `liquidacion`
  y `fianza` ya existen en el enum `TipoFactura` (`er-diagram.md §3.12`). Si el desarrollo
  detectara la falta de un tipo en el enum, se evalúa en implementación.
- Trazabilidad: **US-027**, **UC-21** (pasos 1–2), **UC-22** (pasos 1–2), **A7**; entidades
  FACTURA, RESERVA, RESERVA_EXTRA, TENANT_SETTINGS, AUDIT_LOG.
- Dependencias (todas archivadas en `master`): **US-021** (transición a
  `reserva_confirmada` + `importe_liquidacion` congelado + sub-procesos activados = trigger),
  **US-022** (capability `facturacion`: agregado FACTURA, desglose fiscal, numeración,
  idempotencia, PDF, aprobación; la factura de señal 40 % ya emitida — este change **no
  duplica** ese 40 %), US-003+ (AUDIT_LOG).

## Lo que NO entra (anti-scope)

- **Emisión/aprobación de los borradores (US-028)**: la asignación de `numero_factura`
  `F-YYYY-NNNN`, el paso `borrador → enviada`, la fijación de `fecha_emision`, el marcado de
  los `RESERVA_EXTRA` con `factura_id` y el **envío del email E4** son US-028. Este change
  solo **crea los borradores** y **alerta** al Gestor; `numero_factura` queda `NULL`.
- **Envío del email E4**: no se dispara en este paso; E4 se dispara tras la aprobación del
  Gestor (US-028). (Fuente: `US-027 §Email relacionado`.)
- **Generación del PDF de la liquidación/fianza**: aunque el mecanismo de PDF de US-022 está
  disponible, la US-027 acota su Happy Path a la **creación del borrador + desglose + alerta**;
  el PDF de estos documentos se aborda con su emisión (US-028). Si el equipo decide generar el
  PDF del borrador de forma anticipada, se reutiliza el puerto/adaptador de US-022 sin cambiar
  el dominio (se deja como decisión de implementación, no como requisito de este change).
- **Factura complementaria post-evento** (extras pedidos tras emitida la liquidación) y
  `RESERVA_EXTRA` con `origen = anadido_post_confirmacion` posteriores a la emisión: lista
  negra 📐 del MVP (`US-027 §Notas de alcance`).
- **Conciliación de PAGO / cobro de la liquidación o la fianza** (`enviada → cobrada`,
  `liquidacion_status → cobrada`, `fianza_status → cobrada`): US posteriores.
- **Motor de tarifa / recálculo**: el `total` de la liquidación parte de
  `RESERVA.importe_liquidacion` (congelado en US-021) + Σ de subtotales ya congelados en
  `RESERVA_EXTRA`. Este change **no recalcula** tarifa ni porcentaje.

## Decisiones de alcance pendientes de aprobación humana

Las decisiones de diseño están **razonadas con recomendación** en `design.md` y quedan
**abiertas hasta el OK del Gate SDD**. En particular:
- **D-1**: **punto de enganche** de la generación de los borradores en la activación de
  sub-procesos de US-021 (efecto posterior al commit, no dentro de la transacción crítica
  del `FOR UPDATE`), consistente con el disparo post-commit de US-022; su fallo no revierte
  la confirmación.
- **D-2**: **cálculo del total de la liquidación** — `importe_liquidacion + Σ(subtotal WHERE
  factura_id IS NULL)`; desglose fiscal reutilizando el dominio puro de US-022.
- **D-3**: **recibo de fianza** — `total = fianza_default_eur`; edge case `= 0` ⇒ NO se
  genera, `fianza_status` sigue `pendiente`, alerta solo de liquidación.
- **D-4**: **idempotencia** por `(reserva_id, tipo)` extendida a `liquidacion` y `fianza`
  (guarda de existencia + constraint UK ya existente de US-022).
- **D-5**: **contrato** — extender la exposición de facturas de la reserva a los borradores
  de liquidación y fianza (input para la fase de contrato).
- **D-6**: **alerta al Gestor** — un único aviso "Documentos de liquidación y fianza
  pendientes de revisión" (o solo liquidación si la fianza se omitió).

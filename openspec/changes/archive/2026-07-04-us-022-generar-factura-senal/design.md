# Design — us-022-generar-factura-senal

> Decisiones técnicas no triviales de la generación de la factura de señal (efecto
> post-commit de la transición `pre_reserva → reserva_confirmada` de US-021). Todas quedan
> **abiertas hasta el OK del Gate SDD**.
> Trazabilidad: US-022, UC-18; `er-diagram.md §3.12 FACTURA`, `§CLIENTE`, `§TENANT`,
> `§TENANT_SETTINGS`; `CLAUDE.md`; decisiones del usuario aprobadas (alcance front+back,
> reuso del mecanismo de PDF de US-014/US-021).

## Contexto

US-021 dejó la RESERVA en `reserva_confirmada` con `importe_senal` congelado y su spec ya
declara "presentar la factura de señal en borrador tras confirmar (disparo US-022)". US-022
**implementa ese disparo**: genera la FACTURA `tipo = 'senal'` en `borrador` con el desglose
fiscal del 40 %, la numera `F-YYYY-NNNN`, genera su PDF y la ofrece al Gestor para aprobar o
rechazar antes de E3. El cimiento ya está en `master` (tabla FACTURA, enums `TipoFactura`/
`EstadoFactura`, `TipoDocumento.factura`, `TENANT_SETTINGS.pct_senal`, datos fiscales de
TENANT y CLIENTE, y el patrón puerto/adaptador de PDF de `presupuestos`); este change
**reutiliza** esas primitivas y puebla el módulo `apps/api/src/facturacion/` (hoy esqueleto).

## D-1 — Nueva capability `facturacion` vs extender `confirmacion`

**Decisión (recomendada): crear la capability `facturacion`.** La FACTURA es un **agregado
raíz propio** con ciclo de vida (`borrador → enviada → cobrada`), numeración fiscal
secuencial, desglose contable (base/IVA) y reglas de aprobación. Ese dominio crecerá con
UC-21 (factura de liquidación 60 %), fianza y complementarias, y con la conciliación de PAGO.
Mantenerlo separado de `confirmacion` (justificante + FICHA_OPERATIVA + sub-procesos) y de
`consultas` (ciclo de vida del lead) preserva la cohesión, igual que US-014 separó
`presupuestos`.

- **Alternativa descartada**: meter la generación de la factura en `confirmacion`. Rompería
  la cohesión y sobredimensionaría `confirmacion`, que ya orquesta la transición de estado.
- **Módulo backend**: `apps/api/src/facturacion/{domain,application,infrastructure,interface}`
  ya existe como esqueleto vacío (scaffolding); este change lo puebla respetando la
  arquitectura hexagonal (dominio sin infraestructura ni framework).
- **Coordinación con `confirmacion`**: la creación de la factura es un **efecto post-commit**
  del use-case de confirmación de US-021, no parte de su transacción crítica (que sostiene el
  `FOR UPDATE` sobre `FECHA_BLOQUEADA`). `confirmacion` invoca `GenerarFacturaSenalUseCase`
  tras commitear la transición; su fallo NO revierte la confirmación (la reserva ya está
  confirmada). Espejo exacto del patrón "PDF + E2 post-commit" de US-014.

## D-2 — Desglose fiscal y redondeo contable

**Decisión: derivar la base del total, no al revés.**
- `total = RESERVA.importe_senal` (= `round(importe_total × pct_senal / 100, 2)`, congelado
  en US-021; 40 % MVP). La factura de señal **no recalcula** el porcentaje ni la tarifa.
- `iva_porcentaje = 21,00` (fijo IVA general MVP).
- `base_imponible = round(total / 1,21, 2)`.
- `iva_importe = total − base_imponible` (por resta, **no** `round(base × 0,21)`), de modo
  que `base_imponible + iva_importe = total` **exactamente**, sin desajuste de céntimos por
  doble redondeo. (Espejo del criterio de US-021 D-3 para señal/liquidación.)
- **Redondeo contable**: mitad hacia arriba (half-up) a 2 decimales (`US-022 §Reglas de
  Validación`). El cálculo del desglose vive en **dominio puro** (función de flecha
  inmutable, testeable sin BD), como `presupuestos/domain/desglose-fiscal.ts`.
- **Ejemplo del AC**: `importe_total = 3.000,00`, `pct_senal = 40` ⇒ `total = 1.200,00`;
  `base_imponible = round(1200 / 1,21, 2) = 991,74`; `iva_importe = 1200 − 991,74 = 208,26`.

## D-3 — Numeración `F-YYYY-NNNN` secuencial por tenant + año

**Decisión: número `F-{año}-{NNNN}` con `YYYY` = año de emisión (año calendario en curso) y
`NNNN` = secuencia del tenant reiniciada por año; unicidad por `UNIQUE(tenant_id,
numero_factura)`.**
- El siguiente `NNNN` se calcula como `MAX(NNNN) + 1` entre las facturas del `tenant_id` cuyo
  `numero_factura` empieza por `F-{año}-`, con **padding a 4 dígitos** (`0001`). Al ser el año
  parte del literal del número, la unicidad `(tenant_id, numero_factura)` cubre implícitamente
  "único por tenant + año".
- **Por qué el año va embebido en el número y no en columna aparte**: el modelo actual
  (`er-diagram.md §3.12`, `schema.prisma`) no tiene columna `año`; añadirla sería un cambio
  mayor. El año de emisión es determinista desde el literal `F-YYYY-NNNN`. Alternativa
  descartada: columna `anio` + `UNIQUE(tenant_id, anio, secuencia)` (más normalizado pero
  exige más migración; se puede adoptar en UC-21 si hiciera falta).
- **Cambio de constraint (migración, D-7)**: hoy `numero_factura` es `@unique` **global**;
  se sustituye por `@@unique([tenantId, numeroFactura])`. Un `F-2026-0001` puede existir para
  dos tenants distintos (correcto en multi-tenant), pero no dos veces para el mismo tenant.

## D-4 — Idempotencia: una factura de señal por reserva

**Decisión: guarda de existencia (`findByReservaIdAndTipo`) + constraint
`UNIQUE(reserva_id, tipo)` como red de seguridad.** Antes de crear, el use-case comprueba si
ya existe `FACTURA WHERE reserva_id = X AND tipo = 'senal'`; si existe, **devuelve la
existente** sin duplicar y registra el intento en `AUDIT_LOG`. Si dos disparos concurrentes
del trigger sortean la guarda, el constraint UK aborta la segunda inserción (`P2002`) y el
use-case recupera la existente. Espejo del criterio de idempotencia de FICHA_OPERATIVA
(US-021 D-4).

## D-5 — Generación de PDF: reutilizar el mecanismo de US-014/US-021

**Decisión (aprobada por el usuario): reutilizar el patrón puerto/adaptador de PDF ya
existente, no crear uno nuevo.**
- **Puerto de dominio** `GenerarPdfFacturaPort` (espejo de `GenerarPdfPresupuestoPort` de
  `presupuestos/application`): recibe los datos fiscales de emisor (TENANT) y receptor
  (CLIENTE), concepto, desglose y total; devuelve la `pdf_url`.
- **Adaptador de infraestructura FAKE determinista** (espejo de
  `PdfPresupuestoFakeAdapter`): devuelve una `pdf_url` sintética sin tocar red ni disco en el
  MVP; el render real (Puppeteer/react-pdf) es un adaptador diferido enchufable sin cambiar el
  dominio.
- **Post-commit e idempotente sobre `pdf_url`**: la FACTURA se crea primero en `borrador`
  (dentro de la transacción de creación + numeración); el PDF se genera **después** y
  actualiza `pdf_url` en un UPDATE idempotente (mismo patrón que `PRESUPUESTO.pdf_url` de
  US-014, `er-diagram.md §3.11` paso 3). La generación de PDF fuera de la transacción evita
  sostener locks durante una operación potencialmente lenta.
- **Datos del PDF**: emisor `TENANT.nombre/nif/iban/direccion`; receptor
  `CLIENTE.nombre/apellidos/dni_nif/direccion/codigo_postal/poblacion/provincia`; concepto,
  desglose (base/IVA/total) y número de factura.

## D-6 — Endpoints e input para la fase de contrato

**Previsto (input al `contract-engineer`, post-gate; NO se toca `docs/api-spec.yml` en este
change de spec):**
- `GET /reservas/{id}/factura-senal` — devuelve el borrador de la factura de señal de la
  reserva (número, tipo, estado, desglose, total, `pdf_url`, flags `esBorradorInvalido` /
  `pdfPendiente`).
- `POST /facturas/{id}/aprobar` — borrador → enviada; fija `fecha_emision`. Precondición: PDF
  disponible y datos fiscales válidos (si no, `409`/`422` con el motivo del bloqueo).
- `POST /facturas/{id}/rechazar` — body con `motivo`; permanece en `borrador`, registra el
  motivo, E3 bloqueado.
- `POST /facturas/{id}/regenerar-pdf` — reintento manual de la generación del PDF (además del
  reintento automático); idempotente sobre `pdf_url`.
- **La creación NO es endpoint público**: es efecto post-commit del disparo de US-021 (más el
  job/reintento del PDF). Errores mapeados: `409` "La factura no está en borrador" (aprobar
  sobre no-borrador); `422` "Datos fiscales del cliente incompletos" / "PDF pendiente de
  regenerar" (aprobación bloqueada); `404` factura/reserva inexistente.

El cliente HTTP del frontend se **genera** desde el contrato, nunca se edita a mano (hook
`protect-generated-client`).

## D-7 — Migración

**Prevista (única migración estructural).** La tabla FACTURA ya tiene todas las columnas
(`numero_factura`, `tipo`, `base_imponible`, `iva_porcentaje`, `iva_importe`, `total`,
`concepto`, `pdf_url`, `estado`, `fecha_emision`) en `er-diagram.md §3.12` y `schema.prisma`.
La migración aditiva debe:
1. **Sustituir** `numeroFactura @unique` (global) por `@@unique([tenantId, numeroFactura])`
   (numeración por tenant; el año va embebido en el literal, D-3).
2. **Añadir** `@@unique([reservaId, tipo])` para la idempotencia de la factura por reserva y
   tipo (D-4).

No se prevén columnas nuevas. Si el desarrollo detectara la necesidad de una columna de
"motivo de rechazo" o "borrador inválido", se evalúa en implementación; en principio el motivo
de rechazo se registra en `AUDIT_LOG` (no en la FACTURA) y los flags de validez del borrador
se derivan (PDF null + datos fiscales) sin columna adicional.

## D-8 — Concurrencia: colisión de `numero_factura` entre reservas distintas

**Decisión: resolver la colisión con el constraint UK + reintento con el siguiente número
(no con locks distribuidos).**
- Dos reservas **distintas** del mismo tenant confirmadas en el mismo instante calculan el
  mismo `MAX(NNNN) + 1` y ambas intentan insertar `F-YYYY-0002`. El constraint
  `UNIQUE(tenant_id, numero_factura)` hace que **una** inserción falle (`P2002`); la
  aplicación **captura el `P2002`, recalcula el siguiente número y reintenta** (bucle acotado
  de reintentos). Resultado: dos facturas con números consecutivos, sin duplicados ni huecos
  no controlados.
- **Regla dura del proyecto**: **nunca Redis/Redlock** (hook `no-distributed-lock`). La
  serialización es del motor SQL vía el constraint UK + reintento aplicativo (patrón "retry on
  unique violation"), no un lock distribuido.
- Esta zona crítica se cubre con **tests de concurrencia reales** (skill `concurrency-locking`)
  en TDD-RED: N transacciones simultáneas generando factura de señal para reservas distintas
  del mismo tenant, verificando que todas obtienen un `numero_factura` único y consecutivo y
  que no hay ninguna sin número.

## D-9 — Borrador inválido (datos fiscales) vs PDF pendiente (fallo temporal)

**Decisión: distinguir los dos bloqueos de la aprobación por su causa y su mensaje.**
- **Datos fiscales del cliente incompletos** (`CLIENTE.dni_nif` o dirección fiscal nulos): la
  FACTURA se crea en `borrador` pero **no se genera el PDF** (`pdf_url = null`); se marca
  inválida con "Datos fiscales incompletos"; la aprobación se bloquea hasta completar los
  datos del cliente. Es un fallo de **datos**: no se reintenta solo, requiere acción del
  Gestor sobre el CLIENTE.
- **Error temporal del servicio de PDF**: la FACTURA se crea en `borrador` con `pdf_url =
  null`; se registra "PDF pendiente de regenerar"; el sistema **reintenta automáticamente**
  (patrón post-commit idempotente) y la aprobación se bloquea hasta que el PDF exista. Es un
  fallo **transitorio**: se reintenta.
- **Rechazo del Gestor**: la FACTURA permanece en `borrador`, el motivo va a `AUDIT_LOG`, E3
  bloqueado; el Gestor corrige (p. ej. datos del tenant) y regenera el PDF.
- En los tres casos **`estado` sigue siendo `borrador`** y **E3 queda bloqueado**; la
  diferencia es la causa, el mensaje al Gestor y si el sistema reintenta solo.

## Riesgos y mitigaciones

- **Doble redondeo en el desglose** (D-2): mitigado derivando `iva_importe` por resta del
  total, no como segundo `round`.
- **Colisión / hueco en la numeración** (D-3/D-8): mitigado con `UNIQUE(tenant_id,
  numero_factura)` + reintento acotado ante `P2002`; nunca locks distribuidos.
- **Factura de señal duplicada por reinvocación del trigger** (D-4): mitigado con guarda de
  existencia + `UNIQUE(reserva_id, tipo)`.
- **PDF que sostiene locks o revierte la confirmación** (D-1/D-5): mitigado generando el PDF
  **post-commit**, fuera de la transacción crítica; su fallo no revierte la confirmación (la
  factura queda en borrador con `pdf_url = null` y se reintenta).
- **Aprobar una factura sin datos fiscales válidos** (D-9): mitigado bloqueando la aprobación
  mientras el borrador sea inválido o el PDF no exista.

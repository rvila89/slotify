# Design — us-027-generar-borradores-liquidacion-fianza

> Decisiones técnicas no triviales de la generación automática de la **factura de
> liquidación** (60 % + extras pendientes) y el **recibo de fianza** en borrador, disparada
> por la activación de los sub-procesos paralelos de US-021 al transicionar a
> `reserva_confirmada`. Todas quedan **abiertas hasta el OK del Gate SDD**.
> Trazabilidad: US-027, UC-21 (pasos 1–2), UC-22 (pasos 1–2), A7; `er-diagram.md §3.12
> FACTURA`, `§3.10 RESERVA_EXTRA`, `§TENANT_SETTINGS fianza_default_eur/iva_porcentaje`,
> `§RESERVA importe_liquidacion/liquidacion_status/fianza_status`; specs vivas de
> `facturacion` (US-022) y `confirmacion` (US-021); `CLAUDE.md`.

## Contexto

US-021 dejó la RESERVA en `reserva_confirmada` con `importe_liquidacion` congelado
(`importe_total − importe_senal`, 60 % MVP) y los tres sub-procesos inicializados
(`pre_evento_status`, `liquidacion_status`, `fianza_status` = `pendiente`). US-022 creó la
capability `facturacion` con el agregado FACTURA y su factura de señal (`tipo = 'senal'`),
definiendo ya el **desglose fiscal** (base derivada del total, IVA 21 %, redondeo contable),
la **numeración `F-YYYY-NNNN`** diferida a la emisión, la **idempotencia por `(reserva_id,
tipo)`** (constraint UK ya migrado) y el patrón de **efecto post-commit** para la
generación. US-027 **extiende `facturacion`** a los tipos `liquidacion` y `fianza`:
al activarse los sub-procesos de liquidación y fianza, genera **ambos borradores** y
**alerta al Gestor**. Reutiliza el desglose fiscal, la idempotencia y el módulo backend
`apps/api/src/facturacion/` ya poblado por US-022; **no** redefine el agregado.

## D-1 — Punto de enganche: efecto post-commit de la activación de sub-procesos (US-021)

**Decisión (recomendada): enganchar la generación de los borradores como efecto
**posterior al commit** de la transición a `reserva_confirmada`, en el mismo punto donde
US-022 dispara la factura de señal, NO dentro de la transacción crítica de US-021.**

- **Tensión con el texto de la US**: US-027 §Reglas de negocio dice "ambos borradores se
  crean en la misma transacción atómica con la activación de sub-procesos". Sin embargo, la
  spec viva de `confirmacion` (US-021, ya archivada) modela la generación de facturas como
  **efecto posterior al commit** (requisito "Presentación de la factura de señal en borrador
  tras confirmar (disparo US-022)"), y la spec viva de `facturacion` (US-022) fija que "el
  fallo de esta generación NO revierte la confirmación ya realizada". Reabrir la transacción
  crítica de US-021 (que sostiene el `FOR UPDATE` sobre `FECHA_BLOQUEADA`) para meter dentro
  la creación de facturas sería **incoherente** con lo ya archivado y arriesgaría sostener
  locks durante operaciones de facturación.
- **Resolución**: interpretar "misma transacción atómica" como **"disparado por el mismo
  evento de activación, de forma atómica entre sí"**: la creación de los **dos borradores**
  (liquidación + fianza) se hace en **una transacción propia de facturación** (atómica entre
  los dos documentos y sus AUDIT_LOG), invocada **tras el commit** de la confirmación de
  US-021. Espejo exacto del disparo post-commit de US-022. Su fallo NO revierte la
  confirmación (la RESERVA permanece en `reserva_confirmada`) y es reintentable por
  idempotencia (D-4).
- **Coordinación con `confirmacion`**: el use-case de confirmación de US-021 ya invoca
  `GenerarFacturaSenalUseCase` post-commit; este change añade la invocación de
  `GenerarBorradoresLiquidacionFianzaUseCase` (nombre provisional) en el mismo punto.
- **Alternativa descartada**: meter la creación de las facturas dentro de la transacción de
  US-021. Rompería la coherencia con las specs vivas de `confirmacion`/`facturacion`, exigiría
  reabrir un requisito archivado y sostendría el `FOR UPDATE` durante la facturación.
- **Nota para el Gate**: esta es la decisión de diseño más relevante a validar por el humano
  (literalidad de "misma transacción" vs coherencia con lo archivado). Recomendación: post-commit.

## D-2 — Cálculo del total de la liquidación y desglose fiscal (reuso de US-022)

**Decisión: `total = importe_liquidacion + Σ(RESERVA_EXTRA.subtotal WHERE factura_id IS
NULL)`; el desglose fiscal reutiliza el dominio puro de US-022 (base derivada del total).**

- `importe_liquidacion` viene **congelado** de US-021 (`importe_total − importe_senal`,
  60 % MVP); este change NO recalcula el porcentaje ni la tarifa.
- **Extras pendientes**: se suman los `RESERVA_EXTRA.subtotal` de la reserva con `factura_id
  IS NULL` en el **momento de la generación** (`er-diagram.md §3.10`, `§636`). Los
  `subtotal` (= `cantidad × precio_unitario`) ya están congelados por línea; se **suman**,
  no se recalculan. Este change **no marca** los `RESERVA_EXTRA` con `factura_id` (ese
  marcado ocurre al **emitir**, US-028): en borrador el vínculo aún no se fija.
- **Desglose fiscal (idéntico a US-022)**: `iva_porcentaje = 21,00`; `base_imponible =
  round(total / 1,21, 2)`; `iva_importe = total − base_imponible` (por resta, no
  `round(base × 0,21)`), de modo que `base_imponible + iva_importe = total` **exactamente**.
  Redondeo contable a 2 decimales (mitad hacia arriba). Se **reutiliza la función de dominio
  puro** de desglose fiscal ya creada en US-022 (`facturacion/domain`), no se duplica.
- **Ejemplo del AC**: `importe_liquidacion = 3.600,00` + extras `(300 + 200) = 500,00` ⇒
  `total = 4.100,00`; `base_imponible = round(4100 / 1,21, 2) = 3.388,43`; `iva_importe =
  4100 − 3388,43 = 711,57`. Sin extras pendientes ⇒ `total = 3.600,00`.

## D-3 — Recibo de fianza y edge case `fianza_default_eur = 0`

**Decisión: `FACTURA tipo = 'fianza'` con `total = TENANT_SETTINGS.fianza_default_eur`; si
el importe es 0, NO se genera el recibo y `fianza_status` sigue `pendiente`.**

- El recibo de fianza es una FACTURA `tipo = 'fianza'`, `estado = 'borrador'`,
  `numero_factura = NULL`, `total = fianza_default_eur`. Se aplica el **mismo desglose
  fiscal** que la liquidación (base + IVA 21 %), salvo indicación contraria en implementación
  (una fianza podría no llevar IVA; **decisión de implementación** a validar contra el
  modelo fiscal del tenant — la US no lo precisa y la spec viva de `facturacion` deriva
  siempre el desglose del total, por lo que se mantiene ese criterio salvo excepción
  documentada).
- **Edge case `fianza_default_eur = 0`**: el sistema **omite** la creación de la FACTURA de
  fianza; `RESERVA.fianza_status` **permanece `pendiente`** (no se marca como facturada ni se
  crea documento); la alerta al Gestor menciona **solo la liquidación**. El Gestor podrá
  generar el recibo manualmente con un importe negociado en una US posterior. (Fuente:
  `US-027 §TENANT_SETTINGS.fianza_default_eur = 0`.)
- La generación de la liquidación y la de la fianza son **independientes**: la ausencia de
  fianza (importe 0) NO impide la creación de la factura de liquidación, y viceversa.

## D-4 — Idempotencia: una liquidación y una fianza por reserva (reuso de US-022)

**Decisión: guarda de existencia por `(reserva_id, tipo)` + constraint `UNIQUE(reserva_id,
tipo)` (ya migrado en US-022) como red de seguridad.**

- Antes de crear cada documento, el use-case comprueba si ya existe `FACTURA WHERE
  reserva_id = X AND tipo = 'liquidacion'` (resp. `'fianza'`) en `borrador`/`enviada`; si
  existe, **no crea un duplicado** (operación idempotente, sin efecto secundario).
- El constraint `UNIQUE(reserva_id, tipo)` introducido en US-022 ya cubre los tres tipos
  (`senal`, `liquidacion`, `fianza`): si dos disparos concurrentes del trigger sortean la
  guarda, la segunda inserción aborta (`P2002`) y el use-case recupera la existente. **No se
  requiere migración nueva** (D-7 de US-022 ya dejó el constraint).
- **Regla de validación (US-027)**: "máximo una FACTURA de tipo `liquidacion` y una de tipo
  `fianza` por `reserva_id` en `borrador` o `enviada`". La guarda considera ambos estados
  para no recrear un borrador si ya se emitió (enviada) por US-028.

## D-5 — Contrato: exposición de los borradores de liquidación y fianza

**Previsto (input al `contract-engineer`, post-gate; NO se toca `docs/api-spec.yml` en este
change de spec):**
- **Extender la exposición de facturas de la reserva** para que el frontend pueda leer los
  borradores de liquidación y fianza además del de señal. Opciones a decidir en la fase de
  contrato (recomendación: colección):
  - `GET /reservas/{id}/facturas` — devuelve la colección de facturas de la reserva (señal,
    liquidación, fianza) con `tipo`, `estado`, desglose, `total`, `numero_factura` (nullable),
    y flags de la alerta; **o**
  - endpoints por tipo espejo del de señal de US-022 (`GET /reservas/{id}/factura-liquidacion`,
    `GET /reservas/{id}/factura-fianza`).
- **La creación NO es endpoint público**: es efecto de la activación de sub-procesos de
  US-021 (post-commit). La **aprobación/emisión** (asignar `numero_factura`, `borrador →
  enviada`, marcar RESERVA_EXTRA, E4) es US-028, fuera de este change.
- El cliente HTTP del frontend se **genera** desde el contrato, nunca se edita a mano (hook
  `protect-generated-client`).

## D-6 — Alerta al Gestor

**Decisión: una única alerta "Documentos de liquidación y fianza pendientes de revisión"
tras generar los borradores; si la fianza se omitió (`fianza_default_eur = 0`), la alerta
menciona solo la liquidación.**

- La alerta es una señal de UI (badge/aviso en la ficha de la reserva y/o listado de
  facturas), NO un email (E4 es US-028). El mecanismo concreto (columna de estado derivada,
  notificación in-app) se fija en implementación reutilizando el patrón de avisos ya usado
  por US-022 para el borrador de señal ("Datos fiscales incompletos" / "PDF pendiente").
- El texto exacto de la US es literal: "Documentos de liquidación y fianza pendientes de
  revisión" (o solo "de liquidación" en el edge case de fianza omitida).

## D-7 — Migración

**Desviación respecto a lo previsto (aplicada en implementación).** El diseño original no
preveía migración porque se asumía `numero_factura` ya nullable. En implementación se detectó
que la columna estaba **`NOT NULL`**, y los borradores de este change requieren
`numero_factura = NULL` (la numeración se difiere a la emisión, US-028). Se añadió la migración
`20260704130000_us027_numero_factura_nullable`:

```sql
ALTER TABLE "factura" ALTER COLUMN "numero_factura" DROP NOT NULL;
```

Es **aditiva/no destructiva** y **no** rompe `UNIQUE(tenant_id, numero_factura)`: en PostgreSQL
los valores `NULL` no colisionan en un índice único, por lo que múltiples borradores con
`numero_factura = NULL` coexisten sin violar la restricción. La desviación queda reflejada
también en `schema.prisma` (`numeroFactura String?`) y en la documentación de datos
(`docs/data-model.md §3.12` y `docs/er-diagram.md §3.12`). El resto de columnas (`tipo`,
`base_imponible`, `iva_porcentaje`, `iva_importe`, `total`, `concepto`, `estado`,
`fecha_emision`, `pdf_url`), el constraint `UNIQUE(reserva_id, tipo)` y los tipos `liquidacion`
y `fianza` del enum `TipoFactura` ya existían desde US-022 y no requieren migración.

## D-8 — Concurrencia

**Sin numeración en este change → sin la zona crítica de colisión de `numero_factura` de
US-022.** Como `numero_factura = NULL` en borrador (la numeración se asigna al emitir,
US-028), este change **no** reabre la concurrencia de la numeración. La única concurrencia
relevante es la **reinvocación del trigger** de activación de sub-procesos, cubierta por la
idempotencia de D-4 (guarda + `UNIQUE(reserva_id, tipo)` + reintento ante `P2002`). Se cubre
con tests de idempotencia (dos disparos concurrentes de la misma reserva no duplican los
borradores). **Nunca** locks distribuidos (hook `no-distributed-lock`).

## Riesgos y mitigaciones

- **Literalidad "misma transacción" vs post-commit** (D-1): mitigado eligiendo el patrón
  post-commit coherente con las specs vivas archivadas; se marca como la decisión clave a
  validar en el Gate SDD.
- **Doble redondeo en el desglose de la liquidación** (D-2): mitigado reutilizando la función
  de dominio puro de US-022 que deriva `iva_importe` por resta del total.
- **Duplicado de borradores por reinvocación del trigger** (D-4): mitigado con guarda de
  existencia + `UNIQUE(reserva_id, tipo)` (ya migrado en US-022).
- **Fianza con importe 0 dejando estado inconsistente** (D-3): mitigado NO generando el
  recibo y dejando `fianza_status = pendiente` explícitamente, con alerta solo de liquidación.
- **Marcar RESERVA_EXTRA en borrador** (D-2): mitigado NO fijando `factura_id` en la fase de
  borrador; el marcado se difiere a la emisión (US-028), evitando "capturar" extras que
  podrían cambiar antes de emitir.

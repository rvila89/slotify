# Design — documentos-presupuesto-sin-iva-doble-numeracion (6.2)

> **ESTADO: sub-decisiones RESUELTAS en el gate SDD (2026-07-14).** Las
> secciones D1–D6 conservan el análisis pero anteponen la **RESOLUCIÓN
> CONFIRMADA**. El cambio más relevante frente al análisis inicial: la variante
> SIN IVA **NO es solo presentación** — el **cálculo fiscal depende del
> régimen** (ver §"Impacto en el cálculo fiscal por régimen").

## Contexto y alcance técnico

Añadir tres cosas sobre el flujo de presupuesto de 6.1b, **sin romper** lo
existente (CON IVA sigue funcionando):

1. capturar `metodoPago` al generar el presupuesto y derivar el **régimen
   fiscal** (`transferencia ⇒ CON IVA`, `efectivo ⇒ SIN IVA`) con dominio puro;
2. **calcular el desglose fiscal y el total según el régimen** (CON IVA =
   base + IVA21; SIN IVA = base, sin IVA) y renderizar la **variante SIN IVA**
   del PDF (cabecera sin razón social fiscal/NIF + totales solo-Total),
   extendiendo el dominio, el modelo de vista y la plantilla ya compartida;
3. generalizar la numeración `AAAANNN` a **dos secuencias por
   tenant/año/régimen**, manteniendo el dominio puro y el reintento `P2002`
   discriminado de 6.1b.

El caso de uso `GenerarPresupuestoUseCase` recibe `metodoPago` en el comando,
deriva el régimen (dominio), calcula el desglose/total/reparto **según el
régimen** (dominio puro), y pasa el régimen a `crear(...)` y a la consulta
`ultimoNumeroDelAnio`, ahora discriminada por régimen. El PDF sigue siendo
**post-commit** (fuera del `FOR UPDATE`); su fallo devuelve `null` sin revertir
la pre_reserva.

## Impacto en el cálculo fiscal por régimen (RESOLUCIÓN CRÍTICA del gate)

**Decisión confirmada**: el cliente en efectivo **paga MENOS**: NO se le aplica
el 21%. El **total del presupuesto depende del régimen**, no solo su
presentación. La 6.2 **SÍ toca el cálculo fiscal**.

**Estado actual (6.1b)** — verificado en `presupuestos/domain/desglose-fiscal.ts`:
el motor de tarifa (US-016) y el precio manual del caso `tarifa_a_consultar`
devuelven un **total con IVA 21% incluido** (`totalConIva`). Hoy:
- `total = totalConIva − descuento`
- `baseImponible = total / 1.21`, `ivaImporte = total − base`, `ivaPorcentaje = 21`
- `calcularReparto` deriva señal 40% / liquidación 60% del **total (con IVA)**;
  `fianzaEur` es fijo del setting, aparte del total.

**Regla confirmada para 6.2**:
- La **base imponible** (concepto + extras, ya con descuento aplicado) es la
  **MISMA** en ambos regímenes. Es el valor `base = (totalConIva − descuento) /
  1.21` que ya se deriva hoy. Lo que cambia es **si se le suma el IVA**.
- **CON IVA** (transferencia): `total = base + IVA21` (comportamiento 6.1b:
  `total = totalConIva − descuento`, `ivaImporte = total − base`,
  `ivaPorcentaje = 21`).
- **SIN IVA** (efectivo): `total = base` (**el importe MENOR**);
  `ivaImporte = 0`, `ivaPorcentaje = 0` (o sin línea de IVA). Ejemplo del gate:
  base 1000 → CON IVA total 1210; SIN IVA total 1000.
- El **reparto 40/60 se calcula sobre el `total` del régimen**: para efectivo,
  señal = 40% del total SIN IVA (= 40% de la base) y liquidación = 60% del total
  SIN IVA. La **fiança** sigue siendo fija (500, del setting), aparte del total,
  **igual en ambos regímenes**.
- El **descuento** se aplica igual (sobre el importe con IVA de entrada, como
  hoy) antes de derivar la base; a confirmar en TDD que el orden
  descuento→base→régimen produce el importe esperado.

**Cómo se modela (dominio puro, TDD-RED primero)**:
- `calcularDesgloseFiscal` y `calcularReparto` pasan a recibir el **régimen**
  (`RegimenIva`) como entrada y ramifican el cálculo de forma **declarativa**
  (sin `if` dispersos por el use-case). Se mantiene la invariante contable a 2
  decimales (`base + IVA = total` en CON IVA; `IVA = 0`, `total = base` en SIN
  IVA). Siguen siendo funciones puras sin infra (hook `no-infra-in-domain`).
- El use-case NO recalcula tarifario: sigue delegando en el motor; solo cambia la
  **derivación fiscal** a partir de su salida, ahora dependiente del régimen.
- Se persisten en `Presupuesto` los importes ya congelados del régimen
  (`baseImponible`, `ivaPorcentaje`, `ivaImporte`, `total`), como hoy.

**El PDF** refleja lo persistido: SIN IVA muestra **solo el Total (= base)**, sin
línea base/IVA; el reparto 40/60/fiança que muestra es el del régimen.

## Decisiones fijadas (del encargo)

- **Método de pago se captura al generar presupuesto** (campo obligatorio en el
  request de confirmar y en el preview). No se añade a la reserva ni a un paso
  anterior.
- **Regla de negocio**: `transferencia ⇒ CON IVA`, `efectivo ⇒ SIN IVA`.
- **Doble numeración**: 2 secuencias por tenant/año/régimen, formato `AAAANNN`.
  El presupuesto la consume en 6.2; las facturas migran en 6.3 (NO se toca
  `F-YYYY-NNNN` ahora). CON y SIN no comparten contador.
- **Dominio puro**: `siguienteNumeroPresupuesto` ya calcula desde `ultimoNumero`;
  `MAX` y reintento `P2002` viven en infra, con el patrón discriminado por
  `meta.target` de 6.1b.
- **Migración aditiva y no destructiva**; RLS en toda columna/tabla nueva.

## Sub-decisiones (RESUELTAS en el gate SDD 2026-07-14)

### D1 — Nombre y valores del enum de régimen + campo `metodoPago`

**RESOLUCIÓN CONFIRMADA**: enums `RegimenIva {con_iva, sin_iva}` +
`MetodoPago {transferencia, efectivo}`; se **persisten AMBOS** (método elegido +
régimen derivado). Backfill de las filas de 6.1b a `metodo_pago = transferencia`
/ `regimen_iva = con_iva`.


**Contexto**: `Presupuesto` hoy no tiene ni método de pago ni régimen. El PDF y
la numeración se ramifican por régimen, no por método de pago (el método es la
entrada del gestor; el régimen es la consecuencia fiscal persistida y usada por
render + numeración).

**Propuesta**:

- **Enum de dominio `RegimenIva = 'con_iva' | 'sin_iva'`** (Prisma `enum
  RegimenIva { con_iva sin_iva }`), persistido como
  `Presupuesto.regimenIva RegimenIva` (`@map("regimen_iva")`).
- **`Presupuesto.metodoPago MetodoPago`** (`enum MetodoPago { transferencia
  efectivo }`, `@map("metodo_pago")`): se persiste **también** el método de pago
  elegido (auditoría / origen del régimen), no solo el régimen derivado.
- Ambos **nullable** en la migración (no destructiva); **backfill**:
  `regimen_iva = 'con_iva'` y `metodo_pago = 'transferencia'` para los
  presupuestos existentes (todos eran CON IVA en 6.1b). Tras el backfill, la
  aplicación siempre escribe ambos en la creación (nunca null en filas nuevas).
- Función de dominio pura `regimenDesdeMetodoPago(metodoPago): RegimenIva` en
  `presupuestos/domain/` (mapa declarativo, no `if` disperso).

### D2 — Modelado de la doble secuencia (dónde vive el contador por régimen)

**RESOLUCIÓN CONFIRMADA**: **Opción A**. Literal `AAAANNN` (`2026001`)
**COMPARTIDO** entre CON y SIN (sin embeber el régimen en el literal),
diferenciado por la columna `regimenIva` en la unicidad
`@@unique([tenantId, regimenIva, numeroPresupuesto])`. La consulta `MAX`
discrimina por régimen (`ultimoNumeroDelAnio(tenantId, anio, regimen)`) y el
reintento `P2002` se ancla al índice
`presupuesto_tenant_id_regimen_iva_numero_presupuesto_key`. La tabla contador
`SecuenciaDocumento` (Opción B) se **difiere a 6.3**.


**Contexto**: 6.1b usa una única secuencia por tenant/año calculada con `MAX` de
`numero_presupuesto` sobre `Presupuesto`, con `@@unique([tenantId,
numeroPresupuesto])` y reintento `P2002`. Hay que separarla por régimen sin que
CON y SIN colisionen.

**Dos opciones evaluadas**:

- **Opción A — discriminar por régimen la consulta `MAX` sobre `Presupuesto`**
  (mínimo cambio):
  - `ultimoNumeroDelAnio(tenantId, anio, regimen)` filtra por `regimen_iva`
    además del año y tenant.
  - La unicidad pasa a `@@unique([tenantId, regimenIva, numeroPresupuesto])` (o
    se mantiene `[tenantId, numeroPresupuesto]` si el número lleva el régimen
    embebido — ver más abajo).
  - **Riesgo**: si CON y SIN comparten el mismo literal `2026001`, la unicidad
    `[tenantId, numeroPresupuesto]` los haría colisionar. Por eso, con opción A
    la unicidad DEBE ser `[tenantId, regimenIva, numeroPresupuesto]` para
    permitir que ambas secuencias tengan `2026001`.
  - **Ventaja**: sin tabla nueva; reutiliza el reintento `P2002` (ahora sobre
    `presupuesto_tenant_id_regimen_iva_numero_presupuesto_key`).

- **Opción B — tabla contador `SecuenciaDocumento(tenant_id, anio, regimen,
  ultimo_numero)`** con `@@unique([tenantId, anio, regimen])`:
  - Un `UPDATE ... RETURNING`/upsert atómico incrementa el contador por
    `(tenant, anio, regimen)`; el número asignado sale de ahí.
  - **Ventaja**: contador explícito, reutilizable **directamente por las
    facturas en 6.3** (añadiendo `tipo_documento` o más regímenes) sin depender
    del `MAX` sobre cada tabla; serialización natural por fila.
  - **Coste**: tabla + RLS + migración nuevas; cambia el patrón de 6.1b (deja de
    ser `MAX` sobre `Presupuesto`).

**Propuesta (recomendada): Opción A** para 6.2, con
`@@unique([tenantId, regimenIva, numeroPresupuesto])`, porque:
- Es el cambio mínimo sobre 6.1b (reutiliza `MAX` + reintento `P2002`, solo
  añade el filtro por régimen y amplía la unicidad).
- El literal `2026001` puede coexistir en CON y SIN (cada secuencia arranca en
  001 su primer año), que es lo que pide "no compartir contador".
- 6.3 podrá **migrar a la Opción B (tabla contador compartida)** cuando unifique
  presupuestos y facturas bajo una sola numeración por régimen, si se decide
  entonces. En 6.2 no hace falta pagar ese coste.

### D3 — Cómo se pinta la variante SIN IVA (modelo de vista + plantilla)

**RESOLUCIÓN CONFIRMADA**:
- SIN IVA omite en cabecera **SOLO** la razón social fiscal + el NIF; **mantiene**
  la dirección fiscal y el branding/contacto.
- El **total SIN IVA = base sin IVA** (importe MENOR, sin el 21%): **cambia el
  cálculo fiscal**, no solo el render (ver §"Impacto en el cálculo fiscal por
  régimen"). El PDF SIN IVA muestra **solo el Total (= base)**, sin línea
  base/IVA.

**Contexto**: `ModeloDocumentoPresupuesto` y los componentes `Cabecera` /
`BloqueTotales` hoy asumen CON IVA (cabecera con razón social fiscal + NIF;
totales con base/IVA/total).

**Propuesta (aprobada)**:

- **Modelo de vista**: añadir `regimen: RegimenIva` a
  `DatosDocumentoPresupuesto` y propagarlo a `ModeloDocumentoPresupuesto`. El
  builder `construirModeloDocumentoPresupuesto` resuelve, según régimen:
  - `cabecera.mostrarIdentidadFiscal: boolean` (`true` CON IVA, `false` SIN
    IVA). En SIN IVA se **omiten** `razonSocialFiscal` y `nif` del render (el
    resto de la cabecera —nombre comercial, dirección/web/email según Excel— se
    mantiene; ver pregunta abajo sobre qué líneas exactas quedan).
  - `totales.mostrarDesgloseIva: boolean` (`true` CON IVA, `false` SIN IVA). En
    SIN IVA `BloqueTotales` pinta **solo `Total`** (sin filas "Base imposable" e
    "IVA (%)").
- **Componentes** (`Cabecera`, `BloqueTotales`): se parametrizan con esos flags;
  **layout fijo, contenido por tenant**. Siguen sin hardcodear datos de negocio
  y siguen siendo reutilizables por la factura (6.3). Se añaden escenarios de
  test de render para ambas variantes.
- **El concepto, horas, nº personas, extras, reparto 40/60/fiança, validesa y
  pie bancario son idénticos** en ambas variantes.

### D4 — Contrato OpenAPI y SDK

**RESOLUCIÓN CONFIRMADA**: `metodoPago` obligatorio en **confirmar Y preview**;
la respuesta expone `regimenIva` + `numeroPresupuesto`. Fase de contrato + SDK
incluida en `tasks.md`.

**Análisis**: `metodoPago` es un **campo nuevo obligatorio** en el request de
confirmar (`ConfirmarPresupuestoRequestDto`) y en el preview
(`PreviewPresupuestoRequestDto`). Es un **cambio de contrato** (a diferencia de
6.1b, que no lo tenía): hay que añadirlo a `docs/api-spec.yml` y **regenerar el
SDK**. El `regimenIva` derivado ¿se expone en la respuesta
(`ConfirmarPresupuestoResponseDto` / `PresupuestoPreviewResponseDto`)?

**Propuesta**:
- Añadir `metodoPago: enum [transferencia, efectivo]` **obligatorio** al request
  de confirmar y al de preview (para que el borrador muestre el importe según
  régimen).
- Exponer `regimenIva` (y opcionalmente `numeroPresupuesto`) en la respuesta de
  confirmar, para que el frontend sepa qué variante se emitió. (En 6.1b
  `numeroPresupuesto` no se exponía; propongo exponerlo ahora junto al régimen —
  a confirmar.)
- El `tasks.md` **sí** incluye fase de contrato + SDK (a cargo del
  `contract-engineer`, tras el gate SDD).

### D5 — Frontend (UI en 6.2)

**RESOLUCIÓN CONFIRMADA**: 6.2 es **completo punta a punta**: incluye el
**selector obligatorio de método de pago en el modal de presupuesto** + **E2E
Playwright**. El cliente HTTP se **regenera** desde el contrato, nunca a mano.

**Contexto**: el gestor debe **elegir el método de pago** al generar el
presupuesto; hoy el flujo de generar presupuesto tiene UI (US-014). El selector
transferencia/efectivo se envía en el request y condiciona el borrador
(importe/variante).

### D6 — Verificación visual del PDF SIN IVA en QA

**Contexto**: como en 6.1b, los subagentes QA corren **sin Postgres**
(MEMORY: "Subagentes sin Docker/Postgres"); react-pdf es ESM puro
(`NODE_OPTIONS=--experimental-vm-modules`).

**Propuesta**: QA en dos capas: (a) **tests unitarios de render** de ambas
variantes (CON y SIN IVA) — el modelo de vista y los componentes producen bytes
no vacíos y el contenido correcto (SIN IVA: sin "Base imposable"/"IVA", sin
razón social fiscal/NIF); (b) **verificación de integración desde la sesión
principal** (con Postgres): confirmar un presupuesto **efectivo** real, generar
el PDF SIN IVA, descargarlo del almacén local e **inspeccionarlo visualmente**
(guardar muestra en `reports/`), y comprobar en BD la **doble numeración**
(un CON y un SIN con contadores independientes). Los tests de integración /
numeración concurrente se lanzan desde la sesión principal.

## Mapeo de datos (Excel "PRESSUPOST SENSE IVA" → modelo)

| Campo del PDF | CON IVA (6.1b) | SIN IVA (6.2) |
|---|---|---|
| Cabecera: nombre comercial + logo | igual | igual |
| Cabecera: razón social fiscal + NIF | se muestra | **se omite** (D3) |
| Cabecera: dirección fiscal / web / email | se muestra | **se mantiene** (D3) |
| Concepte / horas / nº personas / extras | igual | igual |
| Base imposable + IVA (%) | se muestra | **se omite** (D3) |
| Total | base + IVA21 | **base sin IVA** (importe MENOR) |
| Reparto 40/60 | 40/60 del total con IVA | 40/60 del total SIN IVA (= base) |
| Fiança | 500 fija (setting), aparte del total | 500 fija, **igual** |
| Validesa | igual | igual |
| Pie bancario (IBAN) | igual | igual |
| `numero_presupuesto` | secuencia CON | secuencia SIN, literal compartido (D2) |

## Reglas duras aplicadas

- **Hexagonal**: `regimenDesdeMetodoPago`, `calcularDesgloseFiscal`/
  `calcularReparto` (ahora parametrizados por `RegimenIva`) y
  `siguienteNumeroPresupuesto` son **dominio puro**; el `MAX` discriminado por
  régimen y el reintento `P2002` son infra. `documentos` NO importa de
  `presupuestos` (el `regimen` llega como dato del modelo de vista; el enum se
  declara/duplica en `documentos` como hoy los tipos de desglose/reparto).
- **Multi-tenant/RLS**: `tenantId` del JWT; columnas nuevas de `Presupuesto` con
  RLS existente (no recrear policy: presupuesto usa `tenant_isolation` por join
  desde el init). Opción A confirmada (D2): no hay tabla `SecuenciaDocumento` en
  6.2.
- **Bloqueo atómico**: sin locks distribuidos; la serialización de la numeración
  sigue siendo por unicidad de BD + reintento `P2002` acotado.
- **TDD**: tests de `regimenDesdeMetodoPago` (dominio), de numeración por
  régimen (dominio + integración), y de render de ambas variantes antes de impl.
- **Arrow functions** en toda función nombrada (componentes incluidos).
- **Migración aditiva no destructiva**: nullable + backfill; sin borrar campos.
- **Cliente generado del frontend**: se **regenera** desde el contrato (hay
  delta de API), nunca se edita a mano.

# Spec Delta — Capability `presupuestos`

> Rebanada **6.2** del épico #6. Añade el **método de pago → régimen fiscal**
> capturado al generar el presupuesto, su persistencia en `Presupuesto`, y
> generaliza la numeración `AAAANNN` de una a **dos secuencias por
> tenant/año/régimen** (CON IVA / SIN IVA). La variante SIN IVA del render vive
> en la capability `documentos`.
>
> Fuente: `epico-6-documentos-pdf-roadmap` 6.2; US-014/UC-14; Excel hojas
> "PRESSUPOST IVA" y "PRESSUPOST SENSE IVA"; `presupuesto-parte-b-plan` #6;
> `design.md` D1/D2/D4; specs vivas `presupuestos` (6.1b) y `documentos`.

## ADDED Requirements

### Requirement: Método de pago del presupuesto determina el régimen fiscal

El sistema SHALL (DEBE) capturar, **al generar el presupuesto** (endpoints de
**preview** y **confirmar** de US-014), un método de pago **obligatorio**
`metodoPago ∈ {'transferencia', 'efectivo'}`, y derivar de él el **régimen
fiscal** del presupuesto mediante una función de **dominio pura**
(`regimenDesdeMetodoPago`) con la regla del Excel del tenant:
**`transferencia ⇒ CON IVA`** y **`efectivo ⇒ SIN IVA`**. La regla se modela
como estructura de datos declarativa (mapa), **no** como condicionales
dispersos. Tanto el `metodoPago` elegido como el `regimenIva` derivado SE
PERSISTEN en `Presupuesto` (campos nuevos, migración Prisma **aditiva y no
destructiva**: nullable + backfill de los presupuestos existentes a
`metodoPago = 'transferencia'` / `regimenIva = 'con_iva'`). El `tenant_id`
DERIVA del JWT; el `metodoPago` viaja en el body del request, nunca el régimen
(que es una consecuencia calculada, no una entrada). El régimen determina la
**variante del PDF** (capability `documentos`) y la **secuencia de numeración**.
(Fuente: `US-014`/UC-14; Excel hoja "PRESSUPOST SENSE IVA"; `design.md` D1;
`CLAUDE.md §Máquina de estados` reglas como datos, `§Multi-tenancy`.)

#### Scenario: Transferencia genera régimen CON IVA

- **GIVEN** una reserva válida para generar presupuesto
- **WHEN** el gestor confirma el presupuesto con `metodoPago = 'transferencia'`
- **THEN** el `Presupuesto` se persiste con `regimenIva = 'con_iva'` y
  `metodoPago = 'transferencia'`
- **AND** el PDF se emite en la variante CON IVA (con base imponible e IVA)

#### Scenario: Efectivo genera régimen SIN IVA

- **GIVEN** una reserva válida para generar presupuesto
- **WHEN** el gestor confirma el presupuesto con `metodoPago = 'efectivo'`
- **THEN** el `Presupuesto` se persiste con `regimenIva = 'sin_iva'` y
  `metodoPago = 'efectivo'`
- **AND** el PDF se emite en la variante SIN IVA (sin base imponible ni razón
  social fiscal en cabecera)

#### Scenario: El método de pago es obligatorio al generar el presupuesto

- **GIVEN** una petición de confirmar presupuesto sin `metodoPago`
- **WHEN** el sistema valida el request
- **THEN** rechaza la operación con error de validación (422/400 según contrato)
- **AND** no crea ningún PRESUPUESTO ni muta la RESERVA ni la `FECHA_BLOQUEADA`

#### Scenario: La derivación régimen←método es una función de dominio pura

- **WHEN** se inspecciona `regimenDesdeMetodoPago`
- **THEN** vive en `presupuestos/domain/`, es una arrow function sin imports de
  framework/infra, y mapea `transferencia→con_iva`, `efectivo→sin_iva` de forma
  declarativa

### Requirement: Total, IVA y reparto del presupuesto dependientes del régimen

El sistema SHALL (DEBE) calcular el **desglose fiscal** (`baseImponible`,
`ivaPorcentaje`, `ivaImporte`, `total`) y el **reparto de pago** (`senalEur`,
`liquidacionEur`, `fianzaEur`) del presupuesto **en función del régimen** derivado
del método de pago, mediante **funciones de dominio puras** (`calcularDesgloseFiscal`
y `calcularReparto`, parametrizadas por `RegimenIva`; sin `if` dispersos por la
capa de aplicación). La **base imponible** —derivada de la salida del motor de
tarifa/precio manual (que llega con IVA incluido) menos el descuento, dividida
entre 1.21— es la **MISMA** en ambos regímenes; lo que cambia es si se le suma el
IVA:

- **CON IVA** (transferencia): `total = base + IVA21`, `ivaPorcentaje = 21`,
  `ivaImporte = total − base` (comportamiento congelado de 6.1b, sin regresión).
- **SIN IVA** (efectivo): `total = base` (**importe MENOR**, sin el 21%),
  `ivaPorcentaje = 0` y `ivaImporte = 0`. Ejemplo: base 1000 → CON IVA total
  1210; SIN IVA total 1000.

El **reparto 40%/60%** se calcula sobre el **`total` del régimen** (para efectivo,
señal = 40% del total SIN IVA y liquidación = 60% del total SIN IVA). La **fiança**
(`fianzaEur`) sigue siendo el importe fijo del setting del tenant, **aparte del
total** e **igual en ambos regímenes**. El sistema NO DEBE reimplementar el motor
de tarifa (US-016): solo cambia la **derivación fiscal** a partir de su salida,
ahora dependiente del régimen. Los importes congelados se persisten en
`Presupuesto` (como hoy) y el PDF (capability `documentos`) refleja lo persistido.
Se mantiene la invariante contable a 2 decimales (`base + IVA = total` en CON IVA;
`IVA = 0`, `total = base` en SIN IVA). (Fuente: decisión del gate SDD 2026-07-14
"efectivo paga menos, sin 21%"; `design.md` §"Impacto en el cálculo fiscal por
régimen"; `presupuestos/domain/desglose-fiscal.ts` 6.1b; `CLAUDE.md
§Arquitectura` dominio puro.)

#### Scenario: CON IVA — el total suma el 21% a la base

- **GIVEN** un presupuesto cuyo motor/precio deriva una base imponible de 1000 €
- **WHEN** se confirma con `metodoPago = 'transferencia'` (régimen `con_iva`)
- **THEN** el `Presupuesto` congela `baseImponible = 1000.00`,
  `ivaPorcentaje = 21.00`, `ivaImporte = 210.00` y `total = 1210.00`

#### Scenario: SIN IVA — el total es la base, sin IVA (importe menor)

- **GIVEN** el mismo presupuesto con base imponible de 1000 €
- **WHEN** se confirma con `metodoPago = 'efectivo'` (régimen `sin_iva`)
- **THEN** el `Presupuesto` congela `baseImponible = 1000.00`,
  `ivaPorcentaje = 0.00`, `ivaImporte = 0.00` y `total = 1000.00`
- **AND** el total SIN IVA (1000) es **menor** que el total CON IVA (1210) del
  mismo presupuesto

#### Scenario: El reparto 40/60 se calcula sobre el total del régimen

- **GIVEN** un presupuesto SIN IVA con `total = 1000.00` y `pctSenal = 40`
- **WHEN** se calcula el reparto
- **THEN** `senalEur = 400.00` y `liquidacionEur = 600.00` (40/60 del total SIN
  IVA)
- **AND** la `fianzaEur` es el importe fijo del setting (p. ej. 500.00), aparte
  del total, igual que en CON IVA

#### Scenario: La derivación fiscal es una función de dominio pura por régimen

- **WHEN** se inspeccionan `calcularDesgloseFiscal` y `calcularReparto`
- **THEN** viven en `presupuestos/domain/`, reciben el `RegimenIva` como entrada,
  ramifican de forma declarativa y no importan framework/infra ni reimplementan
  el motor de tarifa

### Requirement: Migración aditiva de método de pago y régimen en Presupuesto

El sistema SHALL (DEBE) añadir a `Presupuesto`, mediante **migración Prisma no
destructiva**, los campos `metodo_pago` (enum `MetodoPago {transferencia,
efectivo}`) y `regimen_iva` (enum `RegimenIva {con_iva, sin_iva}`), ambos
inicialmente **nullable**, con **backfill** de las filas existentes a
`metodo_pago = 'transferencia'` y `regimen_iva = 'con_iva'` (en 6.1b todos los
presupuestos eran CON IVA por transferencia). La migración NO DEBE eliminar ni
alterar columnas existentes. Las columnas nuevas quedan protegidas por la RLS
**ya existente** de `presupuesto` (`tenant_isolation` por join desde la reserva;
**NO** se recrea la policy). Tras el backfill, la aplicación escribe siempre
ambos campos al crear un presupuesto (nunca `null` en filas nuevas). (Fuente:
`design.md` D1; `CLAUDE.md §Multi-tenancy`; nota 6.1b "presupuesto ya tenía
`tenant_isolation`, no recrear policy".)

#### Scenario: La migración añade los campos sin destruir datos

- **WHEN** se aplican las migraciones Prisma
- **THEN** `presupuesto` tiene `metodo_pago` y `regimen_iva`
- **AND** los presupuestos preexistentes quedan con `metodo_pago =
  'transferencia'` y `regimen_iva = 'con_iva'` (backfill), sin perder ninguna
  columna anterior

#### Scenario: Las columnas nuevas no recrean la policy RLS

- **WHEN** se revisa la migración
- **THEN** no crea una nueva `POLICY` para `presupuesto` (reutiliza
  `tenant_isolation` por join a la reserva), y `presupuesto` sigue con RLS
  habilitada

### Requirement: Numeración del presupuesto por tenant, año y régimen (doble secuencia)

El sistema SHALL (DEBE) asignar a cada presupuesto un **`numero_presupuesto`**
con formato **año + contador** (p. ej. `2026001`), con **dos secuencias
independientes por tenant y año según el régimen fiscal** (una para CON IVA y
otra para SIN IVA), de modo que **CON y SIN NO comparten contador**. Cada
secuencia tiene **reinicio anual** (el año va embebido en el número). El campo se
persiste en `Presupuesto` y su unicidad se garantiza a nivel de BD por **tenant +
régimen + número** (`@@unique([tenantId, regimenIva, numeroPresupuesto])`),
permitiendo que ambas secuencias arranquen en `AAAA001` sin colisionar. El
**cálculo** del siguiente número es una función de **dominio pura**
(`siguienteNumeroPresupuesto`, reutilizada de 6.1b, a partir del año y del último
número del tenant en ese año **para ese régimen**); la consulta `MAX`
(`ultimoNumeroDelAnio(tenantId, anio, regimen)`) y el **reintento ante colisión
`P2002`** (discriminado por `meta.target`, patrón de 6.1b) viven en infra. La
asignación ocurre en la **transacción de confirmación** del presupuesto (bajo RLS
del tenant), no en el post-commit del PDF. Los presupuestos CON IVA existentes de
6.1b (backfill `regimen_iva = 'con_iva'`) **son** la secuencia CON, que continúa
sin discontinuidad. Las **facturas** conservan su numeración `F-YYYY-NNNN` (NO se
migra en 6.2; su migración a este mecanismo es 6.3). (Fuente:
`epico-6-documentos-pdf-roadmap` 6.2 doble numeración; `design.md` D2; patrón
6.1b `siguienteNumeroPresupuesto` + reintento `P2002` por `meta.target`.)

#### Scenario: Cada régimen tiene su propia secuencia desde 001

- **GIVEN** un tenant sin presupuestos numerados en 2026
- **WHEN** confirma su primer presupuesto CON IVA (`transferencia`) y su primer
  presupuesto SIN IVA (`efectivo`) en 2026
- **THEN** el CON IVA recibe `numero_presupuesto = 2026001` (secuencia CON) y el
  SIN IVA recibe `numero_presupuesto = 2026001` (secuencia SIN)
- **AND** ambos coexisten sin colisión gracias a
  `@@unique([tenantId, regimenIva, numeroPresupuesto])`

#### Scenario: Cada secuencia se incrementa independientemente

- **GIVEN** un tenant con `2026001` CON IVA y `2026001` SIN IVA
- **WHEN** confirma otro presupuesto CON IVA en 2026
- **THEN** el nuevo CON IVA es `2026002` y la secuencia SIN IVA permanece en
  `2026001` (no se ve afectada)

#### Scenario: La secuencia CON IVA continúa la de 6.1b (reconciliación)

- **GIVEN** un tenant cuyos presupuestos de 6.1b (backfill `regimen_iva =
  'con_iva'`) llegan hasta `2026007`
- **WHEN** confirma un nuevo presupuesto CON IVA en 2026
- **THEN** `numero_presupuesto` es `2026008` (continúa la secuencia CON, sin
  reiniciar)

#### Scenario: Cada secuencia reinicia con el año

- **GIVEN** un tenant con presupuestos CON IVA hasta `2026005` y SIN IVA hasta
  `2026003`
- **WHEN** confirma en 2027 un presupuesto de cada régimen
- **THEN** el CON IVA es `2027001` y el SIN IVA es `2027001`

#### Scenario: Colisión concurrente de numeración se reintenta discriminando el P2002

- **GIVEN** dos confirmaciones concurrentes que calculan el mismo
  `numero_presupuesto` para el mismo tenant, año y régimen
- **WHEN** una gana y la otra viola
  `presupuesto_tenant_id_regimen_iva_numero_presupuesto_key` (`P2002`)
- **THEN** la perdedora **reintenta** recalculando el número (bucle acotado),
  discriminando el `P2002` por `meta.target`
- **AND** un `P2002` de la fecha D4 (`UNIQUE(tenant_id, fecha)`) NO se reintenta
  y propaga como "fecha no disponible" (409)

## REMOVED Requirements

### Requirement: Numeración del presupuesto CON IVA por tenant y año

**Reason**: Renombrada y generalizada por la 6.2. La numeración pasa de una ÚNICA
secuencia CON IVA (`AAAANNN` con `@@unique([tenantId, numeroPresupuesto])`) a **dos
secuencias por tenant/año/régimen** (CON IVA / SIN IVA), sustituida por el requirement
«Numeración del presupuesto por tenant, año y régimen (doble secuencia)» de esta misma
capability. Los presupuestos CON IVA de 6.1b (backfill `regimen_iva = 'con_iva'`) se
reconcilian como la secuencia CON, que continúa sin discontinuidad. La unicidad de BD
pasa de `[tenantId, numeroPresupuesto]` a `[tenantId, regimenIva, numeroPresupuesto]`.

# Change: documentos-sin-iva-omite-pie-bancario

## Why

Fix de negocio del épico **#6 — Documentos PDF por tenant**, apilado **encima de
la 6.2** (`documentos-presupuesto-sin-iva-doble-numeracion`, PR #65 sin mergear
aún): este fix depende del modelo de vista con flags (`mostrarIdentidadFiscal` /
`mostrarDesgloseIva`), del componente `PieBancario` y de la variante SIN IVA que
introdujo la 6.2.

La 6.2 implementó la **variante SIN IVA** (efectivo, hoja "PRESSUPOST SENSE IVA"
del Excel) omitiendo en cabecera la identidad fiscal y en totales el desglose de
IVA, pero **muestra el pie de datos bancarios (IBAN + beneficiario + concepto de
transferència + "El pagament mitjançant transferència…") en AMBAS variantes**.

Verificado contra la **plantilla Excel real del tenant** (Masia l'Encís /
Canoliart, SL):

- La hoja **"PRESSUPOST SENSE IVA"** (efectivo) **termina en la Fiança** y **NO
  incluye ningún bloque de datos bancarios**. Es coherente con el negocio: pago
  en efectivo ⇒ no hay transferencia, así que no procede mostrar IBAN ni concepto
  de transferencia.
- La hoja **"PRESSUPOST IVA"** (transferencia) **sí incluye** el pie bancario.

Por tanto el render actual de la variante SIN IVA es incorrecto: expone un IBAN y
un texto de transferencia que no aplican a un pago en efectivo. Hay que **omitir
el pie bancario en la variante SIN IVA** y mantenerlo en CON IVA.

(Fuente: Excel `Plantilla_factures i pressupostos.xlsx` hojas "PRESSUPOST IVA" y
"PRESSUPOST SENSE IVA"; `epico-6-documentos-pdf-roadmap`; spec viva `documentos`
requirement "Variante SIN IVA del documento…" de la 6.2.)

## What Changes

Extensión **acotada** del requirement vivo de `documentos`
`### Requirement: Variante SIN IVA del documento (cabecera sin identidad fiscal, totales sin base/IVA)`
para que la variante SIN IVA **también omita el pie de datos bancarios**
(IBAN + beneficiario + concepto/texto de transferencia), reutilizando el mismo
patrón de flags del modelo de vista que ya introdujo la 6.2.

- **Nuevo flag de vista `pieBancario.mostrar`** (o equivalente
  `mostrarPieBancario`) resuelto en `construirModeloDocumentoPresupuesto` (modelo
  de vista puro): `false` cuando `regimen = sin_iva`, `true` cuando
  `regimen = con_iva`. Se resuelve igual que `mostrarIdentidadFiscal` /
  `mostrarDesgloseIva` (desde `datos.regimen === 'con_iva'`), de forma
  declarativa, sin condicional disperso.
- **`DocumentoLayout`** deja de renderizar `PieBancario` incondicionalmente: solo
  lo compone cuando el flag es `true`. (Alternativamente, `PieBancario` respeta
  el flag y no pinta nada; la decisión concreta se fija en `design.md`.)
- **CON IVA no cambia**: sigue mostrando el pie bancario (IBAN + beneficiario +
  concepto + pie legal) exactamente como en 6.1b/6.2. Sin regresión.
- El resto del cuerpo del documento (concepto, duración, extras, reparto
  40/60/fiança, validesa) sigue idéntico en ambas variantes.

### Fuera de alcance

- **NO hay fase de contrato/SDK**: no cambia el contrato OpenAPI ni el cliente
  generado. El régimen ya viaja como dato del documento (6.2).
- **NO hay cambios de BD**: no toca `Presupuesto` ni ninguna migración Prisma. El
  flag es puramente de presentación, derivado del `regimen` ya persistido.
- **NO hay cambios de frontend ni E2E**: es solo render backend del PDF.
- **NO toca cálculo fiscal ni numeración**: base/IVA/total, reparto 40/60/fiança
  y numeración `AAAANNN` no cambian.

## Capability elegida y justificación

**`documentos` (única capability)**: la visibilidad del pie bancario según el
régimen es una regla de **presentación** del documento que vive en el modelo de
vista y en los componentes de plantilla de `documentos`. No afecta al agregado
`Presupuesto` (capability `presupuestos`), porque el `regimen` ya está resuelto y
persistido; aquí solo se consume. La capa sigue **reutilizable por la factura
(6.3)** y **no importa de `presupuestos`** (hexagonal).

## Trazabilidad

- Épico **#6**, fix post-**6.2** (roadmap `epico-6-documentos-pdf-roadmap`).
- Modifica la spec viva **`documentos`** (requirement de la variante SIN IVA de
  la 6.2): consume `construirModeloDocumentoPresupuesto`, `PieBancario`,
  `DocumentoLayout` y el enum `RegimenDocumento` declarado en `documentos`.
- **US-014 / UC-14** (generar presupuesto): el `regimen` (derivado de
  `metodoPago`) determina la variante del PDF; este fix corrige la variante SIN
  IVA para que refleje la hoja "PRESSUPOST SENSE IVA" del Excel.
- Excel `Plantilla_factures i pressupostos.xlsx` hoja "PRESSUPOST SENSE IVA"
  (termina en la Fiança, sin bloque bancario).
- `CLAUDE.md §Arquitectura` (hexagonal: `documentos` ↛ `presupuestos`, dominio de
  presentación puro), `§Testing` (TDD), regla dura arrow-functions.

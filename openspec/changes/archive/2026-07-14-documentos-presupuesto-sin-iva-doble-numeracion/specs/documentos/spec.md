# Spec Delta — Capability `documentos`

> Rebanada **6.2** del épico #6. Extiende el modelo de vista y la capa de
> plantilla react-pdf de 6.1b para renderizar la **variante SIN IVA** del
> documento de presupuesto (hoja "PRESSUPOST SENSE IVA" del Excel), según el
> **régimen fiscal** que llega como dato del documento. La capa sigue siendo
> **reutilizable por la factura (6.3)** y **no importa de `presupuestos`**.
>
> Fuente: `epico-6-documentos-pdf-roadmap` 6.2; Excel hojas "PRESSUPOST IVA" y
> "PRESSUPOST SENSE IVA"; `design.md` D3; spec viva `documentos` (6.1a/6.1b).

## ADDED Requirements

### Requirement: Variante SIN IVA del documento (cabecera sin identidad fiscal, totales sin base/IVA)

El modelo de vista y la capa de plantilla de documentos SHALL (DEBE) soportar
**dos variantes** del documento de presupuesto según un **régimen** que llega
como dato del documento (`regimen ∈ {con_iva, sin_iva}`), aplicando las reglas
del Excel del tenant:

- **Variante CON IVA** (transferencia, hoja "PRESSUPOST IVA"): comportamiento de
  6.1b (cabecera con razón social fiscal + NIF; totales con base imponible + IVA
  + total).
- **Variante SIN IVA** (efectivo, hoja "PRESSUPOST SENSE IVA"):
  - (a) el bloque de totales **no lleva base imponible ni desglose de IVA**: solo
    el **importe total**; y
  - (b) la cabecera **omite la razón social fiscal y el NIF** (queda el nombre
    comercial y el branding del tenant).

El resto del documento es **idéntico** en ambas variantes: concepto "Gestió de
l'ús espai de {nombreComercial} per esdeveniment" (nunca "lloguer"), fecha del
evento, duración "(N hores)", nº de personas, extras como sub-conceptos,
**reparto 40/60/fiança**, validesa y **pie bancario** (IBAN). La decisión se
resuelve en el **modelo de vista puro** (`construirModeloDocumentoPresupuesto`)
como flags (`cabecera.mostrarIdentidadFiscal`, `totales.mostrarDesgloseIva`) y
los componentes (`Cabecera`, `BloqueTotales`) los consumen; **layout fijo en
código, contenido 100% del tenant/documento**, sin datos de negocio
hardcodeados. La capa NO importa de `presupuestos` (el `regimen` es un dato del
documento; el enum se declara en `documentos`, como los tipos de desglose/reparto
duplicados intencionadamente en 6.1b). Todas las funciones nombradas son **arrow
functions**. (Fuente: Excel hoja "PRESSUPOST SENSE IVA"; `design.md` D3;
`documentos` 6.1b `construirModeloDocumentoPresupuesto`/`Cabecera`/`BloqueTotales`;
`CLAUDE.md §Arquitectura` `documentos`↛`presupuestos`, regla arrow-functions.)

#### Scenario: SIN IVA no muestra base imponible ni desglose de IVA

- **GIVEN** un documento de presupuesto con `regimen = sin_iva` cuyo `total`
  congelado es la **base sin IVA** (importe menor; ver capability `presupuestos`)
- **WHEN** se renderiza el bloque de totales
- **THEN** el PDF muestra **solo el Total** (= base, sin el 21%), sin filas
  "Base imposable" ni "IVA (%)"
- **AND** el reparto 40/60/fiança (calculado sobre el total SIN IVA), la validesa
  y el pie bancario se muestran igual que en CON IVA

#### Scenario: SIN IVA omite razón social fiscal y NIF pero mantiene dirección/contacto

- **GIVEN** un documento con `regimen = sin_iva` y una config con
  `razonSocialFiscal = "Canoliart, SL"`, `nif = "B10874287"`,
  `nombreComercial = "Masia l'Encís"` y `direccionFiscal`/`web`/`email` presentes
- **WHEN** se renderiza la cabecera
- **THEN** el PDF **no** contiene "Canoliart, SL" ni el NIF
- **AND** sí contiene el nombre comercial "Masia l'Encís", el branding y la
  dirección fiscal / web / email del tenant

#### Scenario: CON IVA conserva el render de 6.1b

- **GIVEN** un documento con `regimen = con_iva`
- **WHEN** se renderiza el documento
- **THEN** la cabecera muestra razón social fiscal + NIF y los totales muestran
  base imponible + IVA + total (sin regresión respecto a 6.1b)

#### Scenario: El concepto y el resto del cuerpo son idénticos en ambas variantes

- **GIVEN** dos documentos del mismo presupuesto, uno CON IVA y otro SIN IVA
- **WHEN** se renderizan
- **THEN** ambos muestran el mismo concepto ("Gestió de l'ús espai de Masia
  l'Encís per esdeveniment", sin "lloguer"), la misma duración "(N hores)", los
  mismos extras, el mismo reparto 40/60/fiança, validesa y pie bancario

#### Scenario: La variante no acopla documentos a presupuestos

- **WHEN** se inspeccionan las dependencias del modelo de vista y de los
  componentes de la variante
- **THEN** viven en la capability `documentos` y no importan de `presupuestos`
- **AND** el enum de régimen usado por el render se declara en `documentos`

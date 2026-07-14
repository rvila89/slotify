# Change: documentos-presupuesto-sin-iva-doble-numeracion

## Why

El épico **#6 — Documentos PDF por tenant** entrega los documentos reales
(presupuesto/factura) como el Excel del tenant, con **layout fijo en código y
contenido 100% por tenant**. Las rebanadas previas ya están en master:

- **6.1a** (`documentos-config-tenant-storage`, PR #63): configuración de
  documento por tenant (`PlantillaDocumentoTenant` → VO
  `ConfiguracionDocumentoTenant`: branding, **identidad fiscal** con
  `razonSocialFiscal = "Canoliart, SL"` ≠ `nombreComercial = "Masia l'Encís"`,
  `nif = "B10874287"`, banca, textos) y el puerto `AlmacenDocumentosPort`.
- **6.1b** (`documentos-presupuesto-pdf-con-iva`, PR #64): PDF real del
  presupuesto **CON IVA** con `@react-pdf/renderer`; capa de plantilla
  compartida en `apps/api/src/documentos/presentation/` (`DocumentoLayout` →
  `Cabecera`/`BloqueCliente`/`TablaConcepto`/`BloqueTotales`/`PieBancario`),
  `construirModeloDocumentoPresupuesto` (modelo de vista puro),
  `renderizarDocumentoPresupuestoABytes`, `PdfPresupuestoRealAdapter`;
  numeración `AAAANNN` (`2026001`) vía dominio puro `siguienteNumeroPresupuesto`
  con `MAX` + reintento `P2002` discriminado por `meta.target` en el use-case.

El Excel del tenant tiene **dos hojas de presupuesto**: "PRESSUPOST IVA"
(pago por transferencia, con desglose de IVA) y "PRESSUPOST SENSE IVA"
(pago en efectivo, sin base imponible ni razón social fiscal en cabecera). Hoy
Slotify solo cubre la primera; **el gestor no puede emitir el presupuesto SIN
IVA** que corresponde a los pagos en efectivo, y **no existe** ningún campo de
método de pago ni de régimen fiscal en el modelo (verificado en el schema).

Esta rebanada **6.2** añade los tres ejes que faltan sobre el flujo de
**presupuesto** (las facturas se tratan en 6.3):

1. **Método de pago → régimen fiscal** capturado al generar el presupuesto.
2. **Variante SIN IVA** del documento (regla de negocio del Excel).
3. **Doble numeración** compartida (dos secuencias por tenant/año/régimen),
   que el presupuesto consume ya y que las facturas migrarán en 6.3.

(Fuente: `epico-6-documentos-pdf-roadmap` 6.2; `presupuesto-parte-b-plan` #6;
Excel `Plantilla_factures i pressupostos.xlsx` hojas "PRESSUPOST IVA" y
"PRESSUPOST SENSE IVA"; specs vivas `documentos` (6.1a) y `presupuestos` (6.1b).)

## What Changes

### 1. Método de pago → régimen fiscal (capturado al generar presupuesto)

- **Nuevo campo obligatorio `metodoPago: 'transferencia' | 'efectivo'`** en el
  request de **confirmar** el presupuesto (`POST /reservas/{id}/presupuesto`) y
  en el **preview** (`.../preview`), para que el borrador muestre el importe
  correcto según régimen. **DECISIÓN FIJADA**: se captura al generar el
  presupuesto (no antes en la reserva).
- **Regla de negocio del Excel** (dominio puro): **`transferencia ⇒ CON IVA`**,
  **`efectivo ⇒ SIN IVA`**. Se modela como función/mapa de dominio
  (`regimenDesdeMetodoPago`), no como condicional disperso.
- El **régimen resultante se persiste** en `Presupuesto` (nuevo campo enum, ver
  `design.md` D1 para el nombre y valores). Migración Prisma **aditiva** y no
  destructiva (nullable + backfill de los presupuestos CON IVA existentes al
  régimen CON).

### 2. Variante SIN IVA del documento — CON impacto en el cálculo fiscal

**DECISIÓN CONFIRMADA (gate)**: el cliente en efectivo **paga MENOS**: NO se le
aplica el 21%. Por tanto la 6.2 **SÍ toca el cálculo fiscal**, no solo la
presentación. El **total del presupuesto depende del régimen**:

- **CON IVA** (transferencia): `total = base + IVA21` (comportamiento 6.1b).
- **SIN IVA** (efectivo): `total = base` (**importe MENOR**), `IVA = 0`. Ejemplo:
  base 1000 → CON IVA total 1210; SIN IVA total 1000.
- La **base imponible** (concepto + extras, con descuento) es la **MISMA** en
  ambos regímenes; lo que cambia es si se le suma el IVA.
- El **reparto 40/60** se calcula sobre el **total del régimen** (en efectivo,
  40%/60% del total SIN IVA); la **fiança** sigue fija (500) e igual en ambos.
- Las funciones de dominio `calcularDesgloseFiscal` y `calcularReparto` pasan a
  recibir el `RegimenIva` y ramificar de forma **declarativa** (dominio puro,
  TDD-RED primero); el use-case no recalcula tarifario.

Reglas del Excel para la hoja "PRESSUPOST SENSE IVA" (render):
- (a) el documento **no lleva base imponible** (sin desglose base/IVA21; muestra
  **solo el Total = base**), y
- (b) **omite en cabecera la razón social fiscal (Canoliart) + el NIF**;
  **mantiene** el nombre comercial, el branding y la dirección fiscal/contacto.
- El **resto es igual** a CON IVA: concepto "Gestió de l'ús espai de
  {nombreComercial} per esdeveniment" (nunca "lloguer"), horas "(N hores)",
  reparto 40/60/fiança, validesa, pie bancario.

Se extienden las funciones fiscales de dominio, `construirModeloDocumentoPresupuesto`
(modelo de vista) y la capa de plantilla (`Cabecera`, `BloqueTotales`) para
**calcular y renderizar ambas variantes según el régimen**. La capa de plantilla
sigue siendo **reutilizable por la factura (6.3)** y **no depende de
`presupuestos`**.

### 3. Doble numeración compartida (dos secuencias por tenant/año/régimen)

- **DECISIÓN CONFIRMADA (gate)**: **Opción A**. Mecanismo de **2 secuencias por
  tenant/año/régimen** (una CON IVA, otra SIN IVA), formato `AAAANNN` con el
  literal `2026001` **COMPARTIDO** entre CON y SIN (sin embeber el régimen en el
  literal), diferenciado por la columna `regimenIva` en la unicidad
  `@@unique([tenantId, regimenIva, numeroPresupuesto])`. El **presupuesto lo
  consume ya**; las **facturas migran en 6.3** (NO se toca `F-YYYY-NNNN` ahora,
  está archivada). La tabla contador `SecuenciaDocumento` (Opción B) se **difiere
  a 6.3**.
- El **dominio se mantiene puro**: `siguienteNumeroPresupuesto` ya calcula desde
  `ultimoNumero`; la consulta `MAX` (discriminada por régimen:
  `ultimoNumeroDelAnio(tenantId, anio, regimen)`) y el reintento `P2002`
  (anclado a `presupuesto_tenant_id_regimen_iva_numero_presupuesto_key`) viven
  en infra. Así CON y SIN **no comparten contador**.
- Se **reconcilia** con la single-sequence de 6.1b: los presupuestos CON IVA
  existentes son la secuencia CON (backfill del régimen a CON en la migración).

### Fuera de alcance (rebanadas posteriores)

- **Facturas 40/60** (señal/liquidación) y la **migración de la numeración de
  factura** a la doble secuencia → **6.3** (reutilizarán la capa de plantilla y
  el mecanismo de doble numeración que esta rebanada crea). **No** se toca
  `F-YYYY-NNNN` ni la spec `facturacion` en 6.2.
- **Condicions particulars** → 6.4. **UI de ajustes del tenant + upload de
  logo** → 6.5.
- **Rango horario** en el concepto (solo "(N hores)", sin hora de inicio; N5 de
  6.1b sigue vigente): change aparte.

## Capability elegida y justificación

Se ubica en **dos capabilities**, igual que 6.1b:

- **`presupuestos` (delta principal)**: el **método de pago → régimen** en el
  request y su persistencia en `Presupuesto`, y la **doble numeración por
  régimen** (consulta `MAX` discriminada + unicidad) son propios del agregado
  `Presupuesto` y del caso de uso US-014.
- **`documentos` (delta acotado)**: la **variante SIN IVA** de la capa de
  plantilla (cabecera sin identidad fiscal, totales sin base/IVA) es una
  extensión del modelo de vista y de los componentes que viven en `documentos`,
  reutilizable por la factura (6.3) sin acoplar `documentos` a `presupuestos`.

## Trazabilidad

- Épico **#6**, rebanada **6.2** (roadmap `epico-6-documentos-pdf-roadmap`).
- Continúa las specs vivas **`documentos`** (6.1a/6.1b) y **`presupuestos`**
  (6.1b): consume `ConfiguracionDocumentoTenant`, `AlmacenDocumentosPort`,
  `construirModeloDocumentoPresupuesto`, `siguienteNumeroPresupuesto`.
- **US-014 / UC-14** (generar presupuesto + activar pre_reserva): el
  `metodoPago` entra por el mismo endpoint; el PDF es el efecto post-commit
  §D-6; el E2 §D-7 lo adjunta. El régimen determina la variante del PDF.
- `presupuesto-parte-b-plan` #6 (Excel hojas "PRESSUPOST IVA" y "PRESSUPOST
  SENSE IVA").
- `CLAUDE.md §Arquitectura` (hexagonal: dominio sin infra; `documentos` no
  importa de `presupuestos`), `§Multi-tenancy` (tenantId del JWT + RLS),
  `§Testing` (TDD), regla dura arrow-functions.
- Reutiliza el patrón de reintento `P2002` discriminado por `meta.target` de
  6.1b y el dominio puro `siguienteNumeroPresupuesto`.

## ADDED Requirements

### Requirement: Modelo de vista y renderizado de factura (rebanada 6.3)

El sistema SHALL (DEBE) proveer en `documentos/presentation/` una función de
construcción del modelo de vista de factura, `construirModeloDocumentoFactura(params)`,
y una función de renderizado, `renderizarDocumentoFacturaABytes(modelo)`, que juntas
generan el PDF de una FACTURA. El modelo de vista (`ModeloDocumentoFactura`) SHALL
(DEBE) incluir:

- `tipo`: `'senal' | 'liquidacion' | 'fianza'`
- `numeroFactura`: número de factura o `null` (en borradores de liquidación/fianza)
- `fechaEmision`: fecha de emisión
- `concepto`: texto generado según el tipo de factura y el número de presupuesto
- `extras`: sub-conceptos de extras (solo en liquidación)
- `totales`: `{ total, baseImponible | null, ivaPorcentaje | null, ivaImporte | null,
  mostrarDesgloseIva: boolean }`
- `cabecera`: `{ mostrarIdentidadFiscal: boolean, … datos del tenant }`
- `pieBancario`: `{ mostrar: boolean, … datos bancarios }`
- `cliente`: datos fiscales del receptor

La función `construirModeloDocumentoFactura` es lógica **pura** (sin side-effects): recibe
como input la `ConfiguracionDocumentoTenant`, los datos de la factura, el cliente y el
presupuesto, y devuelve el modelo. Todas las funciones nombradas son **arrow functions**.
(Fuente: épico #6 rebanada 6.3 `documentos-facturas-pdf`; `CLAUDE.md` regla arrow-functions.)

#### Scenario: El modelo de vista de señal CON IVA activa todos los bloques

- **GIVEN** una factura de señal con `ivaPorcentaje = 21.00` y datos completos
- **WHEN** se construye `ModeloDocumentoFactura`
- **THEN** `cabecera.mostrarIdentidadFiscal = true`, `totales.mostrarDesgloseIva = true`,
  `pieBancario.mostrar = true`
- **AND** el concepto es "40% de l'import total anticipat del pressupost núm. {n}"

#### Scenario: El modelo de vista de señal SIN IVA desactiva identidad fiscal, IVA y pie

- **GIVEN** una factura de señal con `ivaPorcentaje = 0.00`
- **WHEN** se construye `ModeloDocumentoFactura`
- **THEN** `cabecera.mostrarIdentidadFiscal = false`, `totales.mostrarDesgloseIva = false`,
  `pieBancario.mostrar = false`
- **AND** el concepto es "40% de l'import total anticipat del pressupost núm. {n}"

#### Scenario: El modelo de vista de fianza usa concepto sin referencia a presupuesto

- **GIVEN** una factura de fianza para un tenant con `nombreComercial = "Masia l'Encís"`
- **WHEN** se construye `ModeloDocumentoFactura`
- **THEN** el concepto es `"Fiança de garantia — Masia l'Encís"`
- **AND** no aparece ningún número de presupuesto en el concepto

#### Scenario: El modelo de vista de liquidación CON IVA incluye concepto con nº presupuesto

- **GIVEN** una factura de liquidación con `ivaPorcentaje = 21.00` y presupuesto `'2026001'`
- **WHEN** se construye `ModeloDocumentoFactura`
- **THEN** el concepto contiene la referencia al presupuesto núm. `2026001`
- **AND** `totales.mostrarDesgloseIva = true` y `pieBancario.mostrar = true`

### Requirement: Componente BloqueConceptoFactura en la capa de plantilla (rebanada 6.3)

El sistema SHALL (DEBE) proveer en `documentos/presentation/componentes/` un componente
React-PDF `BloqueConceptoFactura` que renderice el concepto de la factura sin información de
horas ni desglose de invitados (a diferencia del presupuesto). El componente DEBE aceptar como
props el concepto principal (string) y, opcionalmente, una lista de extras
(`{ descripcion, subtotal }`). El componente es un `.tsx` reutilizado por la factura de
liquidación (con extras) y la de señal/fianza (sin extras). Todas las funciones nombradas son
**arrow functions**. (Fuente: épico #6 rebanada 6.3; nota del Excel "sin horas" para facturas;
`CLAUDE.md` regla `components/ solo .tsx`.)

#### Scenario: BloqueConceptoFactura sin extras renderiza solo el concepto

- **GIVEN** un `BloqueConceptoFactura` con `concepto = "40% de l'import…"` y sin extras
- **WHEN** se renderiza en el PDF
- **THEN** el PDF contiene el concepto y no muestra sección de extras ni de horas

#### Scenario: BloqueConceptoFactura con extras renderiza los sub-conceptos

- **GIVEN** un `BloqueConceptoFactura` con `concepto` y `extras = [{ descripcion, subtotal }]`
- **WHEN** se renderiza en el PDF
- **THEN** el PDF contiene el concepto principal y cada extra como sub-concepto con su subtotal

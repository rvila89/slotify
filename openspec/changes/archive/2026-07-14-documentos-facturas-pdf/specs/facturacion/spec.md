## MODIFIED Requirements

### Requirement: Desglose fiscal de la factura según régimen IVA y redondeo contable

El sistema SHALL (DEBE) calcular el desglose fiscal de la factura derivando los campos del
total y del **régimen IVA** (`regimenIva`) del presupuesto aceptado de la reserva:

- **CON IVA** (`regimenIva = 'con_iva'`): `iva_porcentaje = 21,00`; `base_imponible =
  round(total / 1,21, 2)`; `iva_importe = total − base_imponible`. El redondeo es **contable
  a 2 decimales (mitad hacia arriba)** y el `iva_importe` se obtiene **por resta** del total,
  de modo que `base_imponible + iva_importe = total` **exactamente**, sin desajuste de céntimos
  por doble redondeo.
- **SIN IVA** (`regimenIva = 'sin_iva'`): `iva_porcentaje = 0,00`; `iva_importe = 0,00`;
  `base_imponible = total` (el total ya es la base neta, sin impuesto). En este régimen,
  `base_imponible + iva_importe = total` se cumple trivialmente.

El cálculo del desglose es lógica de **dominio puro** (función `calcularDesgloseFactura(total,
regimenIva)` en `calculo-factura.ts`). El `regimenIva` se obtiene del presupuesto aceptado de
la reserva (a través de `ReservaFacturable.regimenIva`, populado por el adapter que lee
`Presupuesto WHERE reservaId AND estado = 'aceptado'`). (Fuente: `US-022 §Happy Path`;
épico #6 rebanada 6.3 `documentos-facturas-pdf`; `er-diagram.md §3.12`.)

#### Scenario: 1.200 € CON IVA desglosa 991,74 base + 208,26 IVA

- **GIVEN** una factura de señal con `total = 1.200,00 €` y `regimenIva = 'con_iva'`
- **WHEN** el sistema calcula el desglose fiscal
- **THEN** `iva_porcentaje = 21,00`, `base_imponible = 991,74 €`, `iva_importe = 208,26 €`
- **AND** `base_imponible + iva_importe = total` exactamente

#### Scenario: 1.200 € SIN IVA — base igual al total, IVA cero

- **GIVEN** una factura de señal con `total = 1.200,00 €` y `regimenIva = 'sin_iva'`
- **WHEN** el sistema calcula el desglose fiscal
- **THEN** `iva_porcentaje = 0,00`, `base_imponible = 1.200,00 €`, `iva_importe = 0,00 €`
- **AND** `base_imponible + iva_importe = total` exactamente

### Requirement: Generación del PDF de la factura con datos fiscales de emisor y receptor

El sistema SHALL (DEBE), tras crear la factura en `borrador`, generar el PDF vía el puerto de
dominio `GenerarPdfFacturaPort` (adaptador real en rebanada 6.3, `PdfFacturaRealAdapter`) con
`@react-pdf/renderer`, reutilizando la capa de plantilla compartida de `documentos/presentation/`
(introducida en rebanadas 6.1b/6.2). Los datos del **emisor** provienen de
`PlantillaDocumentoTenant` (rebanada 6.1a: `razonSocialFiscal`, `nif`, `nombreComercial`, `iban`,
`direccionFiscal`); los datos del **receptor** del `CLIENTE` (`nombre`, `apellidos`, `dniNif`,
`direccion`, `codigoPostal`, `poblacion`, `provincia`); el **concepto** referencia el número de
presupuesto aceptado de la reserva (ver `design.md §D2`). El PDF generado se sube mediante
`AlmacenDocumentosPort` y la URL resultante se almacena como `FACTURA.pdf_url`. La generación es
**posterior al commit** de la creación y el guardado de `pdf_url` es **idempotente**. El sistema
DEBE registrar `AUDIT_LOG` con `accion = 'crear'`, `entidad = 'FACTURA'` y el `entidad_id` de la
factura creada.

El PDF adopta la **variante CON IVA o SIN IVA** según `Factura.ivaPorcentaje`:

- **CON IVA** (ivaPorcentaje > 0): cabecera con razón social fiscal + NIF; totales con base
  imponible + IVA + total; pie de datos bancarios presente.
- **SIN IVA** (ivaPorcentaje = 0): cabecera sin identidad fiscal (solo nombre comercial);
  totales solo con el total neto (sin base/IVA); sin pie bancario.

(Fuente: `US-022 §Happy Path`; épico #6 rebanadas 6.1a, 6.1b, 6.2, 6.3.)

#### Scenario: La factura válida CON IVA obtiene su PDF con cabecera fiscal y pie bancario

- **GIVEN** una factura de señal en `borrador` con `ivaPorcentaje = 21.00`, datos fiscales del
  cliente completos y `PlantillaDocumentoTenant` del tenant configurada
- **WHEN** el sistema genera el PDF de la factura
- **THEN** el PDF contiene la razón social fiscal y el NIF del emisor, el desglose base/IVA/total,
  y el pie de datos bancarios; `FACTURA.pdf_url` queda almacenada
- **AND** `AUDIT_LOG` registra `accion = 'crear'`, `entidad = 'FACTURA'`

#### Scenario: La factura válida SIN IVA obtiene su PDF sin cabecera fiscal ni pie bancario

- **GIVEN** una factura de señal en `borrador` con `ivaPorcentaje = 0.00` y datos del cliente completos
- **WHEN** el sistema genera el PDF de la factura
- **THEN** el PDF no contiene la razón social fiscal ni el NIF del emisor, muestra solo el total
  (sin base/IVA), y no contiene el bloque bancario; `FACTURA.pdf_url` queda almacenada

## ADDED Requirements

### Requirement: ReservaFacturable incluye regimenIva del presupuesto aceptado

El sistema SHALL (DEBE) enriquecer el objeto de dominio `ReservaFacturable` (value object
cargado por `CargarReservaFacturablePort`) con el campo `regimenIva: 'con_iva' | 'sin_iva'`
derivado del presupuesto aceptado de la reserva. El adapter Prisma DEBE realizar un JOIN
`Presupuesto WHERE reservaId = X AND estado = 'aceptado'` para poblar este campo. Si no existe
presupuesto aceptado (caso edge), el adapter DEBE derivar `regimenIva = 'con_iva'` como valor
por defecto. (Fuente: épico #6 rebanada 6.3 `design.md §D1`.)

#### Scenario: ReservaFacturable con presupuesto aceptado CON IVA tiene regimenIva con_iva

- **GIVEN** una RESERVA cuyo presupuesto aceptado tiene `regimen_iva = 'con_iva'`
- **WHEN** se carga `ReservaFacturable` vía `CargarReservaFacturablePort`
- **THEN** `ReservaFacturable.regimenIva = 'con_iva'`

#### Scenario: ReservaFacturable con presupuesto aceptado SIN IVA tiene regimenIva sin_iva

- **GIVEN** una RESERVA cuyo presupuesto aceptado tiene `regimen_iva = 'sin_iva'`
- **WHEN** se carga `ReservaFacturable` vía `CargarReservaFacturablePort`
- **THEN** `ReservaFacturable.regimenIva = 'sin_iva'`

### Requirement: Puerto CargarDatosDocumentoFacturaPort para datos de generación del PDF

El sistema SHALL (DEBE) definir en el dominio de `facturacion` un puerto
`CargarDatosDocumentoFacturaPort` que, dado un `idFactura` y `tenantId`, devuelva un VO
`DatosDocumentoFactura` con: la `ConfiguracionDocumentoTenant` del tenant, el
`numeroPresupuesto` y `regimenIva` del presupuesto aceptado de la reserva, y los datos
fiscales del cliente receptor. Este puerto es llamado exclusivamente por `PdfFacturaRealAdapter`
antes de renderizar el PDF. (Fuente: épico #6 rebanada 6.3 `design.md §D3`.)

#### Scenario: El port devuelve los datos completos para generar el PDF de la factura

- **GIVEN** una FACTURA con `idFactura`, cuya reserva tiene un presupuesto aceptado con
  `numeroPresupuesto = '2026001'` y `regimen_iva = 'con_iva'`, y cuyo tenant tiene
  `PlantillaDocumentoTenant` configurada
- **WHEN** se invoca `CargarDatosDocumentoFacturaPort.cargar(idFactura, tenantId)`
- **THEN** el VO `DatosDocumentoFactura` contiene la configuración del tenant, el
  `numeroPresupuesto = '2026001'`, `regimenIva = 'con_iva'` y los datos fiscales del cliente

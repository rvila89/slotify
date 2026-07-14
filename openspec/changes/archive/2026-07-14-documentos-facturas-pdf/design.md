# Design: documentos-facturas-pdf (6.3)

## Decisiones de diseño

### D1 — Régimen IVA en factura: derivado de `ivaPorcentaje`, sin campo nuevo

**Decisión:** No se añade `regimen_iva` a la tabla `Factura`. El régimen se codifica
en `Factura.ivaPorcentaje`:

- `ivaPorcentaje = 21.00` → CON IVA (presupuesto por transferencia)
- `ivaPorcentaje = 0.00` → SIN IVA (presupuesto por efectivo)

El PDF adapter lee `ivaPorcentaje` y decide qué flags activar en el modelo de vista.

**Rationale:** El schema ya soporta `Decimal(4,2)`, ninguna restricción impide `0.00`.
Evita migración. El `ivaPorcentaje = 0` es semánticamente correcto (tipo impositivo
nulo) y traza con el Excel ("SENSE IVA" = sin IVA, importe menor).

**Corrección del dominio necesaria:** Los use-cases `GenerarFacturaSenalUseCase` y
`GenerarBorradoresLiquidacionFianzaUseCase` hoy asumen siempre IVA 21%. Se actualiza
`calcularDesgloseFactura(total, regimenIva)` con la rama:

```
si regimenIva = 'sin_iva':
  ivaPorcentaje = 0, ivaImporte = 0, baseImponible = total
sino:
  ivaPorcentaje = 21, base = round(total / 1.21, 2), iva = total - base
```

Para conocer el régimen, `CargarReservaFacturablePort` (y su adapter Prisma) se
actualiza para también devolver el `regimenIva` del presupuesto aceptado de la
reserva (JOIN `Presupuesto WHERE reservaId = X AND estado = 'aceptado'`).
`ReservaFacturable` (VO de dominio) gana el campo `regimenIva`.

---

### D2 — Concepto de la factura

**Señal (tipo = 'senal'):**
```
"40% de l'import total anticipat del pressupost núm. {numeroPresupuesto}"
```
(Fiel a la hoja "factura40" del Excel: "*40% de l'import total anticipat del
pressupost núm…")

**Liquidación (tipo = 'liquidacion'):**
```
"Saldo del 60% de l'import del pressupost núm. {numeroPresupuesto}"
```
Si hay extras, se añaden como sub-conceptos (mismo criterio que el presupuesto).

**Fianza (tipo = 'fianza'):**
```
"Fiança de garantia — {nombreComercial del tenant}"
```
Sin referencia a presupuesto (la fianza es del espacio, no del presupuesto).

El `numeroPresupuesto` se obtiene vía el nuevo port `CargarDatosDocumentoFacturaPort`.
Si el presupuesto aceptado no tiene `numeroPresupuesto` (caso edge de migración),
el concepto omite el número.

---

### D3 — Nuevo port `CargarDatosDocumentoFacturaPort`

Puerto de dominio (en `facturacion/domain/`):

```typescript
interface DatosDocumentoFactura {
  configuracion: ConfiguracionDocumentoTenant;  // de 6.1a
  numeroPresupuesto: string | null;             // del presupuesto aceptado
  regimenIva: 'con_iva' | 'sin_iva';           // del presupuesto aceptado
  cliente: {                                    // datos fiscales del receptor
    nombre: string;
    apellidos: string;
    dniNif: string | null;
    direccion: string | null;
    codigoPostal: string | null;
    poblacion: string | null;
    provincia: string | null;
    email: string;
  };
  reservaId: string;
}

interface CargarDatosDocumentoFacturaPort {
  cargar(idFactura: string, tenantId: string): Promise<DatosDocumentoFactura>;
}
```

Token: `CARGAR_DATOS_DOCUMENTO_FACTURA_PORT`.

Adapter Prisma: `CargarDatosDocumentoFacturaPrismaAdapter` en
`facturacion/infrastructure/`, une `Factura → Reserva → Presupuesto (estado=aceptado)
→ Cliente` y carga `PlantillaDocumentoTenant` del tenant.

---

### D4 — Estructura de archivos

**Adapter real (facturacion/infrastructure/):**
```
pdf-factura.real.adapter.ts        ← implementa GenerarPdfFacturaPort
cargar-datos-documento-factura.prisma.adapter.ts
```

**Template (documentos/presentation/):**
```
modelo-documento-factura.ts        ← VO ModeloDocumentoFactura + builder
documento-factura.render.ts        ← renderizarDocumentoFacturaABytes()
componentes/
  BloqueConceptoFactura.tsx        ← concepto sin horas, ref. nº presupuesto
```

Reutiliza sin modificar: `DocumentoLayout`, `Cabecera`, `BloqueTotales`,
`PieBancario`, `BloqueCliente`, `estilos.ts`, `kit-react-pdf.ts`.

---

### D5 — Flags CON/SIN IVA en el modelo de vista de factura

```typescript
interface ModeloDocumentoFactura {
  tipo: 'senal' | 'liquidacion' | 'fianza';
  numeroFactura: string | null;
  fechaEmision: string;
  cabecera: {
    mostrarIdentidadFiscal: boolean;  // false si sin_iva
    // ... resto igual que presupuesto
  };
  totales: {
    mostrarDesgloseIva: boolean;      // false si sin_iva
    baseImponible: string | null;
    ivaPorcentaje: string | null;
    ivaImporte: string | null;
    total: string;
  };
  pieBancario: {
    mostrar: boolean;                 // false si sin_iva
    // ... datos bancarios
  };
  concepto: string;                   // generado según D2
  extras: { descripcion: string; subtotal: string }[];  // solo en liquidación
}
```

Misma lógica de flags que `construirModeloDocumentoPresupuesto` en 6.2.

---

### D6 — Wiring en facturacion.module.ts

```typescript
// Reemplazar:
{ provide: GENERAR_PDF_FACTURA_PORT, useFactory: () => new PdfFacturaFakeAdapter() }

// Por:
{
  provide: CARGAR_DATOS_DOCUMENTO_FACTURA_PORT,
  useFactory: (prisma) => new CargarDatosDocumentoFacturaPrismaAdapter(prisma),
  inject: [PrismaService],
},
{
  provide: GENERAR_PDF_FACTURA_PORT,
  useFactory: (cargar, almacen) => new PdfFacturaRealAdapter(cargar, almacen),
  inject: [CARGAR_DATOS_DOCUMENTO_FACTURA_PORT, ALMACEN_DOCUMENTOS_PORT],
},
```

`ALMACEN_DOCUMENTOS_PORT` ya está en `documentos.module.ts`; se importa
`DocumentosModule` en `FacturacionModule` (si no estaba ya), o se re-exporta el
port en `DocumentosModule`.

---

### D7 — Tests

- **Unit**: `construirModeloDocumentoFactura` — cobertura CON/SIN IVA × {señal, liquidación, fianza}
- **Unit**: `calcularDesgloseFactura` con `regimenIva = 'sin_iva'`
- **Integration**: `PdfFacturaRealAdapter` + `AlmacenDocumentosLocalAdapter` — genera bytes reales
- **Unit update**: `GenerarFacturaSenalUseCase` + `GenararBorradoresLiquidacionFianzaUseCase`
  — verificar que `ivaPorcentaje = 0` cuando `regimenIva = 'sin_iva'`

---

### D8 — Sin migración de BD

`Factura.ivaPorcentaje Decimal(4,2)` admite `0.00`. No se añaden columnas.
No hay cambio de schema Prisma en este change.

---

## Cuestiones abiertas (para el gate)

- **Q1 — Extras en liquidación SIN IVA**: los extras del presupuesto, ¿llevan IVA?
  Asumimos que si el régimen es sin_iva, todos los sub-conceptos también van sin IVA.
  Confirmar con el usuario antes de implementar.

- **Q2 — Concepto fianza**: ¿es suficiente "Fiança de garantia — {nombreComercial}"
  o debe referenciar también el nº de presupuesto?

- **Q3 — Señal: datos del cliente**: la factura de señal puede generarse con datos
  fiscales del cliente incompletos (borrador inválido). El PDF adapter debe manejar
  `dniNif = null` / campos de dirección nulos (borrador inválido → no generar PDF,
  comportamiento ya existente en el use-case). Confirmar que no se cambia esta guarda.

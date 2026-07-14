# Proposal: documentos-facturas-pdf (Épico #6, rebanada 6.3)

## Qué

Sustituir `PdfFacturaFakeAdapter` (que devuelve URLs sintéticas) por un adaptador
real que genera PDFs de facturas de señal (40%), liquidación (60%) y fianza
con `@react-pdf/renderer`, reutilizando la capa de plantilla compartida de
`documentos/presentation/`. Incluye soporte **CON IVA / SIN IVA** en el renderizado
de facturas (derivado de `Factura.ivaPorcentaje`) y el **concepto con referencia al
número de presupuesto** aceptado de la reserva.

El change también corrige el dominio de facturación para que, cuando el presupuesto
aceptado tenga `regimenIva = 'sin_iva'`, la factura se cree con `ivaPorcentaje = 0`,
`ivaImporte = 0` y `baseImponible = total` (en lugar del IVA 21% actual).

## Por qué

Hito del épico #6 (documentos PDF reales como el Excel del tenant):

- Las facturas en producción deben adjuntar PDFs reales a los emails E3 (señal)
  y E4 (liquidación + fianza). Actualmente `PdfFacturaFakeAdapter` devuelve una
  URL sintética (`https://storage.local/facturas/{id}.pdf`) que no existe.
- Con la doble numeración de presupuesto (CON/SIN IVA) introducida en 6.2, las
  facturas deben reflejar el mismo régimen del presupuesto aceptado: cabecera sin
  identidad fiscal, sin desglose IVA y sin pie bancario en la variante SIN IVA.
- El concepto de la factura debe referenciar el número de presupuesto para
  trazabilidad contable (exigido por el Excel del tenant: hoja "factura40" →
  "*40% de l'import total anticipat del pressupost núm. {n}").

## Alcance

### Backend (`apps/api`)

- **Domain fix**: `ReservaFacturable` (VO) gana campo `regimenIva: 'con_iva' | 'sin_iva'`;
  `calcularDesgloseFactura` deriva `ivaPorcentaje` del régimen (0 si sin_iva).
  Afecta: `calculo-factura.ts`, `CargarReservaFacturablePort` (y su adapter Prisma),
  `GenerarFacturaSenalUseCase`, `GenerarBorradoresLiquidacionFianzaUseCase`.
- **Nuevo port** `CargarDatosDocumentoFacturaPort` — carga `ConfiguracionDocumentoTenant`
  + `Presupuesto.{numeroPresupuesto, regimenIva}` + datos fiscales del cliente, desde la
  perspectiva del `idFactura`.
- **Nuevo adapter** `PdfFacturaRealAdapter` — implementa `GenerarPdfFacturaPort`:
  invoca `CargarDatosDocumentoFacturaPort`, construye el modelo de vista, renderiza con
  `@react-pdf/renderer` y sube a `AlmacenDocumentosPort`.
- **Template factura** en `documentos/presentation/`:
  `modelo-documento-factura.ts` (VO + builder) y `documento-factura.render.ts`
  (función de renderizado). Nuevo componente `BloqueConceptoFactura` (sin horas,
  referencia nº presupuesto). Reutiliza `DocumentoLayout`, `Cabecera`,
  `BloqueTotales`, `PieBancario`, `estilos.ts`, `kit-react-pdf.ts`.
- **Wiring** — `facturacion.module.ts` reemplaza `PdfFacturaFakeAdapter` por
  `PdfFacturaRealAdapter`; añade `CargarDatosDocumentoFacturaPrismaAdapter`.
- **Sin migración de BD** — `Factura.ivaPorcentaje` (Decimal) ya admite 0.00; no
  se añaden columnas nuevas.

### Frontend (`apps/web`)

No hay cambios de UI en este change. E3 y E4 ya adjuntan el `pdfUrl` existente;
una vez que el adaptador real genera la URL real, el frontend funciona sin cambios.

## Fuera de alcance

- UI de ajustes del tenant (6.5).
- Condicions particulars (6.4).
- Adaptador cloud de almacén (el `AlmacenDocumentosLocalAdapter` de 6.1a sigue
  en uso; cloud se desbloquea cuando haya credenciales).
- Email E3 (envío de señal al cliente) — se adjunta el PDF una vez real, pero
  el envío del email E3 pertenece a US futura.

## Dependencias

- **6.1a** (`documentos-config-tenant-storage`): `PlantillaDocumentoTenant`,
  `AlmacenDocumentosPort`, `ObtenerConfiguracionDocumentoService` — MERGEADO.
- **6.1b** (`documentos-presupuesto-pdf-con-iva`): capa de plantilla compartida
  (`DocumentoLayout`, `Cabecera`, `BloqueTotales`, `PieBancario`, `estilos.ts`,
  `kit-react-pdf.ts`) — MERGEADO.
- **6.2** (`documentos-presupuesto-sin-iva-doble-numeracion` + fix #66): `RegimenIva`,
  `Presupuesto.{regimenIva, metodoPago, numeroPresupuesto}`, doble secuencia — MERGEADO.

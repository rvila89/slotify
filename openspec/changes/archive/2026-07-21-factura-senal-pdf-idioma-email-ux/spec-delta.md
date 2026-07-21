# Spec-delta — factura-senal-pdf-idioma-email-ux

## `openspec/specs/facturacion/spec.md` → [`specs/facturacion/spec.md`](specs/facturacion/spec.md)

- **MODIFIED `R-FACTURA-PDF-IDIOMA`** — "PDF de factura respeta idioma de la reserva": el PDF de la factura de señal (y liquidación) se genera en el idioma (`es`/`ca`) de `Reserva.idioma`, mismo patrón que el presupuesto. Elimina la deuda D6 del change `6.3`.
- **ADDED `R-FACTURA-E3ENVIADO`** — "Flag `e3Enviado` en la respuesta de la factura de señal": `GET /reservas/{id}/factura-senal` incluye `e3Enviado: boolean` que refleja si existe una COMUNICACION E3 `enviado` con `es_reenvio=false` para la reserva.
- **MODIFIED `R-FACTURA-E3-NOMBRE-ADJUNTO`** — "Nombre del adjunto PDF de la factura": el adjunto del email E3 (envío y reenvío) se nombra `{numeroFactura} {clienteNombre} {clienteApellidos}.pdf` en lugar de `factura-senal.pdf`.

## `openspec/specs/documentos/spec.md` → [`specs/documentos/spec.md`](specs/documentos/spec.md)

- **MODIFIED `R-DOC-FACTURA-ETIQUETAS-IDIOMA`** — "Etiquetas del documento de factura por idioma": `DocumentoFacturaLayout` usa `etiquetasDocumento(modelo.idioma)` en lugar de `'ca'` hardcodeado. `BloqueConceptoFactura` recibe `etiquetaConcepto`/`etiquetaPrecio` como props.
- **MODIFIED `R-DOC-FACTURA-CONCEPTO-IDIOMA`** — "Concepto fiscal de la factura bilíngüe": `resolverConcepto()` devuelve el texto en el idioma indicado (ES/CA) para los tres tipos (señal, liquidación, fianza).
- **ADDED `R-DOC-ETIQUETA-IMPORT-FACTURA`** — "Etiqueta `importFactura` en el bundle de etiquetas": `EtiquetasDocumento` incluye `importFactura` ('Import factura' CA / 'Importe factura' ES).

## `openspec/specs/comunicaciones/spec.md` → [`specs/comunicaciones/spec.md`](specs/comunicaciones/spec.md)

- **MODIFIED `R-E3-PLANTILLA-BILINGUE`** — "Plantilla E3 bilíngüe en el catálogo": el catálogo registra `PLANTILLA_E3_CA` (nueva) y actualiza `PLANTILLA_E3_ES` con el texto aprobado por el tenant. `variablesRequeridas: ['nombre', 'codigoReserva']`. Sin mención a condiciones particulares (ya enviadas en E2).
- **MODIFIED `R-E3-RUTA-CATALOGO`** — "E3 pasa por el catálogo en emisión y reenvío": `EnviarE3EmisionAdapter` y `ReenviarE3Adapter` renderizan el template vía `CatalogoPlantillasPort` por `idioma`, eliminando el texto hardcodeado en el adaptador.

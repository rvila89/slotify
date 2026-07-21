# Proposal — factura-senal-pdf-idioma-email-ux

## Por qué

La factura de señal (épico #6, 6.4b) acumula cuatro brechas de calidad identificadas en producción:

1. **PDF monolingüe (D6 pendiente):** `DocumentoFacturaLayout.tsx` hardcodea `etiquetasDocumento('ca')`. Todos los PDFs de factura salen en catalán aunque `Reserva.idioma = 'es'`. El presupuesto ya resuelve esto correctamente desde el change `pdf-presupuesto-horario-idioma`; la factura quedó diferida en el campo como deuda técnica.

2. **Email E3 bypassa el catálogo y tiene texto incorrecto:** `EnviarE3EmisionAdapter` y `ReenviarE3Adapter` usan `asunto`/`cuerpo` hardcodeados en el adaptador de infraestructura — el `CatalogoPlantillasPort` tiene `renderE3` declarado pero NUNCA se invoca. El texto actual es genérico, menciona "condicions particulars" (ya enviadas en E2) y no tiene variante catalana.

3. **UX de envío/reenvío confusa:** El bloque `EnvioFacturaSenal` muestra siempre los dos botones ("Enviar factura 40%" + "Reenviar E3") sin distinguir si E3 ya fue enviado. El backend bloquea el reenvío idempotente con 409 `E3_YA_ENVIADO`, pero el gestor no recibe señal visual de que ya se envió. Tampoco hay retroalimentación de éxito sin recargar.

4. **Sección Comunicaciones no se actualiza en tiempo real:** Ninguno de los dos hooks de mutación (`useEnviarFacturaSenal`, `useReenviarE3`) invalida `comunicacionesReservaQueryKey`. El gestor debe recargar la página para ver el nuevo registro E3.

Adicionalmente:
- El nombre del adjunto PDF (`factura-senal.pdf`) no es informativo para el cliente.
- La card muestra un banner verde inline que no sigue el patrón toast del resto de acciones.

## Qué cambia

### PDF bilíngüe (documentos / facturacion)
- `etiquetas-por-idioma.ts`: añadir `importFactura` ("Import factura" CA / "Importe factura" ES).
- `modelo-documento-factura.ts`: añadir `idioma` al modelo y params; `resolverConcepto()` bilíngüe; `pieLegal` por idioma.
- `DocumentoFacturaLayout.tsx`: usar `modelo.idioma` en lugar de `'ca'` hardcodeado; etiquetas "REBUT/RECIBO" y "Rebut/Recibo" según idioma; pasar `etiquetas.concepto`/`etiquetas.precio` a `BloqueConceptoFactura`.
- `BloqueConceptoFactura.tsx`: recibir `etiquetaConcepto`/`etiquetaPrecio` como props.
- `cargar-datos-documento-factura.port.ts` + adapter Prisma: incluir `idioma` en `DatosDocumentoFactura`.

### Email E3 bilíngüe (comunicaciones / facturacion)
- `catalogo-plantillas.ts`: nuevo `renderE3` (ES) + `renderE3Ca` (CA) con texto aprobado; registrar `PLANTILLA_E3_CA`; actualizar `variablesRequeridas: ['nombre', 'codigoReserva']`.
- `emision-email.adapter.ts`: `EnviarE3EmisionAdapter` y `ReenviarE3Adapter` inyectan `CatalogoPlantillasPort`, renderizan el template por `idioma` y pasan el resultado a `EnviarEmailPort`.
- `enviar-factura-senal.use-case.ts` + `reenviar-e3.use-case.ts`: añadir `idioma`, `clienteNombre`, `clienteApellidos` a las proyecciones de reserva; propagar `idioma` y `nombre` al adaptador de email; nombre del adjunto `{numeroFactura} {nombre} {apellidos}.pdf`.
- Adapters Prisma de carga de reserva para emisión/reenvío: SELECT adicional de `idioma`, `cliente.nombre`, `cliente.apellidos`.

### Flag `e3Enviado` + UX (facturacion / frontend)
- `obtener-factura-senal.use-case.ts` + adapter Prisma: añadir `e3Enviado: boolean` al resultado (check COMUNICACION E3 `enviado, es_reenvio=false`).
- Contrato `docs/api-spec.yml`: campo `e3Enviado: boolean` en `FacturaSenalResponse` (additive, non-breaking); regenerar SDK.
- `EnvioFacturaSenal.tsx`: eliminar banner verde; condicionar botones según `e3Enviado` prop.
- `FacturaSenalCard.tsx`: pasar `factura.e3Enviado` a `EnvioFacturaSenal`.
- `useEnviarFacturaSenal.ts` + `useReenviarE3.ts`: invalidar `comunicacionesReservaQueryKey` en `onSuccess`.

### Anti-scope
- No se modifica la lógica de numeración de facturas.
- No se cambia el flujo de condiciones particulares (ya enviadas por E2 en este tenant).
- No se tocan E4/E5-E8 ni otros emails.
- El PDF del presupuesto no se toca.

## Impacto
- **Specs afectadas:** `facturacion/`, `documentos/`, `comunicaciones/`
- **Código:** ~15 ficheros, sin migraciones de BD ni cambios en schema Prisma
- **Contrato:** 1 campo additive en `FacturaSenalResponse`
- **Tests:** nuevos unit en `modelo-documento-factura`, `catalogo-plantillas-e3`, `enviar-factura-senal`

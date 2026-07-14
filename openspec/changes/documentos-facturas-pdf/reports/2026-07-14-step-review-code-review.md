# Code Review: documentos-facturas-pdf

Rebanada 6.3 del épico #6 — Facturas PDF reales. Revisión contra los guardarraíles del
proyecto (hexagonal, arrow functions, multi-tenancy/RLS, contrato OpenAPI, `components/`
solo `.tsx`, no fake adapter wired, no locks distribuidos, clave de almacén por tenant,
`import()` nativo para react-pdf). Solo lectura: se señala, no se edita.

Nota de contexto: la rama `feature/documentos-facturas-pdf` apunta al mismo commit que
`master`; los cambios de 6.3 están en el árbol de trabajo (sin commitear). La revisión se
hizo sobre el working tree: `git diff` de los ficheros modificados + lectura directa de los
nuevos (`??`).

## Alcance revisado

Modificados:
- `facturacion/domain/calculo-factura.ts` (+`calcularDesgloseFactura`, `RegimenIvaFactura`, `IVA_PORCENTAJE_SIN_IVA`)
- `facturacion/application/generar-factura-senal.use-case.ts` (regimenIva en VO + `tenantId` en `GenerarPdfFacturaParams`)
- `facturacion/application/generar-borradores-liquidacion-fianza.use-case.ts` (regimenIva en VO)
- `facturacion/application/regenerar-pdf-factura.use-case.ts` (pasa `tenantId` al puerto de PDF)
- `facturacion/infrastructure/lecturas-facturacion.prisma.adapter.ts` y `lecturas-borradores.prisma.adapter.ts` (populan `regimenIva`)
- `facturacion/facturacion.module.ts` y `facturacion.tokens.ts` (wiring del adaptador REAL + nuevo token)

Nuevos:
- `facturacion/domain/cargar-datos-documento-factura.port.ts`
- `facturacion/infrastructure/cargar-datos-documento-factura.prisma.adapter.ts`
- `facturacion/infrastructure/pdf-factura.real.adapter.ts`
- `documentos/presentation/modelo-documento-factura.ts`
- `documentos/presentation/documento-factura.render.ts`
- `documentos/presentation/componentes/BloqueConceptoFactura.tsx`
- `documentos/presentation/componentes/DocumentoFacturaLayout.tsx`
- Tests: `calculo-factura.spec.ts` (mod), `modelo-documento-factura.spec.ts` (nuevo), specs de los 2 use-cases (mod)

## Verificación de guardarraíles

1. Hexagonal — OK. `calculo-factura.ts` y `cargar-datos-documento-factura.port.ts`
   (dominio) son puros: interfaces + arrow functions, sin `@nestjs`/`prisma`/`infrastructure`.
   El puerto reutiliza el VO `ConfiguracionDocumentoTenant` de `documentos/domain` (frontera
   de presentación compartida del épico), no importa de `presupuestos`.
2. Arrow functions — OK. Ninguna `function` declarativa en código nuevo; todo son arrow
   functions o métodos de clase (exentos). `grep` de `function ` en los ficheros nuevos: 0.
3. Multi-tenancy / RLS — OK. `cargar-datos-documento-factura.prisma.adapter.ts` usa
   `$transaction` + `this.prisma.fijarTenant(tx, tenantId)`, idéntico patrón a
   `lecturas-facturacion.prisma.adapter.ts`. Además `findFirst({ where: { idFactura, tenantId } })`
   filtra por tenant, y `PdfFacturaRealAdapter` propaga `params.tenantId` del disparo. El
   `tenantId` viaja por el comando/JWT, no por path/body.
4. Contrato — OK. `calcularDesgloseFactura` devuelve `ivaPorcentaje: '0.00'` en SIN IVA.
   El schema `Porcentaje` de `docs/api-spec.yml` (línea 3227) es `pattern: '^\d+\.\d{2}$'`,
   que acepta `'0.00'`. No rompe `FacturaSenalDto.ivaPorcentaje`. Cliente generado no tocado.
5. `components/` solo `.tsx` — OK. `ls` de `documentos/presentation/componentes/` confirma
   que todos los ficheros son `.tsx`. `BloqueConceptoFactura.tsx` y `DocumentoFacturaLayout.tsx`
   son componentes React; los tipos/helpers viven fuera (`modelo-documento-factura.ts`,
   `kit-react-pdf.ts`, `estilos.ts`).
6. No fake adapter wired — OK. `facturacion.module.ts` importa y usa `PdfFacturaRealAdapter`;
   `PdfFacturaFakeAdapter` ya no está referenciado (solo persiste su propia definición y un
   comentario). El provider `GENERAR_PDF_FACTURA_PORT` inyecta el adaptador real.
7. No locks distribuidos — OK. `grep` de `redis|redlock|distributed` en los ficheros nuevos: 0.
8. Clave de almacén con tenant — OK. `clavePdf(tenantId, idFactura)` →
   `${tenantId}/facturas/${idFactura}.pdf`, aísla por tenant. Llamada a
   `AlmacenDocumentosPort.subir(Uint8Array, clave)` coincide con la firma del puerto.
9. `import()` dinámico para react-pdf — OK. `documento-factura.render.ts` usa el mismo
   `importarNativo` vía `Function('m', 'return import(m)')` que `documento-presupuesto.render.ts`,
   evitando la transpilación a `require`. Los `.tsx` reciben las primitivas por `kit`, no
   importan react-pdf.

Verificaciones adicionales:
- `RegimenIva?` existe en el modelo Prisma `Presupuesto` (nullable); el default
  `?? 'con_iva'` (vía `=== 'sin_iva' ? 'sin_iva' : 'con_iva'`) trata correctamente NULL/ausencia.
- `DocumentosModule` exporta `ALMACEN_DOCUMENTOS_PORT` y `facturacion.module.ts` lo importa;
  el wiring del provider resuelve.
- `tsc --noEmit` de `apps/api`: sin errores. TS strict, sin `any` en código nuevo.
- Suites afectadas: 4 passed, 76 tests passed (calculo-factura, modelo-documento-factura,
  generar-factura-senal, generar-borradores-liquidacion-fianza).

## Hallazgos

- [Baja] `DesgloseDocumentoFactura` (puerto) y `DesgloseDocumento`/`ExtraFactura`
  (presentación) definen formas casi idénticas de "desglose"/"extra" en dos capas. Es
  correcto por la frontera hexagonal (dominio de `facturacion` no debe depender de la
  presentación de `documentos`), pero conviene un comentario que fije la equivalencia para
  evitar drift futuro. No bloquea.
- [Baja] En `PdfFacturaRealAdapter.aTipoDocumento`, el tipo `complementaria` se pinta como
  `liquidacion`. Está documentado en el comentario ("no tiene plantilla propia en el MVP"),
  pero no hay test que fije ese fallback. Recomendación: añadir un caso de test para
  `complementaria → liquidacion` en una rebanada futura. No bloquea 6.3.
- [Baja] `formatearFecha` en `DocumentoFacturaLayout.tsx` usa UTC (`getUTCDate`, etc.), lo
  cual es determinista y correcto para el documento; se alinea con la deuda conocida de
  TZ off-by-one del display de TTL (no aplica aquí porque es fecha de emisión, no hora). Sin
  acción.
- [Baja] Guardarraíl "responsive": no aplica. 6.3 es render de PDF server-side (react-pdf,
  layout A4 fijo), no UI web de `apps/web`; no hay pantallas en 3 viewports que verificar.

No se detectaron hallazgos de severidad Alta ni Media.

## Veredicto: APTO

Todos los guardarraíles críticos se cumplen: dominio puro sin infra, RLS por `fijarTenant` +
filtro `tenant_id`, clave de almacén aislada por tenant, adaptador REAL correctamente wired
(fake retirado), sin locks distribuidos, `import()` nativo para el ESM de react-pdf,
`components/` solo `.tsx`, contrato OpenAPI intacto (`Porcentaje` acepta `'0.00'`), TS strict
sin `any` y 76 tests en verde. Los hallazgos son de severidad Baja (documentación/cobertura
futura) y no bloquean el merge.

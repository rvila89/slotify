# Design — documentos-presupuesto-pdf-con-iva (6.1b)

## Contexto y alcance técnico

Sustituir el `PdfPresupuestoFakeAdapter` por un adaptador real de
`@react-pdf/renderer` (Node), sin tocar el dominio: el puerto
`GenerarPdfPresupuestoPort` y el token `GENERAR_PDF_PRESUPUESTO_PORT` **ya
existen**. El único punto de cableado que cambia en `PresupuestosModule` es la
factory del provider de ese token (hoy `new PdfPresupuestoFakeAdapter().generar`).
El caso de uso `GenerarPresupuestoUseCase` no se toca: la generación sigue siendo
**post-commit** (fuera del `FOR UPDATE`) y su fallo devuelve `null` sin revertir
la pre_reserva.

## Capa de plantilla react-pdf (decisión de ubicación)

**Vive en `documentos`** (no en `presupuestos`), como capa de presentación de
documentos de la capability. Motivo: es transversal a presupuestos (6.1b),
facturas (6.3) y Condicions particulars (6.4). Ubicarla en `presupuestos`
obligaría a `facturacion` a depender de `presupuestos` solo para renderizar.

Estructura propuesta (a confirmar en implementación):

```
apps/api/src/documentos/
  presentation/                 # capa de plantilla react-pdf (infra/presentación)
    documento-layout.tsx        # DocumentoLayout (raíz: Page + estilos del tenant)
    cabecera.tsx                # Cabecera (logo opcional + identidad fiscal)
    bloque-cliente.tsx          # BloqueCliente (Dades client)
    tabla-concepto.tsx          # TablaConcepto (CONCEPTE/PREU + sub-conceptos)
    bloque-totales.tsx          # BloqueTotales (Validesa | Base | %IVA | Total)
    pie-bancario.tsx            # PieBancario (instrucciones + IBAN)
    estilos.ts                  # StyleSheet derivado de colorPrimario/colorTexto
    __tests__/                  # tests de render (bytes/estructura)
```

- **Parametrización**: cada componente recibe props tipadas derivadas de
  `ConfiguracionDocumentoTenant` (config del tenant) + un VO de "datos del
  documento" (emisor, cliente, conceptos, totales, numeración, fecha). Sin datos
  de negocio hardcodeados.
- **Arrow functions**: los componentes se escriben como `const Cabecera = (props) => (...)`.
- **Reutilización 6.3**: la factura compondrá su propio "datos del documento" y
  reusará `DocumentoLayout` + sub-componentes (distinta tabla de conceptos/totales).
- **`.tsx` en `apps/api`**: react-pdf usa JSX. Verificar en implementación que el
  `tsconfig`/build de NestJS compila `.tsx` (o usar `React.createElement` sin JSX
  si el toolchain lo complica). **Detalle técnico a validar en TDD/impl.**

## Flujo del adaptador real (presupuestos)

`PdfPresupuestoRealAdapter` (infra en `presupuestos/infrastructure/`) implementa
`GenerarPdfPresupuestoPort`:

1. `ObtenerConfiguracionDocumentoService.ejecutar(tenantId)` → config del tenant.
   Si `null` (tenant sin config) → devolver `null` (degrada como el fake; no
   revienta el post-commit).
2. Cargar los datos del presupuesto/reserva/cliente/extras (nuevo puerto de
   lectura tx-bound bajo RLS, o reusar los adaptadores de lectura existentes de
   `presupuestos`). Ver mapeo de datos abajo.
3. Renderizar con la capa de plantilla → `Buffer`/`Uint8Array` (react-pdf
   `renderToBuffer`).
4. `AlmacenDocumentosPort.subir(bytes, clave)` con
   `clave = presupuestos/{tenantId}/{idPresupuesto}.pdf`.
5. Devolver la URL.

`PresupuestosModule` importará `DocumentosModule` (que ya exporta
`ObtenerConfiguracionDocumentoService` y `ALMACEN_DOCUMENTOS_PORT`).

## Mapeo de datos (Excel "PRESSUPOST IVA" → modelo)

| Campo del PDF | Origen | Notas |
|---|---|---|
| Logo | `config.branding.logoUrl` | nullable → solo-texto (N3) |
| Razón social fiscal, NIF, dir. fiscal, email, web | `config.identidadFiscal` | — |
| Colores | `config.branding.colorPrimario/colorTexto` | StyleSheet |
| Nom i cognom client | `Cliente.nombre` + `Cliente.apellidos` | — |
| DNI/NIF, adreça, CP, població, província | `Cliente.dniNif/direccion/codigoPostal/poblacion/provincia` | validados en FA-01 |
| Número | `Presupuesto.numeroPresupuesto` (nuevo) | N1/N2 |
| Data | `Presupuesto.fechaCreacion` o `fechaEnvio` | decidir en impl |
| Concepte (texto) | `config.textos.plantillaConceptoFiscal` con `{nombreComercial}` resuelto | nunca "lloguer" |
| Data de l'esdeveniment | `Reserva.fechaEvento` (`@db.Date`) | — |
| Horario/duración | `Reserva.duracionHoras` (enum 4/8/12) | **N5**: NO hay hora inicio |
| Nº persones | `Reserva.numAdultosNinosMayores4` | menores de 4 son informativos |
| Extres (sub-conceptes) | `ReservaExtra` (join a `Extra`), `subtotal`/`precioUnitario` | ~4 huecos |
| Validesa | `config.textos.validesaTexto` | p. ej. "10 DIES" |
| Base imp. / % IVA / Total | `Presupuesto.baseImponible/ivaPorcentaje/total` | CON IVA |
| 40% / 60% / Fiança | reparto (`calcularReparto`) del presupuesto | "A l'arribada" |
| Pie bancario (IBAN, beneficiario, concepto) | `config.banca` | transferencia |

## Cuestiones abiertas (PARA EL GATE — no resueltas aquí)

### N1 — ¿Cuándo/dónde se asigna `numero_presupuesto`?

**Contexto**: hoy el `Presupuesto` se crea en la transacción de confirmación
(`repos.presupuestos.crear(...)`), y el PDF se genera **post-commit**. El número
del presupuesto debe existir **antes** de renderizar el PDF (aparece en él).

**Propuesta**: asignar el `numero_presupuesto` **dentro de la transacción de
confirmación**, en `crear(...)`, calculándolo con la función de dominio
(`MAX` del último número del tenant en el año, dentro de la tx bajo RLS +
reintento ante violación de unicidad `P2002`, igual que la factura). Así el número
está congelado y disponible cuando el post-commit renderiza. **Pregunta al
humano**: ¿de acuerdo con asignarlo en la tx de confirmación (no en el
post-commit)? ¿reintento ante colisión como en `numeracion-factura`?

### N2 — Esquema de `numero_presupuesto` + `tenant_id` en `Presupuesto`

**Contexto**: `Presupuesto` **no tiene `tenant_id`** (llega vía `reserva_id`). La
unicidad "por tenant + año" necesita el `tenant_id` en la fila o una unicidad
compuesta vía join. `Factura` sí tiene `tenant_id` y usa
`@@unique([tenantId, numeroFactura])`.

**Propuesta**: añadir a `Presupuesto` **`numero_presupuesto String?`** (nullable
para migración no destructiva; los presupuestos antiguos quedan sin número) **y
`tenant_id`** (con RLS), con `@@unique([tenantId, numeroPresupuesto])` (año
embebido en el literal, igual patrón que factura). **Pregunta al humano**:
¿añadimos `tenant_id` a `Presupuesto` (backfill desde `reserva.tenant_id`) o
preferís evitar el nuevo campo y resolver la unicidad de otra forma? ¿Formato
exacto `2026001` (año + 3 dígitos) o con separador?

### N3 — Logo nullable → cabecera solo-texto

**Contexto**: `branding.logoUrl` es `null` por defecto (upload es 6.5).

**Propuesta**: cabecera **solo-texto** cuando `logoUrl` es `null`; con logo cuando
esté presente. **Pregunta al humano**: ¿OK cabecera solo-texto ahora, sin
placeholder de imagen?

### N4 — ¿Hay cambio de contrato OpenAPI?

**Análisis**: el endpoint de generar presupuesto y el campo `pdf_url` ya existen
en el contrato; 6.1b solo cambia el **valor** de `pdf_url` (URL real vs.
sintética), no el shape de la API. `numero_presupuesto` es interno del PDF; **no**
se propone exponerlo en la respuesta en 6.1b.

**Propuesta**: **sin delta de contrato OpenAPI ni regeneración de SDK**; el
`tasks.md` no tiene fase de contrato. **Pregunta al humano**: ¿confirmáis que
`numero_presupuesto` NO se expone por API en 6.1b (solo va en el PDF)?

### N5 — Horario: no hay hora de inicio en la reserva

**Hallazgo (verificado en el schema)**: `Reserva` tiene `duracionHoras` como
**enum `DuracionHoras` = {4, 8, 12}** y **NO** tiene hora de inicio ni de fin. El
Excel muestra "De 11h a 21h (10 hores)", pero ese rango no es derivable del modelo
actual.

**Propuesta**: en 6.1b mostrar **solo "(N hores)"** a partir de `duracionHoras`
(sin rango horario), ya que no hay dato de hora de inicio. Un rango horario
configurable (p. ej. hora de inicio por tipo de evento o por tenant) sería un
**change aparte**. **Pregunta al humano**: ¿OK mostrar solo "(N hores)" en 6.1b, o
preferís un rango fijo/configurable ahora (implicaría añadir dato)?

### N6 — Verificación visual del PDF en QA

**Contexto**: el PDF real es un binario; los subagentes QA corren **sin Postgres**
(memoria MEMORY: "Subagentes sin Docker/Postgres").

**Propuesta**: QA en dos capas: (a) **tests unitarios de render** de la capa de
plantilla (que produce bytes no vacíos y contiene los textos esperados,
verificables sin BD); (b) **verificación de integración desde la sesión
principal** (que sí tiene Postgres): confirmar un presupuesto real, generar el
PDF, descargarlo del almacén local y **abrirlo/inspeccionarlo visualmente**
(guardar el PDF de muestra en `reports/`). Sin fase de frontend/E2E Playwright
(no hay UI nueva). **Pregunta al humano**: ¿validáis este plan de verificación
visual (revisión manual del PDF generado desde la sesión principal)?

## Reglas duras aplicadas

- **Hexagonal**: renderizador y almacén son infra; el puerto
  `GenerarPdfPresupuestoPort` y `AlmacenDocumentosPort` viven en dominio. La
  numeración es **dominio puro** (sin infra), el `MAX`/reintento es infra.
- **Multi-tenant/RLS**: `tenantId` del JWT; lectura de config/datos bajo RLS;
  clave de almacenamiento con `tenant_id`.
- **TDD**: tests de numeración (dominio) y de render de plantilla antes de impl.
- **Arrow functions** en toda función nombrada (componentes incluidos).
- **Cliente generado del frontend**: NO se toca (sin cambio de API).

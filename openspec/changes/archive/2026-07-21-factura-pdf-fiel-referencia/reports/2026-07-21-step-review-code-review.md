# Code review — change `factura-pdf-fiel-referencia`

- Rama: `feature/factura-pdf-fiel-referencia`
- Commit revisado: `d29014d`
- Diff base: `master..HEAD`
- Alcance: 6 archivos de producción modificados + 1 helper nuevo + 5 specs de test + artefactos SDD
- Fecha: 2026-07-21
- Tipo: revisión de solo lectura contra guardrails (no se aplican fixes)

## Resumen

El change corrige la fidelidad del PDF de factura (react-pdf) respecto a la referencia
`F2026029 Sergio Carrasco.pdf`. Toda la superficie tocada es de presentación de documentos
(`apps/api/src/documentos/presentation/`): un helper puro de formato de importe, el modelo de
vista de factura (concepto principal desde plantilla + subtítulo 40/60, sin `pieLegal`) y los
componentes react-pdf del layout, con retrocompatibilidad del presupuesto vía props con default.

No hay cambios en dominio, dominio de facturación, repositorios, contrato OpenAPI ni cliente
del frontend. No aplican los guardrails de bloqueo atómico de fecha, máquina de estados,
multi-tenancy/RLS, jobs asíncronos ni responsive (no hay UI de `apps/web` en el diff).

## Hallazgos

### Bloqueantes
- Ninguno.

### Alta
- Ninguno.

### Media
- Ninguno.

### Baja
- Ninguno.

## Verificación por guardrail

- **Arrow functions (`func-style: ['error', 'expression']`)**: OK. No hay ninguna declaración
  `function f() {}` en la capa `presentation` (grep sin coincidencias). El helper nuevo
  (`agruparMillares`, `formatearImporteDocumento`) y `interpolarNombreComercial` son arrow
  functions. Los componentes react-pdf son expresiones de flecha.

- **Hexagonal DDD**: OK. `documentos/presentation/` no importa de `@nestjs/*`, `@prisma/*`,
  `infrastructure/`, `facturacion/` ni `presupuestos/` en código de producción. Las únicas
  menciones a `facturacion` son comentarios que documentan que el desglose llega ya congelado
  como dato del documento. El desglose y el régimen entran como datos, no como dependencia.
  (Los `import` de `infrastructure/seed/configuracion-documento-piloto` viven solo en archivos
  `__tests__/`, uso legítimo de un fixture de seed en tests.)

- **`componentes/` solo `.tsx`**: OK. `formato-importe.ts` está en `presentation/`, no bajo
  `componentes/`. Los `.tsx` de `componentes/` solo contienen componentes React; el formateo se
  delega al helper importado.

- **Retrocompatibilidad del presupuesto**: OK.
  - `BloqueTotales` sustituye `validesaTexto` por `etiquetaIzquierda`/`valorIzquierda` (sin
    defaults). `DocumentoLayout.tsx` (presupuesto) pasa `etiquetaIzquierda={etiquetas.validesa}`
    y `valorIzquierda={modelo.validesaTexto}`, preservando el comportamiento previo.
  - `PieBancario` añade `mostrarBeneficiario?` con default `true`, de modo que el presupuesto
    conserva la línea "Dades bancàries:"; la factura la pasa `false`.
  - El modelo de presupuesto sigue exponiendo `validesaTexto` y `pieLegal`, y `DocumentoLayout`
    los sigue pintando.

- **Sin datos de negocio hardcodeados en los `.tsx`**: OK. Los textos provienen del modelo
  resuelto (`modelo.concepto`, `modelo.conceptoSubtitulo`, `etiquetas.*`) y de las etiquetas por
  idioma. El concepto principal de señal/liquidación se resuelve desde
  `config.textos.plantillaConceptoFiscal` interpolando `{nombreComercial}` con el helper
  compartido `interpolarNombreComercial` (sin duplicar la lógica del presupuesto). La fianza
  mantiene su concepto propio en el modelo, no en el componente.

- **`formatearImporteDocumento` aplicado consistentemente**: OK. Todos los puntos que renderizan
  un importe con " €" usan el helper: `BloqueConceptoFactura` (precio principal y extras),
  `BloqueTotales` (base imponible, IVA, total), `BloqueCondicions` (señal/liquidación/fianza) y
  `TablaConcepto` (precio principal y extras). No quedan strings crudos de importe sin formatear
  en el diff.

- **`pieLegal` eliminado del modelo de factura**: OK. `ModeloDocumentoFactura` ya no declara
  `pieLegal`; `construirModeloDocumentoFactura` no lo asigna; `DocumentoFacturaLayout.tsx` ya no
  lo pinta (se retiró el bloque final y el import de `Text` no usado). Las únicas apariciones
  restantes de `pieLegal` son (a) el comentario §D4 que documenta la decisión y (b) el modelo de
  presupuesto y sus tests, donde `pieLegal` debe seguir existiendo. Un test asevera
  explícitamente `modelo.pieLegal === undefined` en factura.

- **Importes en `Decimal`, no `Float`**: OK / no aplica a este diff. El helper opera sobre el
  string decimal crudo del modelo mediante split por ".", sin `parseFloat` ni `Intl`, evitando
  error de coma flotante. No se introduce `number`/`Float` para importes.

- **TDD / cobertura de tests**: OK. Cada pieza de producción tiene test hermano:
  - `formato-importe.spec.ts` (7 casos: decimal simple, millares, frontera de 4 cifras, cero,
    millones, no-degradación de coma flotante).
  - `modelo-documento-factura-concepto-subtitulo.spec.ts` (concepto principal desde plantilla por
    tipo/idioma, subtítulo 40/60 con asterisco, fianza sin subtítulo, `pieLegal` undefined).
  - `bloque-concepto-factura-subtitulo.spec.ts` (subtítulo indentado; ausente cuando null).
  - `documento-factura-fiel-referencia.layout.spec.ts` ("Import factura" sin validez, sin pie
    legal, sin "Dades bancàries:", línea oro `COLOR_ACENTO`).
  - `modelo-documento-factura.spec.ts` y `modelo-documento-presupuesto-idioma.spec.ts`
    actualizados al nuevo contrato ("Base imp.").
  - Ejecución local de las 6 suites: 61 tests, todos en verde.

- **Convenciones de nombres y textos en español/catalán**: OK. Identificadores en
  camelCase/PascalCase, archivos en kebab-case, comentarios y textos de usuario en es/ca. Las
  etiquetas `baseImponible` pasan a "Base imp." en ambos idiomas, fiel a las referencias.

## Observaciones (no bloqueantes)

- `BloqueConceptoFactura` interpola el importe con dos estilos distintos entre el precio
  principal (`{formatearImporteDocumento(precioTotal)} €`) y los extras
  (`{`${formatearImporteDocumento(extra.subtotal)} €`}`). El resultado renderizado es idéntico;
  es solo una inconsistencia estilística menor de plantilla JSX. No requiere cambio.

- La línea oro divisoria del pie bancario de la factura reutiliza `estilos.condicionsAcento` con
  overrides inline (`marginTop`/`marginBottom`). Es coherente con el patrón de estilos inline ya
  presente en el layout; podría extraerse a un estilo con nombre propio en un futuro refactor,
  pero no es deuda que bloquee.

- Recordatorio de suite global: por la flakiness ESM conocida de react-pdf, la suite completa
  puede salir roja al ejecutar varias suites de render juntas; estas 6 suites verifican en verde
  de forma aislada (ejecución dirigida). Sin relación con este change.

## Veredicto: APTO

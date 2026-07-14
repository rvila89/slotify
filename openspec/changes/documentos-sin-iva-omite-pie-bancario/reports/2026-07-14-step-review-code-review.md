# Informe de code-review — documentos-sin-iva-omite-pie-bancario

- **Fecha**: 2026-07-14
- **Revisor**: code-reviewer (solo lectura)
- **Rama**: `feature/documentos-sin-iva-omite-pie-bancario`
- **Base**: `origin/master` (ya incluye 6.2)
- **Alcance**: (a) fix base — la variante SIN IVA del PDF de presupuesto omite el
  bloque de datos bancarios (IBAN/beneficiario/concepto); CON IVA lo conserva.
  (b) refinamiento del gate final — el `pieLegal` (validez legal) se CONSERVA en
  AMBAS variantes, desacoplado del bloque bancario.
- **Diff revisado**: `git diff origin/master...HEAD` + working tree sin commitear.
- **Nota**: este informe SUSTITUYE la revisión previa (que asumía la omisión del
  `pieLegal` en SIN IVA). El gate humano decidió conservarlo; re-revisado el diff
  COMPLETO (fix bancario + refinamiento).

## Ficheros
- `apps/api/src/documentos/presentation/modelo-documento-presupuesto.ts` (flag + comentario)
- `apps/api/src/documentos/presentation/componentes/DocumentoLayout.tsx` (composición condicional del pie bancario + pieLegal propio)
- `apps/api/src/documentos/presentation/componentes/PieBancario.tsx` (elimina prop/render `pieLegal`)
- `apps/api/src/documentos/presentation/estilos.ts` (nuevo estilo `pieLegal`)
- `apps/api/src/documentos/presentation/__tests__/documento-presupuesto-pie-bancario.plantilla.spec.ts` (nuevo, fix base)
- `apps/api/src/documentos/presentation/__tests__/documento-presupuesto-pie-bancario.layout.spec.ts` (nuevo, refinamiento)
- `apps/api/src/documentos/presentation/__tests__/documento-presupuesto-sin-iva.plantilla.spec.ts` (ajuste 6.2)
- `docs/er-diagram.md`

## Hallazgos por severidad

### Bloqueantes
- Ninguno.

### Alta
- Ninguna.

### Media
- Ninguna.

### Baja
- Ninguna. (La nota Baja de la revisión previa —cobertura estructural del layout
  no ejercitada por tests— queda CERRADA por el nuevo `…pie-bancario.layout.spec.ts`,
  que renderiza `DocumentoLayout` con un kit falso de captura y asere el texto
  compuesto: SIN IVA → pieLegal presente + IBAN/"Dades bancàries" ausentes;
  CON IVA → ambos presentes.)

## Verificación del checklist

- **Hexagonal**: OK. `modelo-documento-presupuesto.ts` sigue importando solo su VO
  de dominio `ConfiguracionDocumentoTenant`; `RegimenDocumento` local (no se importa
  de `presupuestos`); el `regimen` llega como dato. El nuevo `layout.spec.ts` importa
  solo `react` (createElement/isValidElement), los componentes/tipos de `documentos`
  y el VO de dominio — cero imports de `@nestjs/*`, `@prisma/*`, `infrastructure/`
  ni `presupuestos`.
- **Dominio de presentación puro**: OK. `construirModeloDocumentoPresupuesto` sigue
  pura y determinista; `mostrarPieBancario = datos.regimen === 'con_iva'`, mismo
  patrón declarativo que `mostrarIdentidadFiscal`/`mostrarDesgloseIva`. Sin
  condicionales dispersos.
- **Desacoplamiento del pieLegal (refinamiento)**: OK y coherente. `PieBancario.tsx`
  queda como componente "tonto" solo de datos bancarios (elimina prop `pieLegal` y su
  `<Text>`); `DocumentoLayout.tsx` pinta el `pieLegal` como elemento PROPIO SIEMPRE
  (`<View style={estilos.pieLegal}><Text style={estilos.linea}>{modelo.pieLegal}</Text></View>`),
  desacoplado del bloque bancario condicionado a `modelo.pieBancario.mostrar`. Grep
  confirma que ya NADIE pasa `pieLegal` a `<PieBancario>` (sin prop huérfano).
- **components/ solo .tsx**: OK. El nuevo estilo `pieLegal: { marginTop: 8 }` vive en
  `estilos.ts` (fuera de `componentes/`), no incrustado en el componente. Los cambios
  bajo `componentes/` son solo JSX en `.tsx`.
- **Arrow functions**: OK. `DocumentoLayout`, `PieBancario`,
  `construirModeloDocumentoPresupuesto` y todos los helpers del nuevo spec
  (`PasaHijos`, `kitDeCaptura`, `recogerTexto`, `textoRenderizado`, `configPiloto`,
  `datosConIva`, `datosSinIva`) son arrow functions. Sin `function` declarativo.
- **TDD (test primero)**: OK. Ambos specs nuevos documentan su fase RED por la razón
  correcta: el de plantilla (la propiedad `mostrar` no existía); el de layout (hoy el
  pieLegal vivía dentro de `<PieBancario>`, que en SIN IVA no se compone → la aserción
  "SIN IVA contiene el pieLegal" fallaba). El ajuste al spec de 6.2 no relaja
  aserciones.
- **No-regresión CON IVA**: OK. `plantilla` 2.2/2.4 fijan `mostrar === true` +
  iban/beneficiario/concepto; `layout` CON IVA asere IBAN + "Dades bancàries" +
  pieLegal; el spec 6.2 conserva base/IVA/total. QA re-render: CON IVA mantiene datos
  bancarios + frase legal.
- **Conservación del pieLegal en SIN IVA (objetivo del refinamiento)**: OK. `layout`
  SIN IVA asere pieLegal presente e IBAN/"Dades bancàries" ausentes; la validez sigue
  además visible vía `validesaTexto` en `BloqueTotales`. QA re-render (`fix-sin-iva.pdf`):
  `Validesa: 10 DIES` + frase legal, sin IBAN.
- **Tipos / TS strict**: OK. `mostrar: boolean` tipado; el kit de captura tipado como
  `KitReactPdf`; sin `any` (usa `unknown` + narrowing en `recogerTexto`).
- **Importes en Decimal**: OK. No se tocan importes (siguen Decimal-string).
- **Convenciones español**: OK. Nombres, comentarios y doc en español/catalán del dominio.
- **Contrato OpenAPI / SDK / cliente frontend**: N/A. Render puramente backend; sin
  superficie HTTP nueva ni edición del cliente generado.
- **Multi-tenancy / bloqueo de fecha / jobs / máquina de estados**: N/A.
- **Responsive (frontend)**: N/A. No hay cambios de UI web.
- **Documentación**: OK. `docs/er-diagram.md` describe la variante SIN IVA (omite pie
  bancario, conserva validez) coherente con el código.

## Veredicto

Diff completo (fix bancario + refinamiento del pieLegal) acotado, declarativo y sin
violaciones de guardrails duros. TDD RED→GREEN respetado en ambos incrementos;
no-regresión CON IVA y conservación del pieLegal en SIN IVA cubiertas por test de
layout + re-render. Sin hallazgos abiertos.

Veredicto: APTO

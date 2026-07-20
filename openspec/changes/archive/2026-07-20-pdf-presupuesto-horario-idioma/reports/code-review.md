# Code Review — pdf-presupuesto-horario-idioma

- Fecha: 2026-07-20
- Rama: `feature/presupuesto-pdf-horario-idioma` (base `master`)
- Alcance revisado: `git status` + working tree (trabajo sin commitear) del worktree
  `presupuesto-pdf-horario-idioma`. Solo lectura; no se aplican fixes.
- Fuentes: `.claude/skills/review-checklist`, `.claude/skills/architecture-guardrails`,
  `proposal.md`, `design.md`, `tasks.md`, `specs/**`, `reports/qa-report.md`.

## Resumen

Change de bajo/medio riesgo, bien acotado a la capa de plantilla de `documentos`
(+ helpers i18n de presentación), la carga de datos del presupuesto en
`presupuestos/infrastructure`, y la persistencia bilingüe de
`PlantillaDocumentoTenant`. La arquitectura hexagonal se respeta, las convenciones
(arrow functions, español, `componentes/` solo `.tsx`) se cumplen, y la cobertura de
tests de las tres mejoras es sólida (i18n, rango horario con cruce de medianoche,
fallback, título amarillo, numPersonas derivado, pie bancario es/ca). No hay
hallazgos bloqueantes.

## Verificación de guardrails

- **Hexagonal — OK.** `documentos` NO importa de `presupuestos` (grep vacío). El
  acoplamiento va en la dirección permitida: `presupuestos/infrastructure`
  (`cargar-datos-documento-presupuesto.prisma.adapter.ts`) importa el tipo
  `IdiomaDocumento` de `documentos`. `documentos/domain` y `presupuestos/domain` no
  importan `@nestjs/*`, `@prisma/*` ni `infrastructure/`. `derivar-num-personas.ts`
  vive en `presupuestos/domain`, es puro y sin imports de framework/infra.
- **Bloqueo de fecha / máquina de estados / jobs — N/A.** El change no los toca
  (confirmado en proposal "NO reimplementa").
- **Multi-tenancy / RLS — OK.** Ambos adaptadores mantienen `fijarTenant(tx, tenantId)`
  dentro de `$transaction` y filtran por `tenantId`; degradación a `null` en
  cross-tenant/no encontrado intacta. La migración NO recrea la policy RLS (las
  columnas nuevas la heredan), según diseño.
- **Importes Decimal — OK.** El adaptador sigue usando `Prisma.Decimal.toFixed(2)`;
  no se introduce `Float`/`number` para importes.
- **Contrato OpenAPI / SDK — OK.** Sin superficie de API nueva; no se toca
  `api-spec.yml` ni el cliente generado (PDF interno post-commit).
- **Arrow functions — OK.** Los cuatro ficheros nuevos (`meses.ts`, `horario.ts`,
  `etiquetas-por-idioma.ts`, `derivar-num-personas.ts`) usan solo arrow functions.
  El único `function` (`seed.ts main()`) es preexistente y ajeno al diff.
- **`componentes/` solo `.tsx` — OK.** Los helpers i18n (`meses.ts`, `horario.ts`,
  `etiquetas-por-idioma.ts`) están en `presentation/`, no bajo `componentes/`. La
  carpeta `componentes/` no contiene ficheros no-`.tsx`.
- **i18n determinista — OK.** Sin `Intl` (mapa estático `MESES`); `calcularHoraFin`
  usa `mod 1440` para el cruce de medianoche; `formatearFechaLarga` usa `getUTC*`
  para no desplazar el día por zona horaria.
- **Regla "nunca lloguer" — OK.** Ningún texto es/ca del seed contiene "lloguer";
  tests lo verifican en ambos idiomas (builder, seed, integración). La única
  aparición real de "lloguer" está en `comunicaciones/.../catalogo-plantillas.ts`,
  fichero preexistente y fuera del diff.
- **Sin regresión en la factura — OK.** `DocumentoFacturaLayout` fija idioma `ca`
  (`etiquetasDocumento('ca')`) y llama a `BloqueTitulo` SIN `colorTitulo`, por lo
  que el título cae al default `colorPrimario` (turquesa). Test de no regresión
  presente.
- **Migración — OK con nota de PROD.** `20260720120000_documento_textos_bilingues`:
  ADD `_ca`/`_es` nullable → backfill (`_ca = <col actual>`, `_es = _ca` placeholder)
  → `condiciones` a estructura bilingüe con `jsonb_build_object`/`jsonb_agg`
  (protegido por `WHERE ? 'titulo'` y `COALESCE(..., '[]')`) → NOT NULL → DROP de las
  columnas monolingües. Coherente con `schema.prisma`. QA confirma `migrate deploy`
  contra Postgres real.
- **Line count — OK.** Todos los ficheros tocados <300 (mayor: builder 231).

## Hallazgos

### Bloqueantes
- Ninguno.

### Mayores
- Ninguno.

### Menores
- **[deuda menor] `duracionTexto` es catalán hardcodeado y código muerto.**
  `modelo-documento-presupuesto.ts:204` sigue produciendo `` `(${datos.duracionHoras} hores)` ``
  (siempre "hores", ignora el idioma). Ya NO se renderiza: `TablaConcepto` pinta
  `horarioTexto` (que sí es bilingüe y con fallback). El campo permanece en el
  modelo y en dos tests. No afecta al PDF, pero es un campo bilingüe-incorrecto que
  puede reintroducir catalán si alguien vuelve a consumirlo. Recomendación:
  eliminarlo del modelo/tests o, si se conserva, traducirlo con `palabraHoras(idioma)`.
- **[robustez menor] `aCondiciones` confía en la forma del JSON sin validar en
  profundidad.** `configuracion-documento.prisma.adapter.ts:82-89` y
  `cargar-datos-documento-factura.prisma.adapter.ts:60-68` castean
  `bruto.secciones` a `SeccionCondiciones[]` comprobando solo `Array.isArray`, sin
  verificar que cada sección tenga `{titulo:{ca,es},cuerpo:{ca,es}}`. Con datos
  sembrados por el propio seed el riesgo es nulo; queda como nota si en el futuro se
  edita `condiciones` fuera del seed. Recomendación: aceptable para este change; no
  bloquea.

### Nits
- **[nit] `IdiomaDocumento` vive en `documentos/presentation/meses.ts`.** El tipo es
  un concepto de idioma del documento consumido también por
  `presupuestos/infrastructure`. Es un tipo de vista y la dirección de import es
  correcta (presupuestos→documentos), pero conceptualmente encaja mejor en el
  dominio de `documentos` que en un helper de "meses". No bloquea; solo ubicación.
- **[nit] `duracionHoras = 0` con `horario` informado** produciría
  "De HH:MM a HH:MM (0 horas)" (adapter usa `?? 0` cuando la duración es null). No es
  un crash y el flujo real siempre trae una `DuracionHoras` válida; solo señalar.
- **[nit] `tasks.md` con 24 casillas sin marcar.** Corresponden a los pasos de
  gate/QA/docs/review/archive (steps 1, 2.1, 5-12), no a código. La evidencia real de
  QA (migración, seed, tests, 4 PDFs, lint/typecheck EXIT=0) está en
  `reports/qa-report.md`. Higiene de tracking, no defecto de código.

## Cobertura de tests (verificada por títulos + QA report)

- Fecha por idioma (setembre/septiembre, día sin padding, UTC): `i18n-documento.spec.ts`.
- Rango horario + cruce de medianoche (`mod 1440`) + fallback null es/ca: idem.
- Etiquetas fijas es/ca + default a castellano + 3 frases del pie bancario es/ca
  (corregidas en QA): idem (`debe_traducir_las_frases_del_pie_bancario_*`).
- Textos libres por idioma en el modelo: `modelo-documento-presupuesto-idioma.spec.ts`.
- Título amarillo `#ffd978` en presupuesto + turquesa en factura (no regresión):
  `documento-presupuesto-titulo-amarillo.layout.spec.ts`.
- numPersonas derivado (`numInvitadosFinal ?? adultos+ninos`, nulls→0):
  `derivar-num-personas.spec.ts`.
- QA end-to-end: 4 PDFs reales (ca/es/sin-horario/cruce-medianoche) con
  `pdftotext`; `pnpm lint` y `pnpm typecheck` EXIT=0. Los 9 fallos del run global son
  la flakiness ESM conocida de `@react-pdf/renderer` (memoria del proyecto), verde en
  aislamiento.

## Nota para el despliegue (ya recogida por QA, no bloquea el merge)

En PROD, tras aplicar la migración el `_es` de la fila existente queda con el texto
CATALÁN (placeholder del backfill) hasta que se re-ejecute el seed del piloto. El
plan de deploy debe re-sembrar la config del piloto (o poblar `_es`) para que el PDF
en castellano no salga en catalán. Riesgo operacional conocido y documentado.

## Veredicto

Veredicto: APTO

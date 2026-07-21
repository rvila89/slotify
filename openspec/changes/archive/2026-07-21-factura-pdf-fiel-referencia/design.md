# Design — factura-pdf-fiel-referencia

## Contexto

La capa de plantilla de `documentos` es **compartida** entre presupuesto y
factura (requirement vivo "Capa de plantilla de documentos react-pdf
reutilizable"). Los componentes `BloqueTotales` y `PieBancario` los usan **ambos**
layouts (`DocumentoLayout` del presupuesto y `DocumentoFacturaLayout` de la
factura). Por tanto, cualquier cambio en esos componentes debe ser
**retrocompatible con el presupuesto**: el objetivo del change es la factura, sin
regresión visual del presupuesto.

`construirModeloDocumentoFactura` es lógica **pura** y es donde recaen las
aserciones de contenido (TDD). El layout `.tsx` solo pinta strings resueltos.

## Decisiones

### D1 — Concepto principal desde `plantillaConceptoFiscal`, subtítulo por tipo

El modelo de vista de factura resuelve **dos** campos de concepto:

- `concepto` (principal, negrita): se resuelve interpolando
  `config.textos.plantillaConceptoFiscal.{idioma}` con
  `config.identidadFiscal.nombreComercial` en `{nombreComercial}`. Se reutiliza el
  mismo helper de interpolación que el presupuesto (regla dura: expresa "espai",
  NUNCA "lloguer").
- `conceptoSubtitulo: string | null` (indentado, no negrita): el texto que **hoy**
  ocupa el concepto principal, movido a subtítulo:
  - `senal` → "40% de l'import total anticipat del pressupost núm. {n}" (ca) /
    "40% del importe total anticipado del presupuesto núm. {n}" (es), con el
    prefijo asterisco de referencia (fiel a la ref: "*40%…").
  - `liquidacion` → "Saldo del 60% de l'import del pressupost núm. {n}" (ca) /
    "Saldo del 60% del importe del presupuesto núm. {n}" (es).
  - `fianza` → **`null`** (la fianza no cambia; sin subtítulo).
  - Cuando `numeroPresupuesto` es `null` en señal/liquidación, se **omite** el
    sufijo " núm. {n}".

La lógica de tipos/idioma que hoy vive en `resolverConcepto` se **reubica** en un
resolvedor de subtítulo (`resolverConceptoSubtitulo`), y el concepto principal pasa
a la interpolación de la plantilla del tenant. Ambas son arrow functions puras.

Rationale: el hallazgo del gap es que el texto correcto ya está en la config del
tenant pero el modelo no lo consumía. Mover el 40/60 a subtítulo replica la
jerarquía visual de la referencia (título fiscal grande + referencia fina debajo).

### D2 — `BloqueConceptoFactura` con subtítulo indentado

`BloqueConceptoFactura` recibe un prop opcional `conceptoSubtitulo?: string | null`.
Cuando no es `null`/vacío, pinta una línea **indentada, no negrita**, bajo el
concepto principal y antes de los extras. Cuando es `null`, el bloque se comporta
exactamente como hoy (fianza y compatibilidad). El estilo del subtítulo reutiliza
un estilo indentado ya existente en `estilos.ts` (p. ej. el patrón de las líneas
indentadas del concepto del presupuesto) o uno nuevo análogo; **no** se hardcodea
contenido de negocio.

### D3 — `BloqueTotales` parametrizado en la columna izquierda

Hoy `BloqueTotales` pinta fijo `etiquetas.validesa` + `validesaTexto` en la columna
izquierda. Se parametriza la **columna izquierda** vía props explícitos:

- `etiquetaIzquierda: string` (presupuesto → `etiquetas.validesa`; factura →
  `etiquetas.importFactura`).
- `valorIzquierda: string` (presupuesto → `validesaTexto`; factura → `""` cadena
  vacía: fiel a la referencia, "Import factura" es solo etiqueta, sin valor debajo).

Se elimina el prop específico `validesaTexto` de la firma o se conserva como caso
particular; la decisión concreta se toma en implementación priorizando **no romper
el presupuesto** (los tests del presupuesto deben seguir verdes). La factura ya
**no** pinta una fila de validez: pinta "Import factura" con el importe.

Rationale: mantener un único componente compartido evita duplicar la franja de
totales; la parametrización por props resuelve la divergencia sin `if (esFactura)`
dentro del componente.

### D4 — Factura sin pie legal

`DocumentoFacturaLayout` deja de renderizar el bloque
`<Text>{modelo.pieLegal}</Text>`. El campo `pieLegal` del modelo de factura se
**elimina** (ya no se consume) o se deja de poblar; se prioriza eliminarlo para no
dejar campo muerto. El pie legal de validez pertenece al presupuesto, no a la
factura. La fianza (REBUT) tampoco pinta pie legal (ya comparte layout).

### D5 — `PieBancario` fiel a la referencia (sin beneficiario, con línea oro)

Se parametriza `PieBancario`:

- `mostrarBeneficiario: boolean` — default `true` (presupuesto conserva "Dades
  bancàries: {beneficiario}"); la factura lo pasa `false` (se omite la línea).
- `mostrarLineaOro: boolean` (o equivalente de estilo) — la factura pinta una
  **línea oro divisoria** (`COLOR_ACENTO = #ffd978`, constante de presentación de
  `estilos.ts`) sobre el pie; el presupuesto conserva su comportamiento.

El pie bancario de la factura sigue mostrándose **solo en la variante CON IVA**
(flag `pieBancario.mostrar`), como hoy. La línea oro y la omisión del beneficiario
son de **presentación**; los datos siguen viniendo de `config.banca` / el modelo.

### D6 — Idioma

El idioma ya viaja en `ModeloDocumentoFactura.idioma` y el layout ya resuelve
`etiquetasDocumento(idioma)`. Los nuevos textos (subtítulo 40/60) son bilingües
ca/es; el default sigue siendo `ca` en la factura (comportamiento actual del
layout), coherente con el resto de la factura.

### D7 — Formato de importes con coma decimal (todos los documentos) + etiqueta "Base imp."

Hallazgo de QA de fidelidad: los importes se pintan hoy como el string decimal crudo
con **punto** ("216.00 €"), mientras la referencia usa **coma** ("216,00 €"). Es una
convención pre-existente de TODA la capa de documentos (factura y presupuesto). Se
introduce un helper PURO de presentación `formatearImporteDocumento(decimalString)`
que convierte "178.51" → "178,51" y agrupa millares con punto ("1.200,00"), aplicado
de forma consistente allí donde hoy se interpola `{valor} €` (concepto, extras, franja
de totales, condicions/reparto). El helper es determinista y sin dependencia de locale
del entorno (formatea a partir del string decimal, sin `parseFloat`, para no arrastrar
error de coma flotante en importes monetarios). Aplica a factura Y presupuesto (decisión
del usuario: incluirlo ahora para consistencia).

Además, la etiqueta de la franja de totales `baseImponible` se **abrevia** a "Base imp."
(ca y es), fiel a ambas referencias (`F2026029` y `P2026023` usan "Base imp."). Cambio
en `etiquetas-por-idioma.ts`; afecta a la franja compartida de ambos documentos.

## Cuestiones abiertas (para el gate humano)

- **A.** Prefijo del subtítulo: la referencia usa "*40%…". Confirmar que el
  asterisco va **en el subtítulo** (no en el pie), tal como propone D1.
- **B.** Texto exacto de liquidación en la referencia (¿"Saldo del 60%…" tal cual?).
  Si la referencia es de **señal**, el texto de liquidación se extrapola con el
  mismo patrón; se validará contra la referencia real de liquidación si el usuario
  la aporta.
- **C.** Posición exacta de la línea oro respecto al IBAN y a la frase de
  formalización (encima del bloque de pie según el gap). Se ajusta píxel a píxel en
  QA comparando con `F2026029 Sergio Carrasco.pdf`.

## Alternativas descartadas

- **Componentes de factura separados** (fork de `BloqueTotales`/`PieBancario` solo
  para factura): descartado por duplicación; la parametrización por props mantiene
  un único componente compartido y respeta el requirement vivo de reutilización.
- **Hardcodear el concepto en el layout**: prohibido por el guardarraíl "la
  plantilla NO puede contener datos de negocio hardcodeados"; el concepto viene de
  la config del tenant.

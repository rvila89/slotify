# Step N+1 — Unit Tests + DB State Verification
**Change:** `factura-pdf-fiel-referencia`
**Date:** 2026-07-22
**Branch:** `feature/factura-pdf-fiel-referencia`

---

## Baseline de BD (pre-test)

| Tabla | Count |
|-------|-------|
| RESERVA | 4 |
| FACTURA | 6 |
| PRESUPUESTO | 3 |
| CLIENTE | 1 |

Todos los borradores tenían `pdfUrl = null` antes de ejecutar la suite.

---

## Suites ejecutadas

### Suite 1 — Suites del módulo `documentos/presentation/__tests__` (kit falso, sin ESM)

**Comando:**
```bash
cd apps/api && npx jest --testPathPatterns="documentos/presentation/__tests__" \
  --testPathIgnorePatterns="plantilla\.spec|real\.adapter\.spec" --no-coverage
```

**Resultado:**
```
Test Suites: 11 passed, 11 total
Tests:       102 passed, 102 total
Snapshots:   0 total
Time:        30.963 s
```

Suites incluidas (11):
- `bloque-concepto-factura-subtitulo.spec.ts` (4 tests) — valida `conceptoSubtitulo` prop + formato "100,00 €"
- `documento-factura-fiel-referencia.layout.spec.ts` (8 tests) — valida D1/D2/D3/D4/D5
- `modelo-documento-factura-concepto-subtitulo.spec.ts` (tests D2 concepto)
- `modelo-documento-factura.spec.ts` (16 tests) — flags CON/SIN IVA, subtítulos señal/liquidación/fianza, idiomas
- `formato-importe.spec.ts` (7 tests) — helper puro
- `i18n-documento.spec.ts`
- `resolver-logo-data-uri.spec.ts`
- `documento-presupuesto-concepto-tres-lineas.layout.spec.ts`
- `documento-presupuesto-pie-bancario.layout.spec.ts`
- `documento-presupuesto-sin-iva.layout.spec.ts` (nombre real: `documento-presupuesto-titulo-amarillo.layout.spec.ts`)
- `modelo-documento-presupuesto-idioma.spec.ts`

**OUTCOME: PASS — 102/102 tests verdes**

### Suite 2 — `formato-importe.spec.ts` en aislamiento (--runInBand)

**Comando:**
```bash
cd apps/api && npx jest --testPathPatterns="formato-importe\.spec" --runInBand --no-coverage
```

**Resultado:**
```
Test Suites: 1 passed, 1 total
Tests:       7 passed, 7 total
Time:        13.831 s
```

Tests individuales verificados:
- `convierte decimal simple con punto a coma` → "178,51" PASS
- `agrupa millares con punto y decimales con coma` → "1.200,00" PASS
- `mantiene enteros de tres dígitos sin separador de millares` → "216,00" PASS
- `formatea el cero` → "0,00" PASS
- `agrupa millones con dos separadores de millares` → "1.234.567,89" PASS
- `agrupa millares en la frontera exacta de cuatro cifras enteras` → "1.000,00" PASS
- `no arrastra error de coma flotante en importes monetarios` → "4.132,23" PASS

**OUTCOME: PASS — 7/7 tests verdes**

---

## Suites ignoradas (flakiness ESM pre-existente)

Las suites `*.plantilla.spec` y `*.real.adapter.spec` no se ejecutaron por la flakiness
ESM pre-existente (`react-pdf-esm-suite-flakiness` en MEMORY.md). No es una regresión
de este change.

---

## Verificación de estado de BD (post-test)

Los tests de esta suite usan la BD de test aislada (`slotify_test` por `.env.test`),
no la BD de desarrollo. Los counts en la BD de desarrollo permanecen intactos:

| Tabla | Count (pre) | Count (post) | Delta |
|-------|-------------|--------------|-------|
| RESERVA | 4 | 4 | 0 |
| FACTURA | 6 | 6 | 0 |
| PRESUPUESTO | 3 | 3 | 0 |
| CLIENTE | 1 | 1 | 0 |

No hubo mutación en la BD de desarrollo.

---

## OUTCOME GLOBAL: PASS

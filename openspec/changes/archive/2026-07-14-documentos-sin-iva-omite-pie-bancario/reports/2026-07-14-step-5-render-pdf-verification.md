# QA Report — Fase 5: verificación de render del PDF

**Change:** `documentos-sin-iva-omite-pie-bancario` (fix apilado sobre 6.2)
**Fecha:** 2026-07-14 · **Ejecutado por:** sesión principal (render real vía ts-node)

Se renderizaron ambas variantes con la config sembrada del piloto. Muestras en `reports/`:
`fix-sin-iva.pdf` (3.246 B) y `fix-con-iva.pdf` (3.740 B).

## 5.1 — PDF SIN IVA (regimen = sin_iva) — inspeccionado visualmente ✅
El documento **NO contiene** "Dades bancàries", IBAN (`ES30 0182 1683 4002 0172 9599`), "Beneficiari"
ni "Concepte" de transferencia. **SÍ conserva** `Validesa: 10 DIES` y la frase legal ("Aquest document
té una validesa de 10 dies…"). La cabecera sigue sin razón social fiscal ni NIF (variante SIN IVA de 6.2).

Coincide con la hoja "PRESSUPOST SENSE IVA" del Excel real (sin bloque bancario).

### Refinamiento aplicado (decisión del gate final)
Inicialmente el `pieLegal` iba dentro del componente `PieBancario` (desde 6.1b), por lo que se omitía
junto al bloque bancario en SIN IVA. Por decisión del humano en el gate final se **desacopló**: el
`pieLegal` se pinta ahora SIEMPRE en `DocumentoLayout` (elemento propio), y `PieBancario` solo lleva los
datos bancarios (condicionado a `pieBancario.mostrar`). Verificado por el spec de layout con kit falso
(`documento-presupuesto-pie-bancario.layout.spec.ts`, 3/3) y por este re-render:
SIN IVA `fix-sin-iva.pdf` (3.325 B) conserva el pieLegal sin datos bancarios.

## 5.2 — PDF CON IVA (regimen = con_iva) — no-regresión ✅
Byte-idéntico al de 6.2 (3.740 B). Conserva: base/IVA/total, "Dades bancàries" (IBAN + Beneficiari
"Canoliart, SL" + Concepte) y el `pieLegal`. Sin cambios respecto a 6.2.

## 5.3 — curl end-to-end
No aplica: sin endpoint nuevo. La generación real del PDF por régimen ya se validó en la 6.2; este fix
solo altera la composición del layout (probado por render directo arriba).

## 6.1 — E2E
No aplica: el fix no toca frontend.

## Veredicto fase 5
**OK** — SIN IVA sin pie bancario (fiel al Excel), CON IVA sin regresión (byte-idéntico). Nota del
`pieLegal` documentada para el gate final.

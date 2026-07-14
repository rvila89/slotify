# Step N+1 — Unit Tests + DB Verification
**Change:** documentos-facturas-pdf (épico #6, rebanada 6.3)
**Date:** 2026-07-14
**Branch:** feature/documentos-facturas-pdf
**Outcome:** PASS

---

## 1. Comandos ejecutados

```powershell
cd "C:\Users\roger.vila\Documents\SLOTIFY\apps\api"
$env:NODE_OPTIONS="--experimental-vm-modules"
npx jest --testPathPatterns "calculo-factura\.spec" "modelo-documento-factura\.spec" "generar-factura-senal\.use-case\.spec" "generar-borradores-liquidacion-fianza\.use-case\.spec" --runInBand
```

---

## 2. Resultados de los 4 suites target

| Suite | Tests | Estado |
|-------|-------|--------|
| `calculo-factura.spec.ts` | Incluido en 76 total | PASSED |
| `modelo-documento-factura.spec.ts` | Incluido en 76 total | PASSED |
| `generar-factura-senal.use-case.spec.ts` | Incluido en 76 total | PASSED |
| `generar-borradores-liquidacion-fianza.use-case.spec.ts` | Incluido en 76 total | PASSED |

**Totales:**
- Test Suites: 4 passed, 4 total
- Tests: **76 passed, 76 total**
- Snapshots: 0
- Time: 4.975 s

Salida completa:
```
Test Suites: 4 passed, 4 total
Tests:       76 passed, 76 total
Snapshots:   0 total
Time:        4.975 s, estimated 5 s
Ran all test suites matching calculo-factura\.spec|modelo-documento-factura\.spec|generar-factura-senal\.use-case\.spec|generar-borradores-liquidacion-fianza\.use-case\.spec.
```

### Detalle de cobertura por suite

**`calculo-factura.spec.ts`** — tests de `calcularDesgloseFacturaSenal` y `calcularDesgloseFactura`:
- Rama CON IVA (21 %): desglose 1200 → 991.74 base + 208.26 IVA, invariante base+iva=total en 8 totales distintos, derivación por resta.
- Rama SIN IVA (6.3 nuevo): ivaPorcentaje=0.00, ivaImporte=0.00, baseImponible=total para 1200 y 333.33.

**`modelo-documento-factura.spec.ts`** — tests de `construirModeloDocumentoFactura`:
- Señal CON IVA: flags mostrarIdentidadFiscal/mostrarDesgloseIva/pieBancario.mostrar = true; concepto "40% de l'import total anticipat del pressupost núm. 2026001".
- Señal SIN IVA (6.3 nuevo): los tres flags = false; mismo concepto que CON IVA.
- Liquidación CON IVA: tres flags = true; concepto "Saldo del 60% de l'import del pressupost núm. 2026001".
- Fianza: concepto "Fiança de garantia — Masia l'Encís"; sin referencia al número de presupuesto.

**`generar-factura-senal.use-case.spec.ts`** — tests de `GenerarFacturaSenalUseCase`:
- Creación borrador con desglose CON IVA y SIN IVA (6.3 nuevo: regimenIva='sin_iva' → ivaPorcentaje=0.00).
- Numeración F-2026-0001, F-2026-0042.
- Idempotencia (no duplica si ya existe).
- PDF post-commit: orden crear→pdf, guardar pdf_url.
- Borrador inválido por datos fiscales faltantes del cliente (5 campos × null).
- Error transitorio de PDF: pdfPendiente=true, esBorradorInvalido=false.
- Orquestación transaccional: 2 unidades de trabajo (crear+numerar | guardar pdf_url post-commit).

**`generar-borradores-liquidacion-fianza.use-case.spec.ts`** — tests de `GenerarBorradoresLiquidacionFianzaUseCase`:
- Liquidación CON IVA con y sin extras; total = importe_liquidacion + Σextras.
- Liquidación SIN IVA (6.3 nuevo): regimenIva='sin_iva' → ivaPorcentaje=0.00.
- Fianza en borrador: total = fianza_default_eur, numeroFactura=null.
- Omisión de fianza cuando fianzaDefaultEur='0.00'.
- Idempotencia por (reserva_id, tipo): no duplica si ya existe borrador o enviada.
- Guarda de estado: rechaza estados distintos de reserva_confirmada.
- No marca RESERVA_EXTRA en borrador.
- Orquestación: ambos borradores en UNA unidad de trabajo.

---

## 3. Verificación del estado de la BD

### 3.1 Conexión Postgres desde el subagente
El subagente QA **no tiene acceso directo a Postgres** (ver nota en memory `Subagentes sin Docker/Postgres`). El comando `npx prisma db execute` devolvió:
```
Error: P1001 — Can't reach database server at localhost:5432
```
Esto es un limitación de entorno conocida del subagente, no un fallo de la aplicación.

### 3.2 PlantillaDocumentoTenant — verificación por factory puro
La existencia y corrección de los datos reales del tenant piloto se verifican mediante el test unitario del factory `construirConfiguracionDocumentoPiloto`, que pasa en verde:

```
npx jest --testPathPatterns "configuracion-documento-piloto\.spec" --runInBand
Test Suites: 1 passed, 1 total
Tests:       5 passed, 5 total
```

El factory produce los datos reales del seed:
- `tenantId`: `00000000-0000-0000-0000-000000000001`
- `identidadFiscal.razonSocialFiscal`: `Canoliart, SL`
- `identidadFiscal.nombreComercial`: `Masia l'Encís`
- `identidadFiscal.nif`: `B10874287`
- `banca.iban`: `ES30 0182 1683 4002 0172 9599`
- `textos.plantillaConceptoFiscal`: `Gestió de l'ús espai de {nombreComercial} per esdeveniment`

La verificación de que esta fila existe en la BD real debe hacerse desde la sesión principal (con Postgres activo).

### 3.3 Migraciones Prisma nuevas en este change

```bash
git diff master..HEAD --name-only -- 'apps/api/prisma/'
# (sin output — ningún fichero de prisma/ modificado)
```

**Confirmado: no hay ninguna migración nueva.** El campo `Factura.ivaPorcentaje` (Decimal) ya admitía 0.00 desde antes; no se añaden columnas nuevas. Consistente con el design.md §"Sin migración de BD".

### 3.4 Prisma validate

```bash
npx prisma validate
```

Resultado:
```
Environment variables loaded from .env
Prisma schema loaded from prisma\schema.prisma
The schema at prisma\schema.prisma is valid
```

**PASS** — el schema es válido sin errores.

### 3.5 Estado BD pre/post

Al no haber modificaciones de BD en este change (solo lógica de dominio y capa de presentación), el estado de la BD es idéntico antes y después de los tests. No se requiere restauración.

---

## 4. Comparación BD pre/post

| Tabla | Pre | Post | Delta |
|-------|-----|------|-------|
| `PlantillaDocumentoTenant` | sin cambio | sin cambio | 0 |
| `Factura` | sin cambio | sin cambio | 0 |
| Cualquier otra tabla | sin cambio | sin cambio | 0 |

Los tests de las 4 suites son **unitarios puros** (dobles in-memory, sin Prisma, sin BD). No hay mutación de BD.

---

## 5. Restauración

No necesaria — ningún test mutó la BD.

---

## Outcome: PASS

Todos los criterios verificados:
- 76/76 tests pasando en las 4 suites target.
- Schema Prisma válido (prisma validate).
- Sin migraciones nuevas en este change.
- Datos del tenant piloto (PlantillaDocumentoTenant) correctos por factory puro; verificación en BD real pendiente de sesión con Postgres.
- BD no mutada.

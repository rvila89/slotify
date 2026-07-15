# QA report — documentos-rediseno-pdf-logo-storage (6.5)

Ejecutado desde la **sesión principal** (Postgres + render real disponibles; los
subagentes QA no tienen BD). Fecha: 2026-07-15.

## Veredicto QA: ✅ VERDE

## 1. Unit / adaptador / seed factory (sin BD)

- Suite global `jest --runInBand` (2002 tests): **1991 passed, 11 failed** en
  **5 suites de render react-pdf**.
- Los 11 fallos son la **flakiness ESM conocida y PRE-EXISTENTE** (render suites
  juntas → `TypeError: Cannot read properties of undefined (reading 'identifier')`),
  documentada como deuda del proyecto — **no es regresión de 6.5**.
- **Descartada regresión**: las 6 suites que renderizan react-pdf pasan **en
  aislamiento** (jest directo con `NODE_OPTIONS=--experimental-vm-modules`):
  - `documento-presupuesto.plantilla` → 16/16
  - `documento-presupuesto-sin-iva.plantilla` → 11/11
  - `documento-presupuesto-pie-bancario.plantilla` → 8/8
  - `documento-condiciones.plantilla` → 8/8
  - `pdf-condiciones.real.adapter` → 4/4
  - `pdf-presupuesto.real.adapter` → 4/4
- Las suites no-render de 6.5 (adaptador durable local + `obtener`, contrato del
  puerto, seed piloto con `#5edada` y concepto alineado, `resolver-logo-data-uri`)
  quedan dentro de los 1991 verdes.
- `pnpm lint`, `pnpm typecheck`, `pnpm run arch` → verdes (verificado por el
  backend-developer).

## 2. Seed contra BD real + estado (Postgres)

`pnpm db:seed` → OK (`tenant Masia l'Encís: 12 temporadas, 45 tarifas, 2 extras`).

Fila `PlantillaDocumentoTenant` (tenant piloto):
- `logoUrl` = `http://localhost:3000/almacen/logos/00000000-0000-0000-0000-000000000001.jpg` ✅
- `colorPrimario` = `#5edada` ✅
- `plantillaConceptoFiscal` = `Gestió ús espai de {nombreComercial} per esdeveniment` ✅

Logo escrito a disco (storage durable): `.almacen/logos/00000000-0000-0000-0000-000000000001.jpg` ✅

## 3. Ruta estática `GET /almacen/*` (API en :3000)

- `curl -I /almacen/logos/{tenantId}.jpg` → **HTTP 200**, `Content-Type: image/jpeg`,
  `Content-Length: 17293` (= tamaño del asset) ✅
- `curl /almacen/logos/no-existe.jpg` → **HTTP 404** (`fallthrough:false`) ✅
- Servida **fuera** del prefijo global `/api` (serve-static) ✅

## 4. Fidelidad visual vs referencia `P2026023 Laura Mas.pdf`

Muestras en `reports/muestra-presupuesto-{con,sin}-iva-rediseno.{pdf,png}`.

- **CON IVA**: logo arriba-izq, identidad fiscal arriba-der, "Dades client" +
  título turquesa "PRESSUPOST", tabla `Pressupost|Data` con borde, barra turquesa
  `CONCEPTE|PREU`, concepto en negrita + líneas indentadas, cuerpo con borde,
  franja `Validesa|Base imp.|% Iva|Total`, mini-tabla Condicions 40/60/fiança con
  acento amarillo `#ffd978`, pie centrado + IBAN. **Fidelidad alta.** ✅
- **SIN IVA** (deriva por flags): cabecera sin razón social/NIF, PREU = base,
  franja de totales solo `Validesa|Total`, sin pie bancario, condicions + acento.
  **Correcto.** ✅

### Matices menores detectados (para decisión de negocio, NO bloquean QA)
En CON IVA, el pie incluye dos elementos que la referencia `P2026023` no muestra:
1. Línea en negrita **"Dades bancàries: Canoliart, SL"** (mantenida por el walker
   `documento-presupuesto-pie-bancario.layout.spec.ts`).
2. El **párrafo `pieLegal`** al final (se pinta siempre desde 6.2, desacoplado del
   pie bancario).
Ambos son contenido heredado de rebanadas previas, no un defecto del rediseño.

## 5. Pendiente de acción de la sesión (no QA)

- `apps/api/prisma/seed-assets/masia-logo.jpg` está **untracked** → debe añadirse
  al commit del change (el seed depende de él en checkout limpio).

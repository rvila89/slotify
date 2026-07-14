# QA step-N+1 — Unit tests + verificación de BD

**Change**: `documentos-condiciones-particulares-pdf` (épico #6, rebanada 6.4a)
**Fecha**: 2026-07-14
**Ejecutado desde**: sesión principal (con Postgres `slotify_dev` en Docker `slotify-postgres`).

## 1. Baseline de BD (antes de aplicar la migración)

`plantilla_documento_tenant` — 1 fila (tenant piloto `00000000-0000-0000-0000-000000000001`):
- `razon_social_fiscal = "Canoliart, SL"`, `nombre_comercial = "Masia l'Encís"`.
- **Columna `condiciones`: NO existía** (`to_jsonb(row) ? 'condiciones'` → `false`).

## 2. Migración + reseed

- `prisma migrate deploy` → aplicada `20260714130000_documento_condiciones_particulares`
  (`ADD COLUMN "condiciones" JSONB NOT NULL DEFAULT '{}'`, no destructiva — estrategia D2).
- `prisma db seed` → reseed del piloto.

### ⚠️ Defecto encontrado y corregido en QA
El primer reseed dejó `condiciones = '{}'` (vacío). Causa: el factory puro
`construirConfiguracionDocumentoPiloto` **sí** incluía `condiciones` (test unit 2.2 en verde),
pero el bloque `create` de `prisma/seed.ts` enumera campos explícitamente y **no** se había
actualizado para persistir el nuevo campo. Gap "factory testeado ≠ persistencia real"
(cf. lección us049-backend-untested-real-db). **Fix aplicado** en `prisma/seed.ts`:
- `import { ..., Prisma, ... }` de `@prisma/client`.
- `condiciones: configDocumento.condiciones as unknown as Prisma.InputJsonValue` en el `create`.

## 3. Verificación de BD (tras el fix)

`plantilla_documento_tenant` (piloto):
- Columna `condiciones` presente.
- `condiciones->>'titulo' = "Condicions Particulars"`.
- `jsonb_array_length(condiciones->'secciones') = 14`.
- Títulos en orden: Reserva i pagament · Fiança · Política de cancel·lació · Responsabilitat i
  dades personals · Visites · Neteja · Gestió de residus · Horaris · Excés d'horari · Normes de
  convivència i ús responsable · Capacitat · Piscina · Música i respecte veïnal · Parking.

**Estado final de BD**: migración aplicada + `condiciones` poblado. Es el entregable del change
(no una mutación de test), por lo que NO se restaura al baseline.

## 4. Tests unitarios (`NODE_OPTIONS=--experimental-vm-modules`)

### Suites propias de 6.4a
- **No-render (6 suites juntas)**: `configuracion-documento-condiciones`,
  `configuracion-documento-piloto-condiciones`, `configuracion-documento-prisma-condiciones`,
  `pdf-condiciones.real`, `pdf-condiciones.fake`, `disparar-e2.adapter` → **22/22 PASS**.
- **Render condiciones (en aislamiento)**: `documento-condiciones.plantilla` → **8/8 PASS**.

### Suite completa (`jest --runInBand`) — 1947 tests
- **1929 PASS / 18 FAIL** en **6 suites**, TODAS de render react-pdf, con el mismo error
  `TypeError: Cannot read properties of undefined (reading 'identifier')` en `jest-runtime`.

#### Diagnóstico: flakiness ESM PRE-EXISTENTE (no regresión de 6.4a)
Correr SOLO las suites de render **anteriores a 6.4a** (sin condiciones) juntas ya reproduce el
fallo (2 de 3 suites fallan; la 1.ª que carga pasa, las siguientes rompen). Es una interacción
jest 30 + módulos ESM de `@react-pdf/renderer` al compartir proceso `--runInBand`: cada suite de
render **pasa en aislamiento**; varias juntas se pisan. Afecta a todo el épico #6 (6.1b/6.2/PR#66),
no lo introduce esta rebanada. Deuda técnica de toolchain a tratar en un change aparte
(p. ej. aislar suites react-pdf con `--maxWorkers`/proyecto jest dedicado o `test.concurrent` off).

## Veredicto step-N+1
Lógica de 6.4a **verde** (30/30 tests propios). BD verificada con las 14 secciones. Los rojos de la
suite global son flakiness ESM pre-existente, ajena a 6.4a. **APTO para continuar.**

# QA Report — fix-importe-total-confirmar-senal

**Fecha:** 2026-07-20
**Rama:** `worktree-fix-importe-total-confirmar-senal`
**Ejecutado desde:** sesión principal (con Postgres real; los subagentes QA no tienen Docker/Postgres).

## Bug verificado (RED)

`POST /reservas/{id}/confirmar-senal` devolvía **siempre** 422 `IMPORTE_TOTAL_INVALIDO`
porque `validarImporteTotal` leía `RESERVA.importe_total`, columna que ningún código de
producción escribía → NULL en BD real.

- **RED unit** (`confirmar-pago-senal.use-case.spec`): fallo de compilación TS2353 (`presupuestoVigente`
  no existía) — el contrato nuevo no estaba implementado.
- **RED integración** (`confirmar-pago-senal-integracion`, Postgres real): **11 tests fallaban** con
  `ImporteTotalInvalidoError` en `confirmar-pago-senal.use-case.ts:562` al sembrar la RESERVA
  con un PRESUPUESTO `enviado` pero sin `importe_total`. Reproduce el bug reportado por el usuario.

## Fix (GREEN)

Dentro de la transacción atómica de confirmar-señal: (1) lee el total del presupuesto vigente
(`MAX(version)`, `estado='enviado'`); (2) valida `total > 0`; (3) congela
`RESERVA.importe_total`; (4) marca el presupuesto `aceptado`. Endpoint/DTO/contrato sin cambios.

## Resultados (GREEN) — todos ejecutados contra Postgres real

| Suite | Resultado |
|---|---|
| `confirmar-pago-senal.use-case.spec` (unit) | **50/50** ✓ |
| `confirmar-pago-senal-integracion` + `confirmar-pago-senal-concurrencia` | **16/16** ✓ |
| `src/confirmacion` + `src/facturacion` (regresión módulo acoplado) | **526/526** ✓ |
| `tsc --noEmit` | sin errores ✓ |
| `eslint src/**/*.{ts,tsx}` (api) | limpio ✓ |

## Verificación de estado en BD (asserts del test de integración, happy path)

Tras `POST /reservas/{id}/confirmar-senal` con presupuesto vigente `enviado` (total 3.000,00 €) y
`pct_senal = 40`:
- `reserva.estado = 'reserva_confirmada'`
- `reserva.importe_total = 3000.00` (congelado desde el presupuesto vigente)
- `presupuesto.estado = 'aceptado'`
- `reserva.importe_senal = 1200.00`, `reserva.importe_liquidacion = 1800.00`
- `importe_senal + importe_liquidacion = importe_total` (exacto, complemento por resta)

Escenarios adicionales verdes: `MAX(version)` (congela el total de la versión vigente v2, acepta v2);
sin presupuesto vigente válido → 422 sin efectos; double-click concurrente → solo una confirmación
congela/acepta.

## Regresión de facturación (bug latente acoplado)

Con el presupuesto ahora marcado `aceptado`, los lectores de facturación
(`lecturas-borradores`, `lecturas-facturacion`, `cargar-datos-documento-factura`) encuentran el
`PRESUPUESTO(estado='aceptado')` esperado en lugar de caer al fallback "CON IVA por defecto".
Las 526 pruebas de `src/facturacion` siguen en verde.

## Notas / deuda pre-existente (no atribuible a este cambio)

- Suites react-pdf ESM (`documento-presupuesto-*.plantilla.spec.ts`) pueden dar rojo al correr
  `pnpm test` global junto (MEMORY `react-pdf-esm-suite-flakiness`); verdes en aislamiento.
- E2E a través de servidor vivo (curl) no ejecutado: el test de integración ya ejercita el flujo
  real contra Postgres real (use-case + adaptadores Prisma reales); solo queda sin cubrir el
  controlador NestJS de multipart, que este fix no toca.

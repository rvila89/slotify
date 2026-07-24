# QA — Unit tests + verificación de BD

Change: `fix-liquidacion-fianza-independientes` · Fecha: 2026-07-24 · Entorno: worktree aislado (`slotify_wt_liqfianza_dev`/`_test`, API 3100).

## Unit / integración (sesión principal, Postgres real)

- **`pnpm --filter api` jest (suite completa)**: 2721 passed / 2733. Los 12 fallos restantes son **pre-existentes en `origin/master`** (ficheros byte-idénticos a la base, sin ripple del cambio; fallan en aislamiento o son flaky):
  - react-pdf ESM (`documento-presupuesto*.plantilla`, `documento-presupuesto-titulo-amarillo.layout`) — flakiness conocida (memoria `react-pdf-esm-suite-flakiness`).
  - `alta-consulta.use-case` (canalEntrada web/email), `disparar-e2.adapter` (idioma del nombre de adjunto), `transicion-fecha`/`plantilla-transicion-fecha` (firma "Ari — Masia l'Encís") — ficheros no tocados por el diff.
  - `alta-consulta-con-fecha-concurrencia` (US-004 40P01) — flaky conocido (pasó en re-run).
- **Suites propias del cambio — TODAS EN VERDE**:
  - `enviar-factura-liquidacion`, `obtener-factura-liquidacion`, `subir-comprobante-fianza`, `devolver-fianza` (unit, mocked ports).
  - `devolver-fianza-integracion` + `devolver-fianza-concurrencia` (Postgres real) → **8/8** — bloquean la regresión del bug `::uuid` y la guarda `SELECT … FOR UPDATE`.
  - `generar-borradores-liquidacion-fianza` (solo liquidación), `catalogo-plantillas` (E4 solo-liquidación + E10 CA/ES), `maquina-estados` (guarda evento sin fianza), `forzar-inicio-evento` (×2, precondición doble), `modelo-documento-factura` (subtítulo "60% de l'import restant…").
- **`tsc -p tsconfig.json` y `tsconfig.build.json`**: 0 errores.
- **Arquitectura hexagonal (`pnpm --filter api run arch` / depcruise)**: ✔ 0 violaciones (700 módulos).

## Verificación de BD (migración + estado)

- Migración `20260724120000_fix_liquidacion_fianza_independientes` aplicada a dev+test.
- Enums: `TipoFactura = senal|liquidacion|complementaria` (sin `fianza`); `FianzaStatus = pendiente|cobrada|devuelta` (sin `recibo_enviado`/`retenida_parcial`); `TipoDocumento` +`comprobante_fianza`; `CodigoEmail` +`E10`.
- Columnas: `cliente.iban_devolucion`, `reserva.motivo_retencion`, `reserva.fianza_devuelta_eur` eliminadas; `reserva.fianza_comprobante_fecha` añadida.
- Tras el flujo curl (ver report curl): `FACTURA` solo `tipo=liquidacion`; `COMUNICACION` = E4 + E10 (`enviado`), **sin E5**; `DOCUMENTO` `comprobante_fianza` = 1; `fianza_status` recorre `pendiente→cobrada→devuelta`.

**Veredicto**: el cambio no introduce ninguna regresión nueva; todas las suites del cambio en verde.

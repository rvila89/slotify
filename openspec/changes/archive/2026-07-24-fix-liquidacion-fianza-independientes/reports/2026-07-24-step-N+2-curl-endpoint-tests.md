# QA — Pruebas manuales con curl (BD real)

Change: `fix-liquidacion-fianza-independientes` · Fecha: 2026-07-24 · API en `http://localhost:3100/api` (worktree, `slotify_wt_liqfianza_dev`). Login: `info@masialencis.com` / `Slotify2026!` (gestor piloto).

## Arranque de la API
- `Nest application successfully started`. Rutas nuevas mapeadas: `GET /reservas/:id/factura-liquidacion`, `POST /reservas/:id/facturas/liquidacion/{enviar,reenviar}`, `POST /reservas/:id/fianza/{comprobante,devolver}`. Rutas eliminadas ausentes (aprobar-enviar combinado, fianza/enviar, fianza/cobro, iban-devolucion). `liquidacion/cobro` (US-029) conservada. → **DI wiring correcto**.

## Flujo verificado (reserva sembrada en `reserva_confirmada`, fianza_eur=500, liquidación borrador)

| Paso | Resultado |
|------|-----------|
| `GET factura-liquidacion` (borrador) | 200 · `estado=borrador`, `e4Enviado=false`, `esBorradorInvalido=false`, `total=600.00` |
| `POST liquidacion/enviar` sin PDF | **502 `EMISION_ENVIO_FALLIDO`** · reserva sigue `borrador`, sin número → **atomicidad E4 correcta** (rollback; PDF ausente bloquea envío) |
| `POST facturas/{id}/regenerar-pdf` | 200 · `pdfPendiente=false`, `pdfUrl` set |
| `POST liquidacion/enviar` (retry) | 200 · `estado=enviada`, `e4Enviado=true`, `numeroFactura=F-2026-0001`, `fechaEmision` set |
| `POST fianza/comprobante` (multipart pdf) | 200 · `fianza_status=cobrada`, `fianza_comprobante_fecha` + `fianza_cobrada_fecha` set, DOCUMENTO `comprobante_fianza` creado |
| `POST fianza/devolver` (post_evento) | 200 · `fianza_status=devuelta`, `fianza_devuelta_fecha` set, `avisoEmail=null` (E10 enviado) |

## Estado final en BD
- `FACTURA`: solo `tipo=liquidacion` (`enviada`, F-2026-0001). **No hay factura `tipo=fianza`**.
- `COMUNICACION`: `E4` (enviado) + `E10` (enviado). **No hay E5**.
- `DOCUMENTO comprobante_fianza`: 1.
- Reserva DTO expone `fianzaComprobanteFecha`; **no** expone `ibanDevolucion`/`motivoRetencion`/`fianzaDevueltaEur`.

## Bug encontrado y corregido durante el QA
`devolver-fianza.prisma.adapter.ts`: el `SELECT … FOR UPDATE` casteaba el parámetro a `::uuid` contra la columna `id_reserva` (TEXT en Prisma) → Postgres `42883 operator does not exist: text = uuid` → **HTTP 500**. Fix: eliminar el cast (`WHERE id_reserva = ${reservaId}`), alineado con `cobro-liquidacion-repository`. Re-test → 200. Regresión bloqueada por `devolver-fianza-integracion`/`-concurrencia`.

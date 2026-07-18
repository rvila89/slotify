# QA Step 6 — Unit tests + verificación BD (US-051)

Fecha: 2026-07-18 · Ejecutado desde la sesión principal (Postgres real disponible).

## Suites ejecutadas

| Suite | Resultado |
|---|---|
| Backend `reservas` + `presupuestos` (jest, unit + integración mockeada) | **133 suites / 1369 tests ✓** |
| Backend `cambiar-fecha` contra **Postgres real** (`slotify_test`) — integración + concurrencia | **29/29 ✓** (3 runs seguidos, sin flakiness) |
| Frontend (vitest, toda la suite web) | **45 archivos / 304 tests ✓** |

## Cobertura crítica verificada contra Postgres real (bloqueo atómico)

`cambiar-fecha-concurrencia.spec.ts` + `cambiar-fecha-integracion.spec.ts` (patrón `atomic-date-lock`):
1. Camino feliz: mover F1→F2 libre, atómico (bloquea F2, `fecha_evento=F2`, libera F1), estado conservado, AUDIT_LOG F1→F2.
2. **D4 concurrencia**: dos cambios simultáneos a la misma F2 → exactamente uno gana (invariante `UNIQUE(tenant_id, fecha)`), el otro recibe `CambiarFechaConflictoError` (409) con su reserva y fecha antiguas intactas.
3. Liberar F1 con cola → promoción FIFO (A15) exactamente una vez.
4. F2 ocupada → 409, rollback total (reserva conserva F1).

## Bugs encontrados y corregidos en esta fase (solo detectables contra BD real)
- **Atomicidad cambiar-fecha**: el adaptador hacía `INSERT(F2)+DELETE(F1)` violando `UNIQUE(reserva_id)`. Corregido a **UPDATE en sitio** de la fila de bloqueo (F1→F2).
- **Traducción de conflicto bajo concurrencia**: el `$executeRaw` emitía `P2010/23505` en vez de `P2002`; el traductor no lo reconocía. Corregido usando el update **tipado** de Prisma (`updateMany`) → `P2002` limpio → `CambiarFechaConflictoError`.

## Notas
- La suite global completa (`pnpm test`) presenta fallos flaky **pre-existentes** ajenos a US-051 (deadlock 40P01 de US-004, flakiness ESM de react-pdf); verificado ejecutando las suites afectadas de forma aislada, todas en verde.
- Estado de BD tras los tests de concurrencia: las suites limpian sus propios datos (fechas de evento aisladas); `slotify_test` queda consistente.

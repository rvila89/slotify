# QA — Unit tests + verificación de BD (US-015)

Fecha: 2026-07-15. Ejecutado desde la sesión principal (Postgres real disponible).

## Unit tests

Comando: `pnpm jest editar-presupuesto maquina-estados-editar-presupuesto` (apps/api).

```
Test Suites: 2 passed, 2 total
Tests:       49 passed, 49 total
```

- `maquina-estados-editar-presupuesto.spec.ts`: 7/7 — guarda declarativa
  `esEstadoValidoParaEditarPresupuesto` (solo `pre_reserva` válido; 6 estados inválidos vía `it.each`).
- `editar-presupuesto.use-case.spec.ts`: 42/42 — `EditarPresupuestoUseCase` (preview/confirmar)
  y `ReenviarPresupuestoUseCase`, cubriendo AC-1..AC-12 con puertos mockeados, incluidos:
  - 6 casos AC-2 (4 por `id_reserva_extra` + **2 nuevos por `extra_id`** que reproducen el
    payload real del contrato y capturan el bug de congelado corregido).
  - AC-12 reintento P2002 (unit con UoW fake) sobre `(reservaId, version)`.

Regresión `src/presupuestos`: sin roturas. `pnpm lint` (apps/api): limpio. `tsc --noEmit`: sin errores.

## Verificación de BD real

Realizada vía el flujo curl (ver `2026-07-15-step-N+2-curl-endpoint-tests.md`), que
ejercita los endpoints contra `slotify_dev` y comprueba el estado en Postgres:

- **Versionado inmutable**: nuevas filas `PRESUPUESTO` por versión (v1 conservada como
  historial); vigente = `MAX(version)`.
- **RESERVA_EXTRA (D3)**: primera persistencia real; `precio_unitario` congelado, `origen`,
  `subtotal`, `factura_id=null` verificados en tabla.
- **Numeración `AAAANNN`** por envío (`@@unique([tenantId, regimenIva, numeroPresupuesto])`);
  borrador `null`.
- **Invariantes**: `RESERVA.estado` sigue `pre_reserva`; `FECHA_BLOQUEADA.ttl_expiracion` sin cambios.
- **COMUNICACION E2 `es_reenvio=true`** (una por envío) y **AUDIT_LOG `actualizar`** confirmados.

### Reintento P2002 real (nota)
El AC-12 unit inyecta la colisión con un UoW fake. El reintento contra el constraint real
`@@unique([reservaId, version])` no se forzó con concurrencia real de hilos porque la US
NO marca esta historia como zona crítica (no toca `FECHA_BLOQUEADA`); la serialización por
el índice único + reintento `MAX+1` está cubierta por el unit y por el mismo patrón ya
probado en US-014. No se añaden tests de hilos (heurística de la spec).

## Veredicto (unit + BD)

**APTO.** 49/49 unit verdes; estado de BD real conforme a los criterios de aceptación e
invariantes. Bug AC-2 detectado y corregido (con test de regresión que falla con el código
viejo y pasa con el nuevo).

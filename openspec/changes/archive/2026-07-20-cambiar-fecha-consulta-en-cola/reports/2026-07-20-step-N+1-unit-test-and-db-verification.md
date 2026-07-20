# Step N+1 — Unit tests + verificación de estado BD

**Change:** `cambiar-fecha-consulta-en-cola`
**Fecha:** 2026-07-20
**Ejecutado por:** sesión principal (Postgres real disponible; los subagentes no tienen BD).
**BD de test aislada del worktree:** `slotify_test_cfcola` (migrate deploy + seed tenant piloto).

## 1. Tests de la feature (aislados) — VERDE

`pnpm exec jest --runInBand "reservas/__tests__/(cambiar-fecha|maquina-estados-cambiar|maquina-estados-transicion-cambiar|salida-de-cola)"`

```
Test Suites: 8 passed, 8 total
Tests:       94 passed, 94 total
```

Suites cubiertas:
- `maquina-estados-cambiar-fecha-en-cola.spec.ts` — guarda `esOrigenCambiarFechaEnCola` (solo `2d`); no-regresión de `esOrigenValidoParaCambiarFecha` (sigue sin aceptar `2d`).
- `maquina-estados-transicion-cambiar-fecha-en-cola.spec.ts` — transición `2d→2b`.
- `salida-de-cola-cambiar-fecha.spec.ts` — dominio puro `planificarSalidaDeCola` (cierre de hueco contiguo, anomalías).
- `cambiar-fecha-en-cola.use-case.spec.ts` — rama `2d` fecha libre (efectos completos, sin promoción) y fecha ocupada (409 terminal, rollback).
- `cambiar-fecha-en-cola-concurrencia.spec.ts` — **integración real** (ver §2).
- `cambiar-fecha.use-case.spec.ts` / specs de `maquina-estados` / `promocion-cola` — no-regresión `2b/2c/2v`.

## 2. Concurrencia contra Postgres real — VERDE

`pnpm exec jest --runInBand cambiar-fecha-en-cola-concurrencia`

```
Test Suites: 1 passed, 1 total
Tests:       1 passed, 1 total
```

Dos consultas en `2d` (de colas distintas) cambian a la MISMA fecha libre F2 concurrentemente:
exactamente una bloquea F2 (respetando `UNIQUE(tenant_id, fecha)`) y pasa a `2b`; la otra
recibe 409 y conserva su `2d`/posición. Serialización PostgreSQL (`SELECT … FOR UPDATE`),
sin locks distribuidos.

## 3. Suite completa del backend — fallos pre-existentes ajenos al change

`pnpm exec jest --runInBand` (proyecto completo, salida JSON):

```
Test Suites: 265 total — 256 passed, 9 failed
Tests:       2614 total — 2595 passed, 19 failed
```

Las **9 suites en rojo NO pertenecen a este change** (verificado: el diff no toca ninguno de
esos ficheros ni sus dependencias; el cambio en `maquina-estados.ts` es puramente aditivo):

| Suite fallida | Causa (pre-existente y documentada) |
|---|---|
| `documentos/…/documento-presupuesto.plantilla.spec.ts` (×4 variantes) | react-pdf ESM: `A dynamic import callback was invoked without --experimental-vm-modules` (flakiness al correr las suites de render juntas). |
| `facturacion/…/aprobar-y-enviar-{concurrencia,atomicidad}`, `enviar-factura-senal-integracion`, `reenviar-e3-integracion` | integración/concurrencia + render PDF de factura. |
| `reservas/__tests__/finalizar-evento-integracion.spec.ts` (1 test) | defecto de doble de test pre-existente: `TypeError: fakeEmail.forzarFallo is not a function` (fichero NO tocado por el change). |

Las suites de la feature pasan en aislamiento (§1). Conclusión: **sin regresión introducida**.

## 4. Verificación de estado en BD (tras el escenario curl, §step-N+2)

Escenario: A bloquea F1 (`2b`); B y C entran en cola de F1 (`2d`, pos 1 y 2); se cambia la
fecha de **B** (en cola) a **F2 libre**.

```
-- B (la que cambió de fecha desde la cola)
fecha_evento=2026-09-20 | sub_estado=s2b | posicion_cola=NULL | consulta_bloqueante_id=NULL   ✅
-- C (hermana que quedaba por detrás) → reordenada cerrando el hueco
fecha_evento=2026-09-15 | sub_estado=s2d | posicion_cola=1 | (sigue apuntando a A)             ✅
-- FECHA_BLOQUEADA
2026-09-15 → A (blando)   |   2026-09-20 → B (blando)                                          ✅
-- COMUNICACION de B
E1 | borrador | fecha_envio IS NULL = true                                                    ✅
-- AUDIT_LOG de B
accion=actualizar | datos_nuevos.sub_estado=2b                                                ✅
```

**Nota de bug detectado y corregido en esta fase (ver step-N+2):** la primera verificación
mostró `C.posicion_cola=2` (hueco no cerrado). Causa: el use-case leía la cola hermana
DESPUÉS de sacar la reserva de la cola. Corregido (leer antes de mover) y re-verificado
(`C.posicion_cola=1`). El test unitario se endureció con un fake CON ESTADO que reproduce el
orden real, de modo que una regresión del orden vuelve a fallar en CI sin BD.

## 5. Restauración

BD de test **aislada** por worktree (`slotify_test_cfcola`); no se toca `slotify_dev` ni el
`slotify_test` del workspace principal. No requiere restauración de datos de dev.

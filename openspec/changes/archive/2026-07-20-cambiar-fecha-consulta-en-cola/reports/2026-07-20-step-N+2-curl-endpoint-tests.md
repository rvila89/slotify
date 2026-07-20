# Step N+2 — Pruebas manuales de endpoint con curl (HTTP real)

**Change:** `cambiar-fecha-consulta-en-cola`
**Fecha:** 2026-07-20
**API:** worktree en `http://localhost:3999` → BD aislada `slotify_test_cfcola` (arrancada por la sesión principal).
**Actor:** gestor piloto `info@masialencis.com`.
**Objetivo:** ejercitar el adaptador Prisma REAL (SQL) del endpoint `POST /reservas/{id}/cambiar-fecha`
para la rama `2d`, que los tests unitarios (con puertos mockeados) no cubren
([[us049-backend-untested-real-db]]).

## Escenario y resultados

| # | Acción (HTTP) | Esperado | Resultado |
|---|---|---|---|
| 1 | `POST /auth/login` | 200 + accessToken | ✅ 200 |
| 2 | `POST /reservas` A, fechaEvento F1 (2026-09-15) | 201, `subEstado=2b` (bloquea F1) | ✅ 2b |
| 3 | `POST /reservas` B, fechaEvento F1 | 201, `subEstado=2d`, pos 1 | ✅ 2d/1 |
| 4 | `POST /reservas` C, fechaEvento F1 | 201, `subEstado=2d`, pos 2 | ✅ 2d/2 |
| 5 | `POST /reservas/{B}/cambiar-fecha` → F2 libre (2026-09-20) | **200**, `subEstado=2b` | ✅ 200 / 2b |
| 6 | `POST /reservas/{C}/cambiar-fecha` → F1 ocupada | **409** con `motivo`, **sin** `colaDisponible` | ✅ 409, sin colaDisponible |
| 7 | `POST /reservas` D sin fecha (`2a`) → `cambiar-fecha` F3 | **422** guarda de origen | ✅ 422 |

Respuesta 409 (caso 6), shape terminal correcto:
```json
{ "statusCode":409, "error":"Conflict",
  "message":"La fecha destino no está disponible: ya está bloqueada por otra reserva.",
  "motivo":"La fecha destino no está disponible: ya está bloqueada por otra reserva." }
```
(No expone `colaDisponible` — el conflicto es terminal, no se ofrece re-encolar.)

422 (caso 7): `"Solo se puede cambiar la fecha de una consulta con fecha bloqueada (sub-estado 2b/2c/2v) o en cola (2d)"`.

## Verificación de estado en BD (psql, tras el caso 5)
Ver detalle en el report step-N+1 §4: B→`F2/s2b/NULL/NULL`; **C reordenada `2→1`** (hueco
cerrado); `FECHA_BLOQUEADA` F1→A y F2→B; `COMUNICACION` E1 `borrador` (`fecha_envio` NULL);
`AUDIT_LOG` `actualizar`.

## 🐛 Bug detectado por la prueba real (y corregido)
La **primera** ejecución dejó `C.posicion_cola = 2` (el hueco no se cerró). Diagnóstico:
`CambiarFechaUseCase.cambiarDesdeCola` invocaba `leerColaHermana` **después** de
`moverFueraDeCola` (que ya había puesto `consulta_bloqueante_id → NULL` de la saliente), así
que `planificarSalidaDeCola` recibía una cola SIN la saliente → no contigua → rama de anomalía
→ sin reordenación. El test unitario lo enmascaraba porque su mock de `leerColaHermana`
devolvía la cola completa con independencia del orden.

**Fix:** leer la cola hermana ANTES de sacar la reserva (respeta el contrato de la función de
dominio, que exige que la saliente siga en la cola). **Re-verificado**: `C.posicion_cola = 1`.
Endurecido el test unitario con un fake CON ESTADO que reproduce el orden real (regresión del
orden vuelve a fallar en CI). Confirmado además por el test de concurrencia contra BD real.

## Restauración
BD de test aislada por worktree (`slotify_test_cfcola`); no afecta a `slotify_dev` ni al
`slotify_test` del workspace principal.

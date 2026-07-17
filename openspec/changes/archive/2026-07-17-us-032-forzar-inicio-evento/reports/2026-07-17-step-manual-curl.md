# Step Manual (curl) — POST /api/reservas/{id}/forzar-inicio-evento  (2026-07-17)

API real (`pnpm dev`, `http://localhost:3000/api`) contra la BD de desarrollo. Login gestor
`info@masialencis.com` (tenant piloto). Escenario sembrado con fixture idempotente:
`reserva_confirmada` + `fecha_evento = hoy` + `liquidacion_status = facturada` (una
precondición incumplida).

## Comandos ejecutados
```bash
TOKEN=$(curl -s -X POST $BASE/auth/login -d '{"email":"info@masialencis.com","password":"***"}' ...)
# (1) sin token
curl -X POST $BASE/reservas/$RID/forzar-inicio-evento
# (2) reserva inexistente
curl -X POST $BASE/reservas/00000000-0000-0000-0000-0000000000de/forzar-inicio-evento -H "Authorization: Bearer $TOKEN"
# (3) happy path
curl -X POST $BASE/reservas/$RID/forzar-inicio-evento -H "Authorization: Bearer $TOKEN"
# (4) idempotencia (repetir sobre reserva ya evento_en_curso)
curl -X POST $BASE/reservas/$RID/forzar-inicio-evento -H "Authorization: Bearer $TOKEN"
# (5) fecha != hoy (reserva reserva_confirmada + fecha mañana)
curl -X POST $BASE/reservas/$RID_MANANA/forzar-inicio-evento -H "Authorization: Bearer $TOKEN"
```

## Resultados (códigos HTTP observados)
| # | Caso | Esperado | Observado |
|---|------|----------|-----------|
| 1 | Sin JWT | 401 | **401** |
| 2 | Reserva inexistente / otro tenant | 404 | **404** (`"...no existe o no es accesible para el tenant"`) |
| 3 | Happy path (forzado) | 200 | **200** — `estado:"evento_en_curso"`, `forzadoPorGestor:true`, `precondicionesIncumplidas:["liquidacion_status"]` |
| 4 | Idempotencia (ya `evento_en_curso`) | 409 `conflicto_estado` | **409** — `code:"conflicto_estado"`, msg "El evento ya está en curso…" |
| 5 | `reserva_confirmada` + fecha ≠ hoy | 422 `fecha_evento_no_es_hoy` | **422** — `code:"fecha_evento_no_es_hoy"`, msg "…solo está disponible el día del evento" |

- **403** (autenticado sin rol gestor): no reproducible por curl (el seed solo tiene usuarios
  `gestor`); cubierto por el spec de controller HTTP (supertest, `@Roles('gestor')`).
- **400**: no aplica — el endpoint no recibe body validable (body vacío).

## Verificación BD (post happy path) — origen Usuario + evidencia del override (D-4) e intactos (D-5)
Consulta directa a la BD tras el 200:
```
AUDIT_COUNT=1
AUDIT { usuarioId:"…0002", accion:"transicion", entidad:"RESERVA",
        datosAnteriores:{estado:"reserva_confirmada"},
        datosNuevos:{estado:"evento_en_curso", forzado_por_gestor:true,
                     precondiciones_incumplidas:["liquidacion_status"]} }
RESERVA { estado:"evento_en_curso", preEventoStatus:"cerrado",
          liquidacionStatus:"facturada", fianzaStatus:"cobrada" }
```
- **1 sola** entrada de transición (idempotencia).
- Origen **Usuario** (`usuario_id` poblado), `forzado_por_gestor:true`, `precondiciones_incumplidas` = lista real.
- **D-5**: los tres `*_status` intactos (solo mutó `estado`).

## Comparación BD pre/post
| tabla | pre | post (tras restaurar) |
|-------|-----|------|
| reserva (email `qa-us032*@fixture.test`) | 0 | 0 |
| cliente (email `qa-us032*@fixture.test`) | 0 | 0 |
| audit_log (entidad_id de las reservas de prueba) | 0 | 0 |

## Restauración
Fixtures borrados con `node us032-fixture.cjs --teardown` y `us032-manana.cjs --teardown`
(elimina audit_log + reserva + cliente por email fijo). BD de desarrollo sin residuos.

## Outcome
PASS

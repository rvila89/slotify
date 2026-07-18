# QA Step 7 — Pruebas manuales con curl (US-051)

Fecha: 2026-07-18 · API dev en `localhost:3000` contra `slotify_dev`, `EMAIL_TRANSPORT=fake` forzado (0 envíos reales). Tenant Masia l'Encís (`info@masialencis.com`).

Script: `qa-curl-us051.sh` (crea datos, verifica, restaura BD).

## Resultados — TODOS PASARON

| # | Caso | Resultado |
|---|---|---|
| 0 | Login gestor | ✅ 200, accessToken |
| 1 | Alta consulta con fecha → `2b` | ✅ |
| 3 | `PATCH /reservas/{id}` fija invitados=30, duración=8, horario=11:00 | ✅ 200, persistido y devuelto por GET |
| 4 | `PATCH` invitados 30→20 (caso del usuario) | ✅ persistido |
| 5 | `PATCH` con `fechaEvento` en el body → **ignorado** (regla D-1) | ✅ `fecha_evento` no mutada; `FECHA_BLOQUEADA` intacta |
| 6 | `PATCH` `horario` sin `duracionHoras` → validación | ✅ 400, no persiste |
| 7 | `POST /reservas/{id}/cambiar-fecha` F1→F2 libre | ✅ 200; bloqueo movido (1 sola fila); F1 liberada; `fecha_evento=F2` |
| 8 | `cambiar-fecha` a fecha **ocupada** | ✅ 409 conflicto; rollback total (reserva conserva F2) |
| 9 | `PATCH` reserva inexistente | ✅ 404 |
| 10 | AUDIT_LOG de las mutaciones (`accion='actualizar'`) | ✅ registrado |

## Bug encontrado y corregido en esta fase
- **`horario` no se devolvía en el GET** aunque se persistía: faltaba en el DTO de respuesta, el modelo de query, el adapter Prisma y el controller de `obtener-reserva`. Sin esto la ficha (Punto 1) nunca mostraría la hora. Corregido (commit `fbb861a`) y re-verificado: `GET horario="11:00"`. La verificación cruzada BD-vs-GET fue la que lo destapó.

## Restauración
El script elimina las reservas/clientes/bloqueos/auditoría de prueba creados. `slotify_dev` queda en su estado previo (seed).

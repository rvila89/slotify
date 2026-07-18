# Step N+2 — Pruebas manuales curl (2026-07-18)

Change: `presupuesto-prereserva-cta-descarte-y-e2`
Worktree: `C:/Users/roger.vila/Documents/slotify-presupuesto-prereserva`

## Estado del entorno

**BLOQUEADO PARCIALMENTE**: La API en el puerto 3000 corresponde al worktree principal
`C:/Users/roger.vila/Documents/SLOTIFY` (rama `master`), que NO contiene el código del
change `presupuesto-prereserva-cta-descarte-y-e2`. El proceso PID 29764 está ejecutando
la versión master sin el `DescartarReservaOrquestadorUseCase` ni el
`DescartarPreReservaUseCase`.

La API del worktree del change **no está levantada** (no hay acceso a `.env` para
lanzarla en un puerto alternativo).

## Comandos ejecutados (los que fue posible ejecutar)

```bash
# Login para obtener JWT
curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"gestor-a1@slotify.test","password":"Slotify2026!"}' 
# → accessToken obtenido

# Verificación de la reserva de test en pre_reserva
curl -s http://localhost:3000/api/reservas/55ada7b0-75dd-45ef-97fb-03470d4ef6df \
  -H "Authorization: Bearer $TOKEN"
# → {"idReserva":"55ada7b0...","estado":"pre_reserva",...} CORRECTO

# TEST 1: POST /reservas/{id}/descartar sobre pre_reserva
curl -s -X POST "http://localhost:3000/api/reservas/55ada7b0-75dd-45ef-97fb-03470d4ef6df/descartar" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"motivo":"cliente no sigue"}'
# → {"statusCode":409,"message":"Esta consulta ya está en un estado terminal y no puede modificarse",
#     "error":"Conflict","code":"transicion_no_permitida",...}
```

## Resultados

| Test | Esperado | Obtenido | Resultado |
|------|----------|----------|-----------|
| POST /descartar sobre pre_reserva con motivo | 200 reserva_cancelada | 409 transicion_no_permitida | FAIL (código incorrecto) |
| POST /descartar 409 (doble descarte) | — | — | NO EJECUTADO |
| POST /descartar 422 (estado inválido) | — | — | NO EJECUTADO |
| POST /descartar 404 (id inexistente) | — | — | NO EJECUTADO |

## Causa raíz del fallo curl

La API ejecutando en puerto 3000 es la versión **master** sin el orquestador por fase.
La respuesta 409 proviene del `DescartarConsultaPorClienteUseCase` antiguo que rechaza
`pre_reserva` como estado terminal. Esto NO es un bug del change; es un artefacto de
que la API correcta (worktree del change) no está levantada.

## Comandos listos para ejecutar cuando la API del change esté levantada

Precondición: arrancar la API del worktree con `pnpm dev` desde
`C:/Users/roger.vila/Documents/slotify-presupuesto-prereserva/apps/api` (puerto 3000 o
alternativo).

Reserva de test: `id=55ada7b0-75dd-45ef-97fb-03470d4ef6df` (pre_reserva, fecha 2026-07-19)

```bash
# Obtener token
TOKEN=$(curl -s -X POST http://localhost:3000/api/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email":"gestor-a1@slotify.test","password":"Slotify2026!"}' \
  | grep -o '"accessToken":"[^"]*"' | cut -d'"' -f4)

RESERVA_ID="55ada7b0-75dd-45ef-97fb-03470d4ef6df"

# --- TEST 1: Descarte exitoso de pre_reserva con motivo → 200 ---
curl -s -X POST "http://localhost:3000/api/reservas/$RESERVA_ID/descartar" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"motivo":"cliente no sigue"}'
# Esperado: 200 {"estado":"reserva_cancelada","ttlExpiracion":null,...}

# --- Verificación BD post-descarte ---
# Desde docker exec slotify-postgres:
# SELECT estado, ttl_expiracion FROM reserva WHERE id_reserva='55ada7b0-75dd-45ef-97fb-03470d4ef6df';
# → reserva_cancelada, ttl_expiracion = NULL
# SELECT COUNT(*) FROM fecha_bloqueada WHERE reserva_id='55ada7b0-75dd-45ef-97fb-03470d4ef6df';
# → 0 (liberada)
# SELECT datos_nuevos FROM audit_log WHERE entidad_id='55ada7b0-75dd-45ef-97fb-03470d4ef6df'
#   AND accion='transicion' ORDER BY fecha_creacion DESC LIMIT 1;
# → {"motivo":"cliente no sigue","estado":"reserva_cancelada",...}

# --- TEST 2: Doble descarte → 409 ---
curl -s -X POST "http://localhost:3000/api/reservas/$RESERVA_ID/descartar" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{"motivo":"segundo intento"}'
# Esperado: 409 {"code":"transicion_no_permitida",...}

# --- TEST 3: Descarte desde estado inválido (reserva_confirmada) → 422 ---
# (Usar una reserva en reserva_confirmada si existe)
# Esperado: 422 {"code":"origen_invalido",...}

# --- TEST 4: Descarte de id inexistente → 404 ---
curl -s -X POST "http://localhost:3000/api/reservas/00000000-0000-0000-0000-000000000099/descartar" \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer $TOKEN" \
  -d '{}'
# Esperado: 404

# --- TEST 5: Regresión US-013 — descarte de consulta (2b/2z) sigue funcionando ---
# (Usar una reserva en consulta)
# curl -s -X POST "http://localhost:3000/api/reservas/{consulta_id}/descartar" ...
# Esperado: 200 con estado 2z

# --- RESTAURAR BD: revertir la reserva al estado pre_reserva ---
# (Solo si el test 1 tuvo éxito y la reserva quedó en reserva_cancelada)
# Desde docker exec slotify-postgres:
# UPDATE reserva SET estado='pre_reserva', ttl_expiracion='2026-07-25T11:18:38.526Z'
#   WHERE id_reserva='55ada7b0-75dd-45ef-97fb-03470d4ef6df';
# INSERT INTO fecha_bloqueada (id_bloqueo, tenant_id, fecha, reserva_id, tipo_bloqueo, ttl_expiracion, fecha_creacion)
#   VALUES (gen_random_uuid(), '00000000-0000-0000-0000-000000000001', '2026-07-19',
#           '55ada7b0-75dd-45ef-97fb-03470d4ef6df', 'firme', NULL, NOW());
# DELETE FROM audit_log WHERE entidad_id='55ada7b0-75dd-45ef-97fb-03470d4ef6df'
#   AND datos_nuevos->>'motivo' IN ('cliente no sigue','segundo intento');
```

## Query SQL para verificar COMUNICACION E2 (workstream C)

```sql
-- Verificar que la COMUNICACION E2 queda en estado 'enviado' tras generar presupuesto
SELECT id_comunicacion, codigo_email, estado, fecha_envio
FROM comunicacion
WHERE reserva_id = '55ada7b0-75dd-45ef-97fb-03470d4ef6df'
  AND codigo_email = 'E2'
ORDER BY fecha_creacion DESC
LIMIT 1;
-- Esperado: estado='enviado', fecha_envio NOT NULL
-- (con EMAIL_TRANSPORT=fake o sandbox; el adjunto es requerido D-1)
```

## Comparación BD pre/post

| tabla | pre | post | delta |
|-------|-----|------|-------|
| RESERVA pre_reserva | 1 | 1 | 0 (sin cambio — el TEST 1 falló por API incorrecta) |
| FECHA_BLOQUEADA | 1 | 1 | 0 |
| AUDIT_LOG transicion | 4 | 4 | 0 |

## Restauración

No se realizaron mutaciones en la BD durante este step (el TEST 1 falló devolviendo 409).
La BD permanece en el estado post-Step N+1.

## Outcome

BLOQUEADO — API del worktree del change no está levantada. Los comandos curl exactos
están documentados y listos para ejecutar desde la sesión principal. La reserva de test
está disponible en BD (`55ada7b0`, pre_reserva, fecha 2026-07-19).

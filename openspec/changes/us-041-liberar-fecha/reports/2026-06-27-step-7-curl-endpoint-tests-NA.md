# QA Report — Step 7: Pruebas de Endpoint (N/A — verificacion indirecta)
**Change:** us-041-liberar-fecha
**Fecha:** 2026-06-27
**Agente:** qa-verifier
**Outcome:** PASS (N/A justificado + verificacion indirecta completa)

---

## Motivo de N/A para curl

La operacion `liberarFecha()` es **infraestructura de dominio puro** (actor de UC-31 = Sistema).
Decision de diseno **D-7** (documentada en `design.md`): esta US **no expone endpoint HTTP propio**
y **no modifica `docs/api-spec.yml`**. La liberacion es un efecto interno disparado por flujos de
transicion de estado y el cron de barrido de TTL, nunca una accion directa de usuario o cliente
HTTP externo.

Por tanto, no existen endpoints GET/POST/PATCH/DELETE que probar con curl. Esta condicion esta
prevista en `tasks.md §7.1` ("verificar la liberacion indirectamente mediante tests de integracion
del repositorio").

---

## Verificacion indirecta: evidencia de los tests de integracion con BD real

Los tests en `src/reservas/__tests__/liberar-fecha-integracion.spec.ts` ejercitan la capa de
adaptador Prisma real (`FechaBloqueadaPrismaAdapter`) contra el PostgreSQL del docker-compose
(`slotify-postgres`, puerto 5432). Cada escenario verifica el comportamiento observable que
un endpoint hubiera expuesto.

### Caso 7.2: Happy path (bloquear-y-liberar, verificar 0 filas + auditoria)

Test cubridor: `liberarFecha() — dos liberaciones concurrentes (zona crítica)`
- Arrange: INSERT real de `fecha_bloqueada` para `(TENANT, 2026-09-12)` con `tipo=blando`, TTL expirado.
- Act: `servicio.ejecutar({ tenantId, fecha, causa: 'TTL' })`.
- Assert verificado en BD real:
  - `contarBloqueos(FECHA_DISPUTADA)` => `0` — la fila fue eliminada por el DELETE real.
  - `filasAfectadas` => `1` — el adapter devolvio rows-affected del DELETE.
  - `liberada` => `true`.
  - Seam de promocion disparado exactamente una vez (cola activa detectada via COUNT real).
- BD restaurada: `beforeEach` y `afterAll` ejecutan `DELETE WHERE tenantId=TENANT_ID`.
- Resultado: **PASS** (31 ms)

Test adicional: `liberarFecha() — no muta el estado de la RESERVA`
- Verifica que tras el DELETE real de `fecha_bloqueada`, el campo `estado`/`sub_estado` de la
  `reserva` permanece intacto (lectura Prisma real post-liberacion).
- Resultado: **PASS** (7 ms)

### Caso 7.3a: Idempotencia (liberar sin bloqueo activo = 0 filas, sin error)

Test cubridor: `liberarFecha() — idempotencia contra la BD real`
- Arrange: NO existe fila en `fecha_bloqueada` para `(TENANT, 2026-09-12)`.
- Act: `servicio.ejecutar(...)`.
- Assert:
  - Sin excepcion (idempotencia: DELETE de 0 filas = exito silencioso).
  - `out.liberada` => `false`.
  - `out.filasAfectadas` => `0`.
  - `PromocionColaPort.promoverPrimeroEnCola` NO invocado.
- Resultado: **PASS** (6 ms)

### Caso 7.3b: Guarda firme (liberar bloqueo firme de reserva activa = rechazo, fila intacta)

Test cubridor: `liberarFechasEnLote() — fallo aislado por fecha (D-9)` (sub-escenario LOTE_FIRME)
- Arrange: INSERT real de `fecha_bloqueada` con `tipo=firme` para reserva en `reserva_confirmada`.
- Act: lote con 3 fechas, la firme intercalada.
- Assert verificado en BD real:
  - `contarBloqueos(FECHA_LOTE_FIRME)` => `1` — la fila firme PERMANECE intacta.
  - El lote reporta esa fecha como `estado: 'fallida'`.
  - Las otras 2 fechas (blandas) se liberaron correctamente.
- Resultado: **PASS** (15 ms)

### Caso 7.3c: Race liberacion vs nuevo bloqueo (invariante de no-doble-bloqueo)

Test cubridor: `liberarFecha() — race liberación vs nuevo intento de bloqueo`
- Arrange: bloqueo blando de reservaA sobre fecha; reservaB intenta bloquear la misma fecha en paralelo.
- Act: `Promise.allSettled([liberarA, insertarB])`.
- Assert: `contarBloqueos(fecha) <= 1` — nunca coexisten 2 bloqueos para `(T, D)`.
- Resultado: **PASS** (54 ms)

### Caso 7.4: Restauracion de BD

Realizada automaticamente por `beforeEach` (limpia fechas bloqueadas y reservas TST-U041-*) y
`afterAll` (limpia todo incluyendo el cliente de test). Verificado en step 6.4: 0 filas residuales
en todas las tablas afectadas.

---

## Resumen de cobertura indirecta

| Escenario curl equivalente | Test de integracion | Resultado |
|---|---|---|
| DELETE real de fecha_bloqueada (1 fila) | concurrencia zona critica | PASS |
| DELETE real 0 filas (idempotencia) | idempotencia BD real | PASS |
| Guarda firme: rechazo + fila intacta | lote con fallo aislado (LOTE_FIRME) | PASS |
| Race liberacion vs nuevo bloqueo | race liberacion vs bloqueo | PASS |
| No mutacion de la RESERVA | no muta estado RESERVA | PASS |
| Restauracion BD a baseline | afterAll/beforeEach hooks | PASS |

---

## Outcome

**PASS (N/A justificado)** — No hay endpoint HTTP que probar con curl (decision D-7).
La verificacion indirecta via tests de integracion con BD real cubre todos los escenarios
obligatorios del step 7: happy path, idempotencia 0 filas, guarda firme con fila intacta, race
condition, restauracion de BD.

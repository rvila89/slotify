---
name: concurrency-locking
description: Usar cuando se escriban o revisen tests de concurrencia del bloqueo atómico de fecha (doble reserva, cola, encadenamiento) sobre el agregado Reserva.
---
# Tests de concurrencia del bloqueo atómico

## Cuándo usar
- Al testar el bloqueo atómico de fecha (es lo PRIMERO en el orden TDD, antes de CRUD/UI).
- Al cubrir escenarios concurrentes: doble reserva, promoción de cola concurrente, encadenamiento, salida concurrente de cola.
- Al verificar que dos operaciones simultáneas sobre la misma fecha resuelven en 1 OK + 1 rechazo.

## Reglas / Pasos
1. El bloqueo usa **`UNIQUE(tenant_id, fecha)` + `SELECT ... FOR UPDATE`** dentro de `$transaction`, vía `bloquearFecha()` / `liberarFecha()`. **NUNCA Redis ni locks distribuidos.**
2. Simula simultaneidad con **`Promise.allSettled()`**: lanza N operaciones a la vez sobre la misma fecha.
3. Espera exactamente **1 `fulfilled` + 1 `rejected`** para dos bloqueos concurrentes.
4. La violación de la restricción única (Prisma **P2002**) se traduce a **HTTP 409 Conflict**.
5. Escenarios a cubrir:
   - Doble reserva misma fecha → 1 confirmada, 1 rechazada (409).
   - Promoción de cola concurrente → una sola gana la fecha liberada.
   - Encadenamiento (liberar + bloquear) → sin huecos ni dobles.
   - Salida concurrente de cola → idempotente, sin estados inconsistentes.

## Patrón de referencia
```ts
it('debe_aceptar_una_y_rechazar_otra_cuando_dos_bloqueos_misma_fecha', async () => {
  const intentos = [
    service.bloquearFecha(tenantId, fecha),
    service.bloquearFecha(tenantId, fecha),
  ];
  const res = await Promise.allSettled(intentos);
  const ok = res.filter(r => r.status === 'fulfilled');
  const ko = res.filter(r => r.status === 'rejected');
  expect(ok).toHaveLength(1);
  expect(ko).toHaveLength(1);
  expect((ko[0] as any).reason.status).toBe(409); // P2002 -> 409
});
```

## Errores comunes
- Implementar el bloqueo con Redis/Redlock o un lock en memoria.
- Esperar 2 fulfilled (ignora que la fecha es única por tenant).
- Ejecutar las operaciones en serie (`await` una tras otra) en vez de `Promise.allSettled`.
- No mapear P2002 → 409 y dejar escapar un 500.
- Bloquear/liberar fuera de `bloquearFecha()`/`liberarFecha()`.

## Fuentes
- `docs/backend-standards.md`
- `CLAUDE.md` (Regla crítica: bloqueo atómico de fecha)

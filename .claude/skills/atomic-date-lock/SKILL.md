---
name: atomic-date-lock
description: Usar cuando se implemente o modifique cualquier lógica de bloqueo/liberación de fecha de reserva, para garantizar atomicidad y evitar doble reserva.
---

# Bloqueo atómico de fecha (regla crítica)

## Cuándo usar
Al tocar reservas que ocupan una fecha: confirmar reserva, liberar fecha, promover cola, o cualquier mutación que afecte la disponibilidad de un día.

## Reglas
- NO uses Redis ni locks distribuidos. NUNCA.
- Mecanismo único: entidad `FechaBloqueada` con `@@unique([tenant_id, fecha])` + transacción con `SELECT ... FOR UPDATE` vía Prisma `$queryRaw` dentro de `$transaction`.
- Toda mutación pasa SOLO por dos funciones de dominio: `bloquearFecha()` y `liberarFecha()`. No implementes el bloqueo de otra forma ni en otro sitio.
- Ambas funciones sincronizan la fila `FechaBloqueada` Y el estado de `Reserva` en la MISMA transacción.
- Violación de unicidad Prisma `P2002` → traducir a HTTP **409** (doble reserva evitada). NUNCA dejar que escale a 500.
- TDD: los tests de concurrencia se escriben PRIMERO, antes de CRUD/UI. Simular concurrencia con `Promise.allSettled()` (resultado esperado: 1 fulfilled + 1 rejected).

## Patrón de referencia
```ts
async bloquearFecha(tenantId: string, fecha: Date, reservaId: string) {
  return this.prisma.$transaction(async (tx) => {
    await tx.$queryRaw`SELECT id FROM fecha_bloqueada
      WHERE tenant_id = ${tenantId} AND fecha = ${fecha} FOR UPDATE`;
    try {
      await tx.fechaBloqueada.create({ data: { tenantId, fecha, reservaId } });
    } catch (e) {
      if (e.code === 'P2002') throw new ConflictException('Fecha ya reservada');
      throw e;
    }
    await tx.reserva.update({ where: { id: reservaId }, data: { estado: 'reserva_confirmada' } });
  });
}
```

## Errores comunes / Anti-patrones
- Comprobar disponibilidad con un `findFirst` previo fuera de la transacción (race condition).
- Crear la fila `FechaBloqueada` sin actualizar el estado de la `Reserva` en la misma tx.
- Devolver 500 ante `P2002`.
- Lógica de bloqueo duplicada en controladores o casos de uso ajenos a `bloquearFecha`/`liberarFecha`.

## Fuentes
- docs/architecture.md §2.4
- CLAUDE.md

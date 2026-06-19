---
name: async-jobs
description: Usar cuando se implemente trabajo asíncrono o diferido (expiraciones, recordatorios, promoción de cola), para seguir el patrón estado en fila + barrido periódico.
---

# Jobs asíncronos (estado en fila + barrido)

## Cuándo usar
Al implementar expiración de pre-reservas, liberación de fechas vencidas, promoción de cola o disparo de recordatorios diferidos.

## Reglas
- Patrón único: estado en fila + barrido periódico. NO uses Lambda/EventBridge ni timers exactos.
- Cada fila lleva un campo `ttl_expiracion`; el trabajo pendiente es estado en la BBDD, no un timer en memoria.
- Un cron (`@nestjs/schedule`) invoca el endpoint protegido `POST /api/cron/barrido`, autenticado con token `X-Cron-Token`.
- El barrido es IDEMPOTENTE: re-ejecutarlo no produce efectos duplicados.
- El barrido: expira filas vencidas (`ttl_expiracion < now`), libera fechas (vía `liberarFecha()`), promueve la cola y dispara recordatorios.
- La liberación de fecha dentro del barrido pasa por las funciones de dominio del bloqueo atómico, no por SQL ad-hoc.

## Patrón de referencia
```ts
@Cron('*/5 * * * *')
async lanzarBarrido() { /* llama a POST /api/cron/barrido con X-Cron-Token */ }

@Post('cron/barrido')
async barrido(@Headers('x-cron-token') token: string) {
  if (token !== this.cronToken) throw new UnauthorizedException();
  const vencidas = await this.repo.buscarVencidas(); // ttl_expiracion < now
  for (const r of vencidas) { await this.liberarFecha(r); } // idempotente
}
```

## Errores comunes / Anti-patrones
- `setTimeout`/timers exactos para expirar reservas.
- Endpoint de barrido sin verificar `X-Cron-Token`.
- Barrido no idempotente (doble liberación o doble recordatorio si corre dos veces).
- Liberar la fecha con SQL directo en vez de `liberarFecha()`.

## Fuentes
- docs/architecture.md §2.5
- CLAUDE.md

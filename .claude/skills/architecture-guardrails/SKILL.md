---
name: architecture-guardrails
description: Usar cuando se escriba o revise código backend para garantizar las reglas duras de arquitectura de Slotify que NUNCA se violan.
---
# Guardarraíles de arquitectura

## Cuándo usar
- Al implementar o revisar cualquier código backend.
- Lo usan el `code-reviewer` y los hooks como reglas innegociables.

## Reglas / Pasos
Reglas duras que **NUNCA** se violan:
1. **Hexagonal**: `domain/` no importa `@nestjs/*`, ni `@prisma/*`, ni nada de `infrastructure/`. Los puertos viven en dominio; los adaptadores en infraestructura.
2. **Bloqueo de fecha**: solo `UNIQUE(tenant_id, fecha)` + `SELECT ... FOR UPDATE` vía `bloquearFecha()` / `liberarFecha()`. **Prohibido Redis, Redlock o cualquier lock distribuido.**
3. **Multi-tenancy**: `tenant_id` siempre desde el **JWT**; **RLS** activo; toda tabla de negocio lleva `tenant_id`.
4. **Jobs asíncronos**: patrón estado en fila (`ttl_expiracion`) + barrido periódico idempotente vía endpoint protegido. **No Lambda/EventBridge ni timers exactos.**
5. **Cliente HTTP del frontend**: generado desde el contrato OpenAPI, **no se edita a mano**.
6. **Importes** siempre en `Decimal`, nunca `Float`.

## Patrón de referencia
```ts
// ❌ PROHIBIDO en domain/
import { PrismaService } from '../infrastructure/prisma.service';
import Redis from 'ioredis';

// ✅ domain/ depende de un puerto (interfaz)
export interface ReservaRepository {
  bloquearFecha(tenantId: string, fecha: Date): Promise<void>;
  liberarFecha(tenantId: string, fecha: Date): Promise<void>;
}
```

## Errores comunes
- Importar Prisma o NestJS dentro de `domain/`.
- Introducir Redis/Redlock o un lock en memoria para el bloqueo de fecha.
- Tomar el `tenant_id` del path/body en vez del JWT.
- Usar Lambda/EventBridge o timers exactos para los jobs.
- Editar a mano el cliente HTTP generado.
- Modelar importes con `Float`/`number`.

## Fuentes
- `CLAUDE.md` (Arquitectura, Regla crítica, Multi-tenancy, Jobs asíncronos)
- `docs/architecture.md`

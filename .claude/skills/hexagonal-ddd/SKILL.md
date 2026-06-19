---
name: hexagonal-ddd
description: Usar cuando se cree o modifique código de un módulo de dominio del backend (apps/api), para respetar las 4 capas hexagonales y las reglas DDD.
---

# Arquitectura Hexagonal + DDD (backend)

## Cuándo usar
Al crear o tocar cualquier módulo de `apps/api` (auth, reservas, calendario, clientes, presupuestos, facturacion, comunicaciones, ficha-operativa, dashboards, configuracion, cron).

## Reglas
- 4 capas por módulo: `domain/` (entidades, value objects, eventos, PUERTOS/interfaces), `application/` (casos de uso, 1 UC ≈ 1 caso de uso), `infrastructure/` (adaptadores: repos Prisma, email, PDF, storage), `interface/` (controladores HTTP + DTOs + Swagger).
- REGLA DURA: `domain/` NO importa NestJS, Prisma ni nada de infraestructura. Solo depende de sus propios puertos.
- Inyección de dependencias por tokens (Symbol): `@Inject(RESERVA_REPOSITORY)`. El dominio define la interfaz; infraestructura la implementa.
- Agregado raíz: `Reserva`. Transiciones, bloqueo y cola orbitan alrededor de ella.
- Dominio en español: `Reserva`, `bloquearFecha`, `fecha_evento`.
- Clases PascalCase; funciones camelCase con verbo en español; ficheros kebab-case con sufijo de rol (`reserva.entity.ts`, `bloquear-fecha.use-case.ts`).
- Modelos Prisma PascalCase español con `@@map` a snake_case. Importes en `Decimal`, nunca `Float`. Comentarios y errores en español.

## Patrón de referencia
```
src/reservas/
  domain/        reserva.entity.ts, reserva.repository.ts (puerto), reserva-confirmada.event.ts
  application/   bloquear-fecha.use-case.ts
  infrastructure/ reserva.prisma.repository.ts (implementa el puerto)
  interface/     reservas.controller.ts, crear-reserva.dto.ts
```
```ts
// domain/reserva.repository.ts
export const RESERVA_REPOSITORY = Symbol('RESERVA_REPOSITORY');
export interface ReservaRepository { guardar(r: Reserva): Promise<void>; }
```

## Errores comunes / Anti-patrones
- Importar `PrismaService` o decoradores `@nestjs/*` dentro de `domain/`.
- Lógica de negocio en el controlador o en el repositorio en vez de en la entidad/UC.
- Casos de uso "gordos" que cubren varios casos a la vez.
- Usar `Float` para dinero; nombres en inglés en el dominio.

## Fuentes
- docs/backend-standards.md
- docs/architecture.md

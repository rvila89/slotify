/**
 * DTO HTTP de la extensión manual del TTL: `POST /reservas/{id}/extender-bloqueo`
 * (US-006). Nombre camelCase ALINEADO con el contrato OpenAPI congelado
 * (`ExtenderBloqueoRequest`; respuesta 200 = `Reserva`). El cuerpo lleva `dias`
 * (entero ≥ 1).
 *
 * VALIDACIÓN DE `dias` → **422** (D-3 + contrato congelado): la valida el DOMINIO
 * (`ExtenderBloqueoUseCase.validarDias` → `ExtenderBloqueoValidacionError`, que el
 * controlador mapea a 422), NO `class-validator`. Motivo: el `ValidationPipe` GLOBAL
 * (`main.ts`) se ejecuta ANTES que cualquier pipe local de parámetro y, si el DTO
 * llevara `@IsInt`/`@Min`, rechazaría con su HTTP por defecto (**400**) — divergente del
 * contrato — sin que un pipe local con `errorHttpStatusCode: 422` llegara a actuar (los
 * pipes COMPONEN, no se sustituyen). Por eso el DTO NO lleva decoradores de
 * `class-validator` para `dias`: deja pasar el pipe global y delega el rechazo (0,
 * negativo, no entero, tipo erróneo) en la guarda defensiva del dominio, que devuelve
 * 422 con el mensaje exacto del contrato. `@Type(() => Number)` intenta coaccionar el
 * tipo en el happy path; un valor no numérico llega sin coaccionar y el dominio lo
 * rechaza (`Number.isInteger` → false → 422).
 */
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { Allow } from 'class-validator';

/** Cuerpo de la petición: número entero de días a añadir al TTL actual (≥ 1). */
export class ExtenderBloqueoRequestDto {
  @ApiProperty({
    type: Number,
    minimum: 1,
    example: 7,
    description:
      'Número ENTERO de días a añadir al ttlExpiracion ACTUAL del bloqueo blando (≥ 1). ' +
      'Validación a 422 en el dominio (no class-validator); ver DTO.',
  })
  // `@Allow()` SOLO incluye `dias` en el whitelist del `ValidationPipe` global
  // (`whitelist + forbidNonWhitelisted`) para que NO lo elimine ni lo rechace con 400;
  // NO aplica ninguna regla (no es `@IsInt`/`@Min`). El rango/tipo lo valida el dominio
  // (→ 422). `@Type(() => Number)` coacciona el tipo en el happy path.
  @Allow()
  @Type(() => Number)
  dias!: number;
}

/**
 * DTO HTTP de la acción `POST /reservas/{id}/cambiar-fecha` (US-051 §Punto 2 / §D-2.1).
 * Nombres camelCase ALINEADOS con el contrato OpenAPI congelado (`CambiarFechaRequest`).
 *
 * A diferencia de `AsignarFechaRequest`, NO lleva `aceptarCola`: si la fecha nueva está
 * ocupada el sistema RECHAZA con 409 (no ofrece cola para la nueva). `fechaEvento` es
 * obligatoria (`YYYY-MM-DD`) y estrictamente futura (`> hoy`); la regla `> hoy` la valida
 * el use-case (server, 422). `tenant_id`/`usuario_id` viajan SIEMPRE en el JWT.
 */
import { ApiProperty } from '@nestjs/swagger';
import { IsDateString } from 'class-validator';

export class CambiarFechaRequestDto {
  @ApiProperty({
    format: 'date',
    description:
      'Nueva fecha del evento (YYYY-MM-DD). Debe ser estrictamente futura (> hoy).',
  })
  @IsDateString()
  fechaEvento!: string;
}

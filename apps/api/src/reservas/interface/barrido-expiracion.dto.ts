/**
 * DTO de respuesta del barrido de expiración por TTL (US-012 / UC-09, §D-2).
 *
 * Shape EXACTA del contrato OpenAPI `BarridoExpiracionResponse`
 * (`{ candidatas, expiradas, promocionesDisparadas, fallos }`): recuentos agregados de
 * un proceso de Sistema; no expone datos de negocio sensibles ni identificadores de
 * RESERVA.
 */
import { ApiProperty } from '@nestjs/swagger';

export class BarridoExpiracionResponseDto {
  @ApiProperty({
    description:
      'Nº de RESERVA seleccionadas como candidatas (ttl_expiracion < now() AND estados candidatos), cross-tenant.',
    minimum: 0,
    example: 5,
  })
  candidatas!: number;

  @ApiProperty({
    description:
      'Nº de candidatas efectivamente expiradas (transición + fecha liberada) en esta ejecución.',
    minimum: 0,
    example: 4,
  })
  expiradas!: number;

  @ApiProperty({
    description:
      'Nº de veces que se disparó el seam de promoción de cola (US-018), una por expiración con cola activa.',
    minimum: 0,
    example: 1,
  })
  promocionesDisparadas!: number;

  @ApiProperty({
    description:
      'Nº de candidatas cuya expiración falló de forma aislada (rollback de su propia transacción).',
    minimum: 0,
    example: 0,
  })
  fallos!: number;
}

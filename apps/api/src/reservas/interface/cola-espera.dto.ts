/**
 * DTO HTTP de respuesta de `GET /reservas/{id}/cola` (vista de cola de espera
 * US-017 / UC-11). Nombres camelCase ALINEADOS con el contrato OpenAPI
 * `ColaEsperaResponse` / `ColaBloqueante` / `ColaItem`. Solo de salida: sin
 * `class-validator`.
 *
 * Los instantes crudos (`ttlExpiracion`, `fechaCreacion`) viajan como `date-time`
 * en string ISO; los derivados legibles (`ttlRestante`, `tiempoEnCola`) los calcula
 * el backend sobre instantes. `visitaProgramadaFecha` como `date`.
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ColaBloqueanteDto {
  @ApiProperty({ format: 'uuid' })
  idReserva!: string;

  @ApiProperty({ example: 'SLO-2026-0007' })
  codigo!: string;

  @ApiProperty()
  clienteNombre!: string;

  @ApiProperty({ enum: ['2b', '2c', '2v'] })
  subEstado!: string;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  ttlExpiracion!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: '22 h' })
  ttlRestante!: string | null;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  visitaProgramadaFecha!: string | null;
}

export class ColaItemDto {
  @ApiProperty({ format: 'uuid' })
  idReserva!: string;

  @ApiProperty({ example: 'SLO-2026-0008' })
  codigo!: string;

  @ApiProperty()
  clienteNombre!: string;

  @ApiProperty({ minimum: 1, example: 1 })
  posicionCola!: number;

  @ApiProperty({ format: 'date-time' })
  fechaCreacion!: string;

  @ApiPropertyOptional({ type: String, nullable: true, example: '2 h' })
  tiempoEnCola!: string | null;
}

export class ColaEsperaResponseDto {
  @ApiProperty()
  estaBloqueada!: boolean;

  @ApiPropertyOptional({ type: ColaBloqueanteDto, nullable: true })
  bloqueante!: ColaBloqueanteDto | null;

  @ApiProperty({ type: [ColaItemDto] })
  cola!: ColaItemDto[];
}

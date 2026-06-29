/**
 * DTOs HTTP de la transición «añadir fecha»: `POST /reservas/{id}/fecha` (US-005).
 * Nombres camelCase ALINEADOS con el contrato OpenAPI (`AsignarFechaRequest`,
 * `Reserva`, `AsignarFechaConflictoError`). La validación `class-validator` reproduce
 * el contrato: `fechaEvento` obligatoria (date), `aceptarCola` opcional booleana.
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsDateString, IsOptional } from 'class-validator';

export class AsignarFechaRequestDto {
  @ApiProperty({
    format: 'date',
    description:
      'OBLIGATORIO. Fecha del evento (YYYY-MM-DD). Debe ser estrictamente futura (> hoy).',
  })
  @IsDateString()
  fechaEvento!: string;

  @ApiPropertyOptional({
    type: Boolean,
    description:
      'OPCIONAL. Confirma la entrada en cola (2.d) cuando la fecha está bloqueada por una consulta en 2.b.',
  })
  @IsOptional()
  @IsBoolean()
  aceptarCola?: boolean;
}

/**
 * Respuesta de la transición (`POST /reservas/{id}/fecha`). Alineada con `Reserva`
 * del contrato: la RESERVA actualizada en su sub-estado destino (`2b` o `2d`).
 */
export class AsignarFechaResponseDto {
  @ApiProperty({ format: 'uuid' })
  idReserva!: string;

  @ApiProperty({ format: 'uuid' })
  clienteId!: string;

  @ApiProperty({ enum: ['consulta'] })
  estado!: string;

  @ApiProperty({ enum: ['2b', '2d'], nullable: true })
  subEstado!: string | null;

  @ApiProperty({ type: String, format: 'date', nullable: true })
  fechaEvento!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  ttlExpiracion!: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  posicionCola?: number | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  consultaBloqueanteId?: string | null;
}

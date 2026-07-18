/**
 * DTO HTTP de la acción `PATCH /reservas/{id}` (US-051 §Punto 2 / UC-14). Nombres
 * camelCase ALINEADOS con el contrato OpenAPI congelado (`UpdateReservaRequest`).
 *
 * El cuerpo lleva los campos SIMPLES editables de la RESERVA, TODOS opcionales (PATCH
 * parcial, §D-1): solo los presentes se persisten; los ausentes no se tocan.
 * `fechaEvento` NO forma parte del contrato de este PATCH (regla dura §D-1): la fecha se
 * cambia SOLO por el flujo atómico (`POST /reservas/{id}/fecha` o
 * `POST /reservas/{id}/cambiar-fecha`). `tenant_id`/`usuario_id` viajan SIEMPRE en el JWT.
 *
 * Validación (contrato): enums de `tipoEvento`/`duracionHoras`, `horario` `HH:mm`; la
 * regla cruzada de `horario` (requiere `duracionHoras`) se valida en el use-case (server).
 * `additionalProperties: false` (campos ajenos → 400) lo aplica el `ValidationPipe` global.
 */
import { ApiPropertyOptional } from '@nestjs/swagger';
import { IsIn, IsInt, IsOptional, IsString, Matches } from 'class-validator';

const TIPOS_EVENTO = ['boda', 'corporativo', 'privado', 'otro', 'cumpleanos'] as const;
const DURACIONES = [4, 8, 12] as const;
/** Patrón `HH:mm` (00-23 : 00-59), espejo del contrato `^\d{2}:\d{2}$`. */
const HORARIO_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export class ActualizarReservaRequestDto {
  @ApiPropertyOptional({ enum: TIPOS_EVENTO })
  @IsOptional()
  @IsIn(TIPOS_EVENTO)
  tipoEvento?: (typeof TIPOS_EVENTO)[number];

  @ApiPropertyOptional({ enum: DURACIONES })
  @IsOptional()
  @IsIn(DURACIONES)
  duracionHoras?: (typeof DURACIONES)[number];

  @ApiPropertyOptional({ type: Number })
  @IsOptional()
  @IsInt()
  numAdultosNinosMayores4?: number;

  @ApiPropertyOptional({ type: Number })
  @IsOptional()
  @IsInt()
  numNinosMenores4?: number;

  @ApiPropertyOptional({ type: Number })
  @IsOptional()
  @IsInt()
  numInvitadosFinal?: number;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  notas?: string;

  @ApiPropertyOptional({
    type: String,
    pattern: '^\\d{2}:\\d{2}$',
    example: '11:00',
    description:
      'Hora de inicio (HH:mm). Solo válido si la reserva tiene duracionHoras (o entra en el mismo PATCH).',
  })
  @IsOptional()
  @IsString()
  @Matches(HORARIO_PATTERN, {
    message: 'horario debe tener el formato HH:mm (00:00–23:59)',
  })
  horario?: string;
}

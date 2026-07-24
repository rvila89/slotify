/**
 * DTOs HTTP de la acción manual de comunicaciones de una RESERVA (US-046 / UC-36).
 * Nombres camelCase ALINEADOS con el contrato OpenAPI congelado (`Comunicacion`,
 * `ComunicacionListItem`, `EnviarBorradorRequest`, `CrearEmailManualRequest`,
 * `EstadoComunicacion`).
 *
 * El gestor edita SOLO `asunto`/`cuerpo`; `codigoEmail` y `destinatarioEmail` NO. El
 * `tenant_id` NUNCA viaja en el body/path (deriva del JWT). Las respuestas son de solo
 * salida (sin `class-validator`).
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, MinLength } from 'class-validator';
import type { CodigoEmail, EstadoComunicacion } from '../domain/codigo-email';
import type { SubtipoEmail } from '../domain/subtipo-email';

/** Body OPCIONAL del envío del borrador: sólo `asunto`/`cuerpo` editables. */
export class EnviarBorradorRequestDto {
  @ApiPropertyOptional({
    type: String,
    minLength: 1,
    description:
      'Asunto editado por el gestor. Si se omite, se envía el asunto original del borrador.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  asunto?: string;

  @ApiPropertyOptional({
    type: String,
    minLength: 1,
    description:
      'Cuerpo editado por el gestor. Si se omite, se envía el cuerpo original del borrador.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  cuerpo?: string;
}

/** Body OBLIGATORIO del email manual: `asunto` y `cuerpo` redactados por el gestor. */
export class CrearEmailManualRequestDto {
  @ApiProperty({ type: String, minLength: 1 })
  @IsString()
  @MinLength(1)
  asunto!: string;

  @ApiProperty({ type: String, minLength: 1 })
  @IsString()
  @MinLength(1)
  cuerpo!: string;
}

/** Respuesta: proyección de una `COMUNICACION` (solo salida). */
export class ComunicacionResponseDto {
  @ApiProperty({ type: String, format: 'uuid' })
  idComunicacion!: string;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  reservaId!: string | null;

  @ApiProperty({ type: String, format: 'uuid' })
  clienteId!: string;

  @ApiProperty({ enum: ['E1', 'E2', 'E3', 'E4', 'E5', 'E6', 'E7', 'E8', 'manual'] })
  codigoEmail!: CodigoEmail;

  @ApiProperty({ type: String })
  asunto!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  cuerpo!: string | null;

  @ApiPropertyOptional({ type: String, format: 'email', nullable: true })
  destinatarioEmail!: string | null;

  @ApiProperty({ enum: ['borrador', 'enviado', 'fallido'] })
  estado!: EstadoComunicacion;

  @ApiPropertyOptional({
    enum: [
      'consulta_exploratoria',
      'fecha_disponible',
      'fecha_confirmada',
      'cola_espera',
      'cambio_fecha',
      'solicitud_datos',
    ],
    nullable: true,
    required: false,
    description:
      'Subtipo semántico del E1 (historial-completo-comunicaciones §D-subtipo). `null` para E2–E8, `manual` y filas legadas.',
  })
  subtipo?: SubtipoEmail | null;

  @ApiProperty({ type: Boolean })
  esReenvio!: boolean;

  @ApiProperty({ type: String, format: 'date-time' })
  fechaCreacion!: Date;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  fechaEnvio!: Date | null;
}

/** Respuesta del listado de la ficha: `Comunicacion` + flag derivado `accionable`. */
export class ComunicacionListItemResponseDto extends ComunicacionResponseDto {
  @ApiProperty({
    type: Boolean,
    description:
      "Derivado: `true` sii `estado='borrador'` (la fila puede enviarse/descartarse).",
  })
  accionable!: boolean;
}

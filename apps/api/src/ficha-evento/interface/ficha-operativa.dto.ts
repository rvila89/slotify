/**
 * DTOs HTTP de la FICHA_OPERATIVA (US-025 / UC-20). Nombres camelCase ALINEADOS con el
 * contrato OpenAPI congelado (`FichaOperativa`, `GuardarFichaOperativaRequest`,
 * `CerrarFichaOperativaResponse`). Fechas `date-time` en string ISO. El guardado es
 * PARCIAL: todos los campos son opcionales (`class-validator` valida el formato → 400;
 * las guardas de negocio viven en el use-case → 409/404).
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsInt, IsOptional, IsString, ValidateIf } from 'class-validator';

/** Salta la validación de tipo cuando el valor es `null` (borrado explícito). */
const salvoNull = (_: object, valor: unknown): boolean => valor !== null;

/** Valores del enum `PreEventoStatus` del contrato OpenAPI congelado. */
export const PRE_EVENTO_STATUS = ['pendiente', 'en_curso', 'cerrado'] as const;

/** Respuesta 200 de `GET`/`PATCH` (`FichaOperativa` del contrato). */
export class FichaOperativaResponseDto {
  @ApiProperty({ format: 'uuid' })
  idFicha!: string;

  @ApiProperty({ format: 'uuid' })
  reservaId!: string;

  @ApiPropertyOptional({ type: Number, nullable: true })
  numInvitadosConfirmado!: number | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  contactoEventoNombre!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  contactoEventoTelefono!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  contactoEventoCorreo!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  horaLlegada!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  duracion!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  notasOperativas!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  briefingEquipo!: string | null;

  @ApiProperty()
  fichaCerrada!: boolean;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  fechaCierre!: string | null;

  @ApiProperty({ enum: PRE_EVENTO_STATUS })
  preEventoStatus!: (typeof PRE_EVENTO_STATUS)[number];
}

/** Respuesta 200 del cierre (`CerrarFichaOperativaResponse`: ficha + avisos). */
export class CerrarFichaOperativaResponseDto extends FichaOperativaResponseDto {
  @ApiProperty({
    type: [String],
    description:
      'Nombres (camelCase) de los campos de contenido vacíos al cerrar (aviso informativo, no error). Vacío si estaban todos rellenos.',
    example: ['duracion', 'briefingEquipo'],
  })
  avisosCamposVacios!: string[];
}

/**
 * Cuerpo de `PATCH /reservas/{id}/ficha-operativa`: guardado PARCIAL
 * (`GuardarFichaOperativaRequest`). Todos los campos son opcionales; solo se persiste
 * el subconjunto presente. `numInvitadosConfirmado` admite `null` (borrar el valor).
 */
export class GuardarFichaOperativaRequestDto {
  @ApiPropertyOptional({ type: Number, nullable: true })
  @IsOptional()
  @ValidateIf(salvoNull)
  @IsInt()
  numInvitadosConfirmado?: number | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @ValidateIf(salvoNull)
  @IsString()
  contactoEventoNombre?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @ValidateIf(salvoNull)
  @IsString()
  contactoEventoTelefono?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @ValidateIf(salvoNull)
  @IsString()
  contactoEventoCorreo?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @ValidateIf(salvoNull)
  @IsString()
  horaLlegada?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @ValidateIf(salvoNull)
  @IsString()
  duracion?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @ValidateIf(salvoNull)
  @IsString()
  notasOperativas?: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @ValidateIf(salvoNull)
  @IsString()
  briefingEquipo?: string | null;
}

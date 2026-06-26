/**
 * DTOs HTTP del motor de tarifa (US-016). Nombres snake_case alineados con el
 * contrato OpenAPI congelado (`docs/api-spec.yml`, esquema canónico D-1). El
 * controlador traduce snake_case (contrato) ↔ camelCase (dominio).
 */
import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  ArrayMinSize,
  IsArray,
  IsDateString,
  IsIn,
  IsInt,
  IsString,
  Min,
  ValidateNested,
} from 'class-validator';

export class CalculoTarifaExtraInputDto {
  @ApiProperty({ format: 'uuid', description: 'ID del EXTRA del catálogo del tenant.' })
  @IsString()
  extra_id!: string;

  @ApiProperty({ minimum: 1, description: 'Unidades del extra (>= 1).' })
  @IsInt()
  @Min(1)
  cantidad!: number;
}

export class CalculoTarifaRequestDto {
  @ApiProperty({ format: 'date', description: 'Fecha del evento (YYYY-MM-DD). No nula, no pasada.' })
  @IsDateString()
  fecha_evento!: string;

  @ApiProperty({ enum: [4, 8, 12] })
  @IsIn([4, 8, 12])
  duracion_horas!: number;

  @ApiProperty({ minimum: 0, description: 'Adultos + niños mayores de 4 años.' })
  @IsInt()
  @Min(0)
  num_adultos_ninos_mayores4!: number;

  @ApiProperty({ type: [CalculoTarifaExtraInputDto], default: [] })
  @IsArray()
  @ArrayMinSize(0)
  @ValidateNested({ each: true })
  @Type(() => CalculoTarifaExtraInputDto)
  extras: CalculoTarifaExtraInputDto[] = [];
}

export class CalculoTarifaResponseDto {
  @ApiProperty({ enum: ['alta', 'media', 'baja'] })
  temporada!: 'alta' | 'media' | 'baja';

  @ApiProperty()
  tarifa_a_consultar!: boolean;

  @ApiProperty({ type: Number, nullable: true })
  precio_tarifa_eur!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  extras_total_eur!: number | null;

  @ApiProperty({ type: Number, nullable: true })
  total_eur!: number | null;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  tarifa_id!: string | null;
}

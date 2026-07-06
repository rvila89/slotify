/**
 * DTOs HTTP del pipeline de reservas activas: `GET /reservas` (US-049 / UC-37 / UC-38).
 * Nombres camelCase ALINEADOS con el contrato OpenAPI congelado (`ReservaListResponse`,
 * `Reserva` con `nombreEvento`/`progressLogistica`/`progressLiquidacion`,
 * `PaginationMetadata`; query `page`/`limit`/`estado`/`subEstado`/`fechaDesde`/
 * `fechaHasta`/`search`).
 *
 * El `tenant_id` NO viaja en el query: deriva SIEMPRE del JWT (`@CurrentUser`) en el
 * controlador. Estos `class-validator` validan SOLO la forma de la paginación y los
 * filtros (400); el aislamiento por tenant y la exclusión de terminales los garantizan
 * el use-case y su adaptador. Los enteros de paginación llegan como string en el query:
 * `@Type(() => Number)` los transforma (el `ValidationPipe` global tiene `transform`).
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import type {
  EstadoReserva,
  SubEstadoConsulta,
} from '../domain/maquina-estados';

/** Estados principales aceptados como filtro (contrato `EstadoReserva`). */
const ESTADOS: ReadonlyArray<EstadoReserva> = [
  'consulta',
  'pre_reserva',
  'reserva_confirmada',
  'evento_en_curso',
  'post_evento',
  'reserva_completada',
  'reserva_cancelada',
];

/** Sub-estados de consulta aceptados como filtro (contrato `SubEstadoConsulta`). */
const SUB_ESTADOS: ReadonlyArray<SubEstadoConsulta> = [
  '2a',
  '2b',
  '2c',
  '2d',
  '2v',
  '2x',
  '2y',
  '2z',
];

/** Query params del listado del pipeline. */
export class ListarReservasQueryDto {
  @ApiPropertyOptional({ type: Number, minimum: 1, default: 1, example: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'El parámetro «page» debe ser un entero' })
  @Min(1, { message: 'El parámetro «page» debe ser >= 1' })
  page?: number;

  @ApiPropertyOptional({
    type: Number,
    minimum: 1,
    maximum: 100,
    default: 20,
    example: 20,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt({ message: 'El parámetro «limit» debe ser un entero' })
  @Min(1, { message: 'El parámetro «limit» debe estar entre 1 y 100' })
  @Max(100, { message: 'El parámetro «limit» debe estar entre 1 y 100' })
  limit?: number;

  @ApiPropertyOptional({ type: String, enum: ESTADOS, example: 'pre_reserva' })
  @IsOptional()
  @IsIn(ESTADOS, { message: 'El filtro «estado» no es un estado válido' })
  estado?: EstadoReserva;

  @ApiPropertyOptional({ type: String, enum: SUB_ESTADOS, example: '2b' })
  @IsOptional()
  @IsIn(SUB_ESTADOS, { message: 'El filtro «subEstado» no es un sub-estado válido' })
  subEstado?: SubEstadoConsulta;

  @ApiPropertyOptional({ type: String, format: 'date', example: '2026-06-01' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'El parámetro «fechaDesde» debe tener el formato YYYY-MM-DD',
  })
  fechaDesde?: string;

  @ApiPropertyOptional({ type: String, format: 'date', example: '2026-12-31' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'El parámetro «fechaHasta» debe tener el formato YYYY-MM-DD',
  })
  fechaHasta?: string;

  @ApiPropertyOptional({
    type: String,
    description: 'Búsqueda por código, nombre de cliente o notas',
  })
  @IsOptional()
  @IsString()
  search?: string;
}

/** Elemento del listado del pipeline (contrato `Reserva` con derivados). */
export class ReservaPipelineItemDto {
  @ApiProperty({ type: String, format: 'uuid' })
  id!: string;

  @ApiProperty({ type: String, example: 'SLO-2026-0001' })
  codigo!: string;

  @ApiProperty({ type: String, example: 'pre_reserva' })
  estado!: EstadoReserva;

  @ApiProperty({ type: String, nullable: true, example: '2b' })
  subEstado!: SubEstadoConsulta | null;

  @ApiProperty({ type: String, format: 'date-time' })
  fechaCreacion!: string;

  @ApiProperty({ type: String, example: 'Ana García López' })
  nombreEvento!: string;

  @ApiProperty({ type: Number, minimum: 0, maximum: 100, example: 50 })
  progressLogistica!: number;

  @ApiProperty({ type: Number, minimum: 0, maximum: 100, example: 0 })
  progressLiquidacion!: number;
}

/** Metadatos de paginación (contrato `PaginationMetadata`). */
export class PaginationMetadataDto {
  @ApiProperty({ type: Number, example: 42 })
  total!: number;

  @ApiProperty({ type: Number, example: 1 })
  page!: number;

  @ApiProperty({ type: Number, example: 20 })
  limit!: number;

  @ApiProperty({ type: Number, example: 3 })
  totalPages!: number;
}

/** Respuesta del listado del pipeline (contrato `ReservaListResponse`). */
export class ReservaListResponseDto {
  @ApiProperty({ type: [ReservaPipelineItemDto] })
  data!: ReservaPipelineItemDto[];

  @ApiProperty({ type: PaginationMetadataDto })
  metadata!: PaginationMetadataDto;
}

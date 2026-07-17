/**
 * DTOs HTTP del histórico de reservas cerradas: `GET /historico` (US-042 / UC-32).
 * Nombres camelCase ALINEADOS con el contrato OpenAPI congelado (`ReservaHistorico`,
 * `ReservaHistoricoListResponse`, `PaginationMetadata`; query `page`/`limit`/`q`/
 * `estadoFinal`/`fechaDesde`/`fechaHasta`/`tipoEvento`/`importeMin`/`importeMax`).
 *
 * El `tenant_id` NO viaja en el query: deriva SIEMPRE del JWT (`@CurrentUser`) en el
 * controlador. Estos `class-validator` validan SOLO la forma de la paginación y los filtros
 * (400): `limit` 1..100, `page >= 1`, `estadoFinal` restringido a los DOS estados cerrados
 * (nunca activos → 400) y `tipoEvento` al enum del contrato. El aislamiento por tenant, la
 * restricción de estado y la búsqueda full-text los garantizan el use-case y su adaptador.
 * Los enteros de paginación llegan como string en el query: `@Type(() => Number)` los
 * transforma (el `ValidationPipe` global tiene `transform`).
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsIn, IsInt, IsOptional, IsString, Matches, Max, Min } from 'class-validator';
import type { EstadoHistorico } from '../application/listar-historico.use-case';

/** Estados CERRADOS aceptados como filtro `estadoFinal` (nunca activos). */
const ESTADOS_FINALES: ReadonlyArray<EstadoHistorico> = [
  'reserva_completada',
  'reserva_cancelada',
];

/** Tipos de evento aceptados como filtro (contrato `TipoEvento`). */
const TIPOS_EVENTO: ReadonlyArray<string> = ['boda', 'corporativo', 'privado', 'otro'];

/** Query params del listado del histórico. */
export class ListarHistoricoQueryDto {
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

  @ApiPropertyOptional({
    type: String,
    description: 'Búsqueda full-text por nombre/apellidos/email del cliente, código o notas',
  })
  @IsOptional()
  @IsString()
  q?: string;

  @ApiPropertyOptional({
    type: String,
    enum: ESTADOS_FINALES,
    example: 'reserva_completada',
  })
  @IsOptional()
  @IsIn(ESTADOS_FINALES, {
    message: 'El filtro «estadoFinal» solo admite reserva_completada o reserva_cancelada',
  })
  estadoFinal?: EstadoHistorico;

  @ApiPropertyOptional({ type: String, format: 'date', example: '2026-01-01' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'El parámetro «fechaDesde» debe tener el formato YYYY-MM-DD',
  })
  fechaDesde?: string;

  @ApiPropertyOptional({ type: String, format: 'date', example: '2026-03-31' })
  @IsOptional()
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'El parámetro «fechaHasta» debe tener el formato YYYY-MM-DD',
  })
  fechaHasta?: string;

  @ApiPropertyOptional({ type: String, enum: TIPOS_EVENTO, example: 'boda' })
  @IsOptional()
  @IsIn(TIPOS_EVENTO, { message: 'El filtro «tipoEvento» no es un tipo de evento válido' })
  tipoEvento?: string;

  @ApiPropertyOptional({ type: String, example: '1000.00' })
  @IsOptional()
  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'El parámetro «importeMin» debe ser un importe válido (Decimal)',
  })
  importeMin?: string;

  @ApiPropertyOptional({ type: String, example: '20000.00' })
  @IsOptional()
  @IsString()
  @Matches(/^\d+(\.\d{1,2})?$/, {
    message: 'El parámetro «importeMax» debe ser un importe válido (Decimal)',
  })
  importeMax?: string;
}

/** Fila LIGERA del histórico (contrato `ReservaHistorico`). */
export class ReservaHistoricoDto {
  @ApiProperty({ type: String, format: 'uuid' })
  idReserva!: string;

  @ApiProperty({ type: String, example: 'SLO-2026-0001' })
  codigo!: string;

  @ApiProperty({ type: String, format: 'uuid' })
  clienteId!: string;

  @ApiProperty({ type: String, nullable: true, example: 'Ana' })
  clienteNombre!: string | null;

  @ApiProperty({ type: String, nullable: true, example: 'García López' })
  clienteApellidos!: string | null;

  @ApiProperty({
    type: String,
    enum: ESTADOS_FINALES,
    example: 'reserva_completada',
  })
  estado!: EstadoHistorico;

  @ApiProperty({ type: String, format: 'date', nullable: true, example: '2026-05-20' })
  fechaEvento!: string | null;

  @ApiProperty({ type: String, nullable: true, enum: TIPOS_EVENTO, example: 'boda' })
  tipoEvento!: string | null;

  @ApiProperty({ type: String, nullable: true, example: '12000.00' })
  importeTotal!: string | null;
}

/** Metadatos de paginación (contrato `PaginationMetadata`). */
export class HistoricoPaginationMetadataDto {
  @ApiProperty({ type: Number, example: 42 })
  total!: number;

  @ApiProperty({ type: Number, example: 1 })
  page!: number;

  @ApiProperty({ type: Number, example: 20 })
  limit!: number;

  @ApiProperty({ type: Number, example: 3 })
  totalPages!: number;
}

/** Respuesta del listado del histórico (contrato `ReservaHistoricoListResponse`). */
export class ReservaHistoricoListResponseDto {
  @ApiProperty({ type: [ReservaHistoricoDto] })
  data!: ReservaHistoricoDto[];

  @ApiProperty({ type: HistoricoPaginationMetadataDto })
  metadata!: HistoricoPaginationMetadataDto;
}

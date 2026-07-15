/**
 * DTOs HTTP de la EDICIÓN/REENVÍO del presupuesto en pre_reserva (US-015):
 *   - `POST /reservas/{id}/presupuesto/edicion/preview` (recalcula, no persiste).
 *   - `POST /reservas/{id}/presupuesto/edicion` (crea nueva versión).
 *   - `POST /reservas/{id}/presupuesto/reenvio` (reenvío sin cambios).
 *
 * Nombres ALINEADOS con el contrato OpenAPI congelado (`EdicionExtraInput`,
 * `EdicionPresupuestoPreviewRequest`, `EdicionPresupuestoRequest`,
 * `ReenviarPresupuestoRequest`). El body NUNCA dicta el `precioUnitario` de una línea:
 * lo congela el servidor. `tenant_id`/`usuario_id` derivan del JWT, nunca del body.
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';

const IMPORTE_REGEX = /^\d+(\.\d{1,2})?$/;

const METODOS_PAGO = ['transferencia', 'efectivo'] as const;
type MetodoPagoDto = (typeof METODOS_PAGO)[number];

const DURACIONES_VALIDAS = [4, 8, 12] as const;

/**
 * Una línea de extra propuesta en la edición (camelCase del contrato de negocio).
 * `extraId` null ⇒ extra fuera de catálogo (usa `conceptoLibre`). El server congela
 * el `precioUnitario`; el body NO lo dicta.
 */
export class EdicionExtraInputDto {
  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  @IsOptional()
  @IsString()
  extraId?: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  @IsOptional()
  @IsString()
  conceptoLibre?: string;

  @ApiProperty({ type: Number, minimum: 1 })
  @IsInt()
  @Min(1)
  cantidad!: number;
}

/** Body del preview de edición (todos los campos editables opcionales salvo método). */
export class EdicionPresupuestoPreviewRequestDto {
  @ApiPropertyOptional({ type: [EdicionExtraInputDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => EdicionExtraInputDto)
  extras?: EdicionExtraInputDto[];

  @ApiPropertyOptional({ type: Number, minimum: 1 })
  @IsOptional()
  @IsInt()
  @Min(1)
  numAdultosNinosMayores4?: number;

  @ApiPropertyOptional({ type: Number, enum: DURACIONES_VALIDAS })
  @IsOptional()
  @IsInt()
  duracionHoras?: number;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @Matches(IMPORTE_REGEX, { message: 'descuentoEur debe ser un importe Decimal (2 dec)' })
  descuentoEur?: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  descuentoMotivo?: string;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @Matches(IMPORTE_REGEX, { message: 'precioManualEur debe ser un importe Decimal (2 dec)' })
  precioManualEur?: string;

  @ApiProperty({ enum: METODOS_PAGO })
  @IsIn(METODOS_PAGO, { message: 'metodoPago debe ser transferencia o efectivo' })
  metodoPago!: MetodoPagoDto;
}

/** Body de la confirmación: hereda el preview + `enviar`. */
export class EdicionPresupuestoRequestDto extends EdicionPresupuestoPreviewRequestDto {
  @ApiProperty({ type: Boolean })
  @IsBoolean()
  enviar!: boolean;
}

/** Body del reenvío sin cambios (vacío: opera sobre la versión vigente). */
export class ReenviarPresupuestoRequestDto {}

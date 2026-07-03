/**
 * DTOs HTTP de la generación del presupuesto / activación de la pre_reserva (US-014):
 *   - `POST /reservas/{id}/presupuesto/preview` (calcula borrador, no persiste).
 *   - `POST /reservas/{id}/presupuesto` (confirma).
 *
 * Nombres ALINEADOS con el contrato OpenAPI congelado: `extras[]` con `extra_id`/
 * `cantidad` (snake_case, coherente con el motor US-016), resto camelCase
 * (`descuentoEur`, `descuentoMotivo`, `precioManualEur`). Importes como Decimal string
 * (2 decimales). El `tenant_id`/`usuario_id` derivan del JWT, nunca del body.
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  Min,
  ValidateNested,
} from 'class-validator';

const IMPORTE_REGEX = /^\d+(\.\d{1,2})?$/;

/** Un extra solicitado (snake_case, coherente con el motor de tarifa US-016). */
export class PresupuestoExtraInputDto {
  @ApiProperty({ format: 'uuid' })
  @IsString()
  extra_id!: string;

  @ApiProperty({ type: Number, minimum: 1 })
  @IsInt()
  @Min(1)
  cantidad!: number;
}

/** Body del preview (opcional): simula extras/descuento/precio manual. */
export class PreviewPresupuestoRequestDto {
  @ApiPropertyOptional({ type: [PresupuestoExtraInputDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PresupuestoExtraInputDto)
  extras?: PresupuestoExtraInputDto[];

  @ApiPropertyOptional({ type: String, description: 'Descuento a restar del total.' })
  @IsOptional()
  @Matches(IMPORTE_REGEX, { message: 'descuentoEur debe ser un importe Decimal (2 dec)' })
  descuentoEur?: string;

  @ApiPropertyOptional({
    type: String,
    description: 'Precio total manual (IVA incluido) del caso tarifa_a_consultar.',
  })
  @IsOptional()
  @Matches(IMPORTE_REGEX, { message: 'precioManualEur debe ser un importe Decimal (2 dec)' })
  precioManualEur?: string;
}

/** Body de la confirmación: crea el PRESUPUESTO congelado + activa pre_reserva. */
export class ConfirmarPresupuestoRequestDto {
  @ApiPropertyOptional({ type: [PresupuestoExtraInputDto] })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => PresupuestoExtraInputDto)
  extras?: PresupuestoExtraInputDto[];

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @Matches(IMPORTE_REGEX, { message: 'descuentoEur debe ser un importe Decimal (2 dec)' })
  descuentoEur?: string;

  @ApiPropertyOptional({ type: String, description: 'Justificación del descuento.' })
  @IsOptional()
  @IsString()
  descuentoMotivo?: string;

  @ApiPropertyOptional({
    type: String,
    description: 'Precio total manual (IVA incluido); obligatorio si tarifa_a_consultar.',
  })
  @IsOptional()
  @Matches(IMPORTE_REGEX, { message: 'precioManualEur debe ser un importe Decimal (2 dec)' })
  precioManualEur?: string;
}

/** Desglose fiscal (base, IVA 21%, total) — Decimal string. */
export class DesgloseFiscalDto {
  @ApiProperty({ type: String, example: '889.26' })
  baseImponible!: string;

  @ApiProperty({ type: String, example: '21.00' })
  ivaPorcentaje!: string;

  @ApiProperty({ type: String, example: '186.74' })
  ivaImporte!: string;

  @ApiProperty({ type: String, example: '1076.00' })
  total!: string;
}

/** Reparto 40% señal / 60% liquidación + fianza aparte — Decimal string. */
export class RepartoPagoDto {
  @ApiProperty({ type: String, example: '400.00' })
  senalEur!: string;

  @ApiProperty({ type: String, example: '600.00' })
  liquidacionEur!: string;

  @ApiProperty({ type: String, example: '500.00' })
  fianzaEur!: string;
}

/** Respuesta 200 del preview (NO persiste). */
export class PresupuestoPreviewResponseDto {
  @ApiProperty({ type: Boolean })
  tarifaAConsultar!: boolean;

  @ApiProperty({ type: Object, description: 'Salida canónica del motor de tarifa (US-016).' })
  tarifa!: unknown;

  @ApiProperty({ type: String, example: '0.00' })
  extrasTotalEur!: string;

  @ApiProperty({ type: String, nullable: true })
  descuentoEur!: string | null;

  @ApiProperty({ type: DesgloseFiscalDto, nullable: true })
  desglose!: DesgloseFiscalDto | null;

  @ApiProperty({ type: RepartoPagoDto, nullable: true })
  reparto!: RepartoPagoDto | null;
}

/** PRESUPUESTO congelado creado (subconjunto de `Presupuesto`). */
export class PresupuestoCreadoDto {
  @ApiProperty({ format: 'uuid' })
  idPresupuesto!: string;

  @ApiProperty({ type: Number, example: 1 })
  version!: number;

  @ApiProperty({ enum: ['enviado'] })
  estado!: string;

  @ApiProperty({ type: String })
  total!: string;

  @ApiProperty({ type: String })
  baseImponible!: string;

  @ApiProperty({ type: String, example: '21.00' })
  ivaPorcentaje!: string;

  @ApiProperty({ type: String })
  ivaImporte!: string;

  @ApiProperty({ type: Boolean })
  tarifaCongelada!: boolean;

  @ApiProperty({ type: String, nullable: true })
  pdfUrl!: string | null;
}

/** RESERVA resultante en pre_reserva (subconjunto). */
export class ReservaPrereservaDto {
  @ApiProperty({ format: 'uuid' })
  idReserva!: string;

  @ApiProperty({ enum: ['pre_reserva'] })
  estado!: string;

  @ApiProperty({ type: String, format: 'date-time' })
  ttlExpiracion!: string;
}

/** Respuesta 201 de la confirmación. */
export class ConfirmarPresupuestoResponseDto {
  @ApiProperty({ type: PresupuestoCreadoDto })
  presupuesto!: PresupuestoCreadoDto;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  tarifaId!: string | null;

  @ApiProperty({ type: RepartoPagoDto })
  reparto!: RepartoPagoDto;

  @ApiProperty({ type: ReservaPrereservaDto })
  reserva!: ReservaPrereservaDto;

  @ApiProperty({ type: Number, minimum: 0, example: 0 })
  consultasDescartadas!: number;
}

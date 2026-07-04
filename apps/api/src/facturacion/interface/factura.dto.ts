/**
 * DTOs HTTP de la capability `facturacion` (US-022 / UC-18). Reproducen EXACTAMENTE los
 * schemas del contrato `docs/api-spec.yml` (tag `Facturacion`): `FacturaSenalDto`,
 * `RechazarFacturaRequest`, `AprobarFacturaRequest`, `RegenerarPdfFacturaRequest`.
 *
 * Los importes viajan como string Decimal de 2 decimales (wrapper `Importe`/`Porcentaje`,
 * F2-01). Los flags `esBorradorInvalido`/`pdfPendiente` son DERIVADOS (design.md §D-9).
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsNotEmpty, IsString, MaxLength } from 'class-validator';

/** Estado del ciclo de vida de la factura (contrato `EstadoFactura`). */
export type EstadoFacturaDto = 'borrador' | 'enviada' | 'cobrada';

/** Vista de lectura de la factura de señal (contrato `FacturaSenalDto`). */
export class FacturaSenalDto {
  @ApiProperty({ format: 'uuid' })
  idFactura!: string;

  @ApiProperty({ format: 'uuid' })
  reservaId!: string;

  @ApiProperty({ nullable: true, example: 'F-2026-0001' })
  numeroFactura!: string | null;

  @ApiProperty({ enum: ['senal', 'liquidacion', 'fianza', 'complementaria'] })
  tipo!: string;

  @ApiProperty({ example: '991.74' })
  baseImponible!: string;

  @ApiProperty({ example: '21.00' })
  ivaPorcentaje!: string;

  @ApiProperty({ example: '208.26' })
  ivaImporte!: string;

  @ApiProperty({ example: '1200.00' })
  total!: string;

  @ApiPropertyOptional({ nullable: true })
  concepto?: string | null;

  @ApiProperty({ nullable: true })
  pdfUrl!: string | null;

  @ApiProperty({ enum: ['borrador', 'enviada', 'cobrada'] })
  estado!: EstadoFacturaDto;

  @ApiProperty({ format: 'date-time', nullable: true })
  fechaEmision!: string | null;

  @ApiProperty({ description: 'Faltan datos fiscales del cliente (bloqueo por datos).' })
  esBorradorInvalido!: boolean;

  @ApiProperty({ description: 'pdfUrl=null por fallo transitorio del PDF (reintenta solo).' })
  pdfPendiente!: boolean;
}

/** Cuerpo vacío de la aprobación (contrato `AprobarFacturaRequest`). */
export class AprobarFacturaRequestDto {}

/** Cuerpo del rechazo: motivo obligatorio (contrato `RechazarFacturaRequest`). */
export class RechazarFacturaRequestDto {
  @ApiProperty({ minLength: 1, maxLength: 2000 })
  @IsString()
  @IsNotEmpty()
  @MaxLength(2000)
  motivo!: string;
}

/** Cuerpo vacío del reintento de PDF (contrato `RegenerarPdfFacturaRequest`). */
export class RegenerarPdfFacturaRequestDto {}

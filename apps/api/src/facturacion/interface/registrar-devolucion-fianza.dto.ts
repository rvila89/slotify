/**
 * DTOs HTTP de la acción `POST /reservas/{id}/fianza/devolucion` (US-036 / UC-27 pasos 4-8).
 * Nombres camelCase ALINEADOS con el contrato OpenAPI congelado
 * (`RegistrarDevolucionFianzaRequest`, `RegistrarDevolucionFianzaResponse`). Calcado del estilo de
 * `RegistrarCobroFianzaRequest` (US-030).
 *
 * El cuerpo lleva `importeDevuelto` (Importe Decimal(10,2) string, obligatorio), `fechaCobro`
 * (DATE, obligatorio), `motivoRetencion?` (obligatorio solo si parcial, validado en dominio) y
 * `justificanteDocId?` (uuid opcional, FA-04). El tenant/usuario viajan del JWT; la reserva del
 * path. Las respuestas son de solo salida (sin `class-validator`).
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, Matches } from 'class-validator';

/** Patrón de importe Decimal(10,2) serializado como string (contrato `Importe`, F2-01). */
const IMPORTE_PATTERN = /^-?\d+\.\d{2}$/;
/** Patrón de fecha ISO `YYYY-MM-DD` (contrato `format: date`). */
const FECHA_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
/**
 * Patrón laxo de UUID (formato canónico 8-4-4-4-12, cualquier versión/variante). El contrato
 * declara `format: uuid` como forma, sin exigir variante RFC estricta; la existencia real se
 * verifica en el dominio (404 `JUSTIFICANTE_NO_ENCONTRADO`).
 */
const UUID_PATTERN = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** Cuerpo de la petición de devolución de fianza (`RegistrarDevolucionFianzaRequest`). */
export class RegistrarDevolucionFianzaRequestDto {
  @ApiProperty({
    example: '1000.00',
    description:
      'Importe devuelto (Importe Decimal(10,2) string, 0.00 ≤ x ≤ fianzaEur). "0.00" es válido (retención total).',
  })
  @IsString()
  @Matches(IMPORTE_PATTERN, { message: 'importeDevuelto debe ser Decimal(10,2) como string' })
  importeDevuelto!: string;

  @ApiProperty({
    example: '2026-07-10',
    format: 'date',
    description: 'Fecha real del abono de la devolución (DATE, >= fianzaCobradaFecha).',
  })
  @IsString()
  @Matches(FECHA_PATTERN, { message: 'fechaCobro debe tener formato YYYY-MM-DD' })
  fechaCobro!: string;

  @ApiPropertyOptional({
    type: String,
    nullable: true,
    description:
      'Motivo de la retención. Obligatorio solo en devolución parcial (importeDevuelto < fianzaEur).',
  })
  @IsOptional()
  @IsString()
  motivoRetencion?: string | null;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      'Referencia OPCIONAL a un DOCUMENTO (tipo justificante_pago) ya subido. Omitido/null → registro sin justificante (FA-04).',
  })
  @IsOptional()
  @IsString()
  @Matches(UUID_PATTERN, { message: 'justificanteDocId debe ser un UUID' })
  justificanteDocId?: string | null;
}

/** Proyección de la RESERVA en la respuesta (`RegistrarDevolucionFianzaResponse.reserva`). */
export class RegistrarDevolucionFianzaReservaDto {
  @ApiProperty({ type: String, format: 'uuid' })
  idReserva!: string;

  @ApiProperty({ enum: ['devuelta', 'retenida_parcial'] })
  fianzaStatus!: 'devuelta' | 'retenida_parcial';

  @ApiProperty({ example: '1000.00', description: 'Importe efectivamente devuelto.' })
  fianzaDevueltaEur!: string;

  @ApiProperty({ example: '2026-07-10', format: 'date' })
  fianzaDevueltaFecha!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  motivoRetencion!: string | null;
}

/** DOCUMENTO justificante vinculado (`RegistrarDevolucionFianzaResponse.documentoJustificante`). */
export class RegistrarDevolucionFianzaDocumentoDto {
  @ApiProperty({ type: String, format: 'uuid' })
  idDocumento!: string;

  @ApiProperty({ example: 'justificante_pago' })
  tipo!: string;

  @ApiProperty({ example: 'application/pdf' })
  mimeType!: string;

  @ApiProperty({ example: 'https://storage.local/justificantes/devolucion.pdf' })
  url!: string;
}

/** Respuesta 200 (`RegistrarDevolucionFianzaResponse`). Solo de salida. */
export class RegistrarDevolucionFianzaResponseDto {
  @ApiProperty({ type: RegistrarDevolucionFianzaReservaDto })
  reserva!: RegistrarDevolucionFianzaReservaDto;

  @ApiPropertyOptional({ type: RegistrarDevolucionFianzaDocumentoDto, nullable: true })
  documentoJustificante!: RegistrarDevolucionFianzaDocumentoDto | null;

  @ApiProperty({
    type: Boolean,
    description: 'true si la devolución se registró sin justificante (FA-04).',
  })
  avisoSinJustificante!: boolean;
}

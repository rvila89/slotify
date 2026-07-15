/**
 * DTOs HTTP de la acción `POST /reservas/{id}/descartar` (US-013 / UC-10 / A17). Nombres
 * camelCase ALINEADOS con el contrato OpenAPI (`DescartarConsultaRequest` y la respuesta
 * `Reserva`). El request lleva un único parámetro de negocio OPCIONAL, `motivo`, que el backend
 * ANEXA a `RESERVA.notas`; `class-validator` con `whitelist + forbidNonWhitelisted` rechaza
 * cualquier propiedad extra (espejo de `additionalProperties: false` del contrato). La
 * respuesta es de solo salida (sin `class-validator`), calcada de `archivarReservaManual`
 * (US-038): la RESERVA completa (`Reserva`, sin el `cliente` embebido de `ReservaDetalle`).
 */
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import { IsOptional, IsString } from 'class-validator';

/**
 * Cuerpo (opcional) del descarte por cliente. `motivo` es opcional: si se envía, se anexa a
 * `RESERVA.notas`; si se omite, la transición a `2z` completa igual sin tocar `notas`.
 * `additionalProperties: false` se refleja con `whitelist + forbidNonWhitelisted` en el pipe.
 */
export class DescartarConsultaRequestDto {
  @ApiPropertyOptional({
    type: String,
    nullable: true,
    example: 'El cliente ha decidido celebrar el evento en otra ubicación.',
    description:
      'Motivo del descarte comunicado por el cliente (OPCIONAL). El backend lo anexa a RESERVA.notas.',
  })
  @IsOptional()
  @IsString()
  motivo?: string;
}

/**
 * Respuesta 200 del descarte (`Reserva`): la RESERVA COMPLETA del contrato (sin el `cliente`
 * embebido, propio de `ReservaDetalle`). Importes como `string` (`Importe`, Decimal(10,2) sin
 * coma flotante); fechas `date`/`date-time` en string ISO. Solo de salida.
 */
export class DescartarConsultaResponseDto {
  @ApiProperty({ format: 'uuid' })
  idReserva!: string;

  @ApiProperty({ example: 'SLO-2026-0001' })
  codigo!: string;

  @ApiProperty({ format: 'uuid' })
  clienteId!: string;

  @ApiProperty({
    enum: [
      'consulta',
      'pre_reserva',
      'reserva_confirmada',
      'evento_en_curso',
      'post_evento',
      'reserva_completada',
      'reserva_cancelada',
    ],
    description: 'Estado resultante de la RESERVA (consulta tras el descarte a 2z).',
  })
  estado!: string;

  @ApiPropertyOptional({
    enum: ['2a', '2b', '2c', '2d', '2v', '2x', '2y', '2z'],
    nullable: true,
  })
  subEstado!: string | null;

  @ApiProperty({ enum: ['web', 'email', 'whatsapp', 'instagram', 'telefono'] })
  canalEntrada!: string;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  fechaEvento!: string | null;

  @ApiPropertyOptional({ type: Number, enum: [4, 8, 12], nullable: true })
  duracionHoras!: number | null;

  @ApiPropertyOptional({
    type: String,
    enum: ['boda', 'corporativo', 'privado', 'otro'],
    nullable: true,
  })
  tipoEvento!: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  numAdultosNinosMayores4!: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  numNinosMenores4!: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  numInvitadosFinal!: number | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: '1234.56' })
  importeTotal!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  importeSenal!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  importeLiquidacion!: string | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  ttlExpiracion!: string | null;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  visitaProgramadaFecha!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true, example: '17:30' })
  visitaProgramadaHora!: string | null;

  @ApiPropertyOptional({ type: Boolean, nullable: true })
  visitaRealizada!: boolean | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  fianzaEur!: string | null;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  fianzaCobradaFecha!: string | null;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  fianzaDevueltaFecha!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  fianzaDevueltaEur!: string | null;

  @ApiPropertyOptional({ type: Boolean, nullable: true })
  condPartFirmadas!: boolean | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  condPartFechaEnvio!: string | null;

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  condPartFechaFirma!: string | null;

  @ApiProperty({ enum: ['pendiente', 'en_curso', 'cerrado'] })
  preEventoStatus!: string;

  @ApiProperty({ enum: ['pendiente', 'facturada', 'cobrada'] })
  liquidacionStatus!: string;

  @ApiProperty({
    enum: ['pendiente', 'recibo_enviado', 'cobrada', 'devuelta', 'retenida_parcial'],
  })
  fianzaStatus!: string;

  @ApiPropertyOptional({ type: Number, nullable: true })
  posicionCola!: number | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  consultaBloqueanteId!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  notas!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  fechaCreacion!: string;
}

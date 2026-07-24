/**
 * DTO HTTP de respuesta de `GET /reservas/{id}` (ficha de consulta US-005). Nombres
 * camelCase ALINEADOS con el contrato OpenAPI `ReservaDetalle` (= `Reserva` +
 * `cliente`). Importes como `string` (`Importe`, Decimal(10,2) sin coma flotante);
 * fechas como `date`/`date-time` en string ISO. Solo de salida: sin `class-validator`.
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

export class ClienteDetalleDto {
  @ApiProperty({ format: 'uuid' })
  idCliente!: string;

  @ApiProperty()
  nombre!: string;

  @ApiPropertyOptional({ type: String, nullable: true })
  apellidos!: string | null;

  @ApiPropertyOptional({ type: String, format: 'email', nullable: true })
  email!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  telefono!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  dniNif!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  direccion!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  codigoPostal!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  poblacion!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  provincia!: string | null;
}

export class ReservaDetalleResponseDto {
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
  })
  estado!: string;

  @ApiPropertyOptional({
    enum: ['2a', '2b', '2c', '2d', '2v', '2x', '2y', '2z'],
    nullable: true,
  })
  subEstado!: string | null;

  @ApiProperty({
    enum: ['web', 'email', 'whatsapp', 'instagram', 'telefono', 'cocopool', 'holaplace'],
  })
  canalEntrada!: string;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  fechaEvento!: string | null;

  @ApiPropertyOptional({ type: Number, enum: [4, 8, 12], nullable: true })
  duracionHoras!: number | null;

  @ApiPropertyOptional({
    type: String,
    enum: ['boda', 'corporativo', 'privado', 'otro', 'cumpleanos'],
    nullable: true,
  })
  tipoEvento!: string | null;

  @ApiPropertyOptional({ type: String, pattern: '^\\d{2}:\\d{2}$', nullable: true })
  horario?: string | null;

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

  @ApiPropertyOptional({ type: String, format: 'date-time', nullable: true })
  fianzaComprobanteFecha!: string | null;

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
    enum: ['pendiente', 'cobrada', 'devuelta'],
  })
  fianzaStatus!: string;

  @ApiPropertyOptional({ type: Number, nullable: true })
  posicionCola!: number | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  consultaBloqueanteId!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  notas!: string | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  comentarios!: string | null;

  @ApiProperty({ type: String, format: 'date-time' })
  fechaCreacion!: string;

  @ApiPropertyOptional({
    type: Boolean,
    description:
      'Indica si la reserva tiene un borrador E1 pendiente de revisar/enviar (US-047)',
  })
  tieneBorradorE1Pendiente?: boolean;

  @ApiProperty({ type: ClienteDetalleDto })
  cliente!: ClienteDetalleDto;
}

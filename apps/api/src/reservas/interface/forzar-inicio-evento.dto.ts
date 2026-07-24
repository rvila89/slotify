/**
 * DTOs HTTP de la acción `POST /reservas/{id}/forzar-inicio-evento` (US-032 / UC-23 FA-01).
 * Nombres camelCase ALINEADOS con el contrato OpenAPI (`ForzarInicioEventoRequest`,
 * `ForzarInicioEventoResponse`). El request es un objeto VACÍO
 * (`additionalProperties:false`): la única entrada es la RESERVA (path) y el Gestor (JWT). La
 * respuesta es de solo salida (sin `class-validator`).
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Cuerpo (opcional, vacío) del forzado. `class-validator` con `whitelist +
 * forbidNonWhitelisted` rechaza cualquier propiedad extra (espejo de
 * `additionalProperties:false` del contrato).
 */
export class ForzarInicioEventoRequestDto {}

/**
 * Respuesta 200 del forzado (`ForzarInicioEventoResponse` = `allOf(Reserva)` +
 * `forzadoPorGestor` + `precondicionesIncumplidas`). Hidrata la RESERVA COMPLETA del contrato
 * (`Reserva`, sin el `cliente` embebido, que es propio de `ReservaDetalle`) para NO tocar el
 * contrato congelado y alinearse con el resto de acciones de reserva. Importes como `string`
 * (`Importe`, Decimal(10,2) sin coma flotante); fechas `date`/`date-time` en string ISO. Solo
 * de salida.
 */
export class ForzarInicioEventoResponseDto {
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
    description: 'Estado resultante de la RESERVA (evento_en_curso tras el forzado).',
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

  @ApiProperty({ type: String, format: 'date-time' })
  fechaCreacion!: string;

  @ApiProperty({
    type: Boolean,
    description:
      'Siempre true: la transición fue un OVERRIDE explícito del Gestor (distingue del inicio automático de US-031).',
  })
  forzadoPorGestor!: boolean;

  @ApiProperty({
    type: [String],
    description:
      'Precondiciones incumplidas en el momento del forzado (calculadas bajo el lock y persistidas en AUDIT_LOG); [] si por caso borde las tres estaban cumplidas.',
    example: ['liquidacion_status'],
  })
  precondicionesIncumplidas!: string[];
}

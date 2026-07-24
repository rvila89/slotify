/**
 * DTOs HTTP de la acción `POST /reservas/{id}/finalizar-evento` (US-034 / UC-25).
 * Nombres camelCase ALINEADOS con el contrato OpenAPI (`FinalizarEventoRequest`,
 * `FinalizarEventoE5`, `ResultadoE5`, `FinalizarEventoResponse`). El request es un objeto
 * VACÍO (`additionalProperties:false`): la única entrada es la RESERVA (path) y el Gestor
 * (JWT). La respuesta es de solo salida (sin `class-validator`).
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/**
 * Cuerpo (opcional, vacío) de la finalización. `class-validator` con `whitelist +
 * forbidNonWhitelisted` rechaza cualquier propiedad extra (espejo de
 * `additionalProperties:false` del contrato).
 */
export class FinalizarEventoRequestDto {}

/** Resultado del disparo condicionado del email E5 (`FinalizarEventoE5`). */
export class FinalizarEventoE5Dto {
  @ApiProperty({
    enum: ['enviado', 'fallido', 'no_aplica'],
    description:
      'Resultado del disparo de E5: enviado/fallido (COMUNICACION creada) o no_aplica (sin fianza).',
  })
  resultado!: 'enviado' | 'fallido' | 'no_aplica';

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    description: 'ID de la COMUNICACION E5; null cuando resultado=no_aplica.',
  })
  comunicacionId!: string | null;
}

/**
 * Respuesta 200 de la finalización (`FinalizarEventoResponse` = `allOf(Reserva)` + `e5` +
 * `documentacionPendiente`). Hidrata la RESERVA COMPLETA del contrato (`Reserva`, sin el
 * `cliente` embebido, que es propio de `ReservaDetalle`) para NO tocar el contrato congelado
 * y alinearse con el resto de acciones de reserva. Importes como `string` (`Importe`,
 * Decimal(10,2) sin coma flotante); fechas `date`/`date-time` en string ISO. Solo de salida.
 */
export class FinalizarEventoResponseDto {
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
    description: 'Estado resultante de la RESERVA (post_evento tras la finalización).',
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

  @ApiProperty({ type: FinalizarEventoE5Dto })
  e5!: FinalizarEventoE5Dto;

  @ApiProperty({
    type: [String],
    description:
      'Ítems del checklist de documentación sin subir (advertencia no bloqueante, US-033).',
    example: ['dni_anverso', 'clausula_responsabilidad'],
  })
  documentacionPendiente!: string[];
}

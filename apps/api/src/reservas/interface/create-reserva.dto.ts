/**
 * DTOs HTTP del alta de consulta (US-003). Nombres camelCase ALINEADOS con el
 * contrato OpenAPI congelado (`docs/api-spec.yml`: `CreateReservaRequest`,
 * `CreateClienteRequest`, `Reserva`). La validación `class-validator` reproduce el
 * contrato: requireds de contacto, formato de email (RFC 5322 básico), límites de
 * longitud y enum de `canalEntrada`; los fallos devuelven 400 (ValidationError).
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsDateString,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
  MinLength,
  ValidateNested,
} from 'class-validator';

const CANALES = [
  'web',
  'email',
  'whatsapp',
  'instagram',
  'telefono',
  'cocopool',
  'holaplace',
] as const;
const TIPOS_EVENTO = ['boda', 'corporativo', 'privado', 'otro', 'cumpleanos'] as const;
const DURACIONES = [4, 8, 12] as const;
/** RFC 5322 básico: local@dominio.tld, sin espacios (igual que el contrato). */
const EMAIL_PATTERN = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export class CreateClienteRequestDto {
  @ApiProperty({ minLength: 1, maxLength: 100, description: 'Obligatorio, no vacío, máx 100.' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  nombre!: string;

  @ApiProperty({ minLength: 1, maxLength: 100, description: 'Obligatorio, no vacío, máx 100.' })
  @IsString()
  @MinLength(1)
  @MaxLength(100)
  apellidos!: string;

  @ApiProperty({
    format: 'email',
    maxLength: 254,
    description: 'Obligatorio. Email RFC 5322 básico. Idempotencia de CLIENTE por (tenant_id, email).',
  })
  @IsString()
  @MaxLength(254)
  @Matches(EMAIL_PATTERN, { message: 'email debe tener un formato válido' })
  email!: string;

  @ApiProperty({ minLength: 1, description: 'Obligatorio, no vacío.' })
  @IsString()
  @MinLength(1)
  telefono!: string;
}

export class CreateReservaRequestDto {
  @ApiProperty({ enum: CANALES })
  @IsIn(CANALES)
  canalEntrada!: (typeof CANALES)[number];

  @ApiPropertyOptional({
    format: 'date',
    nullable: true,
    description: 'Si se envía, se crea en sub-estado 2.b con bloqueo blando (US-004/005).',
  })
  @IsOptional()
  @IsDateString()
  fechaEvento?: string;

  @ApiPropertyOptional({ enum: TIPOS_EVENTO })
  @IsOptional()
  @IsIn(TIPOS_EVENTO)
  tipoEvento?: (typeof TIPOS_EVENTO)[number];

  @ApiPropertyOptional({ enum: DURACIONES })
  @IsOptional()
  @IsIn(DURACIONES)
  duracionHoras?: (typeof DURACIONES)[number];

  @ApiPropertyOptional({ type: Number })
  @IsOptional()
  @IsInt()
  numAdultosNinosMayores4?: number;

  @ApiPropertyOptional({ type: Number })
  @IsOptional()
  @IsInt()
  numNinosMenores4?: number;

  @ApiPropertyOptional({ type: String })
  @IsOptional()
  @IsString()
  notas?: string;

  @ApiPropertyOptional({
    type: String,
    maxLength: 2000,
    description:
      'Comentarios libres del gestor. Su PRESENCIA decide E1: ausente/vacío → auto-envío (enviado); presente → borrador (no se envía).',
  })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  comentarios?: string;

  @ApiPropertyOptional({ enum: ['es', 'ca'], description: 'Idioma de comunicación con el cliente. Por defecto es.' })
  @IsOptional()
  @IsIn(['es', 'ca'])
  idioma?: string;

  @ApiPropertyOptional({ type: String, description: 'Hora de inicio del evento en formato HH:MM. Solo válido si duracionHoras también está presente.' })
  @IsOptional()
  @Matches(/^\d{2}:\d{2}$/, { message: 'horario debe tener formato HH:MM (ej. 10:00)' })
  horario?: string;

  @ApiProperty({ type: CreateClienteRequestDto })
  @ValidateNested()
  @Type(() => CreateClienteRequestDto)
  cliente!: CreateClienteRequestDto;
}

/**
 * Tarifa estimada decorativa que viaja en E1 (US-004 §D-4). Subconjunto del
 * `CalculoTarifaResponse` del contrato; ausente/null cuando no se pudo calcular.
 */
export class TarifaEstimadaResponseDto {
  @ApiPropertyOptional({ type: String })
  temporada?: string;

  @ApiProperty({ type: Boolean })
  tarifaAConsultar!: boolean;

  @ApiProperty({ type: Number, nullable: true })
  precioTarifaEur!: number | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  extrasTotalEur?: number | null;

  @ApiProperty({ type: Number, nullable: true })
  totalEur!: number | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  tarifaId?: string | null;
}

/**
 * Respuesta del alta (`POST /reservas`). Alineada con `CreateReservaResponse` del
 * contrato: la RESERVA creada más los campos transitorios del sub-estado resultante
 * del alta con fecha (US-004), todos opcionales (ausentes en el alta sin fecha).
 */
export class ReservaResponseDto {
  @ApiProperty({ format: 'uuid' })
  idReserva!: string;

  @ApiProperty({ example: '26-0001' })
  codigo!: string;

  @ApiProperty({ format: 'uuid' })
  clienteId!: string;

  @ApiProperty({ enum: ['consulta'] })
  estado!: string;

  @ApiProperty({ enum: ['2a', '2b', '2d'], nullable: true })
  subEstado!: string | null;

  @ApiProperty({ enum: CANALES })
  canalEntrada!: string;

  @ApiPropertyOptional({ type: String, format: 'date', nullable: true })
  fechaEvento?: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  ttlExpiracion!: string | null;

  @ApiPropertyOptional({ type: Number, nullable: true })
  posicionCola?: number | null;

  @ApiPropertyOptional({ type: String, format: 'uuid', nullable: true })
  consultaBloqueanteId?: string | null;

  @ApiPropertyOptional({ enum: ['blando', 'firme'], nullable: true })
  tipoBloqueo?: string | null;

  @ApiPropertyOptional({ type: Boolean, nullable: true })
  fechaDisponible?: boolean | null;

  @ApiPropertyOptional({ type: String, nullable: true })
  avisoDisponibilidad?: string | null;

  @ApiPropertyOptional({ type: TarifaEstimadaResponseDto, nullable: true })
  tarifaEstimada?: TarifaEstimadaResponseDto | null;
}

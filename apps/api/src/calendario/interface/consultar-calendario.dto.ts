/**
 * DTOs HTTP del calendario de disponibilidad: `GET /calendario` (US-039 / UC-29).
 * Nombres camelCase ALINEADOS con el contrato OpenAPI congelado
 * (`CalendarioResponse`, `CalendarioRango`, `CalendarioFecha`, query
 * `desde`/`hasta` date required + `vista` enum default `mes`).
 *
 * El `tenant_id` NO viaja en el query: deriva SIEMPRE del JWT (`@CurrentUser`) en el
 * controlador. Estos `class-validator` validan SOLO la forma del rango y la vista
 * (400); la agregación y el aislamiento por tenant los garantiza el use-case.
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsIn,
  IsOptional,
  IsString,
  Matches,
  ValidatorConstraint,
  registerDecorator,
} from 'class-validator';
import type {
  ValidationArguments,
  ValidationOptions,
  ValidatorConstraintInterface,
} from 'class-validator';
import type { VistaCalendario } from '../application/obtener-calendario.query';
import type { ColorCalendario } from '../domain/derivacion-color';
import type {
  EstadoReserva,
  SubEstadoConsulta,
} from '../../reservas/domain/maquina-estados';

/** Valores válidos de la vista (contrato `VistaCalendario`). */
const VISTAS: ReadonlyArray<VistaCalendario> = ['mes', 'semana', 'dia', 'lista'];

/**
 * Validador CROSS-FIELD del rango: el límite `desde` debe ser anterior o IGUAL a
 * `hasta` (límite inclusivo, un único día es válido). Las fechas llegan como strings
 * `YYYY-MM-DD`, cuyo orden lexicográfico coincide con el cronológico; aun así se parsea
 * a epoch para ser robustos ante valores no canónicos. Si algún extremo no es una fecha
 * válida, esta restricción se abstiene (deja que el `@Matches` de cada campo emita su
 * propio error de FORMA) para no enmascarar el mensaje específico.
 *
 * El `ValidationPipe` GLOBAL (whitelist + forbidNonWhitelisted + transform) traduce el
 * fallo a HTTP 400 — el único código que el contrato OpenAPI declara para `/calendario`.
 */
@ValidatorConstraint({ name: 'rangoCalendarioOrdenado', async: false })
class RangoCalendarioOrdenadoConstraint implements ValidatorConstraintInterface {
  validate(hasta: unknown, args: ValidationArguments): boolean {
    const dto = args.object as { desde?: unknown };
    const desde = dto.desde;
    if (typeof desde !== 'string' || typeof hasta !== 'string') return true;
    const tDesde = Date.parse(`${desde}T00:00:00.000Z`);
    const tHasta = Date.parse(`${hasta}T00:00:00.000Z`);
    // Si algún extremo no es parseable, se abstiene: el @Matches de FORMA decidirá.
    if (Number.isNaN(tDesde) || Number.isNaN(tHasta)) return true;
    return tDesde <= tHasta;
  }

  defaultMessage(): string {
    return 'El parámetro «desde» debe ser anterior o igual a «hasta»';
  }
}

/** Decorador que aplica la guarda de orden del rango sobre el campo `hasta`. */
const EsRangoCalendarioOrdenado = (options?: ValidationOptions) => {
  return (target: object, propertyName: string): void => {
    registerDecorator({
      name: 'rangoCalendarioOrdenado',
      target: target.constructor,
      propertyName,
      options,
      validator: RangoCalendarioOrdenadoConstraint,
    });
  };
};

/** Query params de la consulta del calendario. */
export class ConsultarCalendarioQueryDto {
  @ApiProperty({
    type: String,
    format: 'date',
    example: '2026-06-01',
    description: 'Inicio del rango (inclusive), YYYY-MM-DD.',
  })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'El parámetro «desde» debe tener el formato YYYY-MM-DD',
  })
  desde!: string;

  @ApiProperty({
    type: String,
    format: 'date',
    example: '2026-06-30',
    description: 'Fin del rango (inclusive), YYYY-MM-DD.',
  })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'El parámetro «hasta» debe tener el formato YYYY-MM-DD',
  })
  @EsRangoCalendarioOrdenado()
  hasta!: string;

  @ApiPropertyOptional({
    type: String,
    enum: VISTAS,
    default: 'mes',
    description: 'Vista solicitada (informativa; no altera el dataset del rango).',
  })
  @IsOptional()
  @IsIn(VISTAS, {
    message: 'La vista debe ser una de: mes, semana, dia, lista',
  })
  vista?: VistaCalendario;
}

/** Rango efectivo agregado (eco de los query params) — `CalendarioRango`. */
export class CalendarioRangoResponseDto {
  @ApiProperty({ type: String, format: 'date', example: '2026-06-01' })
  desde!: string;

  @ApiProperty({ type: String, format: 'date', example: '2026-06-30' })
  hasta!: string;
}

/** Agregación de UNA fecha ocupada — `CalendarioFecha`. */
export class CalendarioFechaResponseDto {
  @ApiProperty({ type: String, format: 'date', example: '2026-06-12' })
  fecha!: string;

  @ApiProperty({ enum: ['gris', 'ambar', 'verde', 'azul', 'rojo'], example: 'gris' })
  color!: ColorCalendario;

  @ApiProperty({ type: String, example: 'consulta' })
  estado!: EstadoReserva;

  @ApiProperty({ type: String, nullable: true, example: '2b' })
  subEstado!: SubEstadoConsulta | null;

  @ApiProperty({ type: String, format: 'uuid' })
  reservaId!: string;

  @ApiProperty({ type: String, example: 'Ana García' })
  cliente!: string;

  @ApiProperty({
    type: String,
    format: 'date-time',
    nullable: true,
    description: 'Vencimiento del bloqueo blando; null para firme/histórica.',
  })
  ttlExpiracion!: string | null;

  @ApiProperty({ type: Number, minimum: 0, default: 0, example: 2 })
  enCola!: number;
}

/** Respuesta agregada del calendario — `CalendarioResponse`. */
export class CalendarioResponseDto {
  @ApiProperty({ type: CalendarioRangoResponseDto })
  rango!: CalendarioRangoResponseDto;

  @ApiProperty({ type: [CalendarioFechaResponseDto] })
  fechas!: CalendarioFechaResponseDto[];
}

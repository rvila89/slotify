/**
 * DTOs HTTP de la transición «programar visita»: `POST /reservas/{id}/visita`
 * (US-008). Nombres camelCase ALINEADOS con el contrato OpenAPI congelado
 * (`ProgramarVisitaRequest`; respuesta 200 = `Reserva`). El cuerpo lleva la `fecha`
 * (DATE `YYYY-MM-DD`) y la `hora` (`HH:mm`) de la visita; la validación de la ventana
 * `[hoy+1, hoy+max_dias_programar_visita]` y la guarda de origen las hace el use-case
 * (422); el formato del cuerpo lo validan estos `class-validator` (400).
 */
import { ApiProperty } from '@nestjs/swagger';
import { IsString, Matches } from 'class-validator';

/** Cuerpo de la petición: fecha (YYYY-MM-DD) y hora (HH:mm) de la visita. */
export class ProgramarVisitaRequestDto {
  @ApiProperty({
    type: String,
    format: 'date',
    example: '2026-07-03',
    description:
      'Fecha de la visita (YYYY-MM-DD). Debe ser futura y dentro de [hoy+1, hoy+max_dias_programar_visita].',
  })
  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'La fecha de la visita debe tener el formato YYYY-MM-DD',
  })
  fecha!: string;

  @ApiProperty({
    type: String,
    example: '17:30',
    description: 'Hora de la visita en formato 24h HH:mm.',
  })
  @IsString()
  @Matches(/^([01]\d|2[0-3]):[0-5]\d$/, {
    message: 'La hora de la visita debe tener el formato HH:mm (24h)',
  })
  hora!: string;
}

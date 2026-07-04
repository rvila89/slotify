/**
 * DTOs de respuesta del barrido de CIERRE AUTOMÁTICO de ficha operativa en T-1d
 * (US-026 / UC-20 FA-01, §D-2, Opción A).
 *
 * `BarridoFichasResumenDto` es la shape EXACTA del schema `BarridoFichasResumen` del
 * contrato CONGELADO (`{ candidatas, fichasCerradas, fallos }`, todos required):
 * recuentos agregados de un proceso de Sistema; no expone datos de negocio sensibles ni
 * identificadores de RESERVA. El resumen del cierre de fichas viaja en
 * `BarridoResponse.fichas` (Opción A: se reutiliza el endpoint genérico
 * `POST /cron/barrido?tarea=fichas`).
 */
import { ApiProperty } from '@nestjs/swagger';

export class BarridoFichasResumenDto {
  @ApiProperty({
    description:
      'Nº de RESERVA seleccionadas como candidatas del cierre A10, cross-tenant: ' +
      "estado = 'reserva_confirmada' AND pre_evento_status != 'cerrado' AND " +
      'date(fecha_evento) = date(hoy) + 1 día (T-1d, fecha de calendario).',
    minimum: 0,
    example: 3,
  })
  candidatas!: number;

  @ApiProperty({
    description:
      'Nº de fichas efectivamente cerradas en esta ejecución (ficha_cerrada = true + ' +
      'fecha_cierre = now() + pre_evento_status → cerrado + AUDIT_LOG transición origen ' +
      'Sistema). Menor que candidatas cuando una dejó de serlo bajo transacción ' +
      '(idempotencia / cierre manual US-025 concurrente) o falló.',
    minimum: 0,
    example: 2,
  })
  fichasCerradas!: number;

  @ApiProperty({
    description:
      'Nº de candidatas cuyo cierre falló de forma aislada (rollback de su propia ' +
      'transacción, sin afectar al resto del lote).',
    minimum: 0,
    example: 0,
  })
  fallos!: number;
}

/**
 * Respuesta del barrido genérico `POST /cron/barrido` (shape del contrato
 * `BarridoResponse`, Opción A). El resumen del cierre de fichas viaja bajo la clave
 * `fichas`; el resto de recuentos de otras tareas se añaden según se implementen.
 */
export class BarridoResponseDto {
  @ApiProperty({
    description: 'Resumen del barrido de cierre automático de ficha operativa en T-1d.',
    type: BarridoFichasResumenDto,
  })
  fichas!: BarridoFichasResumenDto;
}

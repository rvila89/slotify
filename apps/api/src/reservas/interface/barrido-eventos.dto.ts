/**
 * DTO de respuesta del barrido de INICIO AUTOMÁTICO de evento en T-0 (US-031 / UC-23, §D-2).
 *
 * Shape EXACTA del contrato OpenAPI `BarridoEventosResponse`
 * (`{ candidatas, eventosIniciados, precondicionesIncumplidas, fallos }`): recuentos
 * agregados de un proceso de Sistema; no expone datos de negocio sensibles ni
 * identificadores de RESERVA. Gemelo de `BarridoExpiracionResponse` de US-012.
 */
import { ApiProperty } from '@nestjs/swagger';

export class BarridoEventosResponseDto {
  @ApiProperty({
    description:
      "Nº de RESERVA seleccionadas como candidatas del inicio de evento, cross-tenant: estado = 'reserva_confirmada' AND date(fecha_evento) = date(hoy) (T-0, fecha de calendario).",
    minimum: 0,
    example: 4,
  })
  candidatas!: number;

  @ApiProperty({
    description:
      'Nº de candidatas efectivamente transicionadas reserva_confirmada → evento_en_curso en esta ejecución (con las tres precondiciones cumplidas + AUDIT_LOG transición origen Sistema).',
    minimum: 0,
    example: 2,
  })
  eventosIniciados!: number;

  @ApiProperty({
    description:
      'Nº de candidatas que NO transicionaron por no cumplir las tres precondiciones (pre_evento_status=cerrado AND liquidacion_status=cobrada AND fianza_status=cobrada); generan alerta crítica al gestor (forzado manual US-032).',
    minimum: 0,
    example: 1,
  })
  precondicionesIncumplidas!: number;

  @ApiProperty({
    description:
      'Nº de candidatas cuya transición falló de forma aislada (rollback de su propia transacción, sin afectar al resto del lote).',
    minimum: 0,
    example: 0,
  })
  fallos!: number;
}

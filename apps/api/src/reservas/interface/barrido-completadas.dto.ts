/**
 * DTO de respuesta del barrido de ARCHIVADO AUTOMÁTICO en T+7d (US-037 / UC-28, §D-1).
 *
 * Shape EXACTA del contrato OpenAPI `BarridoCompletadasResponse`
 * (`{ candidatas, archivadas, fianzaPendiente, fallos }`): recuentos agregados de un
 * proceso de Sistema; no expone datos de negocio sensibles ni identificadores de RESERVA.
 * Gemelo de `BarridoEventosResponse` (US-031) y `BarridoExpiracionResponse` (US-012).
 */
import { ApiProperty } from '@nestjs/swagger';

export class BarridoCompletadasResponseDto {
  @ApiProperty({
    description:
      "Nº de RESERVA seleccionadas como candidatas del archivado, cross-tenant: estado = 'post_evento' AND antigüedad en post_evento ≥ 7 días naturales (T+7d, fecha de calendario, no por instante ni string formateado).",
    minimum: 0,
    example: 6,
  })
  candidatas!: number;

  @ApiProperty({
    description:
      "Nº de candidatas efectivamente archivadas (transicionadas post_evento → reserva_completada con la fianza resuelta + AUDIT_LOG accion='transicion' origen Sistema, causa='T+7d') en esta ejecución.",
    minimum: 0,
    example: 4,
  })
  archivadas!: number;

  @ApiProperty({
    description:
      'Nº de candidatas que NO se archivaron por tener la fianza sin resolver; por cada una se emite una alerta interna al gestor (FA-01) con anti-duplicación.',
    minimum: 0,
    example: 1,
  })
  fianzaPendiente!: number;

  @ApiProperty({
    description:
      'Nº de candidatas cuyo archivado falló de forma aislada (rollback de su propia transacción, sin afectar al resto del lote).',
    minimum: 0,
    example: 1,
  })
  fallos!: number;
}

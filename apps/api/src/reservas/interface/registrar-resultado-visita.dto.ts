/**
 * DTOs HTTP del registro del resultado de la visita: `PATCH /reservas/{id}/visita`
 * (US-009). Nombres camelCase ALINEADOS con el contrato OpenAPI congelado
 * (`ResultadoVisitaRequest`; respuesta 200 = `Reserva`). El cuerpo lleva el `resultado`
 * de la visita, modelado como enum polimórfico (`ResultadoVisita`): en US-009 SOLO
 * `interesado` está implementado. El formato del cuerpo (resultado presente y dentro
 * del enum del contrato) lo validan estos `class-validator` (400); el rechazo de un
 * resultado válido-pero-no-implementado (`descarta`, US-011) y la guarda de origen (no en
 * 2.v) los hace el use-case (422). US-010 habilita además `reserva_inmediata`
 * (2.v→pre_reserva); su validación de datos obligatorios UC-14 (422 con `camposFaltantes`)
 * también vive en el use-case.
 */
import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsString } from 'class-validator';

/** Valores del enum `ResultadoVisita` del contrato OpenAPI congelado (UC-08). */
export const RESULTADOS_VISITA = [
  'interesado',
  'reserva_inmediata',
  'descarta',
] as const;

/** Tipo del enum polimórfico de resultados de visita (contrato). */
export type ResultadoVisitaDto = (typeof RESULTADOS_VISITA)[number];

/** Cuerpo de la petición: `resultado` de la visita (enum polimórfico). */
export class RegistrarResultadoVisitaRequestDto {
  @ApiProperty({
    enum: RESULTADOS_VISITA,
    example: 'interesado',
    description:
      'Resultado de la visita. Soportados: `interesado` (US-009, transición 2.v→2.b con TTL fresco y E7) y `reserva_inmediata` (US-010, transición 2.v→pre_reserva con TTL de 7 días, vaciado de cola y validación de datos UC-14, sin email). `descarta` (US-011) aún no implementado → 422.',
  })
  @IsString()
  @IsIn(RESULTADOS_VISITA, {
    message: 'El resultado de la visita debe ser uno de: interesado, reserva_inmediata, descarta',
  })
  resultado!: ResultadoVisitaDto;
}

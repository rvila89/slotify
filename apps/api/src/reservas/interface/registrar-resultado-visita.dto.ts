/**
 * DTOs HTTP del registro del resultado de la visita: `PATCH /reservas/{id}/visita`
 * (US-009). Nombres camelCase ALINEADOS con el contrato OpenAPI congelado
 * (`ResultadoVisitaRequest`; respuesta 200 = `Reserva`). El cuerpo lleva el `resultado`
 * de la visita, modelado como enum polimórfico (`ResultadoVisita`): en US-009 SOLO
 * `interesado` está implementado. El formato del cuerpo (resultado presente y dentro
 * del enum del contrato) lo validan estos `class-validator` (400); el rechazo de un
 * resultado válido-pero-no-implementado (`reserva_inmediata`/`descarta`) y la guarda de
 * origen (no en 2.v) los hace el use-case (422).
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
      'Resultado de la visita. En US-009 solo `interesado` está soportado (transición 2.v→2.b con TTL fresco y E7); `reserva_inmediata`/`descarta` (US-010/US-011) aún no implementados → 422.',
  })
  @IsString()
  @IsIn(RESULTADOS_VISITA, {
    message: 'El resultado de la visita debe ser uno de: interesado, reserva_inmediata, descarta',
  })
  resultado!: ResultadoVisitaDto;
}

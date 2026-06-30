/**
 * DTOs HTTP de la transición «pendiente de invitados»: `POST
 * /reservas/{id}/pendiente-invitados` (US-007). Nombres camelCase ALINEADOS con el
 * contrato OpenAPI congelado (`PendienteInvitadosRequest`, `PendienteInvitadosResponse`,
 * `Reserva`). El cuerpo de la petición es vacío (la acción no toma parámetros; el TTL
 * se deriva de `TENANT_SETTINGS.ttl_consulta_dias`).
 */
import { ApiProperty } from '@nestjs/swagger';

/** Cuerpo vacío: la transición 2.b→2.c no requiere parámetros. */
export class PendienteInvitadosRequestDto {}

/** RESERVA actualizada (subEstado=`2c`, ttlExpiracion extendido). Subconjunto de `Reserva`. */
export class ReservaPendienteInvitadosDto {
  @ApiProperty({ format: 'uuid' })
  idReserva!: string;

  @ApiProperty({ format: 'uuid' })
  clienteId!: string;

  @ApiProperty({ enum: ['consulta'] })
  estado!: string;

  @ApiProperty({ enum: ['2c'], nullable: true })
  subEstado!: string | null;

  @ApiProperty({ type: String, format: 'date', nullable: true })
  fechaEvento!: string | null;

  @ApiProperty({ type: String, format: 'date-time', nullable: true })
  ttlExpiracion!: string | null;
}

/**
 * Respuesta 200 de la transición. Reutiliza la RESERVA (en `2c`) y añade
 * `consultasDescartadas`: recuento de RESERVA de cola (`2d`) pasadas a `2y` por el
 * vaciado A16, para el feedback de la UI (0 si no había cola).
 */
export class PendienteInvitadosResponseDto {
  @ApiProperty({ type: ReservaPendienteInvitadosDto })
  reserva!: ReservaPendienteInvitadosDto;

  @ApiProperty({ type: Number, minimum: 0, example: 3 })
  consultasDescartadas!: number;
}

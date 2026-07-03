/**
 * DTOs HTTP de la confirmación del pago de la señal (US-021 / UC-17):
 *   - `POST /reservas/{id}/confirmar-senal` (multipart/form-data, campo `justificante`).
 *
 * Nombres ALINEADOS con el contrato OpenAPI congelado (schema `ConfirmarSenalResponse`):
 * `reserva` (RESERVA elevada a `reserva_confirmada` con importes/sub-procesos),
 * `justificante` (DOCUMENTO creado) y `facturaSenalBorrador` (opcional, US-022). El
 * fichero se recibe por `multipart` (no en un DTO de body): lo procesa el `FileInterceptor`
 * del controlador. El `tenant_id`/`usuario_id` derivan del JWT, nunca del body.
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';

/** Cuerpo multipart: describe el campo binario `justificante` para Swagger. */
export class ConfirmarSenalRequestDto {
  @ApiProperty({
    type: 'string',
    format: 'binary',
    description:
      'Fichero justificante del pago de la señal (image/jpeg, image/png o application/pdf; ≤ 10 MB).',
  })
  justificante!: unknown;
}

/** RESERVA resultante en `reserva_confirmada` (subconjunto del schema Reserva). */
export class ReservaConfirmadaDto {
  @ApiProperty({ format: 'uuid' })
  idReserva!: string;

  @ApiProperty({ enum: ['reserva_confirmada'] })
  estado!: string;

  @ApiProperty({ type: String, nullable: true, example: null })
  ttlExpiracion!: string | null;

  @ApiProperty({ type: String, example: '1200.00' })
  importeSenal!: string;

  @ApiProperty({ type: String, example: '1800.00' })
  importeLiquidacion!: string;

  @ApiProperty({ enum: ['pendiente'] })
  preEventoStatus!: string;

  @ApiProperty({ enum: ['pendiente'] })
  liquidacionStatus!: string;

  @ApiProperty({ enum: ['pendiente'] })
  fianzaStatus!: string;
}

/** DOCUMENTO justificante creado (subconjunto del schema Documento). */
export class JustificanteDocumentoDto {
  @ApiProperty({ format: 'uuid' })
  idDocumento!: string;

  @ApiProperty({ enum: ['justificante_pago'] })
  tipo!: string;
}

/** Respuesta 200 de la confirmación de la señal. */
export class ConfirmarSenalResponseDto {
  @ApiProperty({ type: ReservaConfirmadaDto })
  reserva!: ReservaConfirmadaDto;

  @ApiProperty({ type: JustificanteDocumentoDto })
  justificante!: JustificanteDocumentoDto;

  @ApiPropertyOptional({
    type: Object,
    nullable: true,
    description:
      'OPCIONAL — factura de señal en borrador presentada post-commit (US-022). Se omite en US-021.',
  })
  facturaSenalBorrador?: unknown;
}

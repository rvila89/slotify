/**
 * DTOs HTTP del registro de la firma de las condiciones particulares (US-024 / UC-19
 * segundo flujo):
 *   - `POST /reservas/{id}/condiciones-firmadas` (multipart/form-data, campo
 *     `condicionesFirmadas`).
 *
 * Nombres ALINEADOS con el contrato OpenAPI congelado (`RegistrarCondicionesFirmadasResponse`):
 * `reserva` (RESERVA completa, reutilizando el read-DTO `ReservaDetalleResponseDto` en
 * producción — la fecha de firma viaja como `condPartFechaFirma`, NO `condPartFirmadasFecha`)
 * y `documentoFirmado` (DOCUMENTO creado). El fichero se recibe por `multipart` (no en un
 * DTO de body): lo procesa el `FileInterceptor` del controlador. El `tenant_id`/`usuario_id`
 * derivan del JWT, nunca del body.
 */
import { ApiProperty } from '@nestjs/swagger';
import { ReservaDetalleResponseDto } from '../../reservas/interface/reserva-detalle.dto';

/** Cuerpo multipart: describe el campo binario `condicionesFirmadas` para Swagger. */
export class RegistrarCondicionesFirmadasRequestDto {
  @ApiProperty({
    type: 'string',
    format: 'binary',
    description:
      'Copia firmada de las condiciones particulares (image/jpeg, image/png o application/pdf; ≤ 10 MB).',
  })
  condicionesFirmadas!: unknown;
}

/** DOCUMENTO firmado creado (subconjunto del schema Documento). */
export class DocumentoFirmadoDto {
  @ApiProperty({ format: 'uuid' })
  idDocumento!: string;

  @ApiProperty({ type: String, format: 'uuid', nullable: true })
  reservaId!: string | null;

  @ApiProperty({ enum: ['condiciones_particulares'] })
  tipo!: string;

  @ApiProperty()
  url!: string;

  @ApiProperty()
  mimeType!: string;
}

/** Respuesta 200 del registro de la firma. */
export class RegistrarCondicionesFirmadasResponseDto {
  @ApiProperty({ type: ReservaDetalleResponseDto })
  reserva!: ReservaDetalleResponseDto;

  @ApiProperty({ type: DocumentoFirmadoDto })
  documentoFirmado!: DocumentoFirmadoDto;
}

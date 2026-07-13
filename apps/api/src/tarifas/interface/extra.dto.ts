/**
 * DTO de respuesta del catálogo de extras (`GET /extras` → `Extra[]`, US-014).
 * Alineado al esquema `Extra` del contrato OpenAPI (`docs/api-spec.yml`):
 * `precioUnitario` es un `Importe` (Decimal(10,2) serializado como string, p. ej.
 * "30.00") para no perder precisión. El controlador mapea `precioEur → precioUnitario`.
 */
import { ApiProperty } from '@nestjs/swagger';

export class ExtraDto {
  @ApiProperty({ format: 'uuid' })
  idExtra!: string;

  @ApiProperty()
  nombre!: string;

  @ApiProperty({ type: String, nullable: true })
  descripcion!: string | null;

  @ApiProperty({ example: '30.00', description: 'Precio unitario (Importe, Decimal(10,2) como string).' })
  precioUnitario!: string;

  @ApiProperty()
  activo!: boolean;
}

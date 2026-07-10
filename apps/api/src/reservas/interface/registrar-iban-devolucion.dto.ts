/**
 * DTOs HTTP de la acción `PATCH /reservas/{id}/iban-devolucion` (US-035 / UC-26, UC-27).
 * Nombres camelCase ALINEADOS con el contrato OpenAPI congelado
 * (`RegistrarIbanDevolucionRequest`, `RegistrarIbanDevolucionAvisoEmail`,
 * `RegistrarIbanDevolucionResponse`).
 *
 * El cuerpo lleva SOLO el `iban` (el único parámetro de negocio; tenant/usuario del JWT,
 * reserva del path). El `pattern` es un PRE-FILTRO laxo de formato (400 si no lo cumple);
 * la validación real de checksum mod-97 vive en el dominio y devuelve 422 (FA-01). La
 * respuesta es de solo salida (sin `class-validator`).
 */
import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsString, Matches, MaxLength, MinLength } from 'class-validator';

/** Cuerpo de la petición: el IBAN a registrar (pre-filtro de formato laxo). */
export class RegistrarIbanDevolucionRequestDto {
  @ApiProperty({
    minLength: 15,
    maxLength: 34,
    pattern: '^[A-Za-z]{2}[0-9]{2}[A-Za-z0-9 ]{11,30}$',
    example: 'ES9121000418450200051332',
    description:
      'IBAN a registrar (se normaliza en servidor: mayúsculas, sin espacios). Se valida por checksum módulo 97 antes de persistir; un IBAN que no supere mod-97 devuelve 422 (FA-01).',
  })
  @IsString()
  @MinLength(15)
  @MaxLength(34)
  @Matches(/^[A-Za-z]{2}[0-9]{2}[A-Za-z0-9 ]{11,30}$/, {
    message: 'El formato del IBAN no es válido',
  })
  iban!: string;
}

/** Aviso de FA-03: el IBAN se guardó pero E8 no pudo enviarse (`RegistrarIbanDevolucionAvisoEmail`). */
export class RegistrarIbanDevolucionAvisoEmailDto {
  @ApiProperty({
    enum: ['e8_fallido'],
    description:
      'Discriminador del aviso: el envío de E8 falló en el proveedor (IBAN sí guardado).',
    example: 'e8_fallido',
  })
  codigo!: 'e8_fallido';

  @ApiProperty({
    type: String,
    description: 'Mensaje para mostrar al gestor.',
    example: 'IBAN guardado, pero E8 no pudo enviarse. Puedes reenviarlo desde la ficha.',
  })
  mensaje!: string;

  @ApiPropertyOptional({
    type: String,
    format: 'uuid',
    nullable: true,
    description:
      "ID de la COMUNICACION E8 en estado='fallido', para el reenvío desde la ficha.",
  })
  comunicacionId!: string | null;
}

/**
 * Respuesta 200 (`RegistrarIbanDevolucionResponse`). `iban` es el valor normalizado
 * persistido en `CLIENTE.iban_devolucion`; `avisoEmail` es `null` cuando E8 se envió con
 * éxito, o el aviso de FA-03 cuando el IBAN quedó guardado pero E8 falló. Solo de salida.
 */
export class RegistrarIbanDevolucionResponseDto {
  @ApiProperty({
    type: String,
    description:
      'IBAN normalizado (mayúsculas, sin espacios) persistido en CLIENTE.iban_devolucion.',
    example: 'ES9121000418450200051332',
  })
  iban!: string;

  @ApiPropertyOptional({
    type: RegistrarIbanDevolucionAvisoEmailDto,
    nullable: true,
    description:
      'Aviso de FA-03: nulo cuando E8 se envió correctamente; presente cuando el IBAN quedó guardado pero E8 falló.',
  })
  avisoEmail!: RegistrarIbanDevolucionAvisoEmailDto | null;
}

/**
 * DTOs HTTP de la acción `PATCH /reservas/{id}/datos-fiscales` (US-014 #5, Parte B / UC-14).
 * Nombres camelCase ALINEADOS con el contrato OpenAPI congelado
 * (`ActualizarDatosFiscalesClienteRequest`, `ActualizarDatosFiscalesClienteResponse`).
 *
 * El cuerpo lleva los CINCO campos fiscales del CLIENTE, TODOS opcionales (PATCH parcial, D-2):
 * solo los presentes se persisten; los ausentes no se tocan. `tenant_id`/`usuario_id` viajan
 * SIEMPRE en el JWT (nunca en el body); la RESERVA en el path.
 *
 * Validación (contrato):
 *   - `minLength: 1` por campo (cadena vacía → 400).
 *   - `minProperties: 1`: al menos un campo fiscal (body vacío `{}` → 400) — decorador de clase.
 *   - `additionalProperties: false`: campos ajenos → 400 (lo aplica `forbidNonWhitelisted` del
 *     `ValidationPipe` global).
 * La respuesta es de solo salida (sin `class-validator`).
 */
import { ApiPropertyOptional, ApiProperty } from '@nestjs/swagger';
import {
  IsOptional,
  IsString,
  MinLength,
  registerDecorator,
  type ValidationOptions,
} from 'class-validator';

/**
 * Decorador de CLASE que exige `minProperties: 1`: el objeto debe traer al menos un campo fiscal
 * definido (rechaza el body vacío `{}` → 400). Se apoya en `class-validator` puro (sin acceder a
 * infraestructura).
 */
const AlMenosUnCampoFiscal = (opciones?: ValidationOptions) => {
  return (constructor: new (...args: unknown[]) => object) => {
    registerDecorator({
      name: 'alMenosUnCampoFiscal',
      target: constructor,
      // Validador de nivel de clase: se ancla a una propiedad "virtual"; `validate` inspecciona
      // el objeto completo (`args.object`) para exigir al menos un campo fiscal definido.
      propertyName: 'alMenosUnCampoFiscal',
      options: {
        message: 'Debe enviarse al menos un campo fiscal a actualizar',
        ...opciones,
      },
      validator: {
        validate(_valor: unknown, args): boolean {
          const objeto = args?.object as Record<string, unknown>;
          return (
            objeto !== undefined &&
            objeto !== null &&
            Object.keys(objeto).some((clave) => objeto[clave] !== undefined)
          );
        },
      },
    });
  };
};

/** Cuerpo de la petición: los cinco campos fiscales del CLIENTE, todos opcionales (PATCH parcial). */
@AlMenosUnCampoFiscal()
export class ActualizarDatosFiscalesClienteRequestDto {
  @ApiPropertyOptional({ type: String, minLength: 1, description: 'DNI/NIF fiscal del cliente.' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  dniNif?: string;

  @ApiPropertyOptional({ type: String, minLength: 1, description: 'Dirección fiscal del cliente.' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  direccion?: string;

  @ApiPropertyOptional({
    type: String,
    minLength: 1,
    description: 'Código postal fiscal del cliente.',
  })
  @IsOptional()
  @IsString()
  @MinLength(1)
  codigoPostal?: string;

  @ApiPropertyOptional({ type: String, minLength: 1, description: 'Población fiscal del cliente.' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  poblacion?: string;

  @ApiPropertyOptional({ type: String, minLength: 1, description: 'Provincia fiscal del cliente.' })
  @IsOptional()
  @IsString()
  @MinLength(1)
  provincia?: string;
}

/**
 * Respuesta 200 (`ActualizarDatosFiscalesClienteResponse`): estado resultante de los cinco campos
 * fiscales del CLIENTE tras el PATCH parcial (presentes actualizados; ausentes con su valor
 * previo). Cada campo puede seguir siendo `null` si aún no se ha informado. Solo de salida.
 */
export class ActualizarDatosFiscalesClienteResponseDto {
  @ApiProperty({ type: String, nullable: true, description: 'DNI/NIF fiscal persistido del cliente.' })
  dniNif!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Dirección fiscal persistida del cliente.',
  })
  direccion!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Código postal fiscal persistido del cliente.',
  })
  codigoPostal!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Población fiscal persistida del cliente.',
  })
  poblacion!: string | null;

  @ApiProperty({
    type: String,
    nullable: true,
    description: 'Provincia fiscal persistida del cliente.',
  })
  provincia!: string | null;
}

/**
 * DTO de entrada de `POST /auth/login` (US-001). Coincide con `LoginRequest` del
 * contrato OpenAPI. La validación (`class-validator`) la aplica el `ValidationPipe`
 * global. La contraseña nunca se loguea ni se devuelve.
 */
import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class LoginDto {
  @ApiProperty({ example: 'info@masialencis.com', description: 'Email del usuario' })
  @IsEmail({}, { message: 'El email no tiene un formato válido' })
  email!: string;

  @ApiProperty({ example: 'Slotify2026!', description: 'Contraseña en claro' })
  @IsString()
  @IsNotEmpty({ message: 'La contraseña es obligatoria' })
  password!: string;
}

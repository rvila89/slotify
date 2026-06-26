/**
 * Controlador de auth (esqueleto). Expone un endpoint protegido `GET /api/auth/me`
 * que sirve para verificar el `JwtAuthGuard` global (401 sin token).
 */
import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { UsuarioAutenticado } from '../../shared/auth/usuario-autenticado';

@ApiTags('auth')
@ApiBearerAuth()
@Controller('auth')
export class AuthController {
  @Get('me')
  @ApiOperation({ summary: 'Devuelve el usuario autenticado del token' })
  yo(@CurrentUser() usuario: UsuarioAutenticado): UsuarioAutenticado {
    return usuario;
  }
}

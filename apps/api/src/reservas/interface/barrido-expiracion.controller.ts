/**
 * Controlador del endpoint INTERNO PROTEGIDO de barrido de expiración por TTL:
 * `POST /api/cron/barrido-expiracion` (US-012 / UC-09, §D-1/§D-2).
 *
 * Superficie invocable por el cron scheduler (`@nestjs/schedule`) y —para pruebas/
 * disparo manual— por `curl`. Autenticación SERVICE-TO-SERVICE vía `CronTokenGuard`
 * (`X-Cron-Token`), NO el JWT de usuario: se marca `@Public()` para que el
 * `JwtAuthGuard` GLOBAL no lo intercepte, y se protege exclusivamente con el
 * `CronTokenGuard`. Sin token válido → 401 (el guard lanza `UnauthorizedException`).
 *
 * El endpoint solo DISPARA el caso de uso `ExpirarConsultasVencidasService` y devuelve
 * su resumen (`{ candidatas, expiradas, promocionesDisparadas, fallos }`, contrato
 * `BarridoExpiracionResponse`); toda la lógica de barrido (idempotente, atómica por
 * RESERVA con fallo aislado) vive en la aplicación/infra. Es idempotente (D-4).
 */
import { Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import {
  ApiOperation,
  ApiResponse,
  ApiSecurity,
  ApiTags,
} from '@nestjs/swagger';
import { Public } from '../../shared/auth/public.decorator';
import { CronTokenGuard } from '../../shared/auth/cron-token.guard';
import { ExpirarConsultasVencidasService } from '../application/expirar-consultas-vencidas.service';
import { BarridoExpiracionResponseDto } from './barrido-expiracion.dto';

@ApiTags('Cron')
@ApiSecurity('cronToken')
@Controller('cron')
export class BarridoExpiracionController {
  constructor(private readonly useCase: ExpirarConsultasVencidasService) {}

  @Post('barrido-expiracion')
  @Public()
  @UseGuards(CronTokenGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Barrido de expiración por TTL agotado (A4/A5/A21) — endpoint interno protegido (UC-09 / US-012)',
  })
  @ApiResponse({ status: 200, type: BarridoExpiracionResponseDto })
  @ApiResponse({ status: 401, description: 'X-Cron-Token ausente o inválido' })
  async barrer(): Promise<BarridoExpiracionResponseDto> {
    return this.useCase.ejecutar();
  }
}

/**
 * Controlador del endpoint INTERNO PROTEGIDO de barrido de CIERRE AUTOMÁTICO de ficha
 * operativa en T-1d: `POST /api/cron/barrido?tarea=fichas` (US-026 / UC-20 FA-01,
 * §D-1/§D-2, Opción A).
 *
 * Superficie invocable por el cron scheduler (`@nestjs/schedule`) y —para pruebas/
 * disparo manual— por `curl`. Autenticación SERVICE-TO-SERVICE vía `CronTokenGuard`
 * (`X-Cron-Token`), NO el JWT de usuario: se marca `@Public()` para que el
 * `JwtAuthGuard` GLOBAL no lo intercepte, y se protege exclusivamente con el
 * `CronTokenGuard`. Sin token válido (o con un `Authorization: Bearer …` sin la cabecera
 * de cron) → 401.
 *
 * El endpoint solo DISPARA el caso de uso `CerrarFichasVencidasService` y devuelve su
 * resumen bajo la clave `fichas` (shape del contrato `BarridoResponse` con
 * `BarridoFichasResumen`, Opción A); toda la lógica de barrido (idempotente, atómica por
 * RESERVA con fallo aislado) vive en la aplicación/infra. Es idempotente (D-4).
 */
import { Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Public } from '../../shared/auth/public.decorator';
import { CronTokenGuard } from '../../shared/auth/cron-token.guard';
import { CerrarFichasVencidasService } from '../application/cerrar-fichas-vencidas.service';
import { BarridoResponseDto } from './barrido-fichas.dto';

@ApiTags('Cron')
@ApiSecurity('cronToken')
@Controller('cron')
export class BarridoFichasController {
  constructor(private readonly useCase: CerrarFichasVencidasService) {}

  @Post('barrido')
  @Public()
  @UseGuards(CronTokenGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Barrido de cierre automático de ficha operativa en T-1d (A10) — endpoint interno protegido (UC-20 / US-026)',
  })
  @ApiResponse({ status: 200, type: BarridoResponseDto })
  @ApiResponse({ status: 401, description: 'X-Cron-Token ausente o inválido' })
  async barrer(): Promise<BarridoResponseDto> {
    const fichas = await this.useCase.ejecutar();
    return { fichas };
  }
}

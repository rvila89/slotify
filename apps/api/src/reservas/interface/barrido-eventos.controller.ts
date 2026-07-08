/**
 * Controlador del endpoint INTERNO PROTEGIDO del barrido de INICIO AUTOMÁTICO de evento
 * en T-0: `POST /api/cron/barrido-eventos` (US-031 / UC-23, §D-1/§D-2).
 *
 * Endpoint DEDICADO (D-2 Opción B, resuelto 2026-07-07), gemelo del
 * `POST /cron/barrido-expiracion` de US-012, en el MISMO módulo `reservas`. Superficie
 * invocable por el cron scheduler (`@nestjs/schedule`) y —para pruebas/disparo manual—
 * por `curl`. Autenticación SERVICE-TO-SERVICE vía `CronTokenGuard` (`X-Cron-Token`), NO
 * el JWT de usuario: se marca `@Public()` para que el `JwtAuthGuard` GLOBAL no lo
 * intercepte, y se protege exclusivamente con el `CronTokenGuard`. Sin token válido → 401.
 *
 * El endpoint solo DISPARA el caso de uso `IniciarEventosDelDiaService` y devuelve su
 * resumen DIRECTAMENTE (`{ candidatas, eventosIniciados, precondicionesIncumplidas,
 * fallos }`, contrato `BarridoEventosResponse`); toda la lógica de barrido (idempotente,
 * atómica por RESERVA con fallo aislado) vive en la aplicación/infra. Es idempotente (D-4).
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
import { IniciarEventosDelDiaService } from '../application/iniciar-eventos-del-dia.service';
import { BarridoEventosResponseDto } from './barrido-eventos.dto';

@ApiTags('Cron')
@ApiSecurity('cronToken')
@Controller('cron')
export class BarridoEventosController {
  constructor(private readonly useCase: IniciarEventosDelDiaService) {}

  @Post('barrido-eventos')
  @Public()
  @UseGuards(CronTokenGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Barrido de inicio automático de evento en T-0 — endpoint interno protegido (UC-23 / US-031)',
  })
  @ApiResponse({ status: 200, type: BarridoEventosResponseDto })
  @ApiResponse({ status: 401, description: 'X-Cron-Token ausente o inválido' })
  async barrer(): Promise<BarridoEventosResponseDto> {
    return this.useCase.ejecutar();
  }
}

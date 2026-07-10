/**
 * Controlador del endpoint INTERNO PROTEGIDO del barrido de ARCHIVADO AUTOMÁTICO en T+7d:
 * `POST /api/cron/barrido-completadas` (US-037 / UC-28, §D-1).
 *
 * Endpoint DEDICADO NUEVO (regla dura + memoria "Cron ?tarea= dispatch es ficticio"),
 * gemelo del `POST /cron/barrido-eventos` de US-031 y `POST /cron/barrido-expiracion` de
 * US-012, en el MISMO módulo `reservas`. PROHIBIDO reutilizar `POST /cron/barrido` ni el
 * dispatch por `?tarea=`. Superficie invocable por el cron scheduler (`@nestjs/schedule`)
 * y —para pruebas/disparo manual— por `curl`. Autenticación SERVICE-TO-SERVICE vía
 * `CronTokenGuard` (`X-Cron-Token`), NO el JWT de usuario: se marca `@Public()` para que el
 * `JwtAuthGuard` GLOBAL no lo intercepte, y se protege exclusivamente con el
 * `CronTokenGuard`. Sin token válido → 401.
 *
 * El endpoint solo DISPARA el caso de uso `ArchivarReservasCompletadasService` y devuelve su
 * resumen DIRECTAMENTE (`{ candidatas, archivadas, fianzaPendiente, fallos }`, contrato
 * `BarridoCompletadasResponse`); toda la lógica de barrido (idempotente, atómica por RESERVA
 * con fallo aislado) vive en la aplicación/infra.
 */
import { Controller, HttpCode, HttpStatus, Post, UseGuards } from '@nestjs/common';
import { ApiOperation, ApiResponse, ApiSecurity, ApiTags } from '@nestjs/swagger';
import { Public } from '../../shared/auth/public.decorator';
import { CronTokenGuard } from '../../shared/auth/cron-token.guard';
import { ArchivarReservasCompletadasService } from '../application/archivar-reservas-completadas.service';
import { BarridoCompletadasResponseDto } from './barrido-completadas.dto';

@ApiTags('Cron')
@ApiSecurity('cronToken')
@Controller('cron')
export class BarridoCompletadasController {
  constructor(private readonly useCase: ArchivarReservasCompletadasService) {}

  @Post('barrido-completadas')
  @Public()
  @UseGuards(CronTokenGuard)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary:
      'Barrido de archivado automático a reserva_completada en T+7d — endpoint interno protegido (UC-28 / US-037)',
  })
  @ApiResponse({ status: 200, type: BarridoCompletadasResponseDto })
  @ApiResponse({ status: 401, description: 'X-Cron-Token ausente o inválido' })
  async barrer(): Promise<BarridoCompletadasResponseDto> {
    return this.useCase.ejecutar();
  }
}

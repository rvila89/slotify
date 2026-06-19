/** Endpoint de salud público: `GET /api/health` -> `{ status: "ok" }`. */
import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../shared/auth/public.decorator';

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Public()
  @Get()
  @ApiOperation({ summary: 'Comprobación de salud de la API' })
  @ApiOkResponse({ schema: { example: { status: 'ok' } } })
  comprobar(): { status: string } {
    return { status: 'ok' };
  }
}

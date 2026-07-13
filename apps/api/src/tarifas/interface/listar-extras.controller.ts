/**
 * Controlador del catálogo de extras: `GET /api/extras` (US-014).
 *
 * Devuelve el catálogo de EXTRAS activos del tenant para alimentar el selector del
 * borrador de presupuesto (frontend `useExtras`). El `tenant_id` SIEMPRE deriva del
 * JWT (`@TenantId`), nunca del path/body (multi-tenancy). Restringido a `gestor`,
 * consistente con el resto del flujo de presupuesto.
 *
 * Traduce el read-model de dominio (`precioEur` en euros) al contrato: `precioUnitario`
 * es un `Importe` (Decimal(10,2) serializado como string, "30.00").
 */
import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TenantId } from '../../shared/decorators/tenant-id.decorator';
import { Roles } from '../../shared/auth/roles.decorator';
import { RolesGuard } from '../../shared/auth/roles.guard';
import { ListarExtrasUseCase } from '../application/listar-extras.use-case';
import { ExtraDto } from './extra.dto';

@ApiTags('Presupuestos')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles('gestor')
@Controller('extras')
export class ListarExtrasController {
  constructor(private readonly useCase: ListarExtrasUseCase) {}

  @Get()
  @ApiOperation({ summary: 'Listar catálogo de extras del tenant (US-014)' })
  @ApiOkResponse({ type: [ExtraDto] })
  async listar(@TenantId() tenantId: string): Promise<ExtraDto[]> {
    const extras = await this.useCase.ejecutar(tenantId);
    return extras.map((extra) => ({
      idExtra: extra.idExtra,
      nombre: extra.nombre,
      descripcion: extra.descripcion,
      precioUnitario: extra.precioEur.toFixed(2),
      activo: extra.activo,
    }));
  }
}

/**
 * Controlador del motor de tarifa: `POST /api/tarifas/calcular` (US-016 / UC-16).
 *
 * Traduce el contrato HTTP (snake_case, D-1) ↔ dominio (camelCase) y mapea los
 * errores de dominio tipados a códigos HTTP:
 *   ValidacionTarifaError        → 400
 *   ExtraNoEncontradoError       → 404 (codigo + detalle)
 *   TemporadaNoConfiguradaError  → 422 (codigo + detalle)
 *   TarifaNoConfiguradaError     → 422 (codigo + detalle)
 * El `tenant_id` SIEMPRE deriva del JWT (`@TenantId`), nunca del body.
 */
import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpException,
  HttpStatus,
  NotFoundException,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TenantId } from '../../shared/decorators/tenant-id.decorator';
import {
  CalculadoraTarifaService,
  CalcularTarifaInput,
  CalculoTarifaResultado,
  ExtraNoEncontradoError,
  TarifaNoConfiguradaError,
  TemporadaNoConfiguradaError,
  ValidacionTarifaError,
} from '../domain/calculadora-tarifa.service';
import {
  CalculoTarifaRequestDto,
  CalculoTarifaResponseDto,
} from './calcular-tarifa.dto';

@ApiTags('Presupuestos')
@ApiBearerAuth()
@Controller('tarifas')
export class TarifasController {
  constructor(private readonly calculadora: CalculadoraTarifaService) {}

  @Post('calcular')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Calcular tarifa según configuración (UC-16 / US-016)' })
  async calcular(
    @Body() dto: CalculoTarifaRequestDto,
    @TenantId() tenantId: string,
  ): Promise<CalculoTarifaResponseDto> {
    const input: CalcularTarifaInput = {
      fechaEvento: new Date(dto.fecha_evento),
      duracionHoras: dto.duracion_horas,
      numAdultosNinosMayores4: dto.num_adultos_ninos_mayores4,
      extras: (dto.extras ?? []).map((e) => ({
        extraId: e.extra_id,
        cantidad: e.cantidad,
      })),
    };

    try {
      const resultado = await this.calculadora.calcular(input, tenantId);
      return this.aResponse(resultado);
    } catch (error) {
      throw this.aHttp(error);
    }
  }

  private aResponse(r: CalculoTarifaResultado): CalculoTarifaResponseDto {
    return {
      temporada: r.temporada,
      tarifa_a_consultar: r.tarifaAConsultar,
      precio_tarifa_eur: r.precioTarifaEur,
      extras_total_eur: r.extrasTotalEur,
      total_eur: r.totalEur,
      tarifa_id: r.tarifaId,
    };
  }

  private aHttp(error: unknown): HttpException {
    if (error instanceof ValidacionTarifaError) {
      return new BadRequestException({
        statusCode: HttpStatus.BAD_REQUEST,
        error: 'Bad Request',
        message: error.message,
        codigo: error.codigo,
        detalle: { campo: error.campo },
      });
    }
    if (error instanceof ExtraNoEncontradoError) {
      return new NotFoundException({
        statusCode: HttpStatus.NOT_FOUND,
        error: 'Not Found',
        message: error.message,
        codigo: error.codigo,
        detalle: { extra_id: error.extraId, motivo: error.motivo },
      });
    }
    if (error instanceof TemporadaNoConfiguradaError) {
      return new HttpException(
        {
          statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
          error: 'Unprocessable Entity',
          message: error.message,
          codigo: error.codigo,
          detalle: { mes: error.mes },
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (error instanceof TarifaNoConfiguradaError) {
      return new HttpException(
        {
          statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
          error: 'Unprocessable Entity',
          message: error.message,
          codigo: error.codigo,
          detalle: {
            temporada: error.temporada,
            duracion_horas: error.duracionHoras,
            num_invitados: error.numInvitados,
          },
        },
        HttpStatus.UNPROCESSABLE_ENTITY,
      );
    }
    if (error instanceof HttpException) {
      return error;
    }
    return new HttpException(
      'Error interno del servidor',
      HttpStatus.INTERNAL_SERVER_ERROR,
    );
  }
}

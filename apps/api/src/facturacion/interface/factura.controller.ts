/**
 * Controladores HTTP de la capability `facturacion` (US-022 / UC-18). Traducen el contrato
 * congelado (`docs/api-spec.yml`, tag `Facturacion`) ↔ comandos de aplicación:
 *   - GET  /reservas/{id}/factura-senal   → 200 FacturaSenalDto | 404
 *   - POST /facturas/{id}/aprobar         → 200 | 409 FACTURA_NO_BORRADOR | 422 (datos/pdf) | 404
 *   - POST /facturas/{id}/rechazar        → 200 | 400 | 409 | 404
 *   - POST /facturas/{id}/regenerar-pdf   → 200 | 409 | 422 | 404
 *
 * El `tenant_id` y el `usuario_id` SIEMPRE derivan del JWT (`@CurrentUser`), nunca del
 * path/body (multi-tenancy). Mapeo de errores de dominio (F5-02): 409 FacturaNoBorrador,
 * 422 DatosFiscalesIncompletos/PdfPendiente, 404 no encontrada, 400 motivo requerido.
 */
import {
  BadRequestException,
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  NotFoundException,
  Param,
  Post,
  Query,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { Roles } from '../../shared/auth/roles.decorator';
import { RolesGuard } from '../../shared/auth/roles.guard';
import type { UsuarioAutenticado } from '../../shared/auth/usuario-autenticado';
import {
  ObtenerFacturaSenalUseCase,
  FacturaSenalNoEncontradaError,
} from '../application/obtener-factura-senal.use-case';
import { AprobarFacturaUseCase } from '../application/aprobar-factura.use-case';
import {
  DatosFiscalesIncompletosError,
  FacturaNoBorradorError,
  FacturaNoEncontradaError,
  PdfPendienteError,
} from '../application/aprobar-factura.use-case';
import {
  RechazarFacturaUseCase,
  MotivoRequeridoError,
} from '../application/rechazar-factura.use-case';
import { RegenerarPdfFacturaUseCase } from '../application/regenerar-pdf-factura.use-case';
import {
  ListarFacturasReservaUseCase,
  ReservaFacturasNoEncontradaError,
  type FacturaListada,
  type TipoFacturaListado,
} from '../application/listar-facturas-reserva.use-case';
import type { FacturaSenalResultado } from '../application/generar-factura-senal.use-case';
import {
  AprobarFacturaRequestDto,
  FacturaDto,
  FacturaSenalDto,
  RechazarFacturaRequestDto,
  RegenerarPdfFacturaRequestDto,
} from './factura.dto';

/** Tipos de factura admitidos por el filtro `?tipo=`. */
const TIPOS_FACTURA: ReadonlyArray<TipoFacturaListado> = [
  'senal',
  'liquidacion',
  'fianza',
  'complementaria',
];

/** Mapea una factura listada al DTO del contrato (colección). */
const aFacturaDto = (f: FacturaListada): FacturaDto => ({
  idFactura: f.idFactura,
  reservaId: f.reservaId,
  numeroFactura: f.numeroFactura,
  tipo: f.tipo,
  baseImponible: f.baseImponible,
  ivaPorcentaje: f.ivaPorcentaje,
  ivaImporte: f.ivaImporte,
  total: f.total,
  concepto: f.concepto,
  pdfUrl: f.pdfUrl,
  estado: f.estado,
  fechaEmision: f.fechaEmision === null ? null : f.fechaEmision.toISOString(),
  fechaCreacion: f.fechaCreacion.toISOString(),
  // Borradores de liquidación/fianza no derivan estos flags fiscales (propios de la señal).
  esBorradorInvalido: false,
  pdfPendiente: f.pdfUrl === null && f.estado !== 'borrador',
});

/** Mapea el resultado de aplicación al DTO del contrato. */
const aDto = (r: FacturaSenalResultado): FacturaSenalDto => ({
  idFactura: r.idFactura,
  reservaId: r.reservaId,
  numeroFactura: r.numeroFactura,
  tipo: r.tipo,
  baseImponible: r.baseImponible,
  ivaPorcentaje: r.ivaPorcentaje,
  ivaImporte: r.ivaImporte,
  total: r.total,
  concepto: undefined,
  pdfUrl: r.pdfUrl,
  estado: r.estado,
  fechaEmision: r.fechaEmision === null ? null : r.fechaEmision.toISOString(),
  esBorradorInvalido: r.esBorradorInvalido,
  pdfPendiente: r.pdfPendiente,
});

@ApiTags('Facturacion')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles('gestor')
@Controller()
export class FacturaController {
  constructor(
    private readonly obtenerFacturaSenal: ObtenerFacturaSenalUseCase,
    private readonly aprobarFactura: AprobarFacturaUseCase,
    private readonly rechazarFactura: RechazarFacturaUseCase,
    private readonly regenerarPdfFactura: RegenerarPdfFacturaUseCase,
    private readonly listarFacturasReserva: ListarFacturasReservaUseCase,
  ) {}

  @Get('reservas/:id/facturas')
  @ApiOperation({
    summary: 'Listar las facturas de la reserva, filtrables por tipo (US-027 / UC-21, UC-22)',
  })
  @ApiQuery({
    name: 'tipo',
    required: false,
    enum: ['senal', 'liquidacion', 'fianza', 'complementaria'],
  })
  async listar(
    @Param('id') id: string,
    @CurrentUser() usuario: UsuarioAutenticado,
    @Query('tipo') tipo?: string,
  ): Promise<FacturaDto[]> {
    const tipoFiltro = this.validarTipo(tipo);
    try {
      const facturas = await this.listarFacturasReserva.ejecutar({
        tenantId: usuario.tenantId,
        reservaId: id,
        tipo: tipoFiltro,
      });
      return facturas.map(aFacturaDto);
    } catch (error) {
      this.aHttp(error);
    }
  }

  @Get('reservas/:id/factura-senal')
  @ApiOperation({ summary: 'Obtener la factura de señal de una reserva (UC-18 / US-022)' })
  async obtener(
    @Param('id') id: string,
    @CurrentUser() usuario: UsuarioAutenticado,
  ): Promise<FacturaSenalDto> {
    try {
      const resultado = await this.obtenerFacturaSenal.ejecutar({
        tenantId: usuario.tenantId,
        reservaId: id,
      });
      return aDto(resultado);
    } catch (error) {
      this.aHttp(error);
    }
  }

  @Post('facturas/:id/aprobar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Aprobar el borrador (borrador → enviada) (UC-18 / US-022)' })
  async aprobar(
    @Param('id') id: string,
    @Body() _body: AprobarFacturaRequestDto,
    @CurrentUser() usuario: UsuarioAutenticado,
  ): Promise<FacturaSenalDto> {
    try {
      await this.aprobarFactura.ejecutar({
        tenantId: usuario.tenantId,
        usuarioId: usuario.sub,
        facturaId: id,
      });
      return aDto(
        await this.obtenerFacturaSenal.ejecutarPorFactura({
          tenantId: usuario.tenantId,
          facturaId: id,
        }),
      );
    } catch (error) {
      this.aHttp(error);
    }
  }

  @Post('facturas/:id/rechazar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Rechazar el borrador con motivo (UC-18 / US-022)' })
  async rechazar(
    @Param('id') id: string,
    @Body() body: RechazarFacturaRequestDto,
    @CurrentUser() usuario: UsuarioAutenticado,
  ): Promise<FacturaSenalDto> {
    try {
      await this.rechazarFactura.ejecutar({
        tenantId: usuario.tenantId,
        usuarioId: usuario.sub,
        facturaId: id,
        motivo: body.motivo,
      });
      return aDto(
        await this.obtenerFacturaSenal.ejecutarPorFactura({
          tenantId: usuario.tenantId,
          facturaId: id,
        }),
      );
    } catch (error) {
      this.aHttp(error);
    }
  }

  @Post('facturas/:id/regenerar-pdf')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reintentar la generación del PDF (UC-18 / US-022)' })
  async regenerarPdf(
    @Param('id') id: string,
    @Body() _body: RegenerarPdfFacturaRequestDto,
    @CurrentUser() usuario: UsuarioAutenticado,
  ): Promise<FacturaSenalDto> {
    try {
      const resultado = await this.regenerarPdfFactura.ejecutar({
        tenantId: usuario.tenantId,
        usuarioId: usuario.sub,
        facturaId: id,
      });
      return aDto(resultado);
    } catch (error) {
      this.aHttp(error);
    }
  }

  /** Valida el filtro `?tipo=` (400 si no es un tipo conocido); undefined si se omite. */
  private validarTipo(tipo?: string): TipoFacturaListado | undefined {
    if (tipo === undefined || tipo === '') {
      return undefined;
    }
    if (!TIPOS_FACTURA.includes(tipo as TipoFacturaListado)) {
      throw new BadRequestException({
        statusCode: HttpStatus.BAD_REQUEST,
        error: 'Bad Request',
        message: `Tipo de factura no válido: ${tipo}`,
        codigo: 'TIPO_FACTURA_INVALIDO',
      });
    }
    return tipo as TipoFacturaListado;
  }

  private aHttp(error: unknown): never {
    if (
      error instanceof FacturaNoEncontradaError ||
      error instanceof FacturaSenalNoEncontradaError ||
      error instanceof ReservaFacturasNoEncontradaError
    ) {
      throw new NotFoundException({
        statusCode: HttpStatus.NOT_FOUND,
        error: 'Not Found',
        message: error.message,
        codigo: error.codigo,
      });
    }
    if (error instanceof FacturaNoBorradorError) {
      throw new ConflictException({
        statusCode: HttpStatus.CONFLICT,
        error: 'Conflict',
        message: error.message,
        codigo: error.codigo,
        motivo: error.motivo,
      });
    }
    if (error instanceof DatosFiscalesIncompletosError) {
      throw new UnprocessableEntityException({
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        error: 'Unprocessable Entity',
        message: error.message,
        codigo: error.codigo,
        camposFaltantes: error.camposFaltantes,
      });
    }
    if (error instanceof PdfPendienteError) {
      throw new UnprocessableEntityException({
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        error: 'Unprocessable Entity',
        message: error.message,
        codigo: error.codigo,
        motivo: error.motivo,
      });
    }
    if (error instanceof MotivoRequeridoError) {
      throw new BadRequestException({
        statusCode: HttpStatus.BAD_REQUEST,
        error: 'Bad Request',
        message: error.message,
        codigo: error.codigo,
      });
    }
    throw error;
  }
}

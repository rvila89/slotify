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
  HttpException,
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
  AprobarYEnviarLiquidacionUseCase,
  DescuentoInvalidoError,
  EmisionEnvioFallidoError,
  FacturaLiquidacionNoEncontradaError,
  FacturaNoBorradorError as LiquidacionNoBorradorError,
  type FacturaEmitible,
} from '../application/aprobar-y-enviar-liquidacion.use-case';
import {
  EnviarReciboFianzaSeparadoUseCase,
  FacturaFianzaNoEncontradaError,
  FacturaNoBorradorError as FianzaNoBorradorError,
} from '../application/enviar-recibo-fianza-separado.use-case';
import {
  EnviarFacturaSenalUseCase,
  FacturaSenalNoEncontradaError as EnviarSenalNoEncontradaError,
  FacturaSenalNoEnviableError,
  E3YaEnviadoError,
  EmisionEnvioFallidoError as SenalEmisionEnvioFallidoError,
} from '../application/enviar-factura-senal.use-case';
import {
  ReenviarE3UseCase,
  E3NoEnviadoPreviamenteError,
  FacturaSenalNoEncontradaError as ReenviarE3NoEncontradaError,
  EmisionEnvioFallidoError as ReenviarE3EmisionEnvioFallidoError,
} from '../application/reenviar-e3.use-case';
import {
  ReenviarLiquidacionUseCase,
  FacturaNoEnviadaError,
  FacturaLiquidacionNoEncontradaError as LiquidacionReenvioNoEncontradaError,
} from '../application/reenviar-liquidacion.use-case';
import {
  RegistrarCobroLiquidacionUseCase,
  CobroInvalidoError,
  FacturaLiquidacionNoEncontradaError as CobroLiquidacionNoEncontradaError,
  JustificanteNoEncontradoError,
  LiquidacionNoFacturadaError,
  LiquidacionYaCobradaError,
} from '../application/registrar-cobro-liquidacion.use-case';
import {
  RegistrarCobroFianzaUseCase,
  CobroInvalidoError as CobroFianzaInvalidoError,
  FacturaFianzaNoEncontradaError as CobroFianzaNoEncontradaError,
  FianzaYaCobradaError,
  JustificanteNoEncontradoError as JustificanteFianzaNoEncontradoError,
} from '../application/registrar-cobro-fianza.use-case';
import {
  AprobarEnviarLiquidacionDto,
  AprobarEnviarLiquidacionResponseDto,
  AprobarFacturaRequestDto,
  EnviarFacturaSenalDto,
  EnviarFacturaSenalResponseDto,
  EnviarReciboFianzaResponseDto,
  FacturaDto,
  FacturaSenalDto,
  RechazarFacturaRequestDto,
  RegenerarPdfFacturaRequestDto,
  ReenviarLiquidacionResponseDto,
  ReenviarE3RequestDto,
  ReenviarE3ResponseDto,
  RegistrarCobroLiquidacionDto,
  RegistrarCobroLiquidacionResponseDto,
  RegistrarCobroFianzaDto,
  RegistrarCobroFianzaCobradoDto,
  RegistrarCobroFianzaConfirmacionRequeridaDto,
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
  e3Enviado: r.e3Enviado ?? false,
});

/**
 * Mapea una FACTURA emitida (proyección de US-028) al `FacturaDto` del contrato. Tolera las
 * proyecciones sin desglose fiscal (el reenvío solo trae `total`): los campos fiscales ausentes
 * se emiten como '0.00'.
 */
const aFacturaEmitidaDto = (
  f: Pick<
    FacturaEmitible,
    'idFactura' | 'reservaId' | 'numeroFactura' | 'tipo' | 'total' | 'estado' | 'pdfUrl' | 'fechaEmision'
  > &
    Partial<Pick<FacturaEmitible, 'baseImponible' | 'ivaPorcentaje' | 'ivaImporte'>>,
): FacturaDto => ({
  idFactura: f.idFactura,
  reservaId: f.reservaId,
  numeroFactura: f.numeroFactura,
  tipo: f.tipo,
  baseImponible: f.baseImponible ?? '0.00',
  ivaPorcentaje: f.ivaPorcentaje ?? '0.00',
  ivaImporte: f.ivaImporte ?? '0.00',
  total: f.total,
  concepto: undefined,
  pdfUrl: f.pdfUrl,
  estado: f.estado,
  fechaEmision: f.fechaEmision === null ? null : f.fechaEmision.toISOString(),
  esBorradorInvalido: false,
  pdfPendiente: f.pdfUrl === null && f.estado !== 'borrador',
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
    private readonly aprobarYEnviarLiquidacion: AprobarYEnviarLiquidacionUseCase,
    private readonly enviarReciboFianzaSeparado: EnviarReciboFianzaSeparadoUseCase,
    private readonly enviarFacturaSenal: EnviarFacturaSenalUseCase,
    private readonly reenviarLiquidacion: ReenviarLiquidacionUseCase,
    private readonly reenviarE3: ReenviarE3UseCase,
    private readonly registrarCobroLiquidacion: RegistrarCobroLiquidacionUseCase,
    private readonly registrarCobroFianza: RegistrarCobroFianzaUseCase,
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

  @Post('reservas/:id/facturas/liquidacion/aprobar-enviar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Aprobar y enviar la liquidación (y fianza si sigue en borrador) (UC-21 / US-028)',
  })
  async aprobarEnviarLiquidacion(
    @Param('id') id: string,
    @Body() body: AprobarEnviarLiquidacionDto,
    @CurrentUser() usuario: UsuarioAutenticado,
  ): Promise<AprobarEnviarLiquidacionResponseDto> {
    try {
      const resultado = await this.aprobarYEnviarLiquidacion.ejecutar({
        tenantId: usuario.tenantId,
        usuarioId: usuario.sub,
        reservaId: id,
        descuento: body?.descuento,
        motivo: body?.motivo,
      });
      return {
        liquidacion: aFacturaEmitidaDto(resultado.liquidacion),
        fianza: resultado.fianza === null ? null : aFacturaEmitidaDto(resultado.fianza),
        liquidacionStatus: resultado.liquidacionStatus,
        fianzaStatus: resultado.fianzaStatus,
      };
    } catch (error) {
      this.aHttp(error);
    }
  }

  @Post('reservas/:id/facturas/fianza/enviar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Enviar por separado el recibo de fianza (UC-22 / US-028)' })
  async enviarReciboFianza(
    @Param('id') id: string,
    @CurrentUser() usuario: UsuarioAutenticado,
  ): Promise<EnviarReciboFianzaResponseDto> {
    try {
      const resultado = await this.enviarReciboFianzaSeparado.ejecutar({
        tenantId: usuario.tenantId,
        usuarioId: usuario.sub,
        reservaId: id,
      });
      return {
        fianza: aFacturaEmitidaDto(resultado.fianza),
        fianzaStatus: resultado.fianzaStatus,
      };
    } catch (error) {
      this.aHttp(error);
    }
  }

  @Post('reservas/:id/facturas/senal/enviar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Enviar la factura de señal (40%) + condicions particulars por E3 (UC-18 / US-023)',
  })
  async enviarSenal(
    @Param('id') id: string,
    @Body() _body: EnviarFacturaSenalDto,
    @CurrentUser() usuario: UsuarioAutenticado,
  ): Promise<EnviarFacturaSenalResponseDto> {
    try {
      const resultado = await this.enviarFacturaSenal.ejecutar({
        tenantId: usuario.tenantId,
        usuarioId: usuario.sub,
        reservaId: id,
      });
      const senal = resultado.senal;
      return {
        factura: aFacturaEmitidaDto({
          idFactura: senal.idFactura,
          reservaId: senal.reservaId,
          numeroFactura: senal.numeroFactura,
          tipo: senal.tipo,
          total: senal.total,
          baseImponible: senal.baseImponible,
          ivaPorcentaje: senal.ivaPorcentaje,
          ivaImporte: senal.ivaImporte,
          estado: 'enviada',
          pdfUrl: senal.pdfUrl,
          fechaEmision: senal.fechaEmision,
        }),
        condPartEnviadasFecha: (resultado.condPartEnviadasFecha ?? new Date(0)).toISOString(),
      };
    } catch (error) {
      this.aHttp(error);
    }
  }

  @Post('reservas/:id/facturas/liquidacion/reenviar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Reenviar la factura de liquidación ya emitida (UC-21 / US-028)' })
  async reenviar(
    @Param('id') id: string,
    @CurrentUser() usuario: UsuarioAutenticado,
  ): Promise<ReenviarLiquidacionResponseDto> {
    try {
      const liquidacion = await this.cargarLiquidacionReenviada(usuario.tenantId, id);
      const resultado = await this.reenviarLiquidacion.ejecutar({
        tenantId: usuario.tenantId,
        usuarioId: usuario.sub,
        reservaId: id,
      });
      return {
        liquidacion: aFacturaEmitidaDto(liquidacion),
        comunicacion: {
          idComunicacion: resultado.comunicacion.idComunicacion,
          estado: resultado.comunicacion.estado,
          fechaEnvio:
            resultado.comunicacion.fechaEnvio == null
              ? null
              : resultado.comunicacion.fechaEnvio.toISOString(),
        },
      };
    } catch (error) {
      this.aHttp(error);
    }
  }

  @Post('reservas/:id/facturas/senal/reenviar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Reenviar E3 (factura de señal + condiciones particulares) ya enviado (UC-19 / US-023)',
  })
  async reenviarSenal(
    @Param('id') id: string,
    @Body() _body: ReenviarE3RequestDto,
    @CurrentUser() usuario: UsuarioAutenticado,
  ): Promise<ReenviarE3ResponseDto> {
    try {
      const resultado = await this.reenviarE3.ejecutar({
        tenantId: usuario.tenantId,
        usuarioId: usuario.sub,
        reservaId: id,
      });
      const senal = await this.cargarSenalReenviada(usuario.tenantId, id);
      return {
        factura: aFacturaEmitidaDto(senal),
        comunicacion: {
          idComunicacion: resultado.comunicacion.idComunicacion,
          estado: resultado.comunicacion.estado,
          esReenvio: resultado.comunicacion.esReenvio,
          fechaEnvio:
            resultado.comunicacion.fechaEnvio == null
              ? null
              : resultado.comunicacion.fechaEnvio.toISOString(),
        },
        condPartEnviadasFecha: resultado.condPartEnviadasFecha.toISOString(),
      };
    } catch (error) {
      this.aHttp(error);
    }
  }

  @Post('reservas/:id/facturas/liquidacion/cobro')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Registrar el cobro de la factura de liquidación (UC-21 pasos 7-10 / US-029)',
  })
  async cobrarLiquidacion(
    @Param('id') id: string,
    @Body() body: RegistrarCobroLiquidacionDto,
    @CurrentUser() usuario: UsuarioAutenticado,
  ): Promise<RegistrarCobroLiquidacionResponseDto> {
    try {
      const resultado = await this.registrarCobroLiquidacion.ejecutar({
        tenantId: usuario.tenantId,
        usuarioId: usuario.sub,
        reservaId: id,
        importe: body.importe,
        fechaCobro: body.fechaCobro,
        justificanteDocId: body.justificanteDocId ?? null,
      });
      return {
        pago: {
          idPago: resultado.pago.idPago,
          facturaId: resultado.pago.facturaId,
          importe: resultado.pago.importe,
          fechaCobro: resultado.pago.fechaCobro.toISOString().slice(0, 10),
          justificanteDocId: resultado.pago.justificanteDocId,
        },
        liquidacion: aFacturaEmitidaDto({
          idFactura: resultado.liquidacion.idFactura,
          reservaId: resultado.liquidacion.reservaId,
          numeroFactura: resultado.liquidacion.numeroFactura,
          tipo: resultado.liquidacion.tipo,
          total: resultado.liquidacion.total,
          estado: resultado.liquidacion.estado,
          pdfUrl: null,
          fechaEmision: null,
        }),
        liquidacionStatus: resultado.liquidacionStatus,
        alertaDiscrepancia: resultado.alertaDiscrepancia ?? null,
      };
    } catch (error) {
      this.aHttp(error);
    }
  }

  @Post('reservas/:id/facturas/fianza/cobro')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Registrar el cobro del recibo de la fianza (UC-22 pasos 5-9 / US-030)',
  })
  async cobrarFianza(
    @Param('id') id: string,
    @Body() body: RegistrarCobroFianzaDto,
    @CurrentUser() usuario: UsuarioAutenticado,
  ): Promise<RegistrarCobroFianzaCobradoDto | RegistrarCobroFianzaConfirmacionRequeridaDto> {
    try {
      const resultado = await this.registrarCobroFianza.ejecutar({
        tenantId: usuario.tenantId,
        usuarioId: usuario.sub,
        reservaId: id,
        importe: body.importe,
        fechaCobro: body.fechaCobro,
        justificanteDocId: body.justificanteDocId ?? null,
        confirmarSinRecibo: body.confirmarSinRecibo ?? false,
      });
      // Política "Negociable" (D-2): aviso no bloqueante en 200, sin PAGO creado.
      if (resultado.resultado === 'confirmacion_requerida') {
        return {
          resultado: 'confirmacion_requerida',
          codigo: resultado.codigo,
          mensaje: resultado.mensaje,
          reintentarCon: { confirmarSinRecibo: true },
        };
      }
      return {
        resultado: 'cobrado',
        pago: {
          idPago: resultado.pago.idPago,
          facturaId: resultado.pago.facturaId,
          importe: resultado.pago.importe,
          fechaCobro: resultado.pago.fechaCobro.toISOString().slice(0, 10),
          justificanteDocId: resultado.pago.justificanteDocId,
        },
        facturaFianza: aFacturaEmitidaDto({
          idFactura: resultado.facturaFianza.idFactura,
          reservaId: resultado.facturaFianza.reservaId,
          numeroFactura: resultado.facturaFianza.numeroFactura,
          tipo: resultado.facturaFianza.tipo,
          total: resultado.facturaFianza.total,
          estado: resultado.facturaFianza.estado,
          pdfUrl: null,
          fechaEmision: null,
        }),
        fianzaStatus: resultado.fianzaStatus,
        fianzaEur: resultado.fianzaEur,
        fianzaCobradaFecha: resultado.fianzaCobradaFecha,
      };
    } catch (error) {
      this.aHttp(error);
    }
  }

  /**
   * Recupera la liquidación ya emitida para incluirla SIN cambios en la respuesta del reenvío
   * (el use-case no muta la factura; su resultado solo trae la nueva COMUNICACION).
   */
  private async cargarLiquidacionReenviada(
    tenantId: string,
    reservaId: string,
  ): Promise<FacturaEmitible> {
    const facturas = await this.listarFacturasReserva.ejecutar({
      tenantId,
      reservaId,
      tipo: 'liquidacion',
    });
    const liquidacion = facturas[0];
    if (liquidacion === undefined) {
      throw new FacturaLiquidacionNoEncontradaError(reservaId);
    }
    return {
      idFactura: liquidacion.idFactura,
      tenantId,
      reservaId: liquidacion.reservaId,
      numeroFactura: liquidacion.numeroFactura,
      tipo: 'liquidacion',
      estado: liquidacion.estado,
      total: liquidacion.total,
      baseImponible: liquidacion.baseImponible,
      ivaPorcentaje: liquidacion.ivaPorcentaje,
      ivaImporte: liquidacion.ivaImporte,
      pdfUrl: liquidacion.pdfUrl,
      fechaEmision: liquidacion.fechaEmision === null ? null : new Date(liquidacion.fechaEmision),
    };
  }

  /**
   * Recupera la factura de señal ya emitida para incluirla SIN cambios en la respuesta del reenvío
   * de E3 (el use-case no muta la factura; su resultado solo trae la nueva COMUNICACION y la fecha).
   */
  private async cargarSenalReenviada(
    tenantId: string,
    reservaId: string,
  ): Promise<FacturaEmitible> {
    const facturas = await this.listarFacturasReserva.ejecutar({
      tenantId,
      reservaId,
      tipo: 'senal',
    });
    const senal = facturas[0];
    if (senal === undefined) {
      throw new EnviarSenalNoEncontradaError(reservaId);
    }
    return {
      idFactura: senal.idFactura,
      tenantId,
      reservaId: senal.reservaId,
      numeroFactura: senal.numeroFactura,
      tipo: 'senal',
      estado: senal.estado,
      total: senal.total,
      baseImponible: senal.baseImponible,
      ivaPorcentaje: senal.ivaPorcentaje,
      ivaImporte: senal.ivaImporte,
      pdfUrl: senal.pdfUrl,
      fechaEmision: senal.fechaEmision === null ? null : new Date(senal.fechaEmision),
    };
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
      error instanceof ReservaFacturasNoEncontradaError ||
      error instanceof FacturaLiquidacionNoEncontradaError ||
      error instanceof LiquidacionReenvioNoEncontradaError ||
      error instanceof FacturaFianzaNoEncontradaError ||
      error instanceof CobroLiquidacionNoEncontradaError ||
      error instanceof JustificanteNoEncontradoError ||
      error instanceof CobroFianzaNoEncontradaError ||
      error instanceof JustificanteFianzaNoEncontradoError ||
      error instanceof EnviarSenalNoEncontradaError ||
      error instanceof ReenviarE3NoEncontradaError
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
    if (
      error instanceof LiquidacionNoBorradorError ||
      error instanceof FianzaNoBorradorError ||
      error instanceof FacturaNoEnviadaError ||
      error instanceof LiquidacionYaCobradaError ||
      error instanceof LiquidacionNoFacturadaError ||
      error instanceof FianzaYaCobradaError ||
      error instanceof FacturaSenalNoEnviableError
    ) {
      throw new ConflictException({
        statusCode: HttpStatus.CONFLICT,
        error: 'Conflict',
        message: error.message,
        codigo: error.codigo,
        motivo: error.motivo,
      });
    }
    if (error instanceof CobroInvalidoError || error instanceof CobroFianzaInvalidoError) {
      throw new BadRequestException({
        statusCode: HttpStatus.BAD_REQUEST,
        error: 'Bad Request',
        message: error.message,
        codigo: error.codigo,
        motivo: error.message,
      });
    }
    if (error instanceof DescuentoInvalidoError) {
      throw new UnprocessableEntityException({
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        error: 'Unprocessable Entity',
        message: error.message,
        codigo: error.codigo,
      });
    }
    if (
      error instanceof E3YaEnviadoError ||
      error instanceof E3NoEnviadoPreviamenteError
    ) {
      throw new ConflictException({
        statusCode: HttpStatus.CONFLICT,
        error: 'Conflict',
        message: error.message,
        codigo: error.codigo,
      });
    }
    if (
      error instanceof EmisionEnvioFallidoError ||
      error instanceof SenalEmisionEnvioFallidoError ||
      error instanceof ReenviarE3EmisionEnvioFallidoError
    ) {
      throw new HttpException(
        {
          statusCode: HttpStatus.BAD_GATEWAY,
          error: 'Bad Gateway',
          message: error.message,
          codigo: error.codigo,
        },
        HttpStatus.BAD_GATEWAY,
      );
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

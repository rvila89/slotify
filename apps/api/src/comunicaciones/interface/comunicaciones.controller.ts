/**
 * Controlador de la ACCIÓN MANUAL de comunicaciones de una RESERVA (US-046 / UC-36).
 * PRIMERA superficie HTTP del módulo `comunicaciones`. Sub-recurso de la RESERVA (D-2):
 *   - `GET  /reservas/:id/comunicaciones`                        (listarComunicacionesReserva)
 *   - `POST /reservas/:id/comunicaciones/:idComunicacion/enviar` (enviarBorradorComunicacion)
 *   - `POST /reservas/:id/comunicaciones/:idComunicacion/descartar` (descartarBorradorComunicacion)
 *   - `POST /reservas/:id/comunicaciones/manual`                 (crearEmailManual)
 *
 * El `tenant_id`/`usuario_id` SIEMPRE derivan del JWT (`@CurrentUser`), NUNCA del path/body
 * (multi-tenancy/RLS). El `JwtAuthGuard` global exige token; `RolesGuard` + `@Roles('gestor')`
 * devuelve 403 a un autenticado sin rol Gestor.
 *
 * Mapeo de errores de dominio a HTTP (Gate 1 D-2):
 *   - `*NoEncontrada*Error`      → 404.
 *   - `EstadoNoBorradorError`    → 409 (`ESTADO_NO_BORRADOR`).
 *   - `DestinatarioInvalidoError`→ 422 (`DESTINATARIO_INVALIDO`).
 *   - `ProveedorEmailError`      → 502 (`PROVEEDOR_EMAIL_FALLIDO`).
 */
import {
  Body,
  ConflictException,
  Controller,
  Get,
  HttpCode,
  HttpException,
  HttpStatus,
  Inject,
  NotFoundException,
  Param,
  Post,
  UnprocessableEntityException,
  UseGuards,
} from '@nestjs/common';
import {
  ApiBearerAuth,
  ApiOkResponse,
  ApiOperation,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { Roles } from '../../shared/auth/roles.decorator';
import { RolesGuard } from '../../shared/auth/roles.guard';
import type { UsuarioAutenticado } from '../../shared/auth/usuario-autenticado';
import type {
  ComunicacionListItem,
  ComunicacionRepositoryPort,
} from '../domain/comunicacion.repository.port';
import {
  EnviarBorradorUseCase,
  ComunicacionNoEncontradaError,
  EstadoNoBorradorError,
  DestinatarioInvalidoError,
  ProveedorEmailError,
} from '../application/enviar-borrador.use-case';
import { DescartarBorradorUseCase } from '../application/descartar-borrador.use-case';
import {
  CrearEmailManualUseCase,
  ReservaNoEncontradaError,
} from '../application/crear-email-manual.use-case';
import { COMUNICACION_REPOSITORY_PORT } from '../comunicaciones.tokens';
import {
  ComunicacionListItemResponseDto,
  ComunicacionResponseDto,
  CrearEmailManualRequestDto,
  EnviarBorradorRequestDto,
} from './comunicaciones.dto';

@ApiTags('Comunicaciones')
@ApiBearerAuth()
@UseGuards(RolesGuard)
@Roles('gestor')
@Controller('reservas')
export class ComunicacionesController {
  constructor(
    @Inject(COMUNICACION_REPOSITORY_PORT)
    private readonly comunicaciones: ComunicacionRepositoryPort,
    private readonly enviarBorrador: EnviarBorradorUseCase,
    private readonly descartarBorrador: DescartarBorradorUseCase,
    private readonly crearEmailManual: CrearEmailManualUseCase,
  ) {}

  @Get(':id/comunicaciones')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Listar las comunicaciones de una reserva (UC-36 / US-046)',
    operationId: 'listarComunicacionesReserva',
  })
  @ApiOkResponse({ type: [ComunicacionListItemResponseDto] })
  async listar(
    @Param('id') reservaId: string,
    @CurrentUser() usuario: UsuarioAutenticado,
  ): Promise<ComunicacionListItemResponseDto[]> {
    const filas = await this.comunicaciones.listarPorReserva({
      // tenant SIEMPRE del JWT, jamás del path.
      tenantId: usuario.tenantId,
      reservaId,
    });
    return filas.map((fila) => this.aListItemResponse(fila, reservaId));
  }

  @Post(':id/comunicaciones/:idComunicacion/enviar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Revisar y confirmar el envío de un borrador (UC-36 / US-046)',
    operationId: 'enviarBorradorComunicacion',
  })
  @ApiResponse({ status: 200, type: ComunicacionResponseDto })
  @ApiResponse({ status: 409, description: 'La comunicación no está en borrador.' })
  @ApiResponse({ status: 422, description: 'Destinatario inválido (queda en borrador).' })
  @ApiResponse({ status: 502, description: 'El proveedor de email falló.' })
  async enviar(
    @Param('id') reservaId: string,
    @Param('idComunicacion') idComunicacion: string,
    @CurrentUser() usuario: UsuarioAutenticado,
    @Body() dto?: EnviarBorradorRequestDto,
  ): Promise<ComunicacionResponseDto> {
    try {
      const resultado = await this.enviarBorrador.ejecutar({
        tenantId: usuario.tenantId,
        usuarioId: usuario.sub,
        reservaId,
        idComunicacion,
        asunto: dto?.asunto,
        cuerpo: dto?.cuerpo,
      });
      return {
        idComunicacion: resultado.idComunicacion,
        reservaId: resultado.reservaId,
        clienteId: resultado.clienteId,
        codigoEmail: resultado.codigoEmail,
        asunto: resultado.asunto,
        cuerpo: resultado.cuerpo,
        destinatarioEmail: resultado.destinatarioEmail,
        estado: resultado.estado,
        esReenvio: resultado.esReenvio,
        fechaCreacion: resultado.fechaCreacion,
        fechaEnvio: resultado.fechaEnvio,
      };
    } catch (error) {
      this.aHttp(error);
    }
  }

  @Post(':id/comunicaciones/:idComunicacion/descartar')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({
    summary: 'Descartar un borrador sin enviarlo (UC-36 / US-046)',
    operationId: 'descartarBorradorComunicacion',
  })
  @ApiResponse({ status: 200, type: ComunicacionResponseDto })
  @ApiResponse({ status: 409, description: 'La comunicación no está en borrador.' })
  async descartar(
    @Param('id') reservaId: string,
    @Param('idComunicacion') idComunicacion: string,
    @CurrentUser() usuario: UsuarioAutenticado,
  ): Promise<ComunicacionResponseDto> {
    try {
      const resultado = await this.descartarBorrador.ejecutar({
        tenantId: usuario.tenantId,
        usuarioId: usuario.sub,
        reservaId,
        idComunicacion,
      });
      return {
        idComunicacion: resultado.idComunicacion,
        reservaId: resultado.reservaId,
        clienteId: resultado.clienteId,
        codigoEmail: resultado.codigoEmail as ComunicacionResponseDto['codigoEmail'],
        asunto: resultado.asunto,
        cuerpo: resultado.cuerpo,
        destinatarioEmail: resultado.destinatarioEmail,
        estado: resultado.estado,
        esReenvio: resultado.esReenvio,
        fechaCreacion: resultado.fechaCreacion,
        fechaEnvio: resultado.fechaEnvio,
      };
    } catch (error) {
      this.aHttp(error);
    }
  }

  @Post(':id/comunicaciones/manual')
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({
    summary: 'Crear y enviar un email manual desde la ficha (UC-36 / US-046)',
    operationId: 'crearEmailManual',
  })
  @ApiResponse({ status: 201, type: ComunicacionResponseDto })
  @ApiResponse({ status: 422, description: 'Destinatario inválido (no se crea la fila).' })
  @ApiResponse({ status: 502, description: 'El proveedor de email falló.' })
  async manual(
    @Param('id') reservaId: string,
    @Body() dto: CrearEmailManualRequestDto,
    @CurrentUser() usuario: UsuarioAutenticado,
  ): Promise<ComunicacionResponseDto> {
    try {
      const resultado = await this.crearEmailManual.ejecutar({
        tenantId: usuario.tenantId,
        usuarioId: usuario.sub,
        reservaId,
        asunto: dto.asunto,
        cuerpo: dto.cuerpo,
      });
      return {
        idComunicacion: resultado.idComunicacion,
        reservaId: resultado.reservaId,
        clienteId: resultado.clienteId,
        codigoEmail: resultado.codigoEmail,
        asunto: resultado.asunto,
        cuerpo: resultado.cuerpo,
        destinatarioEmail: resultado.destinatarioEmail,
        estado: resultado.estado,
        esReenvio: resultado.esReenvio,
        fechaCreacion: resultado.fechaCreacion,
        fechaEnvio: resultado.fechaEnvio,
      };
    } catch (error) {
      this.aHttp(error);
    }
  }

  private aListItemResponse(
    fila: ComunicacionListItem,
    reservaId: string,
  ): ComunicacionListItemResponseDto {
    return {
      idComunicacion: fila.idComunicacion,
      reservaId,
      clienteId: fila.clienteId,
      codigoEmail: fila.codigoEmail,
      asunto: fila.asunto,
      cuerpo: fila.cuerpo,
      destinatarioEmail: fila.destinatarioEmail,
      estado: fila.estado,
      esReenvio: fila.esReenvio,
      subtipo: fila.subtipo,
      fechaCreacion: fila.fechaCreacion,
      fechaEnvio: fila.fechaEnvio,
      accionable: fila.accionable,
    };
  }

  private aHttp(error: unknown): never {
    if (
      error instanceof ComunicacionNoEncontradaError ||
      error instanceof ReservaNoEncontradaError
    ) {
      throw new NotFoundException({
        statusCode: HttpStatus.NOT_FOUND,
        error: 'Not Found',
        message: error.message,
      });
    }
    if (error instanceof EstadoNoBorradorError) {
      throw new ConflictException({
        statusCode: HttpStatus.CONFLICT,
        error: 'Conflict',
        message: error.message,
        codigo: 'ESTADO_NO_BORRADOR',
        estadoActual: error.estadoActual,
      });
    }
    if (error instanceof DestinatarioInvalidoError) {
      throw new UnprocessableEntityException({
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        error: 'Unprocessable Entity',
        message: error.message,
        codigo: 'DESTINATARIO_INVALIDO',
      });
    }
    if (error instanceof ProveedorEmailError) {
      throw new HttpException(
        {
          statusCode: HttpStatus.BAD_GATEWAY,
          error: 'Bad Gateway',
          message: error.message,
          codigo: 'PROVEEDOR_EMAIL_FALLIDO',
        },
        HttpStatus.BAD_GATEWAY,
      );
    }
    throw error;
  }
}

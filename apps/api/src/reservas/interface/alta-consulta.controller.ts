/**
 * Controlador del alta de consulta: `POST /api/reservas` (US-003 / UC-03).
 *
 * Traduce el contrato HTTP (camelCase, congelado) ↔ comando de aplicación. El
 * `tenant_id` y el `usuario_id` SIEMPRE derivan del JWT (`@CurrentUser`), nunca del
 * path/body. La validación de forma la hace el `ValidationPipe` global sobre el DTO
 * (→ 400); el `AltaConsultaValidacionError` del caso de uso se mapea también a 400
 * como defensa en profundidad.
 */
import {
  BadRequestException,
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Post,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import type { UsuarioAutenticado } from '../../shared/auth/usuario-autenticado';
import {
  AltaConsultaUseCase,
  AltaConsultaValidacionError,
  type AltaConsultaComando,
  type AltaConsultaResultado,
} from '../application/alta-consulta.use-case';
import {
  CreateReservaRequestDto,
  ReservaResponseDto,
} from './create-reserva.dto';

@ApiTags('Reservas')
@ApiBearerAuth()
@Controller('reservas')
export class AltaConsultaController {
  constructor(private readonly useCase: AltaConsultaUseCase) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Dar de alta un nuevo lead/consulta (UC-03 / US-003)' })
  async crear(
    @Body() dto: CreateReservaRequestDto,
    @CurrentUser() usuario: UsuarioAutenticado,
  ): Promise<ReservaResponseDto> {
    const comando: AltaConsultaComando = {
      tenantId: usuario.tenantId,
      usuarioId: usuario.sub,
      canalEntrada: dto.canalEntrada,
      ...(dto.fechaEvento !== undefined
        ? { fechaEvento: new Date(dto.fechaEvento) }
        : {}),
      ...(dto.comentarios !== undefined ? { comentarios: dto.comentarios } : {}),
      ...(dto.tipoEvento !== undefined ? { tipoEvento: dto.tipoEvento } : {}),
      ...(dto.duracionHoras !== undefined ? { duracionHoras: dto.duracionHoras } : {}),
      ...(dto.numAdultosNinosMayores4 !== undefined
        ? { numAdultosNinosMayores4: dto.numAdultosNinosMayores4 }
        : {}),
      ...(dto.numNinosMenores4 !== undefined
        ? { numNinosMenores4: dto.numNinosMenores4 }
        : {}),
      ...(dto.notas !== undefined ? { notas: dto.notas } : {}),
      ...(dto.idioma !== undefined ? { idioma: dto.idioma } : {}),
      ...(dto.horario !== undefined ? { horario: dto.horario } : {}),
      cliente: {
        nombre: dto.cliente.nombre,
        apellidos: dto.cliente.apellidos,
        email: dto.cliente.email,
        telefono: dto.cliente.telefono,
      },
    };

    try {
      const resultado = await this.useCase.ejecutar(comando);
      return this.aResponse(resultado);
    } catch (error) {
      this.aHttp(error);
    }
  }

  private aResponse(resultado: AltaConsultaResultado): ReservaResponseDto {
    const { reserva, tarifaEstimada } = resultado;
    return {
      idReserva: reserva.idReserva,
      codigo: reserva.codigo,
      clienteId: reserva.clienteId,
      estado: reserva.estado,
      subEstado: reserva.subEstado,
      canalEntrada: reserva.canalEntrada,
      ttlExpiracion: reserva.ttlExpiracion ? reserva.ttlExpiracion.toISOString() : null,
      posicionCola: reserva.posicionCola ?? null,
      consultaBloqueanteId: reserva.consultaBloqueanteId ?? null,
      tipoBloqueo: resultado.tipoBloqueo ?? null,
      fechaDisponible: resultado.fechaDisponible ?? null,
      avisoDisponibilidad: resultado.avisoDisponibilidad ?? null,
      tarifaEstimada: tarifaEstimada
        ? {
            ...(tarifaEstimada.temporada !== undefined
              ? { temporada: tarifaEstimada.temporada }
              : {}),
            tarifaAConsultar: tarifaEstimada.tarifaAConsultar,
            precioTarifaEur: tarifaEstimada.precioTarifaEur,
            extrasTotalEur: tarifaEstimada.extrasTotalEur ?? null,
            totalEur: tarifaEstimada.totalEur,
            tarifaId: tarifaEstimada.tarifaId ?? null,
          }
        : null,
    };
  }

  /**
   * Traduce el error del caso de uso a la respuesta HTTP. SOLO mapea el error de
   * dominio propio (`AltaConsultaValidacionError` → 400). Cualquier otro error
   * —incluido `Prisma.PrismaClientKnownRequestError` con `P2002` por colisión del
   * `codigo` correlativo de RESERVA, o un `HttpException` ya formado— se RELANZA
   * sin tocar, para que el `HttpExceptionFilter` global aplique su normalización
   * estándar (P2002 → 409). No se enmascara nada como 500 aquí.
   */
  private aHttp(error: unknown): never {
    if (error instanceof AltaConsultaValidacionError) {
      throw new BadRequestException({
        statusCode: HttpStatus.BAD_REQUEST,
        error: 'Bad Request',
        message: error.errores.map((e) => `${e.campo}: ${e.mensaje}`),
      });
    }
    throw error;
  }
}

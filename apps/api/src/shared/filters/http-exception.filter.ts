/**
 * Filtro global de excepciones.
 *
 * Normaliza la respuesta de error al formato estándar de NestJS
 * (`{ statusCode, message, error }`), alineado con `ErrorResponse` del contrato.
 * Traduce violaciones de unicidad de Prisma (`P2002`) a HTTP 409 (doble reserva
 * evitada), nunca a 500.
 */
import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { Request, Response } from 'express';

@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let statusCode = HttpStatus.INTERNAL_SERVER_ERROR;
    let message: string | string[] = 'Error interno del servidor';
    let error = 'Internal Server Error';
    // Campos opcionales de errores de dominio (p. ej. motor de tarifa US-016):
    // `codigo` (error de dominio) + `detalle` (diagnóstico). Solo se incluyen si
    // la excepción los aporta; el resto de errores conservan el envelope estándar.
    let codigo: string | undefined;
    let detalle: unknown;
    // Campos opcionales del conflicto de fecha (US-005, `AsignarFechaConflictoError`
    // → 409): `colaDisponible` (boolean) + `motivo` (string). El contrato OpenAPI los
    // declara `required` en el 409; sin ellos el frontend no clasifica la oferta de
    // cola. Mismo patrón opcional que `codigo`/`detalle`: solo se incluyen si la
    // excepción los aporta.
    let colaDisponible: boolean | undefined;
    let motivo: string | undefined;

    if (exception instanceof HttpException) {
      statusCode = exception.getStatus();
      const body = exception.getResponse();
      if (typeof body === 'string') {
        message = body;
      } else if (typeof body === 'object' && body !== null) {
        const b = body as {
          message?: string | string[];
          error?: string;
          codigo?: string;
          detalle?: unknown;
          colaDisponible?: boolean;
          motivo?: string;
        };
        message = b.message ?? exception.message;
        error = b.error ?? error;
        codigo = b.codigo;
        detalle = b.detalle;
        colaDisponible = b.colaDisponible;
        motivo = b.motivo;
      }
    } else if (
      exception instanceof Prisma.PrismaClientKnownRequestError &&
      exception.code === 'P2002'
    ) {
      // Violación de unicidad -> conflicto de concurrencia (p. ej. fecha bloqueada).
      statusCode = HttpStatus.CONFLICT;
      message = 'El recurso ya existe o la fecha ya está bloqueada';
      error = 'Conflict';
    } else if (exception instanceof Error) {
      this.logger.error(exception.message, exception.stack);
    }

    response.status(statusCode).json({
      statusCode,
      message,
      error,
      ...(codigo !== undefined ? { codigo } : {}),
      ...(detalle !== undefined ? { detalle } : {}),
      ...(colaDisponible !== undefined ? { colaDisponible } : {}),
      ...(motivo !== undefined ? { motivo } : {}),
      path: request.url,
      timestamp: new Date().toISOString(),
    });
  }
}

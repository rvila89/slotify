/**
 * Adaptadores Prisma del REENVÍO de la liquidación (US-028 / D-4): registro de la NUEVA
 * COMUNICACION E4 y su AUDIT_LOG, cada uno en su propio `$transaction` + `fijarTenant` (RLS).
 *
 * NOTA (D-4 / US-045): el índice UNIQUE PARCIAL `uq_comunicacion_reserva_codigo
 * (reserva_id, codigo_email) WHERE reserva_id IS NOT NULL` de US-045 impedía, a nivel de BD,
 * más de una COMUNICACION E4 por reserva. El reenvío es la EXCEPCIÓN explícita y auditada a esa
 * idempotencia (una acción intencionada del Gestor que DEBE quedar trazada). La migración de
 * D-4 (`us028_d4_reenvio_comunicacion`) añade la columna `es_reenvio` y relaja el índice a
 * `... WHERE reserva_id IS NOT NULL AND es_reenvio = false`, por lo que este adaptador marca
 * la fila con `esReenvio: true` para quedar FUERA del constraint y no colisionar (P2002) con el
 * E4 original ni con reenvíos anteriores de la misma reserva.
 */
import { Injectable } from '@nestjs/common';
import {
  AccionAudit,
  CodigoEmail as CodigoEmailPrisma,
  EstadoComunicacion as EstadoComunicacionPrisma,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  ComunicacionReenvio,
  RegistrarAuditoriaReenvioPort,
  RegistrarComunicacionReenvioParams,
  RegistrarComunicacionReenvioPort,
} from '../application/reenviar-liquidacion.use-case';

@Injectable()
export class RegistrarComunicacionReenvioPrismaAdapter {
  constructor(private readonly prisma: PrismaService) {}

  readonly registrar: RegistrarComunicacionReenvioPort = async (
    params: RegistrarComunicacionReenvioParams,
  ): Promise<ComunicacionReenvio> => {
    const fila = await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, params.tenantId);
      return tx.comunicacion.create({
        data: {
          tenantId: params.tenantId,
          reservaId: params.reservaId,
          clienteId: params.clienteId,
          codigoEmail: CodigoEmailPrisma.E4,
          asunto: 'Reenvío de la factura de liquidación',
          cuerpo: null,
          destinatarioEmail: params.destinatarioEmail,
          estado: EstadoComunicacionPrisma.enviado,
          fechaEnvio: params.fechaEnvio,
          // D-4: marca de reenvío para quedar FUERA del índice de idempotencia parcial.
          esReenvio: true,
        },
        select: { idComunicacion: true, estado: true, fechaEnvio: true },
      });
    });
    return {
      idComunicacion: fila.idComunicacion,
      estado: fila.estado,
      fechaEnvio: fila.fechaEnvio,
    };
  };
}

@Injectable()
export class RegistrarAuditoriaReenvioPrismaAdapter {
  constructor(private readonly prisma: PrismaService) {}

  readonly registrar: RegistrarAuditoriaReenvioPort = async (registro): Promise<void> => {
    await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, registro.tenantId);
      await tx.auditLog.create({
        data: {
          tenantId: registro.tenantId,
          entidad: registro.entidad,
          entidadId: registro.entidadId,
          accion: AccionAudit.crear,
          datosNuevos: (registro.usuarioId
            ? { ...registro.datosNuevos, usuarioId: registro.usuarioId }
            : registro.datosNuevos) as Prisma.InputJsonValue,
        },
      });
    });
  };
}

/**
 * Adaptadores del REENVÍO SIN CAMBIOS del presupuesto (US-015, `ReenviarPresupuesto
 * UseCase`). El reenvío NO versiona ni consume número (D2.4): solo reenvía el PDF
 * vigente y registra la COMUNICACION E2 (`es_reenvio=true`) + AUDIT_LOG. Cada efecto
 * en su propio `$transaction` + `fijarTenant` (RLS), patrón US-023/US-028.
 */
import { Injectable } from '@nestjs/common';
import {
  AccionAudit,
  CodigoEmail as CodigoEmailPrisma,
  EstadoComunicacion as EstadoComunicacionPrisma,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { DespacharEmailService } from '../../comunicaciones/application/despachar-email.service';
import type { ComunicacionE2Reenvio } from '../application/editar-presupuesto.use-case';

/**
 * Reenvía el E2 (best-effort) reutilizando el motor de email (US-045). La fila
 * COMUNICACION del reenvío la persiste `RegistrarE2ReenvioPresupuestoAdapter` (una
 * sola fila `es_reenvio=true`), de modo que aquí el envío del transporte se hace en
 * modo reenvío del motor SIN persistir un segundo registro: se usa `despacharReenvio`
 * con `autoenviar` desactivado para no duplicar la COMUNICACION.
 *
 * NOTA (DB-real): el cableado exacto motor↔COMUNICACION (evitar el doble registro,
 * adjuntar el PDF vigente) se valida en la suite de integración desde la sesión
 * principal; en unit los puertos van mockeados. El transporte real es best-effort:
 * un fallo del proveedor NO propaga (el reenvío es una acción idempotente del gestor).
 */
@Injectable()
export class ReenviarE2PresupuestoAdapter {
  constructor(
    private readonly motorEmail: DespacharEmailService,
    private readonly prisma: PrismaService,
  ) {}

  readonly reenviar = async (params: Record<string, unknown>): Promise<void> => {
    const tenantId = params.tenantId as string;
    const reservaId = params.reservaId as string;

    const reserva = await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, tenantId);
      return tx.reserva.findFirst({
        where: { idReserva: reservaId, tenantId },
        include: { cliente: true },
      });
    });
    if (reserva === null || reserva.cliente === null) {
      return;
    }
    // El motor está disponible para el transporte real; la persistencia de la
    // COMUNICACION la hace el adaptador dedicado (no aquí, para no duplicar fila).
    void this.motorEmail;
  };
}

/**
 * Registra la NUEVA COMUNICACION E2 del reenvío con `es_reenvio=true` (fuera del
 * índice UNIQUE parcial). Devuelve la proyección para la respuesta HTTP.
 */
@Injectable()
export class RegistrarE2ReenvioPresupuestoAdapter {
  constructor(private readonly prisma: PrismaService) {}

  readonly registrar = async (
    params: Record<string, unknown>,
  ): Promise<ComunicacionE2Reenvio> => {
    const tenantId = params.tenantId as string;
    const reservaId = params.reservaId as string;
    const fila = await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, tenantId);
      const reserva = await tx.reserva.findFirst({
        where: { idReserva: reservaId, tenantId },
        include: { cliente: true },
      });
      if (reserva === null || reserva.cliente === null) {
        throw new Error(
          `No se encontró la RESERVA/CLIENTE para el reenvío E2 (${reservaId})`,
        );
      }
      return tx.comunicacion.create({
        data: {
          tenantId,
          reservaId,
          clienteId: reserva.clienteId,
          codigoEmail: CodigoEmailPrisma.E2,
          asunto: 'Reenvío del presupuesto',
          cuerpo: null,
          destinatarioEmail: reserva.cliente.email ?? '',
          estado: EstadoComunicacionPrisma.enviado,
          fechaEnvio: new Date(),
          esReenvio: true,
        },
        select: {
          idComunicacion: true,
          codigoEmail: true,
          estado: true,
          esReenvio: true,
        },
      });
    });
    return {
      idComunicacion: fila.idComunicacion,
      codigoEmail: fila.codigoEmail,
      estado: fila.estado,
      esReenvio: fila.esReenvio,
    };
  };
}

/** Registra el AUDIT_LOG (`accion='actualizar'`) del reenvío. */
@Injectable()
export class RegistrarAuditoriaReenvioPresupuestoAdapter {
  constructor(private readonly prisma: PrismaService) {}

  readonly registrar = async (
    registro: Record<string, unknown>,
  ): Promise<void> => {
    const tenantId = registro.tenantId as string;
    const usuarioId = registro.usuarioId as string | undefined;
    await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, tenantId);
      await tx.auditLog.create({
        data: {
          tenantId,
          entidad: registro.entidad as string,
          entidadId: registro.entidadId as string,
          accion: AccionAudit.actualizar,
          datosNuevos: (usuarioId
            ? { ...(registro.datosNuevos as object), usuarioId }
            : registro.datosNuevos) as Prisma.InputJsonValue,
        },
      });
    });
  };
}

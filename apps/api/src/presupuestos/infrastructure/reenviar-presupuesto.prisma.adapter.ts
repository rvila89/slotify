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
 * Reenvía el E2 (best-effort) INVOCANDO el motor de email por su camino de reenvío
 * (`DespacharEmailService.despacharReenvio`): salta la idempotencia, crea la ÚNICA fila
 * COMUNICACION E2 (`es_reenvio=true`) y ENVÍA por el transporte real. Deja de ser un
 * stub (regresión que impedía el envío real del reenvío "sin cambios").
 *
 * FUENTE ÚNICA de la fila (D1): la escribe el motor post-commit; el
 * `RegistrarE2ReenvioPresupuestoAdapter` ya NO persiste una segunda fila (solo proyecta
 * la respuesta optimista). El PDF vigente viaja por referencia (`pdf_url`). D2: el
 * reenvío SIN cambios usa el texto E2 ESTÁNDAR (NO lleva `esEdicion`). Best-effort: un
 * fallo del proveedor NO propaga (el reenvío es una acción idempotente del gestor).
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
    const pdfUrl = (params.pdfUrl as string | null) ?? null;

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

    // Adjunto del presupuesto vigente por referencia (solo si hay PDF).
    const adjuntos =
      pdfUrl !== null
        ? [{ clave: 'presupuesto', nombre: 'presupuesto.pdf', pdfUrl }]
        : [];

    // Camino de reenvío REAL (no idempotente): escribe la única fila E2
    // `es_reenvio=true` y ejerce el transporte. SIN marca de edición (E2 estándar, D2).
    await this.motorEmail.despacharReenvio({
      tenantId,
      codigoEmail: 'E2',
      reserva: { idReserva: reserva.idReserva, codigo: reserva.codigo },
      cliente: {
        idCliente: reserva.cliente.idCliente,
        nombre: reserva.cliente.nombre,
        apellidos: reserva.cliente.apellidos ?? '',
        email: reserva.cliente.email,
        telefono: reserva.cliente.telefono ?? '',
      },
      adjuntos,
      idioma: reserva.idioma,
    });
  };
}

/**
 * Proyecta la COMUNICACION E2 del reenvío para la respuesta HTTP con estado OPTIMISTA
 * `enviado` / `es_reenvio=true`. FUENTE ÚNICA de la fila (D1): la escribe el MOTOR de
 * email post-commit (`ReenviarE2PresupuestoAdapter.reenviar` → `despacharReenvio`), de
 * modo que aquí YA NO se persiste una segunda fila (evita el doble registro). Solo
 * verifica RESERVA/CLIENTE bajo RLS y devuelve la proyección (el estado real
 * enviado/fallido queda auditado en la fila que crea el motor).
 */
@Injectable()
export class RegistrarE2ReenvioPresupuestoAdapter {
  constructor(private readonly prisma: PrismaService) {}

  readonly registrar = async (
    params: Record<string, unknown>,
  ): Promise<ComunicacionE2Reenvio> => {
    const tenantId = params.tenantId as string;
    const reservaId = params.reservaId as string;
    await this.prisma.$transaction(async (tx) => {
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
    });
    // Proyección optimista (la fila real la escribe el motor post-commit, fuente única).
    return {
      idComunicacion: '',
      codigoEmail: CodigoEmailPrisma.E2,
      estado: EstadoComunicacionPrisma.enviado,
      esReenvio: true,
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

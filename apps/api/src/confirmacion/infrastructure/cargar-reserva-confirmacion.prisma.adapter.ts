/**
 * Adaptador Prisma del puerto `CargarReservaConfirmacionPort` (US-021).
 *
 * Lee la RESERVA por id bajo el contexto RLS del tenant (cross-tenant → null → 404).
 * Se usa FUERA de la transacción crítica para las guardas previas (existencia, origen,
 * importe del presupuesto vigente) sin efectos. Mapea el enum Prisma `SubEstadoConsulta`
 * (`s2a`) al valor de dominio (`2a`). El importe a congelar procede del PRESUPUESTO
 * VIGENTE (MAX(version) en estado `enviado`), proyectado en `presupuestoVigente` con su
 * `total` Decimal→string (2 decimales); `null` si no hay presupuesto en `enviado`.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  CargarReservaConfirmacionPort,
  ReservaConfirmacion,
} from '../application/confirmar-pago-senal.use-case';
import type { EstadoReserva } from '../../reservas/domain/maquina-estados';
import {
  subEstadoPrismaADominio,
  type SubEstadoConsultaPrisma,
} from '../../reservas/infrastructure/sub-estado-consulta.mapper';

@Injectable()
export class CargarReservaConfirmacionPrismaAdapter {
  constructor(private readonly prisma: PrismaService) {}

  readonly cargar: CargarReservaConfirmacionPort = async (params) => {
    const resultado = await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, params.tenantId);
      const fila = await tx.reserva.findFirst({
        where: { idReserva: params.reservaId, tenantId: params.tenantId },
      });
      if (fila === null) {
        return null;
      }
      // Presupuesto VIGENTE: el de MAX(version) en estado `enviado`. Su `total` es la
      // fuente del importe a congelar; si no hay ninguno en `enviado`, `null`.
      const presupuesto = await tx.presupuesto.findFirst({
        where: {
          reservaId: params.reservaId,
          tenantId: params.tenantId,
          estado: 'enviado',
        },
        orderBy: { version: 'desc' },
        select: { idPresupuesto: true, total: true },
      });
      return { fila, presupuesto };
    });
    if (resultado === null) {
      return null;
    }
    const { fila, presupuesto } = resultado;
    const reserva: ReservaConfirmacion = {
      idReserva: fila.idReserva,
      tenantId: fila.tenantId,
      estado: fila.estado as EstadoReserva,
      subEstado:
        fila.subEstado === null
          ? null
          : subEstadoPrismaADominio(fila.subEstado as SubEstadoConsultaPrisma),
      fechaEvento: fila.fechaEvento,
      presupuestoVigente:
        presupuesto === null
          ? null
          : {
              idPresupuesto: presupuesto.idPresupuesto,
              total: presupuesto.total.toFixed(2),
            },
      comentarios: fila.comentarios,
    };
    return reserva;
  };
}

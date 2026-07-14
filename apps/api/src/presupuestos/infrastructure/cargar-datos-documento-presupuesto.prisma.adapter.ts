/**
 * Adaptador Prisma del puerto `CargarDatosDocumentoPresupuestoPort` (épico #6, rebanada
 * 6.1b `documentos-presupuesto-pdf-con-iva`) — INFRAESTRUCTURA de `presupuestos`.
 *
 * Carga, bajo el RLS del tenant, todo lo que necesita el documento del presupuesto:
 * cliente (receptor), datos de la reserva (fecha del evento, duración, nº de personas),
 * el propio presupuesto (número + desglose fiscal CON IVA), sus extras como sub-conceptos
 * y el reparto 40/60/fianza (derivado del total + settings del tenant con `calcularReparto`
 * del dominio de `presupuestos`). Cross-tenant / no encontrado → `null` (degrada sin
 * romper el post-commit). RLS: fija `app.tenant_id` dentro de la transacción y filtra por
 * `tenantId`, igual patrón que el resto de adaptadores Prisma.
 */
import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { calcularReparto } from '../domain/desglose-fiscal';
import { duracionHorasPrismaANumero } from '../../reservas/infrastructure/duracion-horas.mapper';
import type {
  CargarDatosDocumentoPresupuestoParams,
  CargarDatosDocumentoPresupuestoPort,
  DatosDocumentoPresupuestoCargados,
} from './pdf-presupuesto.real.adapter';

const aImporte = (valor: Prisma.Decimal | null): string =>
  valor === null ? '0.00' : valor.toFixed(2);

@Injectable()
export class CargarDatosDocumentoPresupuestoPrismaAdapter
  implements CargarDatosDocumentoPresupuestoPort
{
  constructor(private readonly prisma: PrismaService) {}

  async ejecutar(
    params: CargarDatosDocumentoPresupuestoParams,
  ): Promise<DatosDocumentoPresupuestoCargados | null> {
    return this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, params.tenantId);

      const presupuesto = await tx.presupuesto.findFirst({
        where: {
          idPresupuesto: params.idPresupuesto,
          tenantId: params.tenantId,
          reservaId: params.reservaId,
        },
      });
      if (presupuesto === null) {
        return null;
      }

      const reserva = await tx.reserva.findFirst({
        where: { idReserva: params.reservaId, tenantId: params.tenantId },
        include: { cliente: true, reservaExtras: true },
      });
      if (reserva === null || reserva.fechaEvento === null) {
        return null;
      }

      const settings = await tx.tenantSettings.findUnique({
        where: { tenantId: params.tenantId },
        select: { pctSenal: true, fianzaDefaultEur: true },
      });
      if (settings === null) {
        return null;
      }

      const reparto = calcularReparto({
        totalConIva: Number(aImporte(presupuesto.total)),
        pctSenal: Number(settings.pctSenal),
        fianzaDefaultEur: Number(settings.fianzaDefaultEur),
      });

      const datos: DatosDocumentoPresupuestoCargados = {
        numeroPresupuesto: presupuesto.numeroPresupuesto ?? '',
        fecha: presupuesto.fechaEnvio ?? presupuesto.fechaCreacion,
        cliente: {
          nombre: reserva.cliente.nombre,
          apellidos: reserva.cliente.apellidos,
          dniNif: reserva.cliente.dniNif,
          direccion: reserva.cliente.direccion,
          codigoPostal: reserva.cliente.codigoPostal,
          poblacion: reserva.cliente.poblacion,
          provincia: reserva.cliente.provincia,
        },
        fechaEvento: reserva.fechaEvento,
        duracionHoras: duracionHorasPrismaANumero(reserva.duracionHoras) ?? 0,
        numPersonas: reserva.numAdultosNinosMayores4 ?? 0,
        extras: reserva.reservaExtras.map((extra) => ({
          descripcion: extra.conceptoLibre ?? 'Extra',
          importeEur: aImporte(extra.subtotal),
        })),
        desglose: {
          baseImponible: aImporte(presupuesto.baseImponible),
          ivaPorcentaje: aImporte(presupuesto.ivaPorcentaje),
          ivaImporte: aImporte(presupuesto.ivaImporte),
          total: aImporte(presupuesto.total),
        },
        reparto,
      };
      return datos;
    });
  }
}

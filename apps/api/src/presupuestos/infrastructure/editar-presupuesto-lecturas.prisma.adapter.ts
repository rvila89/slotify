/**
 * Adaptadores Prisma de LECTURA de la edición/reenvío de presupuesto (US-015),
 * fuera de la transacción crítica, bajo el contexto RLS del tenant (cross-tenant →
 * null). Implementan los puertos de lectura del use-case:
 *   - `CargarReservaEdicionPort`: RESERVA en `pre_reserva` (para las guardas).
 *   - `CargarPresupuestoVigentePort`: PRESUPUESTO `MAX(version)` de la RESERVA.
 *   - `CargarExtraCatalogoPort`: precio ACTUAL del EXTRA (congelar líneas nuevas).
 *   - `CargarLineasExistentesPort`: conjunto vivo de `RESERVA_EXTRA` de la RESERVA.
 *
 * Hexagonal: la aplicación depende solo de las interfaces; estos adaptadores son
 * infraestructura (Prisma). Se enlazan por token en el módulo.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type { EstadoReserva } from '../../reservas/domain/maquina-estados';
import { duracionHorasPrismaANumero } from '../../reservas/infrastructure/duracion-horas.mapper';
import {
  subEstadoPrismaADominio,
  type SubEstadoConsultaPrisma,
} from '../../reservas/infrastructure/sub-estado-consulta.mapper';
import type {
  CargarExtraCatalogoPort,
  CargarLineasExistentesPort,
  CargarPresupuestoVigentePort,
  CargarReservaEdicionPort,
  ExtraCatalogo,
  LineaExtraExistente,
  PresupuestoVigente,
  ReservaEdicion,
} from '../application/editar-presupuesto.use-case';
import type { MetodoPago, RegimenIva } from '../domain/regimen-desde-metodo-pago';

@Injectable()
export class CargarReservaEdicionPrismaAdapter {
  constructor(private readonly prisma: PrismaService) {}

  readonly cargar: CargarReservaEdicionPort = async (params) => {
    const fila = await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, params.tenantId);
      return tx.reserva.findFirst({
        where: { idReserva: params.reservaId, tenantId: params.tenantId },
      });
    });
    if (fila === null) {
      return null;
    }
    const reserva: ReservaEdicion = {
      idReserva: fila.idReserva,
      tenantId: fila.tenantId,
      clienteId: fila.clienteId,
      estado: fila.estado as EstadoReserva,
      subEstado:
        fila.subEstado === null
          ? null
          : subEstadoPrismaADominio(fila.subEstado as SubEstadoConsultaPrisma),
      fechaEvento: fila.fechaEvento,
      duracionHoras: duracionHorasPrismaANumero(fila.duracionHoras),
      numAdultosNinosMayores4: fila.numAdultosNinosMayores4,
      numNinosMenores4: fila.numNinosMenores4,
      tipoEvento: fila.tipoEvento,
      ttlExpiracion: fila.ttlExpiracion,
    };
    return reserva;
  };
}

@Injectable()
export class CargarPresupuestoVigentePrismaAdapter {
  constructor(private readonly prisma: PrismaService) {}

  readonly cargar: CargarPresupuestoVigentePort = async (params) => {
    const fila = await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, params.tenantId);
      return tx.presupuesto.findFirst({
        where: { reservaId: params.reservaId, tenantId: params.tenantId },
        orderBy: { version: 'desc' },
      });
    });
    if (fila === null) {
      return null;
    }
    const vigente: PresupuestoVigente = {
      idPresupuesto: fila.idPresupuesto,
      reservaId: fila.reservaId,
      version: fila.version,
      estado: fila.estado,
      numeroPresupuesto: fila.numeroPresupuesto,
      metodoPago: (fila.metodoPago as MetodoPago | null) ?? null,
      regimenIva: (fila.regimenIva as RegimenIva | null) ?? null,
      baseImponible: fila.baseImponible.toFixed(2),
      ivaPorcentaje: fila.ivaPorcentaje.toFixed(2),
      ivaImporte: fila.ivaImporte.toFixed(2),
      total: fila.total.toFixed(2),
      descuentoEur: fila.descuentoEur === null ? null : fila.descuentoEur.toFixed(2),
      descuentoMotivo: fila.descuentoMotivo,
      tarifaId: null,
      pdfUrl: fila.pdfUrl,
    };
    return vigente;
  };
}

@Injectable()
export class CargarExtraCatalogoPrismaAdapter {
  constructor(private readonly prisma: PrismaService) {}

  readonly cargar: CargarExtraCatalogoPort = async (params) => {
    const fila = await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, params.tenantId);
      return tx.extra.findFirst({
        where: { idExtra: params.extraId, tenantId: params.tenantId },
      });
    });
    if (fila === null) {
      return null;
    }
    const extra: ExtraCatalogo = {
      idExtra: fila.idExtra,
      precioEur: Number(fila.precioEur),
      activo: fila.activo,
    };
    return extra;
  };
}

@Injectable()
export class CargarLineasExistentesPrismaAdapter {
  constructor(private readonly prisma: PrismaService) {}

  readonly cargar: CargarLineasExistentesPort = async (params) => {
    const filas = await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, params.tenantId);
      return tx.reservaExtra.findMany({
        where: { reservaId: params.reservaId },
        orderBy: { fechaCreacion: 'asc' },
      });
    });
    return filas.map(
      (fila): LineaExtraExistente => ({
        idReservaExtra: fila.idReservaExtra,
        extraId: fila.extraId,
        conceptoLibre: fila.conceptoLibre,
        cantidad: fila.cantidad,
        precioUnitario: fila.precioUnitario.toFixed(2),
        subtotal: fila.subtotal.toFixed(2),
        origen: fila.origen,
        facturaId: fila.facturaId,
      }),
    );
  };
}

/**
 * Adaptador Prisma del puerto `CargarReservaRecalculoPort` (change `reserva-viva-edicion-
 * recalculo-ficha` §D-4).
 *
 * Proyecta la RESERVA en la ventana viva (estado + sub-procesos + importes congelados +
 * desglose estructurado) junto a su FACTURA `tipo='liquidacion'` vigente. Fija el contexto
 * RLS (`SET LOCAL app.tenant_id`) como PRIMERA operación y filtra SIEMPRE por `tenant_id`
 * (defensa en profundidad): una RESERVA de otro tenant es invisible → `null` → 404.
 */
import { Injectable } from '@nestjs/common';
import { DuracionHoras, TipoFactura } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  CargarReservaRecalculoPort,
  EstadoFacturaLiquidacion,
  ReservaRecalculo,
} from '../application/recalcular-reserva-viva.use-case';
import type {
  EstadoReserva,
  LiquidacionStatusDominio,
  PreEventoStatusDominio,
} from '../../reservas/domain/maquina-estados';

/** Convierte el enum `DuracionHoras {h4,h8,h12}` a su valor numérico `{4,8,12}` o 0. */
const duracionHorasANumero = (duracion: DuracionHoras | null): number => {
  switch (duracion) {
    case DuracionHoras.h4:
      return 4;
    case DuracionHoras.h8:
      return 8;
    case DuracionHoras.h12:
      return 12;
    default:
      return 0;
  }
};

@Injectable()
export class CargarReservaRecalculoPrismaAdapter {
  constructor(private readonly prisma: PrismaService) {}

  /** Implementa `CargarReservaRecalculoPort` (función invocable). */
  readonly cargar: CargarReservaRecalculoPort = async ({ tenantId, reservaId }) => {
    const fila = await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, tenantId);
      return tx.reserva.findFirst({
        where: { idReserva: reservaId, tenantId },
        include: {
          facturas: { where: { tipo: TipoFactura.liquidacion } },
        },
      });
    });

    if (fila === null) {
      return null;
    }

    const facturaLiq = fila.facturas[0] ?? null;

    const reserva: ReservaRecalculo = {
      idReserva: fila.idReserva,
      tenantId: fila.tenantId,
      estado: fila.estado as EstadoReserva,
      preEventoStatus: fila.preEventoStatus as PreEventoStatusDominio,
      liquidacionStatus: fila.liquidacionStatus as LiquidacionStatusDominio,
      fechaEvento: fila.fechaEvento ?? new Date(),
      idioma: fila.idioma,
      importeTotal: fila.importeTotal === null ? null : fila.importeTotal.toFixed(2),
      importeSenal: fila.importeSenal === null ? null : fila.importeSenal.toFixed(2),
      importeLiquidacion:
        fila.importeLiquidacion === null ? null : fila.importeLiquidacion.toFixed(2),
      duracionHoras: duracionHorasANumero(fila.duracionHoras),
      numAdultosNinosMayores4: fila.numAdultosNinosMayores4 ?? 0,
      numNinosMenores4: fila.numNinosMenores4 ?? 0,
      numInvitadosFinal: fila.numInvitadosFinal,
      facturaLiquidacion:
        facturaLiq === null
          ? null
          : {
              idFactura: facturaLiq.idFactura,
              tipo: 'liquidacion',
              estado: facturaLiq.estado as EstadoFacturaLiquidacion,
            },
    };
    return reserva;
  };
}

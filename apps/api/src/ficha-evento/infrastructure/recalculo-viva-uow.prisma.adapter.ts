/**
 * Adaptador de la UNIDAD DE TRABAJO transaccional del RECÁLCULO de reserva viva (change
 * `reserva-viva-edicion-recalculo-ficha` §D-4.2).
 *
 * Implementa `UnidadDeTrabajoRecalculoPort`: abre UN `prisma.$transaction`, fija el contexto
 * RLS (`fijarTenant`, `SET LOCAL app.tenant_id`) como PRIMERA operación y expone los
 * repositorios tx-bound (PRESUPUESTO versión de modificación, RESERVA importes+desglose,
 * FACTURA liquidación, AUDIT_LOG). Si el `trabajo` rechaza, la transacción revierte
 * (all-or-nothing). Los repositorios tx-bound viven y mueren con la transacción.
 *
 * INVARIANTE DURA: `recongelarImportes` NO escribe `importe_senal` (solo `importe_total` e
 * `importe_liquidacion`): la señal congelada al confirmar es intocable.
 */
import { Injectable } from '@nestjs/common';
import {
  AccionAudit,
  DuracionHoras,
  EstadoPresupuesto,
  Prisma,
} from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { calcularDesgloseFactura } from '../../facturacion/domain/calculo-factura';
import type {
  AuditoriaRecalculoPort,
  CrearVersionModificacionParams,
  FacturaRecalculoRepositoryPort,
  GuardarDesgloseParams,
  PresupuestoModificacionCreado,
  PresupuestoRecalculoRepositoryPort,
  RecongelarImportesParams,
  RegenerarLiquidacionParams,
  RegistroAuditoriaRecalculo,
  ReposRecalculo,
  ReservaRecalculoRepositoryPort,
  UnidadDeTrabajoRecalculoPort,
} from '../application/recalcular-reserva-viva.use-case';

/** Convierte el valor numérico `{4,8,12}` al enum Prisma `DuracionHoras`. */
const numeroADuracionHoras = (horas: number): DuracionHoras => {
  switch (horas) {
    case 4:
      return DuracionHoras.h4;
    case 12:
      return DuracionHoras.h12;
    default:
      return DuracionHoras.h8;
  }
};

/** Repositorio tx-bound de PRESUPUESTO (versión de modificación). */
class PresupuestoRecalculoPrismaRepository
  implements PresupuestoRecalculoRepositoryPort
{
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async versionMaxima(params: {
    tenantId: string;
    reservaId: string;
  }): Promise<number> {
    const agg = await this.tx.presupuesto.aggregate({
      where: { reservaId: params.reservaId },
      _max: { version: true },
    });
    return agg._max.version ?? 0;
  }

  async crearVersionModificacion(
    params: CrearVersionModificacionParams,
  ): Promise<PresupuestoModificacionCreado> {
    // Desglose fiscal del nuevo total (con IVA, patrón US-022/US-027).
    const desglose = calcularDesgloseFactura(params.total, 'con_iva');
    const fila = await this.tx.presupuesto.create({
      data: {
        tenantId: params.tenantId,
        reservaId: params.reservaId,
        version: params.version,
        baseImponible: desglose.baseImponible,
        ivaPorcentaje: desglose.ivaPorcentaje,
        ivaImporte: desglose.ivaImporte,
        total: desglose.total,
        estado: EstadoPresupuesto.borrador,
        origen: params.origen,
      },
    });
    return {
      idPresupuesto: fila.idPresupuesto,
      version: fila.version,
      origen: fila.origen ?? params.origen,
      total: fila.total.toFixed(2),
      pagoInicial: params.pagoInicial,
      liquidacionRestante: params.liquidacionRestante,
    };
  }
}

/** Repositorio tx-bound de RESERVA (re-congelado de importes + desglose estructurado). */
class ReservaRecalculoPrismaRepository implements ReservaRecalculoRepositoryPort {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async recongelarImportes(params: RecongelarImportesParams): Promise<void> {
    // INVARIANTE: NO se escribe `importe_senal` (congelado al confirmar la señal).
    await this.tx.reserva.update({
      where: { idReserva: params.reservaId },
      data: {
        importeTotal: params.importeTotal,
        importeLiquidacion: params.importeLiquidacion,
      },
    });
  }

  async guardarDesglose(params: GuardarDesgloseParams): Promise<void> {
    await this.tx.reserva.update({
      where: { idReserva: params.reservaId },
      data: {
        duracionHoras: numeroADuracionHoras(params.duracionHoras),
        numAdultosNinosMayores4: params.numAdultosNinosMayores4,
        numNinosMenores4: params.numNinosMenores4,
      },
    });
  }
}

/** Repositorio tx-bound de FACTURA (regeneración de la liquidación; fianza intocable). */
class FacturaRecalculoPrismaRepository implements FacturaRecalculoRepositoryPort {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async regenerarLiquidacion(params: RegenerarLiquidacionParams): Promise<void> {
    const desglose = calcularDesgloseFactura(params.total, 'con_iva');
    await this.tx.factura.update({
      where: { idFactura: params.idFactura },
      data: {
        baseImponible: desglose.baseImponible,
        ivaPorcentaje: desglose.ivaPorcentaje,
        ivaImporte: desglose.ivaImporte,
        total: desglose.total,
      },
    });
  }
}

/** Repositorio tx-bound de AUDIT_LOG (comparte el rollback de la transacción). */
class AuditoriaRecalculoPrismaRepository implements AuditoriaRecalculoPort {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async registrar(registro: RegistroAuditoriaRecalculo): Promise<void> {
    const datosNuevos = registro.datosNuevos as Prisma.InputJsonValue | undefined;
    await this.tx.auditLog.create({
      data: {
        tenantId: registro.tenantId,
        usuarioId: registro.usuarioId ?? null,
        entidad: registro.entidad,
        entidadId: registro.entidadId,
        accion: registro.accion as AccionAudit,
        ...(datosNuevos !== undefined ? { datosNuevos } : {}),
      },
    });
  }
}

@Injectable()
export class RecalculoVivaUoWPrismaAdapter implements UnidadDeTrabajoRecalculoPort {
  constructor(private readonly prisma: PrismaService) {}

  async ejecutar(
    tenantId: string,
    trabajo: (repos: ReposRecalculo) => Promise<unknown>,
  ): Promise<unknown> {
    return this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, tenantId);
      const repos: ReposRecalculo = {
        presupuestos: new PresupuestoRecalculoPrismaRepository(tx),
        reservas: new ReservaRecalculoPrismaRepository(tx),
        facturas: new FacturaRecalculoPrismaRepository(tx),
        auditoria: new AuditoriaRecalculoPrismaRepository(tx),
      };
      return trabajo(repos);
    });
  }
}

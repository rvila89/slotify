/**
 * Adaptadores Prisma de LECTURA de la capability `facturacion` (US-022 / UC-18).
 *
 * Cada lectura abre su propio `$transaction` + `fijarTenant` (RLS): la RESERVA facturable,
 * los datos fiscales del CLIENTE (receptor) y del TENANT (emisor), la FACTURA por id y la
 * FACTURA con su reserva/cliente para regenerar el PDF. Cross-tenant → null (invisible por
 * RLS). Los Decimal se mapean a string de 2 decimales.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  CargarClienteFiscalPort,
  CargarReservaFacturablePort,
  CargarTenantFiscalPort,
  ClienteFiscal,
  FacturaSenal,
  ReservaFacturable,
} from '../application/generar-factura-senal.use-case';
import { CAMPOS_FISCALES_CLIENTE } from '../application/generar-factura-senal.use-case';
import type { CargarFacturaParaPdfPort } from '../application/regenerar-pdf-factura.use-case';
import { aFacturaSenal } from './facturacion-repository.prisma.adapter';

@Injectable()
export class CargarReservaFacturablePrismaAdapter {
  constructor(private readonly prisma: PrismaService) {}

  readonly cargar: CargarReservaFacturablePort = async (params) => {
    const fila = await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, params.tenantId);
      return tx.reserva.findFirst({
        where: { idReserva: params.reservaId, tenantId: params.tenantId },
        select: {
          idReserva: true,
          tenantId: true,
          clienteId: true,
          codigo: true,
          estado: true,
          importeSenal: true,
          // 6.3: régimen IVA del presupuesto aceptado de la reserva (design.md §D-1).
          presupuestos: {
            where: { estado: 'aceptado' },
            select: { regimenIva: true },
            take: 1,
          },
        },
      });
    });
    if (fila === null) {
      return null;
    }
    const reserva: ReservaFacturable = {
      idReserva: fila.idReserva,
      tenantId: fila.tenantId,
      clienteId: fila.clienteId,
      codigo: fila.codigo,
      estado: fila.estado,
      importeSenal: fila.importeSenal === null ? '0.00' : fila.importeSenal.toFixed(2),
      // Sin presupuesto aceptado (o régimen NULL) → CON IVA por defecto (transferencia).
      regimenIva: fila.presupuestos[0]?.regimenIva === 'sin_iva' ? 'sin_iva' : 'con_iva',
    };
    return reserva;
  };
}

@Injectable()
export class CargarClienteFiscalPrismaAdapter {
  constructor(private readonly prisma: PrismaService) {}

  readonly cargar: CargarClienteFiscalPort = async (params) => {
    const fila = await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, params.tenantId);
      return tx.cliente.findFirst({
        where: { idCliente: params.clienteId, tenantId: params.tenantId },
        select: {
          idCliente: true,
          nombre: true,
          apellidos: true,
          dniNif: true,
          direccion: true,
          codigoPostal: true,
          poblacion: true,
          provincia: true,
        },
      });
    });
    if (fila === null) {
      throw new Error(`Cliente ${params.clienteId} no encontrado para el tenant`);
    }
    const cliente: ClienteFiscal = { ...fila };
    return cliente;
  };
}

@Injectable()
export class CargarTenantFiscalPrismaAdapter {
  constructor(private readonly prisma: PrismaService) {}

  readonly cargar: CargarTenantFiscalPort = async (params) => {
    const fila = await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, params.tenantId);
      return tx.tenant.findFirst({
        where: { idTenant: params.tenantId },
        select: {
          idTenant: true,
          nombre: true,
          nif: true,
          iban: true,
          direccion: true,
        },
      });
    });
    if (fila === null) {
      throw new Error(`Tenant ${params.tenantId} no encontrado`);
    }
    return fila;
  };
}

/** Lectura de la FACTURA por id (para aprobar/rechazar). */
@Injectable()
export class CargarFacturaPrismaAdapter {
  constructor(private readonly prisma: PrismaService) {}

  readonly cargar = async (params: {
    tenantId: string;
    facturaId: string;
  }): Promise<FacturaSenal | null> => {
    const fila = await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, params.tenantId);
      return tx.factura.findFirst({
        where: { idFactura: params.facturaId, tenantId: params.tenantId },
      });
    });
    return fila === null ? null : aFacturaSenal(fila);
  };
}

/**
 * Enumera los campos fiscales del CLIENTE de la RESERVA de una FACTURA que faltan (§D-9).
 * Se usa como guarda de la aprobación (DATOS_FISCALES_INCOMPLETOS).
 */
@Injectable()
export class CamposFiscalesFaltantesFacturaPrismaAdapter {
  constructor(private readonly prisma: PrismaService) {}

  readonly obtener = async (params: {
    tenantId: string;
    facturaId: string;
  }): Promise<ReadonlyArray<string>> => {
    const cliente = await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, params.tenantId);
      const factura = await tx.factura.findFirst({
        where: { idFactura: params.facturaId, tenantId: params.tenantId },
        select: {
          reserva: {
            select: {
              cliente: {
                select: {
                  dniNif: true,
                  direccion: true,
                  codigoPostal: true,
                  poblacion: true,
                  provincia: true,
                },
              },
            },
          },
        },
      });
      return factura?.reserva.cliente ?? null;
    });
    if (cliente === null) {
      return [];
    }
    return CAMPOS_FISCALES_CLIENTE.filter((campo) => {
      const valor = (cliente as Record<string, string | null>)[campo];
      return valor === null || valor === undefined || valor === '';
    });
  };
}

/** Lectura de la FACTURA + reserva/cliente asociados para regenerar el PDF. */
@Injectable()
export class CargarFacturaParaPdfPrismaAdapter {
  constructor(private readonly prisma: PrismaService) {}

  readonly cargar: CargarFacturaParaPdfPort = async (params) => {
    const fila = await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, params.tenantId);
      return tx.factura.findFirst({
        where: { idFactura: params.facturaId, tenantId: params.tenantId },
        include: { reserva: { select: { clienteId: true, codigo: true } } },
      });
    });
    if (fila === null) {
      return null;
    }
    return {
      factura: aFacturaSenal(fila),
      clienteId: fila.reserva.clienteId,
      concepto: fila.concepto ?? `Señal reserva ${fila.reserva.codigo}`,
    };
  };
}

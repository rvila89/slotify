/**
 * Adaptador Prisma del puerto `CargarClientePort` (US-014).
 *
 * Lee el CLIENTE por id bajo el contexto RLS del tenant para la validación fiscal
 * FA-01 (dniNif/direccion/codigoPostal/poblacion/provincia). Cross-tenant → null.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  CargarClientePort,
  ClientePresupuesto,
} from '../application/generar-presupuesto.use-case';

@Injectable()
export class CargarClientePrismaAdapter {
  constructor(private readonly prisma: PrismaService) {}

  readonly cargar: CargarClientePort = async (params) => {
    const fila = await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, params.tenantId);
      return tx.cliente.findFirst({
        where: { idCliente: params.clienteId, tenantId: params.tenantId },
      });
    });
    if (fila === null) {
      return null;
    }
    const cliente: ClientePresupuesto = {
      idCliente: fila.idCliente,
      tenantId: fila.tenantId,
      nombre: fila.nombre,
      apellidos: fila.apellidos,
      email: fila.email,
      telefono: fila.telefono,
      dniNif: fila.dniNif,
      direccion: fila.direccion,
      codigoPostal: fila.codigoPostal,
      poblacion: fila.poblacion,
      provincia: fila.provincia,
    };
    return cliente;
  };
}

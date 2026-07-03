/**
 * Adaptador Prisma del puerto `CargarClienteResultadoVisitaPort` (US-010).
 *
 * Lee el CLIENTE por id bajo el contexto RLS del tenant para la validación de datos
 * obligatorios UC-14 (D-4) del resultado de visita «reserva inmediata»
 * (dniNif/direccion/codigoPostal/poblacion/provincia). Cross-tenant → null. Se usa
 * FUERA de la tx crítica de mutación.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  CargarClienteResultadoVisitaPort,
  ClienteResultadoVisita,
} from '../application/registrar-resultado-visita.use-case';

@Injectable()
export class CargarClienteResultadoVisitaPrismaAdapter
  implements CargarClienteResultadoVisitaPort
{
  constructor(private readonly prisma: PrismaService) {}

  async obtener(params: {
    tenantId: string;
    clienteId: string;
  }): Promise<ClienteResultadoVisita | null> {
    const fila = await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, params.tenantId);
      return tx.cliente.findFirst({
        where: { idCliente: params.clienteId, tenantId: params.tenantId },
        select: {
          idCliente: true,
          tenantId: true,
          dniNif: true,
          direccion: true,
          codigoPostal: true,
          poblacion: true,
          provincia: true,
        },
      });
    });
    return fila;
  }
}

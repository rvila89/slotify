/**
 * Adaptador de LECTURA de la RESERVA + su CLIENTE para la solicitud de datos de presupuesto
 * (change `solicitud-datos-presupuesto-borrador`).
 *
 * INFRAESTRUCTURA: carga la proyección `ReservaPresupuestoContexto` (idioma, fecha del evento,
 * personas, duración y datos fiscales del cliente) bajo el contexto RLS del tenant del JWT
 * (`app.tenant_id` fijado en la transacción): una RESERVA de otro tenant es INVISIBLE
 * (→ `null` → 404). El `cliente_id` sale de la relación de la RESERVA (nunca del body); el
 * `tenant_id`, del JWT. Traduce el enum Prisma `DuracionHoras` (`h4/h8/h12`) al número de
 * dominio con el mapper compartido de `reservas`.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { duracionHorasPrismaANumero } from '../../reservas/infrastructure/duracion-horas.mapper';
import type {
  CargarReservaPresupuestoContextoParams,
  CargarReservaPresupuestoContextoPort,
  ReservaPresupuestoContexto,
} from '../application/solicitar-datos-presupuesto.use-case';

@Injectable()
export class CargarReservaPresupuestoContextoPrismaAdapter
  implements CargarReservaPresupuestoContextoPort
{
  constructor(private readonly prisma: PrismaService) {}

  async cargar(
    params: CargarReservaPresupuestoContextoParams,
  ): Promise<ReservaPresupuestoContexto | null> {
    return this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, params.tenantId);
      const fila = await tx.reserva.findFirst({
        where: { idReserva: params.reservaId, tenantId: params.tenantId },
        select: {
          idReserva: true,
          tenantId: true,
          clienteId: true,
          codigo: true,
          idioma: true,
          fechaEvento: true,
          numInvitadosFinal: true,
          duracionHoras: true,
          cliente: {
            select: {
              idCliente: true,
              nombre: true,
              apellidos: true,
              email: true,
              telefono: true,
              dniNif: true,
              direccion: true,
              codigoPostal: true,
              poblacion: true,
              provincia: true,
            },
          },
        },
      });
      if (fila === null) {
        return null;
      }
      return {
        idReserva: fila.idReserva,
        tenantId: fila.tenantId,
        clienteId: fila.clienteId,
        codigo: fila.codigo,
        idioma: fila.idioma,
        fechaEvento: fila.fechaEvento ?? new Date(0),
        numInvitadosFinal: fila.numInvitadosFinal,
        duracionHoras: duracionHorasPrismaANumero(fila.duracionHoras),
        cliente: {
          idCliente: fila.cliente.idCliente,
          nombre: fila.cliente.nombre,
          apellidos: fila.cliente.apellidos,
          email: fila.cliente.email,
          telefono: fila.cliente.telefono,
          dniNif: fila.cliente.dniNif,
          direccion: fila.cliente.direccion,
          codigoPostal: fila.cliente.codigoPostal,
          poblacion: fila.cliente.poblacion,
          provincia: fila.cliente.provincia,
        },
      };
    });
  }
}

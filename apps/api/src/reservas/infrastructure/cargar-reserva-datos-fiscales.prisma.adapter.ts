/**
 * Adaptador de LECTURA de la RESERVA para la actualización de datos fiscales del CLIENTE
 * (US-014 #5, Parte B / UC-14).
 *
 * Carga la proyección mínima que la actualización necesita (`cliente_id` + los cinco campos
 * fiscales PREVIOS del CLIENTE, para el AUDIT_LOG de la corrección y para devolver los campos
 * ausentes con su valor previo) bajo el contexto RLS del tenant del Gestor: una RESERVA de otro
 * tenant es INVISIBLE (→ `null` → 404). La lectura es previa a la transacción de escritura.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  ActualizarDatosFiscalesClienteComando,
  ReservaDatosFiscales,
} from '../application/actualizar-datos-fiscales-cliente.use-case';

@Injectable()
export class CargarReservaDatosFiscalesPrismaAdapter {
  constructor(private readonly prisma: PrismaService) {}

  async cargar(
    comando: ActualizarDatosFiscalesClienteComando,
  ): Promise<ReservaDatosFiscales | null> {
    return this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, comando.tenantId);
      const fila = await tx.reserva.findFirst({
        where: { idReserva: comando.reservaId, tenantId: comando.tenantId },
        select: {
          idReserva: true,
          tenantId: true,
          clienteId: true,
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
      });
      if (fila === null) {
        return null;
      }
      return {
        idReserva: fila.idReserva,
        tenantId: fila.tenantId,
        clienteId: fila.clienteId,
        datosFiscalesActuales: {
          dniNif: fila.cliente.dniNif,
          direccion: fila.cliente.direccion,
          codigoPostal: fila.cliente.codigoPostal,
          poblacion: fila.cliente.poblacion,
          provincia: fila.cliente.provincia,
        } as ReservaDatosFiscales['datosFiscalesActuales'],
      };
    });
  }
}

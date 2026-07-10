/**
 * Adaptador de LECTURA de la RESERVA para el registro del IBAN de devolución
 * (US-035 / UC-26 FA-01, UC-27).
 *
 * Carga la proyección mínima que el registro necesita (`estado`, `fianza_eur`, `cliente_id`)
 * más los datos del CLIENTE relevantes (`email` destinatario de E8, `iban_devolucion` PREVIO
 * para el AUDIT_LOG de la corrección) bajo el contexto RLS del tenant del Gestor: una RESERVA
 * de otro tenant es INVISIBLE (→ `null` → 404). La lectura es previa a la transacción de
 * escritura del IBAN.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  EstadoReservaIbanDevolucion,
  RegistrarIbanDevolucionComando,
  ReservaIbanDevolucion,
} from '../application/registrar-iban-devolucion.use-case';

@Injectable()
export class CargarReservaIbanDevolucionPrismaAdapter {
  constructor(private readonly prisma: PrismaService) {}

  async cargar(
    comando: RegistrarIbanDevolucionComando,
  ): Promise<ReservaIbanDevolucion | null> {
    return this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, comando.tenantId);
      const fila = await tx.reserva.findFirst({
        where: { idReserva: comando.reservaId, tenantId: comando.tenantId },
        select: {
          idReserva: true,
          tenantId: true,
          clienteId: true,
          estado: true,
          fianzaEur: true,
          cliente: {
            select: {
              email: true,
              ibanDevolucion: true,
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
        estado: fila.estado as EstadoReservaIbanDevolucion,
        // Importe como STRING (Decimal(10,2), sin coma flotante) o null.
        fianzaEur: fila.fianzaEur === null ? null : fila.fianzaEur.toString(),
        clienteEmail: fila.cliente.email,
        ibanDevolucionActual: fila.cliente.ibanDevolucion,
      };
    });
  }
}

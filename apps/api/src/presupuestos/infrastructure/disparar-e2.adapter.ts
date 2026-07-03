/**
 * Adaptador del puerto `DispararE2Port` (US-014 / §D-7).
 *
 * Dispara el email E2 (presupuesto enviado) POST-COMMIT reutilizando el motor de
 * email de US-045 (`DespacharEmailService`): NO se reinventa el envío. El motor es
 * idempotente por el índice UNIQUE parcial `(reserva_id, codigo_email)`, de modo que
 * un doble disparo (doble clic / reintento) NO duplica la COMUNICACION E2. El PDF del
 * presupuesto se adjunta por referencia (`pdf_url`). Un fallo del proveedor NO revierte
 * la pre_reserva (el motor traza el fallo en COMUNICACION sin propagar excepción). En
 * test/CI el transporte va en modo fake.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { DespacharEmailService } from '../../comunicaciones/application/despachar-email.service';
import type { DispararE2Port } from '../application/generar-presupuesto.use-case';

@Injectable()
export class DispararE2Adapter implements DispararE2Port {
  constructor(
    private readonly motorEmail: DespacharEmailService,
    private readonly prisma: PrismaService,
  ) {}

  async disparar(params: {
    tenantId: string;
    reservaId: string;
    pdfUrl: string | null;
  }): Promise<void> {
    const reserva = await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, params.tenantId);
      return tx.reserva.findFirst({
        where: { idReserva: params.reservaId, tenantId: params.tenantId },
        include: { cliente: true },
      });
    });
    if (reserva === null || reserva.cliente === null) {
      return;
    }
    await this.motorEmail.despachar({
      tenantId: params.tenantId,
      codigoEmail: 'E2',
      reserva: { idReserva: reserva.idReserva, codigo: reserva.codigo },
      cliente: {
        idCliente: reserva.cliente.idCliente,
        nombre: reserva.cliente.nombre,
        apellidos: reserva.cliente.apellidos ?? '',
        email: reserva.cliente.email,
        telefono: reserva.cliente.telefono ?? '',
      },
      adjuntos:
        params.pdfUrl === null
          ? []
          : [{ clave: 'presupuesto', nombre: 'presupuesto.pdf', pdfUrl: params.pdfUrl }],
    });
  }
}

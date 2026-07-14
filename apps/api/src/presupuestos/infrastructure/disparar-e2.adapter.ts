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
import type { GenerarPdfCondicionesPort } from '../../documentos/domain/generar-pdf-condiciones.port';
import type { DispararE2Port } from '../application/generar-presupuesto.use-case';

/** Un adjunto del email E2 (presupuesto y/o condicions particulars). */
interface AdjuntoE2 {
  clave: string;
  nombre: string;
  pdfUrl: string;
}

@Injectable()
export class DispararE2Adapter implements DispararE2Port {
  constructor(
    private readonly motorEmail: DespacharEmailService,
    private readonly prisma: PrismaService,
    private readonly generarCondiciones: GenerarPdfCondicionesPort,
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

    // Adjuntos post-commit fire-and-forget: presupuesto (si hay PDF) + condicions
    // particulars (épico #6, 6.4a; se omite sin romper el E2 si degrada a null).
    const adjuntos: AdjuntoE2[] = [];
    if (params.pdfUrl !== null) {
      adjuntos.push({ clave: 'presupuesto', nombre: 'presupuesto.pdf', pdfUrl: params.pdfUrl });
    }
    // La generación puede degradar a `null` (negocio) o LANZAR (fallo real de render
    // react-pdf/subida, p. ej. la flakiness ESM). Al ser post-commit, un fallo del
    // adjunto NUNCA debe propagar ni tumbar la pre_reserva ya commiteada: se traga y se
    // omite el adjunto (mismo criterio que `generarPdfPostCommit` del use-case).
    const urlCondiciones = await this.generarCondiciones
      .generar({ tenantId: params.tenantId })
      .catch(() => null);
    if (urlCondiciones !== null) {
      adjuntos.push({
        clave: 'condiciones',
        nombre: 'condicions-particulars.pdf',
        pdfUrl: urlCondiciones,
      });
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
      adjuntos,
    });
  }
}

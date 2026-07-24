/**
 * Adaptador del puerto `DispararE2Port` (US-014 / §D-7).
 *
 * Dispara el email E2 (presupuesto enviado) POST-COMMIT reutilizando el motor de
 * email de US-045 (`DespacharEmailService`): NO se reinventa el envío. El motor es
 * idempotente por el índice UNIQUE parcial `(reserva_id, codigo_email)`, de modo que
 * un doble disparo (doble clic / reintento) NO duplica la COMUNICACION E2. E2 adjunta SOLO
 * el PDF del presupuesto por referencia (`pdf_url`); las condicions particulars viajan en E3
 * (change condiciones-…-senal-…). Un fallo del proveedor NO revierte
 * la pre_reserva (el motor traza el fallo en COMUNICACION sin propagar excepción). En
 * test/CI el transporte va en modo fake.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { DespacharEmailService } from '../../comunicaciones/application/despachar-email.service';
import type { DispararE2Port } from '../application/generar-presupuesto.use-case';
import { nombreAdjuntoPresupuesto } from '../domain/numeracion-presupuesto';

/** Un adjunto del email E2 (presupuesto). */
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
  ) {}

  async disparar(params: {
    tenantId: string;
    reservaId: string;
    pdfUrl: string | null;
    esEdicion?: boolean;
    numeroPresupuesto?: string | null;
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

    // Adjunto post-commit fire-and-forget: SOLO el presupuesto (si hay PDF). Las
    // condicions particulars se envían en E3 (change condiciones-…-senal-…), no en E2.
    const adjuntos: AdjuntoE2[] = [];
    if (params.pdfUrl !== null) {
      adjuntos.push({
        clave: 'presupuesto',
        nombre: nombreAdjuntoPresupuesto(
          params.numeroPresupuesto ?? null,
          reserva.cliente.nombre,
          reserva.cliente.apellidos ?? '',
        ),
        pdfUrl: params.pdfUrl,
      });
    }

    const comando = {
      tenantId: params.tenantId,
      codigoEmail: 'E2' as const,
      reserva: { idReserva: reserva.idReserva, codigo: reserva.codigo },
      cliente: {
        idCliente: reserva.cliente.idCliente,
        nombre: reserva.cliente.nombre,
        apellidos: reserva.cliente.apellidos ?? '',
        email: reserva.cliente.email,
        telefono: reserva.cliente.telefono ?? '',
      },
      adjuntos,
      idioma: reserva.idioma,
    };

    // EDICIÓN (D1/D2): envío REAL por el camino de reenvío (salta la idempotencia,
    // crea la ÚNICA fila COMUNICACION `es_reenvio=true` y ENVÍA por el transporte) con
    // la marca de edición hasta el render de E2 ("presupuesto actualizado"). El primer
    // envío (US-014) NO trae `esEdicion` → sigue por el camino IDEMPOTENTE `despachar`.
    if (params.esEdicion === true) {
      await this.motorEmail.despacharReenvio({ ...comando, esEdicion: true });
      return;
    }

    await this.motorEmail.despachar(comando);
  }
}

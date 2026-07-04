/**
 * Adaptador Prisma del puerto de carga `CargarReservaConFichaPort` (US-025 / UC-20).
 *
 * Lectura PURA (no muta): proyecta la RESERVA con su FICHA_OPERATIVA 1:1 al read-model
 * de la aplicación. Fija el contexto RLS (`SET LOCAL app.tenant_id`) como PRIMERA
 * operación de la transacción de lectura y filtra SIEMPRE por `tenant_id` (defensa en
 * profundidad): una RESERVA de otro tenant es invisible → `null` → 404 en el
 * controlador.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  CargarReservaConFichaPort,
  EstadoReservaFicha,
  ReservaFichaOperativa,
} from '../domain/ficha-operativa.ports';
import { proyectarFicha } from './ficha-operativa.mapper';

@Injectable()
export class CargarReservaConFichaPrismaAdapter {
  constructor(private readonly prisma: PrismaService) {}

  /** Implementa `CargarReservaConFichaPort` (función invocable). */
  readonly cargar: CargarReservaConFichaPort = async ({ tenantId, reservaId }) => {
    const fila = await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, tenantId);
      return tx.reserva.findFirst({
        where: { idReserva: reservaId, tenantId },
        include: { fichaOperativa: true },
      });
    });

    if (fila === null) {
      return null;
    }

    const reserva: ReservaFichaOperativa = {
      idReserva: fila.idReserva,
      tenantId: fila.tenantId,
      estado: fila.estado as EstadoReservaFicha,
      ficha:
        fila.fichaOperativa === null
          ? null
          : proyectarFicha(fila.fichaOperativa, fila.preEventoStatus),
    };
    return reserva;
  };
}

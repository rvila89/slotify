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
import { DuracionHoras } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  CargarReservaConFichaPort,
  EstadoReservaFicha,
  ReservaFichaOperativa,
} from '../domain/ficha-operativa.ports';
import { proyectarFicha } from './ficha-operativa.mapper';

/** Convierte el enum `DuracionHoras {h4,h8,h12}` a su valor numérico `{4,8,12}` o null. */
const duracionHorasANumero = (
  duracion: DuracionHoras | null,
): number | null => {
  switch (duracion) {
    case DuracionHoras.h4:
      return 4;
    case DuracionHoras.h8:
      return 8;
    case DuracionHoras.h12:
      return 12;
    default:
      return null;
  }
};

@Injectable()
export class CargarReservaConFichaPrismaAdapter {
  constructor(private readonly prisma: PrismaService) {}

  /** Implementa `CargarReservaConFichaPort` (función invocable). */
  readonly cargar: CargarReservaConFichaPort = async ({ tenantId, reservaId }) => {
    const fila = await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, tenantId);
      // JOIN a CLIENTE (§D-2): pre-relleno de contacto/teléfono/correo al leer.
      return tx.reserva.findFirst({
        where: { idReserva: reservaId, tenantId },
        include: {
          fichaOperativa: true,
          cliente: {
            select: { nombre: true, apellidos: true, email: true, telefono: true },
          },
        },
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
      // Datos estructurados de la RESERVA para el pre-relleno al leer (§D-2).
      reserva: {
        duracionHoras: duracionHorasANumero(fila.duracionHoras),
        horario: fila.horario,
        comentarios: fila.comentarios,
        numInvitadosFinal: fila.numInvitadosFinal,
        numAdultosNinosMayores4: fila.numAdultosNinosMayores4,
        numNinosMenores4: fila.numNinosMenores4,
      },
      // Datos del CLIENTE (JOIN) para el pre-relleno al leer (§D-2).
      cliente: {
        nombre: fila.cliente.nombre,
        apellidos: fila.cliente.apellidos,
        telefono: fila.cliente.telefono,
        email: fila.cliente.email,
      },
    };
    return reserva;
  };
}

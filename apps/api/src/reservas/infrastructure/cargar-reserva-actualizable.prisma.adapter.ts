/**
 * Adaptador de LECTURA de la RESERVA para el update parcial de campos simples
 * (US-051 §Punto 2 / UC-14).
 *
 * Carga la proyección mínima que la actualización necesita (los campos simples PREVIOS,
 * para el AUDIT_LOG y la regla cruzada de `horario`) bajo el contexto RLS del tenant del
 * Gestor: una RESERVA de otro tenant es INVISIBLE (→ `null` → 404). La lectura es previa a
 * la transacción de escritura. NO lee/escribe FECHA_BLOQUEADA (regla dura §D-1).
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  ActualizarReservaComando,
  ReservaActualizable,
} from '../application/actualizar-reserva.use-case';
import type {
  EstadoReserva as EstadoReservaDominio,
} from '../domain/maquina-estados';
import {
  subEstadoPrismaADominio,
  type SubEstadoConsultaPrisma,
} from './sub-estado-consulta.mapper';
import { duracionHorasPrismaADominio } from './reserva-campos.mapper';

@Injectable()
export class CargarReservaActualizablePrismaAdapter {
  constructor(private readonly prisma: PrismaService) {}

  async cargar(
    comando: ActualizarReservaComando,
  ): Promise<ReservaActualizable | null> {
    return this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, comando.tenantId);
      const fila = await tx.reserva.findFirst({
        where: { idReserva: comando.reservaId, tenantId: comando.tenantId },
        select: {
          idReserva: true,
          tenantId: true,
          estado: true,
          subEstado: true,
          fechaEvento: true,
          tipoEvento: true,
          duracionHoras: true,
          numAdultosNinosMayores4: true,
          numNinosMenores4: true,
          numInvitadosFinal: true,
          horario: true,
          notas: true,
          // Regeneración del borrador E1 al editar (change `consulta-fecha-borrador-fix`,
          // design.md §D-3): idioma para el idioma de la plantilla y nombre del cliente
          // para el saludo del cuerpo re-renderizado.
          idioma: true,
          cliente: { select: { nombre: true } },
        },
      });
      if (fila === null) {
        return null;
      }
      return {
        idReserva: fila.idReserva,
        tenantId: fila.tenantId,
        estado: fila.estado as EstadoReservaDominio,
        subEstado:
          fila.subEstado === null
            ? null
            : subEstadoPrismaADominio(fila.subEstado as SubEstadoConsultaPrisma),
        fechaEvento: fila.fechaEvento,
        tipoEvento: fila.tipoEvento,
        duracionHoras: duracionHorasPrismaADominio(fila.duracionHoras),
        numAdultosNinosMayores4: fila.numAdultosNinosMayores4,
        numNinosMenores4: fila.numNinosMenores4,
        numInvitadosFinal: fila.numInvitadosFinal,
        horario: fila.horario,
        notas: fila.notas,
        idioma: fila.idioma,
        nombreCliente: fila.cliente?.nombre ?? null,
      };
    });
  }
}

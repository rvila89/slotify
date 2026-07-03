/**
 * Adaptador Prisma del puerto de lectura `ReservaDetalleQueryPort`
 * (`GET /reservas/{id}` → `ReservaDetalle`, ficha de consulta US-005).
 *
 * Lectura PURA (no muta): proyecta la RESERVA + su CLIENTE al read-model de la
 * aplicación. Fija el contexto RLS (`SET LOCAL app.tenant_id`) como PRIMERA operación
 * de la transacción de lectura y filtra SIEMPRE por `tenant_id` (defensa en
 * profundidad): una RESERVA de otro tenant es invisible → `null` → 404.
 *
 * Los importes `Decimal(10,2)` se serializan a `string` con 2 decimales (contrato
 * `Importe`, sin coma flotante); las fechas viajan como `Date` (el mapeo HTTP a
 * `date`/`date-time` lo hace el controlador).
 */
import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  ReservaDetalleLectura,
  ReservaDetalleQueryPort,
} from '../application/obtener-reserva.query';
import type { EstadoReserva as EstadoReservaDominio } from '../domain/maquina-estados';
import { duracionHorasPrismaANumero } from './duracion-horas.mapper';
import {
  subEstadoPrismaADominio,
  type SubEstadoConsultaPrisma,
} from './sub-estado-consulta.mapper';

/** Serializa un `Decimal(10,2)` a string con 2 decimales (contrato `Importe`); null si ausente. */
const aImporte = (valor: Prisma.Decimal | null): string | null =>
  valor === null ? null : valor.toFixed(2);

@Injectable()
export class ReservaDetalleQueryPrismaAdapter implements ReservaDetalleQueryPort {
  constructor(private readonly prisma: PrismaService) {}

  async buscarDetalle(params: {
    tenantId: string;
    reservaId: string;
  }): Promise<ReservaDetalleLectura | null> {
    const { tenantId, reservaId } = params;
    const fila = await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, tenantId);
      return tx.reserva.findFirst({
        where: { idReserva: reservaId, tenantId },
        include: { cliente: true },
      });
    });

    if (fila === null) {
      return null;
    }

    return {
      idReserva: fila.idReserva,
      codigo: fila.codigo,
      clienteId: fila.clienteId,
      estado: fila.estado as EstadoReservaDominio,
      subEstado:
        fila.subEstado === null
          ? null
          : subEstadoPrismaADominio(fila.subEstado as SubEstadoConsultaPrisma),
      canalEntrada: fila.canalEntrada,
      fechaEvento: fila.fechaEvento,
      duracionHoras: duracionHorasPrismaANumero(fila.duracionHoras),
      tipoEvento: fila.tipoEvento,
      numAdultosNinosMayores4: fila.numAdultosNinosMayores4,
      numNinosMenores4: fila.numNinosMenores4,
      numInvitadosFinal: fila.numInvitadosFinal,
      importeTotal: aImporte(fila.importeTotal),
      importeSenal: aImporte(fila.importeSenal),
      importeLiquidacion: aImporte(fila.importeLiquidacion),
      ttlExpiracion: fila.ttlExpiracion,
      visitaProgramadaFecha: fila.visitaProgramadaFecha,
      visitaProgramadaHora: fila.visitaProgramadaHora,
      visitaRealizada: fila.visitaRealizada,
      fianzaEur: aImporte(fila.fianzaEur),
      fianzaCobradaFecha: fila.fianzaCobradaFecha,
      fianzaDevueltaFecha: fila.fianzaDevueltaFecha,
      fianzaDevueltaEur: aImporte(fila.fianzaDevueltaEur),
      condPartFirmadas: fila.condPartFirmadas,
      condPartFechaEnvio: fila.condPartEnviadasFecha,
      condPartFechaFirma: fila.condPartFirmadasFecha,
      preEventoStatus: fila.preEventoStatus,
      liquidacionStatus: fila.liquidacionStatus,
      fianzaStatus: fila.fianzaStatus,
      posicionCola: fila.posicionCola,
      consultaBloqueanteId: fila.consultaBloqueanteId,
      notas: fila.notas,
      fechaCreacion: fila.fechaCreacion,
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
        ibanDevolucion: fila.cliente.ibanDevolucion,
      },
    };
  }
}

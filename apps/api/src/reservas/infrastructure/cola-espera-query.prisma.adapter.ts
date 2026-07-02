/**
 * Adaptador Prisma del puerto `ColaEsperaQueryPort` (`GET /reservas/{id}/cola`,
 * US-017 / UC-11). Vista de SOLO LECTURA: proyecta la RESERVA bloqueante + su cola
 * FIFO al read model de la aplicación.
 *
 * Reutiliza el patrón de `ColaQueryPrismaAdapter` (US-018): mismo contexto RLS
 * (`fijarTenant` como PRIMERA operación de la transacción), mismo filtro de cola
 * (`sub_estado = s2d` + `consulta_bloqueante_id`) y filtrado SIEMPRE por `tenant_id`
 * (defensa en profundidad). Añade la lectura de la sección bloqueante (+ su cliente y
 * su `FECHA_BLOQUEADA` activa) y la ordenación FIFO `ORDER BY posicion_cola ASC`.
 *
 * Semántica de resultados (design.md §D-3):
 * - Reserva inexistente / de otro tenant (invisible por RLS) → `null` → 404.
 * - Reserva del tenant SIN `FECHA_BLOQUEADA` activa → `{ estaBloqueada: false,
 *   bloqueante: null, cola: [] }` → 200 "fecha disponible" (FA-04).
 * - Reserva bloqueante → sección bloqueante + cola FIFO (posiblemente vacía).
 *
 * Derivación temporal (`ttlRestante`/`tiempoEnCola`) sobre INSTANTES `timestamptz`
 * vía funciones puras del dominio y el reloj inyectado, NUNCA formateando fechas
 * (regla anti off-by-one de TZ). Lectura pura: NO muta estado ni audita.
 */
import { Injectable } from '@nestjs/common';
import { SubEstadoConsulta } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type { ClockPort } from '../domain/bloquear-fecha.service';
import {
  derivarTiempoEnCola,
  derivarTtlRestante,
  type ColaEsperaLectura,
} from '../domain/cola-espera-lectura';
import type { ColaEsperaQueryPort } from '../application/obtener-cola-espera.query';
import {
  subEstadoPrismaADominio,
  type SubEstadoConsultaPrisma,
} from './sub-estado-consulta.mapper';

@Injectable()
export class ColaEsperaQueryPrismaAdapter implements ColaEsperaQueryPort {
  constructor(
    private readonly prisma: PrismaService,
    private readonly clock: ClockPort,
  ) {}

  async buscarCola(params: {
    tenantId: string;
    reservaId: string;
  }): Promise<ColaEsperaLectura | null> {
    const { tenantId, reservaId } = params;

    const datos = await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, tenantId);

      const bloqueante = await tx.reserva.findFirst({
        where: { idReserva: reservaId, tenantId },
        include: { cliente: true },
      });
      if (bloqueante === null) {
        return null;
      }

      // ¿La reserva posee una FECHA_BLOQUEADA activa? Solo entonces es bloqueante.
      const fechaBloqueada = await tx.fechaBloqueada.findFirst({
        where: { reservaId, tenantId },
      });

      const cola =
        fechaBloqueada === null
          ? []
          : await tx.reserva.findMany({
              where: {
                tenantId,
                subEstado: SubEstadoConsulta.s2d,
                consultaBloqueanteId: reservaId,
              },
              include: { cliente: true },
              orderBy: { posicionCola: 'asc' },
            });

      return { bloqueante, esBloqueante: fechaBloqueada !== null, cola };
    });

    if (datos === null) {
      // Reserva inexistente / de otro tenant (RLS) → 404.
      return null;
    }

    // FA-04: existe pero no bloquea ninguna fecha activa → "fecha disponible".
    if (!datos.esBloqueante) {
      return { estaBloqueada: false, bloqueante: null, cola: [] };
    }

    const ahora = this.clock.ahora();
    const { bloqueante } = datos;

    return {
      estaBloqueada: true,
      bloqueante: {
        idReserva: bloqueante.idReserva,
        codigo: bloqueante.codigo,
        clienteNombre: bloqueante.cliente.nombre,
        subEstado: subEstadoPrismaADominio(
          bloqueante.subEstado as SubEstadoConsultaPrisma,
        ),
        ttlExpiracion: bloqueante.ttlExpiracion,
        ttlRestante: derivarTtlRestante(bloqueante.ttlExpiracion, ahora),
        visitaProgramadaFecha: bloqueante.visitaProgramadaFecha,
      },
      cola: datos.cola.map((entrada) => ({
        idReserva: entrada.idReserva,
        codigo: entrada.codigo,
        clienteNombre: entrada.cliente.nombre,
        posicionCola: entrada.posicionCola ?? 0,
        fechaCreacion: entrada.fechaCreacion,
        tiempoEnCola: derivarTiempoEnCola(entrada.fechaCreacion, ahora),
      })),
    };
  }
}

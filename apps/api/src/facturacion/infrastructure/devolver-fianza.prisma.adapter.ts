/**
 * Adaptadores de la DEVOLUCIÓN COMPLETA de la fianza (fix-liquidacion-fianza-independientes /
 * UC-27).
 *
 * - `DevolverFianzaUoWPrismaAdapter`: abre UN `prisma.$transaction`, fija RLS con `fijarTenant`
 *   (SET LOCAL app.tenant_id) como PRIMERA operación y expone los repos tx-bound. La relectura
 *   `SELECT ... FOR UPDATE` sobre la RESERVA serializa el doble registro concurrente (lock de
 *   fila PostgreSQL, nunca locks distribuidos).
 * - `DispararE10Adapter`: dispara E10 POST-COMMIT best-effort reutilizando el motor de US-045
 *   (`despacharReenvio`, patrón `disparar-e8`): crea SIEMPRE una fila COMUNICACION nueva y no
 *   propaga la excepción del proveedor. Inyecta `fianzaEur` como variable de la plantilla.
 */
import { Injectable } from '@nestjs/common';
import { AccionAudit, FianzaStatus as FianzaStatusPrisma, Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { DespacharEmailService } from '../../comunicaciones/application/despachar-email.service';
import type {
  AuditoriaDevolverFianzaPort,
  DispararE10Port,
  RegistrarDevolverFianzaParams,
  RegistroAuditoriaDevolverFianza,
  RepositoriosDevolverFianza,
  ReservaDevolverFianza,
  ReservasDevolverFianzaPort,
  ResultadoDispararE10,
  UnidadDeTrabajoDevolverFianzaPort,
} from '../application/devolver-fianza.use-case';

/** Fila cruda de la relectura FOR UPDATE de la RESERVA. */
interface FilaReservaBloqueada {
  id_reserva: string;
  tenant_id: string;
  cliente_id: string;
  estado: string;
  fianza_status: string;
  fianza_eur: Prisma.Decimal | null;
}

/** Repositorio tx-bound de la RESERVA (relectura FOR UPDATE + registro de la devolución). */
class ReservaDevolverFianzaPrismaRepository implements ReservasDevolverFianzaPort {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async releerConBloqueo(params: {
    reservaId: string;
  }): Promise<ReservaDevolverFianza | null> {
    // SELECT ... FOR UPDATE: serializa el doble registro concurrente (nunca locks distribuidos).
    const filas = await this.tx.$queryRaw<FilaReservaBloqueada[]>(Prisma.sql`
      SELECT id_reserva, tenant_id, cliente_id, estado, fianza_status, fianza_eur
      FROM reserva
      WHERE id_reserva = ${params.reservaId}
      FOR UPDATE
    `);
    if (filas.length === 0) {
      return null;
    }
    const fila = filas[0];
    return {
      idReserva: fila.id_reserva,
      tenantId: fila.tenant_id,
      clienteId: fila.cliente_id,
      estado: fila.estado,
      fianzaStatus: fila.fianza_status,
      fianzaEur: fila.fianza_eur === null ? null : new Prisma.Decimal(fila.fianza_eur).toFixed(2),
    };
  }

  async registrarDevolucion(params: RegistrarDevolverFianzaParams): Promise<void> {
    await this.tx.reserva.update({
      where: { idReserva: params.reservaId },
      data: {
        fianzaStatus: FianzaStatusPrisma.devuelta,
        fianzaDevueltaFecha: params.fianzaDevueltaFecha,
      },
    });
  }
}

/** Repositorio de AUDIT_LOG tx-bound de la devolución (`accion='actualizar'`). */
class AuditoriaDevolverFianzaPrismaRepository implements AuditoriaDevolverFianzaPort {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async registrar(registro: RegistroAuditoriaDevolverFianza): Promise<void> {
    await this.tx.auditLog.create({
      data: {
        tenantId: registro.tenantId,
        entidad: registro.entidad,
        entidadId: registro.entidadId,
        accion: AccionAudit.actualizar,
        datosAnteriores: (registro.datosAnteriores ?? null) as Prisma.InputJsonValue,
        datosNuevos: (registro.usuarioId
          ? { ...(registro.datosNuevos ?? {}), usuarioId: registro.usuarioId }
          : (registro.datosNuevos ?? null)) as Prisma.InputJsonValue,
      },
    });
  }
}

@Injectable()
export class DevolverFianzaUoWPrismaAdapter implements UnidadDeTrabajoDevolverFianzaPort {
  constructor(private readonly prisma: PrismaService) {}

  async ejecutar(
    tenantId: string,
    trabajo: (repos: RepositoriosDevolverFianza) => Promise<unknown>,
  ): Promise<unknown> {
    return this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, tenantId);
      const repos: RepositoriosDevolverFianza = {
        reservas: new ReservaDevolverFianzaPrismaRepository(tx),
        auditoria: new AuditoriaDevolverFianzaPrismaRepository(tx),
      };
      return trabajo(repos);
    });
  }
}

/**
 * Adaptador del disparo de E10 (fianza devuelta), POST-COMMIT best-effort. Reutiliza el motor de
 * US-045 (`despacharReenvio`, patrón `disparar-e8`): crea SIEMPRE una COMUNICACION nueva y no
 * propaga la excepción del proveedor. Inyecta `fianzaEur` como variable de la plantilla E10.
 */
@Injectable()
export class DispararE10Adapter implements DispararE10Port {
  constructor(
    private readonly motorEmail: DespacharEmailService,
    private readonly prisma: PrismaService,
  ) {}

  async disparar(params: {
    tenantId: string;
    reservaId: string;
    clienteId: string;
    fianzaEur: string | null;
  }): Promise<ResultadoDispararE10> {
    const datos = await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, params.tenantId);
      return tx.reserva.findFirst({
        where: { idReserva: params.reservaId, tenantId: params.tenantId },
        select: {
          idReserva: true,
          codigo: true,
          idioma: true,
          cliente: {
            select: {
              idCliente: true,
              nombre: true,
              apellidos: true,
              email: true,
              telefono: true,
            },
          },
        },
      });
    });

    if (datos === null) {
      return { resultado: 'fallido', comunicacionId: null };
    }

    const resultado = await this.motorEmail.despacharReenvio({
      tenantId: params.tenantId,
      codigoEmail: 'E10',
      idioma: datos.idioma,
      reserva: { idReserva: datos.idReserva, codigo: datos.codigo },
      cliente: {
        idCliente: datos.cliente.idCliente,
        nombre: datos.cliente.nombre,
        apellidos: datos.cliente.apellidos ?? '',
        email: datos.cliente.email,
        telefono: datos.cliente.telefono ?? '',
      },
      variablesExtra: { fianzaEur: params.fianzaEur ?? '' },
    });

    const com = resultado.comunicacion;
    if (com === null) {
      return { resultado: 'fallido', comunicacionId: null };
    }
    return {
      resultado: com.estado === 'enviado' ? 'enviado' : 'fallido',
      comunicacionId: com.idComunicacion,
    };
  }
}

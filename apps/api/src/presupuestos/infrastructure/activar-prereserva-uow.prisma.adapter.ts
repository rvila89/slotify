/**
 * Adaptador de la UNIDAD DE TRABAJO transaccional de la confirmación del presupuesto
 * / activación de la pre_reserva (US-014 / UC-14).
 *
 * Implementa `UnidadDeTrabajoActivarPrereservaPort`: abre UN único
 * `prisma.$transaction`, fija el contexto RLS con `fijarTenant(tx, tenantId)`
 * (`SET LOCAL app.tenant_id`) como PRIMERA operación, y expone los repositorios
 * tx-bound. Las CINCO operaciones (crear PRESUPUESTO congelado + transición a
 * `pre_reserva` + bloqueo insert-o-update + vaciado de cola A16 + AUDIT_LOG) viven
 * dentro de esa única transacción: un fallo en cualquiera propaga y revierte el
 * conjunto (all-or-nothing).
 *
 * SERIALIZACIÓN (atomic-date-lock): el bloqueo de fecha usa `SELECT … FOR UPDATE`
 * sobre la fila `(tenant_id, fecha)` de FECHA_BLOQUEADA y el `UNIQUE(tenant_id, fecha)`
 * del motor. La exclusión mutua vive SOLO en PostgreSQL; nada de Redis/locks
 * distribuidos. Ante una carrera D4 (dos confirmaciones sobre la misma fecha), una
 * gana y la otra recibe `P2002` / no encuentra la fila esperada, propagando el error
 * (rollback total): exactamente una confirmación se aplica.
 */
import { Injectable } from '@nestjs/common';
import {
  AccionAudit,
  EstadoPresupuesto,
  MetodoPago,
  Prisma,
  RegimenIva,
  SubEstadoConsulta,
  TipoBloqueo,
} from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type { RegimenIva as RegimenIvaDominio } from '../domain/regimen-desde-metodo-pago';
import type {
  AuditoriaPrereservaPort,
  ColaPrereservaRepositoryPort,
  CrearPresupuestoParams,
  FechaBloqueadaPrereservaRepositoryPort,
  PresupuestoCreado,
  PresupuestoPrevio,
  PresupuestoRepositoryPort,
  RegistroAuditoriaPrereserva,
  RepositoriosActivarPrereserva,
  ReservaPrereservaRepositoryPort,
  TransicionarAPrereservaParams,
  UnidadDeTrabajoActivarPrereservaPort,
} from '../application/generar-presupuesto.use-case';

const formatearFecha = (fecha: Date): string => fecha.toISOString().slice(0, 10);

const aImporte = (valor: Prisma.Decimal | null): string =>
  valor === null ? '0.00' : valor.toFixed(2);

/** Repositorio tx-bound de PRESUPUESTO: precondición + creación congelada. */
class PresupuestoPrismaRepository implements PresupuestoRepositoryPort {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async buscarEnviadoOAceptado(params: {
    tenantId: string;
    reservaId: string;
  }): Promise<PresupuestoPrevio | null> {
    const fila = await this.tx.presupuesto.findFirst({
      where: {
        reservaId: params.reservaId,
        estado: { in: [EstadoPresupuesto.enviado, EstadoPresupuesto.aceptado] },
      },
      select: { idPresupuesto: true, estado: true },
    });
    return fila === null
      ? null
      : { idPresupuesto: fila.idPresupuesto, estado: fila.estado };
  }

  /**
   * Último `numero_presupuesto` del tenant en el año y RÉGIMEN dados (6.2 D2, doble
   * secuencia): filtra por `regimen_iva` además de tenant y año. El año va embebido en el
   * prefijo `AAAA`; se ordena descendente para tomar el mayor de ese régimen.
   */
  async ultimoNumeroDelAnio(
    tenantId: string,
    anio: number,
    regimen: RegimenIvaDominio,
  ): Promise<string | null> {
    const fila = await this.tx.presupuesto.findFirst({
      where: {
        tenantId,
        regimenIva: regimen as RegimenIva,
        numeroPresupuesto: { startsWith: String(anio) },
      },
      orderBy: { numeroPresupuesto: 'desc' },
      select: { numeroPresupuesto: true },
    });
    return fila?.numeroPresupuesto ?? null;
  }

  async crear(params: CrearPresupuestoParams): Promise<PresupuestoCreado> {
    const fila = await this.tx.presupuesto.create({
      data: {
        tenantId: params.tenantId,
        reservaId: params.reservaId,
        numeroPresupuesto: params.numeroPresupuesto,
        version: params.version,
        estado: EstadoPresupuesto.enviado,
        tarifaCongelada: params.tarifaCongelada,
        baseImponible: new Prisma.Decimal(params.baseImponible),
        ivaPorcentaje: new Prisma.Decimal(params.ivaPorcentaje),
        ivaImporte: new Prisma.Decimal(params.ivaImporte),
        total: new Prisma.Decimal(params.total),
        descuentoEur:
          params.descuentoEur === null
            ? null
            : new Prisma.Decimal(params.descuentoEur),
        descuentoMotivo: params.descuentoMotivo,
        metodoPago: params.metodoPago as MetodoPago,
        regimenIva: params.regimenIva as RegimenIva,
      },
    });
    return {
      idPresupuesto: fila.idPresupuesto,
      version: fila.version,
      estado: fila.estado,
      total: aImporte(fila.total),
      baseImponible: aImporte(fila.baseImponible),
      ivaPorcentaje: aImporte(fila.ivaPorcentaje),
      ivaImporte: aImporte(fila.ivaImporte),
      tarifaCongelada: fila.tarifaCongelada,
      pdfUrl: fila.pdfUrl,
      numeroPresupuesto: fila.numeroPresupuesto,
      regimenIva: (fila.regimenIva ?? 'con_iva') as RegimenIvaDominio,
    };
  }
}

/** Repositorio tx-bound de la RESERVA: aplica la transición a `pre_reserva`. */
class ReservaPrereservaPrismaRepository implements ReservaPrereservaRepositoryPort {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async transicionarAPrereserva(
    params: TransicionarAPrereservaParams,
  ): Promise<void> {
    await this.tx.reserva.update({
      where: { idReserva: params.idReserva },
      data: {
        estado: 'pre_reserva',
        subEstado: null,
        ttlExpiracion: params.ttlExpiracion,
      },
    });
  }
}

/** Fila cruda del `SELECT … FOR UPDATE` sobre la fila de bloqueo. */
interface FilaBloqueo {
  id_bloqueo: string;
  reserva_id: string;
  tipo_bloqueo: string;
}

/**
 * Repositorio tx-bound de FECHA_BLOQUEADA (insert-o-update en fase `pre_reserva`).
 * `SELECT … FOR UPDATE` serializa la fila `(tenant, fecha)`: si existe una fila de la
 * MISMA reserva → UPDATE del TTL (origen `2.b/2.c/2.v`); si existe de OTRA reserva →
 * colisión (propaga, rollback); si no existe → INSERT (origen `2.a`), cuyo
 * `UNIQUE(tenant, fecha)` frena la carrera D4.
 */
class FechaBloqueadaPrereservaPrismaRepository
  implements FechaBloqueadaPrereservaRepositoryPort
{
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async bloquearInsertOUpdate(params: {
    tenantId: string;
    fecha: Date;
    reservaId: string;
    ttlExpiracion: Date;
  }): Promise<void> {
    const fechaIso = formatearFecha(params.fecha);
    const filas = await this.tx.$queryRaw<FilaBloqueo[]>(Prisma.sql`
      SELECT id_bloqueo, reserva_id, tipo_bloqueo
      FROM fecha_bloqueada
      WHERE tenant_id = ${params.tenantId} AND fecha = ${fechaIso}::date
      FOR UPDATE
    `);

    if (filas.length === 0) {
      // Origen 2.a: no había fila. INSERT; el UNIQUE(tenant, fecha) frena la carrera D4.
      await this.tx.fechaBloqueada.create({
        data: {
          tenantId: params.tenantId,
          fecha: params.fecha,
          reservaId: params.reservaId,
          tipoBloqueo: TipoBloqueo.blando,
          ttlExpiracion: params.ttlExpiracion,
        },
      });
      return;
    }

    const existente = filas[0];
    if (existente.reserva_id !== params.reservaId) {
      // La fecha ya la bloquea OTRA reserva: colisión que revierte la transacción.
      throw new Prisma.PrismaClientKnownRequestError(
        'La fecha ya está bloqueada por otra reserva',
        { code: 'P2002', clientVersion: Prisma.prismaVersion.client, meta: { target: ['tenant_id', 'fecha'] } },
      );
    }
    // Origen 2.b/2.c/2.v: UPDATE del TTL de la fila existente (permanece blando).
    await this.tx.fechaBloqueada.update({
      where: { idBloqueo: existente.id_bloqueo },
      data: { tipoBloqueo: TipoBloqueo.blando, ttlExpiracion: params.ttlExpiracion },
    });
  }
}

/**
 * Repositorio tx-bound del vaciado de cola A16 (`2.d → 2.y`). Lee los ids en cola ANTES
 * del UPDATE masivo (la cláusula NULLea el vínculo) y aplica el UPDATE DENTRO de la misma
 * transacción. Devuelve los ids descartados; el AUDIT_LOG de cada descarte lo escribe el
 * caso de uso vía `repos.auditoria` (no este repositorio). Sin emails a la cola (A16 solo
 * diseñada en MVP).
 */
class ColaPrereservaPrismaRepository implements ColaPrereservaRepositoryPort {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async vaciar(params: {
    tenantId: string;
    consultaBloqueanteId: string;
  }): Promise<{ descartadas: ReadonlyArray<string> }> {
    const enCola = await this.tx.reserva.findMany({
      where: {
        tenantId: params.tenantId,
        consultaBloqueanteId: params.consultaBloqueanteId,
        subEstado: SubEstadoConsulta.s2d,
      },
      select: { idReserva: true },
    });
    const ids = enCola.map((r) => r.idReserva);
    if (ids.length === 0) {
      return { descartadas: [] };
    }
    await this.tx.reserva.updateMany({
      where: { idReserva: { in: ids } },
      data: {
        subEstado: SubEstadoConsulta.s2y,
        posicionCola: null,
        consultaBloqueanteId: null,
      },
    });
    return { descartadas: ids };
  }
}

/** Repositorio de AUDIT_LOG tx-bound: escribe DENTRO de la transacción (rollback). */
class AuditoriaPrereservaPrismaRepository implements AuditoriaPrereservaPort {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async registrar(registro: RegistroAuditoriaPrereserva): Promise<void> {
    const datosAnteriores = registro.datosAnteriores as
      | Prisma.InputJsonValue
      | undefined;
    const datosNuevos = registro.datosNuevos as Prisma.InputJsonValue | undefined;
    await this.tx.auditLog.create({
      data: {
        tenantId: registro.tenantId,
        usuarioId: registro.usuarioId ?? null,
        entidad: registro.entidad ?? 'RESERVA',
        entidadId: registro.entidadId ?? '-',
        accion: (registro.accion as AccionAudit) ?? AccionAudit.transicion,
        ...(datosAnteriores !== undefined ? { datosAnteriores } : {}),
        ...(datosNuevos !== undefined ? { datosNuevos } : {}),
      },
    });
  }
}

@Injectable()
export class ActivarPrereservaUoWPrismaAdapter
  implements UnidadDeTrabajoActivarPrereservaPort
{
  constructor(private readonly prisma: PrismaService) {}

  async ejecutar<T>(
    tenantId: string,
    trabajo: (repos: RepositoriosActivarPrereserva) => Promise<T>,
  ): Promise<T> {
    return this.prisma.$transaction(async (tx) => {
      // RLS: primera operación de la transacción (SET LOCAL app.tenant_id).
      await this.prisma.fijarTenant(tx, tenantId);
      const repos: RepositoriosActivarPrereserva = {
        presupuestos: new PresupuestoPrismaRepository(tx),
        reservas: new ReservaPrereservaPrismaRepository(tx),
        fechaBloqueada: new FechaBloqueadaPrereservaPrismaRepository(tx),
        cola: new ColaPrereservaPrismaRepository(tx),
        auditoria: new AuditoriaPrereservaPrismaRepository(tx),
      };
      return trabajo(repos);
    });
  }
}

/**
 * Adaptador de la UNIDAD DE TRABAJO transaccional de la confirmación del pago de la
 * señal (US-021 / UC-17).
 *
 * Implementa `UnidadDeTrabajoConfirmacionPort`: abre UN único `prisma.$transaction`,
 * fija el contexto RLS con `fijarTenant(tx, tenantId)` (`SET LOCAL app.tenant_id`) como
 * PRIMERA operación, y expone los repositorios tx-bound. Las CINCO operaciones (crear
 * DOCUMENTO + upgrade del bloqueo a firme + transición RESERVA + FICHA_OPERATIVA +
 * AUDIT_LOG) viven dentro de esa única transacción: un fallo en cualquiera propaga y
 * revierte el conjunto (all-or-nothing).
 *
 * SERIALIZACIÓN (atomic-date-lock): el upgrade a firme REUTILIZA la primitiva atómica de
 * US-040 (`FechaBloqueadaPrismaAdapter.bloquearEnTx` con `plan.modo='upgrade'`), que hace
 * `SELECT … FOR UPDATE` sobre la fila `(tenant, fecha)` + UPDATE conservando `reserva_id`
 * (nunca delete+insert), respaldada por el `UNIQUE(tenant_id, fecha)`. La exclusión mutua
 * vive SOLO en PostgreSQL; nada de Redis/locks distribuidos. Bajo ese lock se RE-VERIFICA
 * la guarda de origen de la RESERVA:
 *   - doble clic / dos sesiones sobre la MISMA reserva: la segunda observa la RESERVA ya
 *     en `reserva_confirmada` y aborta con `ReservaYaConfirmadaError` (409).
 *   - fecha ya firme de OTRA reserva: la primitiva lanza `FechaYaBloqueadaError`
 *     (`P2002`/UNIQUE), traducido a `FechaNoDisponibleError` (409, carrera D4).
 */
import { Injectable } from '@nestjs/common';
import {
  AccionAudit,
  EstadoPresupuesto,
  EstadoReserva,
  FianzaStatus,
  LiquidacionStatus,
  PreEventoStatus,
  Prisma,
  TipoDocumento,
} from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import { FechaBloqueadaPrismaAdapter } from '../../reservas/infrastructure/fecha-bloqueada.prisma.adapter';
import {
  FechaYaBloqueadaError,
  ReservaYaTieneBloqueoError,
} from '../../reservas/domain/bloquear-fecha.service';
import type {
  AuditoriaConfirmacionPort,
  ConfirmarSenalReservaParams,
  CrearJustificanteParams,
  DocumentoConfirmacionRepositoryPort,
  DocumentoCreado,
  FechaBloqueadaConfirmacionRepositoryPort,
  FichaOperativaConfirmacionRepositoryPort,
  FichaOperativaExistente,
  PresupuestoConfirmacionRepositoryPort,
  RegistroAuditoriaConfirmacion,
  RepositoriosConfirmacion,
  ReservaConfirmacionRepositoryPort,
  UnidadDeTrabajoConfirmacionPort,
} from '../application/confirmar-pago-senal.use-case';
import {
  FechaNoDisponibleError,
  ReservaYaConfirmadaError,
} from '../application/confirmar-pago-senal.use-case';

const formatearFecha = (fecha: Date): string => fecha.toISOString().slice(0, 10);

/** Repositorio tx-bound de DOCUMENTO: crea el justificante de pago. */
class DocumentoConfirmacionPrismaRepository
  implements DocumentoConfirmacionRepositoryPort
{
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async crearJustificante(params: CrearJustificanteParams): Promise<DocumentoCreado> {
    const fila = await this.tx.documento.create({
      data: {
        tenantId: params.tenantId,
        reservaId: params.reservaId,
        tipo: TipoDocumento.justificante_pago,
        nombreArchivo: params.nombreArchivo,
        url: params.url,
        mimeType: params.mimeType,
        tamanoBytes: params.tamanoBytes,
      },
    });
    return { idDocumento: fila.idDocumento, tipo: fila.tipo };
  }
}

/**
 * Repositorio tx-bound de la RESERVA: aplica la transición a `reserva_confirmada` con el
 * congelado de importes (`importe_senal`/`importe_liquidacion`) y los tres sub-procesos
 * en `pendiente`, y fija `ttl_expiracion=NULL` (la reserva confirmada no expira por TTL).
 */
class ReservaConfirmacionPrismaRepository
  implements ReservaConfirmacionRepositoryPort
{
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async confirmarSenal(params: ConfirmarSenalReservaParams): Promise<void> {
    await this.tx.reserva.update({
      where: { idReserva: params.idReserva },
      data: {
        estado: EstadoReserva.reserva_confirmada,
        ttlExpiracion: null,
        importeTotal: new Prisma.Decimal(params.importeTotal),
        importeSenal: new Prisma.Decimal(params.importeSenal),
        importeLiquidacion: new Prisma.Decimal(params.importeLiquidacion),
        preEventoStatus: PreEventoStatus.pendiente,
        liquidacionStatus: LiquidacionStatus.pendiente,
        fianzaStatus: FianzaStatus.pendiente,
      },
    });
  }
}

/**
 * Repositorio tx-bound de PRESUPUESTO: marca el presupuesto vigente como `aceptado`
 * dentro de la misma transacción de confirmación (congela la decisión comercial junto
 * al `importe_total` de la RESERVA).
 */
class PresupuestoConfirmacionPrismaRepository
  implements PresupuestoConfirmacionRepositoryPort
{
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async aceptar(params: { idPresupuesto: string }): Promise<void> {
    await this.tx.presupuesto.update({
      where: { idPresupuesto: params.idPresupuesto },
      data: { estado: EstadoPresupuesto.aceptado },
    });
  }
}

/** Fila cruda del `SELECT … FOR UPDATE` sobre la fila de bloqueo. */
interface FilaBloqueo {
  reserva_id: string;
}

/**
 * Repositorio tx-bound del upgrade del bloqueo a firme. Reutiliza la primitiva atómica
 * de US-040: adquiere el `SELECT … FOR UPDATE` sobre `(tenant, fecha)` (punto de
 * serialización del doble clic), RE-VERIFICA bajo el lock que la RESERVA sigue en
 * `pre_reserva` (si ya está en `reserva_confirmada` → `ReservaYaConfirmadaError`), y
 * delega el UPDATE a firme en `FechaBloqueadaPrismaAdapter.bloquearEnTx`. Una colisión
 * con otra reserva (`FechaYaBloqueadaError`/`P2002`) se traduce a `FechaNoDisponibleError`.
 */
class FechaBloqueadaConfirmacionPrismaRepository
  implements FechaBloqueadaConfirmacionRepositoryPort
{
  constructor(
    private readonly tx: Prisma.TransactionClient,
    private readonly bloqueo: FechaBloqueadaPrismaAdapter,
  ) {}

  async upgradeAFirme(params: {
    tenantId: string;
    fecha: Date;
    reservaId: string;
  }): Promise<void> {
    const fechaIso = formatearFecha(params.fecha);
    // Punto de serialización: bloquea la fila `(tenant, fecha)` si existe. Si es de
    // OTRA reserva, la carrera D4 la resuelve la primitiva (UNIQUE) más abajo.
    await this.tx.$queryRaw<FilaBloqueo[]>(Prisma.sql`
      SELECT reserva_id
      FROM fecha_bloqueada
      WHERE tenant_id = ${params.tenantId} AND fecha = ${fechaIso}::date
      FOR UPDATE
    `);

    // Bajo el lock: re-verifica que la RESERVA sigue en `pre_reserva`. El doble clic
    // hace que la segunda transacción observe `reserva_confirmada` y aborte (409).
    const reserva = await this.tx.reserva.findFirst({
      where: { idReserva: params.reservaId, tenantId: params.tenantId },
      select: { estado: true },
    });
    if (reserva !== null && reserva.estado === EstadoReserva.reserva_confirmada) {
      throw new ReservaYaConfirmadaError();
    }

    // UPDATE a firme reutilizando la primitiva de US-040 (fase `reserva_confirmada`).
    try {
      await this.bloqueo.bloquearEnTx(this.tx, {
        tenantId: params.tenantId,
        fecha: params.fecha,
        reservaId: params.reservaId,
        plan: { modo: 'upgrade', tipo: 'firme', ttl: null },
      });
    } catch (error) {
      if (this.esColisionConOtraReserva(error)) {
        throw new FechaNoDisponibleError();
      }
      throw error;
    }
  }

  /** ¿El error indica que la fecha ya está bloqueada por OTRA reserva (carrera D4)? */
  private esColisionConOtraReserva(error: unknown): boolean {
    return (
      error instanceof FechaYaBloqueadaError ||
      error instanceof ReservaYaTieneBloqueoError ||
      (error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002')
    );
  }
}

/** Repositorio tx-bound de FICHA_OPERATIVA (idempotente por `reserva_id @unique`). */
class FichaOperativaConfirmacionPrismaRepository
  implements FichaOperativaConfirmacionRepositoryPort
{
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async buscarPorReserva(params: {
    tenantId: string;
    reservaId: string;
  }): Promise<FichaOperativaExistente | null> {
    const fila = await this.tx.fichaOperativa.findUnique({
      where: { reservaId: params.reservaId },
      select: { idFicha: true, reservaId: true },
    });
    return fila === null ? null : { idFicha: fila.idFicha, reservaId: fila.reservaId };
  }

  async crearVacia(params: {
    reservaId: string;
    fichaCerrada: false;
    notasOperativas: string | null;
    contactoEventoCorreo: string | null;
  }): Promise<{ idFicha: string }> {
    const fila = await this.tx.fichaOperativa.create({
      data: {
        reservaId: params.reservaId,
        fichaCerrada: params.fichaCerrada,
        notasOperativas: params.notasOperativas,
        contactoEventoCorreo: params.contactoEventoCorreo,
      },
    });
    return { idFicha: fila.idFicha };
  }
}

/** Repositorio de AUDIT_LOG tx-bound: escribe DENTRO de la transacción (rollback). */
class AuditoriaConfirmacionPrismaRepository implements AuditoriaConfirmacionPort {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async registrar(registro: RegistroAuditoriaConfirmacion): Promise<void> {
    await this.tx.auditLog.create({
      data: {
        tenantId: registro.tenantId,
        usuarioId: registro.usuarioId ?? null,
        entidad: registro.entidad,
        entidadId: registro.entidadId,
        accion: AccionAudit.transicion,
        datosAnteriores: registro.datosAnteriores as Prisma.InputJsonValue,
        datosNuevos: registro.datosNuevos as Prisma.InputJsonValue,
      },
    });
  }
}

@Injectable()
export class ConfirmarPagoSenalUoWPrismaAdapter
  implements UnidadDeTrabajoConfirmacionPort
{
  constructor(private readonly prisma: PrismaService) {}

  async ejecutar(
    tenantId: string,
    trabajo: (repos: RepositoriosConfirmacion) => Promise<unknown>,
  ): Promise<unknown> {
    return this.prisma.$transaction(async (tx) => {
      // RLS: primera operación de la transacción (SET LOCAL app.tenant_id).
      await this.prisma.fijarTenant(tx, tenantId);
      const bloqueo = new FechaBloqueadaPrismaAdapter(this.prisma);
      const repos: RepositoriosConfirmacion = {
        documentos: new DocumentoConfirmacionPrismaRepository(tx),
        reservas: new ReservaConfirmacionPrismaRepository(tx),
        presupuestos: new PresupuestoConfirmacionPrismaRepository(tx),
        fechaBloqueada: new FechaBloqueadaConfirmacionPrismaRepository(tx, bloqueo),
        fichaOperativa: new FichaOperativaConfirmacionPrismaRepository(tx),
        auditoria: new AuditoriaConfirmacionPrismaRepository(tx),
      };
      return trabajo(repos);
    });
  }
}

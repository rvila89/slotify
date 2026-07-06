/**
 * Repositorios Prisma tx-bound del COBRO de la liquidación (US-029 / UC-21 pasos 7-10).
 *
 * Implementan los puertos de `RegistrarCobroLiquidacionUseCase` sobre el cliente transaccional
 * (`Prisma.TransactionClient`) que la unidad de trabajo abre bajo el contexto RLS
 * (`SET LOCAL app.tenant_id`). La relectura de la RESERVA se hace con `SELECT ... FOR UPDATE`
 * (lock de fila PostgreSQL) para serializar dos cobros concurrentes (design.md §D-2): la segunda
 * transacción ve `liquidacion_status = 'cobrada'` y aborta. Sin Redis/locks distribuidos. Los
 * Decimal se mapean a string de 2 decimales; toda query filtra por tenant vía RLS.
 */
import {
  AccionAudit,
  EstadoFactura as EstadoFacturaPrisma,
  LiquidacionStatus as LiquidacionStatusPrisma,
  Prisma,
  TipoDocumento as TipoDocumentoPrisma,
} from '@prisma/client';
import type {
  AuditoriaCobroPort,
  DocumentoJustificante,
  DocumentosCobroPort,
  FacturaCobrable,
  FacturasCobroPort,
  PagoCobro,
  PagosCobroPort,
  RegistroAuditoriaCobro,
  ReservaCobro,
  ReservasCobroPort,
} from '../application/registrar-cobro-liquidacion.use-case';
import type { LiquidacionStatusCobro } from '../domain/puede-registrar-cobro';

/** Fila cruda del `SELECT ... FOR UPDATE` sobre la RESERVA (columnas snake_case). */
interface FilaReservaBloqueada {
  id_reserva: string;
  tenant_id: string;
  cliente_id: string;
  codigo: string;
  estado: string;
  liquidacion_status: LiquidacionStatusCobro;
}

/** Repositorio tx-bound de la RESERVA (relectura FOR UPDATE + avance de sub-proceso). */
export class ReservaCobroPrismaRepository implements ReservasCobroPort {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  /**
   * Relee la RESERVA con `SELECT ... FOR UPDATE`: serializa el doble cobro concurrente (D-2). El
   * RLS ya filtra por tenant; cross-tenant/inexistente → `null`.
   */
  async releerConBloqueo(params: { reservaId: string }): Promise<ReservaCobro | null> {
    const filas = await this.tx.$queryRaw<FilaReservaBloqueada[]>(Prisma.sql`
      SELECT id_reserva, tenant_id, cliente_id, codigo, estado, liquidacion_status
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
      codigo: fila.codigo,
      estado: fila.estado,
      liquidacionStatus: fila.liquidacion_status,
    };
  }

  async avanzarLiquidacionStatus(params: {
    reservaId: string;
    estado: 'cobrada';
  }): Promise<void> {
    await this.tx.reserva.update({
      where: { idReserva: params.reservaId },
      data: { liquidacionStatus: LiquidacionStatusPrisma.cobrada },
    });
  }
}

/** Repositorio tx-bound de FACTURA (lectura de la liquidación + transición a cobrada). */
export class FacturaCobroPrismaRepository implements FacturasCobroPort {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async buscarLiquidacionPorReserva(reservaId: string): Promise<FacturaCobrable | null> {
    const fila = await this.tx.factura.findFirst({
      where: { reservaId, tipo: 'liquidacion' },
    });
    if (fila === null) {
      return null;
    }
    return {
      idFactura: fila.idFactura,
      tenantId: fila.tenantId,
      reservaId: fila.reservaId,
      numeroFactura: fila.numeroFactura,
      tipo: fila.tipo,
      estado: fila.estado,
      total: fila.total.toFixed(2),
    };
  }

  async marcarCobrada(params: { idFactura: string; estado: 'cobrada' }): Promise<void> {
    await this.tx.factura.update({
      where: { idFactura: params.idFactura },
      data: { estado: EstadoFacturaPrisma.cobrada },
    });
  }
}

/** Repositorio tx-bound de DOCUMENTO (verificación del justificante en el tenant). */
export class DocumentoCobroPrismaRepository implements DocumentosCobroPort {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async buscarJustificante(params: {
    idDocumento: string;
    tenantId: string;
    reservaId: string;
  }): Promise<DocumentoJustificante | null> {
    // El RLS ya filtra por tenant; el `tenantId` explícito refuerza la condición. Además se acota
    // a que el DOCUMENTO sea REALMENTE un justificante de pago (`tipo`) y que pertenezca a ESTA
    // reserva (`reservaId`): otro tipo o de otra reserva se trata como NO encontrado → 404.
    const fila = await this.tx.documento.findFirst({
      where: {
        idDocumento: params.idDocumento,
        tenantId: params.tenantId,
        tipo: TipoDocumentoPrisma.justificante_pago,
        reservaId: params.reservaId,
      },
    });
    if (fila === null) {
      return null;
    }
    return {
      idDocumento: fila.idDocumento,
      tenantId: fila.tenantId,
      reservaId: fila.reservaId,
      tipo: fila.tipo,
    };
  }
}

/** Repositorio tx-bound de PAGO (creación del registro de conciliación). */
export class PagoCobroPrismaRepository implements PagosCobroPort {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async crear(params: {
    tenantId: string;
    facturaId: string;
    importe: string;
    fechaCobro: Date;
    justificanteDocId: string | null;
  }): Promise<PagoCobro> {
    const fila = await this.tx.pago.create({
      data: {
        tenantId: params.tenantId,
        facturaId: params.facturaId,
        importe: new Prisma.Decimal(params.importe),
        fechaCobro: params.fechaCobro,
        justificanteDocId: params.justificanteDocId,
      },
    });
    return {
      idPago: fila.idPago,
      facturaId: fila.facturaId,
      importe: fila.importe.toFixed(2),
      fechaCobro: fila.fechaCobro,
      justificanteDocId: fila.justificanteDocId,
    };
  }
}

/** Repositorio tx-bound de AUDIT_LOG del cobro (`accion='crear'`/`'actualizar'`). */
export class AuditoriaCobroPrismaRepository implements AuditoriaCobroPort {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async registrar(registro: RegistroAuditoriaCobro): Promise<void> {
    await this.tx.auditLog.create({
      data: {
        tenantId: registro.tenantId,
        // El actor se conserva en `datos_nuevos.usuarioId` (no se fuerza el FK usuario_id,
        // que no siempre resuelve en contextos de sistema/tests; patrón de US-022/US-028).
        entidad: registro.entidad,
        entidadId: registro.entidadId,
        accion:
          registro.accion === 'crear' ? AccionAudit.crear : AccionAudit.actualizar,
        datosAnteriores: (registro.datosAnteriores ?? null) as Prisma.InputJsonValue,
        datosNuevos: (registro.usuarioId
          ? { ...(registro.datosNuevos ?? {}), usuarioId: registro.usuarioId }
          : (registro.datosNuevos ?? null)) as Prisma.InputJsonValue,
      },
    });
  }
}

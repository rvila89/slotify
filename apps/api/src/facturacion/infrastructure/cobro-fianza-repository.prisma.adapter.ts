/**
 * Repositorios Prisma tx-bound del COBRO de la FIANZA (US-030 / UC-22 pasos 5-9).
 *
 * Implementan los puertos de `RegistrarCobroFianzaUseCase` sobre el cliente transaccional
 * (`Prisma.TransactionClient`) que la unidad de trabajo abre bajo el contexto RLS
 * (`SET LOCAL app.tenant_id`). La relectura de la RESERVA se hace con `SELECT ... FOR UPDATE`
 * (lock de fila PostgreSQL) para serializar dos cobros concurrentes (design.md §D-1): la segunda
 * transacción ve `fianza_status = 'cobrada'` y aborta. Sin Redis/locks distribuidos. Los Decimal
 * se mapean a string de 2 decimales; toda query filtra por tenant vía RLS.
 */
import {
  AccionAudit,
  EstadoFactura as EstadoFacturaPrisma,
  FianzaStatus as FianzaStatusPrisma,
  Prisma,
  TipoDocumento as TipoDocumentoPrisma,
  TipoFactura as TipoFacturaPrisma,
} from '@prisma/client';
import type {
  AuditoriaCobroFianzaPort,
  DocumentoJustificante,
  DocumentosCobroFianzaPort,
  FacturaFianzaCobrable,
  FacturasCobroFianzaPort,
  PagoCobroFianza,
  PagosCobroFianzaPort,
  RegistroAuditoriaCobroFianza,
  ReservaCobroFianza,
  ReservasCobroFianzaPort,
} from '../application/registrar-cobro-fianza.use-case';
import type { FianzaStatusCobro } from '../domain/puede-registrar-cobro-fianza';

/** Fila cruda del `SELECT ... FOR UPDATE` sobre la RESERVA (columnas snake_case). */
interface FilaReservaBloqueada {
  id_reserva: string;
  tenant_id: string;
  cliente_id: string;
  codigo: string;
  estado: string;
  fianza_status: FianzaStatusCobro;
  fecha_evento: Date | null;
}

/** Repositorio tx-bound de la RESERVA (relectura FOR UPDATE + avance de sub-proceso). */
export class ReservaCobroFianzaPrismaRepository implements ReservasCobroFianzaPort {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  /**
   * Relee la RESERVA con `SELECT ... FOR UPDATE`: serializa el doble cobro concurrente (D-1). El
   * RLS ya filtra por tenant; cross-tenant/inexistente → `null`.
   */
  async releerConBloqueo(params: { reservaId: string }): Promise<ReservaCobroFianza | null> {
    const filas = await this.tx.$queryRaw<FilaReservaBloqueada[]>(Prisma.sql`
      SELECT id_reserva, tenant_id, cliente_id, codigo, estado, fianza_status, fecha_evento
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
      fianzaStatus: fila.fianza_status,
      // La fecha de evento acota la validación del cobro (fecha_cobro <= fecha_evento).
      fechaEvento: fila.fecha_evento ?? new Date(0),
    };
  }

  async avanzarFianzaStatus(params: {
    reservaId: string;
    estado: 'cobrada';
    fianzaEur: string;
    fianzaCobradaFecha: Date;
  }): Promise<void> {
    await this.tx.reserva.update({
      where: { idReserva: params.reservaId },
      data: {
        fianzaStatus: FianzaStatusPrisma.cobrada,
        fianzaEur: new Prisma.Decimal(params.fianzaEur),
        fianzaCobradaFecha: params.fianzaCobradaFecha,
      },
    });
  }
}

/** Repositorio tx-bound de FACTURA (lectura/creación de la fianza + transición a cobrada). */
export class FacturaCobroFianzaPrismaRepository implements FacturasCobroFianzaPort {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async buscarFianzaPorReserva(reservaId: string): Promise<FacturaFianzaCobrable | null> {
    const fila = await this.tx.factura.findFirst({
      where: { reservaId, tipo: TipoFacturaPrisma.fianza },
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

  async crearFacturaFianza(params: {
    tenantId: string;
    reservaId: string;
    tipo: 'fianza';
    estado: 'cobrada';
    total: string;
  }): Promise<FacturaFianzaCobrable> {
    // FACTURA(fianza) creada al vuelo (D-2b): la fianza está exenta de IVA (base=total, iva=0),
    // sin numero_factura ni PDF (no se emitió). Directamente `cobrada`.
    const fila = await this.tx.factura.create({
      data: {
        tenantId: params.tenantId,
        reservaId: params.reservaId,
        tipo: TipoFacturaPrisma.fianza,
        estado: EstadoFacturaPrisma.cobrada,
        baseImponible: new Prisma.Decimal(params.total),
        ivaPorcentaje: new Prisma.Decimal('0.00'),
        ivaImporte: new Prisma.Decimal('0.00'),
        total: new Prisma.Decimal(params.total),
        concepto: 'Fianza',
      },
    });
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
export class DocumentoCobroFianzaPrismaRepository implements DocumentosCobroFianzaPort {
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
export class PagoCobroFianzaPrismaRepository implements PagosCobroFianzaPort {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async crear(params: {
    tenantId: string;
    facturaId: string;
    importe: string;
    fechaCobro: Date;
    justificanteDocId: string | null;
  }): Promise<PagoCobroFianza> {
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
export class AuditoriaCobroFianzaPrismaRepository implements AuditoriaCobroFianzaPort {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async registrar(registro: RegistroAuditoriaCobroFianza): Promise<void> {
    await this.tx.auditLog.create({
      data: {
        tenantId: registro.tenantId,
        // El actor se conserva en `datos_nuevos.usuarioId` (no se fuerza el FK usuario_id, que no
        // siempre resuelve en contextos de sistema/tests; patrón de US-022/US-028/US-029).
        entidad: registro.entidad,
        entidadId: registro.entidadId,
        accion: registro.accion === 'crear' ? AccionAudit.crear : AccionAudit.actualizar,
        datosAnteriores: (registro.datosAnteriores ?? null) as Prisma.InputJsonValue,
        datosNuevos: (registro.usuarioId
          ? { ...(registro.datosNuevos ?? {}), usuarioId: registro.usuarioId }
          : (registro.datosNuevos ?? null)) as Prisma.InputJsonValue,
      },
    });
  }
}

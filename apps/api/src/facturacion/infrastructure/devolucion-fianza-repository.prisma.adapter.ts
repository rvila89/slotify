/**
 * Repositorios Prisma tx-bound de la DEVOLUCIÓN de la FIANZA (US-036 / UC-27 pasos 4-8). Simétrico
 * inverso del cobro de US-030 (`cobro-fianza-repository.prisma.adapter.ts`).
 *
 * Implementan los puertos de `RegistrarDevolucionFianzaUseCase` sobre el cliente transaccional
 * (`Prisma.TransactionClient`) que la unidad de trabajo abre bajo el contexto RLS
 * (`SET LOCAL app.tenant_id`). La relectura de la RESERVA se hace con `SELECT ... FOR UPDATE`
 * (lock de fila PostgreSQL) para serializar dos devoluciones concurrentes (design.md §D-1/§D-4): la
 * segunda transacción ve el estado final (`devuelta`/`retenida_parcial`) y aborta. Sin Redis/locks
 * distribuidos. Los Decimal se mapean a string de 2 decimales; toda query filtra por tenant vía RLS.
 */
import {
  AccionAudit,
  FianzaStatus as FianzaStatusPrisma,
  Prisma,
  TipoDocumento as TipoDocumentoPrisma,
} from '@prisma/client';
import type {
  AuditoriaDevolucionFianzaPort,
  DocumentoJustificante,
  DocumentosDevolucionFianzaPort,
  RegistrarDevolucionParams,
  RegistroAuditoriaDevolucionFianza,
  ReservaDevolucionFianza,
  ReservasDevolucionFianzaPort,
} from '../application/registrar-devolucion-fianza.use-case';

/** Fila cruda del `SELECT ... FOR UPDATE` sobre RESERVA + CLIENTE (columnas snake_case). */
interface FilaReservaDevolucionBloqueada {
  id_reserva: string;
  tenant_id: string;
  cliente_id: string;
  codigo: string;
  estado: string;
  fianza_status: string;
  fianza_eur: Prisma.Decimal | null;
  fianza_cobrada_fecha: Date | null;
  iban_devolucion: string | null;
}

/** Repositorio tx-bound de la RESERVA (relectura FOR UPDATE + registro del estado final). */
export class ReservaDevolucionFianzaPrismaRepository implements ReservasDevolucionFianzaPort {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  /**
   * Relee la RESERVA con `SELECT ... FOR UPDATE` (lock de fila de RESERVA que serializa el doble
   * registro, D-1/D-4) y trae el `iban_devolucion` del CLIENTE para la precondición triple. El RLS
   * ya filtra por tenant; cross-tenant/inexistente → `null`. El `FOR UPDATE OF reserva` bloquea la
   * fila de RESERVA (agregado raíz), no la del CLIENTE.
   */
  async releerConBloqueo(params: { reservaId: string }): Promise<ReservaDevolucionFianza | null> {
    const filas = await this.tx.$queryRaw<FilaReservaDevolucionBloqueada[]>(Prisma.sql`
      SELECT
        r.id_reserva,
        r.tenant_id,
        r.cliente_id,
        r.codigo,
        r.estado,
        r.fianza_status,
        r.fianza_eur,
        r.fianza_cobrada_fecha,
        c.iban_devolucion
      FROM reserva r
      JOIN cliente c ON c.id_cliente = r.cliente_id
      WHERE r.id_reserva = ${params.reservaId}
      FOR UPDATE OF r
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
      // La fianza cobrada acota importe (cota superior) y fecha (cota inferior) de la devolución.
      fianzaEur: fila.fianza_eur === null ? '0.00' : fila.fianza_eur.toFixed(2),
      fianzaCobradaFecha: fila.fianza_cobrada_fecha ?? new Date(0),
      ibanDevolucion: fila.iban_devolucion,
    };
  }

  async registrarDevolucion(params: RegistrarDevolucionParams): Promise<void> {
    await this.tx.reserva.update({
      where: { idReserva: params.reservaId },
      data: {
        fianzaStatus:
          params.fianzaStatus === 'devuelta'
            ? FianzaStatusPrisma.devuelta
            : FianzaStatusPrisma.retenida_parcial,
        fianzaDevueltaEur: new Prisma.Decimal(params.fianzaDevueltaEur),
        fianzaDevueltaFecha: params.fianzaDevueltaFecha,
        motivoRetencion: params.motivoRetencion,
      },
    });
  }
}

/** Repositorio tx-bound de DOCUMENTO (verificación del justificante en el tenant). */
export class DocumentoDevolucionFianzaPrismaRepository implements DocumentosDevolucionFianzaPort {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async buscarJustificante(params: {
    idDocumento: string;
    tenantId: string;
    reservaId: string;
  }): Promise<DocumentoJustificante | null> {
    // El RLS ya filtra por tenant; el `tenantId` explícito refuerza la condición. Se acota a que el
    // DOCUMENTO sea REALMENTE un justificante de pago (`tipo`) y que pertenezca a ESTA reserva
    // (`reservaId`): otro tipo o de otra reserva se trata como NO encontrado → 404.
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
      mimeType: fila.mimeType,
      url: fila.url,
    };
  }
}

/** Repositorio tx-bound de AUDIT_LOG de la devolución (`accion='actualizar'`). */
export class AuditoriaDevolucionFianzaPrismaRepository implements AuditoriaDevolucionFianzaPort {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async registrar(registro: RegistroAuditoriaDevolucionFianza): Promise<void> {
    await this.tx.auditLog.create({
      data: {
        tenantId: registro.tenantId,
        // El actor se conserva en `datos_nuevos.usuarioId` (no se fuerza el FK usuario_id, que no
        // siempre resuelve en contextos de sistema/tests; patrón de US-022/US-029/US-030).
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

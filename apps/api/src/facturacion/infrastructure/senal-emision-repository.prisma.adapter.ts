/**
 * Repositorios Prisma tx-bound del ENVÍO de la factura de señal + E3 (US-023 / UC-18, 6.4b).
 *
 * Implementan los puertos de `EnviarFacturaSenalUseCase` sobre el cliente transaccional
 * (`Prisma.TransactionClient`) que la unidad de trabajo abre bajo el contexto RLS. La señal se
 * localiza por `reserva + tipo='senal'`; su emisión conserva el `numero_factura` de US-022 (solo
 * fija estado + `fecha_emision`). La idempotencia de E3 se comprueba por la COMUNICACION E3
 * `enviado` previa. Toda consulta filtra por tenant vía RLS. Nada de locks distribuidos.
 */
import {
  AccionAudit,
  EstadoFactura as EstadoFacturaPrisma,
  Prisma,
  TipoFactura as TipoFacturaPrisma,
  CodigoEmail as CodigoEmailPrisma,
  EstadoComunicacion as EstadoComunicacionPrisma,
} from '@prisma/client';
import type {
  AuditoriaSenalEmisionPort,
  ComunicacionesSenalEmisionPort,
  ComunicacionE3Previa,
  EmitirFacturaSenalParams,
  EstadoSenalEmitible,
  FacturaSenalEmitible,
  FacturasSenalEmisionPort,
  RegistroAuditoriaSenalEmision,
  ReservasSenalEmisionPort,
} from '../application/enviar-factura-senal.use-case';
import type { TipoFactura } from '../domain/factura';

/** Mapea una fila FACTURA de Prisma a la proyección `FacturaSenalEmitible`. */
const aFacturaSenalEmitible = (fila: {
  idFactura: string;
  tenantId: string;
  reservaId: string;
  numeroFactura: string | null;
  tipo: TipoFacturaPrisma;
  estado: EstadoFacturaPrisma;
  total: Prisma.Decimal;
  baseImponible: Prisma.Decimal;
  ivaPorcentaje: Prisma.Decimal;
  ivaImporte: Prisma.Decimal;
  pdfUrl: string | null;
  fechaEmision: Date | null;
}): FacturaSenalEmitible => ({
  idFactura: fila.idFactura,
  tenantId: fila.tenantId,
  reservaId: fila.reservaId,
  numeroFactura: fila.numeroFactura,
  tipo: fila.tipo as TipoFactura,
  estado: fila.estado as EstadoSenalEmitible,
  total: fila.total.toFixed(2),
  baseImponible: fila.baseImponible.toFixed(2),
  ivaPorcentaje: fila.ivaPorcentaje.toFixed(2),
  ivaImporte: fila.ivaImporte.toFixed(2),
  pdfUrl: fila.pdfUrl,
  fechaEmision: fila.fechaEmision,
});

/** Repositorio tx-bound de FACTURA de señal (emisión + numeración). */
export class FacturaSenalEmisionPrismaRepository implements FacturasSenalEmisionPort {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async buscarPorReservaYTipo(
    reservaId: string,
    tipo: 'senal',
  ): Promise<FacturaSenalEmitible | null> {
    const fila = await this.tx.factura.findFirst({
      where: { reservaId, tipo: TipoFacturaPrisma[tipo] },
    });
    return fila === null ? null : aFacturaSenalEmitible(fila);
  }

  /** Último `numero_factura` del tenant en el año (defensivo; la señal ya suele traer número). */
  async ultimoNumeroDelAnio(tenantId: string, anio: number): Promise<string | null> {
    const prefijo = `F-${anio}-%`;
    const filas = await this.tx.$queryRaw<{ numero_factura: string | null }[]>(Prisma.sql`
      SELECT numero_factura
      FROM factura
      WHERE tenant_id = ${tenantId} AND numero_factura LIKE ${prefijo}
      ORDER BY LENGTH(numero_factura) DESC, numero_factura DESC
      LIMIT 1
    `);
    return filas.length === 0 ? null : filas[0].numero_factura;
  }

  /** Transición borrador/enviada → enviada: fija estado y fecha_emision (conserva el número). */
  async emitir(params: EmitirFacturaSenalParams): Promise<void> {
    await this.tx.factura.update({
      where: { idFactura: params.idFactura },
      data: {
        ...(params.numeroFactura !== null ? { numeroFactura: params.numeroFactura } : {}),
        estado: EstadoFacturaPrisma.enviada,
        fechaEmision: params.fechaEmision,
      },
    });
  }
}

/** Repositorio tx-bound de COMUNICACION E3 (idempotencia + registro). */
export class ComunicacionSenalEmisionPrismaRepository
  implements ComunicacionesSenalEmisionPort
{
  constructor(private readonly tx: Prisma.TransactionClient) {}

  /** COMUNICACION E3 previa de la reserva (excluye los reenvíos manuales, US-028 D-4). */
  async buscarE3(reservaId: string): Promise<ComunicacionE3Previa | null> {
    const fila = await this.tx.comunicacion.findFirst({
      where: { reservaId, codigoEmail: CodigoEmailPrisma.E3, esReenvio: false },
      orderBy: { fechaCreacion: 'desc' },
      select: { estado: true },
    });
    return fila === null ? null : { estado: fila.estado };
  }

  async crear(params: {
    tenantId: string;
    reservaId: string;
    clienteId: string;
    codigoEmail: 'E3';
    estado: 'enviado';
    fechaEnvio: Date;
    destinatarioEmail: string;
  }): Promise<{ idComunicacion: string; estado: string; fechaEnvio: Date | null }> {
    const fila = await this.tx.comunicacion.create({
      data: {
        tenantId: params.tenantId,
        reservaId: params.reservaId,
        clienteId: params.clienteId,
        codigoEmail: CodigoEmailPrisma.E3,
        asunto: 'Confirmación de tu reserva y factura de señal',
        cuerpo: null,
        destinatarioEmail: params.destinatarioEmail,
        estado: EstadoComunicacionPrisma.enviado,
        fechaEnvio: params.fechaEnvio,
      },
      select: { idComunicacion: true, estado: true, fechaEnvio: true },
    });
    return {
      idComunicacion: fila.idComunicacion,
      estado: fila.estado,
      fechaEnvio: fila.fechaEnvio,
    };
  }
}

/**
 * Repositorio tx-bound de la RESERVA: fija `cond_part_enviadas_fecha` (y `cond_part_firmadas
 * = false`) cuando E3 adjunta las condicions particulars (change condiciones-…-senal-…).
 */
export class ReservaSenalEmisionPrismaRepository implements ReservasSenalEmisionPort {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async fijarCondicionesEnviadas(params: {
    reservaId: string;
    condPartEnviadasFecha: Date;
  }): Promise<void> {
    await this.tx.reserva.update({
      where: { idReserva: params.reservaId },
      data: {
        condPartEnviadasFecha: params.condPartEnviadasFecha,
        condPartFirmadas: false,
      },
    });
  }
}

/** Repositorio tx-bound de AUDIT_LOG de la emisión de la señal. */
export class AuditoriaSenalEmisionPrismaRepository implements AuditoriaSenalEmisionPort {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async registrar(registro: RegistroAuditoriaSenalEmision): Promise<void> {
    await this.tx.auditLog.create({
      data: {
        tenantId: registro.tenantId,
        // El actor se conserva en `datos_nuevos.usuarioId` (no se fuerza el FK usuario_id,
        // patrón de US-022/US-027/US-028).
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

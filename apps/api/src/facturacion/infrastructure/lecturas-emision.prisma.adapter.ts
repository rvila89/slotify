/**
 * Adaptadores Prisma de LECTURA de la EMISIÓN (US-028 / UC-21, UC-22).
 *
 * Cargan la RESERVA (con el email del cliente) y la FACTURA de liquidación fuera de la tx
 * crítica, cada una en su propio `$transaction` + `fijarTenant` (RLS): cross-tenant → null
 * (invisible por RLS). Los Decimal se mapean a string de 2 decimales.
 */
import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  CargarReservaLiquidacionEmisionPort,
  ReservaLiquidacionEmision,
} from '../application/enviar-factura-liquidacion.use-case';
import type {
  CargarLiquidacionReenvioPort,
  CargarReservaReenvioPort,
  FacturaEmitida,
  ReservaReenvio,
} from '../application/reenviar-liquidacion.use-case';
import type {
  CargarFacturaLiquidacionPort,
  FacturaLiquidacion,
  VerificarE4EnviadoPort,
} from '../application/obtener-factura-liquidacion.use-case';
import type { EstadoFactura, TipoFactura } from '../domain/factura';
import type {
  CargarReservaSenalEmisionPort,
  ReservaSenalEmision,
} from '../application/enviar-factura-senal.use-case';
import type { VerificarE3EnviadoPort } from '../application/obtener-factura-senal.use-case';
import type {
  BuscarDocumentoCondicionesPort,
  BuscarE3PreviaPort,
  CargarFacturaSenalReenvioPort,
  CargarReservaReenvioE3Port,
  ComunicacionE3PreviaReenvio,
  DocumentoCondicionesReenvio,
  FacturaSenalReenvio,
  ReservaReenvioE3,
} from '../application/reenviar-e3.use-case';

/** Carga la RESERVA para la emisión de la liquidación (email + idioma + fianzaEur para E4). */
@Injectable()
export class CargarReservaEmisionPrismaAdapter {
  constructor(private readonly prisma: PrismaService) {}

  readonly cargar: CargarReservaLiquidacionEmisionPort = async (params) => {
    const fila = await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, params.tenantId);
      return tx.reserva.findFirst({
        where: { idReserva: params.reservaId, tenantId: params.tenantId },
        select: {
          idReserva: true,
          tenantId: true,
          clienteId: true,
          codigo: true,
          idioma: true,
          liquidacionStatus: true,
          fianzaStatus: true,
          fianzaEur: true,
          cliente: { select: { email: true, nombre: true, apellidos: true } },
        },
      });
    });
    if (fila === null) {
      return null;
    }
    const reserva: ReservaLiquidacionEmision = {
      idReserva: fila.idReserva,
      tenantId: fila.tenantId,
      clienteId: fila.clienteId,
      codigo: fila.codigo,
      idioma: fila.idioma,
      liquidacionStatus: fila.liquidacionStatus,
      fianzaStatus: fila.fianzaStatus,
      fianzaEur: fila.fianzaEur === null ? null : fila.fianzaEur.toFixed(2),
      clienteEmail: fila.cliente.email ?? '',
      clienteNombre: fila.cliente.nombre,
      clienteApellidos: fila.cliente.apellidos ?? '',
    };
    return reserva;
  };
}

/** Carga la RESERVA para el envío de la factura de señal + E3 (email cliente + cond_part_*). */
@Injectable()
export class CargarReservaSenalEmisionPrismaAdapter {
  constructor(private readonly prisma: PrismaService) {}

  readonly cargar: CargarReservaSenalEmisionPort = async (params) => {
    const fila = await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, params.tenantId);
      return tx.reserva.findFirst({
        where: { idReserva: params.reservaId, tenantId: params.tenantId },
        select: {
          idReserva: true,
          tenantId: true,
          clienteId: true,
          codigo: true,
          idioma: true,
          condPartEnviadasFecha: true,
          condPartFirmadas: true,
          cliente: { select: { email: true, nombre: true, apellidos: true } },
        },
      });
    });
    if (fila === null) {
      return null;
    }
    const reserva: ReservaSenalEmision = {
      idReserva: fila.idReserva,
      tenantId: fila.tenantId,
      clienteId: fila.clienteId,
      codigo: fila.codigo,
      clienteEmail: fila.cliente.email ?? '',
      idioma: fila.idioma,
      clienteNombre: fila.cliente.nombre,
      clienteApellidos: fila.cliente.apellidos ?? '',
      condPartEnviadasFecha: fila.condPartEnviadasFecha,
      condPartFirmadas: fila.condPartFirmadas,
    };
    return reserva;
  };
}

/**
 * Verifica si ya se envió E3 (COMUNICACION E3 `enviado`, `es_reenvio=false`) para la reserva,
 * bajo el RLS del tenant. Alimenta el flag `e3Enviado` de la lectura de la factura de señal.
 */
@Injectable()
export class VerificarE3EnviadoPrismaAdapter {
  constructor(private readonly prisma: PrismaService) {}

  readonly verificar: VerificarE3EnviadoPort = async (params) => {
    const fila = await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, params.tenantId);
      return tx.comunicacion.findFirst({
        where: {
          reservaId: params.reservaId,
          tenantId: params.tenantId,
          codigoEmail: 'E3',
          estado: 'enviado',
          esReenvio: false,
        },
        select: { idComunicacion: true },
      });
    });
    return fila !== null;
  };
}

/** Carga la RESERVA para el reenvío de la liquidación (email + idioma + fianzaEur para E4). */
@Injectable()
export class CargarReservaReenvioPrismaAdapter {
  constructor(private readonly prisma: PrismaService) {}

  readonly cargar: CargarReservaReenvioPort = async (params) => {
    const fila = await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, params.tenantId);
      return tx.reserva.findFirst({
        where: { idReserva: params.reservaId, tenantId: params.tenantId },
        select: {
          idReserva: true,
          tenantId: true,
          clienteId: true,
          codigo: true,
          idioma: true,
          liquidacionStatus: true,
          fianzaStatus: true,
          fianzaEur: true,
          cliente: { select: { email: true, nombre: true, apellidos: true } },
        },
      });
    });
    if (fila === null) {
      return null;
    }
    const reserva: ReservaReenvio = {
      idReserva: fila.idReserva,
      tenantId: fila.tenantId,
      clienteId: fila.clienteId,
      codigo: fila.codigo,
      idioma: fila.idioma,
      liquidacionStatus: fila.liquidacionStatus,
      fianzaStatus: fila.fianzaStatus,
      fianzaEur: fila.fianzaEur === null ? null : fila.fianzaEur.toFixed(2),
      clienteEmail: fila.cliente.email ?? '',
      clienteNombre: fila.cliente.nombre,
      clienteApellidos: fila.cliente.apellidos ?? '',
    };
    return reserva;
  };
}

// ---------------------------------------------------------------------------
// US-023 (GAP 3): lecturas del reenvío de E3 (RLS, cada una en su propio $transaction).
// ---------------------------------------------------------------------------

/** Carga la RESERVA para el reenvío de E3 (email cliente + cond_part_enviadas_fecha). */
@Injectable()
export class CargarReservaReenvioE3PrismaAdapter {
  constructor(private readonly prisma: PrismaService) {}

  readonly cargar: CargarReservaReenvioE3Port = async (params) => {
    const fila = await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, params.tenantId);
      return tx.reserva.findFirst({
        where: { idReserva: params.reservaId, tenantId: params.tenantId },
        select: {
          idReserva: true,
          tenantId: true,
          clienteId: true,
          codigo: true,
          idioma: true,
          condPartEnviadasFecha: true,
          cliente: { select: { email: true, nombre: true, apellidos: true } },
        },
      });
    });
    if (fila === null) {
      return null;
    }
    const reserva: ReservaReenvioE3 = {
      idReserva: fila.idReserva,
      tenantId: fila.tenantId,
      clienteId: fila.clienteId,
      codigo: fila.codigo,
      clienteEmail: fila.cliente.email ?? '',
      idioma: fila.idioma,
      clienteNombre: fila.cliente.nombre,
      clienteApellidos: fila.cliente.apellidos ?? '',
      condPartEnviadasFecha: fila.condPartEnviadasFecha,
    };
    return reserva;
  };
}

/** Carga la FACTURA de señal de una reserva (para el reenvío de E3). */
@Injectable()
export class CargarFacturaSenalReenvioPrismaAdapter {
  constructor(private readonly prisma: PrismaService) {}

  readonly cargar: CargarFacturaSenalReenvioPort = async (params) => {
    const fila = await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, params.tenantId);
      return tx.factura.findFirst({
        where: { reservaId: params.reservaId, tipo: 'senal' },
        select: {
          idFactura: true,
          tenantId: true,
          reservaId: true,
          numeroFactura: true,
          tipo: true,
          estado: true,
          total: true,
          pdfUrl: true,
          fechaEmision: true,
        },
      });
    });
    if (fila === null) {
      return null;
    }
    const senal: FacturaSenalReenvio = {
      idFactura: fila.idFactura,
      tenantId: fila.tenantId,
      reservaId: fila.reservaId,
      numeroFactura: fila.numeroFactura,
      tipo: 'senal',
      estado: fila.estado as 'borrador' | 'enviada' | 'cobrada',
      total: fila.total.toFixed(2),
      pdfUrl: fila.pdfUrl,
      fechaEmision: fila.fechaEmision,
    };
    return senal;
  };
}

/** Busca la COMUNICACION E3 `enviado` previa (`es_reenvio=false`) de la reserva. */
@Injectable()
export class BuscarE3PreviaPrismaAdapter {
  constructor(private readonly prisma: PrismaService) {}

  readonly buscar: BuscarE3PreviaPort = async (params) => {
    const fila = await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, params.tenantId);
      return tx.comunicacion.findFirst({
        where: { reservaId: params.reservaId, codigoEmail: 'E3', esReenvio: false },
        orderBy: { fechaCreacion: 'desc' },
        select: { idComunicacion: true, estado: true, esReenvio: true },
      });
    });
    if (fila === null) {
      return null;
    }
    const previa: ComunicacionE3PreviaReenvio = {
      idComunicacion: fila.idComunicacion,
      estado: fila.estado,
      esReenvio: fila.esReenvio,
    };
    return previa;
  };
}

/** Busca el DOCUMENTO de condiciones ya persistido (GAP 1) de la reserva, para reutilizarlo. */
@Injectable()
export class BuscarDocumentoCondicionesPrismaAdapter {
  constructor(private readonly prisma: PrismaService) {}

  readonly buscar: BuscarDocumentoCondicionesPort = async (params) => {
    const fila = await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, params.tenantId);
      return tx.documento.findFirst({
        where: {
          reservaId: params.reservaId,
          tenantId: params.tenantId,
          tipo: 'condiciones_particulares',
        },
        select: {
          idDocumento: true,
          tenantId: true,
          reservaId: true,
          url: true,
          mimeType: true,
        },
      });
    });
    if (fila === null) {
      return null;
    }
    const documento: DocumentoCondicionesReenvio = {
      idDocumento: fila.idDocumento,
      tipo: 'condiciones_particulares',
      reservaId: fila.reservaId ?? params.reservaId,
      tenantId: fila.tenantId,
      url: fila.url,
      mimeType: fila.mimeType,
    };
    return documento;
  };
}

/** Carga la FACTURA de liquidación de una reserva (para el reenvío). */
@Injectable()
export class CargarLiquidacionReenvioPrismaAdapter {
  constructor(private readonly prisma: PrismaService) {}

  readonly cargar: CargarLiquidacionReenvioPort = async (params) => {
    const fila = await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, params.tenantId);
      return tx.factura.findFirst({
        where: { reservaId: params.reservaId, tipo: 'liquidacion' },
        select: {
          idFactura: true,
          tenantId: true,
          reservaId: true,
          numeroFactura: true,
          tipo: true,
          estado: true,
          total: true,
          pdfUrl: true,
          fechaEmision: true,
        },
      });
    });
    if (fila === null) {
      return null;
    }
    const liquidacion: FacturaEmitida = {
      idFactura: fila.idFactura,
      tenantId: fila.tenantId,
      reservaId: fila.reservaId,
      numeroFactura: fila.numeroFactura,
      tipo: 'liquidacion',
      estado: fila.estado as 'borrador' | 'enviada' | 'cobrada',
      total: fila.total.toFixed(2),
      pdfUrl: fila.pdfUrl,
      fechaEmision: fila.fechaEmision,
    };
    return liquidacion;
  };
}

/**
 * Carga la FACTURA de liquidación de una reserva con desglose completo (para GET
 * /reservas/{id}/factura-liquidacion). fix-liquidacion-fianza-independientes.
 */
@Injectable()
export class CargarFacturaLiquidacionPrismaAdapter {
  constructor(private readonly prisma: PrismaService) {}

  readonly cargar: CargarFacturaLiquidacionPort = async (params) => {
    const fila = await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, params.tenantId);
      return tx.factura.findFirst({
        where: { reservaId: params.reservaId, tipo: 'liquidacion' },
        select: {
          idFactura: true,
          tenantId: true,
          reservaId: true,
          numeroFactura: true,
          tipo: true,
          estado: true,
          total: true,
          baseImponible: true,
          ivaPorcentaje: true,
          ivaImporte: true,
          pdfUrl: true,
          fechaEmision: true,
        },
      });
    });
    if (fila === null) {
      return null;
    }
    const liquidacion: FacturaLiquidacion = {
      idFactura: fila.idFactura,
      tenantId: fila.tenantId,
      reservaId: fila.reservaId,
      numeroFactura: fila.numeroFactura,
      tipo: fila.tipo as TipoFactura,
      estado: fila.estado as EstadoFactura,
      total: fila.total.toFixed(2),
      baseImponible: fila.baseImponible.toFixed(2),
      ivaPorcentaje: fila.ivaPorcentaje.toFixed(2),
      ivaImporte: fila.ivaImporte.toFixed(2),
      pdfUrl: fila.pdfUrl,
      fechaEmision: fila.fechaEmision,
    };
    return liquidacion;
  };
}

/**
 * Verifica si ya se envió E4 (COMUNICACION E4 `enviado`, `es_reenvio=false`) para la reserva,
 * bajo el RLS del tenant. Alimenta el flag `e4Enviado` de la lectura de la liquidación.
 */
@Injectable()
export class VerificarE4EnviadoPrismaAdapter {
  constructor(private readonly prisma: PrismaService) {}

  readonly verificar: VerificarE4EnviadoPort = async (params) => {
    const fila = await this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, params.tenantId);
      return tx.comunicacion.findFirst({
        where: {
          reservaId: params.reservaId,
          tenantId: params.tenantId,
          codigoEmail: 'E4',
          estado: 'enviado',
          esReenvio: false,
        },
        select: { idComunicacion: true },
      });
    });
    return fila !== null;
  };
}

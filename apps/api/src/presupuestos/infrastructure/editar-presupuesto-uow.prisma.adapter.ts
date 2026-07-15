/**
 * Unidad de trabajo transaccional de la EDICIÓN de presupuesto (US-015): abre UN
 * único `$transaction` + `fijarTenant(tenantId)` (RLS) y expone los repositorios
 * tx-bound (`ReposEditarPresupuesto`). Si el trabajo rechaza, la tx revierte por
 * completo (all-or-nothing). Espejo de `ActivarPrereservaUoWPrismaAdapter` (US-014).
 *
 * Implementa la primera persistencia REAL de líneas `RESERVA_EXTRA` (design.md D3):
 * al confirmar, `reemplazarLineas` borra el conjunto vivo de la RESERVA e inserta el
 * nuevo conjunto con el `precio_unitario` ya congelado por el use-case. NO toca
 * `RESERVA.estado` ni `FECHA_BLOQUEADA.ttl_expiracion` (invariante §D5); por eso NO
 * hay repositorios de RESERVA ni de bloqueo de fecha.
 *
 * Concurrencia: el `@@unique([reservaId, version])` serializa; la colisión `P2002` la
 * reintenta el use-case (no aquí). Numeración por régimen: `ultimoNumeroDelAnio`
 * consulta el MAX del año/régimen; el `@@unique([tenantId, regimenIva,
 * numeroPresupuesto])` la protege (reintento en el use-case de US-014).
 */
import { Injectable } from '@nestjs/common';
import {
  AccionAudit,
  CodigoEmail as CodigoEmailPrisma,
  EstadoComunicacion as EstadoComunicacionPrisma,
  EstadoPresupuesto as EstadoPresupuestoPrisma,
  MetodoPago as MetodoPagoPrisma,
  OrigenExtra as OrigenExtraPrisma,
  Prisma,
  RegimenIva as RegimenIvaPrisma,
} from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  AuditoriaEdicionPort,
  ComunicacionE2Reenvio,
  ComunicacionesRepositoryPort,
  CrearVersionParams,
  ExtrasRepositoryPort,
  LineaExtraAMaterializar,
  PresupuestoVersionCreada,
  PresupuestoVersionRepositoryPort,
  RegistroAuditoriaEdicion,
  ReposEditarPresupuesto,
  UnidadDeTrabajoEditarPresupuestoPort,
} from '../application/editar-presupuesto.use-case';
import type { RegimenIva } from '../domain/regimen-desde-metodo-pago';

/** Repositorio tx-bound de PRESUPUESTO (versionado). */
class PresupuestoVersionPrismaRepository
  implements PresupuestoVersionRepositoryPort
{
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async versionMaxima(params: {
    tenantId: string;
    reservaId: string;
  }): Promise<number> {
    const agregado = await this.tx.presupuesto.aggregate({
      where: { reservaId: params.reservaId, tenantId: params.tenantId },
      _max: { version: true },
    });
    return agregado._max.version ?? 0;
  }

  async ultimoNumeroDelAnio(
    tenantId: string,
    anio: number,
    regimen: RegimenIva,
  ): Promise<string | null> {
    const prefijo = String(anio);
    const fila = await this.tx.presupuesto.findFirst({
      where: {
        tenantId,
        regimenIva: regimen as RegimenIvaPrisma,
        numeroPresupuesto: { startsWith: prefijo },
      },
      orderBy: { numeroPresupuesto: 'desc' },
      select: { numeroPresupuesto: true },
    });
    return fila?.numeroPresupuesto ?? null;
  }

  async crearVersion(
    params: CrearVersionParams,
  ): Promise<PresupuestoVersionCreada> {
    const fila = await this.tx.presupuesto.create({
      data: {
        tenantId: params.tenantId,
        reservaId: params.reservaId,
        version: params.version,
        estado: params.estado as EstadoPresupuestoPrisma,
        tarifaCongelada: params.tarifaCongelada,
        numeroPresupuesto: params.numeroPresupuesto,
        baseImponible: params.baseImponible,
        ivaPorcentaje: params.ivaPorcentaje,
        ivaImporte: params.ivaImporte,
        total: params.total,
        descuentoEur: params.descuentoEur,
        descuentoMotivo: params.descuentoMotivo,
        metodoPago: params.metodoPago as MetodoPagoPrisma,
        regimenIva: params.regimenIva as RegimenIvaPrisma,
        pdfUrl: params.pdfUrl,
        fechaEnvio: params.estado === 'enviado' ? new Date() : null,
      },
    });
    return {
      idPresupuesto: fila.idPresupuesto,
      version: fila.version,
      estado: fila.estado,
      numeroPresupuesto: fila.numeroPresupuesto,
      total: fila.total.toFixed(2),
      baseImponible: fila.baseImponible.toFixed(2),
      ivaPorcentaje: fila.ivaPorcentaje.toFixed(2),
      ivaImporte: fila.ivaImporte.toFixed(2),
      tarifaCongelada: fila.tarifaCongelada,
      pdfUrl: fila.pdfUrl,
      regimenIva: fila.regimenIva as RegimenIva,
    };
  }
}

/** Repositorio tx-bound del conjunto vivo de líneas `RESERVA_EXTRA`. */
class ExtrasPrismaRepository implements ExtrasRepositoryPort {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async reemplazarLineas(params: {
    tenantId: string;
    reservaId: string;
    lineas: LineaExtraAMaterializar[];
  }): Promise<{ lineas: unknown[] }> {
    // Conjunto vivo ligado a la RESERVA: se borra el conjunto actual (sin factura) y
    // se re-inserta el nuevo. Las líneas ya facturadas (factura_id != null) NO se
    // tocan (defensa; en pre_reserva no debería haberlas).
    await this.tx.reservaExtra.deleteMany({
      where: { reservaId: params.reservaId, facturaId: null },
    });
    const creadas: unknown[] = [];
    for (const linea of params.lineas) {
      const fila = await this.tx.reservaExtra.create({
        data: {
          reservaId: params.reservaId,
          extraId: linea.extraId,
          conceptoLibre: linea.conceptoLibre,
          origen: linea.origen as OrigenExtraPrisma,
          cantidad: linea.cantidad,
          precioUnitario: linea.precioUnitario,
          subtotal: linea.subtotal,
          facturaId: linea.facturaId,
        },
      });
      creadas.push({
        idReservaExtra: fila.idReservaExtra,
        reservaId: fila.reservaId,
        extraId: fila.extraId,
        facturaId: fila.facturaId,
        conceptoLibre: fila.conceptoLibre,
        origen: fila.origen,
        cantidad: fila.cantidad,
        precioUnitario: fila.precioUnitario.toFixed(2),
        subtotal: fila.subtotal.toFixed(2),
      });
    }
    return { lineas: creadas };
  }
}

/** Repositorio tx-bound de COMUNICACION (E2 de reenvío, `es_reenvio=true`). */
class ComunicacionesPrismaRepository implements ComunicacionesRepositoryPort {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async registrarE2Reenvio(params: {
    tenantId: string;
    reservaId: string;
    codigoEmail: 'E2';
    estado: 'enviado';
    esReenvio: true;
  }): Promise<ComunicacionE2Reenvio> {
    const reserva = await this.tx.reserva.findFirst({
      where: { idReserva: params.reservaId, tenantId: params.tenantId },
      include: { cliente: true },
    });
    if (reserva === null || reserva.cliente === null) {
      throw new Error(
        `No se encontró la RESERVA/CLIENTE para registrar la COMUNICACION E2 (${params.reservaId})`,
      );
    }
    const fila = await this.tx.comunicacion.create({
      data: {
        tenantId: params.tenantId,
        reservaId: params.reservaId,
        clienteId: reserva.clienteId,
        codigoEmail: CodigoEmailPrisma.E2,
        asunto: 'Presupuesto actualizado',
        cuerpo: null,
        destinatarioEmail: reserva.cliente.email ?? '',
        estado: EstadoComunicacionPrisma.enviado,
        fechaEnvio: new Date(),
        // es_reenvio=true para quedar FUERA del índice UNIQUE parcial (US-028 D-4).
        esReenvio: true,
      },
      select: {
        idComunicacion: true,
        codigoEmail: true,
        estado: true,
        esReenvio: true,
      },
    });
    return {
      idComunicacion: fila.idComunicacion,
      codigoEmail: fila.codigoEmail,
      estado: fila.estado,
      esReenvio: fila.esReenvio,
    };
  }
}

/** Repositorio tx-bound de AUDIT_LOG (`accion='actualizar'`). */
class AuditoriaEdicionPrismaRepository implements AuditoriaEdicionPort {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async registrar(registro: RegistroAuditoriaEdicion): Promise<void> {
    await this.tx.auditLog.create({
      data: {
        tenantId: registro.tenantId,
        entidad: registro.entidad,
        entidadId: registro.entidadId,
        accion: AccionAudit.actualizar,
        datosAnteriores: (registro.datosAnteriores ??
          undefined) as Prisma.InputJsonValue,
        datosNuevos: (registro.usuarioId
          ? { ...registro.datosNuevos, usuarioId: registro.usuarioId }
          : registro.datosNuevos) as Prisma.InputJsonValue,
      },
    });
  }
}

@Injectable()
export class EditarPresupuestoUoWPrismaAdapter
  implements UnidadDeTrabajoEditarPresupuestoPort
{
  constructor(private readonly prisma: PrismaService) {}

  async ejecutar(
    tenantId: string,
    trabajo: (repos: ReposEditarPresupuesto) => Promise<unknown>,
  ): Promise<unknown> {
    return this.prisma.$transaction(async (tx) => {
      // RLS: primera operación de la transacción (SET LOCAL app.tenant_id).
      await this.prisma.fijarTenant(tx, tenantId);
      const repos: ReposEditarPresupuesto = {
        presupuestos: new PresupuestoVersionPrismaRepository(tx),
        extras: new ExtrasPrismaRepository(tx),
        comunicaciones: new ComunicacionesPrismaRepository(tx),
        auditoria: new AuditoriaEdicionPrismaRepository(tx),
      };
      return trabajo(repos);
    });
  }
}

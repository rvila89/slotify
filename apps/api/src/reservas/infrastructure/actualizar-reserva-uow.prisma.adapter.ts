/**
 * Adaptador de la UNIDAD DE TRABAJO del update parcial de campos simples de la RESERVA
 * (US-051 §Punto 2 / UC-14). Implementa `UnidadDeTrabajoActualizarReservaPort`.
 *
 * Abre UN único `prisma.$transaction` bajo el contexto RLS del `tenantId` del Gestor
 * (`fijarTenant(tx, tenantId)` = `SET LOCAL app.tenant_id` como PRIMERA operación) y
 * expone los repositorios tx-bound. El UPDATE PARCIAL de los campos simples de la RESERVA
 * + el AUDIT_LOG (`accion='actualizar'`, `entidad='RESERVA'`) viven DENTRO de esa
 * transacción (all-or-nothing).
 *
 * REGLA DURA (§D-1): el `data` del UPDATE NUNCA incluye `fechaEvento`, `estado` ni
 * `subEstado`; el repo solo escribe columnas simples. No hay puerto de FECHA_BLOQUEADA.
 */
import { Injectable } from '@nestjs/common';
import { AccionAudit, Prisma } from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  ActualizarCamposReservaParams,
  ActualizarCamposReservaResultado,
  RegistroAuditoriaActualizarReserva,
  RepositoriosActualizarReserva,
  UnidadDeTrabajoActualizarReservaPort,
} from '../application/actualizar-reserva.use-case';
import {
  duracionHorasDominioAPrisma,
  tipoEventoDominioAPrisma,
} from './reserva-campos.mapper';

/**
 * Repositorio de RESERVA tx-bound: `UPDATE reserva SET <columnas simples presentes>=?
 * WHERE id=? AND tenant=?` bajo RLS. Solo las columnas PRESENTES viajan (PATCH parcial):
 * los ausentes NO se tocan. `duracionHoras` (número) y `tipoEvento` (cadena) se traducen a
 * sus enums Prisma. NUNCA escribe `fechaEvento`/`estado`/`subEstado` (regla dura §D-1).
 */
class ReservaCamposPrismaRepository {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async actualizarCampos(
    params: ActualizarCamposReservaParams,
  ): Promise<ActualizarCamposReservaResultado> {
    const c = params.campos;
    const data: Prisma.ReservaUpdateManyMutationInput = {};
    if (c.tipoEvento !== undefined) data.tipoEvento = tipoEventoDominioAPrisma(c.tipoEvento);
    if (c.duracionHoras !== undefined) {
      data.duracionHoras = duracionHorasDominioAPrisma(c.duracionHoras);
    }
    if (c.numAdultosNinosMayores4 !== undefined) {
      data.numAdultosNinosMayores4 = c.numAdultosNinosMayores4;
    }
    if (c.numNinosMenores4 !== undefined) data.numNinosMenores4 = c.numNinosMenores4;
    if (c.numInvitadosFinal !== undefined) data.numInvitadosFinal = c.numInvitadosFinal;
    if (c.notas !== undefined) data.notas = c.notas;
    if (c.horario !== undefined) data.horario = c.horario;

    const { count } = await this.tx.reserva.updateMany({
      where: { idReserva: params.idReserva, tenantId: params.tenantId },
      data,
    });
    return { filasAfectadas: count };
  }
}

/**
 * Repositorio de AUDIT_LOG tx-bound: escribe DENTRO de la transacción (comparte el destino
 * del rollback). Origen Usuario (`usuario_id` poblado), `entidad='RESERVA'`.
 */
class AuditLogActualizarReservaPrismaRepository {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async registrar(registro: RegistroAuditoriaActualizarReserva): Promise<void> {
    const datosAnteriores = registro.datosAnteriores as
      | Prisma.InputJsonValue
      | undefined;
    const datosNuevos = registro.datosNuevos as Prisma.InputJsonValue | undefined;
    await this.tx.auditLog.create({
      data: {
        tenantId: registro.tenantId,
        usuarioId: registro.usuarioId ?? null,
        entidad: registro.entidad,
        entidadId: registro.entidadId,
        accion: registro.accion as AccionAudit,
        ...(datosAnteriores !== undefined ? { datosAnteriores } : {}),
        ...(datosNuevos !== undefined ? { datosNuevos } : {}),
      },
    });
  }
}

@Injectable()
export class ActualizarReservaUoWPrismaAdapter
  implements UnidadDeTrabajoActualizarReservaPort
{
  constructor(private readonly prisma: PrismaService) {}

  async ejecutar(
    tenantId: string,
    trabajo: (repos: RepositoriosActualizarReserva) => Promise<unknown>,
  ): Promise<unknown> {
    return this.prisma.$transaction(async (tx) => {
      await this.prisma.fijarTenant(tx, tenantId);
      const repos: RepositoriosActualizarReserva = {
        reservas: new ReservaCamposPrismaRepository(tx),
        auditoria: new AuditLogActualizarReservaPrismaRepository(tx),
      };
      return trabajo(repos);
    });
  }
}

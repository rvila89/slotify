/**
 * Adaptador Prisma del puerto `ComunicacionRepositoryPort` (US-045, design.md §4/§5).
 *
 * INFRAESTRUCTURA: persiste la trazabilidad en `COMUNICACION` fijando el contexto
 * RLS (`SET LOCAL app.tenant_id`) dentro de la transacción de escritura. La garantía
 * de idempotencia ante carreras es el ÍNDICE UNIQUE PARCIAL
 * `(reserva_id, codigo_email) WHERE reserva_id IS NOT NULL`: un `INSERT` que choca
 * recibe `P2002`, traducido a `ComunicacionDuplicadaError` (que el motor trata como
 * "ya existe" sin reenviar). No usa locks distribuidos: la exclusión la da el motor
 * PostgreSQL (guardrail atomic-date-lock).
 *
 * Nota de alcance: en este change el motor solo se cablea a un trigger real para E1,
 * que se persiste dentro de la unidad de trabajo del alta (repositorio de `reservas`
 * con su propio contexto RLS). Este adaptador queda disponible para el cableado de
 * los triggers E2–E8 (diferidos a sus US), donde cada trigger aporta el `tenant_id`.
 */
import { Injectable } from '@nestjs/common';
import {
  CodigoEmail as CodigoEmailPrisma,
  EstadoComunicacion as EstadoComunicacionPrisma,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import {
  ActualizarEstadoComunicacionParams,
  BuscarComunicacionParams,
  ComunicacionDuplicadaError,
  ComunicacionRegistrada,
  ComunicacionRepositoryPort,
  RegistrarComunicacionParams,
} from '../domain/comunicacion.repository.port';
import type { CodigoEmail, EstadoComunicacion } from '../domain/codigo-email';

/** Fila de COMUNICACION tal como la devuelve Prisma (campos relevantes). */
interface FilaComunicacion {
  idComunicacion: string;
  tenantId: string;
  reservaId: string | null;
  clienteId: string;
  codigoEmail: CodigoEmailPrisma;
  estado: EstadoComunicacionPrisma;
  destinatarioEmail: string;
  fechaEnvio: Date | null;
}

/** Cliente Prisma o cualquier extensión suya (p. ej. `PrismaService`). */
type ClientePrisma = Pick<PrismaClient, '$transaction' | 'comunicacion'>;

/** Proyección de columnas que el puerto necesita (literal para inferir tipos). */
const SELECCION = {
  idComunicacion: true,
  tenantId: true,
  reservaId: true,
  clienteId: true,
  codigoEmail: true,
  estado: true,
  destinatarioEmail: true,
  fechaEnvio: true,
} as const;

@Injectable()
export class ComunicacionRepositoryPrismaAdapter
  implements ComunicacionRepositoryPort
{
  constructor(private readonly prisma: ClientePrisma) {}

  async buscarPorReservaYCodigo(
    params: BuscarComunicacionParams,
  ): Promise<ComunicacionRegistrada | null> {
    // RLS: la búsqueda corre dentro de una transacción con `app.tenant_id` fijado,
    // igual que `crear` (multi-tenancy: el filtro por tenant lo aplica la policy).
    const fila = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${params.tenantId}, true)`;
      return tx.comunicacion.findFirst({
        where: {
          reservaId: params.reservaId,
          codigoEmail: params.codigoEmail as CodigoEmailPrisma,
        },
        select: SELECCION,
      });
    });
    return fila ? this.aRegistro(fila) : null;
  }

  async crear(
    params: RegistrarComunicacionParams,
  ): Promise<ComunicacionRegistrada> {
    try {
      const fila = await this.prisma.$transaction(async (tx) => {
        await tx.$executeRaw`SELECT set_config('app.tenant_id', ${params.tenantId}, true)`;
        return tx.comunicacion.create({
          data: {
            tenantId: params.tenantId,
            reservaId: params.reservaId,
            clienteId: params.clienteId,
            codigoEmail: params.codigoEmail as CodigoEmailPrisma,
            asunto: params.asunto,
            cuerpo: params.cuerpo,
            destinatarioEmail: params.destinatarioEmail,
            estado: params.estado as EstadoComunicacionPrisma,
            fechaEnvio: params.fechaEnvio,
            // US-028 D-4 / US-035 D-3A: los reenvíos manuales quedan FUERA del índice
            // UNIQUE parcial (`es_reenvio = true`), permitiendo múltiples filas del
            // mismo (reserva, código) como excepción auditada a la idempotencia.
            esReenvio: params.esReenvio ?? false,
          },
          select: SELECCION,
        });
      });
      return this.aRegistro(fila);
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ComunicacionDuplicadaError(
          params.reservaId,
          params.codigoEmail,
        );
      }
      throw error;
    }
  }

  async actualizarEstado(
    params: ActualizarEstadoComunicacionParams,
  ): Promise<ComunicacionRegistrada> {
    // RLS: la actualización de estado (post-commit del envío) corre dentro de una
    // transacción con `app.tenant_id` fijado, igual que `crear`.
    const fila = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${params.tenantId}, true)`;
      return tx.comunicacion.update({
        where: { idComunicacion: params.idComunicacion },
        data: {
          estado: params.estado as EstadoComunicacionPrisma,
          fechaEnvio: params.fechaEnvio,
        },
        select: SELECCION,
      });
    });
    return this.aRegistro(fila);
  }

  /** Normaliza la fila de Prisma a la proyección de dominio. */
  private aRegistro(fila: FilaComunicacion): ComunicacionRegistrada {
    return {
      idComunicacion: fila.idComunicacion,
      tenantId: fila.tenantId,
      reservaId: fila.reservaId,
      clienteId: fila.clienteId,
      codigoEmail: fila.codigoEmail as CodigoEmail,
      estado: fila.estado as EstadoComunicacion,
      destinatarioEmail: fila.destinatarioEmail,
      fechaEnvio: fila.fechaEnvio,
    };
  }
}

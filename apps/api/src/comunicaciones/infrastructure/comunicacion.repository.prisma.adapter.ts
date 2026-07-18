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
  ActualizarContenidoBorradorParams,
  ActualizarEstadoComunicacionParams,
  BuscarComunicacionParams,
  ComunicacionDuplicadaError,
  ComunicacionListItem,
  ComunicacionRegistrada,
  ComunicacionRepositoryPort,
  ListarPorReservaParams,
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
  fechaCreacion: Date;
  esReenvio: boolean;
}

/**
 * Fila de listado de la ficha (US-046 D-3): añade `clienteId`, `asunto`, `cuerpo`,
 * `fechaCreacion`, `esReenvio` a la proyección base.
 */
interface FilaComunicacionListado {
  idComunicacion: string;
  clienteId: string;
  codigoEmail: CodigoEmailPrisma;
  estado: EstadoComunicacionPrisma;
  asunto: string;
  cuerpo: string | null;
  destinatarioEmail: string;
  fechaCreacion: Date;
  fechaEnvio: Date | null;
  esReenvio: boolean;
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
  fechaCreacion: true,
  esReenvio: true,
} as const;

/** Proyección de listado enriquecida para la ficha (US-046 D-3). */
const SELECCION_LISTADO = {
  idComunicacion: true,
  clienteId: true,
  codigoEmail: true,
  estado: true,
  asunto: true,
  cuerpo: true,
  destinatarioEmail: true,
  fechaCreacion: true,
  fechaEnvio: true,
  esReenvio: true,
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

  /**
   * Actualiza SOLO `asunto` + `cuerpo` de una fila en `estado = 'borrador'`
   * (fix-borrador-e1-cuerpo-prerelleno). RLS: fija `app.tenant_id` y filtra por
   * `tenant_id` en el `WHERE` (defensa en profundidad, dev/test conecta como
   * superusuario `BYPASSRLS`). GUARDA de estado: el `updateMany` con
   * `estado: 'borrador'` NO toca filas `enviado`/`fallido` (idempotencia/seguridad); si
   * ninguna casa (fila ya no en borrador, o de otro tenant), no muta y relee la fila
   * actual. No cambia `estado` ni `fecha_envio`.
   */
  async actualizarContenidoBorrador(
    params: ActualizarContenidoBorradorParams,
  ): Promise<ComunicacionRegistrada> {
    const fila = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${params.tenantId}, true)`;
      await tx.comunicacion.updateMany({
        where: {
          idComunicacion: params.idComunicacion,
          tenantId: params.tenantId,
          estado: 'borrador' as EstadoComunicacionPrisma,
        },
        data: { asunto: params.asunto, cuerpo: params.cuerpo },
      });
      return tx.comunicacion.findFirstOrThrow({
        where: { idComunicacion: params.idComunicacion, tenantId: params.tenantId },
        select: SELECCION,
      });
    });
    return this.aRegistro(fila);
  }

  /**
   * Lista TODAS las `COMUNICACION` de una RESERVA (sección "Comunicaciones" de la ficha,
   * US-046 D-3), scoped por el tenant del JWT: además de fijar `app.tenant_id` para las
   * policies RLS, filtra EXPLÍCITAMENTE por `tenant_id` en el `WHERE` (defensa en
   * profundidad, igual que los adaptadores `cargar-comunicacion`/`cargar-reserva-contexto`
   * de US-046). Esto garantiza el aislamiento del listado aunque el rol de BD no fuerce
   * RLS (en dev/test la app conecta como superusuario `BYPASSRLS`), evitando fugas
   * cross-tenant en una superficie de LECTURA. Ordena por `fecha_creacion` descendente y
   * deriva `accionable = estado === 'borrador'`.
   */
  async listarPorReserva(
    params: ListarPorReservaParams,
  ): Promise<ComunicacionListItem[]> {
    const filas = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT set_config('app.tenant_id', ${params.tenantId}, true)`;
      return tx.comunicacion.findMany({
        where: { reservaId: params.reservaId, tenantId: params.tenantId },
        orderBy: { fechaCreacion: 'desc' },
        select: SELECCION_LISTADO,
      });
    });
    return filas.map((fila) => this.aListItem(fila));
  }

  /** Normaliza una fila de listado a la proyección de la ficha (`ComunicacionListItem`). */
  private aListItem(fila: FilaComunicacionListado): ComunicacionListItem {
    const estado = fila.estado as EstadoComunicacion;
    return {
      idComunicacion: fila.idComunicacion,
      clienteId: fila.clienteId,
      codigoEmail: fila.codigoEmail as CodigoEmail,
      estado,
      asunto: fila.asunto,
      cuerpo: fila.cuerpo,
      destinatarioEmail: fila.destinatarioEmail,
      fechaCreacion: fila.fechaCreacion,
      fechaEnvio: fila.fechaEnvio,
      esReenvio: fila.esReenvio,
      accionable: estado === 'borrador',
    };
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
      fechaCreacion: fila.fechaCreacion,
      esReenvio: fila.esReenvio,
    };
  }
}

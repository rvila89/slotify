/**
 * Adaptador de la UNIDAD DE TRABAJO transaccional del alta de consulta
 * (US-003 / UC-03).
 *
 * Implementa `UnidadDeTrabajoPort`: abre UN único `prisma.$transaction`, fija el
 * contexto RLS con `fijarTenant(tx, tenantId)` (`SET LOCAL app.tenant_id`) como
 * PRIMERA operación, y expone los repositorios LIGADOS a esa transacción. Si el
 * `trabajo` rechaza, la transacción revierte por completo (all-or-nothing). El
 * envío de email (efecto post-commit) vive FUERA de aquí, en el caso de uso.
 *
 * Las clases de repositorio son tx-bound (se construyen con el cliente
 * transaccional): no son providers de Nest, viven y mueren con la transacción.
 */
import { Injectable } from '@nestjs/common';
import {
  AccionAudit,
  CanalEntrada,
  CodigoEmail,
  DuracionHoras,
  EstadoComunicacion,
  EstadoReserva,
  Prisma,
  SubEstadoConsulta,
  TipoEvento,
} from '@prisma/client';
import { PrismaService } from '../../shared/prisma/prisma.service';
import type {
  AuditLogPort,
  RegistroAuditoria,
} from '../../shared/audit/audit-log.port';
import type {
  BuscarClienteParams,
  ClienteParaAlta,
  ClienteRepositoryPort,
  ComunicacionParaAlta,
  ComunicacionRepositoryPort,
  CrearClienteParams,
  CrearComunicacionParams,
  CrearReservaParams,
  RepositoriosAltaConsulta,
  ReservaParaAlta,
  ReservaRepositoryPort,
  UnidadDeTrabajoPort,
} from '../application/alta-consulta.use-case';
import { subEstadoDominioAPrisma } from './sub-estado-consulta.mapper';

/** Traduce el nº de horas de dominio al literal del enum Prisma (`h4`/`h8`/`h12`). */
const duracionHorasAPrisma = (horas: number): DuracionHoras => {
  switch (horas) {
    case 4:
      return DuracionHoras.h4;
    case 8:
      return DuracionHoras.h8;
    case 12:
      return DuracionHoras.h12;
    default:
      throw new Error(`Duración de horas no soportada: ${horas}`);
  }
};

/** Repositorio de CLIENTE ligado a la transacción (find-or-create por email). */
class ClienteAltaPrismaRepository implements ClienteRepositoryPort {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async buscarPorEmail({
    tenantId,
    email,
  }: BuscarClienteParams): Promise<ClienteParaAlta | null> {
    const fila = await this.tx.cliente.findFirst({ where: { tenantId, email } });
    return fila
      ? {
          idCliente: fila.idCliente,
          tenantId: fila.tenantId,
          nombre: fila.nombre,
          apellidos: fila.apellidos ?? '',
          email: fila.email ?? email,
          telefono: fila.telefono ?? '',
        }
      : null;
  }

  async crear(p: CrearClienteParams): Promise<ClienteParaAlta> {
    const fila = await this.tx.cliente.create({
      data: {
        tenantId: p.tenantId,
        nombre: p.nombre,
        apellidos: p.apellidos,
        email: p.email,
        telefono: p.telefono,
      },
    });
    return {
      idCliente: fila.idCliente,
      tenantId: fila.tenantId,
      nombre: fila.nombre,
      apellidos: fila.apellidos ?? p.apellidos,
      email: fila.email ?? p.email,
      telefono: fila.telefono ?? p.telefono,
    };
  }
}

/** Repositorio de RESERVA ligado a la transacción (entrada inicial consulta/2a). */
class ReservaAltaPrismaRepository implements ReservaRepositoryPort {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async crear(p: CrearReservaParams): Promise<ReservaParaAlta> {
    const codigo = await this.generarCodigo(p.tenantId);
    const fila = await this.tx.reserva.create({
      data: {
        tenantId: p.tenantId,
        clienteId: p.clienteId,
        codigo,
        estado: EstadoReserva.consulta,
        subEstado: subEstadoDominioAPrisma(p.subEstado) as SubEstadoConsulta,
        ttlExpiracion: p.ttlExpiracion,
        canalEntrada: p.canalEntrada as CanalEntrada,
        ...(p.tipoEvento !== undefined
          ? { tipoEvento: p.tipoEvento as TipoEvento }
          : {}),
        ...(p.duracionHoras !== undefined
          ? { duracionHoras: duracionHorasAPrisma(p.duracionHoras) }
          : {}),
        ...(p.numAdultosNinosMayores4 !== undefined
          ? { numAdultosNinosMayores4: p.numAdultosNinosMayores4 }
          : {}),
        ...(p.numNinosMenores4 !== undefined
          ? { numNinosMenores4: p.numNinosMenores4 }
          : {}),
        ...(p.notas !== undefined ? { notas: p.notas } : {}),
      },
    });
    return {
      idReserva: fila.idReserva,
      tenantId: fila.tenantId,
      clienteId: fila.clienteId,
      codigo: fila.codigo,
      estado: 'consulta',
      subEstado: '2a',
      ttlExpiracion: null,
      canalEntrada: p.canalEntrada,
    };
  }

  /**
   * Genera un código de RESERVA `YY-NNNN` correlativo por tenant a partir del
   * `count(*)` del tenant dentro de la MISMA transacción. Este cálculo NO es
   * atómico por sí solo (dos altas concurrentes pueden leer el mismo `count`), por
   * lo que la unicidad real la garantiza —al estilo del proyecto, sin locks
   * distribuidos— el índice `reserva_codigo_key`: el segundo `INSERT` en colisión
   * recibe `P2002`. La carrera se resuelve con el retry-on-conflict de
   * `UnidadDeTrabajoPrismaAdapter.ejecutar`, que REABRE la `$transaction` (en
   * PostgreSQL una `P2002` aborta la transacción en curso) y reintenta: al re-leer
   * el `count` ya con el ganador confirmado, obtiene el siguiente correlativo. El
   * UNIQUE permanece como red de seguridad final (si se agotan los reintentos,
   * `P2002` → HTTP 409 vía el filtro global).
   */
  private async generarCodigo(tenantId: string): Promise<string> {
    const anio = new Date().getFullYear();
    const prefijo = String(anio).slice(-2);
    const total = await this.tx.reserva.count({ where: { tenantId } });
    return `${prefijo}-${String(total + 1).padStart(4, '0')}`;
  }
}

/** Repositorio de COMUNICACION ligado a la transacción (E1). */
class ComunicacionAltaPrismaRepository implements ComunicacionRepositoryPort {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async crear(p: CrearComunicacionParams): Promise<ComunicacionParaAlta> {
    const fila = await this.tx.comunicacion.create({
      data: {
        tenantId: p.tenantId,
        reservaId: p.reservaId,
        clienteId: p.clienteId,
        codigoEmail: CodigoEmail.E1,
        asunto: p.asunto,
        cuerpo: p.cuerpo,
        destinatarioEmail: p.destinatarioEmail,
        estado:
          p.estado === 'enviado'
            ? EstadoComunicacion.enviado
            : EstadoComunicacion.borrador,
        fechaEnvio: p.fechaEnvio,
      },
    });
    return {
      idComunicacion: fila.idComunicacion,
      tenantId: fila.tenantId,
      reservaId: fila.reservaId ?? p.reservaId,
      clienteId: fila.clienteId,
      codigoEmail: 'E1',
      estado: p.estado,
      destinatarioEmail: fila.destinatarioEmail,
      fechaEnvio: fila.fechaEnvio,
    };
  }
}

/**
 * Repositorio de AUDIT_LOG ligado a la transacción del alta. A diferencia del
 * adaptador compartido (que abre su propia transacción), este escribe DENTRO de la
 * transacción del alta para que la auditoría comparta el destino del rollback.
 */
class AuditLogAltaPrismaRepository implements AuditLogPort {
  constructor(private readonly tx: Prisma.TransactionClient) {}

  async registrar(registro: RegistroAuditoria): Promise<void> {
    const datosNuevos = registro.datosNuevos as Prisma.InputJsonValue | undefined;
    await this.tx.auditLog.create({
      data: {
        tenantId: registro.tenantId,
        usuarioId: registro.usuarioId ?? null,
        entidad: registro.entidad ?? 'Sistema',
        entidadId: registro.entidadId ?? registro.usuarioId ?? '-',
        accion: registro.accion as AccionAudit,
        ...(datosNuevos !== undefined ? { datosNuevos } : {}),
      },
    });
  }
}

/**
 * Nº máximo de intentos de la `$transaction` ante colisión del `codigo`
 * correlativo (`P2002` sobre `reserva_codigo_key`). El primer reintento ya basta
 * en el caso normal (dos altas simultáneas); se deja margen por si concurren más.
 */
const MAX_INTENTOS_CODIGO = 3;

/** ¿El error es una colisión del UNIQUE del `codigo` de RESERVA (P2002)? */
const esColisionCodigo = (error: unknown): boolean => {
  if (
    !(error instanceof Prisma.PrismaClientKnownRequestError) ||
    error.code !== 'P2002'
  ) {
    return false;
  }
  const target = error.meta?.target;
  const texto = Array.isArray(target) ? target.join(',') : String(target ?? '');
  return texto.toLowerCase().includes('codigo');
};

@Injectable()
export class UnidadDeTrabajoPrismaAdapter implements UnidadDeTrabajoPort {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Abre la `$transaction` (con RLS) y ejecuta el `trabajo`. Si el commit choca
   * con el UNIQUE del `codigo` (carrera de dos altas con el mismo correlativo),
   * REABRE una transacción nueva y reintenta hasta `MAX_INTENTOS_CODIGO`: en
   * PostgreSQL la `P2002` aborta la transacción en curso, así que no se puede
   * continuar la abortada, hay que reabrirla. Cualquier otro error (o el `P2002`
   * tras agotar los reintentos) se propaga al filtro global.
   */
  async ejecutar(
    tenantId: string,
    trabajo: (repos: RepositoriosAltaConsulta) => Promise<unknown>,
  ): Promise<unknown> {
    let ultimoError: unknown;
    for (let intento = 1; intento <= MAX_INTENTOS_CODIGO; intento += 1) {
      try {
        return await this.ejecutarTransaccion(tenantId, trabajo);
      } catch (error) {
        if (esColisionCodigo(error) && intento < MAX_INTENTOS_CODIGO) {
          ultimoError = error;
          continue;
        }
        throw error;
      }
    }
    throw ultimoError;
  }

  private async ejecutarTransaccion(
    tenantId: string,
    trabajo: (repos: RepositoriosAltaConsulta) => Promise<unknown>,
  ): Promise<unknown> {
    return this.prisma.$transaction(async (tx) => {
      // RLS: primera operación de la transacción (SET LOCAL app.tenant_id).
      await this.prisma.fijarTenant(tx, tenantId);
      const repos: RepositoriosAltaConsulta = {
        clientes: new ClienteAltaPrismaRepository(tx),
        reservas: new ReservaAltaPrismaRepository(tx),
        comunicaciones: new ComunicacionAltaPrismaRepository(tx),
        auditoria: new AuditLogAltaPrismaRepository(tx),
      };
      return trabajo(repos);
    });
  }
}

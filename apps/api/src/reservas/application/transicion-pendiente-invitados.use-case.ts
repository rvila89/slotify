/**
 * Caso de uso de APLICACIÓN: transición de una consulta con fecha bloqueada (`2.b`)
 * a "pendiente de número de invitados" (`2.c`) (US-007 / UC-06).
 *
 * El agregado RESERVA YA existe en `consulta/2b` con una FECHA_BLOQUEADA blanda
 * vigente. La operación, en una ÚNICA transacción (all-or-nothing), ejecuta las
 * CUATRO operaciones de §D-4/§D-5:
 *   1. UPDATE RESERVA `2b → 2c` + nuevo `ttl_expiracion` (= ttl actual + delta).
 *   2. UPDATE FECHA_BLOQUEADA: `ttl_expiracion` al MISMO nuevo valor (no inserta).
 *   3. Vaciado de cola A16: UPDATE masivo `2d → 2y` (terminal) con `posicion_cola`
 *      y `consulta_bloqueante_id` a NULL para todas las RESERVA que apuntan a esta.
 *   4. AUDIT_LOG `accion='transicion'` de la principal (`2b→2c`) y una por descartada.
 *
 * Reutiliza la primitiva atómica de US-040 (`resolverPlanBloqueo({ fase: '2.c' })
 * → extend` + `extenderTtl`, base = ttl ACTUAL, nunca `now()`; el delta sale del
 * setting del tenant, jamás hardcodeado) y la máquina de estados declarativa
 * (`esOrigenValidoParaPendienteInvitados`). La serialización por `SELECT … FOR
 * UPDATE` sobre la fila bloqueante vive en el adaptador de la UoW (PostgreSQL, sin
 * locks distribuidos).
 *
 * D-7: NINGÚN email. Las dependencias NO exponen puerto de email/comunicación: la
 * mecánica de la transición es completa sin enviar correos fuera del catálogo E1–E8.
 *
 * Hexagonal: depende SOLO de puertos inyectados; no importa Prisma ni `@nestjs/*`.
 * Las validaciones de existencia (404), guarda de origen (422) y precondición de
 * bloqueo vigente (409) se evalúan DENTRO de la transacción ANTES de cualquier
 * mutación; cualquier rechazo lanza un error que la UoW propaga (rollback total).
 */
import type {
  AuditLogPort,
  RegistroAuditoria,
} from '../../shared/audit/audit-log.port';
import {
  extenderTtl,
  resolverPlanBloqueo,
  ValidacionBloqueoError,
  type ClockPort,
  type TenantSettingsPort,
} from '../domain/bloquear-fecha.service';
import {
  esOrigenValidoParaPendienteInvitados,
  type EstadoReserva,
  type SubEstadoConsulta,
} from '../domain/maquina-estados';

export type { ClockPort };

// ---------------------------------------------------------------------------
// Tipos del comando / resultado
// ---------------------------------------------------------------------------

/** Comando de entrada de la transición «pendiente de invitados». */
export interface TransicionPendienteInvitadosComando {
  /** Tenant del gestor (del JWT, nunca del body/path). */
  tenantId: string;
  /** Identificador del gestor que ejecuta la transición (para auditoría). */
  usuarioId: string;
  /** RESERVA destino de la transición (debe existir y estar en `2.b`). */
  reservaId: string;
}

/** Proyección de la RESERVA relevante para la transición (origen y resultado). */
export interface ReservaPendienteInvitados {
  idReserva: string;
  tenantId: string;
  clienteId: string;
  estado: EstadoReserva;
  subEstado: SubEstadoConsulta | null;
  ttlExpiracion: Date | null;
  fechaEvento: Date | null;
  posicionCola: number | null;
  consultaBloqueanteId: string | null;
}

/** Fila activa de `FECHA_BLOQUEADA` de la RESERVA, leída dentro de la transacción. */
export interface BloqueoVigente {
  idBloqueo: string;
  ttlExpiracion: Date | null;
}

/** Resultado: la RESERVA en `2.c` + recuento de consultas de cola descartadas. */
export interface TransicionPendienteInvitadosResultado {
  reserva: ReservaPendienteInvitados;
  consultasDescartadas: number;
}

// ---------------------------------------------------------------------------
// Puertos (interfaces) — implementados en infraestructura (adaptadores Prisma)
// ---------------------------------------------------------------------------

/** Parámetros del UPDATE de la RESERVA dentro de la transición a `2.c`. */
export interface ActualizarReservaPendienteInvitadosParams {
  idReserva: string;
  subEstado: SubEstadoConsulta;
  ttlExpiracion: Date | null;
}

/** Repositorio de RESERVA tx-bound: lee el origen y aplica el UPDATE `2b→2c`. */
export interface ReservaPendienteInvitadosRepositoryPort {
  /** Lee la RESERVA por id bajo el contexto RLS del tenant; `null` si no existe. */
  buscarPorId(params: {
    tenantId: string;
    reservaId: string;
  }): Promise<ReservaPendienteInvitados | null>;
  /** Aplica el UPDATE a `2.c` + nuevo TTL y devuelve la RESERVA actualizada. */
  actualizar(
    params: ActualizarReservaPendienteInvitadosParams,
  ): Promise<ReservaPendienteInvitados>;
}

/**
 * Repositorio tx-bound de FECHA_BLOQUEADA para la transición. `leerBloqueoVigente`
 * toma `SELECT … FOR UPDATE` sobre la fila bloqueante (punto de serialización);
 * `extenderTtl` UPDATEa su `ttl_expiracion` al nuevo valor (no inserta: ya existe).
 */
export interface FechaBloqueadaPendienteInvitadosRepositoryPort {
  /** Lee (y bloquea con FOR UPDATE) la fila activa de la RESERVA; `null` si no hay. */
  leerBloqueoVigente(params: {
    tenantId: string;
    fecha: Date;
    reservaId: string;
  }): Promise<BloqueoVigente | null>;
  /** UPDATE del `ttl_expiracion` de la fila bloqueante al nuevo valor. */
  extenderTtl(params: {
    tenantId: string;
    fecha: Date;
    reservaId: string;
    ttlExpiracion: Date;
  }): Promise<void>;
}

/** Repositorio tx-bound del vaciado de cola (A16): `2.d → 2.y` masivo. */
export interface ColaPendienteInvitadosRepositoryPort {
  /**
   * UPDATE masivo de todas las RESERVA `2.d` con `consulta_bloqueante_id = ` el id
   * de la bloqueante: pasan a `2.y` (terminal) con `posicion_cola=NULL` y
   * `consulta_bloqueante_id=NULL`. Devuelve los ids descartados (para la auditoría).
   */
  vaciarCola(params: {
    tenantId: string;
    consultaBloqueanteId: string;
  }): Promise<ReadonlyArray<string>>;
}

/** Conjunto de repositorios disponibles dentro de la unidad de trabajo. */
export interface RepositoriosPendienteInvitados {
  reservas: ReservaPendienteInvitadosRepositoryPort;
  fechaBloqueada: FechaBloqueadaPendienteInvitadosRepositoryPort;
  cola: ColaPendienteInvitadosRepositoryPort;
  auditoria: AuditLogPort;
}

/**
 * Unidad de trabajo transaccional. El adaptador envuelve `$transaction` +
 * `fijarTenant(tenantId)` (RLS) y expone los repositorios ligados a esa transacción.
 * Si el `trabajo` rechaza, la transacción revierte por completo (all-or-nothing).
 */
export interface UnidadDeTrabajoPendienteInvitadosPort {
  ejecutar(
    tenantId: string,
    trabajo: (repos: RepositoriosPendienteInvitados) => Promise<unknown>,
  ): Promise<unknown>;
}

/** Dependencias del caso de uso (puertos inyectados). SIN puerto de email (D-7). */
export interface TransicionPendienteInvitadosDeps {
  unidadDeTrabajo: UnidadDeTrabajoPendienteInvitadosPort;
  clock: ClockPort;
  /** Settings del tenant para el delta del TTL (ttl_consulta_dias, nunca hardcodeado). */
  tenantSettings: TenantSettingsPort;
}

// ---------------------------------------------------------------------------
// Errores de dominio tipados, en español
// ---------------------------------------------------------------------------

/**
 * La RESERVA no está en `2.b` (guarda de origen) o es un estado terminal inmutable:
 * se rechaza SIN tocar la BD. Mapea a HTTP 422.
 */
export class TransicionPendienteInvitadosValidacionError extends Error {
  readonly codigo = 'TRANSICION_PENDIENTE_INVITADOS_VALIDACION' as const;

  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'TransicionPendienteInvitadosValidacionError';
  }
}

/**
 * La RESERVA no tiene una fila activa en `FECHA_BLOQUEADA`, o su `ttl_expiracion <
 * ahora` (bloqueo expirado): la transición a `2.c` exige bloqueo vigente. Mapea a
 * HTTP 409 con `{ motivo }`.
 */
export class BloqueoNoVigenteError extends Error {
  readonly codigo = 'BLOQUEO_NO_VIGENTE' as const;
  readonly motivo: string;

  constructor(motivo: string) {
    super(motivo);
    this.name = 'BloqueoNoVigenteError';
    this.motivo = motivo;
  }
}

/** La RESERVA no existe para el tenant (RLS): cross-tenant es invisible → 404. */
export class ReservaNoEncontradaError extends Error {
  readonly codigo = 'RESERVA_NO_ENCONTRADA' as const;
  readonly reservaId: string;

  constructor(reservaId: string) {
    super('La reserva no existe para el tenant');
    this.name = 'ReservaNoEncontradaError';
    this.reservaId = reservaId;
  }
}

const MOTIVO_SIN_BLOQUEO =
  'La transición a 2.c requiere una fecha bloqueada activa para la reserva';
const MOTIVO_BLOQUEO_EXPIRADO =
  'El bloqueo de la fecha ha expirado; la transición a 2.c no es posible';

// ---------------------------------------------------------------------------
// Caso de uso
// ---------------------------------------------------------------------------

export class TransicionPendienteInvitadosUseCase {
  constructor(private readonly deps: TransicionPendienteInvitadosDeps) {}

  async ejecutar(
    comando: TransicionPendienteInvitadosComando,
  ): Promise<TransicionPendienteInvitadosResultado> {
    const ahora = this.deps.clock.ahora();

    // Toda la lectura/escritura, dentro de UNA unidad de trabajo (tx + RLS). Las
    // validaciones (404 / 422 / 409) van DENTRO, ANTES de cualquier mutación: un
    // rechazo lanza y la UoW revierte sin efectos.
    return (await this.deps.unidadDeTrabajo.ejecutar(
      comando.tenantId,
      async (repos): Promise<TransicionPendienteInvitadosResultado> => {
        // 404 — existencia (RLS: cross-tenant → null). Esta primera lectura aporta la
        // `fecha_evento` necesaria para localizar la fila bloqueante.
        const reserva = await repos.reservas.buscarPorId({
          tenantId: comando.tenantId,
          reservaId: comando.reservaId,
        });
        if (reserva === null) {
          throw new ReservaNoEncontradaError(comando.reservaId);
        }

        // La fecha del evento es obligatoria para localizar la fila bloqueante.
        if (reserva.fechaEvento === null) {
          throw new BloqueoNoVigenteError(MOTIVO_SIN_BLOQUEO);
        }

        // 409 — precondición de bloqueo vigente. `leerBloqueoVigente` toma el lock
        // `SELECT … FOR UPDATE` sobre la fila bloqueante: ES EL PUNTO DE
        // SERIALIZACIÓN (§D-5). Cualquier otra transición/operación sobre la misma
        // fecha espera aquí, de modo que el chequeo de la guarda y las mutaciones
        // operan sobre un estado coherente y exactamente-una transición se aplica.
        const bloqueo = await repos.fechaBloqueada.leerBloqueoVigente({
          tenantId: comando.tenantId,
          fecha: reserva.fechaEvento,
          reservaId: reserva.idReserva,
        });
        if (bloqueo === null) {
          throw new BloqueoNoVigenteError(MOTIVO_SIN_BLOQUEO);
        }
        if (bloqueo.ttlExpiracion === null || bloqueo.ttlExpiracion.getTime() < ahora.getTime()) {
          throw new BloqueoNoVigenteError(MOTIVO_BLOQUEO_EXPIRADO);
        }

        // RE-LECTURA bajo el lock: la guarda de origen se evalúa sobre el sub-estado
        // ya serializado por el `FOR UPDATE`. Una segunda transición concurrente, al
        // adquirir el lock liberado por la primera, observa `2c` (no `2b`) y cae en
        // la guarda (422), sin doble extensión de TTL ni doble vaciado de cola (D13).
        const reservaBloqueada = await repos.reservas.buscarPorId({
          tenantId: comando.tenantId,
          reservaId: comando.reservaId,
        });
        if (reservaBloqueada === null) {
          throw new ReservaNoEncontradaError(comando.reservaId);
        }

        // 422 — guarda de origen declarativa: solo `consulta/2b` (§D-3).
        if (
          !esOrigenValidoParaPendienteInvitados(
            reservaBloqueada.estado,
            reservaBloqueada.subEstado,
          )
        ) {
          throw new TransicionPendienteInvitadosValidacionError(
            'La transición a 2.c (pendiente de invitados) solo es válida desde el sub-estado 2b',
          );
        }

        // Delta del TTL desde TENANT_SETTINGS, resuelto SOLO una vez superadas las
        // guardas (404/409/422): así un cross-tenant (RLS → 404) o un origen inválido
        // (422) no se enmascaran tras un error de settings. Single source of truth.
        const deltaDias = await this.resolverDeltaDias(comando.tenantId, ahora);

        // Nuevo TTL = ttl ACTUAL de la RESERVA + delta del setting (no now()+delta).
        const baseTtl = reservaBloqueada.ttlExpiracion ?? bloqueo.ttlExpiracion;
        const nuevoTtl = extenderTtl(baseTtl, deltaDias);

        // (1) UPDATE RESERVA 2b→2c + nuevo TTL.
        const actualizada = await repos.reservas.actualizar({
          idReserva: reserva.idReserva,
          subEstado: '2c',
          ttlExpiracion: nuevoTtl,
        });

        // (2) UPDATE FECHA_BLOQUEADA al MISMO nuevo TTL (coherencia §D-4).
        await repos.fechaBloqueada.extenderTtl({
          tenantId: comando.tenantId,
          fecha: reserva.fechaEvento,
          reservaId: reserva.idReserva,
          ttlExpiracion: nuevoTtl,
        });

        // (3) Vaciado de cola A16: 2.d → 2.y (terminal). Cola vacía → 0 filas.
        const descartadas = await repos.cola.vaciarCola({
          tenantId: comando.tenantId,
          consultaBloqueanteId: reserva.idReserva,
        });

        // (4) AUDIT_LOG: principal (2b→2c) + una por cada descartada (2d→2y).
        await repos.auditoria.registrar(
          this.registroPrincipal(comando, reserva, nuevoTtl),
        );
        for (const idDescartada of descartadas) {
          await repos.auditoria.registrar(
            this.registroDescartada(comando, idDescartada),
          );
        }

        return {
          reserva: actualizada,
          consultasDescartadas: descartadas.length,
        };
      },
    )) as TransicionPendienteInvitadosResultado;
  }

  /**
   * Resuelve el delta del TTL desde TENANT_SETTINGS (fase 2.c → extend). El TTL es
   * SIEMPRE el del setting del tenant: una sola fuente de verdad, nunca hardcode. Si
   * el tenant no tiene fila en TENANT_SETTINGS se rechaza (coherente con
   * `BloquearFechaService`: misconfiguración del tenant, no defecto silencioso). El
   * delta de la fase `2.c` es `settings.ttlConsultaDias` (ver `resolverPlanBloqueo`),
   * por lo que el plan resuelto SIEMPRE trae `ttlDeltaDias`.
   */
  private async resolverDeltaDias(tenantId: string, ahora: Date): Promise<number> {
    const settings = await this.deps.tenantSettings.obtener(tenantId);
    if (settings === null) {
      throw new ValidacionBloqueoError(
        `No hay TENANT_SETTINGS configurado para el tenant ${tenantId}`,
      );
    }
    const plan = resolverPlanBloqueo({ fase: '2.c', ahora, settings });
    if (plan.ttlDeltaDias === undefined) {
      throw new ValidacionBloqueoError(
        'El plan de bloqueo de la fase 2.c no resolvió un delta de TTL',
      );
    }
    return plan.ttlDeltaDias;
  }

  /** Registro de AUDIT_LOG `accion='transicion'` de la RESERVA principal (`2b→2c`). */
  private registroPrincipal(
    comando: TransicionPendienteInvitadosComando,
    reserva: ReservaPendienteInvitados,
    nuevoTtl: Date,
  ): RegistroAuditoria {
    return {
      tenantId: comando.tenantId,
      accion: 'transicion',
      entidad: 'RESERVA',
      entidadId: reserva.idReserva,
      usuarioId: comando.usuarioId,
      datosAnteriores: { subEstado: '2b' },
      datosNuevos: { subEstado: '2c', ttlExpiracion: nuevoTtl.toISOString() },
    };
  }

  /** Registro de AUDIT_LOG `accion='transicion'` de una consulta descartada (`2d→2y`). */
  private registroDescartada(
    comando: TransicionPendienteInvitadosComando,
    idDescartada: string,
  ): RegistroAuditoria {
    return {
      tenantId: comando.tenantId,
      accion: 'transicion',
      entidad: 'RESERVA',
      entidadId: idDescartada,
      usuarioId: comando.usuarioId,
      datosAnteriores: { subEstado: '2d' },
      datosNuevos: { subEstado: '2y' },
    };
  }
}

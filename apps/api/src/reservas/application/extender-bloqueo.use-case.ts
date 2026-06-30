/**
 * Caso de uso de APLICACIÓN: extensión manual del TTL del bloqueo blando ACTIVO de
 * una RESERVA existente (US-006 / UC-05).
 *
 * NO es una transición de la máquina de estados: es una PRÓRROGA PURA del TTL sobre
 * un bloqueo blando ya existente. En una ÚNICA transacción (all-or-nothing, §D-4):
 *   1. UPDATE `RESERVA.ttl_expiracion = ttl_expiracion_ACTUAL + N días` (NO `now()`),
 *      SIN tocar estado/sub_estado/fecha (§D-8).
 *   2. UPDATE `FECHA_BLOQUEADA.ttl_expiracion` al MISMO nuevo valor, SIN tocar
 *      tipo_bloqueo ni fecha (§D-8).
 *   3. INSERT `AUDIT_LOG` `accion='actualizar'` (`datos_anteriores/nuevos.ttlExpiracion`).
 *
 * Guardas (§D-1/§D-3):
 *   - 404 `ReservaNoEncontradaError` — la RESERVA no existe para el tenant (RLS).
 *   - 422 `ExtenderBloqueoValidacionError` — `dias` 0/negativo/no entero, o estado sin
 *     bloqueo activo extensible (`2a`/cola/terminales).
 *   - 409 `BloqueoNoExtensibleError` — `reserva_confirmada` (bloqueo FIRME, sin TTL),
 *     bloqueo firme, sin fila bloqueante blanda vigente, o TTL ya expirado.
 *
 * SERIALIZACIÓN (atomic-date-lock, §D-7): `leerBloqueoVigente` toma `SELECT … FOR
 * UPDATE` sobre la fila bloqueante de `FECHA_BLOQUEADA`; la base del nuevo TTL se
 * RE-LEE bajo ese lock para que dos extensiones simultáneas se serialicen sin
 * lost-update y para no resucitar un bloqueo ya expirado-y-procesado por el barrido
 * (US-012). La exclusión mutua vive SOLO en PostgreSQL; nada de Redis/locks distribuidos.
 *
 * Hexagonal: depende SOLO de puertos inyectados; no importa Prisma ni `@nestjs/*`.
 */
import type {
  AuditLogPort,
  RegistroAuditoria,
} from '../../shared/audit/audit-log.port';
import {
  esEstadoConBloqueoBlandoExtensible,
  type EstadoReserva,
  type SubEstadoConsulta,
} from '../domain/maquina-estados';

/** Puerto del reloj de dominio (vigencia del TTL frente a `ahora`). */
export interface ClockPort {
  ahora(): Date;
}

const DIA_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Tipos del comando / resultado
// ---------------------------------------------------------------------------

/** Comando de entrada de la extensión manual del TTL. */
export interface ExtenderBloqueoComando {
  /** Tenant del gestor (del JWT, nunca del body/path). */
  tenantId: string;
  /** Identificador del gestor que ejecuta la extensión (para auditoría). */
  usuarioId: string;
  /** RESERVA destino (debe existir y tener bloqueo blando vigente). */
  reservaId: string;
  /** Número ENTERO de días a añadir al `ttlExpiracion` ACTUAL (≥ 1). */
  dias: number;
}

/** Proyección de la RESERVA relevante para la extensión (origen y resultado). */
export interface ReservaExtenderBloqueo {
  idReserva: string;
  tenantId: string;
  clienteId: string;
  estado: EstadoReserva;
  subEstado: SubEstadoConsulta | null;
  ttlExpiracion: Date | null;
  fechaEvento: Date | null;
}

/** Fila activa de `FECHA_BLOQUEADA` de la RESERVA, leída (y bloqueada) en la tx. */
export interface BloqueoExtensible {
  idBloqueo: string;
  tipoBloqueo: 'blando' | 'firme';
  ttlExpiracion: Date | null;
}

/** Resultado: la RESERVA con el `ttlExpiracion` NUEVO (resto invariante). */
export interface ExtenderBloqueoResultado {
  reserva: ReservaExtenderBloqueo;
}

// ---------------------------------------------------------------------------
// Puertos (interfaces) — implementados en infraestructura (adaptadores Prisma)
// ---------------------------------------------------------------------------

/** Repositorio de RESERVA tx-bound: lee el origen y extiende SOLO el `ttl_expiracion`. */
export interface ReservaExtenderBloqueoRepositoryPort {
  buscarPorId(params: {
    tenantId: string;
    reservaId: string;
  }): Promise<ReservaExtenderBloqueo | null>;
  /** UPDATE SOLO de `ttl_expiracion` (no toca estado/subEstado); devuelve la RESERVA. */
  extenderTtl(params: {
    idReserva: string;
    ttlExpiracion: Date;
  }): Promise<ReservaExtenderBloqueo>;
}

/**
 * Repositorio tx-bound de FECHA_BLOQUEADA. `leerBloqueoVigente` toma `SELECT … FOR
 * UPDATE` sobre la fila bloqueante (punto de serialización); `extenderTtl` actualiza
 * SOLO el `ttl_expiracion` al nuevo valor (no toca tipo_bloqueo ni fecha).
 */
export interface FechaBloqueadaExtenderBloqueoRepositoryPort {
  leerBloqueoVigente(params: {
    tenantId: string;
    fecha: Date;
    reservaId: string;
  }): Promise<BloqueoExtensible | null>;
  extenderTtl(params: {
    tenantId: string;
    fecha: Date;
    reservaId: string;
    ttlExpiracion: Date;
  }): Promise<void>;
}

/** Conjunto de repositorios disponibles dentro de la unidad de trabajo. */
export interface RepositoriosExtenderBloqueo {
  reservas: ReservaExtenderBloqueoRepositoryPort;
  fechaBloqueada: FechaBloqueadaExtenderBloqueoRepositoryPort;
  auditoria: AuditLogPort;
}

/**
 * Unidad de trabajo transaccional. El adaptador envuelve `$transaction` +
 * `fijarTenant(tenantId)` (RLS) y expone los repositorios ligados a esa transacción.
 * Si el `trabajo` rechaza, la transacción revierte por completo (all-or-nothing).
 */
export interface UnidadDeTrabajoExtenderBloqueoPort {
  ejecutar(
    tenantId: string,
    trabajo: (repos: RepositoriosExtenderBloqueo) => Promise<unknown>,
  ): Promise<unknown>;
}

/** Dependencias del caso de uso (puertos inyectados). SIN puerto de email (UC-05). */
export interface ExtenderBloqueoDeps {
  unidadDeTrabajo: UnidadDeTrabajoExtenderBloqueoPort;
  clock: ClockPort;
}

// ---------------------------------------------------------------------------
// Errores de dominio tipados, en español
// ---------------------------------------------------------------------------

/**
 * Estado sin bloqueo activo extensible (`2a`/terminal) o `dias` inválido
 * (0/negativo/no entero): se rechaza SIN tocar la BD. Mapea a HTTP 422.
 */
export class ExtenderBloqueoValidacionError extends Error {
  readonly codigo = 'EXTENDER_BLOQUEO_VALIDACION' as const;

  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ExtenderBloqueoValidacionError';
  }
}

/**
 * Conflicto con el estado del bloqueo en BD: TTL ya expirado, bloqueo firme
 * (`reserva_confirmada`, sin TTL) o sin fila bloqueante blanda vigente. La RESERVA no
 * se modifica. Mapea a HTTP 409 con `{ motivo }`.
 */
export class BloqueoNoExtensibleError extends Error {
  readonly codigo = 'BLOQUEO_NO_EXTENSIBLE' as const;
  readonly motivo: string;

  constructor(motivo: string) {
    super(motivo);
    this.name = 'BloqueoNoExtensibleError';
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

const MOTIVO_TTL_EXPIRADO =
  'El bloqueo de la fecha ha expirado y no puede extenderse.';
const MOTIVO_SIN_BLOQUEO =
  'La reserva no tiene un bloqueo blando vigente que extender.';
const MOTIVO_FIRME =
  'El bloqueo firme de una reserva confirmada no tiene TTL que extender.';
const MENSAJE_DIAS_INVALIDO =
  'El número de días de extensión debe ser un entero positivo (≥ 1)';
const MENSAJE_ESTADO_NO_EXTENSIBLE =
  'La reserva no se encuentra en un estado con bloqueo activo extensible (2b, 2c, 2v o pre_reserva)';

// ---------------------------------------------------------------------------
// Caso de uso
// ---------------------------------------------------------------------------

export class ExtenderBloqueoUseCase {
  constructor(private readonly deps: ExtenderBloqueoDeps) {}

  async ejecutar(comando: ExtenderBloqueoComando): Promise<ExtenderBloqueoResultado> {
    // Validación defensiva del cuerpo (422) ANTES de abrir la transacción: `dias`
    // debe ser un entero ≥ 1 (además de la del DTO `class-validator`).
    this.validarDias(comando.dias);

    const ahora = this.deps.clock.ahora();

    // Extensión ATÓMICA dentro de UNA unidad de trabajo (tx + RLS). Todas las guardas
    // van DENTRO, ANTES de cualquier mutación: un rechazo lanza y la UoW revierte sin
    // efectos (all-or-nothing). Cualquier error de las 3 operaciones se propaga.
    return (await this.deps.unidadDeTrabajo.ejecutar(
      comando.tenantId,
      async (repos): Promise<ExtenderBloqueoResultado> => {
        // 404 — existencia (RLS: cross-tenant → null).
        const reserva = await repos.reservas.buscarPorId({
          tenantId: comando.tenantId,
          reservaId: comando.reservaId,
        });
        if (reserva === null) {
          throw new ReservaNoEncontradaError(comando.reservaId);
        }

        // 409 — `reserva_confirmada`: bloqueo FIRME sin TTL (no hay TTL que extender).
        // Se distingue ANTES de la guarda de estado para devolver 409 (no 422).
        if (reserva.estado === 'reserva_confirmada') {
          throw new BloqueoNoExtensibleError(MOTIVO_FIRME);
        }

        // 422 — guarda de precondición declarativa: solo `consulta/{2b,2c,2v}` o
        // `pre_reserva` (§D-1). El resto (`2a`/cola/terminales) no tiene bloqueo activo.
        if (!esEstadoConBloqueoBlandoExtensible(reserva.estado, reserva.subEstado)) {
          throw new ExtenderBloqueoValidacionError(MENSAJE_ESTADO_NO_EXTENSIBLE);
        }

        // La fecha del evento es la fecha bloqueada (existe por la guarda de estado).
        const fechaEvento = reserva.fechaEvento as Date;

        // `SELECT … FOR UPDATE` sobre la fila bloqueante (punto de serialización
        // frente a otra extensión o al barrido de expiración US-012). `null` ≡ no hay
        // fila blanda vigente → 409 (no se resucita un bloqueo ya procesado).
        const bloqueo = await repos.fechaBloqueada.leerBloqueoVigente({
          tenantId: comando.tenantId,
          fecha: fechaEvento,
          reservaId: reserva.idReserva,
        });
        if (bloqueo === null) {
          throw new BloqueoNoExtensibleError(MOTIVO_SIN_BLOQUEO);
        }

        // 409 — bloqueo firme o sin TTL: no hay TTL que extender.
        if (bloqueo.tipoBloqueo === 'firme' || bloqueo.ttlExpiracion === null) {
          throw new BloqueoNoExtensibleError(MOTIVO_FIRME);
        }

        // RE-LECTURA de la RESERVA BAJO el lock: la base del nuevo TTL es el
        // `ttl_expiracion` ACTUAL ya serializado por el `FOR UPDATE`. Así dos
        // extensiones simultáneas suman sus deltas (T + N1 + N2) sin lost-update.
        const reservaBloqueada = await repos.reservas.buscarPorId({
          tenantId: comando.tenantId,
          reservaId: comando.reservaId,
        });
        if (reservaBloqueada === null) {
          throw new ReservaNoEncontradaError(comando.reservaId);
        }
        if (reservaBloqueada.estado === 'reserva_confirmada') {
          throw new BloqueoNoExtensibleError(MOTIVO_FIRME);
        }
        if (
          !esEstadoConBloqueoBlandoExtensible(
            reservaBloqueada.estado,
            reservaBloqueada.subEstado,
          )
        ) {
          throw new ExtenderBloqueoValidacionError(MENSAJE_ESTADO_NO_EXTENSIBLE);
        }

        // 409 — TTL ya expirado (`ttl_expiracion <= ahora` o null): el bloqueo ya
        // caducó; la extensión no puede "deshacer" una expiración (A4/A5, US-012).
        const ttlActual = reservaBloqueada.ttlExpiracion;
        if (ttlActual === null || ttlActual.getTime() <= ahora.getTime()) {
          throw new BloqueoNoExtensibleError(MOTIVO_TTL_EXPIRADO);
        }

        // Nuevo TTL = TTL ACTUAL + N días (base = TTL, NO now()).
        const nuevoTtl = new Date(ttlActual.getTime() + comando.dias * DIA_MS);

        // (1) UPDATE RESERVA: SOLO `ttl_expiracion` (invariancia de estado/subEstado).
        const actualizada = await repos.reservas.extenderTtl({
          idReserva: reserva.idReserva,
          ttlExpiracion: nuevoTtl,
        });

        // (2) UPDATE FECHA_BLOQUEADA: SOLO `ttl_expiracion` al MISMO nuevo valor
        // (invariancia de tipo_bloqueo/fecha).
        await repos.fechaBloqueada.extenderTtl({
          tenantId: comando.tenantId,
          fecha: fechaEvento,
          reservaId: reserva.idReserva,
          ttlExpiracion: nuevoTtl,
        });

        // (3) AUDIT_LOG `accion='actualizar'` con el TTL anterior y el nuevo.
        await repos.auditoria.registrar(
          this.registroActualizacion(comando, reserva.idReserva, ttlActual, nuevoTtl),
        );

        return { reserva: actualizada };
      },
    )) as ExtenderBloqueoResultado;
  }

  /**
   * Valida `dias` como entero ESTRICTAMENTE positivo (≥ 1): rechaza 0, negativos y
   * no enteros (incluido `NaN`) con `ExtenderBloqueoValidacionError` (422), sin tocar
   * la BD. Defensa en servidor además del `class-validator` del DTO.
   */
  private validarDias(dias: number): void {
    if (!Number.isInteger(dias) || dias < 1) {
      throw new ExtenderBloqueoValidacionError(MENSAJE_DIAS_INVALIDO);
    }
  }

  /** Construye el registro de AUDIT_LOG `accion='actualizar'` de la prórroga del TTL. */
  private registroActualizacion(
    comando: ExtenderBloqueoComando,
    reservaId: string,
    ttlAnterior: Date,
    ttlNuevo: Date,
  ): RegistroAuditoria {
    return {
      tenantId: comando.tenantId,
      accion: 'actualizar',
      entidad: 'RESERVA',
      entidadId: reservaId,
      usuarioId: comando.usuarioId,
      datosAnteriores: { ttlExpiracion: ttlAnterior.toISOString() },
      datosNuevos: { ttlExpiracion: ttlNuevo.toISOString() },
    };
  }
}

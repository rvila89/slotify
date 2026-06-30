/**
 * Caso de uso de APLICACIÓN: transición de una consulta ACTIVA (`2.a`/`2.b`/`2.c`)
 * a "visita programada" (`2.v`) (US-008 / UC-07).
 *
 * El agregado RESERVA YA existe en `consulta/{2a|2b|2c}`. La operación, en una ÚNICA
 * transacción (all-or-nothing, §D-4), ejecuta:
 *   1. UPDATE RESERVA → `2v` + `visita_programada_fecha/hora` + `visita_realizada=false`
 *      + `ttl_expiracion` = visita +1 día (23:59:59).
 *   2. INSERT-o-UPDATE (upsert) de FECHA_BLOQUEADA con ese mismo TTL (§D-2): `update`
 *      si la RESERVA ya tenía fila (origen `2.b`/`2.c`), `insert` si no la tenía
 *      (origen `2.a`); `tipo_bloqueo='blando'`.
 *   3. AUDIT_LOG `accion='transicion'` (`datos_anteriores.subEstado`,
 *      `datos_nuevos.subEstado='2v'`, `datos_nuevos.visitaProgramadaFecha`).
 * Tras el COMMIT (§D-6) se dispara E6 (confirmación de visita), POST-COMMIT y
 * TOLERANTE a fallo del proveedor: un fallo de email NO revierte la transición.
 *
 * Reutiliza la máquina de estados declarativa (`esOrigenValidoParaProgramarVisita`,
 * §D-1), la regla de fecha futura del proyecto (`esFechaEstrictamenteFutura`) y la
 * primitiva pura del TTL de visita (`ttlVisitaMasUnDia`, §D-2). La serialización por
 * `SELECT … FOR UPDATE` sobre la fila bloqueante (origen `2.b`/`2.c`) y el
 * `UNIQUE(tenant_id, fecha)` del INSERT (origen `2.a`) viven en el adaptador de la
 * UoW (PostgreSQL, sin locks distribuidos).
 *
 * Hexagonal: depende SOLO de puertos inyectados; no importa Prisma ni `@nestjs/*`.
 * Las validaciones (404 / 409 cola / 422 guarda+ventana) se evalúan DENTRO de la
 * transacción y, para la guarda, RE-LEÍDAS bajo el lock: dos transiciones
 * simultáneas → exactamente una aplica, la otra observa `2v` y cae en la guarda.
 */
import type {
  AuditLogPort,
  RegistroAuditoria,
} from '../../shared/audit/audit-log.port';
import {
  esFechaEstrictamenteFutura,
  ttlVisitaMasUnDia,
  type ClockPort,
  type TenantSettingsPort,
} from '../domain/bloquear-fecha.service';
import {
  esOrigenValidoParaProgramarVisita,
  type EstadoReserva,
  type SubEstadoConsulta,
} from '../domain/maquina-estados';

export type { ClockPort };

// ---------------------------------------------------------------------------
// Tipos del comando / resultado
// ---------------------------------------------------------------------------

/** Comando de entrada de la transición «programar visita». */
export interface ProgramarVisitaComando {
  /** Tenant del gestor (del JWT, nunca del body/path). */
  tenantId: string;
  /** Identificador del gestor que ejecuta la transición (para auditoría). */
  usuarioId: string;
  /** RESERVA destino (debe existir y estar en `2.a`/`2.b`/`2.c`). */
  reservaId: string;
  /** Fecha de la visita (DATE); debe caer en `[hoy+1, hoy+maxDiasProgramarVisita]`. */
  fechaVisita: Date;
  /** Hora de la visita (`HH:mm`). */
  horaVisita: string;
}

/** Proyección de la RESERVA relevante para la transición (origen y resultado). */
export interface ReservaProgramarVisita {
  idReserva: string;
  tenantId: string;
  clienteId: string;
  estado: EstadoReserva;
  subEstado: SubEstadoConsulta | null;
  ttlExpiracion: Date | null;
  fechaEvento: Date | null;
  visitaRealizada: boolean;
  visitaProgramadaFecha?: Date | null;
  visitaProgramadaHora?: string | null;
}

/** Fila activa de `FECHA_BLOQUEADA` de la RESERVA, leída (y bloqueada) en la tx. */
export interface BloqueoVisitaVigente {
  idBloqueo: string;
  ttlExpiracion: Date | null;
}

/** Resultado: la RESERVA en `2.v` con sus campos de visita. */
export interface ProgramarVisitaResultado {
  reserva: ReservaProgramarVisita;
}

// ---------------------------------------------------------------------------
// Puertos (interfaces) — implementados en infraestructura (adaptadores Prisma)
// ---------------------------------------------------------------------------

/** Parámetros del UPDATE de la RESERVA en la transición a `2.v`. */
export interface ActualizarReservaProgramarVisitaParams {
  idReserva: string;
  subEstado: SubEstadoConsulta;
  ttlExpiracion: Date | null;
  visitaProgramadaFecha: Date;
  visitaProgramadaHora: string;
  visitaRealizada: boolean;
}

/** Repositorio de RESERVA tx-bound: lee el origen y aplica el UPDATE a `2.v`. */
export interface ReservaProgramarVisitaRepositoryPort {
  /** Lee la RESERVA por id bajo el contexto RLS del tenant; `null` si no existe. */
  buscarPorId(params: {
    tenantId: string;
    reservaId: string;
  }): Promise<ReservaProgramarVisita | null>;
  /** Aplica el UPDATE a `2.v` + campos de visita y devuelve la RESERVA actualizada. */
  actualizar(
    params: ActualizarReservaProgramarVisitaParams,
  ): Promise<ReservaProgramarVisita>;
}

/** Acción del upsert de FECHA_BLOQUEADA derivada del origen (§D-2). */
export type AccionBloqueoVisita = 'insert' | 'update';

/** Parámetros del INSERT-o-UPDATE (upsert) de FECHA_BLOQUEADA (§D-2). */
export interface UpsertTtlBloqueoVisitaParams {
  tenantId: string;
  fecha: Date;
  reservaId: string;
  accion: AccionBloqueoVisita;
  tipoBloqueo: 'blando';
  ttlExpiracion: Date;
}

/**
 * Repositorio tx-bound de FECHA_BLOQUEADA para la transición a `2.v`.
 * `leerBloqueoVigente` toma `SELECT … FOR UPDATE` sobre la fila bloqueante (punto de
 * serialización si existe: origen `2.b`/`2.c`); `upsertTtl` inserta (origen `2.a`,
 * serializado por el `UNIQUE(tenant_id, fecha)`) o actualiza la fila existente.
 */
export interface FechaBloqueadaProgramarVisitaRepositoryPort {
  /** Lee (y bloquea con FOR UPDATE) la fila activa de la RESERVA; `null` si no hay. */
  leerBloqueoVigente(params: {
    tenantId: string;
    fecha: Date;
    reservaId: string;
  }): Promise<BloqueoVisitaVigente | null>;
  /** INSERT-o-UPDATE (upsert) del `ttl_expiracion` de la fila de la fecha. */
  upsertTtl(params: UpsertTtlBloqueoVisitaParams): Promise<void>;
}

/** Conjunto de repositorios disponibles dentro de la unidad de trabajo. */
export interface RepositoriosProgramarVisita {
  reservas: ReservaProgramarVisitaRepositoryPort;
  fechaBloqueada: FechaBloqueadaProgramarVisitaRepositoryPort;
  auditoria: AuditLogPort;
}

/**
 * Unidad de trabajo transaccional. El adaptador envuelve `$transaction` +
 * `fijarTenant(tenantId)` (RLS) y expone los repositorios ligados a esa transacción.
 * Si el `trabajo` rechaza, la transacción revierte por completo (all-or-nothing).
 */
export interface UnidadDeTrabajoProgramarVisitaPort {
  ejecutar(
    tenantId: string,
    trabajo: (repos: RepositoriosProgramarVisita) => Promise<unknown>,
  ): Promise<unknown>;
}

/** Parámetros del disparo POST-COMMIT del email E6 de confirmación de visita. */
export interface EnviarConfirmacionVisitaParams {
  tenantId: string;
  reservaId: string;
  clienteId: string;
  codigoEmail: 'E6';
}

/** Estado terminal alcanzado tras el intento de envío post-commit de E6. */
export interface EnviarConfirmacionVisitaResultado {
  estado: 'enviado' | 'fallido';
  fechaEnvio: Date | null;
}

/**
 * Puerto del email E6 (confirmación de visita) vía el motor de US-045. Se invoca
 * POST-COMMIT, fuera de la transacción (§D-6): el adaptador centraliza el try/catch
 * del proveedor y NUNCA propaga la excepción que tumbe la transición ya comprometida.
 */
export interface EnviarConfirmacionVisitaPort {
  enviar(
    params: EnviarConfirmacionVisitaParams,
  ): Promise<EnviarConfirmacionVisitaResultado>;
}

/** Settings del tenant con la ventana de programación de visita (US-008). */
export interface TenantSettingsProgramarVisita {
  ttlConsultaDias: number;
  ttlPrereservaDias: number;
  maxDiasProgramarVisita: number;
}

/** Puerto de settings (subconjunto necesario): expone `maxDiasProgramarVisita`. */
export type TenantSettingsProgramarVisitaPort = TenantSettingsPort;

/** Dependencias del caso de uso (puertos inyectados). */
export interface ProgramarVisitaDeps {
  unidadDeTrabajo: UnidadDeTrabajoProgramarVisitaPort;
  clock: ClockPort;
  /** Settings del tenant para la ventana de fecha (max_dias_programar_visita). */
  tenantSettings: TenantSettingsProgramarVisitaPort;
  /** Puerto del envío post-commit de E6 (confirmación de visita). */
  confirmacionVisita: EnviarConfirmacionVisitaPort;
}

// ---------------------------------------------------------------------------
// Errores de dominio tipados, en español
// ---------------------------------------------------------------------------

/**
 * La RESERVA no está en `2.a`/`2.b`/`2.c` (guarda de origen), o es `2.a` sin
 * `fecha_evento`, o la fecha de visita cae fuera de la ventana
 * `[hoy+1, hoy+max_dias_programar_visita]`: se rechaza SIN tocar la BD. Mapea a 422.
 */
export class ProgramarVisitaValidacionError extends Error {
  readonly codigo = 'PROGRAMAR_VISITA_VALIDACION' as const;

  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ProgramarVisitaValidacionError';
  }
}

/**
 * La RESERVA está en cola (`2.d`): no se puede programar una visita directamente;
 * la consulta debe promoverse primero (UC-12). Mapea a HTTP 409 con `{ motivo }`.
 */
export class VisitaEnColaError extends Error {
  readonly codigo = 'VISITA_EN_COLA' as const;
  readonly motivo: string;

  constructor(motivo: string) {
    super(motivo);
    this.name = 'VisitaEnColaError';
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

const MOTIVO_COLA =
  'No es posible programar una visita para una consulta en cola. La consulta debe ser promovida primero (UC-12).';

// ---------------------------------------------------------------------------
// Caso de uso
// ---------------------------------------------------------------------------

export class ProgramarVisitaUseCase {
  constructor(private readonly deps: ProgramarVisitaDeps) {}

  async ejecutar(
    comando: ProgramarVisitaComando,
  ): Promise<ProgramarVisitaResultado> {
    const ahora = this.deps.clock.ahora();

    // Transición ATÓMICA dentro de UNA unidad de trabajo (tx + RLS). Las validaciones
    // (404 / 409 cola / 422 guarda+ventana) van DENTRO, ANTES de cualquier mutación:
    // un rechazo lanza y la UoW revierte sin efectos.
    const resultado = (await this.deps.unidadDeTrabajo.ejecutar(
      comando.tenantId,
      async (repos): Promise<ProgramarVisitaResultado> => {
        // 404 — existencia (RLS: cross-tenant → null).
        const reserva = await repos.reservas.buscarPorId({
          tenantId: comando.tenantId,
          reservaId: comando.reservaId,
        });
        if (reserva === null) {
          throw new ReservaNoEncontradaError(comando.reservaId);
        }

        // 409 — cola `2.d`: promover primero (UC-12), antes de la guarda genérica.
        if (reserva.estado === 'consulta' && reserva.subEstado === '2d') {
          throw new VisitaEnColaError(MOTIVO_COLA);
        }

        // 422 — guarda de origen declarativa: solo `consulta/{2a,2b,2c}` (§D-1).
        if (!esOrigenValidoParaProgramarVisita(reserva.estado, reserva.subEstado)) {
          throw new ProgramarVisitaValidacionError(
            'La transición a 2.v (visita programada) solo es válida desde una consulta activa (sub-estados 2a, 2b o 2c)',
          );
        }

        // 422 — programar desde `2.a` exige `fecha_evento` definida (§D-1).
        if (reserva.subEstado === '2a' && reserva.fechaEvento === null) {
          throw new ProgramarVisitaValidacionError(
            'Para programar una visita desde una consulta exploratoria (2a) debe introducirse antes la fecha del evento',
          );
        }

        // 422 — ventana de la fecha de visita `[hoy+1, hoy+max_dias_programar_visita]`,
        // con el setting LEÍDO de TENANT_SETTINGS (nunca hardcodeado, §D-2).
        const maxDias = await this.resolverMaxDias(comando.tenantId);
        this.validarVentana(comando.fechaVisita, ahora, maxDias);

        // La fecha del evento es la que se bloquea (existe por guarda: 2b/2c siempre,
        // 2a la exige el chequeo previo).
        const fechaEvento = reserva.fechaEvento as Date;

        // Lock de la fila bloqueante (origen 2b/2c) — punto de serialización; `null`
        // ≡ origen 2a sin fila (el INSERT lo serializa el UNIQUE(tenant_id, fecha)).
        const bloqueo = await repos.fechaBloqueada.leerBloqueoVigente({
          tenantId: comando.tenantId,
          fecha: fechaEvento,
          reservaId: reserva.idReserva,
        });

        // RE-LECTURA bajo el lock: la guarda se re-evalúa sobre el sub-estado ya
        // serializado por el `FOR UPDATE`. Una segunda transición concurrente, al
        // adquirir el lock liberado por la primera, observa `2v` (no `{2a,2b,2c}`) y
        // cae en la guarda (422), sin doble mutación ni doble bloqueo.
        const reservaBloqueada = await repos.reservas.buscarPorId({
          tenantId: comando.tenantId,
          reservaId: comando.reservaId,
        });
        if (reservaBloqueada === null) {
          throw new ReservaNoEncontradaError(comando.reservaId);
        }
        if (reservaBloqueada.estado === 'consulta' && reservaBloqueada.subEstado === '2d') {
          throw new VisitaEnColaError(MOTIVO_COLA);
        }
        if (
          !esOrigenValidoParaProgramarVisita(
            reservaBloqueada.estado,
            reservaBloqueada.subEstado,
          )
        ) {
          throw new ProgramarVisitaValidacionError(
            'La transición a 2.v (visita programada) solo es válida desde una consulta activa (sub-estados 2a, 2b o 2c)',
          );
        }

        // TTL del bloqueo = fecha de visita + 1 día (23:59:59) — única fuente de
        // verdad del cálculo (§D-2). NO deriva de max_dias_programar_visita.
        const ttlVisita = ttlVisitaMasUnDia(comando.fechaVisita);
        const accion: AccionBloqueoVisita = bloqueo === null ? 'insert' : 'update';
        const subEstadoOrigen = reservaBloqueada.subEstado;

        // (1) UPDATE RESERVA → 2.v + campos de visita + nuevo TTL.
        const actualizada = await repos.reservas.actualizar({
          idReserva: reserva.idReserva,
          subEstado: '2v',
          ttlExpiracion: ttlVisita,
          visitaProgramadaFecha: comando.fechaVisita,
          visitaProgramadaHora: comando.horaVisita,
          visitaRealizada: false,
        });

        // (2) INSERT-o-UPDATE (upsert) de FECHA_BLOQUEADA con el mismo TTL (§D-2).
        await repos.fechaBloqueada.upsertTtl({
          tenantId: comando.tenantId,
          fecha: fechaEvento,
          reservaId: reserva.idReserva,
          accion,
          tipoBloqueo: 'blando',
          ttlExpiracion: ttlVisita,
        });

        // (3) AUDIT_LOG `accion='transicion'` de la transición a `2.v`.
        await repos.auditoria.registrar(
          this.registroTransicion(comando, reserva.idReserva, subEstadoOrigen),
        );

        return { reserva: actualizada };
      },
    )) as ProgramarVisitaResultado;

    // (4) POST-COMMIT (§D-6): disparo de E6 (confirmación de visita), TOLERANTE a
    // fallo del proveedor (la transición ya commiteó; el email no la revierte).
    await this.enviarConfirmacionTolerante(comando, resultado.reserva);

    return resultado;
  }

  /**
   * Lee `max_dias_programar_visita` de TENANT_SETTINGS (nunca hardcodeado, §D-2). Si
   * el tenant no tiene settings o no define el campo, se rechaza con validación
   * (misconfiguración del tenant, coherente con el resto de operaciones de bloqueo).
   */
  private async resolverMaxDias(tenantId: string): Promise<number> {
    const settings = await this.deps.tenantSettings.obtener(tenantId);
    const maxDias = settings?.maxDiasProgramarVisita;
    if (maxDias === undefined || maxDias === null) {
      throw new ProgramarVisitaValidacionError(
        `No hay max_dias_programar_visita configurado en TENANT_SETTINGS para el tenant ${tenantId}`,
      );
    }
    return maxDias;
  }

  /**
   * Valida la ventana de entrada de la fecha de visita: debe ser estrictamente
   * FUTURA (`> hoy`, regla única del proyecto) y no superar `hoy + maxDias` (borde
   * superior INCLUSIVE). Fuera de rango → `ProgramarVisitaValidacionError` (422).
   */
  private validarVentana(fechaVisita: Date, ahora: Date, maxDias: number): void {
    if (!esFechaEstrictamenteFutura(fechaVisita, ahora)) {
      throw new ProgramarVisitaValidacionError(
        'La fecha de la visita debe ser futura (posterior a hoy)',
      );
    }
    const limiteSuperior = Date.UTC(
      ahora.getUTCFullYear(),
      ahora.getUTCMonth(),
      ahora.getUTCDate() + maxDias,
    );
    const diaVisita = Date.UTC(
      fechaVisita.getUTCFullYear(),
      fechaVisita.getUTCMonth(),
      fechaVisita.getUTCDate(),
    );
    if (diaVisita > limiteSuperior) {
      throw new ProgramarVisitaValidacionError(
        `La fecha de la visita no puede superar la ventana de ${maxDias} días (hoy + max_dias_programar_visita)`,
      );
    }
  }

  /** Construye el registro de AUDIT_LOG `accion='transicion'` de `origen → 2.v`. */
  private registroTransicion(
    comando: ProgramarVisitaComando,
    reservaId: string,
    subEstadoOrigen: SubEstadoConsulta | null,
  ): RegistroAuditoria {
    return {
      tenantId: comando.tenantId,
      accion: 'transicion',
      entidad: 'RESERVA',
      entidadId: reservaId,
      usuarioId: comando.usuarioId,
      datosAnteriores: { subEstado: subEstadoOrigen },
      datosNuevos: {
        subEstado: '2v',
        visitaProgramadaFecha: comando.fechaVisita.toISOString(),
        visitaProgramadaHora: comando.horaVisita,
      },
    };
  }

  /**
   * Envío POST-COMMIT TOLERANTE de E6: un fallo del proveedor NO propaga (la
   * transición ya commiteó). El puerto del motor US-045 centraliza el try/catch;
   * aquí se blinda como defensa en profundidad (§D-6).
   */
  private async enviarConfirmacionTolerante(
    comando: ProgramarVisitaComando,
    reserva: ReservaProgramarVisita,
  ): Promise<void> {
    try {
      await this.deps.confirmacionVisita.enviar({
        tenantId: comando.tenantId,
        reservaId: reserva.idReserva,
        clienteId: reserva.clienteId,
        codigoEmail: 'E6',
      });
    } catch {
      // El fallo de email no revierte la transición (post-commit, no bloqueante).
    }
  }
}

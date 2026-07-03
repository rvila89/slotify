/**
 * Caso de uso de APLICACIÓN: registro del RESULTADO de una visita — «cliente
 * interesado» (`2.v` → `2.b`) (US-009 / UC-08).
 *
 * El agregado RESERVA YA existe en `consulta/2v` (visita programada, US-008) con su
 * fila de FECHA_BLOQUEADA blanda vigente. La operación, en una ÚNICA transacción
 * (all-or-nothing, §D-2/§D-3), ejecuta:
 *   1. UPDATE RESERVA → `2b` + `visita_realizada=true` + `ttl_expiracion` FRESCO
 *      (`now + TENANT_SETTINGS.ttl_consulta_dias`). El TTL se calcula DESDE `now`,
 *      NUNCA se acumula sobre el `ttl_expiracion` previo (día post-visita de 2.v) ni
 *      deriva de `visita_programada_fecha` (informativa).
 *   2. UPDATE del `ttl_expiracion` de la fila EXISTENTE de FECHA_BLOQUEADA al MISMO
 *      valor fresco; `tipo_bloqueo` permanece `'blando'`. Es UPDATE PURO (la fila
 *      viene de 2.v): nunca INSERT ni DELETE.
 *   3. AUDIT_LOG `accion='transicion'`, `entidad='RESERVA'`
 *      (`datos_anteriores {subEstado:'2v', visitaRealizada:false}`,
 *      `datos_nuevos {subEstado:'2b', visitaRealizada:true}`).
 * Tras el COMMIT (§D-4) se dispara E7 (confirmación de bloqueo post-visita),
 * POST-COMMIT y TOLERANTE a fallo del proveedor: un fallo de email NO revierte la
 * transición (queda trazado con `estado='fallido'`).
 *
 * Reutiliza la máquina de estados declarativa (`esOrigenValidoParaResultadoVisitaInteresado`,
 * §D-1, guarda MONO-estado `{2v}`). La serialización por `SELECT … FOR UPDATE` sobre la
 * fila bloqueante vive en el adaptador de la UoW (PostgreSQL, sin locks distribuidos):
 * dos registros simultáneos → exactamente uno aplica, el otro re-lee `2b` y cae en la
 * guarda (422). Race con el barrido A21/US-012 → commit-first, sin estado intermedio.
 *
 * Hexagonal: depende SOLO de puertos inyectados; no importa Prisma ni `@nestjs/*`.
 */
import type {
  AuditLogPort,
  RegistroAuditoria,
} from '../../shared/audit/audit-log.port';
import {
  esOrigenValidoParaResultadoVisitaInteresado,
  type EstadoReserva,
  type SubEstadoConsulta,
} from '../domain/maquina-estados';

/** Reloj inyectable para determinismo (cálculo del TTL fresco desde `now`). */
export interface ClockPort {
  ahora(): Date;
}

const DIA_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Tipos del comando / resultado
// ---------------------------------------------------------------------------

/** Resultado de la visita. En US-009 solo `interesado` está implementado. */
export type ResultadoVisita = 'interesado' | 'reserva_inmediata' | 'descarte';

/** Comando de entrada del registro del resultado de la visita. */
export interface RegistrarResultadoVisitaComando {
  /** Tenant del gestor (del JWT, nunca del body/path). */
  tenantId: string;
  /** Identificador del gestor que registra el resultado (para auditoría). */
  usuarioId: string;
  /** RESERVA destino (debe existir y estar en `2.v`). */
  reservaId: string;
  /** Resultado de la visita; solo `interesado` está soportado en esta US. */
  resultado: ResultadoVisita;
}

/** Proyección de la RESERVA relevante para la transición (origen y resultado). */
export interface ReservaResultadoVisita {
  idReserva: string;
  tenantId: string;
  clienteId: string;
  estado: EstadoReserva;
  subEstado: SubEstadoConsulta | null;
  ttlExpiracion: Date | null;
  fechaEvento: Date | null;
  visitaProgramadaFecha?: Date | null;
  visitaProgramadaHora?: string | null;
  visitaRealizada: boolean;
}

/** Fila activa de `FECHA_BLOQUEADA` de la RESERVA, leída (y bloqueada) en la tx. */
export interface BloqueoResultadoVisitaVigente {
  idBloqueo: string;
  tipoBloqueo: 'blando' | 'firme';
  ttlExpiracion: Date | null;
}

/** Resultado: la RESERVA en `2.b` con `visita_realizada=true` y TTL fresco. */
export interface RegistrarResultadoVisitaResultado {
  reserva: ReservaResultadoVisita;
}

// ---------------------------------------------------------------------------
// Puertos (interfaces) — implementados en infraestructura (adaptadores Prisma)
// ---------------------------------------------------------------------------

/** Parámetros del UPDATE de la RESERVA en la transición a `2.b`. */
export interface ActualizarReservaResultadoVisitaParams {
  idReserva: string;
  subEstado: SubEstadoConsulta;
  ttlExpiracion: Date | null;
  visitaRealizada: boolean;
}

/** Repositorio de RESERVA tx-bound: lee el origen y aplica el UPDATE a `2.b`. */
export interface ReservaResultadoVisitaRepositoryPort {
  /** Lee la RESERVA por id bajo el contexto RLS del tenant; `null` si no existe. */
  buscarPorId(params: {
    tenantId: string;
    reservaId: string;
  }): Promise<ReservaResultadoVisita | null>;
  /** Aplica el UPDATE a `2.b` + visita_realizada + TTL fresco y devuelve la RESERVA. */
  actualizar(
    params: ActualizarReservaResultadoVisitaParams,
  ): Promise<ReservaResultadoVisita>;
}

/** Parámetros del UPDATE PURO del `ttl_expiracion` de la fila de FECHA_BLOQUEADA. */
export interface ActualizarTtlBloqueoResultadoVisitaParams {
  tenantId: string;
  fecha: Date;
  reservaId: string;
  tipoBloqueo: 'blando';
  ttlExpiracion: Date;
}

/**
 * Repositorio tx-bound de FECHA_BLOQUEADA para la transición a `2.b`.
 * `leerBloqueoVigente` toma `SELECT … FOR UPDATE` sobre la fila bloqueante (punto de
 * serialización; la fila SIEMPRE existe al venir de 2.v); `actualizarTtl` hace un
 * UPDATE PURO del `ttl_expiracion` (nunca INSERT/DELETE).
 */
export interface FechaBloqueadaResultadoVisitaRepositoryPort {
  /** Lee (y bloquea con FOR UPDATE) la fila activa de la RESERVA; `null` si no hay. */
  leerBloqueoVigente(params: {
    tenantId: string;
    fecha: Date;
    reservaId: string;
  }): Promise<BloqueoResultadoVisitaVigente | null>;
  /** UPDATE PURO del `ttl_expiracion` de la fila existente (mismo valor fresco). */
  actualizarTtl(
    params: ActualizarTtlBloqueoResultadoVisitaParams,
  ): Promise<void>;
}

/** Conjunto de repositorios disponibles dentro de la unidad de trabajo. */
export interface RepositoriosResultadoVisita {
  reservas: ReservaResultadoVisitaRepositoryPort;
  fechaBloqueada: FechaBloqueadaResultadoVisitaRepositoryPort;
  auditoria: AuditLogPort;
}

/**
 * Unidad de trabajo transaccional. El adaptador envuelve `$transaction` +
 * `fijarTenant(tenantId)` (RLS) y expone los repositorios ligados a esa transacción.
 * Si el `trabajo` rechaza, la transacción revierte por completo (all-or-nothing).
 */
export interface UnidadDeTrabajoResultadoVisitaPort {
  ejecutar(
    tenantId: string,
    trabajo: (repos: RepositoriosResultadoVisita) => Promise<unknown>,
  ): Promise<unknown>;
}

/** Parámetros del disparo POST-COMMIT del email E7 (confirmación post-visita). */
export interface EnviarConfirmacionResultadoVisitaParams {
  tenantId: string;
  reservaId: string;
  clienteId: string;
  codigoEmail: 'E7';
}

/** Estado terminal alcanzado tras el intento de envío post-commit de E7. */
export interface EnviarConfirmacionResultadoVisitaResultado {
  estado: 'enviado' | 'fallido';
  fechaEnvio: Date | null;
}

/**
 * Puerto del email E7 (confirmación de bloqueo post-visita) vía el motor de US-045. Se
 * invoca POST-COMMIT, fuera de la transacción (§D-4): el adaptador centraliza el
 * try/catch del proveedor y NUNCA propaga la excepción que tumbe la transición ya
 * comprometida.
 */
export interface EnviarConfirmacionResultadoVisitaPort {
  enviar(
    params: EnviarConfirmacionResultadoVisitaParams,
  ): Promise<EnviarConfirmacionResultadoVisitaResultado>;
}

/** Settings del tenant con el TTL de consulta (US-040). */
export interface TenantSettingsResultadoVisita {
  ttlConsultaDias: number;
  ttlPrereservaDias?: number;
  maxDiasProgramarVisita?: number;
}

/** Puerto de settings (subconjunto necesario): expone `ttlConsultaDias`. */
export interface TenantSettingsResultadoVisitaPort {
  obtener(tenantId: string): Promise<TenantSettingsResultadoVisita | null>;
}

/** Dependencias del caso de uso (puertos inyectados). */
export interface RegistrarResultadoVisitaDeps {
  unidadDeTrabajo: UnidadDeTrabajoResultadoVisitaPort;
  clock: ClockPort;
  /** Settings del tenant para el TTL de consulta (ttl_consulta_dias). */
  tenantSettings: TenantSettingsResultadoVisitaPort;
  /** Puerto del envío post-commit de E7 (confirmación post-visita). */
  confirmacionResultado: EnviarConfirmacionResultadoVisitaPort;
}

// ---------------------------------------------------------------------------
// Errores de dominio tipados, en español
// ---------------------------------------------------------------------------

/**
 * La RESERVA no está en `2.v` (guarda de origen mono-estado), o el `resultado` no es
 * `interesado` (US-010/US-011 aún no implementadas): se rechaza SIN tocar la BD.
 * Mapea a HTTP 422.
 */
export class ResultadoVisitaValidacionError extends Error {
  readonly codigo = 'RESULTADO_VISITA_VALIDACION' as const;

  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ResultadoVisitaValidacionError';
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

// ---------------------------------------------------------------------------
// Caso de uso
// ---------------------------------------------------------------------------

export class RegistrarResultadoVisitaUseCase {
  constructor(private readonly deps: RegistrarResultadoVisitaDeps) {}

  async ejecutar(
    comando: RegistrarResultadoVisitaComando,
  ): Promise<RegistrarResultadoVisitaResultado> {
    // Guarda de resultado: esta US solo cubre «interesado». `reserva_inmediata`
    // (US-010) y `descarte` (US-011) aún no se implementan → 422 sin tocar la BD.
    if (comando.resultado !== 'interesado') {
      throw new ResultadoVisitaValidacionError(
        `El resultado de visita '${comando.resultado}' no está soportado en esta versión (solo 'interesado')`,
      );
    }

    const ahora = this.deps.clock.ahora();

    // Transición ATÓMICA dentro de UNA unidad de trabajo (tx + RLS). Las validaciones
    // (404 / 422 guarda) van DENTRO, ANTES de cualquier mutación: un rechazo lanza y
    // la UoW revierte sin efectos.
    const resultado = (await this.deps.unidadDeTrabajo.ejecutar(
      comando.tenantId,
      async (repos): Promise<RegistrarResultadoVisitaResultado> => {
        // 404 — existencia (RLS: cross-tenant → null).
        const reserva = await repos.reservas.buscarPorId({
          tenantId: comando.tenantId,
          reservaId: comando.reservaId,
        });
        if (reserva === null) {
          throw new ReservaNoEncontradaError(comando.reservaId);
        }

        // 422 — guarda de origen declarativa mono-estado: solo `consulta/2v` (§D-1).
        if (
          !esOrigenValidoParaResultadoVisitaInteresado(
            reserva.estado,
            reserva.subEstado,
          )
        ) {
          throw new ResultadoVisitaValidacionError(
            'El registro del resultado "cliente interesado" solo es válido desde una consulta con visita programada (sub-estado 2v)',
          );
        }

        // La fecha del evento es la que está bloqueada (existe por venir de 2.v).
        const fechaEvento = reserva.fechaEvento as Date;

        // Lock de la fila bloqueante — punto de serialización (la fila SIEMPRE existe
        // al venir de 2.v; no hay rama de INSERT).
        await repos.fechaBloqueada.leerBloqueoVigente({
          tenantId: comando.tenantId,
          fecha: fechaEvento,
          reservaId: reserva.idReserva,
        });

        // RE-LECTURA bajo el lock: la guarda se re-evalúa sobre el sub-estado ya
        // serializado por el `FOR UPDATE`. Un segundo registro concurrente, al adquirir
        // el lock liberado por el primero, observa `2b` (no `2v`) y cae en la guarda
        // (422), sin doble mutación ni doble actualización del bloqueo. Frente al
        // barrido A21 (US-012): commit-first sin estado intermedio.
        const reservaBloqueada = await repos.reservas.buscarPorId({
          tenantId: comando.tenantId,
          reservaId: comando.reservaId,
        });
        if (reservaBloqueada === null) {
          throw new ReservaNoEncontradaError(comando.reservaId);
        }
        if (
          !esOrigenValidoParaResultadoVisitaInteresado(
            reservaBloqueada.estado,
            reservaBloqueada.subEstado,
          )
        ) {
          throw new ResultadoVisitaValidacionError(
            'El registro del resultado "cliente interesado" solo es válido desde una consulta con visita programada (sub-estado 2v)',
          );
        }

        // TTL FRESCO = now + ttl_consulta_dias (leído de TENANT_SETTINGS, nunca
        // hardcodeado). Única fuente de verdad del cálculo: NO acumula sobre el TTL
        // previo ni deriva de visita_programada_fecha (§D-3).
        const ttlConsultaDias = await this.resolverTtlConsultaDias(comando.tenantId);
        const ttlFresco = new Date(ahora.getTime() + ttlConsultaDias * DIA_MS);

        // (1) UPDATE RESERVA → 2.b + visita_realizada=true + TTL fresco.
        const actualizada = await repos.reservas.actualizar({
          idReserva: reserva.idReserva,
          subEstado: '2b',
          ttlExpiracion: ttlFresco,
          visitaRealizada: true,
        });

        // (2) UPDATE PURO del ttl de la fila existente de FECHA_BLOQUEADA al MISMO
        // valor; tipo_bloqueo permanece 'blando' (§D-3).
        await repos.fechaBloqueada.actualizarTtl({
          tenantId: comando.tenantId,
          fecha: fechaEvento,
          reservaId: reserva.idReserva,
          tipoBloqueo: 'blando',
          ttlExpiracion: ttlFresco,
        });

        // (3) AUDIT_LOG `accion='transicion'` de la transición `2v → 2b`.
        await repos.auditoria.registrar(
          this.registroTransicion(comando, reserva.idReserva),
        );

        return { reserva: actualizada };
      },
    )) as RegistrarResultadoVisitaResultado;

    // (4) POST-COMMIT (§D-4): disparo de E7 (confirmación post-visita), TOLERANTE a
    // fallo del proveedor (la transición ya commiteó; el email no la revierte).
    await this.enviarConfirmacionTolerante(comando, resultado.reserva);

    return resultado;
  }

  /**
   * Lee `ttl_consulta_dias` de TENANT_SETTINGS (nunca hardcodeado, §D-3). Si el tenant
   * no tiene settings o no define el campo, se rechaza con validación (misconfiguración
   * del tenant, coherente con el resto de operaciones de bloqueo).
   */
  private async resolverTtlConsultaDias(tenantId: string): Promise<number> {
    const settings = await this.deps.tenantSettings.obtener(tenantId);
    const dias = settings?.ttlConsultaDias;
    if (dias === undefined || dias === null) {
      throw new ResultadoVisitaValidacionError(
        `No hay ttl_consulta_dias configurado en TENANT_SETTINGS para el tenant ${tenantId}`,
      );
    }
    return dias;
  }

  /** Construye el registro de AUDIT_LOG `accion='transicion'` de `2v → 2b`. */
  private registroTransicion(
    comando: RegistrarResultadoVisitaComando,
    reservaId: string,
  ): RegistroAuditoria {
    return {
      tenantId: comando.tenantId,
      accion: 'transicion',
      entidad: 'RESERVA',
      entidadId: reservaId,
      usuarioId: comando.usuarioId,
      datosAnteriores: { subEstado: '2v', visitaRealizada: false },
      datosNuevos: { subEstado: '2b', visitaRealizada: true },
    };
  }

  /**
   * Envío POST-COMMIT TOLERANTE de E7: un fallo del proveedor NO propaga (la transición
   * ya commiteó). El puerto del motor US-045 centraliza el try/catch; aquí se blinda
   * como defensa en profundidad (§D-4).
   */
  private async enviarConfirmacionTolerante(
    comando: RegistrarResultadoVisitaComando,
    reserva: ReservaResultadoVisita,
  ): Promise<void> {
    try {
      await this.deps.confirmacionResultado.enviar({
        tenantId: comando.tenantId,
        reservaId: reserva.idReserva,
        clienteId: reserva.clienteId,
        codigoEmail: 'E7',
      });
    } catch {
      // El fallo de email no revierte la transición (post-commit, no bloqueante).
    }
  }
}

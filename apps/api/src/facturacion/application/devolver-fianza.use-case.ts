/**
 * Caso de uso de APLICACIÓN: registrar la DEVOLUCIÓN COMPLETA de la fianza + email E10
 * (fix-liquidacion-fianza-independientes / UC-27). Reemplaza el flujo sobredimensionado de
 * US-035/US-036 (IBAN E5/E8, retención parcial): un único botón "Devolver fianza".
 *
 * Precondición: `estado='post_evento'` Y `fianza_status='cobrada'` (sin IBAN, importe ni motivo).
 * En UNA transacción atómica bajo `SELECT ... FOR UPDATE` sobre la RESERVA (serializa el doble
 * registro concurrente, nunca locks distribuidos):
 *   1. `fianza_status='devuelta'`, `fianza_devuelta_fecha=now()` (importe implícito = fianza_eur).
 *   2. AUDIT_LOG `accion='actualizar'` (`fianza_status: cobrada → devuelta`).
 * Como efecto POSTERIOR al commit y BEST-EFFORT (patrón `disparar-e8`), dispara el email E10
 * "fianza devuelta": un fallo NO revierte el registro (queda `COMUNICACION` en `fallido`,
 * reintentable) y produce el `avisoEmail`. El estado `devuelta` es final e irreversible.
 *
 * Hexagonal (hook `no-infra-in-domain`): depende SOLO de puertos inyectados; no importa Prisma
 * ni `@nestjs/*`.
 */

/** Mensaje canónico del aviso cuando la fianza se devolvió pero E10 no pudo enviarse. */
export const MENSAJE_E10_FALLIDO =
  'Fianza marcada como devuelta, pero el email de confirmación no pudo enviarse. Puedes reenviarlo desde la ficha.' as const;

// ---------------------------------------------------------------------------
// Tipos de comando / proyecciones / puertos
// ---------------------------------------------------------------------------

/** Comando de la acción "Devolver fianza" (cuerpo vacío). */
export interface DevolverFianzaComando {
  /** Tenant del JWT (nunca del path/body). */
  tenantId: string;
  /** Gestor que ejecuta la acción (auditoría). */
  usuarioId: string;
  /** RESERVA cuya fianza se devuelve. */
  reservaId: string;
}

/** Proyección mínima de la RESERVA releída con bloqueo de fila (fuente de verdad). */
export interface ReservaDevolverFianza {
  idReserva: string;
  tenantId: string;
  clienteId: string;
  estado: string;
  fianzaStatus: string;
  /** Importe de la fianza cobrada (devolución completa implícita). */
  fianzaEur: string | null;
}

/** Parámetros del registro de la devolución completa sobre la RESERVA. */
export interface RegistrarDevolverFianzaParams {
  reservaId: string;
  fianzaStatus: 'devuelta';
  fianzaDevueltaFecha: Date;
}

/** Repositorio tx-bound de la RESERVA (relectura FOR UPDATE + registro de la devolución). */
export interface ReservasDevolverFianzaPort {
  /** Relee la RESERVA con `SELECT ... FOR UPDATE` (serialización del doble registro). */
  releerConBloqueo(params: { reservaId: string }): Promise<ReservaDevolverFianza | null>;
  /** Aplica la devolución (nunca transiciona `RESERVA.estado`). */
  registrarDevolucion(params: RegistrarDevolverFianzaParams): Promise<void>;
}

/** Registro de auditoría de la devolución de la fianza. */
export interface RegistroAuditoriaDevolverFianza {
  tenantId: string;
  usuarioId?: string | null;
  entidad: 'RESERVA';
  entidadId: string;
  accion: 'actualizar';
  datosAnteriores?: Record<string, unknown> | null;
  datosNuevos?: Record<string, unknown> | null;
}

/** Repositorio tx-bound de AUDIT_LOG. */
export interface AuditoriaDevolverFianzaPort {
  registrar(registro: RegistroAuditoriaDevolverFianza): Promise<void>;
}

/** Conjunto de repositorios disponibles dentro de la unidad de trabajo. */
export interface RepositoriosDevolverFianza {
  reservas: ReservasDevolverFianzaPort;
  auditoria: AuditoriaDevolverFianzaPort;
}

/**
 * Unidad de trabajo transaccional (tx + RLS + `SELECT ... FOR UPDATE`). Si el `trabajo` lanza,
 * la tx REVIERTE por completo (atomicidad).
 */
export interface UnidadDeTrabajoDevolverFianzaPort {
  ejecutar(
    tenantId: string,
    trabajo: (repos: RepositoriosDevolverFianza) => Promise<unknown>,
  ): Promise<unknown>;
}

/** Resultado del disparo de E10 (post-commit, best-effort). */
export interface ResultadoDispararE10 {
  resultado: 'enviado' | 'fallido';
  comunicacionId: string | null;
}

/**
 * Puerto de disparo de E10 (POST-COMMIT, best-effort): mapea el motor de email de
 * `comunicaciones` (US-045, `despacharReenvio`). Crea una NUEVA `COMUNICACION`
 * (`codigoEmail='E10'`) y la promueve a `enviado`/`fallido`; nunca revierte la devolución.
 */
export interface DispararE10Port {
  disparar(params: {
    tenantId: string;
    reservaId: string;
    clienteId: string;
    fianzaEur: string | null;
  }): Promise<ResultadoDispararE10>;
}

/** Dependencias del caso de uso (puertos inyectados). */
export interface DevolverFianzaDeps {
  unidadDeTrabajo: UnidadDeTrabajoDevolverFianzaPort;
  dispararE10: DispararE10Port;
  clock: ClockPort;
}

/** Reloj inyectable para determinismo. */
export interface ClockPort {
  ahora(): Date;
}

/** Aviso best-effort: la fianza se devolvió pero E10 no pudo enviarse. */
export interface AvisoEmailE10Fallido {
  codigo: 'e10_fallido';
  mensaje: string;
  comunicacionId: string | null;
}

/** Resultado del caso de uso (alimenta `DevolverFianzaResponse`). */
export interface DevolverFianzaResultado {
  reservaId: string;
  fianzaStatus: 'devuelta';
  fianzaDevueltaFecha: Date;
  fianzaEur: string | null;
  avisoEmail: AvisoEmailE10Fallido | null;
}

// ---------------------------------------------------------------------------
// Errores de dominio tipados, en español
// ---------------------------------------------------------------------------

/** La RESERVA no existe para el tenant (RLS) → HTTP 404. */
export class ReservaDevolverFianzaNoEncontradaError extends Error {
  readonly codigo = 'RESERVA_NO_ENCONTRADA' as const;
  readonly reservaId: string;

  constructor(reservaId: string) {
    super('No hay reserva para el registro de la devolución de la fianza');
    this.name = 'ReservaDevolverFianzaNoEncontradaError';
    this.reservaId = reservaId;
  }
}

/** Precondición incumplida (estado != post_evento o fianza_status != cobrada) → HTTP 409. */
export class PrecondicionNoCumplidaError extends Error {
  readonly codigo = 'PRECONDICION_NO_CUMPLIDA' as const;
  readonly motivo: string;

  constructor(
    motivo = 'No se cumplen las precondiciones para devolver la fianza (post_evento + fianza cobrada)',
  ) {
    super(motivo);
    this.name = 'PrecondicionNoCumplidaError';
    this.motivo = motivo;
  }
}

/** La devolución ya está registrada (estado final irreversible, doble registro) → HTTP 409. */
export class DevolucionYaRegistradaError extends Error {
  readonly codigo = 'DEVOLUCION_YA_REGISTRADA' as const;
  readonly motivo: string;

  constructor(motivo = 'La devolución de la fianza ya está registrada') {
    super(motivo);
    this.name = 'DevolucionYaRegistradaError';
    this.motivo = motivo;
  }
}

// ---------------------------------------------------------------------------
// Caso de uso
// ---------------------------------------------------------------------------

export class DevolverFianzaUseCase {
  constructor(private readonly deps: DevolverFianzaDeps) {}

  async ejecutar(comando: DevolverFianzaComando): Promise<DevolverFianzaResultado> {
    // Paso TRANSACCIONAL: relectura FOR UPDATE + guarda + registro + AUDIT_LOG.
    const { reserva, fianzaDevueltaFecha } = (await this.deps.unidadDeTrabajo.ejecutar(
      comando.tenantId,
      (repos) => this.registrar(comando, repos),
    )) as { reserva: ReservaDevolverFianza; fianzaDevueltaFecha: Date };

    // Paso POST-COMMIT (best-effort): dispara E10 al CLIENTE. Su fallo NO revierte la
    // devolución ya commiteada (produce el `avisoEmail`).
    const avisoEmail = await this.dispararE10(comando, reserva);

    return {
      reservaId: reserva.idReserva,
      fianzaStatus: 'devuelta',
      fianzaDevueltaFecha,
      fianzaEur: reserva.fianzaEur,
      avisoEmail,
    };
  }

  private async registrar(
    comando: DevolverFianzaComando,
    repos: RepositoriosDevolverFianza,
  ): Promise<{ reserva: ReservaDevolverFianza; fianzaDevueltaFecha: Date }> {
    // (1) Relectura con BLOQUEO DE FILA (FOR UPDATE): fuente de verdad + serialización del
    //     doble registro. Inexistente/cross-tenant → 404.
    const reserva = await repos.reservas.releerConBloqueo({ reservaId: comando.reservaId });
    if (reserva === null || reserva === undefined) {
      throw new ReservaDevolverFianzaNoEncontradaError(comando.reservaId);
    }

    // (2) Guarda de precondición / doble registro (reevaluada bajo el lock).
    if (reserva.fianzaStatus === 'devuelta') {
      throw new DevolucionYaRegistradaError();
    }
    if (reserva.estado !== 'post_evento' || reserva.fianzaStatus !== 'cobrada') {
      throw new PrecondicionNoCumplidaError();
    }

    // (3) Registro de la devolución completa + AUDIT_LOG (nunca RESERVA.estado).
    const fianzaDevueltaFecha = this.deps.clock.ahora();
    await repos.reservas.registrarDevolucion({
      reservaId: comando.reservaId,
      fianzaStatus: 'devuelta',
      fianzaDevueltaFecha,
    });
    await repos.auditoria.registrar({
      tenantId: comando.tenantId,
      usuarioId: comando.usuarioId,
      entidad: 'RESERVA',
      entidadId: comando.reservaId,
      accion: 'actualizar',
      datosAnteriores: { fianzaStatus: 'cobrada', fianzaDevueltaFecha: null },
      datosNuevos: { fianzaStatus: 'devuelta', fianzaDevueltaFecha },
    });

    return { reserva, fianzaDevueltaFecha };
  }

  /**
   * Dispara E10 tras el commit. Best-effort: un `resultado='fallido'` (o una excepción del
   * puerto) NO revierte la devolución; se degrada al `avisoEmail`.
   */
  private async dispararE10(
    comando: DevolverFianzaComando,
    reserva: ReservaDevolverFianza,
  ): Promise<AvisoEmailE10Fallido | null> {
    try {
      const resultado = await this.deps.dispararE10.disparar({
        tenantId: comando.tenantId,
        reservaId: reserva.idReserva,
        clienteId: reserva.clienteId,
        fianzaEur: reserva.fianzaEur,
      });
      if (resultado.resultado === 'enviado') {
        return null;
      }
      return {
        codigo: 'e10_fallido',
        mensaje: MENSAJE_E10_FALLIDO,
        comunicacionId: resultado.comunicacionId,
      };
    } catch {
      return {
        codigo: 'e10_fallido',
        mensaje: MENSAJE_E10_FALLIDO,
        comunicacionId: null,
      };
    }
  }
}

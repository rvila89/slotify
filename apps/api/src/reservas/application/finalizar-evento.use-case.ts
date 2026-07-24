/**
 * Caso de uso de APLICACIÓN `FinalizarEventoUseCase` (US-034 / UC-25, actor Gestor).
 *
 * Es la ACCIÓN MANUAL que cierra la ejecución del evento: transiciona la RESERVA
 * `evento_en_curso → post_evento` (irreversible) y, condicionalmente, dispara el email
 * **E5** (solicitud de IBAN + agradecimiento + NPS). Orquesta el dominio puro a través de
 * puertos inyectados (hexagonal, hook `no-infra-in-domain`): NO importa Prisma ni
 * `@nestjs/*`. La ATOMICIDAD REAL (`SELECT … FOR UPDATE`, RLS) vive en el adaptador Prisma
 * de la unidad de trabajo (`UnidadDeTrabajoFinalizacionPort`).
 *
 * Algoritmo (design.md §D-2/§D-4/§D-5/§D-9):
 *   0. Cargar la RESERVA bajo RLS del tenant del JWT (`cargarReserva`). `null` → 404
 *      (`ReservaNoEncontradaError`): inexistente o de otro tenant.
 *   1. Guarda de ORIGEN previa a la transacción (`resolverFinalizacionEvento`): si el
 *      estado NO es `evento_en_curso` → `TransicionNoPermitidaError` (409), SIN efectos
 *      (sin tx, sin E5, sin AUDIT_LOG).
 *   2. Paso TRANSACCIONAL (crítico, all-or-nothing) vía la unidad de trabajo:
 *      - `reservas.finalizarEvento(...)` hace `UPDATE … WHERE estado='evento_en_curso'`
 *        bajo el `SELECT … FOR UPDATE` de la fila y devuelve `filasAfectadas`. `0` filas
 *        (la carrera de doble finalización la perdió, D-8) → `TransicionNoPermitidaError`.
 *      - marca la NPS como programada (`npsProgramada: true`, marca derivada D-6).
 *      - AUDIT_LOG de la transición (`accion='transicion'`, origen Usuario con `usuarioId`).
 *      - si `fianzaStatus='cobrada'` Y `fianzaEur IS NULL` (dato anómalo, D-4): AUDIT_LOG de
 *        ALERTA de dato anómalo (`motivo='dato_anomalo_fianza'`); NO bloquea, NO envía E5.
 *   3. Paso POST-COMMIT (best-effort): SOLO si `debeEnviarseE5(fianzaEur)` invoca el motor
 *      de E5 (`dispararE5`). Un fallo del proveedor deja `resultado='fallido'` SIN revertir
 *      la transición ya commiteada; una excepción del puerto se captura (no propaga).
 *   4. Consulta ítems de documentación pendientes (`documentacion`, US-033, fail-open D-7)
 *      para la advertencia no bloqueante.
 *   5. Devuelve estado resultante + resultado de E5 + `documentacionPendiente`.
 */
import {
  resolverFinalizacionEvento,
  type EstadoReserva,
  type SubEstadoConsulta,
} from '../domain/maquina-estados';
import type { AuditLogPort } from '../../shared/audit/audit-log.port';
import type { ReservaDetalleLectura } from './obtener-reserva.query';

// ---------------------------------------------------------------------------
// Literal FIJO del motivo de la alerta de dato anómalo de fianza (D-4).
// ---------------------------------------------------------------------------

/** Motivo canónico registrado en AUDIT_LOG cuando `fianza_status=cobrada` + `fianza_eur IS NULL`. */
export const MOTIVO_DATO_ANOMALO_FIANZA = 'dato_anomalo_fianza' as const;

// ---------------------------------------------------------------------------
// Tipos del dominio de la aplicación
// ---------------------------------------------------------------------------

/** Estado de cobro de la fianza (valor de dominio; espejo del enum Prisma). */
export type FianzaStatusFinalizacion = 'pendiente' | 'cobrada' | 'devuelta';

/**
 * Proyección mínima de la RESERVA que la finalización necesita (leída bajo RLS del tenant
 * del JWT). `fianzaEur` viaja como STRING (Decimal(10,2), sin coma flotante) o `null`.
 */
export interface ReservaFinalizacion {
  idReserva: string;
  tenantId: string;
  clienteId: string;
  estado: EstadoReserva;
  subEstado: SubEstadoConsulta | null;
  fianzaEur: string | null;
  fianzaStatus: FianzaStatusFinalizacion;
}

/** Comando de entrada: identidad de la RESERVA + actor (tenant/usuario del JWT). */
export interface FinalizarEventoComando {
  /** Tenant del JWT (nunca del path/body): contexto RLS de toda la operación. */
  tenantId: string;
  /** Gestor autenticado (JWT): origen Usuario del AUDIT_LOG de la transición. */
  usuarioId: string;
  /** RESERVA a finalizar (path). */
  reservaId: string;
}

/** Resultado del disparo condicionado de E5 (contrato `FinalizarEventoE5`). */
export interface ResultadoDispararE5 {
  resultado: 'enviado' | 'fallido' | 'no_aplica';
  comunicacionId: string | null;
}

/**
 * Read-model de la RESERVA hidratada POST-COMMIT que alimenta el `allOf(Reserva)` del
 * contrato `FinalizarEventoResponse`. Reusa la MISMA proyección que `GET /reservas/{id}`
 * (`ReservaDetalleLectura`); el campo `cliente` embebido NO forma parte de `Reserva` (solo
 * de `ReservaDetalle`) y el controlador lo omite al mapear.
 */
export type ReservaHidratadaFinalizacion = ReservaDetalleLectura;

/**
 * Resultado del caso de uso (alimenta `FinalizarEventoResponse` = `allOf(Reserva)` + `e5` +
 * `documentacionPendiente`). `reserva` es la RESERVA COMPLETA re-leída tras el commit (bajo
 * RLS del tenant) para hidratar el objeto del contrato; `null` solo si la relectura no
 * resuelve (borrada en carrera / puerto no disponible), en cuyo caso el controlador cae a la
 * proyección mínima (`reservaId`/`estado`). `reservaId`/`estado` se conservan en el nivel
 * superior por retrocompatibilidad de la orquestación.
 */
export interface FinalizarEventoResultado {
  reservaId: string;
  estado: EstadoReserva;
  reserva: ReservaHidratadaFinalizacion | null;
  e5: ResultadoDispararE5;
  documentacionPendiente: string[];
}

// ---------------------------------------------------------------------------
// Puertos (interfaces) — implementados en infraestructura (adaptadores Prisma)
// ---------------------------------------------------------------------------

/** Parámetros de la mutación transaccional de la transición (bajo el lock). */
export interface MutacionFinalizacionParams {
  reservaId: string;
  tenantId: string;
  /** Estado de origen esperado bajo el lock (guarda de la UPDATE condicional). */
  estadoOrigen: EstadoReserva;
  /** Estado destino de la transición. */
  estadoDestino: EstadoReserva;
  /** Marca de NPS programada (T+3d), marca derivada (D-6). */
  npsProgramada: boolean;
  /**
   * US-037 (D-2=A): instante de ENTRADA a `post_evento` (fuente de verdad del reloj T+7d del
   * archivado automático). Se persiste en `reserva.fecha_post_evento` en la MISMA UPDATE que
   * fija `estado = post_evento`. Timestamp único de la transición (no string formateado).
   */
  fechaPostEvento: Date;
}

/** Resultado de la mutación: filas afectadas por la UPDATE condicional bajo el lock. */
export interface MutacionFinalizacionResultado {
  /** `1` si la transición ganó; `0` si bajo el lock el estado ya no era el de origen. */
  filasAfectadas: number;
}

/** Registro de auditoría de la transición / alerta de dato anómalo (origen Usuario). */
export interface RegistroAuditoriaFinalizacion {
  tenantId: string;
  usuarioId?: string;
  accion: 'transicion' | 'actualizar';
  entidad: 'RESERVA';
  entidadId: string;
  datosAnteriores?: Record<string, unknown>;
  datosNuevos?: Record<string, unknown>;
}

/**
 * Repositorios tx-bound disponibles DENTRO de la unidad de trabajo de la transición. El
 * adaptador real (Prisma) los liga a la MISMA transacción (bajo el `SELECT … FOR UPDATE`).
 */
export interface RepositoriosFinalizacion {
  reservas: {
    /**
     * UPDATE condicional de la transición bajo el lock: `UPDATE reserva SET
     * estado=estadoDestino WHERE id=reservaId AND estado=estadoOrigen`. Devuelve las filas
     * afectadas (`0` ⇒ la guarda ya no se cumple bajo el lock: carrera perdida).
     */
    finalizarEvento(
      params: MutacionFinalizacionParams,
    ): Promise<MutacionFinalizacionResultado>;
  };
  auditoria: AuditLogPort<RegistroAuditoriaFinalizacion>;
}

/**
 * Unidad de trabajo de la transición: abre UNA transacción bajo el contexto RLS del tenant,
 * toma el `SELECT … FOR UPDATE` de la fila RESERVA y ejecuta `trabajo` con los repos ligados
 * a esa transacción. La atomicidad y el lock viven en el adaptador (sin locks distribuidos).
 */
export interface UnidadDeTrabajoFinalizacionPort {
  ejecutar(
    tenantId: string,
    trabajo: (repos: RepositoriosFinalizacion) => Promise<unknown>,
  ): Promise<unknown>;
}

/**
 * Puerto de disparo de E5 (POST-COMMIT, best-effort): mapea el motor de email de
 * `comunicaciones` (US-045). Crea la `COMUNICACION` (`codigoEmail='E5'`) y la promueve a
 * `enviado`/`fallido`; nunca revierte el estado. `no_aplica` no debe invocarse (la guarda
 * `debeEnviarseE5` lo decide antes).
 */
export interface DispararE5Port {
  disparar(params: {
    tenantId: string;
    reservaId: string;
    clienteId: string;
  }): Promise<ResultadoDispararE5>;
}

/**
 * Puerto de lectura de la completitud del checklist de documentación del evento (US-033).
 * FAIL-OPEN (D-7): si no está disponible, el use-case captura el error y devuelve `[]`
 * (nunca bloquea la finalización).
 */
export interface DocumentacionEventoPort {
  itemsPendientes(reservaId: string, tenantId: string): Promise<string[]>;
}

/**
 * Puerto de RELECTURA de la RESERVA completa POST-COMMIT para hidratar el `allOf(Reserva)`
 * de la respuesta (contrato). Reusa la lectura de `GET /reservas/{id}` (`ReservaDetalleQueryPort`)
 * bajo RLS del tenant. Es una lectura fuera de la transacción de la transición (D-2): NO afecta
 * a la atomicidad ni al disparo de E5.
 */
export interface CargarReservaDetalleFinalizacionPort {
  cargar(comando: FinalizarEventoComando): Promise<ReservaHidratadaFinalizacion | null>;
}

/** Dependencias del caso de uso (puertos inyectados, hexagonal). */
export interface FinalizarEventoDeps {
  unidadDeTrabajo: UnidadDeTrabajoFinalizacionPort;
  cargarReserva(comando: FinalizarEventoComando): Promise<ReservaFinalizacion | null>;
  /**
   * Relectura POST-COMMIT de la RESERVA completa para hidratar `allOf(Reserva)` en la
   * respuesta 200. Best-effort: si falla o devuelve `null`, el resultado cae a la proyección
   * mínima (`reservaId`/`estado`) sin tumbar la finalización ya commiteada.
   */
  cargarReservaDetalle(
    comando: FinalizarEventoComando,
  ): Promise<ReservaHidratadaFinalizacion | null>;
  dispararE5: DispararE5Port;
  documentacion: DocumentacionEventoPort;
}

// ---------------------------------------------------------------------------
// Errores de dominio de la aplicación
// ---------------------------------------------------------------------------

/** RESERVA inexistente o de otro tenant (invisible bajo RLS) → 404. */
export class ReservaNoEncontradaError extends Error {
  readonly codigo = 'RESERVA_NO_ENCONTRADA' as const;

  constructor(reservaId: string) {
    super(`La reserva ${reservaId} no existe o no es accesible para el tenant`);
    this.name = 'ReservaNoEncontradaError';
  }
}

/**
 * La RESERVA no está en `evento_en_curso` (estado actual distinto o ya finalizada por una
 * petición concurrente / doble click) → 409 `code: transicion_no_permitida`.
 */
export class TransicionNoPermitidaError extends Error {
  readonly codigo = 'transicion_no_permitida' as const;

  constructor() {
    super(
      'La reserva no está en evento_en_curso: la transición a post_evento no es aplicable',
    );
    this.name = 'TransicionNoPermitidaError';
  }
}

// ---------------------------------------------------------------------------
// Caso de uso
// ---------------------------------------------------------------------------

const E5_NO_APLICA: ResultadoDispararE5 = { resultado: 'no_aplica', comunicacionId: null };

export class FinalizarEventoUseCase {
  constructor(private readonly deps: FinalizarEventoDeps) {}

  async ejecutar(
    comando: FinalizarEventoComando,
  ): Promise<FinalizarEventoResultado> {
    // 0. Cargar la RESERVA bajo RLS del tenant del JWT. `null` → 404 (inexistente / otro tenant).
    const reserva = await this.deps.cargarReserva(comando);
    if (reserva === null) {
      throw new ReservaNoEncontradaError(comando.reservaId);
    }

    // 1. Guarda de ORIGEN previa a la transacción: solo `evento_en_curso` es candidato.
    //    Cualquier otro estado (incluido `post_evento`: irreversibilidad / 2.ª finalización)
    //    → 409 SIN efectos (sin tx, sin E5, sin AUDIT_LOG).
    const destino = resolverFinalizacionEvento(reserva.estado, reserva.subEstado);
    if (destino === null) {
      throw new TransicionNoPermitidaError();
    }

    // 2. Paso TRANSACCIONAL (crítico): transición atómica bajo `SELECT … FOR UPDATE`.
    await this.deps.unidadDeTrabajo.ejecutar(comando.tenantId, async (repos) => {
      const { filasAfectadas } = await repos.reservas.finalizarEvento({
        reservaId: reserva.idReserva,
        tenantId: comando.tenantId,
        estadoOrigen: reserva.estado,
        estadoDestino: destino.estado,
        npsProgramada: true,
        // US-037 (D-2=A): sella el instante de entrada a `post_evento` (reloj del T+7d).
        fechaPostEvento: new Date(),
      });

      // Carrera de doble finalización perdida (D-8): bajo el lock el estado ya cambió → 0
      // filas → conflicto, sin auditar ni disparar E5 (aborta la transacción).
      if (filasAfectadas === 0) {
        throw new TransicionNoPermitidaError();
      }

      // AUDIT_LOG de la TRANSICIÓN — origen Usuario (usuarioId poblado, D-5).
      await repos.auditoria.registrar({
        tenantId: comando.tenantId,
        usuarioId: comando.usuarioId,
        accion: 'transicion',
        entidad: 'RESERVA',
        entidadId: reserva.idReserva,
        datosAnteriores: { estado: reserva.estado },
        datosNuevos: { estado: destino.estado },
      });

      // Alerta de DATO ANÓMALO (D-4): `fianza_status='cobrada'` con `fianza_eur IS NULL`.
      // No bloquea, no envía E5; solo deja rastro auditable.
      if (this.esDatoAnomaloFianza(reserva)) {
        await repos.auditoria.registrar({
          tenantId: comando.tenantId,
          usuarioId: comando.usuarioId,
          accion: 'actualizar',
          entidad: 'RESERVA',
          entidadId: reserva.idReserva,
          datosNuevos: {
            motivo: MOTIVO_DATO_ANOMALO_FIANZA,
            fianzaStatus: reserva.fianzaStatus,
            fianzaEur: reserva.fianzaEur,
          },
        });
      }
    });

    // 3. Paso POST-COMMIT (best-effort): E5 solo si corresponde por la guarda de fianza.
    //    (D-2: el envío de E5 queda FUERA de la transacción; su fallo no revierte el estado.)
    const e5 = await this.dispararE5SiProcede(comando, reserva);

    // 4. Advertencia NO bloqueante de documentación (US-033, fail-open D-7).
    const documentacionPendiente = await this.consultarDocumentacionPendiente(comando);

    // 5. Relectura POST-COMMIT de la RESERVA completa para hidratar `allOf(Reserva)` en la
    //    respuesta (contrato). Lectura fuera de la transacción de la transición (D-2): no
    //    afecta a la atomicidad. Best-effort: si no resuelve, se cae a la proyección mínima.
    const reservaHidratada = await this.hidratarReserva(comando);

    // 6. Respuesta: RESERVA completa + resultado de E5 + advertencia.
    return {
      reservaId: reserva.idReserva,
      estado: destino.estado,
      reserva: reservaHidratada,
      e5,
      documentacionPendiente,
    };
  }

  /**
   * Re-lee la RESERVA completa tras el commit para hidratar el `allOf(Reserva)` de la
   * respuesta. Best-effort: una excepción del puerto (o BD no disponible) no debe tumbar la
   * finalización ya commiteada; se devuelve `null` y el controlador cae a la proyección mínima.
   */
  private async hidratarReserva(
    comando: FinalizarEventoComando,
  ): Promise<ReservaHidratadaFinalizacion | null> {
    try {
      return await this.deps.cargarReservaDetalle(comando);
    } catch {
      return null;
    }
  }

  /** Dato anómalo: fianza declarada cobrada pero sin importe (`fianza_eur IS NULL`). */
  private esDatoAnomaloFianza(reserva: ReservaFinalizacion): boolean {
    return reserva.fianzaStatus === 'cobrada' && reserva.fianzaEur === null;
  }

  /**
   * fix-liquidacion-fianza-independientes: la finalización del evento YA NO dispara E5
   * (se elimina la captura de IBAN E5/E8). Siempre devuelve `no_aplica`; el campo `e5`
   * del contrato se conserva por compatibilidad pero nunca envía ningún email.
   */
  private async dispararE5SiProcede(
    _comando: FinalizarEventoComando,
    _reserva: ReservaFinalizacion,
  ): Promise<ResultadoDispararE5> {
    return E5_NO_APLICA;
  }

  /** Lee los ítems de documentación pendientes; fail-open a `[]` si el puerto no responde. */
  private async consultarDocumentacionPendiente(
    comando: FinalizarEventoComando,
  ): Promise<string[]> {
    try {
      return await this.deps.documentacion.itemsPendientes(
        comando.reservaId,
        comando.tenantId,
      );
    } catch {
      return [];
    }
  }
}

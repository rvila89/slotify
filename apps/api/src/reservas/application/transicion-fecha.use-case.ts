/**
 * Caso de uso de APLICACIÓN: transición de una consulta exploratoria existente
 * `2.a` a consulta con fecha `2.b` / cola `2.d` (US-005 / UC-04).
 *
 * A diferencia del alta (US-004, que CREA un lead nuevo), aquí el agregado RESERVA
 * YA existe en `sub_estado = '2a'` y lo que cambia es su sub-estado + disponibilidad
 * de fecha. El núcleo se REUTILIZA de US-004/US-040 (regla dura del proyecto: no se
 * reinventa el bloqueo):
 *   - regla de fecha `> hoy`: `esFechaEstrictamenteFutura` (US-040, §D-1 aprobado).
 *   - guarda de ORIGEN `2.a` declarativa: `esOrigenValidoParaAnadirFecha` (maquina).
 *   - destino del sub-estado: `determinarAltaConFecha` + tabla declarativa.
 *   - plan de bloqueo blando: `resolverPlanBloqueo({ fase: '2.b', … })`.
 *   - bloqueo atómico (`SELECT … FOR UPDATE` + UNIQUE) vía el puerto tx-bound
 *     (adaptador reusa `bloquearEnTx`); cola serializada por la fila bloqueante.
 *
 * Orden (design.md §D-1..§D-6):
 *   0. Validaciones PREVIAS a abrir la transacción (rechazo SIN efectos):
 *      0.a fecha estrictamente futura (`> hoy`) → `TransicionFechaValidacionError`.
 *      0.b (dentro de la lectura de la RESERVA) existencia + guarda de origen `2.a`.
 *   1. (dentro de la UoW = 1 sola tx + RLS) leer RESERVA, validar origen, leer estado
 *      de la fecha, ramificar:
 *      - LIBRE → UPDATE `2.b` + `fecha_evento` + `ttl` + INSERT FECHA_BLOQUEADA blando
 *        + COMUNICACION (borrador) + AUDIT_LOG `accion='transicion'`.
 *      - bloqueada por `2.b` + `aceptarCola` → UPDATE `2.d` + `posicion_cola` (MAX+1
 *        serializado) + `consulta_bloqueante_id` (SIN nuevo bloqueo) + AUDIT_LOG.
 *      - bloqueada por `2.b` sin `aceptarCola` → `AsignarFechaConflictoError`
 *        (`colaDisponible:true`), permanece `2.a`, sin efectos.
 *      - bloqueada por estado no encolable → `AsignarFechaConflictoError`
 *        (`colaDisponible:false`), permanece `2.a`, sin efectos (incluso con cola).
 *   2. (POST-COMMIT, solo rama `2.b`) enviar el email de confirmación de bloqueo
 *      provisional (extensión de E1 vía motor US-045). NO bloqueante: un fallo NO
 *      revierte la transición ya comprometida.
 *
 * Hexagonal: depende SOLO de puertos inyectados; no importa Prisma ni `@nestjs/*`.
 * La determinación del sub-estado vive DENTRO del cuerpo transaccional para que un
 * reintento tras colisión D4 (gestionado por el adaptador de la UoW) re-evalúe la
 * rama con la fecha ya bloqueada (re-derivación a `2.d`).
 */
import type {
  AuditLogPort,
  RegistroAuditoria,
} from '../../shared/audit/audit-log.port';
import {
  esFechaEstrictamenteFutura,
  resolverPlanBloqueo,
  type ClockPort,
  type TenantSettingsPort,
} from '../domain/bloquear-fecha.service';
import {
  determinarAltaConFecha,
  esOrigenValidoParaAnadirFecha,
  type EstadoReserva,
  type SubEstadoConsulta,
} from '../domain/maquina-estados';

export type { ClockPort };

/** Días de TTL del bloqueo blando por defecto si el tenant no tiene settings. */
const TTL_CONSULTA_DIAS_DEFECTO = 3;

// ---------------------------------------------------------------------------
// Tipos de dominio del comando / resultado
// ---------------------------------------------------------------------------

/** Comando de entrada de la transición «añadir fecha». */
export interface TransicionFechaComando {
  /** Tenant del gestor (del JWT, nunca del body/path). */
  tenantId: string;
  /** Identificador del gestor que ejecuta la transición (para auditoría). */
  usuarioId: string;
  /** RESERVA destino de la transición (debe existir y estar en `2.a`). */
  reservaId: string;
  /** Fecha del evento a añadir; debe ser estrictamente futura (`> hoy`). */
  fechaEvento: Date;
  /**
   * Resuelve el flujo interactivo de cola (FA-01) sin estado servidor intermedio: si
   * la fecha está bloqueada por una consulta en `2.b`, `true` confirma la entrada en
   * `2.d`; ausente/`false` informa (409 `colaDisponible:true`) sin mutar.
   */
  aceptarCola?: boolean;
}

/**
 * Proyección de la RESERVA relevante para la transición (origen y resultado). El
 * `clienteEmail` viaja para el email de confirmación post-commit (rama `2.b`).
 */
export interface ReservaTransicion {
  idReserva: string;
  tenantId: string;
  clienteId: string;
  estado: EstadoReserva;
  subEstado: SubEstadoConsulta | null;
  ttlExpiracion: Date | null;
  fechaEvento: Date | null;
  posicionCola: number | null;
  consultaBloqueanteId: string | null;
  clienteEmail: string;
}

/** Resultado de la transición: la RESERVA en su sub-estado destino (`2b`/`2d`). */
export interface TransicionFechaResultado {
  reserva: ReservaTransicion;
}

// ---------------------------------------------------------------------------
// Puertos (interfaces) — implementados en infraestructura (adaptadores Prisma)
// ---------------------------------------------------------------------------

/**
 * Estado de disponibilidad de la fecha leído DENTRO de la transacción.
 * `reservaBloqueanteId` identifica la RESERVA dueña del bloqueo (para enlazar la
 * cola en `2.d`).
 */
export type EstadoFechaTransicion =
  | { tipo: 'libre' }
  | {
      tipo: 'bloqueada';
      subEstadoBloqueante: SubEstadoConsulta | null;
      estadoBloqueante: EstadoReserva;
      reservaBloqueanteId: string;
    };

/** Parámetros de actualización de la RESERVA dentro de la transición. */
export interface ActualizarReservaTransicionParams {
  idReserva: string;
  subEstado: SubEstadoConsulta;
  fechaEvento?: Date;
  ttlExpiracion?: Date | null;
  posicionCola?: number | null;
  consultaBloqueanteId?: string | null;
}

/** Repositorio de RESERVA tx-bound: lee el origen y aplica el UPDATE de transición. */
export interface ReservaTransicionRepositoryPort {
  /** Lee la RESERVA por id bajo el contexto RLS del tenant; `null` si no existe. */
  buscarPorId(params: {
    tenantId: string;
    reservaId: string;
  }): Promise<ReservaTransicion | null>;
  /** Aplica el UPDATE del sub-estado destino y devuelve la RESERVA actualizada. */
  actualizar(
    params: ActualizarReservaTransicionParams,
  ): Promise<ReservaTransicion>;
}

/**
 * Repositorio tx-bound del bloqueo/cola de FECHA_BLOQUEADA para la transición. Vive
 * dentro de la MISMA transacción (atomicidad RESERVA `2.b` + `FECHA_BLOQUEADA`),
 * reutilizando `bloquearEnTx` de US-040 y la serialización de cola de US-004.
 */
export interface FechaBloqueadaTransicionRepositoryPort {
  /** Lee el estado de la fecha (libre / bloqueada por X) bajo el contexto RLS. */
  leerEstadoFecha(params: {
    tenantId: string;
    fecha: Date;
  }): Promise<EstadoFechaTransicion>;
  /** Inserta el bloqueo blando de la RESERVA `2.b` (UNIQUE → P2002 reintentable). */
  bloquear(params: {
    tenantId: string;
    fecha: Date;
    reservaId: string;
    ttlExpiracion: Date;
  }): Promise<void>;
  /**
   * Calcula la siguiente posición de cola (`MAX+1`) serializando con `SELECT … FOR
   * UPDATE` sobre la fila `FECHA_BLOQUEADA` bloqueante (sin locks distribuidos).
   */
  siguientePosicionCola(params: {
    tenantId: string;
    fecha: Date;
    consultaBloqueanteId: string;
  }): Promise<number>;
}

/** Parámetros de creación de la COMUNICACION de confirmación de bloqueo provisional. */
export interface CrearComunicacionTransicionParams {
  tenantId: string;
  reservaId: string;
  clienteId: string;
  codigoEmail: 'E1';
  estado: 'borrador';
  asunto: string;
  cuerpo: string;
  destinatarioEmail: string;
  fechaEnvio: Date | null;
}

/** Proyección de la COMUNICACION creada en la transición. */
export interface ComunicacionTransicion {
  idComunicacion: string;
  tenantId: string;
  reservaId: string;
  clienteId: string;
  codigoEmail: 'E1';
  estado: 'borrador' | 'enviado' | 'fallido';
  destinatarioEmail: string;
  fechaEnvio: Date | null;
}

/** Repositorio de COMUNICACION tx-bound (extensión de E1 para el bloqueo provisional). */
export interface ComunicacionTransicionRepositoryPort {
  crear(
    params: CrearComunicacionTransicionParams,
  ): Promise<ComunicacionTransicion>;
}

/** Conjunto de repositorios disponibles dentro de la unidad de trabajo. */
export interface RepositoriosTransicionFecha {
  reservas: ReservaTransicionRepositoryPort;
  fechaBloqueada: FechaBloqueadaTransicionRepositoryPort;
  comunicaciones: ComunicacionTransicionRepositoryPort;
  auditoria: AuditLogPort;
}

/**
 * Unidad de trabajo transaccional. El adaptador envuelve `$transaction` +
 * `fijarTenant(tenantId)` (RLS) y expone los repositorios ligados a esa transacción,
 * con retry-on-conflict de `P2002` (re-derivación D4 a `2.d`). Si el `trabajo`
 * rechaza con un error no reintentable, la transacción revierte (rollback total).
 */
export interface UnidadDeTrabajoTransicionPort {
  ejecutar(
    tenantId: string,
    trabajo: (repos: RepositoriosTransicionFecha) => Promise<unknown>,
  ): Promise<unknown>;
}

/** Parámetros del envío POST-COMMIT del email de confirmación de bloqueo provisional. */
export interface EnviarConfirmacionBloqueoParams {
  tenantId: string;
  reservaId: string;
  idComunicacion: string;
  destinatario: string;
  asunto: string;
  cuerpo: string;
}

/** Estado terminal alcanzado tras el intento de envío post-commit. */
export interface EnviarConfirmacionBloqueoResultado {
  estado: 'enviado' | 'fallido';
  fechaEnvio: Date | null;
}

/**
 * Puerto del email de confirmación de bloqueo provisional (extensión de E1 vía motor
 * US-045). Se invoca POST-COMMIT, fuera de la transacción: el adaptador centraliza el
 * try/catch del proveedor y NUNCA propaga la excepción que tumbe la transición.
 */
export interface ConfirmacionBloqueoEmailPort {
  enviarConfirmacionBloqueoProvisional(
    params: EnviarConfirmacionBloqueoParams,
  ): Promise<EnviarConfirmacionBloqueoResultado>;
}

/** Dependencias del caso de uso (puertos inyectados). */
export interface TransicionFechaDeps {
  unidadDeTrabajo: UnidadDeTrabajoTransicionPort;
  confirmacionBloqueo: ConfirmacionBloqueoEmailPort;
  clock: ClockPort;
  /** Settings del tenant para el TTL del bloqueo blando (now()+ttl_consulta_dias). */
  tenantSettings: TenantSettingsPort;
}

// ---------------------------------------------------------------------------
// Errores de dominio tipados, en español
// ---------------------------------------------------------------------------

/**
 * La transición no supera una validación previa (fecha no válida o RESERVA no en
 * `2.a`): se rechaza SIN tocar la BD. Mapea a HTTP 4xx (400 fecha / 422 guarda).
 */
export class TransicionFechaValidacionError extends Error {
  readonly codigo = 'TRANSICION_FECHA_VALIDACION' as const;
  /**
   * Discrimina el tipo de violación para el mapeo HTTP (D-7): `fecha` (fecha no
   * válida → 400) vs `guarda` (la RESERVA no está en `2.a` → 422). El comportamiento
   * de dominio es idéntico (rechazo SIN efectos); solo cambia el código de estado.
   */
  readonly tipo: 'fecha' | 'guarda';

  constructor(mensaje: string, tipo: 'fecha' | 'guarda' = 'guarda') {
    super(mensaje);
    this.name = 'TransicionFechaValidacionError';
    this.tipo = tipo;
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

/**
 * La fecha no se puede asignar de inmediato; la RESERVA permanece en `2.a`. Mapea a
 * HTTP 409 con el flujo interactivo de cola (`colaDisponible:true` → ofrecer cola;
 * `colaDisponible:false` → no disponible, sin cola).
 */
export class AsignarFechaConflictoError extends Error {
  readonly codigo = 'ASIGNAR_FECHA_CONFLICTO' as const;
  readonly colaDisponible: boolean;
  readonly motivo?: string;

  constructor(colaDisponible: boolean, motivo?: string) {
    super(motivo ?? 'La fecha no está disponible para asignación inmediata');
    this.name = 'AsignarFechaConflictoError';
    this.colaDisponible = colaDisponible;
    this.motivo = motivo;
  }
}

// ---------------------------------------------------------------------------
// Plantilla E1 (extensión: confirmación de bloqueo provisional)
// ---------------------------------------------------------------------------

const ASUNTO_CONFIRMACION_BLOQUEO = 'Hemos reservado provisionalmente tu fecha';
const CUERPO_CONFIRMACION_BLOQUEO =
  'Hemos bloqueado provisionalmente la fecha de tu evento mientras avanzamos con tu consulta. Te confirmaremos la disponibilidad definitiva en breve.';

const MOTIVO_COLA =
  'La fecha está reservada por otra consulta; puedes entrar en la lista de espera.';
const MOTIVO_NO_DISPONIBLE =
  'La fecha seleccionada no está disponible y no admite lista de espera.';

// ---------------------------------------------------------------------------
// Caso de uso
// ---------------------------------------------------------------------------

export class TransicionFechaUseCase {
  constructor(private readonly deps: TransicionFechaDeps) {}

  async ejecutar(
    comando: TransicionFechaComando,
  ): Promise<TransicionFechaResultado> {
    const ahora = this.deps.clock.ahora();

    // 0.a Validación de fecha estrictamente futura (`> hoy`, §D-1): rechaza hoy y
    //     pasado ANTES de abrir la transacción (sin efectos).
    if (!esFechaEstrictamenteFutura(comando.fechaEvento, ahora)) {
      throw new TransicionFechaValidacionError(
        'La fecha del evento debe ser estrictamente futura (posterior a hoy)',
        'fecha',
      );
    }

    const ttlBloqueo = await this.calcularTtlConsulta(comando.tenantId, ahora);

    // 1. Toda la lectura/escritura, dentro de UNA unidad de trabajo (tx + RLS). La
    //    determinación del sub-estado vive DENTRO del cuerpo transaccional para que
    //    un reintento tras colisión D4 re-evalúe la rama con la fecha ya bloqueada.
    const resultado = (await this.deps.unidadDeTrabajo.ejecutar(
      comando.tenantId,
      async (
        repos,
      ): Promise<{
        reserva: ReservaTransicion;
        emailPendiente: ComunicacionTransicion | null;
      }> => {
        // Lectura + existencia (RLS: cross-tenant → null → 404).
        const reserva = await repos.reservas.buscarPorId({
          tenantId: comando.tenantId,
          reservaId: comando.reservaId,
        });
        if (reserva === null) {
          throw new ReservaNoEncontradaError(comando.reservaId);
        }

        // Guarda de origen declarativa: solo `consulta/2a` es origen legal (§D-3).
        if (!esOrigenValidoParaAnadirFecha(reserva.estado, reserva.subEstado)) {
          throw new TransicionFechaValidacionError(
            'La transición de fecha solo es válida desde una consulta exploratoria (sub-estado 2a)',
          );
        }

        // Estado de la fecha bajo el contexto RLS y destino declarativo (§D-3).
        const estadoFecha = await repos.fechaBloqueada.leerEstadoFecha({
          tenantId: comando.tenantId,
          fecha: comando.fechaEvento,
        });
        const destino = determinarAltaConFecha(estadoFecha);

        // Rama LIBRE → 2.b + bloqueo blando + COMUNICACION + AUDIT_LOG.
        if (destino.accion === 'bloquear') {
          return this.transicionarABloqueoBlando(
            repos,
            comando,
            reserva,
            ttlBloqueo,
          );
        }

        // Rama bloqueada por 2.b → cola (interactiva): solo si el gestor acepta.
        if (destino.accion === 'encolar' && estadoFecha.tipo === 'bloqueada') {
          if (comando.aceptarCola !== true) {
            throw new AsignarFechaConflictoError(true, MOTIVO_COLA);
          }
          return this.transicionarACola(repos, comando, reserva, estadoFecha);
        }

        // Rama bloqueada por estado no encolable → sin cola, permanece 2.a.
        throw new AsignarFechaConflictoError(false, MOTIVO_NO_DISPONIBLE);
      },
    )) as {
      reserva: ReservaTransicion;
      emailPendiente: ComunicacionTransicion | null;
    };

    // 2. Efecto POST-COMMIT (solo rama 2.b): enviar el email de confirmación de
    //    bloqueo provisional. NO bloqueante: un fallo NO revierte la transición ya
    //    comprometida (RESERVA 2.b + FECHA_BLOQUEADA).
    if (resultado.emailPendiente !== null) {
      await this.enviarConfirmacionTolerante(
        comando,
        resultado.reserva,
        resultado.emailPendiente,
      );
    }

    return { reserva: resultado.reserva };
  }

  /**
   * Rama LIBRE (`2.a → 2.b`): UPDATE de la RESERVA + INSERT del bloqueo blando + la
   * COMUNICACION (borrador) + AUDIT_LOG `accion='transicion'`, todo en la misma tx.
   * Devuelve la COMUNICACION pendiente de envío post-commit.
   */
  private async transicionarABloqueoBlando(
    repos: RepositoriosTransicionFecha,
    comando: TransicionFechaComando,
    reserva: ReservaTransicion,
    ttlBloqueo: Date,
  ): Promise<{ reserva: ReservaTransicion; emailPendiente: ComunicacionTransicion }> {
    const actualizada = await repos.reservas.actualizar({
      idReserva: reserva.idReserva,
      subEstado: '2b',
      fechaEvento: comando.fechaEvento,
      ttlExpiracion: ttlBloqueo,
      posicionCola: null,
      consultaBloqueanteId: null,
    });

    // Bloqueo atómico en la MISMA tx (reusa `bloquearEnTx` vía el adaptador). El
    // `P2002` (UNIQUE `(tenant_id, fecha)`) se propaga para el retry de la UoW (D4).
    await repos.fechaBloqueada.bloquear({
      tenantId: comando.tenantId,
      fecha: comando.fechaEvento,
      reservaId: reserva.idReserva,
      ttlExpiracion: ttlBloqueo,
    });

    // COMUNICACION de confirmación de bloqueo provisional: nace `borrador` en la tx
    // (atomicidad); el estado terminal lo decide el envío post-commit (US-045).
    const comunicacion = await repos.comunicaciones.crear({
      tenantId: comando.tenantId,
      reservaId: reserva.idReserva,
      clienteId: reserva.clienteId,
      codigoEmail: 'E1',
      estado: 'borrador',
      asunto: ASUNTO_CONFIRMACION_BLOQUEO,
      cuerpo: CUERPO_CONFIRMACION_BLOQUEO,
      destinatarioEmail: reserva.clienteEmail,
      fechaEnvio: null,
    });

    await repos.auditoria.registrar(
      this.registroTransicion(comando, reserva, {
        subEstado: '2b',
        fechaEvento: comando.fechaEvento,
      }),
    );

    return { reserva: actualizada, emailPendiente: comunicacion };
  }

  /**
   * Rama bloqueada por `2.b` con `aceptarCola`: UPDATE de la RESERVA a `2.d` con la
   * posición de cola serializada (MAX+1) y la bloqueante; SIN nuevo FECHA_BLOQUEADA
   * (la fecha ya la bloquea la `2.b`). AUDIT_LOG `accion='transicion'`. Sin email.
   */
  private async transicionarACola(
    repos: RepositoriosTransicionFecha,
    comando: TransicionFechaComando,
    reserva: ReservaTransicion,
    estadoFecha: Extract<EstadoFechaTransicion, { tipo: 'bloqueada' }>,
  ): Promise<{ reserva: ReservaTransicion; emailPendiente: null }> {
    const posicionCola = await repos.fechaBloqueada.siguientePosicionCola({
      tenantId: comando.tenantId,
      fecha: comando.fechaEvento,
      consultaBloqueanteId: estadoFecha.reservaBloqueanteId,
    });

    const actualizada = await repos.reservas.actualizar({
      idReserva: reserva.idReserva,
      subEstado: '2d',
      fechaEvento: comando.fechaEvento,
      ttlExpiracion: null,
      posicionCola,
      consultaBloqueanteId: estadoFecha.reservaBloqueanteId,
    });

    await repos.auditoria.registrar(
      this.registroTransicion(comando, reserva, {
        subEstado: '2d',
        fechaEvento: comando.fechaEvento,
        posicionCola,
        consultaBloqueanteId: estadoFecha.reservaBloqueanteId,
      }),
    );

    return { reserva: actualizada, emailPendiente: null };
  }

  /** Construye el registro de AUDIT_LOG `accion='transicion'` de `2.a → destino`. */
  private registroTransicion(
    comando: TransicionFechaComando,
    reserva: ReservaTransicion,
    datosNuevos: Record<string, unknown>,
  ): RegistroAuditoria {
    return {
      tenantId: comando.tenantId,
      accion: 'transicion',
      entidad: 'RESERVA',
      entidadId: reserva.idReserva,
      usuarioId: comando.usuarioId,
      datosAnteriores: { subEstado: '2a' },
      datosNuevos,
    };
  }

  /** Calcula el TTL del bloqueo blando (now()+ttl_consulta_dias del tenant). */
  private async calcularTtlConsulta(tenantId: string, ahora: Date): Promise<Date> {
    const settings = await this.deps.tenantSettings.obtener(tenantId);
    const plan = resolverPlanBloqueo({
      fase: '2.b',
      ahora,
      settings: {
        ttlConsultaDias: settings?.ttlConsultaDias ?? TTL_CONSULTA_DIAS_DEFECTO,
        ttlPrereservaDias: settings?.ttlPrereservaDias ?? TTL_CONSULTA_DIAS_DEFECTO,
      },
    });
    return plan.ttl ?? new Date(ahora.getTime());
  }

  /**
   * Envío POST-COMMIT TOLERANTE del email de confirmación de bloqueo provisional: un
   * fallo del proveedor NO debe propagar (la transición ya commiteó). El puerto del
   * motor US-045 centraliza el try/catch; aquí se blinda como defensa en profundidad.
   */
  private async enviarConfirmacionTolerante(
    comando: TransicionFechaComando,
    reserva: ReservaTransicion,
    comunicacion: ComunicacionTransicion,
  ): Promise<void> {
    try {
      await this.deps.confirmacionBloqueo.enviarConfirmacionBloqueoProvisional({
        tenantId: comando.tenantId,
        reservaId: reserva.idReserva,
        idComunicacion: comunicacion.idComunicacion,
        destinatario: reserva.clienteEmail,
        asunto: ASUNTO_CONFIRMACION_BLOQUEO,
        cuerpo: CUERPO_CONFIRMACION_BLOQUEO,
      });
    } catch {
      // El fallo de email no revierte la transición (post-commit, no bloqueante).
    }
  }
}

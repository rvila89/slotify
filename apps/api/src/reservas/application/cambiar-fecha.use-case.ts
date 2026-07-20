/**
 * Caso de uso de APLICACIÓN `CambiarFechaUseCase`
 * (US-051 §Punto 2 / UC-05/UC-12/UC-18, actor Gestor).
 *
 * Operación ATÓMICA «cambiar una fecha YA bloqueada» de una RESERVA (`POST
 * /reservas/{id}/cambiar-fecha`): cambiar de F1 a F2 es, atómicamente, LIBERAR la antigua
 * + BLOQUEAR la nueva en UNA sola transacción con `SELECT … FOR UPDATE` (design.md
 * §D-2.1). A diferencia de la ASIGNACIÓN de la primera fecha (US-005, `2a → 2b/2d`), aquí
 * la RESERVA ya tiene fecha bloqueada (`2b/2c/2v`) y se mueve a otra CONSERVANDO su
 * estado/subEstado.
 *
 * Orden (rechazos SIN efectos ANTES de abrir la transacción):
 *   0. Validación de fecha nueva estrictamente futura (`> hoy`) →
 *      `CambiarFechaValidacionError` (`tipo:'fecha'` → 422). Antes de tocar la BD.
 *   1. (dentro de la UoW = 1 sola tx + RLS, `SELECT … FOR UPDATE` sobre RESERVA y sobre
 *      `FECHA_BLOQUEADA(tenant, F2)`):
 *      - leer la RESERVA; `null` → 404.
 *      - guarda de origen declarativa (`esOrigenValidoParaCambiarFecha`: solo `2b/2c/2v`);
 *        el resto → `CambiarFechaValidacionError` (`tipo:'guarda'` → 422).
 *      - leer el estado de F2:
 *          · LIBRE → `bloquear(F2)` + `RESERVA.fecha_evento=F2` + `liberar(F1)`; si F1
 *            tenía cola, disparar la promoción FIFO (A15) del primero EXACTAMENTE una vez.
 *            AUDIT_LOG `actualizar` (F1→F2).
 *          · OCUPADA por otra RESERVA → `CambiarFechaConflictoError` (409), rollback total.
 *
 * PROHIBIDO Redis/Redlock/locks distribuidos (`CLAUDE.md §Regla crítica`, hook
 * `no-distributed-lock`): la serialización y la atomicidad las da PostgreSQL
 * (`SELECT … FOR UPDATE` + `UNIQUE(tenant_id, fecha)`).
 *
 * Hexagonal (hook `no-infra-in-domain`): depende SOLO de puertos inyectados; no importa
 * Prisma ni `@nestjs/*`. Toda la lectura/escritura vive DENTRO del cuerpo transaccional
 * (la re-evaluación de la guarda de origen bajo el lock la re-verifica el adaptador).
 */
import type { AuditLogPort } from '../../shared/audit/audit-log.port';
import {
  esFechaEstrictamenteFutura,
  type ClockPort,
} from '../domain/bloquear-fecha.service';
import {
  esOrigenCambiarFechaEnCola,
  esOrigenValidoParaCambiarFecha,
  type EstadoReserva,
  type SubEstadoConsulta,
} from '../domain/maquina-estados';
import {
  planificarSalidaDeCola,
  type EntradaColaSalida,
} from '../domain/salida-de-cola';
import type { SubtipoEmail } from '../../comunicaciones/domain/subtipo-email';

export type { ClockPort };

// ---------------------------------------------------------------------------
// Tipos del dominio de la aplicación
// ---------------------------------------------------------------------------

/** Comando de entrada de la operación «cambiar fecha». */
export interface CambiarFechaComando {
  /** Tenant del JWT (nunca del path/body): contexto RLS de toda la operación. */
  tenantId: string;
  /** Gestor autenticado (JWT): origen Usuario del AUDIT_LOG. */
  usuarioId: string;
  /** RESERVA cuya fecha se cambia (debe estar en `2b/2c/2v` con fecha bloqueada). */
  reservaId: string;
  /** Nueva fecha del evento; debe ser estrictamente futura (`> hoy`). */
  fechaEvento: Date;
}

/** Proyección mínima de la RESERVA relevante para el cambio (origen). */
export interface ReservaCambioFecha {
  idReserva: string;
  tenantId: string;
  estado: EstadoReserva;
  subEstado: SubEstadoConsulta | null;
  /** Fecha ANTIGUA (ya bloqueada) que se liberará. */
  fechaEvento: Date | null;
  /**
   * (Rama `2d`) Posición de la RESERVA en la cola vieja. `null`/ausente en la rama
   * `2b/2c/2v` (que no está en cola).
   */
  posicionCola?: number | null;
  /**
   * (Rama `2d`) RESERVA que bloquea la fecha de la cola vieja. `null`/ausente en la rama
   * `2b/2c/2v`.
   */
  consultaBloqueanteId?: string | null;
  /** Cliente de la RESERVA, para enlazar el borrador E1 (ambas ramas). */
  clienteId?: string;
  /** Idioma de la RESERVA (`'ca'` → catalán; cualquier otro → castellano; ambas ramas). */
  idioma?: string;
  /** Nombre de pila del cliente, para el saludo del borrador E1 (ambas ramas). */
  clienteNombre?: string;
  /** Email del cliente, destinatario del borrador E1 (ambas ramas). */
  clienteEmail?: string;
  /** Nº de invitados final; `null` → placeholder `___` en el E1 (ambas ramas). */
  numInvitadosFinal?: number | null;
  /** Horas del evento; `null` → placeholder `___` en el E1 (ambas ramas). */
  duracionHoras?: number | null;
}

/** Resultado del cambio: la RESERVA con su nueva `fechaEvento` (estado/subEstado intactos). */
export interface CambiarFechaResultado {
  reserva: ReservaCambioFecha;
}

// ---------------------------------------------------------------------------
// Puertos (interfaces) — implementados en infraestructura (adaptadores Prisma)
// ---------------------------------------------------------------------------

/**
 * Estado de disponibilidad de la fecha NUEVA leído DENTRO de la transacción bajo el lock
 * (`SELECT … FOR UPDATE`). `bloqueada` identifica la RESERVA dueña del bloqueo (para el
 * conflicto).
 */
export type EstadoFechaDestino =
  | { tipo: 'libre' }
  | {
      tipo: 'bloqueada';
      reservaBloqueanteId: string;
      estadoBloqueante: EstadoReserva;
      subEstadoBloqueante: SubEstadoConsulta | null;
    };

/**
 * Reordenamiento de un hermano de la cola vieja (rama `2d`): su nueva `posicion_cola` tras
 * cerrar el hueco de la saliente. NO re-apunta `consulta_bloqueante_id` (la bloqueante no
 * cambia).
 */
export interface ReordenamientoCola {
  idReserva: string;
  posicionCola: number;
}

/** Entrada de la cola hermana (rama `2d`) leída para reordenar tras la salida. */
export interface EntradaColaHermana {
  reservaId: string;
  subEstado: SubEstadoConsulta;
  posicionCola: number;
  consultaBloqueanteId: string;
}

/** Repositorio de RESERVA tx-bound: lee el origen (bajo lock) y actualiza la fecha. */
export interface ReservaCambioFechaRepositoryPort {
  /** `SELECT … FOR UPDATE` de la RESERVA por id bajo RLS; `null` si no existe. */
  buscarPorId(params: {
    tenantId: string;
    reservaId: string;
  }): Promise<ReservaCambioFecha | null>;
  /** `UPDATE reserva SET fecha_evento=? WHERE id=?` (NO toca estado/subEstado). */
  actualizarFecha(params: {
    idReserva: string;
    fechaEvento: Date;
  }): Promise<ReservaCambioFecha>;
  /**
   * (Rama `2d`) Saca la RESERVA de la cola y la pasa a `2b`: `fecha_evento=F2`,
   * `sub_estado 2d→2b`, `posicion_cola→NULL`, `consulta_bloqueante_id→NULL`, fijando el
   * `ttl_expiracion` del bloqueo blando (el TTL lo resuelve el adaptador con los settings
   * del tenant, coherente con `bloquear`).
   */
  moverFueraDeCola(params: {
    idReserva: string;
    fechaEvento: Date;
  }): Promise<ReservaCambioFecha>;
  /**
   * (Rama `2d`) Lee los hermanos de la cola vieja (mismo `consulta_bloqueante_id`) bajo
   * `SELECT … FOR UPDATE` para calcular la reordenación tras la salida.
   */
  leerColaHermana(params: {
    tenantId: string;
    consultaBloqueanteId: string;
  }): Promise<EntradaColaHermana[]>;
  /**
   * (Rama `2d`) Aplica los decrementos de posición de la cola vieja (orden ascendente
   * para no violar el índice UNIQUE parcial). NO re-apunta la bloqueante.
   */
  reordenarCola(reordenamientos: ReordenamientoCola[]): Promise<void>;
}

/** Parámetros de creación del borrador E1 (rama `2d`) en la misma transacción. */
export interface CrearBorradorE1Params {
  tenantId: string;
  reservaId: string;
  clienteId: string;
  codigoEmail: 'E1';
  estado: 'borrador';
  /** Rama de la plantilla de transición de fecha: siempre `'disponible'`. */
  tipo: 'disponible';
  idioma: string;
  clienteNombre: string;
  clienteEmail: string;
  fechaEvento: Date;
  personas: number | null;
  horas: number | null;
  fechaEnvio: null;
  /**
   * Subtipo semántico del E1 (change `historial-completo-comunicaciones`, §D-subtipo).
   * Dependiente de la RAMA, NO del `tipo` de plantilla: la salida de cola a fecha libre
   * (2d → 2b) es una `fecha_disponible`; el cambio de fecha de una 2b es un `cambio_fecha`.
   */
  subtipo: SubtipoEmail;
}

/** Puerto de COMUNICACION tx-bound: crea el borrador E1 `'disponible'` (rama `2d`). */
export interface ComunicacionesCambioFechaPort {
  crearBorradorE1(params: CrearBorradorE1Params): Promise<void>;
}

/**
 * Repositorio tx-bound del bloqueo de FECHA_BLOQUEADA para el cambio. Vive dentro de la
 * MISMA transacción (atomicidad liberar-antigua + bloquear-nueva), reutilizando las
 * primitivas `bloquearEnTx`/`liberar` (US-040/US-041).
 */
export interface FechaBloqueadaCambioRepositoryPort {
  /** Lee el estado de la fecha NUEVA (libre / bloqueada por X) bajo el lock. */
  leerEstadoFecha(params: {
    tenantId: string;
    fecha: Date;
  }): Promise<EstadoFechaDestino>;
  /** Bloquea la fecha NUEVA para esta RESERVA (blando). `P2002` → conflicto/rollback. */
  bloquear(params: {
    tenantId: string;
    fecha: Date;
    reservaId: string;
  }): Promise<void>;
  /** Libera la fecha ANTIGUA de esta RESERVA (DELETE serializado). */
  liberar(params: {
    tenantId: string;
    fecha: Date;
    reservaId: string;
  }): Promise<void>;
  /** ¿La fecha ANTIGUA tenía una cola activa apuntando a la reserva liberada? */
  tieneCola(params: {
    tenantId: string;
    fecha: Date;
    reservaId: string;
  }): Promise<boolean>;
}

/** Promoción FIFO (A15) del primero en cola de la fecha ANTIGUA liberada (US-018). */
export interface PromocionColaCambioPort {
  promoverPrimeroEnCola(params: { tenantId: string; fecha: Date }): Promise<void>;
}

/** Registro de auditoría del cambio de fecha (origen Usuario, entidad RESERVA). */
export interface RegistroAuditoriaCambiarFecha {
  tenantId: string;
  usuarioId?: string;
  accion: 'actualizar';
  entidad: 'RESERVA';
  entidadId: string;
  datosAnteriores?: Record<string, unknown>;
  datosNuevos?: Record<string, unknown>;
}

/** Conjunto de repositorios disponibles dentro de la unidad de trabajo del cambio. */
export interface RepositoriosCambiarFecha {
  reservas: ReservaCambioFechaRepositoryPort;
  fechaBloqueada: FechaBloqueadaCambioRepositoryPort;
  promocionCola: PromocionColaCambioPort;
  comunicaciones: ComunicacionesCambioFechaPort;
  auditoria: AuditLogPort<RegistroAuditoriaCambiarFecha>;
}

/**
 * Unidad de trabajo transaccional del cambio: abre UNA `$transaction` bajo el contexto
 * RLS del tenant y expone los repos tx-bound. Si el `trabajo` rechaza, la transacción
 * revierte por completo (rollback total, all-or-nothing).
 */
export interface UnidadDeTrabajoCambiarFechaPort {
  ejecutar(
    tenantId: string,
    trabajo: (repos: RepositoriosCambiarFecha) => Promise<unknown>,
  ): Promise<unknown>;
}

/** Dependencias del caso de uso (puertos inyectados, hexagonal). */
export interface CambiarFechaDeps {
  unidadDeTrabajo: UnidadDeTrabajoCambiarFechaPort;
  clock: ClockPort;
}

// ---------------------------------------------------------------------------
// Errores de dominio tipados, en español
// ---------------------------------------------------------------------------

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
 * El cambio no supera una validación previa (fecha no futura o guarda de origen): se
 * rechaza SIN efectos. `tipo` discrimina el mapeo HTTP (ambos → 422 en esta operación,
 * F5-02): `fecha` (fecha no estrictamente futura) vs `guarda` (origen no `2b/2c/2v`).
 */
export class CambiarFechaValidacionError extends Error {
  readonly codigo = 'CAMBIAR_FECHA_VALIDACION' as const;
  readonly tipo: 'fecha' | 'guarda';

  constructor(mensaje: string, tipo: 'fecha' | 'guarda') {
    super(mensaje);
    this.name = 'CambiarFechaValidacionError';
    this.tipo = tipo;
  }
}

/**
 * La fecha NUEVA está ocupada por otra RESERVA: el cambio se rechaza con conflicto y
 * rollback total (la RESERVA conserva su fecha antigua y su bloqueo). Mapea a HTTP 409.
 * A diferencia de la asignación (US-005), aquí NO se ofrece cola: el conflicto es
 * terminal (por eso NO expone `colaDisponible`), solo un `motivo`.
 */
export class CambiarFechaConflictoError extends Error {
  readonly codigo = 'CAMBIAR_FECHA_CONFLICTO' as const;
  readonly motivo: string;

  constructor(motivo: string) {
    super(motivo);
    this.name = 'CambiarFechaConflictoError';
    this.motivo = motivo;
  }
}

// ---------------------------------------------------------------------------
// Mensajes de dominio
// ---------------------------------------------------------------------------

const MOTIVO_CONFLICTO =
  'La fecha destino no está disponible: ya está bloqueada por otra reserva.';

// ---------------------------------------------------------------------------
// Caso de uso
// ---------------------------------------------------------------------------

export class CambiarFechaUseCase {
  constructor(private readonly deps: CambiarFechaDeps) {}

  async ejecutar(comando: CambiarFechaComando): Promise<CambiarFechaResultado> {
    const ahora = this.deps.clock.ahora();

    // 0. Fecha nueva estrictamente futura (`> hoy`): rechaza hoy y pasado ANTES de abrir
    //    la transacción (sin efectos).
    if (!esFechaEstrictamenteFutura(comando.fechaEvento, ahora)) {
      throw new CambiarFechaValidacionError(
        'La fecha del evento debe ser estrictamente futura (posterior a hoy)',
        'fecha',
      );
    }

    // 1. Toda la lectura/escritura, dentro de UNA unidad de trabajo (tx + RLS).
    const resultado = (await this.deps.unidadDeTrabajo.ejecutar(
      comando.tenantId,
      async (repos): Promise<ReservaCambioFecha> => {
        // Lectura + existencia bajo lock (RLS: cross-tenant → null → 404).
        const reserva = await repos.reservas.buscarPorId({
          tenantId: comando.tenantId,
          reservaId: comando.reservaId,
        });
        if (reserva === null) {
          throw new ReservaNoEncontradaError(comando.reservaId);
        }

        // Bifurcación por ORIGEN (guardas declarativas SEPARADAS, §D-1). La rama `2d`
        // (cola de espera) tiene semántica distinta a `2b/2c/2v` (no posee bloqueo propio).
        if (esOrigenCambiarFechaEnCola(reserva.estado, reserva.subEstado)) {
          return this.cambiarDesdeCola(repos, comando, reserva);
        }

        // Guarda de origen declarativa: solo `consulta/{2b,2c,2v}` (§D-2.1). Cualquier
        // otro origen que tampoco sea `2d` → 422 sin efectos.
        if (!esOrigenValidoParaCambiarFecha(reserva.estado, reserva.subEstado)) {
          throw new CambiarFechaValidacionError(
            'Solo se puede cambiar la fecha de una consulta con fecha bloqueada (sub-estado 2b/2c/2v) o en cola (2d)',
            'guarda',
          );
        }

        const fechaAntigua = reserva.fechaEvento;

        // Estado de la fecha NUEVA bajo el lock (`SELECT … FOR UPDATE`).
        const estadoDestino = await repos.fechaBloqueada.leerEstadoFecha({
          tenantId: comando.tenantId,
          fecha: comando.fechaEvento,
        });

        // Fecha nueva OCUPADA por otra RESERVA → conflicto, rollback total (no se muta nada).
        if (estadoDestino.tipo === 'bloqueada') {
          throw new CambiarFechaConflictoError(MOTIVO_CONFLICTO);
        }

        // Fecha nueva LIBRE: bloquear F2 + mover la RESERVA + liberar F1 (atómico).
        await repos.fechaBloqueada.bloquear({
          tenantId: comando.tenantId,
          fecha: comando.fechaEvento,
          reservaId: reserva.idReserva,
        });

        const actualizada = await repos.reservas.actualizarFecha({
          idReserva: reserva.idReserva,
          fechaEvento: comando.fechaEvento,
        });

        // ¿La fecha antigua tenía cola? (se resuelve antes de liberar, para disparar la
        // promoción tras la liberación, exactamente una vez).
        const antiguaTeniaCola =
          fechaAntigua !== null &&
          (await repos.fechaBloqueada.tieneCola({
            tenantId: comando.tenantId,
            fecha: fechaAntigua,
            reservaId: reserva.idReserva,
          }));

        if (fechaAntigua !== null) {
          await repos.fechaBloqueada.liberar({
            tenantId: comando.tenantId,
            fecha: fechaAntigua,
            reservaId: reserva.idReserva,
          });
        }

        // Promoción FIFO (A15) del primero en cola de F1, exactamente una vez.
        if (antiguaTeniaCola && fechaAntigua !== null) {
          await repos.promocionCola.promoverPrimeroEnCola({
            tenantId: comando.tenantId,
            fecha: fechaAntigua,
          });
        }

        // Borrador E1 del cambio de fecha (no autoenviado): nace `borrador` en la MISMA tx
        // e informa al cliente de la NUEVA fecha. Antes esta rama 2b NO generaba ninguna
        // comunicación (hueco real). §D-subtipo: `cambio_fecha` ("Cambio de fecha"), a
        // diferencia de la salida de cola (`fecha_disponible`). Reusa la plantilla
        // `disponible` de transición de fecha ("Pre-reserva confirmada").
        await repos.comunicaciones.crearBorradorE1({
          tenantId: comando.tenantId,
          reservaId: reserva.idReserva,
          clienteId: reserva.clienteId ?? '',
          codigoEmail: 'E1',
          estado: 'borrador',
          tipo: 'disponible',
          idioma: reserva.idioma ?? '',
          clienteNombre: reserva.clienteNombre ?? '',
          clienteEmail: reserva.clienteEmail ?? '',
          fechaEvento: comando.fechaEvento,
          personas: reserva.numInvitadosFinal ?? null,
          horas: reserva.duracionHoras ?? null,
          fechaEnvio: null,
          subtipo: 'cambio_fecha',
        });

        // AUDIT_LOG `actualizar` (F1 → F2), en la misma transacción.
        await repos.auditoria.registrar({
          tenantId: comando.tenantId,
          usuarioId: comando.usuarioId,
          accion: 'actualizar',
          entidad: 'RESERVA',
          entidadId: reserva.idReserva,
          datosAnteriores: { fecha_evento: fechaAntigua },
          datosNuevos: { fecha_evento: comando.fechaEvento },
        });

        return actualizada;
      },
    )) as ReservaCambioFecha;

    return { reserva: resultado };
  }

  /**
   * Rama `2d` (§D-2..§D-6): la RESERVA en cola NO posee bloqueo propio. Con la fecha nueva
   * LIBRE, en la MISMA transacción: (1) INSERTA el bloqueo blando de F2; (2) saca la
   * RESERVA de la cola a `2b` (fecha=F2, posición/bloqueante→NULL, TTL); (3) reordena la
   * cola vieja cerrando el hueco; (4) crea el borrador E1 `'disponible'`; (5) AUDIT_LOG
   * `actualizar`. NO promueve ninguna cola ni toca la bloqueante ni su FECHA_BLOQUEADA.
   * Con la fecha OCUPADA → `CambiarFechaConflictoError` (409 terminal, rollback total).
   */
  private async cambiarDesdeCola(
    repos: RepositoriosCambiarFecha,
    comando: CambiarFechaComando,
    reserva: ReservaCambioFecha,
  ): Promise<ReservaCambioFecha> {
    // Estado de la fecha NUEVA bajo el lock (`SELECT … FOR UPDATE`).
    const estadoDestino = await repos.fechaBloqueada.leerEstadoFecha({
      tenantId: comando.tenantId,
      fecha: comando.fechaEvento,
    });

    // Fecha nueva OCUPADA por otra RESERVA → conflicto terminal, rollback total (no muta nada).
    if (estadoDestino.tipo === 'bloqueada') {
      throw new CambiarFechaConflictoError(MOTIVO_CONFLICTO);
    }

    const fechaAntigua = reserva.fechaEvento;
    const posicionAntigua = reserva.posicionCola ?? null;
    const bloqueanteId = reserva.consultaBloqueanteId ?? null;

    // 1. INSERTAR el bloqueo blando de F2 para ESTA reserva (primitiva atómica; `P2002` →
    //    conflicto/rollback total). La 2d no tenía fila propia: es un bloqueo nuevo.
    await repos.fechaBloqueada.bloquear({
      tenantId: comando.tenantId,
      fecha: comando.fechaEvento,
      reservaId: reserva.idReserva,
    });

    // 2. Leer la cola vieja ANTES de sacar la reserva: `planificarSalidaDeCola` exige que la
    //    saliente SIGA en la cola (calcula la contigüidad sobre el conjunto COMPLETO y busca
    //    la saliente por id). Si se leyera tras `moverFueraDeCola` —que ya puso su
    //    `consulta_bloqueante_id → NULL`— la saliente faltaría y el plan caería en anomalía
    //    (cola no contigua / saliente ausente) sin cerrar el hueco. Sin bloqueante no hay
    //    cola que reordenar.
    let reordenamientos: { idReserva: string; posicionCola: number }[] = [];
    if (bloqueanteId !== null) {
      const hermanos = await repos.reservas.leerColaHermana({
        tenantId: comando.tenantId,
        consultaBloqueanteId: bloqueanteId,
      });
      const cola: EntradaColaSalida[] = hermanos.map((h) => ({
        reservaId: h.reservaId,
        subEstado: h.subEstado,
        posicionCola: h.posicionCola,
        consultaBloqueanteId: h.consultaBloqueanteId,
      }));
      const plan = planificarSalidaDeCola(cola, reserva.idReserva);
      // Ante una anomalía de la cola vieja el plan no reordena a nadie: se registra el
      // hueco pero NO se corrige en silencio.
      reordenamientos = plan.reordenamientos.map((r) => ({
        idReserva: r.reservaId,
        posicionCola: r.posicionColaDestino,
      }));
    }

    // 3. Sacar la RESERVA de la cola → `2b` con F2 (posición/bloqueante NULL + TTL).
    const actualizada = await repos.reservas.moverFueraDeCola({
      idReserva: reserva.idReserva,
      fechaEvento: comando.fechaEvento,
    });

    // 4. Aplicar la reordenación de la cola vieja (cerrar el hueco) tras la salida.
    if (reordenamientos.length > 0) {
      await repos.reservas.reordenarCola(reordenamientos);
    }

    // 5. Borrador E1 `'disponible'` (no autoenviado): nace `borrador` en la misma tx.
    //    §D-subtipo: la salida de cola a fecha libre (2d → 2b) es una `fecha_disponible`
    //    ("Fecha disponible / asignada"), NO un cambio de fecha.
    await repos.comunicaciones.crearBorradorE1({
      tenantId: comando.tenantId,
      reservaId: reserva.idReserva,
      clienteId: reserva.clienteId ?? '',
      codigoEmail: 'E1',
      estado: 'borrador',
      tipo: 'disponible',
      idioma: reserva.idioma ?? '',
      clienteNombre: reserva.clienteNombre ?? '',
      clienteEmail: reserva.clienteEmail ?? '',
      fechaEvento: comando.fechaEvento,
      personas: reserva.numInvitadosFinal ?? null,
      horas: reserva.duracionHoras ?? null,
      fechaEnvio: null,
      subtipo: 'fecha_disponible',
    });

    // 6. AUDIT_LOG `actualizar` (F1 → F2 + salida de cola), en la misma transacción.
    await repos.auditoria.registrar({
      tenantId: comando.tenantId,
      usuarioId: comando.usuarioId,
      accion: 'actualizar',
      entidad: 'RESERVA',
      entidadId: reserva.idReserva,
      datosAnteriores: {
        fecha_evento: fechaAntigua,
        sub_estado: '2d',
        posicion_cola: posicionAntigua,
        consulta_bloqueante_id: bloqueanteId,
      },
      datosNuevos: {
        fecha_evento: comando.fechaEvento,
        sub_estado: '2b',
        posicion_cola: null,
        consulta_bloqueante_id: null,
      },
    });

    return actualizada;
  }
}

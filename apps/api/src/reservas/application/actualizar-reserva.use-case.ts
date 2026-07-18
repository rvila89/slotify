/**
 * Caso de uso de APLICACIÓN `ActualizarReservaUseCase`
 * (US-051 §Punto 2 / UC-14, actor Gestor).
 *
 * Update PARCIAL de los campos SIMPLES de una RESERVA (`PATCH /reservas/{id}`): solo se
 * persisten los campos PRESENTES en el comando; los ausentes NO se tocan (no se
 * sobrescriben a null). Orquesta el dominio a través de puertos inyectados (hexagonal,
 * hook `no-infra-in-domain`): NO importa Prisma ni `@nestjs/*`.
 *
 * REGLA DURA (design.md §D-1, `CLAUDE.md §Regla crítica: bloqueo atómico de fecha`):
 *   - NUNCA muta `fechaEvento` ni toca `FECHA_BLOQUEADA` (ni siquiera si llega en el
 *     body): la fecha del evento se cambia SOLO por el flujo atómico
 *     (`POST /reservas/{id}/fecha` o `POST /reservas/{id}/cambiar-fecha`). El puerto de
 *     escritura de este caso de uso NI SIQUIERA EXPONE una vía para escribir la fecha.
 *   - NO cambia `estado`/`subEstado`.
 *
 * Validación (design.md §D-1), rechazo SIN efectos (sin abrir la transacción):
 *   - `duracionHoras ∈ {4,8,12}`.
 *   - `horario` con formato `HH:mm` (00-23:00-59).
 *   - `horario` REQUIERE `duracionHoras` presente en la RESERVA o entrante en el mismo
 *     PATCH; si no, error de validación en el campo `horario` (espejo de la spec viva de
 *     `consultas`, "Idioma y horario opcionales").
 *
 * Algoritmo:
 *   0. Cargar la RESERVA bajo RLS del tenant del JWT (`cargarReserva`). `null` → 404.
 *   1. Validar los campos presentes (duración, horario + regla cruzada). Rechazo sin efectos.
 *   2. Paso TRANSACCIONAL: UPDATE PARCIAL de los campos simples presentes + AUDIT_LOG
 *      (`accion='actualizar'`, `entidad='RESERVA'`, datos_anteriores/datos_nuevos snake_case
 *      solo de los campos cambiados). Commit.
 */
import type { AuditLogPort } from '../../shared/audit/audit-log.port';
import type { EstadoReserva, SubEstadoConsulta } from '../domain/maquina-estados';

// ---------------------------------------------------------------------------
// Tipos del dominio de la aplicación
// ---------------------------------------------------------------------------

/** Duraciones válidas del evento (horas): tabla declarativa, no `if` disperso. */
const DURACIONES_VALIDAS = [4, 8, 12] as const;

/** Patrón `HH:mm` (00-23 : 00-59). */
const PATRON_HORARIO = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Campos SIMPLES editables de la RESERVA por el PATCH genérico (espejo exacto de
 * `UpdateReservaRequest` del contrato). NO incluye `fechaEvento` (regla dura §D-1) ni
 * `estado`/`subEstado`. Cada campo es opcional (PATCH parcial): solo los presentes
 * viajan al puerto.
 */
export interface CamposReservaParcial {
  tipoEvento?: string;
  duracionHoras?: number;
  numAdultosNinosMayores4?: number;
  numNinosMenores4?: number;
  numInvitadosFinal?: number;
  notas?: string;
  horario?: string;
}

/** Comando de entrada: identidad de la RESERVA + campos parciales + actor (JWT). */
export interface ActualizarReservaComando {
  /** Tenant del JWT (nunca del path/body): contexto RLS de toda la operación. */
  tenantId: string;
  /** Gestor autenticado (JWT): origen Usuario del AUDIT_LOG. */
  usuarioId: string;
  /** RESERVA sobre la que se contextualiza la acción (path). */
  reservaId: string;
  /** Campos simples a actualizar (parcial: solo los presentes se persisten). */
  campos: CamposReservaParcial;
}

/**
 * Proyección mínima de la RESERVA que la actualización necesita (leída bajo RLS del
 * tenant del JWT). Incluye los valores PREVIOS de los campos simples (para el AUDIT_LOG)
 * y `duracionHoras` (para la regla cruzada de `horario`). `fechaEvento`/`estado`/
 * `subEstado` viajan como referencia, pero NUNCA se mutan por esta vía.
 */
export interface ReservaActualizable {
  idReserva: string;
  tenantId: string;
  estado: EstadoReserva;
  subEstado: SubEstadoConsulta | null;
  fechaEvento: Date | null;
  tipoEvento: string | null;
  duracionHoras: number | null;
  numAdultosNinosMayores4: number | null;
  numNinosMenores4: number | null;
  numInvitadosFinal: number | null;
  horario: string | null;
  notas: string | null;
}

/** Resultado del caso de uso: la RESERVA con los campos simples ya actualizados. */
export interface ActualizarReservaResultado {
  reserva: ReservaActualizable;
}

// ---------------------------------------------------------------------------
// Puertos (interfaces) — implementados en infraestructura (adaptadores Prisma)
// ---------------------------------------------------------------------------

/** Parámetros del UPDATE parcial de columnas simples de la RESERVA (bajo RLS). */
export interface ActualizarCamposReservaParams {
  idReserva: string;
  tenantId: string;
  /** Solo las columnas simples PRESENTES en el comando (PATCH parcial, §D-1). */
  campos: CamposReservaParcial;
}

/** Resultado del UPDATE parcial: filas afectadas (`1` == se aplicó). */
export interface ActualizarCamposReservaResultado {
  filasAfectadas: number;
}

/** Registro de auditoría de la edición (origen Usuario, entidad RESERVA). */
export interface RegistroAuditoriaActualizarReserva {
  tenantId: string;
  usuarioId?: string;
  accion: 'actualizar';
  entidad: 'RESERVA';
  entidadId: string;
  datosAnteriores?: Record<string, unknown>;
  datosNuevos?: Record<string, unknown>;
}

/**
 * Repositorios tx-bound disponibles DENTRO de la unidad de trabajo. El ÚNICO repo
 * mutador de la RESERVA es `reservas.actualizarCampos` (campos simples): NO hay puerto
 * de FECHA_BLOQUEADA ni escritura de `fechaEvento` (regla dura §D-1).
 */
export interface RepositoriosActualizarReserva {
  reservas: {
    /**
     * `UPDATE reserva SET <columnas simples presentes>=? WHERE id=? AND tenant=?` bajo
     * RLS. NUNCA incluye `fechaEvento`/`estado`/`subEstado`. Devuelve filas afectadas.
     */
    actualizarCampos(
      params: ActualizarCamposReservaParams,
    ): Promise<ActualizarCamposReservaResultado>;
  };
  auditoria: AuditLogPort<RegistroAuditoriaActualizarReserva>;
}

/**
 * Unidad de trabajo de la escritura parcial: abre UNA transacción bajo el contexto RLS
 * del tenant y ejecuta `trabajo` con los repos ligados a esa transacción (all-or-nothing).
 */
export interface UnidadDeTrabajoActualizarReservaPort {
  ejecutar(
    tenantId: string,
    trabajo: (repos: RepositoriosActualizarReserva) => Promise<unknown>,
  ): Promise<unknown>;
}

/** Dependencias del caso de uso (puertos inyectados, hexagonal). */
export interface ActualizarReservaDeps {
  unidadDeTrabajo: UnidadDeTrabajoActualizarReservaPort;
  cargarReserva(
    comando: ActualizarReservaComando,
  ): Promise<ReservaActualizable | null>;
}

// ---------------------------------------------------------------------------
// Errores de dominio de la aplicación (en español)
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
 * Un campo del PATCH no supera la validación (duración fuera de {4,8,12}, horario mal
 * formado o `horario` sin `duracionHoras`): se rechaza SIN tocar la BD. Mapea a HTTP 400.
 * `campo` identifica la propiedad ofensora (para el error de validación en `horario`).
 */
export class ActualizarReservaValidacionError extends Error {
  readonly codigo = 'ACTUALIZAR_RESERVA_VALIDACION' as const;
  readonly campo: keyof CamposReservaParcial;

  constructor(campo: keyof CamposReservaParcial, mensaje: string) {
    super(mensaje);
    this.name = 'ActualizarReservaValidacionError';
    this.campo = campo;
  }
}

// ---------------------------------------------------------------------------
// Metadatos de los campos simples: claves editables y mapeo camelCase → snake_case.
// ---------------------------------------------------------------------------

/** Claves simples editables (espejo de `UpdateReservaRequest`, SIN fecha/estado). */
const CLAVES_SIMPLES: ReadonlyArray<keyof CamposReservaParcial> = [
  'tipoEvento',
  'duracionHoras',
  'numAdultosNinosMayores4',
  'numNinosMenores4',
  'numInvitadosFinal',
  'notas',
  'horario',
];

/** Mapeo camelCase → snake_case para el payload de AUDIT_LOG (columnas de RESERVA). */
const A_SNAKE_CASE: Record<keyof CamposReservaParcial, string> = {
  tipoEvento: 'tipo_evento',
  duracionHoras: 'duracion_horas',
  numAdultosNinosMayores4: 'num_adultos_ninos_mayores_4',
  numNinosMenores4: 'num_ninos_menores_4',
  numInvitadosFinal: 'num_invitados_final',
  notas: 'notas',
  horario: 'horario',
};

// ---------------------------------------------------------------------------
// Caso de uso
// ---------------------------------------------------------------------------

export class ActualizarReservaUseCase {
  constructor(private readonly deps: ActualizarReservaDeps) {}

  async ejecutar(
    comando: ActualizarReservaComando,
  ): Promise<ActualizarReservaResultado> {
    // 0. Cargar la RESERVA bajo RLS del tenant del JWT. `null` → 404 (inexistente / otro tenant).
    const reserva = await this.deps.cargarReserva(comando);
    if (reserva === null) {
      throw new ReservaNoEncontradaError(comando.reservaId);
    }

    // Solo los campos SIMPLES presentes viajan (PATCH parcial): descarta cualquier campo
    // ajeno (p. ej. `fechaEvento`/`estado` colados por un cliente) — regla dura §D-1.
    const camposPresentes = this.extraerCamposSimplesPresentes(comando.campos);

    // 1. Validación previa (rechazo SIN efectos: no se abre la transacción).
    this.validar(camposPresentes, reserva);

    // 2. Paso TRANSACCIONAL: UPDATE PARCIAL de campos simples + AUDIT_LOG (entidad RESERVA).
    await this.deps.unidadDeTrabajo.ejecutar(comando.tenantId, async (repos) => {
      await repos.reservas.actualizarCampos({
        idReserva: reserva.idReserva,
        tenantId: comando.tenantId,
        campos: camposPresentes,
      });

      await repos.auditoria.registrar({
        tenantId: comando.tenantId,
        usuarioId: comando.usuarioId,
        accion: 'actualizar',
        entidad: 'RESERVA',
        entidadId: reserva.idReserva,
        datosAnteriores: this.aPayloadSnake(camposPresentes, this.valoresPrevios(reserva)),
        datosNuevos: this.aPayloadSnake(camposPresentes, camposPresentes),
      });
    });

    return {
      reserva: { ...reserva, ...camposPresentes },
    };
  }

  /**
   * Devuelve un objeto con SOLO las claves SIMPLES presentes (definidas) del comando. Los
   * campos ajenos (p. ej. `fechaEvento`) o ausentes NO se incluyen: no viajan al puerto,
   * no se persisten (regla dura §D-1). Nunca se ponen a null.
   */
  private extraerCamposSimplesPresentes(
    campos: CamposReservaParcial,
  ): CamposReservaParcial {
    const presentes: CamposReservaParcial = {};
    for (const clave of CLAVES_SIMPLES) {
      const valor = campos[clave];
      if (valor !== undefined) {
        (presentes[clave] as unknown) = valor;
      }
    }
    return presentes;
  }

  /**
   * Valida los campos presentes ANTES de abrir la transacción (rechazo sin efectos):
   * `duracionHoras ∈ {4,8,12}`, `horario` `HH:mm` y la regla cruzada de `horario`
   * (requiere `duracionHoras` presente en la RESERVA o entrante en el mismo PATCH).
   */
  private validar(
    campos: CamposReservaParcial,
    reserva: ReservaActualizable,
  ): void {
    if (
      campos.duracionHoras !== undefined &&
      !DURACIONES_VALIDAS.includes(campos.duracionHoras as (typeof DURACIONES_VALIDAS)[number])
    ) {
      throw new ActualizarReservaValidacionError(
        'duracionHoras',
        'La duración del evento debe ser 4, 8 o 12 horas',
      );
    }

    if (campos.horario !== undefined) {
      if (!PATRON_HORARIO.test(campos.horario)) {
        throw new ActualizarReservaValidacionError(
          'horario',
          'El horario debe tener el formato HH:mm (00:00–23:59)',
        );
      }
      // Regla cruzada (§D-1): `horario` solo es válido si la RESERVA YA tiene
      // `duracionHoras` o si el MISMO PATCH la fija.
      const tieneDuracion =
        campos.duracionHoras !== undefined || reserva.duracionHoras !== null;
      if (!tieneDuracion) {
        throw new ActualizarReservaValidacionError(
          'horario',
          'El horario requiere que la reserva tenga una duración (duracionHoras) definida',
        );
      }
    }
  }

  /** Valores PREVIOS de los campos simples de la RESERVA (para `datosAnteriores`). */
  private valoresPrevios(reserva: ReservaActualizable): CamposReservaParcial {
    return {
      tipoEvento: reserva.tipoEvento ?? undefined,
      duracionHoras: reserva.duracionHoras ?? undefined,
      numAdultosNinosMayores4: reserva.numAdultosNinosMayores4 ?? undefined,
      numNinosMenores4: reserva.numNinosMenores4 ?? undefined,
      numInvitadosFinal: reserva.numInvitadosFinal ?? undefined,
      notas: reserva.notas ?? undefined,
      horario: reserva.horario ?? undefined,
    };
  }

  /**
   * Construye el payload snake_case de AUDIT_LOG tomando SOLO las claves presentes en
   * `presentes`, con el valor de `fuente` (usa `previos` para `datosAnteriores` y los
   * propios campos nuevos para `datosNuevos`).
   */
  private aPayloadSnake(
    presentes: CamposReservaParcial,
    fuente: CamposReservaParcial,
  ): Record<string, unknown> {
    const payload: Record<string, unknown> = {};
    for (const clave of CLAVES_SIMPLES) {
      if (presentes[clave] !== undefined) {
        payload[A_SNAKE_CASE[clave]] = fuente[clave] ?? null;
      }
    }
    return payload;
  }
}

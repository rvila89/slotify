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
import { renderMensajeTransicionFecha } from './plantilla-transicion-fecha';

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
  /**
   * Idioma de la RESERVA (`'ca'` → catalán; resto → castellano). Se usa para re-renderizar
   * el borrador E1 pendiente en el idioma correcto (change `consulta-fecha-borrador-fix`,
   * design.md §D-3).
   */
  idioma: string;
  /**
   * Nombre de pila del CLIENTE para el saludo del borrador E1 regenerado (design.md §D-3).
   * Opcional: si falta, el saludo usa cadena vacía (el render no rompe).
   */
  nombreCliente?: string | null;
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

/**
 * Referencia mínima al borrador E1 pendiente de una RESERVA (`codigo_email='E1'` y
 * `estado='borrador'`). `null` cuando no existe (ya `enviado`/`fallido`/inexistente).
 */
export interface BorradorE1Pendiente {
  idComunicacion: string;
}

/** Parámetros de la carga del borrador E1 pendiente (scoped por tenant + reserva, RLS). */
export interface CargarBorradorE1PendienteParams {
  tenantId: string;
  reservaId: string;
}

/**
 * Puerto de LECTURA del borrador E1 pendiente (change `consulta-fecha-borrador-fix`,
 * design.md §D-3). El adaptador (RLS) solo devuelve la fila `E1` en `borrador` de la
 * RESERVA; `null` en cualquier otro caso.
 */
export interface CargarBorradorE1PendientePort {
  cargarBorradorE1Pendiente(
    params: CargarBorradorE1PendienteParams,
  ): Promise<BorradorE1Pendiente | null>;
}

/** Parámetros del UPDATE de contenido del borrador E1 (mantiene la fila en `borrador`). */
export interface RegenerarBorradorE1Params {
  tenantId: string;
  idComunicacion: string;
  asunto: string;
  cuerpo: string;
}

/**
 * Puerto de UPDATE post-commit del CONTENIDO del borrador E1 (design.md §D-3). Lo SATISFACE
 * el `DespacharEmailService.actualizarContenidoBorrador`: sobrescribe `asunto`/`cuerpo`
 * manteniendo la fila en `borrador` (guarda de estado en el repositorio).
 */
export interface RegenerarBorradorE1Port {
  actualizarContenidoBorrador(
    params: RegenerarBorradorE1Params,
  ): Promise<unknown>;
}

/** Dependencias del caso de uso (puertos inyectados, hexagonal). */
export interface ActualizarReservaDeps {
  unidadDeTrabajo: UnidadDeTrabajoActualizarReservaPort;
  cargarReserva(
    comando: ActualizarReservaComando,
  ): Promise<ReservaActualizable | null>;
  /**
   * Lectura del borrador E1 pendiente para regenerarlo tras el PATCH (design.md §D-3).
   * Opcional: si no se inyecta, no hay regeneración (degradación graceful; montajes de test
   * que no lo necesitan no rompen).
   */
  cargarBorradorE1Pendiente?: CargarBorradorE1PendientePort;
  /** UPDATE post-commit del contenido del borrador E1. Opcional (design.md §D-3). */
  regenerarBorrador?: RegenerarBorradorE1Port;
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

/**
 * Personas para el borrador E1 regenerado: el aforo canónico de la RESERVA (espejo de
 * `aforoDeReserva` del frontend, US-050). Usa `numInvitadosFinal` cuando está presente
 * y, si no, la suma del desglose `numAdultosNinosMayores4 + numNinosMenores4` (lo que el
 * gestor edita en "Editar consulta"); `null` cuando no hay ningún dato de aforo, para que
 * la plantilla interpole el placeholder `___`. Coalescer es imprescindible: el editor de
 * consulta escribe `numAdultosNinosMayores4`, NO `numInvitadosFinal`, así que leer solo
 * este último dejaría el borrador con `___` pese a haber introducido las personas.
 */
const derivarPersonasBorrador = (
  reserva: Pick<
    ReservaActualizable,
    'numInvitadosFinal' | 'numAdultosNinosMayores4' | 'numNinosMenores4'
  >,
): number | null => {
  if (reserva.numInvitadosFinal != null) return reserva.numInvitadosFinal;
  const adultos = reserva.numAdultosNinosMayores4;
  const ninos = reserva.numNinosMenores4;
  if (adultos == null && ninos == null) return null;
  return (adultos ?? 0) + (ninos ?? 0);
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

    const reservaActualizada: ReservaActualizable = { ...reserva, ...camposPresentes };

    // 3. POST-COMMIT best-effort (design.md §D-3): si existe un borrador E1 pendiente,
    //    regenerar su asunto/cuerpo con los datos YA actualizados para que refleje las
    //    personas/horas nuevas (sobrescribe el placeholder `___`). Fuera de la unidad de
    //    trabajo del PATCH: un fallo NO revierte la edición (el PATCH resuelve con éxito).
    await this.regenerarBorradorE1SiProcede(comando, reservaActualizada);

    return { reserva: reservaActualizada };
  }

  /**
   * Regenera (post-commit, best-effort) el contenido del borrador E1 pendiente con los
   * datos actualizados de la RESERVA (design.md §D-3). No hay guarda 409: editar con
   * borrador pendiente está permitido. Sin borrador (enviado/inexistente) o sin los puertos
   * inyectados → no hace nada. Un fallo se traga (no revierte el PATCH ya commiteado).
   */
  private async regenerarBorradorE1SiProcede(
    comando: ActualizarReservaComando,
    reserva: ReservaActualizable,
  ): Promise<void> {
    const cargar = this.deps.cargarBorradorE1Pendiente;
    const regenerar = this.deps.regenerarBorrador;
    if (cargar === undefined || regenerar === undefined) {
      return;
    }
    try {
      const borrador = await cargar.cargarBorradorE1Pendiente({
        tenantId: comando.tenantId,
        reservaId: reserva.idReserva,
      });
      if (borrador === null) {
        return;
      }
      const { asunto, cuerpo } = renderMensajeTransicionFecha({
        // 2d → cola; cualquier otro sub-estado con fecha (2b) → disponible.
        tipo: reserva.subEstado === '2d' ? 'cola' : 'disponible',
        idioma: reserva.idioma,
        nombre: reserva.nombreCliente ?? '',
        fechaEvento: reserva.fechaEvento ?? new Date(),
        personas: derivarPersonasBorrador(reserva),
        horas: reserva.duracionHoras,
      });
      await regenerar.actualizarContenidoBorrador({
        tenantId: comando.tenantId,
        idComunicacion: borrador.idComunicacion,
        asunto,
        cuerpo,
      });
    } catch {
      // Best-effort (design.md §D-3): el PATCH ya commiteó; no se propaga el fallo.
    }
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

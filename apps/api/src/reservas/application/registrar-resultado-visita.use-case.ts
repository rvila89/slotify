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
  esOrigenValidoParaResultadoVisitaReservaInmediata,
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

/**
 * Resultado de la visita. Soportados: `interesado` (US-009) y `reserva_inmediata`
 * (US-010). `descarta` (US-011, nombre canónico del contrato/DTO) aún no está
 * implementado y cae en el rechazo 422.
 */
export type ResultadoVisita = 'interesado' | 'reserva_inmediata' | 'descarta';

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
  /** Datos obligatorios UC-14 de la RESERVA (solo `reserva_inmediata`, US-010). */
  duracionHoras?: number | null;
  tipoEvento?: string | null;
  numAdultosNinosMayores4?: number | null;
  visitaProgramadaFecha?: Date | null;
  visitaProgramadaHora?: string | null;
  visitaRealizada: boolean;
}

/**
 * Proyección del CLIENTE con los datos fiscales UC-14 (US-010 `reserva_inmediata`).
 * La transición a `pre_reserva` exige estos datos completos (D-4).
 */
export interface ClienteResultadoVisita {
  idCliente: string;
  tenantId: string;
  dniNif: string | null;
  direccion: string | null;
  codigoPostal: string | null;
  poblacion: string | null;
  provincia: string | null;
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

/**
 * Parámetros del UPDATE de la RESERVA en la transición.
 * - «interesado» (US-009): `subEstado='2b'` dentro de `estado='consulta'` (no envía
 *   `estado`, permanece `consulta`).
 * - «reserva_inmediata» (US-010): `estado='pre_reserva'` con `subEstado=null`.
 */
export interface ActualizarReservaResultadoVisitaParams {
  idReserva: string;
  estado?: EstadoReserva;
  subEstado: SubEstadoConsulta | null;
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

/**
 * Repositorio tx-bound del vaciado de cola A16 (`2.d → 2.y`) — solo `reserva_inmediata`
 * (US-010). Reutiliza la mecánica de UC-14: lee los ids en cola ANTES del UPDATE masivo
 * y aplica el `updateMany` DENTRO de la misma transacción. Devuelve los ids descartados
 * para que el caso de uso audite cada descarte.
 */
export interface ColaResultadoVisitaRepositoryPort {
  /**
   * UPDATE masivo de las RESERVA `2.d` que apuntan a la bloqueante: pasan a `2.y`
   * (terminal) con `posicion_cola=NULL` y `consulta_bloqueante_id=NULL`. Con 0 filas es
   * una operación vacía válida (no error).
   */
  vaciar(params: {
    tenantId: string;
    consultaBloqueanteId: string;
  }): Promise<{ descartadas: ReadonlyArray<string> }>;
}

/** Conjunto de repositorios disponibles dentro de la unidad de trabajo. */
export interface RepositoriosResultadoVisita {
  reservas: ReservaResultadoVisitaRepositoryPort;
  fechaBloqueada: FechaBloqueadaResultadoVisitaRepositoryPort;
  /**
   * Vaciado de cola A16 (solo `reserva_inmediata`, US-010). Opcional para el flujo
   * «interesado» (US-009), que no vacía cola; el adaptador Prisma siempre lo provee.
   */
  cola?: ColaResultadoVisitaRepositoryPort;
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

/**
 * Puerto de lectura del CLIENTE para la validación de datos obligatorios UC-14 (D-4,
 * solo `reserva_inmediata`). RLS: cross-tenant → null. Se lee FUERA de la tx crítica.
 */
export interface CargarClienteResultadoVisitaPort {
  obtener(params: {
    tenantId: string;
    clienteId: string;
  }): Promise<ClienteResultadoVisita | null>;
}

/** Dependencias del caso de uso (puertos inyectados). */
export interface RegistrarResultadoVisitaDeps {
  unidadDeTrabajo: UnidadDeTrabajoResultadoVisitaPort;
  clock: ClockPort;
  /** Settings del tenant para el TTL de consulta (ttl_consulta_dias). */
  tenantSettings: TenantSettingsResultadoVisitaPort;
  /** Puerto del envío post-commit de E7 (confirmación post-visita, solo «interesado»). */
  confirmacionResultado: EnviarConfirmacionResultadoVisitaPort;
  /**
   * Lectura del CLIENTE para la validación de datos obligatorios UC-14 (solo
   * `reserva_inmediata`, US-010). Opcional: el flujo «interesado» (US-009) no lo usa.
   */
  cargarCliente?: CargarClienteResultadoVisitaPort;
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

/** Campo obligatorio UC-14 (CLIENTE fiscal o RESERVA) requerido no nulo (D-4). */
export type CampoObligatorioFaltante =
  | 'dniNif'
  | 'direccion'
  | 'codigoPostal'
  | 'poblacion'
  | 'provincia'
  | 'fechaEvento'
  | 'duracionHoras'
  | 'numAdultosNinosMayores4'
  | 'tipoEvento';

/**
 * D-4 (UC-14 FA-01): faltan datos obligatorios de la RESERVA o datos fiscales del
 * CLIENTE para la transición `reserva_inmediata` a `pre_reserva`. Se rechaza SIN mutar
 * nada (la RESERVA permanece en `2.v`). Mapea a HTTP 422 con `camposFaltantes`. Mismo
 * patrón que `DatosFiscalesIncompletosError` de UC-14: reutiliza su MISMO `codigo`
 * (`DATOS_FISCALES_INCOMPLETOS`), que es el único valor del enum en el contrato
 * congelado (`docs/api-spec.yml`) y el que ramifica el frontend.
 */
export class DatosObligatoriosIncompletosError extends Error {
  readonly codigo = 'DATOS_FISCALES_INCOMPLETOS' as const;
  readonly camposFaltantes: CampoObligatorioFaltante[];

  constructor(camposFaltantes: CampoObligatorioFaltante[]) {
    super(
      `Faltan datos obligatorios para la reserva inmediata: ${camposFaltantes.join(', ')}`,
    );
    this.name = 'DatosObligatoriosIncompletosError';
    this.camposFaltantes = camposFaltantes;
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
    // Despacho declarativo por resultado. «interesado» (US-009, 2.v → 2.b + E7) y
    // «reserva_inmediata» (US-010, 2.v → pre_reserva + vaciado de cola A16, sin email)
    // son las dos salidas soportadas de 2.v; «descarta» (US-011) aún no → 422.
    if (comando.resultado === 'interesado') {
      return this.ejecutarInteresado(comando);
    }
    if (comando.resultado === 'reserva_inmediata') {
      return this.ejecutarReservaInmediata(comando);
    }
    throw new ResultadoVisitaValidacionError(
      `El resultado de visita '${comando.resultado}' no está soportado en esta versión (solo 'interesado' y 'reserva_inmediata')`,
    );
  }

  /**
   * Flujo «cliente interesado» (US-009): `2.v → 2.b`, TTL de consulta fresco, UPDATE del
   * bloqueo blando y disparo POST-COMMIT de E7.
   */
  private async ejecutarInteresado(
    comando: RegistrarResultadoVisitaComando,
  ): Promise<RegistrarResultadoVisitaResultado> {
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
   * Flujo «reserva inmediata» (US-010): `2.v → pre_reserva`, `sub_estado=NULL`,
   * `visita_realizada=true`, TTL de PRE-RESERVA (`now + ttl_prereserva_dias`, 7 d, NO
   * ttl_consulta_dias). En UNA transacción (all-or-nothing): UPDATE RESERVA + UPDATE PURO
   * del ttl de la fila existente de FECHA_BLOQUEADA al mismo valor (blando) + vaciado de
   * cola A16 (`2.d → 2.y`) + AUDIT_LOG (principal + una por cada consulta vaciada). SIN
   * email propio (a diferencia de «interesado», no dispara E7 ni E2). La validación de
   * datos obligatorios UC-14 (D-4) precede a toda mutación.
   */
  private async ejecutarReservaInmediata(
    comando: RegistrarResultadoVisitaComando,
  ): Promise<RegistrarResultadoVisitaResultado> {
    const ahora = this.deps.clock.ahora();

    return (await this.deps.unidadDeTrabajo.ejecutar(
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
          !esOrigenValidoParaResultadoVisitaReservaInmediata(
            reserva.estado,
            reserva.subEstado,
          )
        ) {
          throw new ResultadoVisitaValidacionError(
            'El registro del resultado "reserva inmediata" solo es válido desde una consulta con visita programada (sub-estado 2v)',
          );
        }

        // 422 — datos obligatorios UC-14 (D-4): RESERVA + CLIENTE completos ANTES de
        // cualquier mutación. Un rechazo lanza y la UoW revierte sin efectos.
        const cliente = await this.cargarCliente(comando.tenantId, reserva.clienteId);
        this.validarDatosObligatorios(reserva, cliente);

        // TTL de pre_reserva leído del setting (nunca ttl_consulta_dias, nunca
        // hardcodeado, §D-2), tras superar las guardas 404/422.
        const ttlPrereservaDias = await this.resolverTtlPrereservaDias(comando.tenantId);
        const ttlPreReserva = new Date(ahora.getTime() + ttlPrereservaDias * DIA_MS);

        // Lock de la fila bloqueante — punto de serialización (la fila SIEMPRE existe al
        // venir de 2.v; no hay rama de INSERT). Serializa el vaciado de cola y la carrera
        // D4 frente a otras mutaciones de esa fecha.
        const fechaEvento = reserva.fechaEvento as Date;
        await repos.fechaBloqueada.leerBloqueoVigente({
          tenantId: comando.tenantId,
          fecha: fechaEvento,
          reservaId: reserva.idReserva,
        });

        // RE-LECTURA bajo el lock: la guarda se re-evalúa sobre el sub-estado ya
        // serializado por el `FOR UPDATE`. Dos «reserva_inmediata» simultáneas → la
        // segunda observa `pre_reserva` (no `2v`) y cae en la guarda (422), sin doble
        // mutación ni doble vaciado.
        const reservaBloqueada = await repos.reservas.buscarPorId({
          tenantId: comando.tenantId,
          reservaId: comando.reservaId,
        });
        if (reservaBloqueada === null) {
          throw new ReservaNoEncontradaError(comando.reservaId);
        }
        if (
          !esOrigenValidoParaResultadoVisitaReservaInmediata(
            reservaBloqueada.estado,
            reservaBloqueada.subEstado,
          )
        ) {
          throw new ResultadoVisitaValidacionError(
            'El registro del resultado "reserva inmediata" solo es válido desde una consulta con visita programada (sub-estado 2v)',
          );
        }

        // (1) UPDATE RESERVA → pre_reserva + sub_estado NULL + visita_realizada=true +
        //     TTL de pre_reserva (now + ttl_prereserva_dias, §D-2).
        const actualizada = await repos.reservas.actualizar({
          idReserva: reserva.idReserva,
          estado: 'pre_reserva',
          subEstado: null,
          ttlExpiracion: ttlPreReserva,
          visitaRealizada: true,
        });

        // (2) UPDATE PURO del ttl de la fila existente de FECHA_BLOQUEADA al MISMO valor;
        //     tipo_bloqueo permanece 'blando' (§D-3). Una sola fuente de verdad del TTL.
        await repos.fechaBloqueada.actualizarTtl({
          tenantId: comando.tenantId,
          fecha: fechaEvento,
          reservaId: reserva.idReserva,
          tipoBloqueo: 'blando',
          ttlExpiracion: ttlPreReserva,
        });

        // (3) Vaciado de cola A16 (`2.d → 2.y`); con 0 filas es operación vacía válida.
        if (repos.cola === undefined) {
          throw new ResultadoVisitaValidacionError(
            'El repositorio de cola no está disponible para la reserva inmediata',
          );
        }
        const { descartadas } = await repos.cola.vaciar({
          tenantId: comando.tenantId,
          consultaBloqueanteId: reserva.idReserva,
        });

        // (4) AUDIT_LOG: principal (2v → pre_reserva) + una por cada consulta vaciada.
        await repos.auditoria.registrar(
          this.registroTransicionPreReserva(comando, reserva.idReserva),
        );
        for (const idDescartada of descartadas) {
          await repos.auditoria.registrar(
            this.registroDescartadaCola(comando, idDescartada),
          );
        }

        return { reserva: actualizada };
      },
    )) as RegistrarResultadoVisitaResultado;
    // SIN email: US-010 no dispara E7 ni E2 (E2 se delega a UC-14).
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

  /**
   * Lee `ttl_prereserva_dias` de TENANT_SETTINGS (nunca hardcodeado, §D-2) para la
   * transición `reserva_inmediata`. Es una fuente DISTINTA de `ttl_consulta_dias`: la
   * pre_reserva usa su propio TTL (default 7 d). Si no está configurado → validación.
   */
  private async resolverTtlPrereservaDias(tenantId: string): Promise<number> {
    const settings = await this.deps.tenantSettings.obtener(tenantId);
    const dias = settings?.ttlPrereservaDias;
    if (dias === undefined || dias === null) {
      throw new ResultadoVisitaValidacionError(
        `No hay ttl_prereserva_dias configurado en TENANT_SETTINGS para el tenant ${tenantId}`,
      );
    }
    return dias;
  }

  /**
   * Lee el CLIENTE para la validación de datos obligatorios UC-14 (D-4). El puerto es
   * obligatorio en el flujo `reserva_inmediata`; su ausencia es una misconfiguración.
   */
  private async cargarCliente(
    tenantId: string,
    clienteId: string,
  ): Promise<ClienteResultadoVisita | null> {
    if (this.deps.cargarCliente === undefined) {
      throw new ResultadoVisitaValidacionError(
        'El puerto de carga de CLIENTE no está configurado para la reserva inmediata',
      );
    }
    return this.deps.cargarCliente.obtener({ tenantId, clienteId });
  }

  /**
   * Valida los datos obligatorios UC-14 (D-4): datos fiscales del CLIENTE
   * (`dniNif`/`direccion`/`codigoPostal`/`poblacion`/`provincia`) y datos de la RESERVA
   * (`fechaEvento`/`duracionHoras`/`tipoEvento`/`numAdultosNinosMayores4`). Enumera TODOS
   * los faltantes; si hay al menos uno → 422 con `camposFaltantes`, sin mutar nada. Mismo
   * conjunto y semántica que `DatosFiscalesIncompletosError` de UC-14.
   */
  private validarDatosObligatorios(
    reserva: ReservaResultadoVisita,
    cliente: ClienteResultadoVisita | null,
  ): void {
    const presente = (valor: string | null | undefined): boolean =>
      valor !== null && valor !== undefined && valor.trim() !== '';
    const faltantes: CampoObligatorioFaltante[] = [];

    if (!presente(cliente?.dniNif)) faltantes.push('dniNif');
    if (!presente(cliente?.direccion)) faltantes.push('direccion');
    if (!presente(cliente?.codigoPostal)) faltantes.push('codigoPostal');
    if (!presente(cliente?.poblacion)) faltantes.push('poblacion');
    if (!presente(cliente?.provincia)) faltantes.push('provincia');

    if (reserva.fechaEvento === null || reserva.fechaEvento === undefined) {
      faltantes.push('fechaEvento');
    }
    if (reserva.duracionHoras === null || reserva.duracionHoras === undefined) {
      faltantes.push('duracionHoras');
    }
    if (!presente(reserva.tipoEvento)) faltantes.push('tipoEvento');
    if (
      reserva.numAdultosNinosMayores4 === null ||
      reserva.numAdultosNinosMayores4 === undefined ||
      reserva.numAdultosNinosMayores4 < 1
    ) {
      faltantes.push('numAdultosNinosMayores4');
    }

    if (faltantes.length > 0) {
      throw new DatosObligatoriosIncompletosError(faltantes);
    }
  }

  /** Construye el registro de AUDIT_LOG `accion='transicion'` de `2v → pre_reserva`. */
  private registroTransicionPreReserva(
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
      datosNuevos: {
        estado: 'pre_reserva',
        subEstado: null,
        visitaRealizada: true,
      },
    };
  }

  /** Construye el registro de AUDIT_LOG `accion='transicion'` de una consulta vaciada. */
  private registroDescartadaCola(
    comando: RegistrarResultadoVisitaComando,
    reservaId: string,
  ): RegistroAuditoria {
    return {
      tenantId: comando.tenantId,
      accion: 'transicion',
      entidad: 'RESERVA',
      entidadId: reservaId,
      usuarioId: comando.usuarioId,
      datosAnteriores: { subEstado: '2d' },
      datosNuevos: { subEstado: '2y' },
    };
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

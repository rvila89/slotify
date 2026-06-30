/**
 * Operación de dominio `bloquearFecha()` (US-040 / UC-30) — DOMINIO PURO.
 *
 * Operación fundacional anti-doble-reserva (dolor D4). Inserta, extiende o
 * promueve atómicamente la fila de `FECHA_BLOQUEADA` de una `(tenant_id, fecha)`.
 * La garantía de no-doble-reserva reside en el motor de PostgreSQL
 * (`UNIQUE(tenant_id, fecha)` + `SELECT … FOR UPDATE`), nunca en lógica
 * aplicativa ni en locks distribuidos.
 *
 * Hexagonal (hook `no-infra-in-domain`): este módulo NO importa `@nestjs/*`,
 * Prisma ni infraestructura. Depende solo de PUERTOS (interfaces) que la
 * infraestructura implementa con adaptadores.
 *
 * Orden de evaluación (design.md §D-8):
 *   1. Validar dominio: `tenant_id` coincide → TENANT_MISMATCH; `fecha` futura →
 *      FECHA_EN_PASADO; fase ∈ mapa.
 *   2. Resolver el plan `(tipo, ttl, modo)` del mapa declarativo (D-2) leyendo
 *      los TTL de TENANT_SETTINGS (nunca hardcodeados).
 *   3. Delegar la transacción `SELECT … FOR UPDATE` + insert/extend/upgrade al
 *      repositorio (adaptador Prisma).
 */

// ---------------------------------------------------------------------------
// Tipos de dominio
// ---------------------------------------------------------------------------

/** Tipo de bloqueo: blando (con TTL) o firme (sin TTL). */
export type TipoBloqueoDominio = 'blando' | 'firme';

/** Modo de mutación derivado de la fase (D-2). */
export type ModoBloqueo = 'insert' | 'extend' | 'upgrade';

/** Fases (estado/sub-estado de la RESERVA) contempladas en el mapa canónico. */
export type FaseBloqueo = '2.b' | '2.c' | '2.v' | 'pre_reserva' | 'reserva_confirmada';

/** Días de TTL del tenant, leídos de TENANT_SETTINGS (D-2). */
export interface TenantSettingsBloqueo {
  ttlConsultaDias: number;
  ttlPrereservaDias: number;
  /**
   * Ventana de ENTRADA (en días) para programar una visita (US-008): la fecha de
   * visita debe caer en `[hoy+1, hoy+maxDiasProgramarVisita]`. Opcional en el tipo
   * común (no todas las fases lo necesitan); el use-case de programar visita lo exige.
   */
  maxDiasProgramarVisita?: number;
}

/**
 * Plan de bloqueo resuelto a partir de la fase: tipo + TTL + modo de mutación.
 * En modo `extend` el TTL absoluto no se conoce en dominio (depende del valor
 * persistido); se transporta el incremento en `ttlDeltaDias`.
 */
export interface PlanBloqueo {
  modo: ModoBloqueo;
  tipo: TipoBloqueoDominio;
  ttl: Date | null;
  ttlDeltaDias?: number;
}

/** Datos mínimos de la RESERVA referenciada por el bloqueo. */
export interface ReservaBloqueo {
  idReserva: string;
  tenantId: string;
  visitaProgramadaFecha?: Date;
}

/** Comando de entrada de `bloquearFecha()`. */
export interface BloquearFechaComando {
  tenantId: string;
  fase: FaseBloqueo;
  fecha: Date;
  reserva: ReservaBloqueo;
}

/** Resultado canónico de un bloqueo aplicado. */
export interface FechaBloqueadaResultado {
  idBloqueo: string;
  tenantId: string;
  fecha: Date;
  reservaId: string;
  tipoBloqueo: TipoBloqueoDominio;
  ttlExpiracion: Date | null;
}

// ---------------------------------------------------------------------------
// Puertos (interfaces) — implementados en infraestructura (adaptadores Prisma)
// ---------------------------------------------------------------------------

/**
 * Repositorio transaccional de `FECHA_BLOQUEADA`. La única operación mutadora
 * encapsula la transacción `SELECT … FOR UPDATE` + insert/extend/upgrade y la
 * traducción de `P2002` → `FechaYaBloqueadaError` (D-1, D-4).
 */
export interface FechaBloqueadaRepositoryPort {
  bloquear(params: {
    tenantId: string;
    fecha: Date;
    reservaId: string;
    plan: PlanBloqueo;
  }): Promise<FechaBloqueadaResultado>;
}

/** Lee los días de TTL de TENANT_SETTINGS del tenant (RLS: cross-tenant → null). */
export interface TenantSettingsPort {
  obtener(tenantId: string): Promise<TenantSettingsBloqueo | null>;
}

/** Reloj inyectable para determinismo (validación de fecha futura). */
export interface ClockPort {
  ahora(): Date;
}

/** Dependencias del servicio: puertos inyectados (hexagonal). */
export interface BloquearFechaDeps {
  repositorio: FechaBloqueadaRepositoryPort;
  tenantSettings: TenantSettingsPort;
  clock: ClockPort;
}

// ---------------------------------------------------------------------------
// Errores de dominio tipados, en español (design.md §D-4)
// ---------------------------------------------------------------------------

/** Violación de una regla de validación previa a la transacción. */
export class ValidacionBloqueoError extends Error {
  readonly codigo = 'VALIDACION_BLOQUEO' as const;

  constructor(mensaje: string) {
    super(mensaje);
    this.name = 'ValidacionBloqueoError';
  }
}

/** La fecha solicitada no es estrictamente futura. Rechazo sin tocar la BD. */
export class FechaEnPasadoError extends Error {
  readonly codigo = 'FECHA_EN_PASADO' as const;
  readonly fecha: Date;

  constructor(fecha: Date) {
    super('La fecha del bloqueo debe ser futura (no se admite el pasado ni el mismo día)');
    this.name = 'FechaEnPasadoError';
    this.fecha = fecha;
  }
}

/** El `tenant_id` del bloqueo no coincide con el de la RESERVA referenciada. */
export class TenantMismatchError extends Error {
  readonly codigo = 'TENANT_MISMATCH' as const;
  readonly tenantIdBloqueo: string;
  readonly tenantIdReserva: string;

  constructor(tenantIdBloqueo: string, tenantIdReserva: string) {
    super('El tenant del bloqueo no coincide con el de la reserva');
    this.name = 'TenantMismatchError';
    this.tenantIdBloqueo = tenantIdBloqueo;
    this.tenantIdReserva = tenantIdReserva;
  }
}

/**
 * La `(tenant_id, fecha)` ya tiene un bloqueo activo de otra reserva. Traducción
 * del `P2002` de Prisma; lo recibe el flujo invocante para decidir (p. ej. cola).
 */
export class FechaYaBloqueadaError extends Error {
  readonly codigo = 'FECHA_YA_BLOQUEADA' as const;
  readonly tenantId: string;
  readonly fecha: Date;
  readonly reservaIdExistente: string | null;

  constructor(tenantId: string, fecha: Date, reservaIdExistente: string | null) {
    super('La fecha ya está bloqueada por otra reserva');
    this.name = 'FechaYaBloqueadaError';
    this.tenantId = tenantId;
    this.fecha = fecha;
    this.reservaIdExistente = reservaIdExistente;
  }
}

/**
 * La RESERVA ya tiene un bloqueo de fecha asociado (`reserva_id @unique`). A
 * diferencia de `FechaYaBloqueadaError`, NO indica colisión sobre la fecha sino
 * que la propia reserva ya bloquea OTRA fecha; se distingue traduciendo el
 * `P2002` por el `target` del índice (`reserva_id`) para no engañar al invocante.
 */
export class ReservaYaTieneBloqueoError extends Error {
  readonly codigo = 'RESERVA_YA_TIENE_BLOQUEO' as const;
  readonly tenantId: string;
  readonly reservaId: string;

  constructor(tenantId: string, reservaId: string) {
    super('La reserva ya tiene un bloqueo de fecha asociado');
    this.name = 'ReservaYaTieneBloqueoError';
    this.tenantId = tenantId;
    this.reservaId = reservaId;
  }
}

/**
 * Intento de `extend` (fase 2.c) sobre un bloqueo ya `firme`. Extender fijaría
 * el tipo a `blando` con un TTL finito, DEGRADANDO un bloqueo firme: la máquina
 * de estados no admite esa transición, así que se rechaza explícitamente en vez
 * de degradar silenciosamente (defensa en profundidad, design.md §D-2).
 */
export class ExtensionSobreBloqueoFirmeError extends Error {
  readonly codigo = 'EXTENSION_SOBRE_BLOQUEO_FIRME' as const;
  readonly tenantId: string;
  readonly fecha: Date;
  readonly reservaId: string;

  constructor(tenantId: string, fecha: Date, reservaId: string) {
    super('No se puede extender (degradar a blando) un bloqueo firme');
    this.name = 'ExtensionSobreBloqueoFirmeError';
    this.tenantId = tenantId;
    this.fecha = fecha;
    this.reservaId = reservaId;
  }
}

// ---------------------------------------------------------------------------
// Mapa canónico fase → (tipo, ttl, modo) — estructura declarativa (D-2)
// ---------------------------------------------------------------------------

const DIA_MS = 24 * 60 * 60 * 1000;

const sumarDias = (base: Date, dias: number): Date =>
  new Date(base.getTime() + dias * DIA_MS);

/**
 * TTL del bloqueo blando de la fase `2.v` (US-008 / §D-2): el FIN del día NATURAL
 * (UTC) POSTERIOR a la fecha de la visita, es decir `visita + 1 día` a las
 * `23:59:59`. Función pura (una sola fuente de verdad del cálculo del TTL de visita),
 * reutilizada por `resolverPlanBloqueo`. NO deriva del setting
 * `max_dias_programar_visita` (que solo acota la ventana de ENTRADA): el TTL deriva
 * de la fecha de visita elegida.
 */
export const ttlVisitaMasUnDia = (visitaProgramadaFecha: Date): Date =>
  new Date(
    Date.UTC(
      visitaProgramadaFecha.getUTCFullYear(),
      visitaProgramadaFecha.getUTCMonth(),
      visitaProgramadaFecha.getUTCDate() + 1,
      23,
      59,
      59,
    ),
  );

/** Día natural en UTC (epoch del inicio del día) para comparar fechas. */
const inicioDiaUtc = (d: Date): number =>
  Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());

/**
 * Regla ÚNICA de "fecha válida" del proyecto (US-040, reutilizada por el alta con
 * fecha de US-004 §D-1): la fecha debe ser ESTRICTAMENTE FUTURA (día natural en
 * UTC), rechazando tanto el pasado como el mismo día. Función pura: el invocante
 * inyecta `ahora` (determinismo). El bloqueo (US-040) y el alta (US-004) enrutan
 * por esta misma regla, coherente con el motor de tarifa (US-016).
 */
export const esFechaEstrictamenteFutura = (fecha: Date, ahora: Date): boolean => {
  if (!(fecha instanceof Date) || Number.isNaN(fecha.getTime())) {
    return false;
  }
  return inicioDiaUtc(fecha) > inicioDiaUtc(ahora);
};

/**
 * Primitiva PURA de extensión del TTL (US-007 / §D-4). Calcula el TTL absoluto del
 * bloqueo blando SOBRE EL TTL ACTUAL de la RESERVA (`base`), NO sobre `now()`: una
 * consulta con bloqueo aún vigente SUMA los días al vencimiento existente. Una sola
 * fuente de verdad reutilizada por el use-case y el adaptador (UPDATE de RESERVA +
 * FECHA_BLOQUEADA al mismo valor). No muta `base` (devuelve una `Date` nueva).
 */
export const extenderTtl = (base: Date, deltaDias: number): Date =>
  sumarDias(base, deltaDias);

export interface ResolverPlanBloqueoInput {
  fase: FaseBloqueo;
  ahora: Date;
  settings: TenantSettingsBloqueo;
  visitaProgramadaFecha?: Date;
}

/**
 * Resuelve el plan de bloqueo desde la fase. Función pura: no toca la BD ni el
 * reloj global. El mapa es una tabla de datos (no `if/else` disperso).
 */
export const resolverPlanBloqueo = (input: ResolverPlanBloqueoInput): PlanBloqueo => {
  const { fase, ahora, settings, visitaProgramadaFecha } = input;

  switch (fase) {
    case '2.b':
      return {
        modo: 'insert',
        tipo: 'blando',
        ttl: sumarDias(ahora, settings.ttlConsultaDias),
      };
    case '2.c':
      // Extensión del bloqueo existente: incremento = ttl_consulta_dias, sin
      // cambiar el tipo. El TTL absoluto lo calcula la infraestructura sobre el
      // valor persistido (UPDATE en la misma transacción serializada).
      return {
        modo: 'extend',
        tipo: 'blando',
        ttl: null,
        ttlDeltaDias: settings.ttlConsultaDias,
      };
    case '2.v':
      if (!(visitaProgramadaFecha instanceof Date) || Number.isNaN(visitaProgramadaFecha.getTime())) {
        throw new ValidacionBloqueoError(
          'La fase 2.v requiere una visita_programada_fecha válida',
        );
      }
      // TTL = fin del día (23:59:59 UTC) POSTERIOR a la visita (§D-2). El `modo` es
      // `insert` en el mapa canónico; la transición de US-008 (§D-2) refina la
      // ACCIÓN observable a insert-o-update (upsert) según el origen tenga o no fila
      // de bloqueo, conservando este TTL como única fuente de verdad del cálculo.
      return {
        modo: 'insert',
        tipo: 'blando',
        ttl: ttlVisitaMasUnDia(visitaProgramadaFecha),
      };
    case 'pre_reserva':
      return {
        modo: 'insert',
        tipo: 'blando',
        ttl: sumarDias(ahora, settings.ttlPrereservaDias),
      };
    case 'reserva_confirmada':
      return {
        modo: 'upgrade',
        tipo: 'firme',
        ttl: null,
      };
    default:
      throw new ValidacionBloqueoError(`Fase de bloqueo no contemplada: ${String(fase)}`);
  }
};

// ---------------------------------------------------------------------------
// Servicio de dominio
// ---------------------------------------------------------------------------

export class BloquearFechaService {
  constructor(private readonly deps: BloquearFechaDeps) {}

  async ejecutar(comando: BloquearFechaComando): Promise<FechaBloqueadaResultado> {
    // Paso 1: validaciones de dominio previas a la transacción (D-8 paso 1).
    this.validarTenant(comando);
    this.validarFechaFutura(comando.fecha);

    // Paso 2: leer TTL de TENANT_SETTINGS (nunca hardcodeados) y resolver plan.
    const settings = await this.deps.tenantSettings.obtener(comando.tenantId);
    if (settings === null) {
      throw new ValidacionBloqueoError(
        `No hay TENANT_SETTINGS configurado para el tenant ${comando.tenantId}`,
      );
    }
    const plan = resolverPlanBloqueo({
      fase: comando.fase,
      ahora: this.deps.clock.ahora(),
      settings,
      visitaProgramadaFecha: comando.reserva.visitaProgramadaFecha,
    });

    // Paso 3: aplicar el plan vía la transacción del repositorio (D-8 pasos 3-5).
    return this.deps.repositorio.bloquear({
      tenantId: comando.tenantId,
      fecha: comando.fecha,
      reservaId: comando.reserva.idReserva,
      plan,
    });
  }

  private validarTenant(comando: BloquearFechaComando): void {
    if (comando.tenantId !== comando.reserva.tenantId) {
      throw new TenantMismatchError(comando.tenantId, comando.reserva.tenantId);
    }
  }

  private validarFechaFutura(fecha: Date): void {
    if (!(fecha instanceof Date) || Number.isNaN(fecha.getTime())) {
      throw new ValidacionBloqueoError('La fecha del bloqueo es obligatoria y válida');
    }
    // La fecha debe ser estrictamente futura: no se admite el mismo día. Regla
    // única del proyecto (reutilizada por US-004 §D-1 vía `esFechaEstrictamenteFutura`).
    if (!esFechaEstrictamenteFutura(fecha, this.deps.clock.ahora())) {
      throw new FechaEnPasadoError(fecha);
    }
  }
}

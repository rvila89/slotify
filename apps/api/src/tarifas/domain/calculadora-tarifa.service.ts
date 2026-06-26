/**
 * Motor de cálculo de tarifa (US-016 / UC-16) — DOMINIO PURO.
 *
 * Operación stateless, determinista y de LECTURA PURA: no muta entidades, no
 * importa `@nestjs/*`, Prisma ni infraestructura (hexagonal, hook
 * `no-infra-in-domain`). Depende solo de PUERTOS (interfaces) que la
 * infraestructura implementa con adaptadores Prisma.
 *
 * Esquema de salida canónico (design.md §D-1):
 *   { temporada, tarifaAConsultar, precioTarifaEur, extrasTotalEur, totalEur, tarifaId }
 *
 * Orden de evaluación (design.md §D-5):
 *   1. validar inputs
 *   2. determinar temporada (TEMPORADA_CALENDARIO)
 *   3. si num_adultos_ninos_mayores4 > 50 → tarifa_a_consultar (sin tarifa ni extras)
 *   4. buscar TARIFA vigente
 *   5. sumar extras (catálogo del tenant)
 *   6. componer output canónico
 */

// ---------------------------------------------------------------------------
// Tipos de dominio
// ---------------------------------------------------------------------------

export type Temporada = 'alta' | 'media' | 'baja';

/** Un extra solicitado al motor: referencia al catálogo del tenant + cantidad. */
export interface CalcularTarifaExtraInput {
  extraId: string;
  cantidad: number;
}

/** Input del motor (US-016 §Reglas de Validación). */
export interface CalcularTarifaInput {
  fechaEvento: Date;
  duracionHoras: number;
  numAdultosNinosMayores4: number;
  extras: CalcularTarifaExtraInput[];
}

/** Esquema de salida canónico unificado (D-1). */
export interface CalculoTarifaResultado {
  temporada: Temporada;
  tarifaAConsultar: boolean;
  precioTarifaEur: number | null;
  extrasTotalEur: number | null;
  totalEur: number | null;
  tarifaId: string | null;
}

// ---------------------------------------------------------------------------
// Puertos (interfaces) — implementados en infraestructura (adaptadores Prisma)
// ---------------------------------------------------------------------------

/** Resuelve la temporada vigente del tenant para un mes (1-12). */
export interface TemporadaCalendarioPort {
  resolverTemporada(params: {
    tenantId: string;
    mes: number;
  }): Promise<Temporada | null>;
}

/** Busca la fila de TARIFA vigente por temporada × duración × tramo × fecha. */
export interface TarifaRepositoryPort {
  buscarVigente(params: {
    tenantId: string;
    temporada: Temporada;
    duracionHoras: number;
    numInvitados: number;
    fechaEvento: Date;
  }): Promise<{ idTarifa: string; precioTotalEur: number } | null>;
}

/** Lee un EXTRA del catálogo del tenant por id (RLS: cross-tenant → null). */
export interface ExtraRepositoryPort {
  buscarPorId(params: {
    tenantId: string;
    extraId: string;
  }): Promise<{ idExtra: string; precioEur: number; activo: boolean } | null>;
}

/** Reloj inyectable para determinismo (validación de fecha pasada). */
export interface ClockPort {
  ahora(): Date;
}

/** Dependencias del motor: puertos inyectados (hexagonal). */
export interface CalculadoraTarifaDeps {
  temporadaCalendario: TemporadaCalendarioPort;
  tarifaRepository: TarifaRepositoryPort;
  extraRepository: ExtraRepositoryPort;
  clock: ClockPort;
}

// ---------------------------------------------------------------------------
// Errores de dominio tipados (design.md §D-3)
// ---------------------------------------------------------------------------

/** Input inválido (paso 1). Se traduce a 400 en la capa HTTP. */
export class ValidacionTarifaError extends Error {
  readonly codigo = 'VALIDACION' as const;
  readonly campo: string;

  constructor(campo: string, mensaje: string) {
    super(mensaje);
    this.name = 'ValidacionTarifaError';
    this.campo = campo;
  }
}

/** Mes sin fila en TEMPORADA_CALENDARIO del tenant. Se traduce a 422. */
export class TemporadaNoConfiguradaError extends Error {
  readonly codigo = 'TEMPORADA_NO_CONFIGURADA' as const;
  readonly mes: number;

  constructor(mes: number) {
    super(`No hay temporada configurada para el mes ${mes}`);
    this.name = 'TemporadaNoConfiguradaError';
    this.mes = mes;
  }
}

/** Combinación válida (≤50) sin fila de TARIFA vigente. Se traduce a 422. */
export class TarifaNoConfiguradaError extends Error {
  readonly codigo = 'TARIFA_NO_CONFIGURADA' as const;
  readonly temporada: Temporada;
  readonly duracionHoras: number;
  readonly numInvitados: number;

  constructor(temporada: Temporada, duracionHoras: number, numInvitados: number) {
    super(
      `No hay tarifa configurada para temporada ${temporada}, ${duracionHoras}h, ${numInvitados} invitados`,
    );
    this.name = 'TarifaNoConfiguradaError';
    this.temporada = temporada;
    this.duracionHoras = duracionHoras;
    this.numInvitados = numInvitados;
  }
}

export type MotivoExtraNoEncontrado = 'inexistente' | 'inactivo';

/** Extra inexistente, inactivo o no visible por RLS. Se traduce a 404. */
export class ExtraNoEncontradoError extends Error {
  readonly codigo = 'EXTRA_NO_ENCONTRADO' as const;
  readonly extraId: string;
  readonly motivo: MotivoExtraNoEncontrado;

  constructor(extraId: string, motivo: MotivoExtraNoEncontrado) {
    super(`Extra ${extraId} no encontrado (${motivo})`);
    this.name = 'ExtraNoEncontradoError';
    this.extraId = extraId;
    this.motivo = motivo;
  }
}

// ---------------------------------------------------------------------------
// Constantes de validación
// ---------------------------------------------------------------------------

const DURACIONES_VALIDAS: readonly number[] = [4, 8, 12];
const LIMITE_TARIFA_A_CONSULTAR = 50;

// ---------------------------------------------------------------------------
// Servicio de dominio
// ---------------------------------------------------------------------------

export class CalculadoraTarifaService {
  constructor(private readonly deps: CalculadoraTarifaDeps) {}

  async calcular(
    input: CalcularTarifaInput,
    tenantId: string,
  ): Promise<CalculoTarifaResultado> {
    // Paso 1: validar inputs (antes de cualquier lookup).
    this.validarInput(input);

    // Paso 2: determinar temporada por el mes (UTC) de fecha_evento.
    const mes = input.fechaEvento.getUTCMonth() + 1;
    const temporada = await this.deps.temporadaCalendario.resolverTemporada({
      tenantId,
      mes,
    });
    if (temporada === null) {
      throw new TemporadaNoConfiguradaError(mes);
    }

    // Paso 3: corte por >50 invitados → tarifa a consultar (sin tarifa ni extras).
    const numInvitados = input.numAdultosNinosMayores4;
    if (numInvitados > LIMITE_TARIFA_A_CONSULTAR) {
      return {
        temporada,
        tarifaAConsultar: true,
        precioTarifaEur: null,
        extrasTotalEur: null,
        totalEur: null,
        tarifaId: null,
      };
    }

    // Paso 4: buscar TARIFA vigente.
    const tarifa = await this.deps.tarifaRepository.buscarVigente({
      tenantId,
      temporada,
      duracionHoras: input.duracionHoras,
      numInvitados,
      fechaEvento: input.fechaEvento,
    });
    if (tarifa === null) {
      throw new TarifaNoConfiguradaError(temporada, input.duracionHoras, numInvitados);
    }

    // Paso 5: sumar extras del catálogo del tenant.
    const extrasTotalEur = await this.sumarExtras(input.extras, tenantId);

    // Paso 6: componer output canónico.
    const precioTarifaEur = tarifa.precioTotalEur;
    return {
      temporada,
      tarifaAConsultar: false,
      precioTarifaEur,
      extrasTotalEur,
      totalEur: precioTarifaEur + extrasTotalEur,
      tarifaId: tarifa.idTarifa,
    };
  }

  private validarInput(input: CalcularTarifaInput): void {
    const { fechaEvento, duracionHoras, numAdultosNinosMayores4, extras } = input;

    if (!(fechaEvento instanceof Date) || Number.isNaN(fechaEvento.getTime())) {
      throw new ValidacionTarifaError('fechaEvento', 'La fecha de evento es obligatoria y válida');
    }
    // La fecha del evento debe ser estrictamente futura: no se admiten
    // reservas del mismo día (regla de negocio Masia l'Encís). Se compara por
    // día natural en UTC para no depender de la hora del instante actual.
    const inicioDiaUtc = (d: Date): number =>
      Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate());
    if (inicioDiaUtc(fechaEvento) <= inicioDiaUtc(this.deps.clock.ahora())) {
      throw new ValidacionTarifaError(
        'fechaEvento',
        'La fecha del evento debe ser futura (no se admite el mismo día)',
      );
    }
    if (!DURACIONES_VALIDAS.includes(duracionHoras)) {
      throw new ValidacionTarifaError('duracionHoras', 'La duración debe ser 4, 8 o 12 horas');
    }
    if (!Number.isInteger(numAdultosNinosMayores4) || numAdultosNinosMayores4 < 0) {
      throw new ValidacionTarifaError(
        'numAdultosNinosMayores4',
        'El número de invitados no puede ser negativo',
      );
    }
    (extras ?? []).forEach((extra) => {
      if (!Number.isInteger(extra.cantidad) || extra.cantidad < 1) {
        throw new ValidacionTarifaError('extras.cantidad', 'La cantidad de cada extra debe ser >= 1');
      }
    });
  }

  private async sumarExtras(
    extras: CalcularTarifaExtraInput[],
    tenantId: string,
  ): Promise<number> {
    let total = 0;
    for (const solicitado of extras ?? []) {
      const extra = await this.deps.extraRepository.buscarPorId({
        tenantId,
        extraId: solicitado.extraId,
      });
      if (extra === null) {
        throw new ExtraNoEncontradoError(solicitado.extraId, 'inexistente');
      }
      if (!extra.activo) {
        throw new ExtraNoEncontradoError(solicitado.extraId, 'inactivo');
      }
      total += extra.precioEur * solicitado.cantidad;
    }
    return total;
  }
}

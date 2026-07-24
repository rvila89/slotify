/**
 * Caso de uso de APLICACIÓN: generar los BORRADORES de liquidación y fianza (US-027 / UC-21,
 * UC-22) — efecto POST-COMMIT de la activación de los sub-procesos de la confirmación (US-021,
 * design.md §D-1).
 *
 * Al activarse los sub-procesos de liquidación y fianza (`reserva_confirmada` +
 * `liquidacion_status = pendiente`), crea DOS documentos de cobro en borrador dentro de UNA
 * transacción de facturación (atómica entre sí + sus AUDIT_LOG):
 *   - FACTURA `tipo='liquidacion'`, `estado='borrador'`, `numero_factura=NULL`,
 *     `total = importe_liquidacion + Σ(RESERVA_EXTRA.subtotal WHERE factura_id IS NULL)`,
 *     con desglose fiscal reutilizado de US-022 (base derivada del total, IVA por resta) (§D-2).
 *   - FACTURA `tipo='fianza'`, `estado='borrador'`, `numero_factura=NULL`,
 *     `total = TENANT_SETTINGS.fianza_default_eur`, con el MISMO desglose fiscal (§D-3).
 *     Edge case `fianza_default_eur = 0` → NO se crea la fianza; `fianza_status` sigue
 *     `pendiente`; la alerta al Gestor menciona SOLO la liquidación (`fianzaOmitida = true`).
 *
 * Idempotencia (§D-4): antes de crear cada documento comprueba si ya existe una FACTURA de ese
 * `(reserva_id, tipo)` en `borrador`/`enviada`; si existe, NO duplica. Ante colisión concurrente
 * (`P2002` del `UNIQUE(reserva_id, tipo)` ya migrado en US-022) recupera la existente. NUNCA
 * locks distribuidos (hook `no-distributed-lock`).
 *
 * NO marca los RESERVA_EXTRA con `factura_id` (eso es US-028): en borrador el vínculo aún no se
 * fija (§D-2). AUDIT_LOG `accion='crear'`, `entidad='FACTURA'` por cada documento creado.
 *
 * Hexagonal (hook `no-infra-in-domain`): depende SOLO de puertos inyectados; no importa Prisma
 * ni `@nestjs/*`.
 */
import { calcularTotalLiquidacion } from '../domain/calculo-total-liquidacion';
import {
  calcularDesgloseFactura,
  type RegimenIvaFactura,
} from '../domain/calculo-factura';

// ---------------------------------------------------------------------------
// Tipos de comando / proyecciones / puertos
// ---------------------------------------------------------------------------

/** Estados de RESERVA relevantes para la guarda de origen (subconjunto laxo). */
export type EstadoReservaLiquidable =
  | 'reserva_confirmada'
  | 'pre_reserva'
  | 'consulta'
  | 'reserva_cancelada'
  | string;

/** Comando de generación de los borradores (tenant del disparo, nunca del body). */
export interface GenerarBorradoresComando {
  tenantId: string;
  reservaId: string;
}

/** Proyección de la RESERVA liquidable (origen + importe de liquidación congelado). */
export interface ReservaLiquidable {
  idReserva: string;
  tenantId: string;
  codigo: string;
  estado: EstadoReservaLiquidable;
  liquidacionStatus: string;
  fianzaStatus: string;
  /** Importe de liquidación congelado en US-021 (60 % MVP), Decimal string. */
  importeLiquidacion: string;
  /**
   * 6.3: régimen IVA del presupuesto aceptado de la reserva (design.md §D-1). Gobierna el
   * desglose fiscal de los borradores de liquidación y fianza. `con_iva` por defecto.
   */
  regimenIva: RegimenIvaFactura;
}

/** Línea de RESERVA_EXTRA pendiente (`factura_id IS NULL`); subtotal congelado. */
export interface ExtraPendiente {
  subtotal: string;
}

/** FACTURA en borrador (proyección de lectura/escritura). `numeroFactura` NULL en borrador. */
export interface BorradorFactura {
  idFactura: string;
  tenantId: string;
  reservaId: string;
  numeroFactura: string | null;
  tipo: 'liquidacion';
  estado: 'borrador' | 'enviada' | 'cobrada';
  total: string;
  baseImponible: string;
  ivaPorcentaje: string;
  ivaImporte: string;
}

/** Parámetros de creación de un borrador (tx-bound). `numeroFactura` NULL: se difiere a la emisión. */
export interface CrearBorradorParams {
  tenantId: string;
  reservaId: string;
  numeroFactura: null;
  tipo: 'liquidacion';
  estado: 'borrador';
  total: string;
  baseImponible: string;
  ivaPorcentaje: string;
  ivaImporte: string;
  concepto: string;
}

/** Registro de auditoría de la creación de un borrador. */
export interface RegistroAuditoriaBorrador {
  tenantId: string;
  entidad: 'FACTURA';
  entidadId: string;
  accion: 'crear';
  datosNuevos?: Record<string, unknown> | null;
}

/** Repositorio tx-bound de FACTURA (borradores). */
export interface FacturaBorradorRepositoryPort {
  buscarPorReservaYTipo(
    reservaId: string,
    tipo: 'liquidacion',
  ): Promise<BorradorFactura | null>;
  crear(params: CrearBorradorParams): Promise<BorradorFactura>;
}

/** Repositorio tx-bound de AUDIT_LOG. */
export interface AuditoriaBorradorPort {
  registrar(registro: RegistroAuditoriaBorrador): Promise<void>;
}

/** Conjunto de repositorios disponibles dentro de la unidad de trabajo. */
export interface RepositoriosBorradores {
  facturas: FacturaBorradorRepositoryPort;
  auditoria: AuditoriaBorradorPort;
}

/**
 * Unidad de trabajo transaccional (tx + RLS). Los dos borradores + sus AUDIT_LOG se crean en
 * UNA transacción (atómica entre sí, §D-1). Un fallo dentro del `trabajo` revierte todo; el
 * adaptador propaga `P2002` para la recuperación por idempotencia.
 */
export interface UnidadDeTrabajoBorradoresPort {
  ejecutar(
    tenantId: string,
    trabajo: (repos: RepositoriosBorradores) => Promise<unknown>,
  ): Promise<unknown>;
}

/** Lectura de la RESERVA liquidable (fuera de la tx; RLS: cross-tenant → null). */
export interface CargarReservaLiquidablePort {
  (params: {
    tenantId: string;
    reservaId: string;
  }): Promise<ReservaLiquidable | null | undefined>;
}

/** Lectura de los RESERVA_EXTRA pendientes (filtra `factura_id IS NULL`; RLS). */
export interface CargarExtrasPendientesPort {
  (params: {
    tenantId: string;
    reservaId: string;
  }): Promise<ReadonlyArray<ExtraPendiente>>;
}

/** Dependencias del caso de uso (puertos inyectados). */
export interface GenerarBorradoresLiquidacionFianzaDeps {
  unidadDeTrabajo: UnidadDeTrabajoBorradoresPort;
  cargarReserva: CargarReservaLiquidablePort;
  cargarExtrasPendientes: CargarExtrasPendientesPort;
}

/**
 * Resultado: SOLO el borrador de liquidación (fix-liquidacion-fianza-independientes: la fianza
 * deja de generarse como FACTURA). `fianza` y `fianzaOmitida` se conservan para compatibilidad
 * de firma pero son siempre `null`/`true` (nunca se crea recibo de fianza).
 */
export interface GenerarBorradoresResultado {
  liquidacion: BorradorFactura;
  fianza: null;
  fianzaOmitida: true;
}

// ---------------------------------------------------------------------------
// Errores de dominio tipados, en español
// ---------------------------------------------------------------------------

/** La RESERVA no está en `reserva_confirmada`: no procede generar los borradores. Mapea a 422. */
export class ReservaNoConfirmadaError extends Error {
  readonly codigo = 'RESERVA_NO_CONFIRMADA' as const;
  readonly reservaId: string;

  constructor(reservaId: string) {
    super('La reserva no está en estado reserva_confirmada');
    this.name = 'ReservaNoConfirmadaError';
    this.reservaId = reservaId;
  }
}

/** La RESERVA no existe para el tenant (RLS): cross-tenant es invisible → 404. */
export class ReservaBorradoresNoEncontradaError extends Error {
  readonly codigo = 'RESERVA_NO_ENCONTRADA' as const;
  readonly reservaId: string;

  constructor(reservaId: string) {
    super('La reserva no existe para el tenant');
    this.name = 'ReservaBorradoresNoEncontradaError';
    this.reservaId = reservaId;
  }
}

// ---------------------------------------------------------------------------
// Constantes y helpers puros
// ---------------------------------------------------------------------------

/** ¿El error es una violación de unicidad (`P2002`) del `UNIQUE(reserva_id, tipo)`? */
const esColisionUnicidad = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: string }).code === 'P2002';

// ---------------------------------------------------------------------------
// Caso de uso
// ---------------------------------------------------------------------------

export class GenerarBorradoresLiquidacionFianzaUseCase {
  constructor(private readonly deps: GenerarBorradoresLiquidacionFianzaDeps) {}

  /**
   * Genera (o recupera, si ya existen) los borradores de liquidación y fianza de la reserva.
   * Ambos en UNA transacción; la fianza se omite si `fianza_default_eur = 0` (§D-3).
   */
  async ejecutar(
    comando: GenerarBorradoresComando,
  ): Promise<GenerarBorradoresResultado> {
    // (0) Carga la RESERVA + guardas de origen (fuera de la tx crítica).
    const reserva = await this.deps.cargarReserva({
      tenantId: comando.tenantId,
      reservaId: comando.reservaId,
    });
    if (reserva === null || reserva === undefined) {
      throw new ReservaBorradoresNoEncontradaError(comando.reservaId);
    }
    if (reserva.estado !== 'reserva_confirmada') {
      throw new ReservaNoConfirmadaError(comando.reservaId);
    }

    // (1) Total de la liquidación (60 % + Σ extras pendientes) + desglose fiscal reutilizado.
    const extras = await this.deps.cargarExtrasPendientes({
      tenantId: comando.tenantId,
      reservaId: comando.reservaId,
    });
    const totalLiquidacion = calcularTotalLiquidacion({
      importeLiquidacion: reserva.importeLiquidacion,
      subtotalesExtrasPendientes: extras.map((e) => e.subtotal),
    });
    const desgloseLiquidacion = calcularDesgloseFactura(totalLiquidacion, reserva.regimenIva);

    // (2) UNA unidad de trabajo (tx + RLS) con reintento ante colisión de idempotencia
    //     (`P2002` del UNIQUE(reserva_id, tipo)); nunca locks distribuidos. E4 = solo
    //     liquidación: la fianza deja de generarse como FACTURA.
    let ultimoError: unknown = null;
    for (let intento = 0; intento < 2; intento += 1) {
      try {
        return (await this.deps.unidadDeTrabajo.ejecutar(
          comando.tenantId,
          async (repos): Promise<GenerarBorradoresResultado> => {
            const liquidacion = await this.crearOExistente(comando, repos, {
              total: desgloseLiquidacion.total,
              baseImponible: desgloseLiquidacion.baseImponible,
              ivaPorcentaje: desgloseLiquidacion.ivaPorcentaje,
              ivaImporte: desgloseLiquidacion.ivaImporte,
              concepto: `Liquidación reserva ${reserva.codigo}`,
            });
            return { liquidacion, fianza: null, fianzaOmitida: true };
          },
        )) as GenerarBorradoresResultado;
      } catch (error) {
        if (esColisionUnicidad(error)) {
          ultimoError = error;
          continue;
        }
        throw error;
      }
    }
    throw ultimoError ?? new Error('No se pudo generar el borrador de liquidación');
  }

  /**
   * Idempotencia por `(reserva_id, tipo)`: si ya existe el borrador (en `borrador`/`enviada`),
   * NO lo duplica y lo devuelve. Si no existe, lo crea en `borrador` con `numero_factura=NULL`
   * y audita la creación (`accion='crear'`, `entidad='FACTURA'`).
   */
  private async crearOExistente(
    comando: GenerarBorradoresComando,
    repos: RepositoriosBorradores,
    datos: {
      total: string;
      baseImponible: string;
      ivaPorcentaje: string;
      ivaImporte: string;
      concepto: string;
    },
  ): Promise<BorradorFactura> {
    const previa = await repos.facturas.buscarPorReservaYTipo(comando.reservaId, 'liquidacion');
    if (previa !== null) {
      return previa;
    }
    const factura = await repos.facturas.crear({
      tenantId: comando.tenantId,
      reservaId: comando.reservaId,
      numeroFactura: null,
      tipo: 'liquidacion',
      estado: 'borrador',
      total: datos.total,
      baseImponible: datos.baseImponible,
      ivaPorcentaje: datos.ivaPorcentaje,
      ivaImporte: datos.ivaImporte,
      concepto: datos.concepto,
    });
    await repos.auditoria.registrar({
      tenantId: comando.tenantId,
      entidad: 'FACTURA',
      entidadId: factura.idFactura,
      accion: 'crear',
      datosNuevos: {
        reservaId: comando.reservaId,
        tipo: 'liquidacion',
        estado: 'borrador',
        numeroFactura: null,
      },
    });
    return factura;
  }
}

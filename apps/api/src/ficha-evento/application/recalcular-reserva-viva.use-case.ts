/**
 * Caso de uso `RecalcularReservaVivaUseCase` (change `reserva-viva-edicion-recalculo-
 * ficha`, §D-4/§D-5/§D-7).
 *
 * Orquesta el RECÁLCULO EN CASCADA del importe de una RESERVA `reserva_confirmada`
 * cuando el gestor cambia el aforo/duración desde la ficha operativa, dentro de la
 * VENTANA VIVA (§D-3). All-or-nothing, idempotente, sin locks distribuidos.
 *
 * Orden (§D-4):
 *   0. Guardas SÍNCRONAS previas (sin efectos): existencia + RLS (404,
 *      `ReservaRecalculoNoEncontradaError`); ventana viva D-3 (422,
 *      `FueraDeVentanaVivaError`); `importe_senal` presente (422,
 *      `ImporteSenalInvalidoError`). SIN CAMBIO REAL (mismo aforo/duración) → NO-OP.
 *   1. Nuevo total con `CalculadoraTarifaService` (extras vigentes los resuelve el
 *      adaptador del motor). `tarifaAConsultar` (>50 / TarifaNoConfigurada) → exige
 *      `precioManualEur` (422, `PrecioManualRequeridoError`).
 *   2. En UNA transacción (tx + RLS), con reintento acotado ante `P2002` de
 *      `@@unique([reservaId, version])`:
 *      a. RE-EVALUAR la guarda de ventana viva con la lectura FRESCA bajo la tx.
 *      b. Nueva versión de PRESUPUESTO de modificación (`version = MAX+1`,
 *         `origen='modificacion'`, `pagoInicial=importe_senal`,
 *         `liquidacionRestante=nuevo_total−importe_senal`).
 *      c. Persistir el desglose estructurado en la RESERVA.
 *      d. Re-congelar `importe_total`/`importe_liquidacion`. `importe_senal` INTACTO.
 *      e. Regenerar la FACTURA `tipo='liquidacion'` (borrador|enviada, nunca cobrada).
 *      f. AUDIT_LOG de cada mutación.
 *   3. Post-commit: disparar el email E9 (no revierte la tx).
 *
 * Hexagonal (hook `no-infra-in-domain`): depende SOLO de puertos inyectados; no importa
 * Prisma ni `@nestjs/*`. Sin Redis/Redlock (hook `no-distributed-lock`).
 */
import {
  esEditableEnVentanaViva,
  type EstadoReserva,
  type LiquidacionStatusDominio,
  type PreEventoStatusDominio,
} from '../../reservas/domain/maquina-estados';

// ---------------------------------------------------------------------------
// Errores de dominio tipados (español), con propiedad `codigo`
// ---------------------------------------------------------------------------

/**
 * La edición de aforo/duración con recálculo está FUERA de la ventana viva (§D-3): la
 * RESERVA no está `reserva_confirmada`, la ficha está `cerrado` o la liquidación
 * `cobrada`. El controlador lo mapea a 422 con `codigo:'fuera_de_ventana_viva'`.
 */
export class FueraDeVentanaVivaError extends Error {
  readonly codigo = 'fuera_de_ventana_viva' as const;

  constructor(
    message = 'La reserva no admite recálculo de aforo/duración fuera de la ventana viva',
  ) {
    super(message);
    this.name = 'FueraDeVentanaVivaError';
  }
}

/** `tarifaAConsultar` (>50 / sin tarifa) sin `precioManualEur`. Mapea a 422. */
export class PrecioManualRequeridoError extends Error {
  readonly codigo = 'precio_manual_requerido' as const;

  constructor(
    message = 'Se requiere un precio manual para recalcular (tarifa a consultar, >50 invitados)',
  ) {
    super(message);
    this.name = 'PrecioManualRequeridoError';
  }
}

/**
 * La RESERVA no tiene `importe_senal` congelado (no debería en `reserva_confirmada`, pero
 * defensivo): sin señal no se puede derivar el restante. Mapea a 422.
 */
export class ImporteSenalInvalidoError extends Error {
  readonly codigo = 'importe_senal_invalido' as const;

  constructor(
    message = 'La reserva no tiene un importe de señal congelado para derivar el restante',
  ) {
    super(message);
    this.name = 'ImporteSenalInvalidoError';
  }
}

/** La RESERVA no existe para el tenant (RLS): cross-tenant invisible → 404. */
export class ReservaRecalculoNoEncontradaError extends Error {
  readonly codigo = 'reserva_no_encontrada' as const;

  constructor(message = 'La reserva no existe para el tenant') {
    super(message);
    this.name = 'ReservaRecalculoNoEncontradaError';
  }
}

// ---------------------------------------------------------------------------
// Proyecciones de lectura
// ---------------------------------------------------------------------------

/** Estado de la FACTURA de liquidación relevante para la regeneración (§D-4.e). */
export type EstadoFacturaLiquidacion = 'borrador' | 'enviada' | 'cobrada';

/** Proyección de la FACTURA de liquidación vigente de la RESERVA. */
export interface FacturaLiquidacionRecalculo {
  idFactura: string;
  tipo: 'liquidacion';
  estado: EstadoFacturaLiquidacion;
}

/**
 * Proyección de la RESERVA en la ventana viva: estado + sub-procesos + importes
 * congelados + desglose estructurado + factura de liquidación vigente.
 */
export interface ReservaRecalculo {
  idReserva: string;
  tenantId: string;
  estado: EstadoReserva;
  preEventoStatus: PreEventoStatusDominio;
  liquidacionStatus: LiquidacionStatusDominio;
  fechaEvento: Date;
  idioma: string;
  /** Importes congelados (Decimal string). `importeSenal` NO se recalcula jamás. */
  importeTotal: string | null;
  importeSenal: string | null;
  importeLiquidacion: string | null;
  /** Desglose estructurado vigente (fuente del no-op y del motor de tarifa). */
  duracionHoras: number;
  numAdultosNinosMayores4: number;
  numNinosMenores4: number;
  numInvitadosFinal: number | null;
  /** FACTURA de liquidación vigente (o `null` si aún no se generó el borrador). */
  facturaLiquidacion: FacturaLiquidacionRecalculo | null;
}

// ---------------------------------------------------------------------------
// Motor de tarifa (subconjunto del puerto que este caso de uso consume)
// ---------------------------------------------------------------------------

/** Resultado del motor de tarifa que este caso de uso consume (§D-4.1). */
export interface ResultadoTarifaRecalculo {
  tarifaAConsultar: boolean;
  totalEur: number | null;
}

/** Motor de tarifa inyectado (subconjunto de `CalculadoraTarifaService`). */
export interface MotorTarifaRecalculoPort {
  calcular(
    input: {
      fechaEvento: Date;
      duracionHoras: number;
      numAdultosNinosMayores4: number;
      extras: Array<{ extraId: string; cantidad: number }>;
    },
    tenantId: string,
  ): Promise<ResultadoTarifaRecalculo>;
}

// ---------------------------------------------------------------------------
// Puertos tx-bound (dentro de la unidad de trabajo)
// ---------------------------------------------------------------------------

/** Parámetros de creación de la nueva versión de PRESUPUESTO de modificación. */
export interface CrearVersionModificacionParams {
  tenantId: string;
  reservaId: string;
  version: number;
  origen: 'modificacion';
  total: string;
  /** Pago inicial FIJO = `importe_senal` congelado (NO se recalcula el 40%). */
  pagoInicial: string;
  /** Restante = `nuevo_total − importe_senal`. */
  liquidacionRestante: string;
}

/** PRESUPUESTO de modificación creado (proyección de vuelta). */
export interface PresupuestoModificacionCreado {
  idPresupuesto: string;
  version: number;
  origen: string;
  total: string;
  pagoInicial: string;
  liquidacionRestante: string;
}

/** Repositorio tx-bound de PRESUPUESTO (versión de modificación). */
export interface PresupuestoRecalculoRepositoryPort {
  versionMaxima(params: { tenantId: string; reservaId: string }): Promise<number>;
  crearVersionModificacion(
    params: CrearVersionModificacionParams,
  ): Promise<PresupuestoModificacionCreado>;
}

/** Parámetros del re-congelado de importes en la RESERVA (§D-4.d). */
export interface RecongelarImportesParams {
  tenantId: string;
  reservaId: string;
  importeTotal: string;
  /** `importe_senal` congelado; se re-escribe con el MISMO valor (invariante DURA). */
  importeSenal: string;
  importeLiquidacion: string;
}

/** Parámetros del guardado del desglose estructurado en la RESERVA (§D-4.c). */
export interface GuardarDesgloseParams {
  tenantId: string;
  reservaId: string;
  duracionHoras: number;
  numAdultosNinosMayores4: number;
  numNinosMenores4: number;
}

/** Repositorio tx-bound de RESERVA (re-congelado + desglose estructurado). */
export interface ReservaRecalculoRepositoryPort {
  recongelarImportes(params: RecongelarImportesParams): Promise<void>;
  guardarDesglose(params: GuardarDesgloseParams): Promise<void>;
}

/** Parámetros de la regeneración de la FACTURA de liquidación (§D-4.e). */
export interface RegenerarLiquidacionParams {
  tenantId: string;
  reservaId: string;
  idFactura: string;
  /** Nuevo importe total de la liquidación (`nuevo_total − importe_senal`). */
  total: string;
}

/** Repositorio tx-bound de FACTURA (liquidación; la fianza NUNCA se toca aquí). */
export interface FacturaRecalculoRepositoryPort {
  regenerarLiquidacion(params: RegenerarLiquidacionParams): Promise<void>;
  /** Presente solo para el espía del test: JAMÁS se invoca (la fianza es intocable). */
  regenerarFianza?(params: unknown): Promise<void>;
}

/** Registro de auditoría de una mutación del recálculo. */
export interface RegistroAuditoriaRecalculo {
  tenantId: string;
  usuarioId?: string | null;
  entidad: 'RESERVA' | 'PRESUPUESTO' | 'FACTURA';
  entidadId: string;
  accion: 'actualizar';
  datosNuevos?: Record<string, unknown>;
}

/** Repositorio tx-bound de AUDIT_LOG. */
export interface AuditoriaRecalculoPort {
  registrar(registro: RegistroAuditoriaRecalculo): Promise<void>;
}

/** Conjunto de repositorios disponibles dentro de la unidad de trabajo del recálculo. */
export interface ReposRecalculo {
  presupuestos: PresupuestoRecalculoRepositoryPort;
  reservas: ReservaRecalculoRepositoryPort;
  facturas: FacturaRecalculoRepositoryPort;
  auditoria: AuditoriaRecalculoPort;
}

/**
 * Unidad de trabajo transaccional del recálculo (tx + RLS). El adaptador envuelve
 * `$transaction` + `fijarTenant(tenantId)` y expone los repositorios tx-bound. Si el
 * `trabajo` rechaza, la transacción revierte por completo (all-or-nothing).
 */
export interface UnidadDeTrabajoRecalculoPort {
  ejecutar(
    tenantId: string,
    trabajo: (repos: ReposRecalculo) => Promise<unknown>,
  ): Promise<unknown>;
}

/**
 * Disparo POST-COMMIT del email E9 de modificación (adaptador que reutiliza el motor de
 * email US-045). Best-effort: un fallo NO revierte la tx ya comprometida.
 */
export interface DispararE9Port {
  (params: {
    tenantId: string;
    reservaId: string;
    idioma: string;
    cambio: CambioRecalculo;
    liquidacionRestante: string;
  }): Promise<void>;
}

/** Qué cambió en el recálculo (personas y/o duración), para el render del E9. */
export type CambioRecalculo = 'personas' | 'duracion' | 'personas_y_duracion';

// ---------------------------------------------------------------------------
// Comando / dependencias / resultado
// ---------------------------------------------------------------------------

/**
 * Comando del recálculo: tenant/usuario del JWT + reserva + desglose estructurado. Los
 * campos estructurados son OPCIONALES: si se omiten, el recálculo usa el desglose VIGENTE de
 * la RESERVA (útil cuando el disparo trae solo `precioManualEur` — recálculo manual sin
 * cambio de aforo/duración).
 */
export interface RecalcularReservaVivaComando {
  tenantId: string;
  usuarioId: string;
  reservaId: string;
  duracionHoras?: number;
  numAdultosNinosMayores4?: number;
  numNinosMenores4?: number;
  /** Precio total manual (IVA incluido) del caso `tarifaAConsultar`. */
  precioManualEur?: string | number;
}

/** Lectura de la RESERVA para el recálculo (RLS: cross-tenant → null). */
export interface CargarReservaRecalculoPort {
  (params: {
    tenantId: string;
    reservaId: string;
  }): Promise<ReservaRecalculo | null | undefined>;
}

/** Dependencias inyectadas (puertos, hexagonal). */
export interface RecalcularReservaVivaDeps {
  motorTarifa: MotorTarifaRecalculoPort;
  unidadDeTrabajo: UnidadDeTrabajoRecalculoPort;
  cargarReserva: CargarReservaRecalculoPort;
  dispararE9: DispararE9Port;
}

/** Resultado del recálculo (o no-op si no cambió el aforo/duración). */
export interface RecalcularReservaVivaResultado {
  recalculado: boolean;
  nuevoTotal: string | null;
  pagoInicial: string | null;
  liquidacionRestante: string | null;
  tarifaAConsultar: boolean;
  presupuesto: PresupuestoModificacionCreado | null;
}

// ---------------------------------------------------------------------------
// Helpers puros
// ---------------------------------------------------------------------------

const MAX_REINTENTOS_VERSION = 10;

/** Formatea un número/string EUR a Decimal string de 2 decimales. */
const aDecimal2 = (valor: number | string): string => Number(valor).toFixed(2);

/** Resta dos Decimal strings operando en céntimos (evita el ruido de float). */
const restarDecimal = (a: string, b: string): string =>
  ((Math.round(Number(a) * 100) - Math.round(Number(b) * 100)) / 100).toFixed(2);

/** ¿El valor de texto/precio está presente (no nulo/undefined/vacío)? */
const presente = (valor: string | number | null | undefined): boolean =>
  valor !== null && valor !== undefined && String(valor).trim() !== '';

/** ¿El error es una violación de unicidad `P2002` de Prisma? */
const esColisionVersion = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: string }).code === 'P2002';

/** Desglose estructurado EFECTIVO tras aplicar los overrides del comando sobre la RESERVA. */
interface DesgloseEfectivo {
  duracionHoras: number;
  numAdultosNinosMayores4: number;
  numNinosMenores4: number;
}

/** Resuelve el desglose efectivo: valor del comando si viene, si no el vigente de la RESERVA. */
const resolverDesgloseEfectivo = (
  reserva: ReservaRecalculo,
  comando: RecalcularReservaVivaComando,
): DesgloseEfectivo => ({
  duracionHoras: comando.duracionHoras ?? reserva.duracionHoras,
  numAdultosNinosMayores4:
    comando.numAdultosNinosMayores4 ?? reserva.numAdultosNinosMayores4,
  numNinosMenores4: comando.numNinosMenores4 ?? reserva.numNinosMenores4,
});

/** Clasifica qué cambió respecto al desglose vigente (para el render del E9). */
const clasificarCambio = (
  reserva: ReservaRecalculo,
  efectivo: DesgloseEfectivo,
): CambioRecalculo => {
  const cambiaDuracion = efectivo.duracionHoras !== reserva.duracionHoras;
  const cambiaPersonas =
    efectivo.numAdultosNinosMayores4 !== reserva.numAdultosNinosMayores4 ||
    efectivo.numNinosMenores4 !== reserva.numNinosMenores4;
  if (cambiaDuracion && cambiaPersonas) {
    return 'personas_y_duracion';
  }
  return cambiaDuracion ? 'duracion' : 'personas';
};

// ---------------------------------------------------------------------------
// Caso de uso
// ---------------------------------------------------------------------------

export class RecalcularReservaVivaUseCase {
  constructor(private readonly deps: RecalcularReservaVivaDeps) {}

  async ejecutar(
    comando: RecalcularReservaVivaComando,
  ): Promise<RecalcularReservaVivaResultado> {
    const { tenantId, reservaId } = comando;

    // (0) Guardas SÍNCRONAS previas SIN efectos.
    const reserva = await this.deps.cargarReserva({ tenantId, reservaId });
    if (reserva === null || reserva === undefined) {
      throw new ReservaRecalculoNoEncontradaError();
    }
    if (
      !esEditableEnVentanaViva(
        reserva.estado,
        reserva.preEventoStatus,
        reserva.liquidacionStatus,
      )
    ) {
      throw new FueraDeVentanaVivaError();
    }
    if (!presente(reserva.importeSenal)) {
      throw new ImporteSenalInvalidoError();
    }
    const importeSenal = aDecimal2(reserva.importeSenal as string);
    const efectivo = resolverDesgloseEfectivo(reserva, comando);

    // Sin cambio real (mismo aforo/duración que el vigente Y sin precio manual explícito)
    // → NO-OP (§D-7): no versiona, no re-congela, no abre tx, no reenvía email. Un
    // `precioManualEur` explícito SÍ fuerza el recálculo (override manual del total).
    if (this.sinCambioReal(reserva, efectivo) && !presente(comando.precioManualEur)) {
      return {
        recalculado: false,
        nuevoTotal: reserva.importeTotal,
        pagoInicial: null,
        liquidacionRestante: null,
        tarifaAConsultar: false,
        presupuesto: null,
      };
    }

    // (1) Nuevo total con el motor de tarifa (extras vigentes los resuelve el adaptador).
    const tarifa = await this.deps.motorTarifa.calcular(
      {
        fechaEvento: reserva.fechaEvento,
        duracionHoras: efectivo.duracionHoras,
        numAdultosNinosMayores4: efectivo.numAdultosNinosMayores4,
        extras: [],
      },
      tenantId,
    );

    if (tarifa.tarifaAConsultar && !presente(comando.precioManualEur)) {
      throw new PrecioManualRequeridoError();
    }
    // `precioManualEur` explícito OVERRIDE el total del motor (recálculo manual del gestor,
    // §D-7). En su ausencia y con tarifa resuelta, manda el total del motor.
    const nuevoTotal = presente(comando.precioManualEur)
      ? aDecimal2(comando.precioManualEur as string | number)
      : aDecimal2(tarifa.totalEur ?? 0);
    const liquidacionRestante = restarDecimal(nuevoTotal, importeSenal);
    const cambio = clasificarCambio(reserva, efectivo);

    // (2) UNA transacción (tx + RLS) con reintento acotado ante colisión de versión.
    const presupuesto = await this.ejecutarTransaccion(comando, efectivo, {
      importeSenal,
      nuevoTotal,
      liquidacionRestante,
    });

    // (3) POST-COMMIT: email E9 (best-effort, no revierte la tx).
    await this.deps.dispararE9({
      tenantId,
      reservaId,
      idioma: reserva.idioma,
      cambio,
      liquidacionRestante,
    });

    return {
      recalculado: true,
      nuevoTotal,
      pagoInicial: importeSenal,
      liquidacionRestante,
      tarifaAConsultar: tarifa.tarifaAConsultar,
      presupuesto,
    };
  }

  /** ¿El desglose efectivo coincide con el aforo/duración vigente de la RESERVA? */
  private sinCambioReal(
    reserva: ReservaRecalculo,
    efectivo: DesgloseEfectivo,
  ): boolean {
    return (
      efectivo.duracionHoras === reserva.duracionHoras &&
      efectivo.numAdultosNinosMayores4 === reserva.numAdultosNinosMayores4 &&
      efectivo.numNinosMenores4 === reserva.numNinosMenores4
    );
  }

  /**
   * Núcleo transaccional (§D-4.2): re-evalúa la guarda bajo la tx, versiona el
   * presupuesto de modificación, persiste el desglose, re-congela importes (señal
   * intacta), regenera la liquidación y audita. Reintenta ante `P2002` de versión.
   */
  private async ejecutarTransaccion(
    comando: RecalcularReservaVivaComando,
    efectivo: DesgloseEfectivo,
    importes: { importeSenal: string; nuevoTotal: string; liquidacionRestante: string },
  ): Promise<PresupuestoModificacionCreado> {
    const { tenantId, usuarioId, reservaId } = comando;

    const trabajo = async (
      repos: ReposRecalculo,
    ): Promise<PresupuestoModificacionCreado> => {
      // (a) RE-EVALUAR la guarda de ventana viva con la lectura FRESCA bajo la tx (§D-7).
      const fresca = await this.deps.cargarReserva({ tenantId, reservaId });
      if (fresca === null || fresca === undefined) {
        throw new ReservaRecalculoNoEncontradaError();
      }
      if (
        !esEditableEnVentanaViva(
          fresca.estado,
          fresca.preEventoStatus,
          fresca.liquidacionStatus,
        )
      ) {
        throw new FueraDeVentanaVivaError();
      }

      // (b) Nueva versión de PRESUPUESTO de modificación (version = MAX+1, inmutable).
      const maxVersion = await repos.presupuestos.versionMaxima({ tenantId, reservaId });
      const version = maxVersion + 1;
      const presupuesto = await repos.presupuestos.crearVersionModificacion({
        tenantId,
        reservaId,
        version,
        origen: 'modificacion',
        total: importes.nuevoTotal,
        pagoInicial: importes.importeSenal,
        liquidacionRestante: importes.liquidacionRestante,
      });

      // (c) Persistir el desglose estructurado EFECTIVO en la RESERVA.
      await repos.reservas.guardarDesglose({
        tenantId,
        reservaId,
        duracionHoras: efectivo.duracionHoras,
        numAdultosNinosMayores4: efectivo.numAdultosNinosMayores4,
        numNinosMenores4: efectivo.numNinosMenores4,
      });

      // (d) Re-congelar importes. `importe_senal` INTACTO (invariante DURA).
      await repos.reservas.recongelarImportes({
        tenantId,
        reservaId,
        importeTotal: importes.nuevoTotal,
        importeSenal: importes.importeSenal,
        importeLiquidacion: importes.liquidacionRestante,
      });

      // (e) Regenerar la FACTURA de liquidación (borrador|enviada, nunca cobrada).
      if (
        fresca.facturaLiquidacion !== null &&
        fresca.facturaLiquidacion.estado !== 'cobrada'
      ) {
        await repos.facturas.regenerarLiquidacion({
          tenantId,
          reservaId,
          idFactura: fresca.facturaLiquidacion.idFactura,
          total: importes.liquidacionRestante,
        });
      }

      // (f) AUDIT_LOG de cada mutación.
      await repos.auditoria.registrar({
        tenantId,
        usuarioId,
        entidad: 'RESERVA',
        entidadId: reservaId,
        accion: 'actualizar',
        datosNuevos: {
          importeTotal: importes.nuevoTotal,
          importeLiquidacion: importes.liquidacionRestante,
          duracionHoras: efectivo.duracionHoras,
          numAdultosNinosMayores4: efectivo.numAdultosNinosMayores4,
          numNinosMenores4: efectivo.numNinosMenores4,
        },
      });
      await repos.auditoria.registrar({
        tenantId,
        usuarioId,
        entidad: 'PRESUPUESTO',
        entidadId: presupuesto.idPresupuesto,
        accion: 'actualizar',
        datosNuevos: { version, origen: 'modificacion', total: importes.nuevoTotal },
      });
      if (
        fresca.facturaLiquidacion !== null &&
        fresca.facturaLiquidacion.estado !== 'cobrada'
      ) {
        await repos.auditoria.registrar({
          tenantId,
          usuarioId,
          entidad: 'FACTURA',
          entidadId: fresca.facturaLiquidacion.idFactura,
          accion: 'actualizar',
          datosNuevos: { total: importes.liquidacionRestante },
        });
      }

      return presupuesto;
    };

    for (let intento = 0; intento < MAX_REINTENTOS_VERSION; intento += 1) {
      try {
        return (await this.deps.unidadDeTrabajo.ejecutar(
          tenantId,
          trabajo,
        )) as PresupuestoModificacionCreado;
      } catch (error) {
        if (esColisionVersion(error)) {
          continue;
        }
        throw error;
      }
    }
    throw new Error(
      'No se pudo asignar una versión única de presupuesto de modificación tras varios reintentos',
    );
  }
}

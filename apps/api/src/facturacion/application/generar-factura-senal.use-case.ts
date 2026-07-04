/**
 * Caso de uso de APLICACIÓN: generar la FACTURA de señal en borrador (US-022 / UC-18) —
 * efecto POST-COMMIT del disparo de la confirmación de US-021.
 *
 * Orquesta (design.md §D-1/§D-2/§D-3/§D-4/§D-5/§D-9):
 *   0. Carga la RESERVA (RLS). Guarda de origen: solo se factura `reserva_confirmada`
 *      (→ ReservaNoConfirmadaError). Guarda de idempotencia: si ya existe FACTURA
 *      `tipo='senal'` para la reserva, NO duplica: la devuelve y audita el intento (§D-4).
 *   1. Desglose fiscal del TOTAL congelado (= RESERVA.importe_senal, §D-2).
 *   2. En UNA unidad de trabajo (tx + RLS): obtiene el ÚLTIMO número del tenant en el año,
 *      calcula el siguiente `F-YYYY-NNNN` y crea la FACTURA en `borrador` + AUDIT_LOG
 *      `accion='crear'`. Ante colisión de numeración concurrente (`P2002` del
 *      `UNIQUE(tenant_id, numero_factura)`) RE-CALCULA el número y REINTENTA (bucle
 *      acotado); nunca locks distribuidos (§D-8, CLAUDE.md §Regla crítica).
 *   3. POST-COMMIT (fuera de la tx): si los datos fiscales del CLIENTE están completos,
 *      genera el PDF con datos de emisor (TENANT) + receptor (CLIENTE) y guarda `pdf_url`
 *      (UPDATE idempotente). Si faltan datos fiscales → borrador inválido, NO genera PDF
 *      (§D-9, fallo de datos, no se reintenta solo). Si el servicio de PDF falla de forma
 *      transitoria → `pdfPendiente`, `pdf_url=null`; el fallo del PDF NO revierte la
 *      creación ya commiteada ni propaga error al llamante (§D-5/§D-9).
 *
 * Hexagonal (hook `no-infra-in-domain`): depende SOLO de puertos inyectados; no importa
 * Prisma ni `@nestjs/*`.
 */
import { calcularDesgloseFacturaSenal } from '../domain/calculo-factura';
import { siguienteNumeroFactura } from '../domain/numeracion-factura';
import type { EstadoFactura, TipoFactura } from '../domain/factura';

// ---------------------------------------------------------------------------
// Tipos de comando / proyecciones / puertos
// ---------------------------------------------------------------------------

/** Estados de RESERVA relevantes para la guarda de origen (subconjunto laxo). */
export type EstadoReservaFacturable =
  | 'reserva_confirmada'
  | 'pre_reserva'
  | 'consulta'
  | 'reserva_cancelada'
  | string;

/** Comando de generación de la factura de señal. */
export interface GenerarFacturaSenalComando {
  /** Tenant del disparo (del JWT / del use-case de confirmación, nunca del body). */
  tenantId: string;
  /** RESERVA de la que se genera la factura de señal. */
  reservaId: string;
}

/** Proyección de la RESERVA facturable (origen, cliente, importe congelado). */
export interface ReservaFacturable {
  idReserva: string;
  tenantId: string;
  clienteId: string;
  codigo: string;
  estado: EstadoReservaFacturable;
  /** Total de la señal congelado en US-021 (Decimal string de 2 decimales). */
  importeSenal: string;
}

/** Datos fiscales del CLIENTE (receptor de la factura). Campos nulos → borrador inválido. */
export interface ClienteFiscal {
  idCliente: string;
  nombre: string;
  apellidos: string | null;
  dniNif: string | null;
  direccion: string | null;
  codigoPostal: string | null;
  poblacion: string | null;
  provincia: string | null;
}

/** Datos fiscales del TENANT (emisor de la factura). */
export interface TenantFiscal {
  idTenant: string;
  nombre: string;
  nif: string | null;
  iban: string | null;
  direccion: string | null;
}

/** FACTURA de señal (proyección de lectura + escritura). */
export interface FacturaSenal {
  idFactura: string;
  tenantId: string;
  reservaId: string;
  numeroFactura: string | null;
  tipo: TipoFactura;
  estado: EstadoFactura;
  total: string;
  baseImponible: string;
  ivaPorcentaje: string;
  ivaImporte: string;
  pdfUrl: string | null;
  fechaEmision: Date | null;
}

/** Resultado del use-case: la factura + flags derivados + campos fiscales faltantes. */
export interface FacturaSenalResultado extends FacturaSenal {
  esBorradorInvalido: boolean;
  pdfPendiente: boolean;
  camposFiscalesFaltantes: ReadonlyArray<string>;
}

/** Parámetros de creación de la FACTURA en borrador (tx-bound). */
export interface CrearFacturaParams {
  tenantId: string;
  reservaId: string;
  numeroFactura: string;
  tipo: 'senal';
  estado: 'borrador';
  total: string;
  baseImponible: string;
  ivaPorcentaje: string;
  ivaImporte: string;
  concepto: string;
}

/** Registro de auditoría de facturación. */
export interface RegistroAuditoriaFacturacion {
  tenantId: string;
  entidad: 'FACTURA';
  entidadId: string;
  accion: 'crear' | 'actualizar' | 'rechazar';
  motivo?: string | null;
  datosAnteriores?: Record<string, unknown> | null;
  datosNuevos?: Record<string, unknown> | null;
}

/** Repositorio tx-bound de FACTURA. */
export interface FacturaRepositoryPort {
  buscarPorReservaYTipo(reservaId: string, tipo: 'senal'): Promise<FacturaSenal | null>;
  ultimoNumeroDelAnio(tenantId: string, anio: number): Promise<string | null>;
  crear(params: CrearFacturaParams): Promise<FacturaSenal>;
  guardarPdfUrl(idFactura: string, pdfUrl: string): Promise<void>;
}

/** Repositorio tx-bound de AUDIT_LOG. */
export interface AuditoriaFacturacionPort {
  registrar(registro: RegistroAuditoriaFacturacion): Promise<void>;
}

/** Conjunto de repositorios disponibles dentro de la unidad de trabajo. */
export interface RepositoriosFacturacion {
  facturas: FacturaRepositoryPort;
  auditoria: AuditoriaFacturacionPort;
}

/**
 * Unidad de trabajo transaccional (tx + RLS). Un fallo dentro del `trabajo` revierte todo
 * (all-or-nothing). El adaptador propaga `P2002` para que el bucle de reintento del
 * use-case recalcule la numeración.
 */
export interface UnidadDeTrabajoFacturacionPort {
  ejecutar(
    tenantId: string,
    trabajo: (repos: RepositoriosFacturacion) => Promise<unknown>,
  ): Promise<unknown>;
}

/** Lectura de la RESERVA facturable (fuera de la tx; RLS: cross-tenant → null). */
export interface CargarReservaFacturablePort {
  (params: {
    tenantId: string;
    reservaId: string;
  }): Promise<ReservaFacturable | null | undefined>;
}

/** Lectura de los datos fiscales del CLIENTE (receptor). */
export interface CargarClienteFiscalPort {
  (params: { tenantId: string; clienteId: string }): Promise<ClienteFiscal>;
}

/** Lectura de los datos fiscales del TENANT (emisor). */
export interface CargarTenantFiscalPort {
  (params: { tenantId: string }): Promise<TenantFiscal>;
}

/** Emisor (TENANT) tal como lo consume el generador de PDF. */
export interface EmisorPdf {
  nombre: string;
  nif?: string;
  iban?: string;
  direccion?: string;
}

/** Receptor (CLIENTE) tal como lo consume el generador de PDF. */
export interface ReceptorPdf {
  nombre: string;
  apellidos?: string | null;
  dniNif?: string | null;
  direccion?: string | null;
  codigoPostal?: string | null;
  poblacion?: string | null;
  provincia?: string | null;
}

/** Datos de entrada del generador de PDF (emisor + receptor + desglose). */
export interface GenerarPdfFacturaParams {
  idFactura: string;
  numeroFactura: string;
  concepto: string;
  emisor: EmisorPdf;
  receptor: ReceptorPdf;
  baseImponible: string;
  ivaPorcentaje: string;
  ivaImporte: string;
  total: string;
}

/** Puerto de generación del PDF de la factura; devuelve la `pdf_url`. */
export interface GenerarPdfFacturaPort {
  (params: GenerarPdfFacturaParams): Promise<string>;
}

/** Reloj inyectable para determinismo. */
export interface ClockPort {
  ahora(): Date;
}

/** Dependencias del caso de uso (puertos inyectados). */
export interface GenerarFacturaSenalDeps {
  unidadDeTrabajo: UnidadDeTrabajoFacturacionPort;
  cargarReserva: CargarReservaFacturablePort;
  cargarCliente: CargarClienteFiscalPort;
  cargarTenant: CargarTenantFiscalPort;
  generarPdf: GenerarPdfFacturaPort;
  clock: ClockPort;
}

// ---------------------------------------------------------------------------
// Errores de dominio tipados, en español
// ---------------------------------------------------------------------------

/** La RESERVA no está en `reserva_confirmada`: no procede facturar la señal. */
export class ReservaNoConfirmadaError extends Error {
  readonly codigo = 'RESERVA_NO_CONFIRMADA' as const;
  readonly reservaId: string;

  constructor(reservaId: string) {
    super('La reserva no está en estado reserva_confirmada');
    this.name = 'ReservaNoConfirmadaError';
    this.reservaId = reservaId;
  }
}

/** La RESERVA no existe para el tenant (RLS): cross-tenant es invisible. */
export class ReservaFacturableNoEncontradaError extends Error {
  readonly codigo = 'RESERVA_NO_ENCONTRADA' as const;
  readonly reservaId: string;

  constructor(reservaId: string) {
    super('La reserva no existe para el tenant');
    this.name = 'ReservaFacturableNoEncontradaError';
    this.reservaId = reservaId;
  }
}

// ---------------------------------------------------------------------------
// Constantes y helpers puros
// ---------------------------------------------------------------------------

/** Campos fiscales del CLIENTE obligatorios para emitir la factura (§D-9). */
export const CAMPOS_FISCALES_CLIENTE = [
  'dniNif',
  'direccion',
  'codigoPostal',
  'poblacion',
  'provincia',
] as const;

/**
 * Resultado del paso transaccional de creación: la factura (proyección + flags) y si
 * procede generar el PDF fuera de la tx (post-commit). No procede cuando la factura ya
 * existía (idempotencia) o cuando el borrador es inválido por datos fiscales faltantes.
 */
interface ResultadoCreacion {
  resultado: FacturaSenalResultado;
  debeGenerarPdf: boolean;
}

/** Máximo de reintentos ante colisión de numeración (`P2002`). */
const MAX_REINTENTOS_NUMERACION = 10;

/** ¿El error es una violación de unicidad (`P2002`) de la numeración concurrente? */
const esColisionUnicidad = (error: unknown): boolean =>
  typeof error === 'object' &&
  error !== null &&
  'code' in error &&
  (error as { code?: string }).code === 'P2002';

/** Adapta el TENANT al emisor del PDF (null → undefined). */
const aEmisorPdf = (tenant: TenantFiscal): EmisorPdf => ({
  nombre: tenant.nombre,
  nif: tenant.nif ?? undefined,
  iban: tenant.iban ?? undefined,
  direccion: tenant.direccion ?? undefined,
});

/** Enumera los campos fiscales del CLIENTE que faltan (nulos/vacíos). */
const camposFiscalesFaltantes = (cliente: ClienteFiscal): ReadonlyArray<string> =>
  CAMPOS_FISCALES_CLIENTE.filter((campo) => {
    const valor = cliente[campo];
    return valor === null || valor === undefined || valor === '';
  });

// ---------------------------------------------------------------------------
// Caso de uso
// ---------------------------------------------------------------------------

export class GenerarFacturaSenalUseCase {
  constructor(private readonly deps: GenerarFacturaSenalDeps) {}

  /**
   * Genera (o recupera, si ya existe) la factura de señal de la reserva y, post-commit,
   * genera su PDF cuando los datos fiscales del cliente están completos.
   */
  async ejecutar(
    comando: GenerarFacturaSenalComando,
  ): Promise<FacturaSenalResultado> {
    // (0) Carga la RESERVA + guarda de origen (fuera de la tx crítica).
    const reserva = await this.deps.cargarReserva({
      tenantId: comando.tenantId,
      reservaId: comando.reservaId,
    });
    if (reserva === null || reserva === undefined) {
      throw new ReservaFacturableNoEncontradaError(comando.reservaId);
    }
    if (reserva.estado !== 'reserva_confirmada') {
      throw new ReservaNoConfirmadaError(comando.reservaId);
    }

    // (1) Desglose fiscal del total congelado + datos fiscales del emisor/receptor
    //     (fuera de la tx; determinan si se genera el PDF).
    const desglose = calcularDesgloseFacturaSenal({ total: reserva.importeSenal });
    const concepto = `Señal reserva ${reserva.codigo}`;
    const cliente = await this.deps.cargarCliente({
      tenantId: comando.tenantId,
      clienteId: reserva.clienteId,
    });
    const faltantes = camposFiscalesFaltantes(cliente);

    // (2) UNA unidad de trabajo con reintento ante colisión de numeración (P2002): la
    //     idempotencia, la numeración + creación en borrador y el AUDIT_LOG `crear` viven
    //     en la misma tx. Ante `P2002` del `UNIQUE(tenant_id, numero_factura)` se re-abre
    //     la tx recalculando el número (§D-8); nunca locks distribuidos. El PDF NO se
    //     genera aquí para no sostener locks mientras se contacta al servicio de PDF.
    let ultimoError: unknown = null;
    let creacion: ResultadoCreacion | null = null;
    for (let intento = 0; intento < MAX_REINTENTOS_NUMERACION; intento += 1) {
      try {
        creacion = (await this.deps.unidadDeTrabajo.ejecutar(
          comando.tenantId,
          (repos) => this.crearOFacturaExistente(comando, reserva, repos, {
            desglose,
            concepto,
            cliente,
            faltantes,
          }),
        )) as ResultadoCreacion;
        break;
      } catch (error) {
        if (esColisionUnicidad(error)) {
          ultimoError = error;
          continue;
        }
        throw error;
      }
    }
    if (creacion === null) {
      throw ultimoError ?? new Error('No se pudo asignar un número de factura único');
    }

    // (3) POST-COMMIT (fuera de la tx): la factura ya está commiteada. Si no procede
    //     generar PDF (factura previa idempotente o borrador inválido por datos fiscales),
    //     se devuelve el resultado tal cual. En caso contrario se genera el PDF con datos
    //     de emisor (TENANT) + receptor (CLIENTE) y se guarda `pdf_url` en una tx breve
    //     e idempotente. Un fallo TRANSITORIO del PDF NO revierte la creación ni propaga
    //     error: la factura queda en borrador con `pdfPendiente` (§D-5/§D-9).
    if (!creacion.debeGenerarPdf) {
      return creacion.resultado;
    }
    return this.generarPdfPostCommit(comando, creacion.resultado, {
      concepto,
      cliente,
    });
  }

  // -------------------------------------------------------------------------
  // Pasos privados
  // -------------------------------------------------------------------------

  /**
   * Cuerpo transaccional: idempotencia (si ya existe, audita + devuelve la existente),
   * numeración + creación en borrador + AUDIT_LOG `crear`. NO genera el PDF (eso es
   * post-commit). Un `P2002` de la numeración PROPAGA para que el bucle externo reintente.
   * Devuelve la factura y si procede generar el PDF fuera de la tx.
   */
  private async crearOFacturaExistente(
    comando: GenerarFacturaSenalComando,
    reserva: ReservaFacturable,
    repos: RepositoriosFacturacion,
    ctx: {
      desglose: {
        total: string;
        baseImponible: string;
        ivaPorcentaje: string;
        ivaImporte: string;
      };
      concepto: string;
      cliente: ClienteFiscal;
      faltantes: ReadonlyArray<string>;
    },
  ): Promise<ResultadoCreacion> {
    // Idempotencia: si ya existe la factura de señal, audita el intento y la devuelve.
    const previa = await repos.facturas.buscarPorReservaYTipo(comando.reservaId, 'senal');
    if (previa !== null) {
      await repos.auditoria.registrar({
        tenantId: comando.tenantId,
        entidad: 'FACTURA',
        entidadId: previa.idFactura,
        accion: 'crear',
        motivo: 'Intento de duplicado de factura de señal (idempotencia)',
        datosNuevos: { reservaId: comando.reservaId, tipo: 'senal' },
      });
      return { resultado: this.conFlags(previa, ctx.cliente), debeGenerarPdf: false };
    }

    // Numeración + creación en borrador + AUDIT_LOG `crear`.
    const anio = this.deps.clock.ahora().getUTCFullYear();
    const ultimoNumero = await repos.facturas.ultimoNumeroDelAnio(comando.tenantId, anio);
    const numeroFactura = siguienteNumeroFactura({ anio, ultimoNumero });
    const factura = await repos.facturas.crear({
      tenantId: comando.tenantId,
      reservaId: comando.reservaId,
      numeroFactura,
      tipo: 'senal',
      estado: 'borrador',
      total: ctx.desglose.total,
      baseImponible: ctx.desglose.baseImponible,
      ivaPorcentaje: ctx.desglose.ivaPorcentaje,
      ivaImporte: ctx.desglose.ivaImporte,
      concepto: ctx.concepto,
    });
    await repos.auditoria.registrar({
      tenantId: comando.tenantId,
      entidad: 'FACTURA',
      entidadId: factura.idFactura,
      accion: 'crear',
      datosNuevos: {
        reservaId: comando.reservaId,
        tipo: 'senal',
        estado: 'borrador',
        numeroFactura,
      },
    });

    // Borrador inválido por datos fiscales: NO se genera el PDF (no se reintenta solo).
    if (ctx.faltantes.length > 0) {
      return {
        resultado: {
          ...factura,
          pdfUrl: null,
          esBorradorInvalido: true,
          pdfPendiente: false,
          camposFiscalesFaltantes: ctx.faltantes,
        },
        debeGenerarPdf: false,
      };
    }

    // Factura recién creada con datos fiscales completos: el PDF se genera POST-COMMIT.
    return {
      resultado: {
        ...factura,
        pdfUrl: null,
        esBorradorInvalido: false,
        pdfPendiente: false,
        camposFiscalesFaltantes: [],
      },
      debeGenerarPdf: true,
    };
  }

  /**
   * Genera el PDF (emisor TENANT + receptor CLIENTE) DESPUÉS de commitear la factura y
   * guarda `pdf_url` en una tx breve e idempotente. Un fallo TRANSITORIO del PDF NO
   * revierte la creación ya commiteada ni propaga error: la factura queda en borrador con
   * `pdfPendiente` (§D-5/§D-9).
   */
  private async generarPdfPostCommit(
    comando: GenerarFacturaSenalComando,
    factura: FacturaSenalResultado,
    ctx: { concepto: string; cliente: ClienteFiscal },
  ): Promise<FacturaSenalResultado> {
    const emisor = await this.deps.cargarTenant({ tenantId: comando.tenantId });
    try {
      const pdfUrl = await this.deps.generarPdf({
        idFactura: factura.idFactura,
        numeroFactura: factura.numeroFactura ?? '',
        concepto: ctx.concepto,
        emisor: aEmisorPdf(emisor),
        receptor: ctx.cliente,
        baseImponible: factura.baseImponible,
        ivaPorcentaje: factura.ivaPorcentaje,
        ivaImporte: factura.ivaImporte,
        total: factura.total,
      });
      await this.deps.unidadDeTrabajo.ejecutar(comando.tenantId, async (repos) => {
        await repos.facturas.guardarPdfUrl(factura.idFactura, pdfUrl);
      });
      return {
        ...factura,
        pdfUrl,
        esBorradorInvalido: false,
        pdfPendiente: false,
        camposFiscalesFaltantes: [],
      };
    } catch {
      return {
        ...factura,
        pdfUrl: null,
        esBorradorInvalido: false,
        pdfPendiente: true,
        camposFiscalesFaltantes: [],
      };
    }
  }

  /** Deriva los flags de una factura ya persistida (idempotencia). */
  private conFlags(
    factura: FacturaSenal,
    cliente: ClienteFiscal,
  ): FacturaSenalResultado {
    const faltantes = camposFiscalesFaltantes(cliente);
    const esBorradorInvalido = faltantes.length > 0 && factura.pdfUrl === null;
    return {
      ...factura,
      esBorradorInvalido,
      pdfPendiente: factura.pdfUrl === null && !esBorradorInvalido,
      camposFiscalesFaltantes: faltantes,
    };
  }
}

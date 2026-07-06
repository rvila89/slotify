/**
 * Caso de uso de APLICACIÓN: registrar el cobro de la factura de liquidación (US-029 / UC-21
 * pasos 7-10). Acción ÚNICA y ATÓMICA estado↔PAGO (design.md §D-2 opción A) que concilia el
 * cobro contra la factura ya emitida y avanza el sub-proceso de liquidación de la RESERVA.
 *
 * Orquesta, DENTRO de una única unidad de trabajo (`$transaction` + `SET LOCAL app.tenant_id`):
 *   1. RELEE la RESERVA con BLOQUEO DE FILA (`SELECT ... FOR UPDATE`, `reservas.releerConBloqueo`):
 *      es la fuente de verdad del estado y SERIALIZA dos cobros concurrentes (D-2). Cross-tenant
 *      / inexistente → `FacturaLiquidacionNoEncontradaError` (404).
 *   2. Evalúa la GUARDA de precondición/doble cobro (dominio puro `puedeRegistrarCobro`):
 *      `pendiente` → `LiquidacionNoFacturadaError` (409); `cobrada` → `LiquidacionYaCobradaError`
 *      (409, doble cobro). En ambos casos NO se crea PAGO ni se muta nada (rollback).
 *   3. Carga la FACTURA de liquidación (`facturas.buscarLiquidacionPorReserva`); ausente → 404.
 *   4. Valida el cobro (dominio puro `validarCobro`: `importe > 0`, `fecha_cobro <= hoy`).
 *   5. Si hay justificante, verifica el DOCUMENTO en el tenant (RLS); ausente →
 *      `JustificanteNoEncontradoError` (404).
 *   6. Crea el PAGO (con el importe REAL), transiciona `FACTURA.estado='cobrada'` +
 *      `RESERVA.liquidacion_status='cobrada'` y registra AUDIT_LOG (`crear` PAGO, `actualizar`
 *      FACTURA y RESERVA). La discrepancia de importe ALERTA pero NO bloquea (D-3).
 *
 * Hexagonal (hook `no-infra-in-domain`): depende SOLO de puertos inyectados; no importa Prisma
 * ni `@nestjs/*`. NO expone ningún puerto que transicione `RESERVA.estado` (US-031 fuera de
 * alcance): solo avanza el sub-proceso `liquidacion_status`.
 */
import { validarCobro } from '../domain/validar-cobro';
import { detectarDiscrepancia, type Discrepancia } from '../domain/detectar-discrepancia';
import {
  puedeRegistrarCobro,
  type LiquidacionStatusCobro,
} from '../domain/puede-registrar-cobro';

// ---------------------------------------------------------------------------
// Tipos de comando / proyecciones
// ---------------------------------------------------------------------------

/** Comando de la acción "Registrar el cobro de la liquidación". */
export interface RegistrarCobroLiquidacionComando {
  /** Tenant del JWT (nunca del path/body). */
  tenantId: string;
  /** Gestor que ejecuta la acción (auditoría). */
  usuarioId: string;
  /** RESERVA cuya liquidación se cobra. */
  reservaId: string;
  /** Importe realmente cobrado (Importe string de 2 decimales, `> 0`). */
  importe: string;
  /** Fecha del cobro (ISO date `YYYY-MM-DD`, `<= hoy`). */
  fechaCobro: string;
  /** DOCUMENTO justificante ya subido (tipo `justificante_pago`), OPCIONAL. */
  justificanteDocId?: string | null;
}

/** FACTURA de liquidación cobrable (estado de partida `enviada`). */
export interface FacturaCobrable {
  idFactura: string;
  tenantId: string;
  reservaId: string;
  numeroFactura: string | null;
  tipo: 'liquidacion' | 'senal' | 'fianza' | 'complementaria';
  estado: 'borrador' | 'enviada' | 'cobrada';
  total: string;
}

/** Proyección mínima de la RESERVA releída con bloqueo de fila (fuente de verdad del estado). */
export interface ReservaCobro {
  idReserva: string;
  tenantId: string;
  clienteId: string;
  codigo: string;
  estado: string;
  liquidacionStatus: LiquidacionStatusCobro;
}

/** Proyección del DOCUMENTO justificante (verificación de existencia + tenant). */
export interface DocumentoJustificante {
  idDocumento: string;
  tenantId: string;
  reservaId: string | null;
  tipo: 'justificante_pago' | string;
}

/** Proyección del PAGO creado. */
export interface PagoCobro {
  idPago: string;
  facturaId: string;
  importe: string;
  fechaCobro: Date;
  justificanteDocId: string | null;
}

// ---------------------------------------------------------------------------
// Puertos tx-bound (implementados por infraestructura dentro de la unidad de trabajo)
// ---------------------------------------------------------------------------

/** Repositorio tx-bound de FACTURA (lectura de la liquidación + transición a cobrada). */
export interface FacturasCobroPort {
  buscarLiquidacionPorReserva(reservaId: string): Promise<FacturaCobrable | null>;
  marcarCobrada(params: { idFactura: string; estado: 'cobrada' }): Promise<void>;
}

/** Repositorio tx-bound de la RESERVA (relectura con FOR UPDATE + avance de sub-proceso). */
export interface ReservasCobroPort {
  /** Relee la RESERVA con `SELECT ... FOR UPDATE` (serialización del doble cobro, D-2). */
  releerConBloqueo(params: { reservaId: string }): Promise<ReservaCobro | null>;
  avanzarLiquidacionStatus(params: {
    reservaId: string;
    estado: 'cobrada';
  }): Promise<void>;
}

/** Repositorio tx-bound de DOCUMENTO (verificación del justificante en el tenant). */
export interface DocumentosCobroPort {
  /**
   * Busca un DOCUMENTO que sea REALMENTE un justificante de pago DE ESTA reserva: acota por
   * `tipo = 'justificante_pago'` y `reservaId` además del tenant (RLS). Un DOCUMENTO del tenant
   * de otro tipo o de otra reserva se trata como NO ENCONTRADO (`null` → 404).
   */
  buscarJustificante(params: {
    idDocumento: string;
    tenantId: string;
    reservaId: string;
  }): Promise<DocumentoJustificante | null>;
}

/** Repositorio tx-bound de PAGO (creación del registro de conciliación). */
export interface PagosCobroPort {
  crear(params: {
    tenantId: string;
    facturaId: string;
    importe: string;
    fechaCobro: Date;
    justificanteDocId: string | null;
  }): Promise<PagoCobro>;
}

/** Registro de auditoría del cobro. */
export interface RegistroAuditoriaCobro {
  tenantId: string;
  usuarioId?: string | null;
  entidad: 'PAGO' | 'FACTURA' | 'RESERVA';
  entidadId: string;
  accion: 'crear' | 'actualizar';
  datosAnteriores?: Record<string, unknown> | null;
  datosNuevos?: Record<string, unknown> | null;
}

/** Repositorio tx-bound de AUDIT_LOG. */
export interface AuditoriaCobroPort {
  registrar(registro: RegistroAuditoriaCobro): Promise<void>;
}

/** Conjunto de repositorios disponibles dentro de la unidad de trabajo del cobro. */
export interface RepositoriosCobro {
  facturas: FacturasCobroPort;
  reservas: ReservasCobroPort;
  documentos: DocumentosCobroPort;
  pagos: PagosCobroPort;
  auditoria: AuditoriaCobroPort;
}

/**
 * Unidad de trabajo transaccional (tx + RLS). El `trabajo` corre bajo `SET LOCAL app.tenant_id`
 * y la relectura `FOR UPDATE`; si lanza, la tx REVIERTE por completo (atomicidad estado↔PAGO).
 */
export interface UnidadDeTrabajoCobroPort {
  ejecutar(
    tenantId: string,
    trabajo: (repos: RepositoriosCobro) => Promise<unknown>,
  ): Promise<unknown>;
}

/** Reloj inyectable para determinismo (validación de `fecha_cobro`). */
export interface ClockPort {
  ahora(): Date;
}

/** Dependencias del caso de uso (puertos inyectados). */
export interface RegistrarCobroLiquidacionDeps {
  unidadDeTrabajo: UnidadDeTrabajoCobroPort;
  clock: ClockPort;
}

/** Resultado del registro del cobro: PAGO creado + FACTURA/status + alerta opcional. */
export interface RegistrarCobroLiquidacionResultado {
  pago: PagoCobro;
  liquidacion: FacturaCobrable;
  liquidacionStatus: 'cobrada';
  alertaDiscrepancia?: Discrepancia | null;
}

// ---------------------------------------------------------------------------
// Errores de dominio tipados, en español (mapeados a HTTP en el controlador)
// ---------------------------------------------------------------------------

/** La liquidación (o la reserva) no existe para el tenant (RLS) → HTTP 404. */
export class FacturaLiquidacionNoEncontradaError extends Error {
  readonly codigo = 'FACTURA_LIQUIDACION_NO_ENCONTRADA' as const;
  readonly reservaId: string;

  constructor(reservaId: string) {
    super('No hay factura de liquidación para la reserva');
    this.name = 'FacturaLiquidacionNoEncontradaError';
    this.reservaId = reservaId;
  }
}

/** La liquidación aún no fue enviada (`liquidacion_status = 'pendiente'`) → HTTP 409. */
export class LiquidacionNoFacturadaError extends Error {
  readonly codigo = 'LIQUIDACION_NO_FACTURADA' as const;
  readonly motivo: string;

  constructor(motivo: string) {
    super(motivo);
    this.name = 'LiquidacionNoFacturadaError';
    this.motivo = motivo;
  }
}

/** La liquidación ya fue cobrada (`liquidacion_status = 'cobrada'`, doble cobro) → HTTP 409. */
export class LiquidacionYaCobradaError extends Error {
  readonly codigo = 'LIQUIDACION_YA_COBRADA' as const;
  readonly motivo: string;

  constructor(motivo: string) {
    super(motivo);
    this.name = 'LiquidacionYaCobradaError';
    this.motivo = motivo;
  }
}

/** El justificante referenciado no existe en el tenant (RLS) → HTTP 404. */
export class JustificanteNoEncontradoError extends Error {
  readonly codigo = 'JUSTIFICANTE_NO_ENCONTRADO' as const;
  readonly idDocumento: string;

  constructor(idDocumento: string) {
    super('El justificante de pago referenciado no existe');
    this.name = 'JustificanteNoEncontradoError';
    this.idDocumento = idDocumento;
  }
}

// Re-exporta el error de validación de dominio para el mapeo HTTP del controlador (400).
export { CobroInvalidoError } from '../domain/validar-cobro';

// ---------------------------------------------------------------------------
// Caso de uso
// ---------------------------------------------------------------------------

export class RegistrarCobroLiquidacionUseCase {
  constructor(private readonly deps: RegistrarCobroLiquidacionDeps) {}

  async ejecutar(
    comando: RegistrarCobroLiquidacionComando,
  ): Promise<RegistrarCobroLiquidacionResultado> {
    return (await this.deps.unidadDeTrabajo.ejecutar(comando.tenantId, (repos) =>
      this.registrar(comando, repos),
    )) as RegistrarCobroLiquidacionResultado;
  }

  private async registrar(
    comando: RegistrarCobroLiquidacionComando,
    repos: RepositoriosCobro,
  ): Promise<RegistrarCobroLiquidacionResultado> {
    // (1) Relectura de la RESERVA con BLOQUEO DE FILA (FOR UPDATE): fuente de verdad del estado
    //     y serialización del doble cobro concurrente (D-2). Inexistente/cross-tenant → 404.
    const reserva = await repos.reservas.releerConBloqueo({ reservaId: comando.reservaId });
    if (reserva === null || reserva === undefined) {
      throw new FacturaLiquidacionNoEncontradaError(comando.reservaId);
    }

    // (2) Guarda de precondición / doble cobro (dominio puro), reevaluada bajo el lock.
    const guarda = puedeRegistrarCobro(reserva.liquidacionStatus);
    if (!guarda.permitido) {
      if (guarda.codigo === 'LIQUIDACION_YA_COBRADA') {
        throw new LiquidacionYaCobradaError(guarda.motivo);
      }
      throw new LiquidacionNoFacturadaError(guarda.motivo);
    }

    // (3) Carga de la FACTURA de liquidación (RLS). Ausente → 404.
    const liquidacion = await repos.facturas.buscarLiquidacionPorReserva(comando.reservaId);
    if (liquidacion === null || liquidacion === undefined) {
      throw new FacturaLiquidacionNoEncontradaError(comando.reservaId);
    }

    // (4) Validación de dominio puro: importe > 0 y fecha_cobro <= hoy.
    const fechaCobro = new Date(comando.fechaCobro);
    validarCobro({ importe: comando.importe, fechaCobro, hoy: this.deps.clock.ahora() });

    // (5) Justificante OPCIONAL: si se adjunta, verifica que existe en el tenant (RLS), que es
    //     de tipo `justificante_pago` y que pertenece a ESTA reserva; en otro caso → 404.
    const justificanteDocId = comando.justificanteDocId ?? null;
    if (justificanteDocId !== null) {
      const documento = await repos.documentos.buscarJustificante({
        idDocumento: justificanteDocId,
        tenantId: comando.tenantId,
        reservaId: comando.reservaId,
      });
      if (documento === null || documento === undefined) {
        throw new JustificanteNoEncontradoError(justificanteDocId);
      }
    }

    // Discrepancia informativa (D-3): alerta, NO bloquea.
    const alertaDiscrepancia = detectarDiscrepancia({
      importeCobrado: comando.importe,
      totalFactura: liquidacion.total,
    });

    // (6) Creación del PAGO con el importe REAL introducido.
    const pago = await repos.pagos.crear({
      tenantId: comando.tenantId,
      facturaId: liquidacion.idFactura,
      importe: comando.importe,
      fechaCobro,
      justificanteDocId,
    });
    await repos.auditoria.registrar({
      tenantId: comando.tenantId,
      usuarioId: comando.usuarioId,
      entidad: 'PAGO',
      entidadId: pago.idPago,
      accion: 'crear',
      datosNuevos: {
        facturaId: liquidacion.idFactura,
        importe: comando.importe,
        fechaCobro: comando.fechaCobro,
        justificanteDocId,
        ...(alertaDiscrepancia
          ? {
              discrepancia: {
                importeFacturado: alertaDiscrepancia.importeFacturado,
                importeCobrado: alertaDiscrepancia.importeCobrado,
                diferencia: alertaDiscrepancia.diferencia,
              },
            }
          : {}),
      },
    });

    // Transición FACTURA(liquidacion).estado='cobrada'.
    await repos.facturas.marcarCobrada({ idFactura: liquidacion.idFactura, estado: 'cobrada' });
    await repos.auditoria.registrar({
      tenantId: comando.tenantId,
      usuarioId: comando.usuarioId,
      entidad: 'FACTURA',
      entidadId: liquidacion.idFactura,
      accion: 'actualizar',
      datosAnteriores: { estado: liquidacion.estado },
      datosNuevos: { estado: 'cobrada' },
    });

    // Avance del sub-proceso RESERVA.liquidacion_status='cobrada' (NUNCA RESERVA.estado).
    await repos.reservas.avanzarLiquidacionStatus({
      reservaId: comando.reservaId,
      estado: 'cobrada',
    });
    await repos.auditoria.registrar({
      tenantId: comando.tenantId,
      usuarioId: comando.usuarioId,
      entidad: 'RESERVA',
      entidadId: comando.reservaId,
      accion: 'actualizar',
      datosAnteriores: { liquidacionStatus: reserva.liquidacionStatus },
      datosNuevos: { liquidacionStatus: 'cobrada' },
    });

    return {
      pago,
      liquidacion: { ...liquidacion, estado: 'cobrada' },
      liquidacionStatus: 'cobrada',
      alertaDiscrepancia,
    };
  }
}

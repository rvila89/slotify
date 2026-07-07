/**
 * Caso de uso de APLICACIÓN: registrar el cobro de la FIANZA (US-030 / UC-22 pasos 5-9). Acción
 * ÚNICA y ATÓMICA estado↔PAGO (design.md §D-1, patrón US-029 opción A) que concilia el cobro
 * contra la factura de fianza y avanza el sub-proceso de fianza de la RESERVA.
 *
 * Orquesta, DENTRO de una única unidad de trabajo (`$transaction` + `SET LOCAL app.tenant_id`):
 *   1. RELEE la RESERVA con BLOQUEO DE FILA (`SELECT ... FOR UPDATE`, `reservas.releerConBloqueo`):
 *      es la fuente de verdad del estado y SERIALIZA dos cobros concurrentes (D-1). Cross-tenant /
 *      inexistente → `FacturaFianzaNoEncontradaError` (404).
 *   2. Evalúa la GUARDA de precondición/doble cobro/Negociable (dominio puro
 *      `puedeRegistrarCobroFianza`) reevaluada bajo el lock:
 *        - `cobrada` → `FianzaYaCobradaError` (409, doble cobro). NO crea PAGO ni muta nada.
 *        - `pendiente` sin `confirmarSinRecibo` → devuelve `confirmacion_requerida` (política
 *          "Negociable", D-2): NO crea PAGO ni FACTURA ni cambia estado (rollback lógico).
 *        - `recibo_enviado` (o `pendiente` confirmado) → procede.
 *   3. Valida el cobro (dominio puro `validarCobroFianza`: `importe > 0`, `fecha_cobro <=
 *      fecha_evento` leída de la RESERVA).
 *   4. Si hay justificante, verifica el DOCUMENTO en el tenant (RLS, acotado por tipo+reserva);
 *      ausente → `JustificanteNoEncontradoError` (404).
 *   5. Resuelve la FACTURA(fianza) (D-2b): si existe (`enviada`/`borrador`), la marca `cobrada`
 *      (borrador → cobrada documenta el SALTO en AUDIT_LOG); si NO existe, la crea al vuelo ya
 *      `cobrada` (traza de creación en AUDIT_LOG).
 *   6. Crea el PAGO, transiciona `RESERVA.fianza_status='cobrada'` + `fianza_eur` +
 *      `fianza_cobrada_fecha` y registra AUDIT_LOG (`crear` PAGO/FACTURA, `actualizar` FACTURA y
 *      RESERVA; la traza del flujo excepcional "Negociable" cuando se cobra sobre `pendiente`).
 *
 * Hexagonal (hook `no-infra-in-domain`): depende SOLO de puertos inyectados; no importa Prisma ni
 * `@nestjs/*`. NO expone ningún puerto que transicione `RESERVA.estado` (US-031 fuera de alcance):
 * solo avanza el sub-proceso `fianza_status`.
 */
import { validarCobroFianza } from '../domain/validar-cobro-fianza';
import {
  puedeRegistrarCobroFianza,
  type FianzaStatusCobro,
} from '../domain/puede-registrar-cobro-fianza';

// ---------------------------------------------------------------------------
// Tipos de comando / proyecciones
// ---------------------------------------------------------------------------

/** Comando de la acción "Registrar el cobro de la fianza". */
export interface RegistrarCobroFianzaComando {
  /** Tenant del JWT (nunca del path/body). */
  tenantId: string;
  /** Gestor que ejecuta la acción (auditoría). */
  usuarioId: string;
  /** RESERVA cuya fianza se cobra. */
  reservaId: string;
  /** Importe realmente cobrado (Importe string de 2 decimales, `> 0`). */
  importe: string;
  /** Fecha del cobro (ISO date `YYYY-MM-DD`, `<= fecha_evento`). */
  fechaCobro: string;
  /** DOCUMENTO justificante ya subido (tipo `justificante_pago`), OPCIONAL. */
  justificanteDocId?: string | null;
  /** Política "Negociable" (D-2): confirmación explícita del cobro sobre fianza `pendiente`. */
  confirmarSinRecibo?: boolean;
}

/** FACTURA de fianza cobrable (estado de partida `enviada` o `borrador`). */
export interface FacturaFianzaCobrable {
  idFactura: string;
  tenantId: string;
  reservaId: string;
  numeroFactura: string | null;
  tipo: 'liquidacion' | 'senal' | 'fianza' | 'complementaria';
  estado: 'borrador' | 'enviada' | 'cobrada';
  total: string;
}

/** Proyección mínima de la RESERVA releída con bloqueo de fila (fuente de verdad del estado). */
export interface ReservaCobroFianza {
  idReserva: string;
  tenantId: string;
  clienteId: string;
  codigo: string;
  estado: string;
  fianzaStatus: FianzaStatusCobro;
  fechaEvento: Date;
}

/** Proyección del DOCUMENTO justificante (verificación de existencia + tenant). */
export interface DocumentoJustificante {
  idDocumento: string;
  tenantId: string;
  reservaId: string | null;
  tipo: 'justificante_pago' | string;
}

/** Proyección del PAGO creado. */
export interface PagoCobroFianza {
  idPago: string;
  facturaId: string;
  importe: string;
  fechaCobro: Date;
  justificanteDocId: string | null;
}

// ---------------------------------------------------------------------------
// Puertos tx-bound (implementados por infraestructura dentro de la unidad de trabajo)
// ---------------------------------------------------------------------------

/** Repositorio tx-bound de FACTURA (lectura/creación de la fianza + transición a cobrada). */
export interface FacturasCobroFianzaPort {
  buscarFianzaPorReserva(reservaId: string): Promise<FacturaFianzaCobrable | null>;
  /** Crea al vuelo una FACTURA(fianza) ya `cobrada` (D-2b, sin FACTURA previa). */
  crearFacturaFianza(params: {
    tenantId: string;
    reservaId: string;
    tipo: 'fianza';
    estado: 'cobrada';
    total: string;
  }): Promise<FacturaFianzaCobrable>;
  marcarCobrada(params: { idFactura: string; estado: 'cobrada' }): Promise<void>;
}

/** Repositorio tx-bound de la RESERVA (relectura con FOR UPDATE + avance de sub-proceso). */
export interface ReservasCobroFianzaPort {
  /** Relee la RESERVA con `SELECT ... FOR UPDATE` (serialización del doble cobro, D-1). */
  releerConBloqueo(params: { reservaId: string }): Promise<ReservaCobroFianza | null>;
  avanzarFianzaStatus(params: {
    reservaId: string;
    estado: 'cobrada';
    fianzaEur: string;
    fianzaCobradaFecha: Date;
  }): Promise<void>;
}

/** Repositorio tx-bound de DOCUMENTO (verificación del justificante en el tenant). */
export interface DocumentosCobroFianzaPort {
  /**
   * Busca un DOCUMENTO que sea REALMENTE un justificante de pago DE ESTA reserva: acota por
   * `tipo = 'justificante_pago'` y `reservaId` además del tenant (RLS). Un DOCUMENTO del tenant de
   * otro tipo o de otra reserva se trata como NO ENCONTRADO (`null` → 404).
   */
  buscarJustificante(params: {
    idDocumento: string;
    tenantId: string;
    reservaId: string;
  }): Promise<DocumentoJustificante | null>;
}

/** Repositorio tx-bound de PAGO (creación del registro de conciliación). */
export interface PagosCobroFianzaPort {
  crear(params: {
    tenantId: string;
    facturaId: string;
    importe: string;
    fechaCobro: Date;
    justificanteDocId: string | null;
  }): Promise<PagoCobroFianza>;
}

/** Registro de auditoría del cobro de la fianza. */
export interface RegistroAuditoriaCobroFianza {
  tenantId: string;
  usuarioId?: string | null;
  entidad: 'PAGO' | 'FACTURA' | 'RESERVA';
  entidadId: string;
  accion: 'crear' | 'actualizar';
  datosAnteriores?: Record<string, unknown> | null;
  datosNuevos?: Record<string, unknown> | null;
}

/** Repositorio tx-bound de AUDIT_LOG. */
export interface AuditoriaCobroFianzaPort {
  registrar(registro: RegistroAuditoriaCobroFianza): Promise<void>;
}

/** Conjunto de repositorios disponibles dentro de la unidad de trabajo del cobro. */
export interface RepositoriosCobroFianza {
  facturas: FacturasCobroFianzaPort;
  reservas: ReservasCobroFianzaPort;
  documentos: DocumentosCobroFianzaPort;
  pagos: PagosCobroFianzaPort;
  auditoria: AuditoriaCobroFianzaPort;
}

/**
 * Unidad de trabajo transaccional (tx + RLS). El `trabajo` corre bajo `SET LOCAL app.tenant_id` y
 * la relectura `FOR UPDATE`; si lanza, la tx REVIERTE por completo (atomicidad estado↔PAGO).
 */
export interface UnidadDeTrabajoCobroFianzaPort {
  ejecutar(
    tenantId: string,
    trabajo: (repos: RepositoriosCobroFianza) => Promise<unknown>,
  ): Promise<unknown>;
}

/** Dependencias del caso de uso (puertos inyectados). */
export interface RegistrarCobroFianzaDeps {
  unidadDeTrabajo: UnidadDeTrabajoCobroFianzaPort;
}

/** Resultado "cobro registrado": PAGO creado + FACTURA/status + campos de fianza de la RESERVA. */
export interface RegistrarCobroFianzaCobrado {
  resultado: 'cobrado';
  pago: PagoCobroFianza;
  facturaFianza: FacturaFianzaCobrable;
  fianzaStatus: 'cobrada';
  fianzaEur: string;
  fianzaCobradaFecha: string;
}

/** Resultado "confirmación requerida" (política "Negociable", D-2): NO se crea PAGO. */
export interface RegistrarCobroFianzaConfirmacionRequerida {
  resultado: 'confirmacion_requerida';
  codigo: 'RECIBO_FIANZA_NO_ENVIADO';
  mensaje: string;
}

/** Resultado discriminado por `resultado` del registro del cobro de la fianza. */
export type RegistrarCobroFianzaResultado =
  | RegistrarCobroFianzaCobrado
  | RegistrarCobroFianzaConfirmacionRequerida;

// ---------------------------------------------------------------------------
// Errores de dominio tipados, en español (mapeados a HTTP en el controlador)
// ---------------------------------------------------------------------------

/** La fianza (o la reserva) no existe para el tenant (RLS) → HTTP 404. */
export class FacturaFianzaNoEncontradaError extends Error {
  readonly codigo = 'FACTURA_FIANZA_NO_ENCONTRADA' as const;
  readonly reservaId: string;

  constructor(reservaId: string) {
    super('No hay reserva para el cobro de la fianza');
    this.name = 'FacturaFianzaNoEncontradaError';
    this.reservaId = reservaId;
  }
}

/** La fianza ya fue cobrada (`fianza_status = 'cobrada'`, doble cobro) → HTTP 409. */
export class FianzaYaCobradaError extends Error {
  readonly codigo = 'FIANZA_YA_COBRADA' as const;
  readonly motivo: string;

  constructor(motivo: string) {
    super(motivo);
    this.name = 'FianzaYaCobradaError';
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
export { CobroInvalidoError } from '../domain/validar-cobro-fianza';

// ---------------------------------------------------------------------------
// Caso de uso
// ---------------------------------------------------------------------------

export class RegistrarCobroFianzaUseCase {
  constructor(private readonly deps: RegistrarCobroFianzaDeps) {}

  async ejecutar(
    comando: RegistrarCobroFianzaComando,
  ): Promise<RegistrarCobroFianzaResultado> {
    return (await this.deps.unidadDeTrabajo.ejecutar(comando.tenantId, (repos) =>
      this.registrar(comando, repos),
    )) as RegistrarCobroFianzaResultado;
  }

  private async registrar(
    comando: RegistrarCobroFianzaComando,
    repos: RepositoriosCobroFianza,
  ): Promise<RegistrarCobroFianzaResultado> {
    const confirmarSinRecibo = comando.confirmarSinRecibo ?? false;

    // (1) Relectura de la RESERVA con BLOQUEO DE FILA (FOR UPDATE): fuente de verdad del estado y
    //     serialización del doble cobro concurrente (D-1). Inexistente/cross-tenant → 404.
    const reserva = await repos.reservas.releerConBloqueo({ reservaId: comando.reservaId });
    if (reserva === null || reserva === undefined) {
      throw new FacturaFianzaNoEncontradaError(comando.reservaId);
    }

    // (2) Guarda de precondición / doble cobro / política "Negociable" (dominio puro), reevaluada
    //     bajo el lock. `cobrada` bloquea (doble cobro); `pendiente` sin confirmar pide confirmación.
    const guarda = puedeRegistrarCobroFianza({
      fianzaStatus: reserva.fianzaStatus,
      confirmarSinRecibo,
    });
    if (!guarda.permitido) {
      if (guarda.codigo === 'FIANZA_YA_COBRADA') {
        throw new FianzaYaCobradaError(guarda.motivo);
      }
      // Política "Negociable": aviso NO bloqueante; NO se crea PAGO ni se muta nada.
      return {
        resultado: 'confirmacion_requerida',
        codigo: 'RECIBO_FIANZA_NO_ENVIADO',
        mensaje: guarda.motivo,
      };
    }

    // (3) Validación de dominio puro: importe > 0 y fecha_cobro <= fecha_evento (de la RESERVA).
    const fechaCobro = new Date(comando.fechaCobro);
    validarCobroFianza({
      importe: comando.importe,
      fechaCobro,
      fechaEvento: reserva.fechaEvento,
    });

    // (4) Justificante OPCIONAL: si se adjunta, verifica que existe en el tenant (RLS), que es de
    //     tipo `justificante_pago` y que pertenece a ESTA reserva; en otro caso → 404.
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

    // El cobro sobre `pendiente` es el flujo excepcional "Negociable": se traza (D-2).
    const cobroSobrePendiente = reserva.fianzaStatus === 'pendiente';

    // (5) Resolución de la FACTURA(fianza) (D-2b).
    const facturaCobrada = await this.resolverFacturaFianza(comando, repos);

    // (6) Creación del PAGO con el importe REAL introducido.
    const pago = await repos.pagos.crear({
      tenantId: comando.tenantId,
      facturaId: facturaCobrada.idFactura,
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
        facturaId: facturaCobrada.idFactura,
        importe: comando.importe,
        fechaCobro: comando.fechaCobro,
        justificanteDocId,
        ...(cobroSobrePendiente
          ? { flujoExcepcional: 'cobro sobre fianza con recibo no enviado (Negociable)' }
          : {}),
      },
    });

    // Avance del sub-proceso RESERVA.fianza_status='cobrada' + fianza_eur/fianza_cobrada_fecha
    // (NUNCA RESERVA.estado; US-031 fuera de alcance).
    await repos.reservas.avanzarFianzaStatus({
      reservaId: comando.reservaId,
      estado: 'cobrada',
      fianzaEur: comando.importe,
      fianzaCobradaFecha: fechaCobro,
    });
    await repos.auditoria.registrar({
      tenantId: comando.tenantId,
      usuarioId: comando.usuarioId,
      entidad: 'RESERVA',
      entidadId: comando.reservaId,
      accion: 'actualizar',
      datosAnteriores: { fianzaStatus: reserva.fianzaStatus },
      datosNuevos: {
        fianzaStatus: 'cobrada',
        fianzaEur: comando.importe,
        fianzaCobradaFecha: comando.fechaCobro,
      },
    });

    return {
      resultado: 'cobrado',
      pago,
      facturaFianza: { ...facturaCobrada, estado: 'cobrada' },
      fianzaStatus: 'cobrada',
      fianzaEur: comando.importe,
      fianzaCobradaFecha: comando.fechaCobro,
    };
  }

  /**
   * Resuelve la FACTURA(fianza) que respalda el cobro (D-2b):
   *   - Existe (`enviada` o `borrador`): la marca `cobrada`. Un `borrador → cobrada` documenta el
   *     SALTO de estado en AUDIT_LOG (no pasa por `enviada`).
   *   - No existe (fianza omitida por `fianza_default_eur = 0`): la crea al vuelo ya `cobrada`, con
   *     la traza de creación en AUDIT_LOG.
   * En ambos casos devuelve la FACTURA respaldo con `idFactura` para conciliar el PAGO.
   */
  private async resolverFacturaFianza(
    comando: RegistrarCobroFianzaComando,
    repos: RepositoriosCobroFianza,
  ): Promise<FacturaFianzaCobrable> {
    const facturaExistente = await repos.facturas.buscarFianzaPorReserva(comando.reservaId);

    if (facturaExistente === null || facturaExistente === undefined) {
      // Sin FACTURA(fianza): se crea al vuelo, directamente `cobrada`.
      const creada = await repos.facturas.crearFacturaFianza({
        tenantId: comando.tenantId,
        reservaId: comando.reservaId,
        tipo: 'fianza',
        estado: 'cobrada',
        total: comando.importe,
      });
      await repos.auditoria.registrar({
        tenantId: comando.tenantId,
        usuarioId: comando.usuarioId,
        entidad: 'FACTURA',
        entidadId: creada.idFactura,
        accion: 'crear',
        datosNuevos: {
          tipo: 'fianza',
          estado: 'cobrada',
          motivo: 'FACTURA(fianza) creada al vuelo para el cobro (recibo no enviado)',
        },
      });
      return creada;
    }

    // FACTURA(fianza) existente: se marca `cobrada` (borrador → cobrada salta `enviada`).
    await repos.facturas.marcarCobrada({ idFactura: facturaExistente.idFactura, estado: 'cobrada' });
    await repos.auditoria.registrar({
      tenantId: comando.tenantId,
      usuarioId: comando.usuarioId,
      entidad: 'FACTURA',
      entidadId: facturaExistente.idFactura,
      accion: 'actualizar',
      datosAnteriores: { estado: facturaExistente.estado },
      datosNuevos: {
        estado: 'cobrada',
        ...(facturaExistente.estado === 'borrador'
          ? { salto: 'borrador -> cobrada (recibo no enviado, Negociable)' }
          : {}),
      },
    });
    return facturaExistente;
  }
}

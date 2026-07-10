/**
 * Caso de uso de APLICACIÓN: registrar la DEVOLUCIÓN de la FIANZA (US-036 / UC-27 pasos 4-8). Cierra
 * el sub-proceso de fianza dejándola en un ESTADO FINAL (`devuelta` o `retenida_parcial`) con
 * importe, fecha y (opcional) justificante. Paso SIMÉTRICO INVERSO del cobro de US-030
 * (`registrar-cobro-fianza.use-case.ts`), calcado en estructura, ubicación y estilo.
 *
 * Orquesta, DENTRO de una única unidad de trabajo (`$transaction` + `SET LOCAL app.tenant_id`):
 *   1. RELEE la RESERVA con BLOQUEO DE FILA (`SELECT ... FOR UPDATE`, `reservas.releerConBloqueo`):
 *      fuente de verdad del estado y SERIALIZA dos devoluciones concurrentes (design.md §D-1/§D-4).
 *      Inexistente/cross-tenant → `ReservaDevolucionNoEncontradaError` (404).
 *   2. Evalúa la GUARDA de precondición triple / doble registro (dominio puro
 *      `puedeRegistrarDevolucion`) reevaluada bajo el lock:
 *        - `devuelta`/`retenida_parcial` → `DevolucionYaRegistradaError` (409, doble registro).
 *        - `estado != post_evento` / `fianzaStatus != cobrada` / `iban_devolucion == null` →
 *          `PrecondicionNoCumplidaError` (409).
 *   3. Valida importe/fecha/motivo (dominio puro `validarDevolucionFianza`: `0 ≤ importe ≤
 *      fianzaEur`, `fecha_cobro ≥ fianza_cobrada_fecha`, motivo requerido si parcial).
 *   4. Deriva el estado final (dominio puro `derivarEstadoFianzaDevolucion`).
 *   5. Si hay justificante, verifica el DOCUMENTO en el tenant (RLS, acotado por tipo+reserva);
 *      ausente → `JustificanteNoEncontradoError` (404). En `devuelta` el motivo se ignora (null).
 *   6. `UPDATE RESERVA` (`fianza_status`/`fianza_devuelta_eur`/`fianza_devuelta_fecha`/
 *      `motivo_retencion`; NUNCA `estado`) y registra AUDIT_LOG con `datos_anteriores`/`datos_nuevos`.
 *
 * Hexagonal (hook `no-infra-in-domain`): depende SOLO de puertos inyectados; no importa Prisma ni
 * `@nestjs/*`.
 */
import { validarDevolucionFianza } from '../domain/validar-devolucion-fianza';
import { derivarEstadoFianzaDevolucion } from '../domain/derivar-estado-fianza-devolucion';
import { puedeRegistrarDevolucion } from '../domain/puede-registrar-devolucion';

// ---------------------------------------------------------------------------
// Tipos de comando / proyecciones
// ---------------------------------------------------------------------------

/** Comando de la acción "Registrar la devolución de la fianza". */
export interface RegistrarDevolucionFianzaComando {
  /** Tenant del JWT (nunca del path/body). */
  tenantId: string;
  /** Gestor que ejecuta la acción (auditoría). */
  usuarioId: string;
  /** RESERVA cuya fianza se devuelve. */
  reservaId: string;
  /** Importe realmente devuelto (Importe string de 2 decimales, `0.00 ≤ x ≤ fianzaEur`). */
  importeDevuelto: string;
  /** Fecha del abono (ISO date `YYYY-MM-DD`, `>= fianza_cobrada_fecha`). */
  fechaCobro: string;
  /** Motivo de la retención (requerido si el resultado es `retenida_parcial`). */
  motivoRetencion?: string | null;
  /** DOCUMENTO justificante ya subido (tipo `justificante_pago`), OPCIONAL (FA-04). */
  justificanteDocId?: string | null;
}

/** Proyección mínima de la RESERVA releída con bloqueo de fila (fuente de verdad del estado). */
export interface ReservaDevolucionFianza {
  idReserva: string;
  tenantId: string;
  clienteId: string;
  codigo: string;
  estado: string;
  fianzaStatus: string;
  /** Importe de la fianza cobrada (cota superior + comparación para el estado final). */
  fianzaEur: string;
  /** Fecha del cobro previo de la fianza (cota inferior de la fecha de devolución). */
  fianzaCobradaFecha: Date;
  /** IBAN de devolución del CLIENTE (precondición triple). */
  ibanDevolucion: string | null;
}

/** Proyección del DOCUMENTO justificante (verificación de existencia + tenant). */
export interface DocumentoJustificante {
  idDocumento: string;
  tenantId: string;
  reservaId: string | null;
  tipo: 'justificante_pago' | string;
  mimeType: string;
  url: string;
}

// ---------------------------------------------------------------------------
// Puertos tx-bound (implementados por infraestructura dentro de la unidad de trabajo)
// ---------------------------------------------------------------------------

/** Parámetros del registro del estado final de la devolución sobre la RESERVA. */
export interface RegistrarDevolucionParams {
  reservaId: string;
  fianzaStatus: 'devuelta' | 'retenida_parcial';
  fianzaDevueltaEur: string;
  fianzaDevueltaFecha: Date;
  motivoRetencion: string | null;
}

/** Repositorio tx-bound de la RESERVA (relectura con FOR UPDATE + registro del estado final). */
export interface ReservasDevolucionFianzaPort {
  /** Relee la RESERVA con `SELECT ... FOR UPDATE` (serialización del doble registro, D-1/D-4). */
  releerConBloqueo(params: { reservaId: string }): Promise<ReservaDevolucionFianza | null>;
  /** Aplica el estado final de la fianza (nunca transiciona `RESERVA.estado`). */
  registrarDevolucion(params: RegistrarDevolucionParams): Promise<void>;
}

/** Repositorio tx-bound de DOCUMENTO (verificación del justificante en el tenant). */
export interface DocumentosDevolucionFianzaPort {
  /**
   * Busca un DOCUMENTO que sea REALMENTE un justificante de pago DE ESTA reserva: acota por
   * `tipo = 'justificante_pago'` y `reservaId` además del tenant (RLS). Otro tipo o de otra reserva
   * se trata como NO ENCONTRADO (`null` → 404).
   */
  buscarJustificante(params: {
    idDocumento: string;
    tenantId: string;
    reservaId: string;
  }): Promise<DocumentoJustificante | null>;
}

/** Registro de auditoría de la devolución de la fianza. */
export interface RegistroAuditoriaDevolucionFianza {
  tenantId: string;
  usuarioId?: string | null;
  entidad: 'RESERVA';
  entidadId: string;
  accion: 'actualizar';
  datosAnteriores?: Record<string, unknown> | null;
  datosNuevos?: Record<string, unknown> | null;
}

/** Repositorio tx-bound de AUDIT_LOG. */
export interface AuditoriaDevolucionFianzaPort {
  registrar(registro: RegistroAuditoriaDevolucionFianza): Promise<void>;
}

/** Conjunto de repositorios disponibles dentro de la unidad de trabajo de la devolución. */
export interface RepositoriosDevolucionFianza {
  reservas: ReservasDevolucionFianzaPort;
  documentos: DocumentosDevolucionFianzaPort;
  auditoria: AuditoriaDevolucionFianzaPort;
}

/**
 * Unidad de trabajo transaccional (tx + RLS). El `trabajo` corre bajo `SET LOCAL app.tenant_id` y
 * la relectura `FOR UPDATE`; si lanza, la tx REVIERTE por completo (atomicidad).
 */
export interface UnidadDeTrabajoDevolucionFianzaPort {
  ejecutar(
    tenantId: string,
    trabajo: (repos: RepositoriosDevolucionFianza) => Promise<unknown>,
  ): Promise<unknown>;
}

/** Dependencias del caso de uso (puertos inyectados). */
export interface RegistrarDevolucionFianzaDeps {
  unidadDeTrabajo: UnidadDeTrabajoDevolucionFianzaPort;
}

/** Proyección de la RESERVA en la respuesta (estado final del sub-proceso de fianza). */
export interface ReservaDevolucionResultado {
  idReserva: string;
  fianzaStatus: 'devuelta' | 'retenida_parcial';
  fianzaDevueltaEur: string;
  fianzaDevueltaFecha: string;
  motivoRetencion: string | null;
}

/** Proyección del DOCUMENTO justificante en la respuesta. */
export interface DocumentoJustificanteResultado {
  idDocumento: string;
  tipo: string;
  mimeType: string;
  url: string;
}

/** Resultado del registro de la devolución (contrato `RegistrarDevolucionFianzaResponse`). */
export interface RegistrarDevolucionFianzaResultado {
  reserva: ReservaDevolucionResultado;
  documentoJustificante?: DocumentoJustificanteResultado | null;
  avisoSinJustificante: boolean;
}

// ---------------------------------------------------------------------------
// Errores de dominio tipados, en español (mapeados a HTTP en el controlador)
// ---------------------------------------------------------------------------

// Re-exporta los errores de validación de dominio para el mapeo HTTP del controlador (400).
export {
  ImporteSuperaFianzaError,
  FechaDevolucionInvalidaError,
  MotivoRetencionRequeridoError,
} from '../domain/validar-devolucion-fianza';

/** La RESERVA no existe para el tenant (RLS) → HTTP 404. */
export class ReservaDevolucionNoEncontradaError extends Error {
  readonly codigo = 'RESERVA_NO_ENCONTRADA' as const;
  readonly reservaId: string;

  constructor(reservaId: string) {
    super('No hay reserva para el registro de la devolución de la fianza');
    this.name = 'ReservaDevolucionNoEncontradaError';
    this.reservaId = reservaId;
  }
}

/** El justificante referenciado no existe en el tenant (RLS) → HTTP 404. */
export class JustificanteNoEncontradoError extends Error {
  readonly codigo = 'JUSTIFICANTE_NO_ENCONTRADO' as const;

  constructor(motivo = 'El justificante de pago referenciado no existe') {
    super(motivo);
    this.name = 'JustificanteNoEncontradoError';
  }
}

/** Precondición triple incumplida (estado / fianza_status / IBAN) → HTTP 409. */
export class PrecondicionNoCumplidaError extends Error {
  readonly codigo = 'PRECONDICION_NO_CUMPLIDA' as const;

  constructor(
    motivo = 'No se cumplen las precondiciones para registrar la devolución de la fianza',
  ) {
    super(motivo);
    this.name = 'PrecondicionNoCumplidaError';
  }
}

/** La devolución ya está registrada (estado final irreversible, doble registro) → HTTP 409. */
export class DevolucionYaRegistradaError extends Error {
  readonly codigo = 'DEVOLUCION_YA_REGISTRADA' as const;

  constructor(motivo = 'La devolución de la fianza ya está registrada') {
    super(motivo);
    this.name = 'DevolucionYaRegistradaError';
  }
}

// ---------------------------------------------------------------------------
// Caso de uso
// ---------------------------------------------------------------------------

export class RegistrarDevolucionFianzaUseCase {
  constructor(private readonly deps: RegistrarDevolucionFianzaDeps) {}

  async ejecutar(
    comando: RegistrarDevolucionFianzaComando,
  ): Promise<RegistrarDevolucionFianzaResultado> {
    return (await this.deps.unidadDeTrabajo.ejecutar(comando.tenantId, (repos) =>
      this.registrar(comando, repos),
    )) as RegistrarDevolucionFianzaResultado;
  }

  private async registrar(
    comando: RegistrarDevolucionFianzaComando,
    repos: RepositoriosDevolucionFianza,
  ): Promise<RegistrarDevolucionFianzaResultado> {
    // (1) Relectura de la RESERVA con BLOQUEO DE FILA (FOR UPDATE): fuente de verdad y
    //     serialización del doble registro concurrente (D-1/D-4). Inexistente/cross-tenant → 404.
    const reserva = await repos.reservas.releerConBloqueo({ reservaId: comando.reservaId });
    if (reserva === null || reserva === undefined) {
      throw new ReservaDevolucionNoEncontradaError(comando.reservaId);
    }

    // (2) Guarda de precondición triple / doble registro (dominio puro), reevaluada bajo el lock.
    const guarda = puedeRegistrarDevolucion({
      estado: reserva.estado,
      fianzaStatus: reserva.fianzaStatus,
      ibanDevolucion: reserva.ibanDevolucion,
    });
    if (!guarda.permitido) {
      if (guarda.codigo === 'DEVOLUCION_YA_REGISTRADA') {
        throw new DevolucionYaRegistradaError();
      }
      throw new PrecondicionNoCumplidaError();
    }

    // (3) Validación de dominio puro: 0 ≤ importe ≤ fianzaEur, fecha ≥ fianza_cobrada_fecha,
    //     motivo requerido si parcial.
    const fechaCobro = new Date(comando.fechaCobro);
    validarDevolucionFianza({
      importeDevuelto: comando.importeDevuelto,
      fianzaEur: reserva.fianzaEur,
      fechaCobro,
      fianzaCobradaFecha: reserva.fianzaCobradaFecha,
      motivoRetencion: comando.motivoRetencion,
    });

    // (4) Derivación del estado final (dominio puro).
    const fianzaStatus = derivarEstadoFianzaDevolucion({
      importeDevuelto: comando.importeDevuelto,
      fianzaEur: reserva.fianzaEur,
    });
    // El motivo solo se persiste en `retenida_parcial`; en `devuelta` se ignora (null).
    const motivoRetencion =
      fianzaStatus === 'retenida_parcial' ? (comando.motivoRetencion ?? null) : null;

    // (5) Justificante OPCIONAL (FA-04): si se adjunta, verifica que existe en el tenant (RLS),
    //     que es de tipo `justificante_pago` y que pertenece a ESTA reserva; en otro caso → 404.
    const justificanteDocId = comando.justificanteDocId ?? null;
    let documentoJustificante: DocumentoJustificante | null = null;
    if (justificanteDocId !== null) {
      documentoJustificante = await repos.documentos.buscarJustificante({
        idDocumento: justificanteDocId,
        tenantId: comando.tenantId,
        reservaId: comando.reservaId,
      });
      if (documentoJustificante === null || documentoJustificante === undefined) {
        throw new JustificanteNoEncontradoError();
      }
    }

    // (6) Registro del estado final sobre la RESERVA (nunca RESERVA.estado) + AUDIT_LOG.
    await repos.reservas.registrarDevolucion({
      reservaId: comando.reservaId,
      fianzaStatus,
      fianzaDevueltaEur: comando.importeDevuelto,
      fianzaDevueltaFecha: fechaCobro,
      motivoRetencion,
    });
    await repos.auditoria.registrar({
      tenantId: comando.tenantId,
      usuarioId: comando.usuarioId,
      entidad: 'RESERVA',
      entidadId: comando.reservaId,
      accion: 'actualizar',
      datosAnteriores: {
        fianzaStatus: reserva.fianzaStatus,
        fianzaDevueltaEur: null,
        fianzaDevueltaFecha: null,
      },
      datosNuevos: {
        fianzaStatus,
        fianzaDevueltaEur: comando.importeDevuelto,
        fianzaDevueltaFecha: comando.fechaCobro,
        motivoRetencion,
        justificanteDocId,
      },
    });

    return {
      reserva: {
        idReserva: comando.reservaId,
        fianzaStatus,
        fianzaDevueltaEur: comando.importeDevuelto,
        fianzaDevueltaFecha: comando.fechaCobro,
        motivoRetencion,
      },
      documentoJustificante:
        documentoJustificante === null
          ? null
          : {
              idDocumento: documentoJustificante.idDocumento,
              tipo: documentoJustificante.tipo,
              mimeType: documentoJustificante.mimeType,
              url: documentoJustificante.url,
            },
      avisoSinJustificante: justificanteDocId === null,
    };
  }
}

/**
 * Caso de uso de APLICACIÓN: aprobar el borrador de la factura de señal — transición
 * `borrador → enviada` (US-022 / UC-18, design.md §D-9). skill `state-machine`:
 * transición gobernada por la tabla declarativa de `domain/factura.ts`, guardas → 409/422.
 *
 * Precondiciones (autoritativas en servidor):
 *   - La FACTURA existe para el tenant (RLS) → si no, FacturaNoEncontradaError (404).
 *   - Está en `estado='borrador'` → si no, FacturaNoBorradorError (409 FACTURA_NO_BORRADOR).
 *   - Datos fiscales del CLIENTE completos → si no, DatosFiscalesIncompletosError
 *     (422 DATOS_FISCALES_INCOMPLETOS + camposFaltantes).
 *   - PDF disponible (`pdf_url != null`) → si no, PdfPendienteError (422 PDF_PENDIENTE).
 * Si se cumplen: `estado → 'enviada'`, fija `fecha_emision` con el reloj, y registra
 * AUDIT_LOG `accion='actualizar'` (borrador → enviada).
 *
 * Orden de guardas: datos fiscales ANTES que PDF (un borrador inválido por datos también
 * tiene `pdf_url=null`, pero el motivo relevante para el Gestor es completar los datos).
 *
 * Hexagonal (hook `no-infra-in-domain`): depende SOLO de puertos inyectados.
 */
import { esBorrador } from '../domain/factura';
import type { ClockPort, FacturaSenal } from './generar-factura-senal.use-case';

// ---------------------------------------------------------------------------
// Comando / puertos / dependencias
// ---------------------------------------------------------------------------

/** Comando de aprobación. */
export interface AprobarFacturaComando {
  tenantId: string;
  usuarioId: string;
  facturaId: string;
}

/** Parámetros de la aprobación (transición) tx-bound. */
export interface AprobarFacturaParams {
  facturaId: string;
  estado: 'enviada';
  fechaEmision: Date;
}

/** Registro de auditoría de la aprobación. */
export interface RegistroAuditoriaAprobacion {
  tenantId: string;
  usuarioId?: string | null;
  entidad: 'FACTURA';
  entidadId: string;
  accion: 'actualizar';
  datosAnteriores: { estado: string };
  datosNuevos: { estado: string };
}

/** Dependencias del caso de uso (puertos inyectados como funciones/objetos). */
export interface AprobarFacturaDeps {
  /** Carga la FACTURA por id bajo RLS (cross-tenant → null). */
  cargarFactura(params: {
    tenantId: string;
    facturaId: string;
  }): Promise<FacturaSenal | null | undefined>;
  /** Enumera los campos fiscales del CLIENTE de la factura que faltan. */
  camposFiscalesFaltantes(params: {
    tenantId: string;
    facturaId: string;
  }): Promise<ReadonlyArray<string>>;
  /** Aplica la transición a `enviada` + `fecha_emision` (tx). */
  aprobar(params: AprobarFacturaParams): Promise<void>;
  /** Registra el AUDIT_LOG `actualizar`. */
  registrarAuditoria(registro: RegistroAuditoriaAprobacion): Promise<void>;
  clock: ClockPort;
}

// ---------------------------------------------------------------------------
// Errores de dominio tipados
// ---------------------------------------------------------------------------

/** La FACTURA no existe para el tenant (RLS). Mapea a 404. */
export class FacturaNoEncontradaError extends Error {
  readonly codigo = 'FACTURA_NO_ENCONTRADA' as const;
  readonly facturaId: string;

  constructor(facturaId: string) {
    super('La factura no existe para el tenant');
    this.name = 'FacturaNoEncontradaError';
    this.facturaId = facturaId;
  }
}

/** La FACTURA no está en `borrador` (ya `enviada`/`cobrada`). Mapea a 409. */
export class FacturaNoBorradorError extends Error {
  readonly codigo = 'FACTURA_NO_BORRADOR' as const;
  readonly motivo: string;

  constructor(motivo = 'La factura no está en borrador') {
    super(motivo);
    this.name = 'FacturaNoBorradorError';
    this.motivo = motivo;
  }
}

/** Datos fiscales del CLIENTE incompletos: borrador inválido. Mapea a 422. */
export class DatosFiscalesIncompletosError extends Error {
  readonly codigo = 'DATOS_FISCALES_INCOMPLETOS' as const;
  readonly camposFaltantes: ReadonlyArray<string>;

  constructor(camposFaltantes: ReadonlyArray<string>) {
    super('Datos fiscales del cliente incompletos');
    this.name = 'DatosFiscalesIncompletosError';
    this.camposFaltantes = camposFaltantes;
  }
}

/** El PDF no está disponible (fallo transitorio). Mapea a 422. */
export class PdfPendienteError extends Error {
  readonly codigo = 'PDF_PENDIENTE' as const;
  readonly motivo: string;

  constructor(motivo = 'PDF pendiente de regenerar') {
    super(motivo);
    this.name = 'PdfPendienteError';
    this.motivo = motivo;
  }
}

// ---------------------------------------------------------------------------
// Caso de uso
// ---------------------------------------------------------------------------

export class AprobarFacturaUseCase {
  constructor(private readonly deps: AprobarFacturaDeps) {}

  /** Aprueba el borrador válido con PDF: `borrador → enviada` + `fecha_emision`. */
  async ejecutar(comando: AprobarFacturaComando): Promise<void> {
    const factura = await this.deps.cargarFactura({
      tenantId: comando.tenantId,
      facturaId: comando.facturaId,
    });
    if (factura === null || factura === undefined) {
      throw new FacturaNoEncontradaError(comando.facturaId);
    }

    // Guarda de estado (tabla declarativa): solo un borrador es aprobable.
    if (!esBorrador(factura.estado)) {
      throw new FacturaNoBorradorError();
    }

    // Guarda de datos fiscales del cliente (bloqueo por datos, antes que PDF).
    const faltantes = await this.deps.camposFiscalesFaltantes({
      tenantId: comando.tenantId,
      facturaId: comando.facturaId,
    });
    if (faltantes.length > 0) {
      throw new DatosFiscalesIncompletosError(faltantes);
    }

    // Guarda de PDF disponible (bloqueo transitorio).
    if (factura.pdfUrl === null) {
      throw new PdfPendienteError();
    }

    const fechaEmision = this.deps.clock.ahora();
    await this.deps.aprobar({
      facturaId: factura.idFactura,
      estado: 'enviada',
      fechaEmision,
    });
    await this.deps.registrarAuditoria({
      tenantId: comando.tenantId,
      usuarioId: comando.usuarioId,
      entidad: 'FACTURA',
      entidadId: factura.idFactura,
      accion: 'actualizar',
      datosAnteriores: { estado: 'borrador' },
      datosNuevos: { estado: 'enviada' },
    });
  }
}

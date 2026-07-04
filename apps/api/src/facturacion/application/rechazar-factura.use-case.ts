/**
 * Caso de uso de APLICACIÓN: rechazar el borrador de la factura de señal (US-022 / UC-18,
 * design.md §D-9).
 *
 * El rechazo NO es una transición de estado: la FACTURA PERMANECE en `borrador`. El motivo
 * (obligatorio) se registra en AUDIT_LOG y E3 queda bloqueado. Tras corregir la incidencia
 * (p. ej. datos fiscales del TENANT) el Gestor puede regenerar el PDF y volver a revisar.
 *
 * Guardas:
 *   - motivo no vacío → si falta, MotivoRequeridoError (400).
 *   - FACTURA existe (RLS) → si no, FacturaNoEncontradaError (404).
 *   - está en `borrador` → si no, FacturaNoBorradorError (409): una factura ya enviada no
 *     puede rechazarse.
 *
 * Hexagonal (hook `no-infra-in-domain`): depende SOLO de puertos inyectados.
 */
import { esBorrador } from '../domain/factura';
import type { ClockPort, FacturaSenal } from './generar-factura-senal.use-case';
import { FacturaNoBorradorError, FacturaNoEncontradaError } from './aprobar-factura.use-case';

// ---------------------------------------------------------------------------
// Comando / registro / dependencias
// ---------------------------------------------------------------------------

/** Comando de rechazo. */
export interface RechazarFacturaComando {
  tenantId: string;
  usuarioId: string;
  facturaId: string;
  motivo: string;
}

/** Registro de auditoría del rechazo (permanece en borrador). */
export interface RegistroAuditoriaRechazo {
  tenantId: string;
  usuarioId?: string | null;
  entidad: 'FACTURA';
  entidadId: string;
  accion: 'actualizar';
  motivo: string;
  datosAnteriores: { estado: string };
  datosNuevos: { estado: string };
}

/** Dependencias del caso de uso (puertos inyectados). */
export interface RechazarFacturaDeps {
  cargarFactura(params: {
    tenantId: string;
    facturaId: string;
  }): Promise<FacturaSenal | null | undefined>;
  registrarAuditoria(registro: RegistroAuditoriaRechazo): Promise<void>;
  clock: ClockPort;
}

/** Resultado del rechazo: la factura, que sigue en `borrador`. */
export interface RechazarFacturaResultado {
  idFactura: string;
  estado: string;
}

// ---------------------------------------------------------------------------
// Errores de dominio
// ---------------------------------------------------------------------------

/** El motivo del rechazo es obligatorio y no vacío. Mapea a 400. */
export class MotivoRequeridoError extends Error {
  readonly codigo = 'MOTIVO_REQUERIDO' as const;

  constructor(mensaje = 'El motivo de rechazo es obligatorio') {
    super(mensaje);
    this.name = 'MotivoRequeridoError';
  }
}

// Reexporta para que la interfaz mapee los mismos errores 404/409 que aprobar.
export { FacturaNoBorradorError, FacturaNoEncontradaError };

// ---------------------------------------------------------------------------
// Caso de uso
// ---------------------------------------------------------------------------

export class RechazarFacturaUseCase {
  constructor(private readonly deps: RechazarFacturaDeps) {}

  /** Rechaza el borrador: no cambia el estado, registra el motivo en AUDIT_LOG. */
  async ejecutar(
    comando: RechazarFacturaComando,
  ): Promise<RechazarFacturaResultado> {
    if (comando.motivo.trim().length === 0) {
      throw new MotivoRequeridoError();
    }

    const factura = await this.deps.cargarFactura({
      tenantId: comando.tenantId,
      facturaId: comando.facturaId,
    });
    if (factura === null || factura === undefined) {
      throw new FacturaNoEncontradaError(comando.facturaId);
    }
    if (!esBorrador(factura.estado)) {
      throw new FacturaNoBorradorError();
    }

    await this.deps.registrarAuditoria({
      tenantId: comando.tenantId,
      usuarioId: comando.usuarioId,
      entidad: 'FACTURA',
      entidadId: factura.idFactura,
      accion: 'actualizar',
      motivo: comando.motivo,
      // El rechazo NO transiciona: permanece en borrador.
      datosAnteriores: { estado: 'borrador' },
      datosNuevos: { estado: 'borrador' },
    });

    return { idFactura: factura.idFactura, estado: factura.estado };
  }
}

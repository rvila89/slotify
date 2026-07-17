/**
 * Caso de uso `DescartarBorradorUseCase` (US-046 / UC-36; design.md D-5 Opción A).
 *
 * ACCIÓN MANUAL del Gestor: descarta una `COMUNICACION` en `estado='borrador'` SIN
 * enviar ningún email. Como el enum NO tiene estado "descartado", el descarte se modela
 * como `actualizarEstado({ estado:'fallido', fechaEnvio:null })` + `AUDIT_LOG` con la
 * causa `"descartado por gestor"` (distinguible de un fallo del proveedor por dicha
 * causa). Solo `borrador` es descartable (conflicto → 409). Bajo el `tenant_id` del JWT.
 *
 * Reutiliza el puerto de carga y los errores del `EnviarBorradorUseCase` (misma familia
 * de errores de la acción manual); NO se inyecta `EnviarEmailPort` (el descarte no envía).
 *
 * Aplicación PURA: depende SOLO de puertos inyectados (hexagonal, hook `no-infra-in-domain`).
 */
import type { AuditLogPort } from '../../shared/audit/audit-log.port';
import type { EstadoComunicacion } from '../domain/codigo-email';
import type { ComunicacionRepositoryPort } from '../domain/comunicacion.repository.port';
import {
  ComunicacionNoEncontradaError,
  EstadoNoBorradorError,
  type CargarComunicacionPort,
  type ComunicacionContexto,
} from './enviar-borrador.use-case';

export {
  ComunicacionNoEncontradaError,
  EstadoNoBorradorError,
  type CargarComunicacionPort,
  type ComunicacionContexto,
};

/** Comando de descarte. `tenantId`/`usuarioId` del JWT (nunca del body). */
export interface DescartarBorradorComando {
  tenantId: string;
  usuarioId: string;
  reservaId: string;
  idComunicacion: string;
}

/** Resultado: la comunicación tras el descarte (`fallido` sin fecha). */
export interface DescartarBorradorResultado {
  idComunicacion: string;
  reservaId: string;
  clienteId: string;
  codigoEmail: string;
  asunto: string;
  cuerpo: string;
  destinatarioEmail: string | null;
  estado: EstadoComunicacion;
  fechaEnvio: Date | null;
  fechaCreacion: Date;
  esReenvio: boolean;
}

/** Dependencias del caso de uso. Sin puerto de envío (el descarte no envía). */
export interface DescartarBorradorDeps {
  cargarComunicacion: CargarComunicacionPort;
  comunicaciones: ComunicacionRepositoryPort;
  auditoria: AuditLogPort;
}

export class DescartarBorradorUseCase {
  constructor(private readonly deps: DescartarBorradorDeps) {}

  async ejecutar(
    comando: DescartarBorradorComando,
  ): Promise<DescartarBorradorResultado> {
    // 1. Cargar scoped por el tenant del JWT y la reserva (RLS): otro tenant → null → 404.
    const comunicacion = await this.deps.cargarComunicacion.cargar({
      tenantId: comando.tenantId,
      reservaId: comando.reservaId,
      idComunicacion: comando.idComunicacion,
    });
    if (comunicacion === null) {
      throw new ComunicacionNoEncontradaError(comando.idComunicacion);
    }

    // 2. Solo `borrador` es descartable (conflicto de estado → 409, sin efectos).
    if (comunicacion.estado !== 'borrador') {
      throw new EstadoNoBorradorError(comunicacion.estado);
    }

    // 3. Descartar: `fallido` sin fecha, SIN enviar ningún email (D-5 Opción A).
    const actualizada = await this.deps.comunicaciones.actualizarEstado({
      tenantId: comando.tenantId,
      idComunicacion: comunicacion.idComunicacion,
      estado: 'fallido',
      fechaEnvio: null,
    });

    // 4. AUDIT_LOG con la causa "descartado por gestor" (distingue del fallo del proveedor).
    await this.deps.auditoria.registrar({
      tenantId: comando.tenantId,
      usuarioId: comando.usuarioId,
      accion: 'actualizar',
      entidad: 'COMUNICACION',
      entidadId: comunicacion.idComunicacion,
      datosNuevos: {
        causa: 'descartado por gestor',
        codigoEmail: comunicacion.codigoEmail,
        estado: 'fallido',
      },
    });

    return {
      idComunicacion: actualizada.idComunicacion,
      reservaId: comunicacion.reservaId,
      clienteId: comunicacion.clienteId,
      codigoEmail: comunicacion.codigoEmail,
      asunto: comunicacion.asunto,
      cuerpo: comunicacion.cuerpo,
      destinatarioEmail: comunicacion.destinatarioEmail,
      estado: actualizada.estado,
      fechaEnvio: actualizada.fechaEnvio,
      // Datos reales de la fila pre-existente (no se fabrican en el controller).
      fechaCreacion: actualizada.fechaCreacion,
      esReenvio: actualizada.esReenvio,
    };
  }
}

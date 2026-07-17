/**
 * Caso de uso `CrearEmailManualUseCase` (US-046 / UC-36; design.md D-1, D-4, D-5 Opción C).
 *
 * ACCIÓN MANUAL del Gestor: crea y ENVÍA un email `manual` desde la ficha de una RESERVA
 * al `CLIENTE.email` de la reserva. Orquesta los puertos de US-045: valida el destinatario
 * (D-4), envía por `EnviarEmailPort` y crea la `COMUNICACION` con `codigo_email='manual'`,
 * `estado='enviado'`, `fecha_envio` no nulo, `reserva_id`/`cliente_id`/`tenant_id`
 * correctos y **`es_reenvio=false`** (semántica honesta, D-5 Opción C: NO es un reenvío;
 * queda fuera del índice UNIQUE parcial por el predicado `codigo_email <> 'manual'`, no
 * por `es_reenvio`). Cada manual crea una fila NUEVA (no consulta idempotencia).
 *
 * Errores: `ReservaNoEncontradaError` (404, RLS), `DestinatarioInvalidoError` (422, no
 * crea fila ni envía), `ProveedorEmailError` (502, la fila queda persistida en `fallido`).
 *
 * Aplicación PURA: depende SOLO de puertos inyectados (hexagonal, hook `no-infra-in-domain`).
 */
import type { AuditLogPort } from '../../shared/audit/audit-log.port';
import type { EstadoComunicacion } from '../domain/codigo-email';
import type { ComunicacionRepositoryPort } from '../domain/comunicacion.repository.port';
import type { EnviarEmailPort } from '../domain/enviar-email.port';
import { esEmailValido } from '../domain/esemailvalido';
import type { ClockPort } from './despachar-email.service';
import {
  DestinatarioInvalidoError,
  ProveedorEmailError,
} from './comunicacion-errors';

// Re-exporta los errores COMPARTIDOS (definición canónica en `comunicacion-errors.ts`)
// para que sean la MISMA clase que comprueba el controller por `instanceof`, evitando el
// 500 que se producía cuando este use-case definía sus propias clases homónimas.
export {
  DestinatarioInvalidoError,
  ProveedorEmailError,
} from './comunicacion-errors';

/** Proyección mínima de la RESERVA + su CLIENTE para el email manual (scoped tenant). */
export interface ReservaContexto {
  idReserva: string;
  tenantId: string;
  clienteId: string;
  clienteEmail: string | null;
}

/** Parámetros de carga de la reserva (scoped por el tenant del JWT, RLS). */
export interface CargarReservaContextoParams {
  tenantId: string;
  reservaId: string;
}

/** Puerto de LECTURA de la RESERVA + CLIENTE. Otro tenant → `null` → 404. */
export interface CargarReservaContextoPort {
  cargar(
    params: CargarReservaContextoParams,
  ): Promise<ReservaContexto | null>;
}

/** Comando del email manual. `tenantId`/`usuarioId` del JWT; `asunto`/`cuerpo` del gestor. */
export interface CrearEmailManualComando {
  tenantId: string;
  usuarioId: string;
  reservaId: string;
  asunto: string;
  cuerpo: string;
}

/** Resultado: la `COMUNICACION` `manual` creada y enviada. */
export interface CrearEmailManualResultado {
  idComunicacion: string;
  reservaId: string;
  clienteId: string;
  estado: EstadoComunicacion;
  codigoEmail: 'manual';
  asunto: string;
  cuerpo: string;
  destinatarioEmail: string | null;
  fechaEnvio: Date | null;
  fechaCreacion: Date;
  esReenvio: boolean;
}

/** Dependencias del caso de uso. */
export interface CrearEmailManualDeps {
  cargarReserva: CargarReservaContextoPort;
  comunicaciones: ComunicacionRepositoryPort;
  enviarEmail: EnviarEmailPort;
  auditoria: AuditLogPort;
  clock: ClockPort;
}

/** La RESERVA no existe para el tenant del JWT (o es de otro tenant, RLS) → 404. */
export class ReservaNoEncontradaError extends Error {
  readonly codigo = 'reserva_no_encontrada';

  constructor(reservaId: string) {
    super(`No se encontró la reserva ${reservaId} para el tenant`);
    this.name = 'ReservaNoEncontradaError';
  }
}


export class CrearEmailManualUseCase {
  constructor(private readonly deps: CrearEmailManualDeps) {}

  async ejecutar(
    comando: CrearEmailManualComando,
  ): Promise<CrearEmailManualResultado> {
    // 1. Cargar la RESERVA + CLIENTE scoped por el tenant del JWT (RLS): otro tenant → 404.
    const reserva = await this.deps.cargarReserva.cargar({
      tenantId: comando.tenantId,
      reservaId: comando.reservaId,
    });
    if (reserva === null) {
      throw new ReservaNoEncontradaError(comando.reservaId);
    }

    // 2. Validación de destinatario PREVIA (D-4): email nulo/ inválido bloquea SIN crear
    //    fila `enviado` ni llamar al proveedor.
    if (!esEmailValido(reserva.clienteEmail)) {
      throw new DestinatarioInvalidoError();
    }
    const destinatario = reserva.clienteEmail as string;

    // 3. Enviar el email manual al CLIENTE de la reserva. Un fallo del proveedor deja la
    //    fila persistida en `fallido` (best-effort) y expone `ProveedorEmailError` (502),
    //    sin propagar la excepción cruda del proveedor.
    try {
      await this.deps.enviarEmail.enviar({
        destinatario,
        asunto: comando.asunto,
        cuerpo: comando.cuerpo,
        codigoEmail: 'manual',
        tenantId: comando.tenantId,
      });
    } catch {
      await this.deps.comunicaciones.crear({
        tenantId: comando.tenantId,
        reservaId: reserva.idReserva,
        clienteId: reserva.clienteId,
        codigoEmail: 'manual',
        asunto: comando.asunto,
        cuerpo: comando.cuerpo,
        destinatarioEmail: destinatario,
        estado: 'fallido',
        fechaEnvio: null,
        esReenvio: false,
      });
      await this.deps.auditoria.registrar({
        tenantId: comando.tenantId,
        usuarioId: comando.usuarioId,
        accion: 'crear',
        entidad: 'COMUNICACION',
        entidadId: reserva.idReserva,
        datosNuevos: { motivo: 'manual_fallido', codigoEmail: 'manual' },
      });
      throw new ProveedorEmailError();
    }

    // 4. Crear la `COMUNICACION` `manual`/`enviado` con `fecha_envio` no nulo. `es_reenvio`
    //    es FALSE (D-5 Opción C); queda fuera del índice parcial por el predicado del
    //    índice (`codigo_email <> 'manual'`), permitiendo varios `manual` por reserva.
    const fechaEnvio = this.deps.clock.ahora();
    const creada = await this.deps.comunicaciones.crear({
      tenantId: comando.tenantId,
      reservaId: reserva.idReserva,
      clienteId: reserva.clienteId,
      codigoEmail: 'manual',
      asunto: comando.asunto,
      cuerpo: comando.cuerpo,
      destinatarioEmail: destinatario,
      estado: 'enviado',
      fechaEnvio,
      esReenvio: false,
    });

    // 5. AUDIT_LOG bajo el tenant del JWT.
    await this.deps.auditoria.registrar({
      tenantId: comando.tenantId,
      usuarioId: comando.usuarioId,
      accion: 'crear',
      entidad: 'COMUNICACION',
      entidadId: creada.idComunicacion,
      datosNuevos: { motivo: 'email_manual', codigoEmail: 'manual', estado: 'enviado' },
    });

    return {
      idComunicacion: creada.idComunicacion,
      reservaId: reserva.idReserva,
      clienteId: reserva.clienteId,
      estado: creada.estado,
      codigoEmail: 'manual',
      asunto: comando.asunto,
      cuerpo: comando.cuerpo,
      destinatarioEmail: destinatario,
      fechaEnvio: creada.fechaEnvio,
      // Datos reales de la fila creada (el `esReenvio` viene del dato, no hardcodeado).
      fechaCreacion: creada.fechaCreacion,
      esReenvio: creada.esReenvio,
    };
  }
}

/**
 * Caso de uso `SolicitarDatosPresupuestoUseCase` (change
 * `solicitud-datos-presupuesto-borrador`).
 *
 * ACCIÓN del Gestor desde el modal "Generar presupuesto": deja EN BORRADOR una
 * `COMUNICACION` (`codigo_email='E1'`, `subtipo='solicitud_datos'`, `estado='borrador'`,
 * `fecha_envio=null`) que solicita al cliente los datos fiscales (nombre y apellidos,
 * DNI/NIF, dirección y población) necesarios para generar el presupuesto, cuando aportó la
 * fecha en la primera consulta sin pasar por la transición `2a → 2b`.
 *
 * Reutiliza VERBATIM la plantilla del E1 "disponible"
 * (`renderMensajeTransicionFecha({ tipo:'disponible', … })`) — no se reescribe copy —
 * y crea el borrador DIRECTAMENTE vía `ComunicacionRepositoryPort.crear({ estado:'borrador',
 * fecha_envio:null, subtipo:'solicitud_datos', … })` persistiendo el asunto/cuerpo YA
 * renderizados en TEXTO PLANO (el envío los convierte a HTML), igual que el borrador E1 de
 * transición (`transicion-fecha.use-case.ts`). NO se delega en `DespacharEmailService`
 * porque su render reejecuta la plantilla del catálogo E1 e IGNORA el asunto/cuerpo
 * solicitados (bug de correctitud: el borrador salía con el texto de la respuesta inicial
 * automática en lugar del texto de solicitud de datos).
 *
 * Idempotencia (una sola vez), clavada sobre la terna `(reservaId, 'E1', 'solicitud_datos')`:
 *   - `enviado` previo   → `ComunicacionDuplicadaError` (409). Sin efectos.
 *   - `borrador` previo  → REUTILIZA (no duplica); `reutilizado=true`. No despacha.
 *   - sin fila previa    → crea el borrador; `reutilizado=false`.
 *
 * Guardas: datos fiscales del cliente COMPLETOS (los cinco campos) → `DatosFiscalesCompletosError`
 * (422); reserva inexistente o de otro tenant (RLS) → `ReservaNoEncontradaError` (404).
 *
 * Aplicación PURA: depende SOLO de puertos inyectados (hexagonal, hook `no-infra-in-domain`).
 */
import type { AuditLogPort } from '../../shared/audit/audit-log.port';
import { renderMensajeTransicionFecha } from '../../reservas/application/plantilla-transicion-fecha';
import type { EstadoComunicacion } from '../domain/codigo-email';
import type { ComunicacionRepositoryPort } from '../domain/comunicacion.repository.port';
import { ComunicacionDuplicadaError } from '../domain/comunicacion.repository.port';

// Re-exporta el error 409 COMPARTIDO (definición canónica en el puerto de dominio) para que
// sea la MISMA clase que comprueba el controller por `instanceof`.
export { ComunicacionDuplicadaError };

/** Subtipo de la terna de esta acción (independiente de `fecha_disponible`). */
const SUBTIPO_SOLICITUD_DATOS = 'solicitud_datos' as const;

/** Proyección del CLIENTE de la reserva (datos fiscales para la guarda 422). */
export interface ClientePresupuestoContexto {
  idCliente: string;
  nombre: string;
  apellidos: string | null;
  email: string | null;
  telefono: string | null;
  dniNif: string | null;
  direccion: string | null;
  codigoPostal: string | null;
  poblacion: string | null;
  provincia: string | null;
}

/**
 * Proyección de la RESERVA + su CLIENTE para la solicitud de datos (scoped tenant/RLS).
 * Aporta el contexto que el render de la plantilla del E1 disponible necesita (`idioma`,
 * `fechaEvento`, `numInvitadosFinal`, `duracionHoras`) y los datos fiscales del cliente.
 */
export interface ReservaPresupuestoContexto {
  idReserva: string;
  tenantId: string;
  clienteId: string;
  codigo: string;
  idioma: string;
  fechaEvento: Date;
  numInvitadosFinal: number | null;
  duracionHoras: number | null;
  cliente: ClientePresupuestoContexto;
}

/** Parámetros de carga de la reserva (scoped por el tenant del JWT, RLS). */
export interface CargarReservaPresupuestoContextoParams {
  tenantId: string;
  reservaId: string;
}

/** Puerto de LECTURA de la RESERVA + CLIENTE. Otro tenant/inexistente → `null` → 404. */
export interface CargarReservaPresupuestoContextoPort {
  cargar(
    params: CargarReservaPresupuestoContextoParams,
  ): Promise<ReservaPresupuestoContexto | null>;
}

/** Comando de la acción. `tenantId`/`usuarioId` del JWT; `reservaId` del path (sin body). */
export interface SolicitarDatosPresupuestoComando {
  tenantId: string;
  usuarioId: string;
  reservaId: string;
}

/** Resultado: la `COMUNICACION` borrador E1 `solicitud_datos` creada o reutilizada. */
export interface SolicitarDatosPresupuestoResultado {
  idComunicacion: string;
  reservaId: string;
  clienteId: string;
  estado: EstadoComunicacion;
  codigoEmail: 'E1';
  /** `true` sii se reutilizó un borrador previo (HTTP 200); `false` sii se creó (HTTP 201). */
  reutilizado: boolean;
  fechaEnvio: Date | null;
}

/** Dependencias del caso de uso. */
export interface SolicitarDatosPresupuestoDeps {
  cargarReserva: CargarReservaPresupuestoContextoPort;
  comunicaciones: ComunicacionRepositoryPort;
  auditoria: AuditLogPort;
}

/** La RESERVA no existe para el tenant del JWT (o es de otro tenant, RLS) → 404. */
export class ReservaNoEncontradaError extends Error {
  readonly codigo = 'reserva_no_encontrada';

  constructor(reservaId: string) {
    super(`No se encontró la reserva ${reservaId} para el tenant`);
    this.name = 'ReservaNoEncontradaError';
  }
}

/**
 * Los datos fiscales del cliente ya están COMPLETOS: no procede solicitarlos → 422
 * (defensa en profundidad; el botón no debería mostrarse en el frontend). Sin efectos.
 */
export class DatosFiscalesCompletosError extends Error {
  readonly codigo = 'datos_fiscales_completos';

  constructor(clienteId: string) {
    super(
      `Los datos fiscales del cliente ${clienteId} ya están completos: no hay datos que solicitar`,
    );
    this.name = 'DatosFiscalesCompletosError';
  }
}

/** Los cinco campos fiscales que, presentes todos, hacen innecesaria la solicitud. */
const datosFiscalesCompletos = (cliente: ClientePresupuestoContexto): boolean =>
  [
    cliente.dniNif,
    cliente.direccion,
    cliente.codigoPostal,
    cliente.poblacion,
    cliente.provincia,
  ].every((valor) => valor !== null && valor !== undefined && valor !== '');

export class SolicitarDatosPresupuestoUseCase {
  constructor(private readonly deps: SolicitarDatosPresupuestoDeps) {}

  async ejecutar(
    comando: SolicitarDatosPresupuestoComando,
  ): Promise<SolicitarDatosPresupuestoResultado> {
    // 1. Cargar la RESERVA + CLIENTE scoped por el tenant del JWT (RLS): otro tenant → 404.
    const reserva = await this.deps.cargarReserva.cargar({
      tenantId: comando.tenantId,
      reservaId: comando.reservaId,
    });
    if (reserva === null) {
      throw new ReservaNoEncontradaError(comando.reservaId);
    }

    // 2. Guarda de datos fiscales COMPLETOS (los cinco campos) → 422 (sin efectos).
    if (datosFiscalesCompletos(reserva.cliente)) {
      throw new DatosFiscalesCompletosError(reserva.clienteId);
    }

    // 3. Idempotencia una-sola-vez sobre la terna `(reserva, 'E1', 'solicitud_datos')`:
    //    `enviado` previo → 409; `borrador` previo → reutiliza (no duplica).
    const existente = await this.deps.comunicaciones.buscarPorReservaYCodigo({
      tenantId: comando.tenantId,
      reservaId: reserva.idReserva,
      codigoEmail: 'E1',
      subtipo: SUBTIPO_SOLICITUD_DATOS,
    });
    if (existente !== null) {
      if (existente.estado === 'enviado') {
        throw new ComunicacionDuplicadaError(reserva.idReserva, 'E1');
      }
      // Borrador pendiente: se reutiliza sin despachar ni crear otra fila.
      return {
        idComunicacion: existente.idComunicacion,
        reservaId: reserva.idReserva,
        clienteId: reserva.clienteId,
        estado: existente.estado,
        codigoEmail: 'E1',
        reutilizado: true,
        fechaEnvio: existente.fechaEnvio,
      };
    }

    // 4. Renderizar el texto reutilizando VERBATIM la plantilla del E1 "disponible" según el
    //    idioma de la reserva (`ca` → catalán; cualquier otro → castellano).
    const mensaje = renderMensajeTransicionFecha({
      tipo: 'disponible',
      idioma: reserva.idioma,
      nombre: reserva.cliente.nombre,
      fechaEvento: reserva.fechaEvento,
      personas: reserva.numInvitadosFinal,
      horas: reserva.duracionHoras,
    });

    // 5. Crear el borrador DIRECTAMENTE (no vía el motor: su render reejecuta la plantilla
    //    del catálogo E1 e ignoraría este texto). Se persiste el asunto/cuerpo renderizados
    //    en TEXTO PLANO (se convierten a HTML al enviar, `cuerpoEsHtml=false`), igual que el
    //    borrador E1 de transición.
    //    ALCANCE DE LA IDEMPOTENCIA: el paso 3 (chequeo best-effort) + el índice UNIQUE
    //    parcial `(reserva_id, codigo_email, subtipo) WHERE estado='enviado'` garantizan
    //    "una sola vez" para el ENVÍO consumado (un segundo `enviar` colisiona → 409). NO
    //    protegen, en cambio, dos INSERT concurrentes de `borrador` (quedan fuera del
    //    predicado del índice): una doble pulsación simultánea podría dejar dos borradores
    //    de la terna. Riesgo acotado (acción manual del Gestor; el frontend deshabilita el
    //    botón mientras la mutación está en curso) y auto-corregible (al enviar uno, el otro
    //    ya no podrá enviarse). Endurecerlo (índice parcial sobre `borrador` o lock de fila)
    //    es deuda documentada, no requerido por el caso de uso.
    const creada = await this.deps.comunicaciones.crear({
      tenantId: comando.tenantId,
      reservaId: reserva.idReserva,
      clienteId: reserva.clienteId,
      codigoEmail: 'E1',
      asunto: mensaje.asunto,
      cuerpo: mensaje.cuerpo,
      destinatarioEmail: reserva.cliente.email ?? '',
      estado: 'borrador',
      fechaEnvio: null,
      subtipo: SUBTIPO_SOLICITUD_DATOS,
    });

    // 6. AUDIT_LOG bajo el tenant del JWT.
    await this.deps.auditoria.registrar({
      tenantId: comando.tenantId,
      usuarioId: comando.usuarioId,
      accion: 'crear',
      entidad: 'COMUNICACION',
      entidadId: creada.idComunicacion,
      datosNuevos: {
        motivo: 'solicitud_datos_presupuesto',
        codigoEmail: 'E1',
        subtipo: SUBTIPO_SOLICITUD_DATOS,
        estado: 'borrador',
      },
    });

    return {
      idComunicacion: creada.idComunicacion,
      reservaId: reserva.idReserva,
      clienteId: reserva.clienteId,
      estado: creada.estado,
      codigoEmail: 'E1',
      reutilizado: false,
      fechaEnvio: creada.fechaEnvio,
    };
  }
}

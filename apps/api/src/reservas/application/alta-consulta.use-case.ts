/**
 * Caso de uso de APLICACIÓN: alta de consulta exploratoria sin fecha
 * (US-003 / UC-03).
 *
 * Orquesta la creación del agregado RESERVA en su entrada inicial `consulta`/`2a`
 * (ttl NULL), junto con el CLIENTE (find-or-create idempotente por tenant+email),
 * la COMUNICACION E1 y el registro de AUDIT_LOG, TODO dentro de una ÚNICA unidad
 * de trabajo transaccional (el adaptador abre `$transaction` + `fijarTenant` para
 * el contexto RLS). Si algo falla, no se crea NADA (all-or-nothing).
 *
 * Orden (design.md §4):
 *   0. Validación de forma PREVIA a abrir la transacción (rechazo sin efectos).
 *   1. (dentro de la UoW) find-or-create CLIENTE → crear RESERVA → crear
 *      COMUNICACION E1 en estado NO final (`borrador`, sin `fecha_envio`) →
 *      registrar AUDIT_LOG. La fila E1 nace SIEMPRE en `borrador` para preservar la
 *      atomicidad US-003 (all-or-nothing con la reserva) sin acoplar el resultado
 *      del proveedor —que aún no se conoce— a la transacción.
 *   2. (POST-COMMIT) si NO hay comentarios (auto-envío), DELEGAR el envío en el motor
 *      `DespacharEmailService.finalizarEnvio` (decisión 6 del Gate 1): este envía y
 *      PROMUEVE la fila a `enviado`+`fecha_envio` o, ante fallo del proveedor, a
 *      `fallido` + AUDIT_LOG, SIN reintento y SIN propagar excepción (el alta ya está
 *      commiteada: un fallo de email NO debe tumbar el 201). Con comentarios, la fila
 *      queda en `borrador` y no se envía. El envío NUNCA ocurre dentro de la
 *      transacción ni si esta falla.
 *
 * Hexagonal: depende solo de PUERTOS (interfaces) inyectados; no importa Prisma ni
 * `@nestjs/*`. La regla de entrada inicial proviene del dominio puro
 * (`maquina-estados`). El camino de fallo de email vive centralizado en el motor.
 */
import type { AuditLogPort } from '../../shared/audit/audit-log.port';
import type { ClockPort } from '../domain/bloquear-fecha.service';
import { entradaInicialConsultaExploratoria } from '../domain/maquina-estados';

export type { ClockPort };

// ---------------------------------------------------------------------------
// Tipos de dominio del comando/resultado (en español, snake-free / camelCase)
// ---------------------------------------------------------------------------

/** Canales de entrada del lead (alineado con el enum del contrato). */
export type CanalEntrada = 'web' | 'email' | 'whatsapp' | 'instagram' | 'telefono';

/** Tipos de evento (alineado con el enum del contrato). */
export type TipoEvento = 'boda' | 'corporativo' | 'privado' | 'otro';

/** Datos de contacto mínimos del CLIENTE embebidos en el alta. */
export interface AltaConsultaCliente {
  nombre: string;
  apellidos: string;
  email: string;
  telefono: string;
}

/** Comando de entrada del alta de consulta. */
export interface AltaConsultaComando {
  /** Tenant del gestor (del JWT, nunca del body). */
  tenantId: string;
  /** Identificador del gestor que ejecuta el alta (para auditoría). */
  usuarioId: string;
  /** Canal por el que entra el lead. */
  canalEntrada: CanalEntrada;
  /**
   * Comentarios libres del gestor. Su PRESENCIA decide el flujo de E1: ausente
   * (o en blanco) → auto-envío; presente → borrador pendiente de revisión.
   */
  comentarios?: string;
  /** Opcionales del evento (se almacenan; NO se calcula tarifa sin fecha). */
  tipoEvento?: TipoEvento;
  duracionHoras?: number;
  numAdultosNinosMayores4?: number;
  numNinosMenores4?: number;
  notas?: string;
  /** Datos del cliente del lead. */
  cliente: AltaConsultaCliente;
}

/** Proyección del CLIENTE relevante para el alta. */
export interface ClienteParaAlta {
  idCliente: string;
  tenantId: string;
  nombre: string;
  apellidos: string;
  email: string;
  telefono: string;
}

/** Proyección de la RESERVA creada en la entrada inicial. */
export interface ReservaParaAlta {
  idReserva: string;
  tenantId: string;
  clienteId: string;
  codigo: string;
  estado: 'consulta';
  subEstado: '2a';
  ttlExpiracion: null;
  canalEntrada: CanalEntrada;
}

/** Proyección de la COMUNICACION E1 creada. */
export interface ComunicacionParaAlta {
  idComunicacion: string;
  tenantId: string;
  reservaId: string;
  clienteId: string;
  codigoEmail: 'E1';
  /**
   * Estado OBSERVABLE final de la fila: nace `borrador` en la transacción y, tras el
   * envío post-commit, queda `enviado` (éxito) o `fallido` (proveedor caído). Con
   * comentarios permanece `borrador`.
   */
  estado: 'enviado' | 'borrador' | 'fallido';
  destinatarioEmail: string;
  fechaEnvio: Date | null;
}

/** Resultado del alta. */
export interface AltaConsultaResultado {
  reserva: ReservaParaAlta;
  cliente: ClienteParaAlta;
  comunicacion: ComunicacionParaAlta;
  /** `true` si se reutilizó un CLIENTE existente (no se creó uno nuevo). */
  clienteReutilizado: boolean;
  /**
   * Errores de validación. En un alta exitosa es SIEMPRE vacío; las violaciones
   * de forma se rechazan antes de la transacción lanzando
   * `AltaConsultaValidacionError`. Se expone para uniformar el tipo de retorno
   * con el del error de validación al inspeccionarlo.
   */
  errores: ReadonlyArray<ErrorCampo>;
}

// ---------------------------------------------------------------------------
// Puertos de repositorio (implementados en infraestructura, dentro de la UoW)
// ---------------------------------------------------------------------------

/** Parámetros de búsqueda idempotente de CLIENTE por tenant + email. */
export interface BuscarClienteParams {
  tenantId: string;
  email: string;
}

/** Parámetros de creación de CLIENTE. */
export interface CrearClienteParams {
  tenantId: string;
  nombre: string;
  apellidos: string;
  email: string;
  telefono: string;
}

/** Repositorio de CLIENTE (find-or-create) ligado a la transacción del alta. */
export interface ClienteRepositoryPort {
  buscarPorEmail(params: BuscarClienteParams): Promise<ClienteParaAlta | null>;
  crear(params: CrearClienteParams): Promise<ClienteParaAlta>;
}

/** Parámetros de creación de la RESERVA en la entrada inicial. */
export interface CrearReservaParams {
  tenantId: string;
  clienteId: string;
  estado: 'consulta';
  subEstado: '2a';
  ttlExpiracion: null;
  canalEntrada: CanalEntrada;
  tipoEvento?: TipoEvento;
  duracionHoras?: number;
  numAdultosNinosMayores4?: number;
  numNinosMenores4?: number;
  notas?: string;
}

/** Repositorio de RESERVA ligado a la transacción del alta. */
export interface ReservaRepositoryPort {
  crear(params: CrearReservaParams): Promise<ReservaParaAlta>;
}

/** Parámetros de creación de la COMUNICACION E1. */
export interface CrearComunicacionParams {
  tenantId: string;
  reservaId: string;
  clienteId: string;
  codigoEmail: 'E1';
  estado: 'enviado' | 'borrador';
  asunto: string;
  cuerpo: string;
  destinatarioEmail: string;
  fechaEnvio: Date | null;
}

/** Repositorio de COMUNICACION ligado a la transacción del alta. */
export interface ComunicacionRepositoryPort {
  crear(params: CrearComunicacionParams): Promise<ComunicacionParaAlta>;
}

/** Conjunto de repositorios disponibles dentro de la unidad de trabajo. */
export interface RepositoriosAltaConsulta {
  clientes: ClienteRepositoryPort;
  reservas: ReservaRepositoryPort;
  comunicaciones: ComunicacionRepositoryPort;
  auditoria: AuditLogPort;
}

/**
 * Unidad de trabajo transaccional. El adaptador envuelve `$transaction` +
 * `fijarTenant(tenantId)` (RLS) y expone los repositorios ligados a esa
 * transacción. Si el `trabajo` rechaza, la transacción revierte (rollback total).
 */
export interface UnidadDeTrabajoPort {
  ejecutar(
    tenantId: string,
    trabajo: (repos: RepositoriosAltaConsulta) => Promise<unknown>,
  ): Promise<unknown>;
}

/**
 * Parámetros del envío POST-COMMIT de la COMUNICACION E1 ya creada (en `borrador`)
 * dentro de la transacción del alta. El motor los usa para enviar y promover la fila.
 */
export interface FinalizarEnvioEmailParams {
  tenantId: string;
  reservaId: string;
  idComunicacion: string;
  destinatario: string;
  asunto: string;
  cuerpo: string;
  codigoEmail: 'E1';
}

/** Estado terminal alcanzado tras el intento de envío post-commit. */
export interface FinalizarEnvioEmailResultado {
  estado: 'enviado' | 'fallido';
  fechaEnvio: Date | null;
}

/**
 * Puerto del camino de envío POST-COMMIT. Lo SATISFACE el motor de email
 * (`DespacharEmailService.finalizarEnvio`), que centraliza el try/catch del proveedor
 * (decisión 6 del Gate 1): éxito → `enviado`+`fecha_envio`; fallo → `fallido` +
 * AUDIT_LOG, sin reintento y sin propagar excepción. El alta solo lo invoca tras el
 * commit, jamás dentro de la transacción.
 */
export interface FinalizarEnvioEmailPort {
  finalizarEnvio(
    params: FinalizarEnvioEmailParams,
  ): Promise<FinalizarEnvioEmailResultado>;
}

/** Dependencias del caso de uso (puertos inyectados). */
export interface AltaConsultaDeps {
  unidadDeTrabajo: UnidadDeTrabajoPort;
  finalizarEnvio: FinalizarEnvioEmailPort;
  clock: ClockPort;
}

// ---------------------------------------------------------------------------
// Error de validación (rechazo sin efectos colaterales)
// ---------------------------------------------------------------------------

/** Detalle de un campo que ha fallado la validación. */
export interface ErrorCampo {
  campo: string;
  mensaje: string;
}

/** El alta no supera la validación de forma: se rechaza antes de tocar la BD. */
export class AltaConsultaValidacionError extends Error {
  readonly codigo = 'ALTA_CONSULTA_VALIDACION' as const;
  readonly errores: ReadonlyArray<ErrorCampo>;

  constructor(errores: ReadonlyArray<ErrorCampo>) {
    super('La validación del alta de consulta ha fallado');
    this.name = 'AltaConsultaValidacionError';
    this.errores = errores;
  }
}

// ---------------------------------------------------------------------------
// Reglas/constantes de validación y plantilla E1
// ---------------------------------------------------------------------------

/** RFC 5322 básico: local@dominio.tld, sin espacios (alineado con el contrato). */
const EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

const MAX_NOMBRE = 100;

const CANALES_VALIDOS: ReadonlyArray<CanalEntrada> = [
  'web',
  'email',
  'whatsapp',
  'instagram',
  'telefono',
];

/** Asunto/cuerpo de la respuesta inicial automática E1 (plantilla mínima). */
const ASUNTO_E1 = 'Hemos recibido tu consulta';
const CUERPO_E1 =
  'Gracias por tu interés. Hemos recibido tu consulta y te contactaremos en breve.';

/** ¿Hay comentarios significativos (no vacíos ni en blanco)? */
const tieneComentarios = (comentarios?: string): boolean =>
  (comentarios ?? '').trim().length > 0;

// ---------------------------------------------------------------------------
// Caso de uso
// ---------------------------------------------------------------------------

export class AltaConsultaUseCase {
  constructor(private readonly deps: AltaConsultaDeps) {}

  async ejecutar(comando: AltaConsultaComando): Promise<AltaConsultaResultado> {
    // 0. Validación PREVIA a abrir la transacción: rechazo sin efectos.
    const errores = this.validar(comando);
    if (errores.length > 0) {
      throw new AltaConsultaValidacionError(errores);
    }

    const enviarAutomaticamente = !tieneComentarios(comando.comentarios);
    const entrada = entradaInicialConsultaExploratoria();
    const email = comando.cliente.email.trim();

    // 1. Toda la escritura, dentro de la unidad de trabajo (tx + RLS).
    const resultado = (await this.deps.unidadDeTrabajo.ejecutar(
      comando.tenantId,
      async (repos): Promise<AltaConsultaResultado> => {
        // find-or-create idempotente del CLIENTE por (tenant_id, email).
        const previo = await repos.clientes.buscarPorEmail({
          tenantId: comando.tenantId,
          email,
        });
        const clienteReutilizado = previo !== null;
        const cliente =
          previo ??
          (await repos.clientes.crear({
            tenantId: comando.tenantId,
            nombre: comando.cliente.nombre.trim(),
            apellidos: comando.cliente.apellidos.trim(),
            email,
            telefono: comando.cliente.telefono.trim(),
          }));

        // RESERVA en la entrada inicial consulta/2a (ttl NULL). Sin tarifa ni
        // FECHA_BLOQUEADA (no hay fecha en 2.a).
        const reserva = await repos.reservas.crear({
          tenantId: comando.tenantId,
          clienteId: cliente.idCliente,
          estado: entrada.estado,
          subEstado: entrada.subEstado,
          ttlExpiracion: entrada.ttlExpiracion,
          canalEntrada: comando.canalEntrada,
          ...(comando.tipoEvento !== undefined
            ? { tipoEvento: comando.tipoEvento }
            : {}),
          ...(comando.duracionHoras !== undefined
            ? { duracionHoras: comando.duracionHoras }
            : {}),
          ...(comando.numAdultosNinosMayores4 !== undefined
            ? { numAdultosNinosMayores4: comando.numAdultosNinosMayores4 }
            : {}),
          ...(comando.numNinosMenores4 !== undefined
            ? { numNinosMenores4: comando.numNinosMenores4 }
            : {}),
          ...(comando.notas !== undefined ? { notas: comando.notas } : {}),
        });

        // COMUNICACION E1: nace SIEMPRE en `borrador` (estado NO final, sin
        // `fecha_envio`) dentro de la transacción, preservando la atomicidad US-003.
        // El estado terminal (`enviado`/`fallido`) lo decide el envío post-commit; con
        // comentarios la fila se queda en `borrador` y no se envía.
        const comunicacion = await repos.comunicaciones.crear({
          tenantId: comando.tenantId,
          reservaId: reserva.idReserva,
          clienteId: cliente.idCliente,
          codigoEmail: 'E1',
          estado: 'borrador',
          asunto: ASUNTO_E1,
          cuerpo: CUERPO_E1,
          destinatarioEmail: email,
          fechaEnvio: null,
        });

        // AUDIT_LOG dentro de la misma transacción.
        await repos.auditoria.registrar({
          tenantId: comando.tenantId,
          accion: 'crear',
          entidad: 'RESERVA',
          entidadId: reserva.idReserva,
          usuarioId: comando.usuarioId,
          datosNuevos: {
            idReserva: reserva.idReserva,
            codigo: reserva.codigo,
            estado: reserva.estado,
            subEstado: reserva.subEstado,
            clienteId: cliente.idCliente,
            canalEntrada: reserva.canalEntrada,
          },
        });

        return { reserva, cliente, comunicacion, clienteReutilizado, errores: [] };
      },
    )) as AltaConsultaResultado;

    // 2. Efecto POST-COMMIT: solo si la transacción confirmó y NO hay comentarios
    //    (auto-envío). Se DELEGA el envío en el motor, que centraliza el camino de
    //    éxito/fallo (decisión 6 del Gate 1): promueve la fila a `enviado`/`fallido`
    //    sin propagar excepción (un fallo de email NO debe tumbar el alta ya
    //    commiteada → el alta responde 201 igualmente). Con comentarios, la fila
    //    permanece en `borrador` y no se envía.
    if (!enviarAutomaticamente) {
      return resultado;
    }

    const envio = await this.deps.finalizarEnvio.finalizarEnvio({
      tenantId: comando.tenantId,
      reservaId: resultado.reserva.idReserva,
      idComunicacion: resultado.comunicacion.idComunicacion,
      destinatario: email,
      asunto: ASUNTO_E1,
      cuerpo: CUERPO_E1,
      codigoEmail: 'E1',
    });

    return {
      ...resultado,
      comunicacion: {
        ...resultado.comunicacion,
        estado: envio.estado,
        fechaEnvio: envio.fechaEnvio,
      },
    };
  }

  /** Validación de forma (obligatorios / longitudes / email / canal). */
  private validar(comando: AltaConsultaComando): ErrorCampo[] {
    const errores: ErrorCampo[] = [];
    const cliente = comando.cliente ?? ({} as AltaConsultaCliente);

    const nombre = (cliente.nombre ?? '').trim();
    if (nombre.length === 0) {
      errores.push({ campo: 'nombre', mensaje: 'El nombre es obligatorio' });
    } else if (nombre.length > MAX_NOMBRE) {
      errores.push({
        campo: 'nombre',
        mensaje: `El nombre no puede superar los ${MAX_NOMBRE} caracteres`,
      });
    }

    const apellidos = (cliente.apellidos ?? '').trim();
    if (apellidos.length === 0) {
      errores.push({ campo: 'apellidos', mensaje: 'Los apellidos son obligatorios' });
    } else if (apellidos.length > MAX_NOMBRE) {
      errores.push({
        campo: 'apellidos',
        mensaje: `Los apellidos no pueden superar los ${MAX_NOMBRE} caracteres`,
      });
    }

    const telefono = (cliente.telefono ?? '').trim();
    if (telefono.length === 0) {
      errores.push({ campo: 'telefono', mensaje: 'El teléfono es obligatorio' });
    }

    const email = (cliente.email ?? '').trim();
    if (email.length === 0) {
      errores.push({ campo: 'email', mensaje: 'El email es obligatorio' });
    } else if (!EMAIL_REGEX.test(email)) {
      errores.push({ campo: 'email', mensaje: 'El email no tiene un formato válido' });
    }

    if (!CANALES_VALIDOS.includes(comando.canalEntrada)) {
      errores.push({
        campo: 'canalEntrada',
        mensaje: 'El canal de entrada no está contemplado',
      });
    }

    return errores;
  }
}

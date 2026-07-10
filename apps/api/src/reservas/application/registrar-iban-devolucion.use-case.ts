/**
 * Caso de uso de APLICACIÓN `RegistrarIbanDevolucionUseCase` (US-035 / UC-26 FA-01, UC-27,
 * actor Gestor).
 *
 * Cierra el ciclo de recepción del IBAN iniciado por E5 (US-034): el Gestor registra el IBAN
 * que el cliente le proporcionó, el sistema lo valida (mod-97), lo persiste en
 * `CLIENTE.iban_devolucion` y confirma la recepción con el email **E8**. Orquesta el dominio
 * puro a través de puertos inyectados (hexagonal, hook `no-infra-in-domain`): NO importa
 * Prisma ni `@nestjs/*`.
 *
 * Algoritmo (design.md §D-1/§D-2/§D-4):
 *   0. Cargar la RESERVA bajo RLS del tenant del JWT (`cargarReserva`). `null` → 404
 *      (`ReservaNoEncontradaError`): inexistente o de otro tenant.
 *   1. Guarda de PRECONDICIÓN previa a la tx (FA-04, prioridad sobre FA-01):
 *      - estado != `post_evento` → `EstadoNoPostEventoError` (409), SIN efectos.
 *      - `fianzaEur` == 0 o `null` → `SinFianzaError` (409), SIN efectos.
 *   2. Validación IBAN mod-97 (FA-01) ANTES de la tx: inválido → `IbanInvalidoError` (422)
 *      SIN persistir ni disparar E8.
 *   3. Paso TRANSACCIONAL: `UPDATE CLIENTE.iban_devolucion` (normalizado) + AUDIT_LOG
 *      (`accion='actualizar'`, `entidad='CLIENTE'`, datos_anteriores/datos_nuevos). Commit.
 *   4. Paso POST-COMMIT (best-effort): dispara E8 al CLIENTE. Un fallo del proveedor deja
 *      `resultado='fallido'` SIN revertir el IBAN (FA-03) y produce el `avisoEmail`.
 */
import { validarIban } from '../../comunicaciones/domain/validar-iban';
import type { AuditLogPort } from '../../shared/audit/audit-log.port';

// ---------------------------------------------------------------------------
// Mensaje canónico del aviso de FA-03 (E8 fallido, IBAN sí guardado).
// ---------------------------------------------------------------------------

/** Mensaje que la UI muestra cuando el IBAN se guardó pero E8 no pudo enviarse (FA-03). */
export const MENSAJE_E8_FALLIDO =
  'IBAN guardado, pero E8 no pudo enviarse. Puedes reenviarlo desde la ficha.' as const;

// ---------------------------------------------------------------------------
// Tipos del dominio de la aplicación
// ---------------------------------------------------------------------------

/** Estado de la RESERVA (valor de dominio; espejo del enum Prisma). */
export type EstadoReservaIbanDevolucion =
  | 'consulta'
  | 'pre_reserva'
  | 'reserva_confirmada'
  | 'evento_en_curso'
  | 'post_evento'
  | 'reserva_completada'
  | 'reserva_cancelada';

/**
 * Proyección mínima de la RESERVA que el registro del IBAN necesita (leída bajo RLS del
 * tenant del JWT). `fianzaEur` viaja como STRING (Decimal(10,2), sin coma flotante) o `null`.
 * `ibanDevolucionActual` es el valor PREVIO del cliente (para el AUDIT_LOG de la corrección).
 */
export interface ReservaIbanDevolucion {
  idReserva: string;
  tenantId: string;
  clienteId: string;
  estado: EstadoReservaIbanDevolucion;
  fianzaEur: string | null;
  clienteEmail: string | null;
  ibanDevolucionActual: string | null;
}

/** Comando de entrada: identidad de la RESERVA + IBAN + actor (tenant/usuario del JWT). */
export interface RegistrarIbanDevolucionComando {
  /** Tenant del JWT (nunca del path/body): contexto RLS de toda la operación. */
  tenantId: string;
  /** Gestor autenticado (JWT): origen Usuario del AUDIT_LOG. */
  usuarioId: string;
  /** RESERVA sobre la que se contextualiza la acción (path). */
  reservaId: string;
  /** IBAN crudo proporcionado por el cliente (se valida y normaliza en dominio). */
  iban: string;
}

/** Resultado del disparo de E8 (post-commit, best-effort). */
export interface ResultadoDispararE8 {
  resultado: 'enviado' | 'fallido';
  comunicacionId: string | null;
}

/** Aviso de FA-03: el IBAN se guardó pero E8 no pudo enviarse. */
export interface AvisoEmailE8Fallido {
  codigo: 'e8_fallido';
  mensaje: string;
  comunicacionId: string | null;
}

/**
 * Resultado del caso de uso (alimenta `RegistrarIbanDevolucionResponse`). `iban` es el valor
 * normalizado persistido; `avisoEmail` es `null` cuando E8 se envió, o el aviso de FA-03.
 */
export interface RegistrarIbanDevolucionResultado {
  iban: string;
  avisoEmail: AvisoEmailE8Fallido | null;
}

// ---------------------------------------------------------------------------
// Puertos (interfaces) — implementados en infraestructura (adaptadores Prisma)
// ---------------------------------------------------------------------------

/** Parámetros de la actualización del IBAN del cliente (bajo RLS del tenant). */
export interface ActualizarIbanDevolucionParams {
  clienteId: string;
  tenantId: string;
  ibanDevolucion: string;
}

/** Resultado de la actualización: filas afectadas (`1` == se aplicó). */
export interface ActualizarIbanDevolucionResultado {
  filasAfectadas: number;
}

/** Registro de auditoría de la actualización del IBAN (origen Usuario, entidad CLIENTE). */
export interface RegistroAuditoriaIbanDevolucion {
  tenantId: string;
  usuarioId?: string;
  accion: 'actualizar';
  entidad: 'CLIENTE';
  entidadId: string;
  datosAnteriores?: Record<string, unknown>;
  datosNuevos?: Record<string, unknown>;
}

/**
 * Repositorios tx-bound disponibles DENTRO de la unidad de trabajo de la escritura del IBAN.
 * El adaptador real (Prisma) los liga a la MISMA transacción bajo el contexto RLS del tenant.
 */
export interface RepositoriosIbanDevolucion {
  clientes: {
    /**
     * `UPDATE cliente SET iban_devolucion=? WHERE id=? AND tenant=?` bajo RLS. Devuelve las
     * filas afectadas (`1` == se aplicó; `0` == cliente no visible/no existe).
     */
    actualizarIbanDevolucion(
      params: ActualizarIbanDevolucionParams,
    ): Promise<ActualizarIbanDevolucionResultado>;
  };
  auditoria: AuditLogPort<RegistroAuditoriaIbanDevolucion>;
}

/**
 * Unidad de trabajo de la escritura del IBAN: abre UNA transacción bajo el contexto RLS del
 * tenant y ejecuta `trabajo` con los repos ligados a esa transacción (all-or-nothing).
 */
export interface UnidadDeTrabajoIbanDevolucionPort {
  ejecutar(
    tenantId: string,
    trabajo: (repos: RepositoriosIbanDevolucion) => Promise<unknown>,
  ): Promise<unknown>;
}

/**
 * Puerto de disparo de E8 (POST-COMMIT, best-effort): mapea el motor de email de
 * `comunicaciones` (US-045). Crea una NUEVA `COMUNICACION` (`codigoEmail='E8'`) —excepción
 * auditada a la idempotencia (D-3A)— y la promueve a `enviado`/`fallido`; nunca revierte el
 * IBAN. La excepción a la idempotencia vive en el adaptador/motor, no aquí.
 */
export interface DispararE8Port {
  disparar(params: {
    tenantId: string;
    reservaId: string;
    clienteId: string;
  }): Promise<ResultadoDispararE8>;
}

/** Dependencias del caso de uso (puertos inyectados, hexagonal). */
export interface RegistrarIbanDevolucionDeps {
  unidadDeTrabajo: UnidadDeTrabajoIbanDevolucionPort;
  cargarReserva(
    comando: RegistrarIbanDevolucionComando,
  ): Promise<ReservaIbanDevolucion | null>;
  dispararE8: DispararE8Port;
}

// ---------------------------------------------------------------------------
// Errores de dominio de la aplicación
// ---------------------------------------------------------------------------

/** RESERVA inexistente o de otro tenant (invisible bajo RLS) → 404. */
export class ReservaNoEncontradaError extends Error {
  readonly codigo = 'RESERVA_NO_ENCONTRADA' as const;

  constructor(reservaId: string) {
    super(`La reserva ${reservaId} no existe o no es accesible para el tenant`);
    this.name = 'ReservaNoEncontradaError';
  }
}

/** El IBAN no supera la validación mod-97 (FA-01) → 422. */
export class IbanInvalidoError extends Error {
  readonly codigo = 'iban_invalido' as const;

  constructor() {
    super('El IBAN proporcionado no es válido (checksum módulo 97)');
    this.name = 'IbanInvalidoError';
  }
}

/** La RESERVA no está en `post_evento` (FA-04) → 409 `code: estado_no_post_evento`. */
export class EstadoNoPostEventoError extends Error {
  readonly codigo = 'estado_no_post_evento' as const;

  constructor() {
    super(
      'La reserva no está en post_evento: no se puede registrar el IBAN de devolución',
    );
    this.name = 'EstadoNoPostEventoError';
  }
}

/** La RESERVA no tiene fianza que devolver (`fianzaEur <= 0` o `null`, FA-04) → 409 `code: sin_fianza`. */
export class SinFianzaError extends Error {
  readonly codigo = 'sin_fianza' as const;

  constructor() {
    super('La reserva no tiene fianza cobrada: no hay nada que devolver');
    this.name = 'SinFianzaError';
  }
}

// ---------------------------------------------------------------------------
// Caso de uso
// ---------------------------------------------------------------------------

export class RegistrarIbanDevolucionUseCase {
  constructor(private readonly deps: RegistrarIbanDevolucionDeps) {}

  async ejecutar(
    comando: RegistrarIbanDevolucionComando,
  ): Promise<RegistrarIbanDevolucionResultado> {
    // 0. Cargar la RESERVA bajo RLS del tenant del JWT. `null` → 404 (inexistente / otro tenant).
    const reserva = await this.deps.cargarReserva(comando);
    if (reserva === null) {
      throw new ReservaNoEncontradaError(comando.reservaId);
    }

    // 1. Guarda de PRECONDICIÓN (FA-04) previa a TODO efecto y a la validación de IBAN
    //    (el conflicto de precondición tiene prioridad sobre la validación, D-5).
    if (reserva.estado !== 'post_evento') {
      throw new EstadoNoPostEventoError();
    }
    if (!this.hayFianza(reserva.fianzaEur)) {
      throw new SinFianzaError();
    }

    // 2. Validación IBAN mod-97 (FA-01) ANTES de abrir la transacción: inválido → 422 SIN
    //    persistir, sin abrir tx, sin disparar E8.
    const validacion = validarIban(comando.iban);
    if (!validacion.valido) {
      throw new IbanInvalidoError();
    }
    const ibanNormalizado = validacion.ibanNormalizado;

    // 3. Paso TRANSACCIONAL: UPDATE CLIENTE.iban_devolucion + AUDIT_LOG (entidad CLIENTE).
    await this.deps.unidadDeTrabajo.ejecutar(comando.tenantId, async (repos) => {
      await repos.clientes.actualizarIbanDevolucion({
        clienteId: reserva.clienteId,
        tenantId: comando.tenantId,
        ibanDevolucion: ibanNormalizado,
      });

      // AUDIT_LOG del cambio de IBAN — origen Usuario (usuarioId poblado). Payload snake_case
      // con el valor PREVIO (o null) y el nuevo (D-1).
      await repos.auditoria.registrar({
        tenantId: comando.tenantId,
        usuarioId: comando.usuarioId,
        accion: 'actualizar',
        entidad: 'CLIENTE',
        entidadId: reserva.clienteId,
        datosAnteriores: { iban_devolucion: reserva.ibanDevolucionActual },
        datosNuevos: { iban_devolucion: ibanNormalizado },
      });
    });

    // 4. Paso POST-COMMIT (best-effort): dispara E8 al CLIENTE. Su fallo NO revierte el IBAN
    //    ya guardado (D-2/FA-03); produce el `avisoEmail`.
    const avisoEmail = await this.dispararE8(comando, reserva);

    return { iban: ibanNormalizado, avisoEmail };
  }

  /** `true` si la fianza es un importe positivo (`fianzaEur > 0`); `false` si `0` o `null`. */
  private hayFianza(fianzaEur: string | null): boolean {
    if (fianzaEur === null) {
      return false;
    }
    const valor = Number(fianzaEur);
    return Number.isFinite(valor) && valor > 0;
  }

  /**
   * Dispara E8 tras el commit. Best-effort: un `resultado='fallido'` (o una excepción del
   * puerto, p. ej. proveedor caído) NO revierte el IBAN; se degrada al `avisoEmail` de FA-03.
   */
  private async dispararE8(
    comando: RegistrarIbanDevolucionComando,
    reserva: ReservaIbanDevolucion,
  ): Promise<AvisoEmailE8Fallido | null> {
    try {
      const resultado = await this.deps.dispararE8.disparar({
        tenantId: comando.tenantId,
        reservaId: reserva.idReserva,
        clienteId: reserva.clienteId,
      });
      if (resultado.resultado === 'enviado') {
        return null;
      }
      return {
        codigo: 'e8_fallido',
        mensaje: MENSAJE_E8_FALLIDO,
        comunicacionId: resultado.comunicacionId,
      };
    } catch {
      // El envío falló tras el commit: el IBAN se mantiene, se avisa sin comunicacionId.
      return {
        codigo: 'e8_fallido',
        mensaje: MENSAJE_E8_FALLIDO,
        comunicacionId: null,
      };
    }
  }
}

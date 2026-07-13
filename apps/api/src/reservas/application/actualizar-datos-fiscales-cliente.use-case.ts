/**
 * Caso de uso de APLICACIÓN `ActualizarDatosFiscalesClienteUseCase`
 * (US-014 #5, Parte B / UC-14, actor Gestor).
 *
 * Completa los datos fiscales del CLIENTE asociado a una RESERVA para poder resolver la
 * validación `DATOS_FISCALES_INCOMPLETOS` (US-014 §FA-01) sin abandonar el flujo de presupuesto.
 * Orquesta el dominio puro a través de puertos inyectados (hexagonal, hook `no-infra-in-domain`):
 * NO importa Prisma ni `@nestjs/*`.
 *
 * Decisiones del Gate (design.md): D-1 (endpoint dedicado contextualizado en la RESERVA, patrón
 * `iban-devolucion`), D-2 (PATCH parcial: solo se actualizan los campos PRESENTES; los ausentes NO
 * se tocan, no se sobrescriben a null), D-3 (alcance estricto CLIENTE: NO se muta la RESERVA
 * —estado/subEstado/ttl/campos de evento— ni FECHA_BLOQUEADA), D-4 (módulo `reservas`; hexagonal:
 * controller → use-case → puerto de escritura (domain) → adaptador Prisma (infra)).
 *
 * Algoritmo:
 *   0. Cargar la RESERVA bajo RLS del tenant del JWT (`cargarReserva`). `null` → 404
 *      (`ReservaNoEncontradaError`): inexistente o de otro tenant.
 *   1. Paso TRANSACCIONAL: UPDATE PARCIAL de los campos fiscales PRESENTES del CLIENTE + AUDIT_LOG
 *      (`accion='actualizar'`, `entidad='CLIENTE'`, datos_anteriores/datos_nuevos snake_case solo
 *      de los campos cambiados). Commit.
 *   2. Devuelve el estado resultante de los 5 campos fiscales (presentes actualizados; ausentes con
 *      su valor previo del CLIENTE).
 */
import type { AuditLogPort } from '../../shared/audit/audit-log.port';

// ---------------------------------------------------------------------------
// Tipos del dominio de la aplicación
// ---------------------------------------------------------------------------

/** Los cinco datos fiscales del CLIENTE (camelCase, alineados con el schema `Cliente`). */
export interface DatosFiscalesCliente {
  dniNif: string;
  direccion: string;
  codigoPostal: string;
  poblacion: string;
  provincia: string;
}

/**
 * Subconjunto PARCIAL de los datos fiscales: solo los campos PRESENTES viajan (PATCH parcial, D-2).
 * Cada campo es opcional; los ausentes no se tocan.
 */
export type DatosFiscalesClienteParcial = Partial<DatosFiscalesCliente>;

/** Comando de entrada: identidad de la RESERVA + datos parciales + actor (tenant/usuario del JWT). */
export interface ActualizarDatosFiscalesClienteComando {
  /** Tenant del JWT (nunca del path/body): contexto RLS de toda la operación. */
  tenantId: string;
  /** Gestor autenticado (JWT): origen Usuario del AUDIT_LOG. */
  usuarioId: string;
  /** RESERVA sobre la que se contextualiza la acción (path). */
  reservaId: string;
  /** Datos fiscales a actualizar (parcial: solo los presentes se persisten). */
  datos: DatosFiscalesClienteParcial;
}

/**
 * Resultado del caso de uso (alimenta `ActualizarDatosFiscalesClienteResponse`): estado resultante
 * de los cinco campos fiscales del CLIENTE. Cualquiera puede ser `null` si sigue sin informar.
 */
export interface ActualizarDatosFiscalesClienteResultado {
  dniNif: string | null;
  direccion: string | null;
  codigoPostal: string | null;
  poblacion: string | null;
  provincia: string | null;
}

/**
 * Proyección mínima de la RESERVA que la actualización necesita (leída bajo RLS del tenant del JWT).
 * `datosFiscalesActuales` son los valores PREVIOS del cliente (para el AUDIT_LOG y para devolver los
 * campos ausentes con su valor previo).
 */
export interface ReservaDatosFiscales {
  idReserva: string;
  tenantId: string;
  clienteId: string;
  datosFiscalesActuales: DatosFiscalesCliente;
}

// ---------------------------------------------------------------------------
// Puertos (interfaces) — implementados en infraestructura (adaptadores Prisma)
// ---------------------------------------------------------------------------

/** Parámetros de la actualización parcial de los datos fiscales del cliente (bajo RLS del tenant). */
export interface ActualizarDatosFiscalesParams {
  clienteId: string;
  tenantId: string;
  /** Solo las columnas fiscales PRESENTES en el comando (PATCH parcial, D-2). */
  datos: DatosFiscalesClienteParcial;
}

/** Resultado de la actualización: filas afectadas (`1` == se aplicó). */
export interface ActualizarDatosFiscalesResultado {
  filasAfectadas: number;
}

/** Registro de auditoría de la actualización de datos fiscales (origen Usuario, entidad CLIENTE). */
export interface RegistroAuditoriaDatosFiscales {
  tenantId: string;
  usuarioId?: string;
  accion: 'actualizar';
  entidad: 'CLIENTE';
  entidadId: string;
  datosAnteriores?: Record<string, unknown>;
  datosNuevos?: Record<string, unknown>;
}

/**
 * Repositorios tx-bound disponibles DENTRO de la unidad de trabajo de la escritura de datos
 * fiscales. El adaptador real (Prisma) los liga a la MISMA transacción bajo el contexto RLS del
 * tenant.
 */
export interface RepositoriosDatosFiscales {
  clientes: {
    /**
     * `UPDATE cliente SET <columnas fiscales presentes>=? WHERE id=? AND tenant=?` bajo RLS.
     * Devuelve las filas afectadas (`1` == se aplicó; `0` == cliente no visible/no existe).
     */
    actualizarDatosFiscales(
      params: ActualizarDatosFiscalesParams,
    ): Promise<ActualizarDatosFiscalesResultado>;
  };
  auditoria: AuditLogPort<RegistroAuditoriaDatosFiscales>;
}

/**
 * Unidad de trabajo de la escritura de datos fiscales: abre UNA transacción bajo el contexto RLS
 * del tenant y ejecuta `trabajo` con los repos ligados a esa transacción (all-or-nothing).
 */
export interface UnidadDeTrabajoDatosFiscalesPort {
  ejecutar(
    tenantId: string,
    trabajo: (repos: RepositoriosDatosFiscales) => Promise<unknown>,
  ): Promise<unknown>;
}

/** Dependencias del caso de uso (puertos inyectados, hexagonal). */
export interface ActualizarDatosFiscalesClienteDeps {
  unidadDeTrabajo: UnidadDeTrabajoDatosFiscalesPort;
  cargarReserva(
    comando: ActualizarDatosFiscalesClienteComando,
  ): Promise<ReservaDatosFiscales | null>;
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

// ---------------------------------------------------------------------------
// Metadatos de los campos fiscales: orden y mapeo camelCase → snake_case (AUDIT_LOG).
// ---------------------------------------------------------------------------

/** Claves fiscales tipadas (evita `if/else` disperso al recorrer los campos presentes). */
const CLAVES_FISCALES = [
  'dniNif',
  'direccion',
  'codigoPostal',
  'poblacion',
  'provincia',
] as const;

/** Mapeo camelCase → snake_case para el payload de AUDIT_LOG (columnas de la tabla CLIENTE). */
const A_SNAKE_CASE: Record<keyof DatosFiscalesCliente, string> = {
  dniNif: 'dni_nif',
  direccion: 'direccion',
  codigoPostal: 'codigo_postal',
  poblacion: 'poblacion',
  provincia: 'provincia',
};

// ---------------------------------------------------------------------------
// Caso de uso
// ---------------------------------------------------------------------------

export class ActualizarDatosFiscalesClienteUseCase {
  constructor(private readonly deps: ActualizarDatosFiscalesClienteDeps) {}

  async ejecutar(
    comando: ActualizarDatosFiscalesClienteComando,
  ): Promise<ActualizarDatosFiscalesClienteResultado> {
    // 0. Cargar la RESERVA bajo RLS del tenant del JWT. `null` → 404 (inexistente / otro tenant).
    const reserva = await this.deps.cargarReserva(comando);
    if (reserva === null) {
      throw new ReservaNoEncontradaError(comando.reservaId);
    }

    // Solo los campos PRESENTES en el comando viajan al puerto (D-2): los ausentes NO se tocan.
    const camposPresentes = this.extraerCamposPresentes(comando.datos);
    const previos = reserva.datosFiscalesActuales;

    // 1. Paso TRANSACCIONAL: UPDATE PARCIAL del CLIENTE + AUDIT_LOG (entidad CLIENTE).
    await this.deps.unidadDeTrabajo.ejecutar(comando.tenantId, async (repos) => {
      await repos.clientes.actualizarDatosFiscales({
        clienteId: reserva.clienteId,
        tenantId: comando.tenantId,
        datos: camposPresentes,
      });

      // AUDIT_LOG del cambio — origen Usuario (usuarioId poblado). Payload snake_case SOLO con los
      // campos cambiados: valor PREVIO → nuevo (D-1/D-2).
      await repos.auditoria.registrar({
        tenantId: comando.tenantId,
        usuarioId: comando.usuarioId,
        accion: 'actualizar',
        entidad: 'CLIENTE',
        entidadId: reserva.clienteId,
        datosAnteriores: this.aPayloadSnake(camposPresentes, previos),
        datosNuevos: this.aPayloadSnake(camposPresentes, camposPresentes),
      });
    });

    // 2. Estado resultante: campos presentes actualizados; ausentes con su valor PREVIO del CLIENTE.
    return {
      dniNif: camposPresentes.dniNif ?? previos.dniNif,
      direccion: camposPresentes.direccion ?? previos.direccion,
      codigoPostal: camposPresentes.codigoPostal ?? previos.codigoPostal,
      poblacion: camposPresentes.poblacion ?? previos.poblacion,
      provincia: camposPresentes.provincia ?? previos.provincia,
    };
  }

  /**
   * Devuelve un objeto con SOLO las claves fiscales presentes en `datos` (definidas). Los campos
   * ausentes no se incluyen (no viajan al puerto ni se ponen a null).
   */
  private extraerCamposPresentes(
    datos: DatosFiscalesClienteParcial,
  ): DatosFiscalesClienteParcial {
    const presentes: DatosFiscalesClienteParcial = {};
    for (const clave of CLAVES_FISCALES) {
      const valor = datos[clave];
      if (valor !== undefined) {
        presentes[clave] = valor;
      }
    }
    return presentes;
  }

  /**
   * Construye el payload snake_case de AUDIT_LOG tomando SOLO las claves presentes en `presentes`,
   * con el valor de `fuente` (usa `previos` para `datosAnteriores` y los propios campos nuevos
   * para `datosNuevos`).
   */
  private aPayloadSnake(
    presentes: DatosFiscalesClienteParcial,
    fuente: DatosFiscalesClienteParcial,
  ): Record<string, unknown> {
    const payload: Record<string, unknown> = {};
    for (const clave of CLAVES_FISCALES) {
      if (presentes[clave] !== undefined) {
        payload[A_SNAKE_CASE[clave]] = fuente[clave] ?? null;
      }
    }
    return payload;
  }
}

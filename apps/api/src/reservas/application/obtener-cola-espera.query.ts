/**
 * QUERY de APLICACIÓN: leer la cola de espera de la fecha de una RESERVA bloqueante
 * (`GET /reservas/{id}/cola` → `ColaEsperaResponse`, US-017 / UC-11).
 *
 * SOLO LECTURA (CQRS-lite, clon de `ObtenerReservaUseCase`): no abre transacción de
 * escritura, no toca la máquina de estados, no registra AUDIT_LOG. Solo proyecta el
 * read model (bloqueante + cola FIFO). El aislamiento multi-tenant lo garantiza el
 * adaptador (RLS / filtrado por `tenant_id`): una RESERVA de otro tenant es INVISIBLE
 * (→ `null` → 404).
 *
 * Hexagonal: depende SOLO del puerto inyectado (`ColaEsperaQueryPort`); no importa
 * Prisma ni `@nestjs/*`. La forma del read model (`ColaEsperaLectura`) vive en el
 * dominio (`cola-espera-lectura.ts`) y se re-exporta para el consumidor del query.
 *
 * FA-04 (design.md §D-3): cuando la reserva EXISTE en el tenant pero NO bloquea
 * ninguna fecha activa, el puerto devuelve un read model con `estaBloqueada: false`
 * (NO `null`), y el caso de uso lo propaga tal cual → 200. El 404
 * (`ColaEsperaNoEncontradaError`) se reserva EXCLUSIVAMENTE para reserva inexistente
 * o de otro tenant (el puerto devuelve `null`).
 */
import type { ColaEsperaLectura } from '../domain/cola-espera-lectura';

export type {
  ColaEsperaLectura,
  BloqueanteLectura,
  ColaItemLectura,
} from '../domain/cola-espera-lectura';

/** Puerto de lectura de la cola de espera (implementado por un adaptador Prisma). */
export interface ColaEsperaQueryPort {
  /**
   * Lee la cola de la reserva `{reservaId}` bajo el contexto RLS del tenant.
   * - `null` si la reserva no existe o pertenece a otro tenant (cross-tenant → 404).
   * - `{ estaBloqueada: false, bloqueante: null, cola: [] }` si existe pero no
   *   bloquea ninguna fecha activa (FA-04, 200 "fecha disponible").
   */
  buscarCola(params: {
    tenantId: string;
    reservaId: string;
  }): Promise<ColaEsperaLectura | null>;
}

/** La RESERVA no existe para el tenant (RLS): cross-tenant es invisible → 404. */
export class ColaEsperaNoEncontradaError extends Error {
  readonly codigo = 'RESERVA_NO_ENCONTRADA' as const;
  readonly reservaId: string;

  constructor(reservaId: string) {
    super('La reserva no existe para el tenant');
    this.name = 'ColaEsperaNoEncontradaError';
    this.reservaId = reservaId;
  }
}

/** Dependencias del query (puerto inyectado). */
export interface ObtenerColaEsperaDeps {
  colaEspera: ColaEsperaQueryPort;
}

/** Comando de lectura: tenant del JWT + id de la RESERVA bloqueante del path. */
export interface ObtenerColaEsperaComando {
  tenantId: string;
  reservaId: string;
}

export class ObtenerColaEsperaUseCase {
  constructor(private readonly deps: ObtenerColaEsperaDeps) {}

  async ejecutar(
    comando: ObtenerColaEsperaComando,
  ): Promise<ColaEsperaLectura> {
    const lectura = await this.deps.colaEspera.buscarCola({
      tenantId: comando.tenantId,
      reservaId: comando.reservaId,
    });
    if (lectura === null) {
      throw new ColaEsperaNoEncontradaError(comando.reservaId);
    }
    return lectura;
  }
}

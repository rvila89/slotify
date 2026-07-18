/**
 * Caso de uso ORQUESTADOR `DescartarReservaOrquestadorUseCase` (change
 * `presupuesto-prereserva-cta-descarte-y-e2`, workstream B / D-2).
 *
 * D-2 (CERRADA = REUTILIZAR `POST /reservas/{id}/descartar`): el MISMO endpoint de US-013
 * despacha por el ESTADO ACTUAL de la RESERVA. El despacho por fase vive AQUÍ (NO en `if/else`
 * de negocio en el controller): dado `reserva.estado`, enruta al caso de uso correcto:
 *   - `consulta` (+sub-estados) → `DescartarConsultaPorClienteUseCase` (US-013, → 2z), intacto.
 *   - `pre_reserva` → `DescartarPreReservaUseCase` (nuevo, → reserva_cancelada).
 *   - otro estado (`reserva_confirmada` y posteriores, terminales) → 422 origen inválido.
 *
 * Hexagonal (hook `no-infra-in-domain`): NO importa Prisma ni `@nestjs/*`. Lee el estado por el
 * puerto `EstadoReservaLectorPort` (bajo RLS) y delega en el caso de uso hijo, propagando su
 * desenlace o su error de dominio sin atraparlo (cada hijo conserva su UoW atómica y sus errores
 * DISJUNTOS; el controller los mapea a HTTP). El orquestador solo ELIGE el caso de uso por estado.
 */
import type { EstadoReserva, SubEstadoConsulta } from '../domain/maquina-estados';
import type {
  DescartarConsultaComando,
  DescartarConsultaPorClienteUseCase,
  ResultadoDescarteConsulta,
} from './descartar-consulta-por-cliente.use-case';
import {
  DescartePreReservaOrigenInvalidoError,
  ReservaNoEncontradaError,
  type DescartarPreReservaComando,
  type DescartarPreReservaUseCase,
  type ResultadoDescartePreReserva,
} from './descartar-prereserva.use-case';

// ---------------------------------------------------------------------------
// Comando de entrada + desenlace (unión de las dos ramas)
// ---------------------------------------------------------------------------

/**
 * Comando de entrada del descarte (endpoint reutilizado `POST /reservas/{id}/descartar`).
 * `tenantId`/`usuarioId` derivan SIEMPRE del JWT; `motivo` es OPCIONAL. El orquestador lo
 * propaga TAL CUAL a la rama que corresponda por fase.
 */
export interface DescartarReservaComando {
  tenantId: string;
  usuarioId: string;
  reservaId: string;
  motivo?: string;
}

/** Desenlace: el de la rama que se haya ejecutado (consulta → 2z, o pre-reserva → cancelada). */
export type ResultadoDescartarReserva =
  | ResultadoDescarteConsulta
  | ResultadoDescartePreReserva;

// ---------------------------------------------------------------------------
// Puerto de lectura del estado actual de la RESERVA (bajo RLS)
// ---------------------------------------------------------------------------

/** Lectura mínima del estado actual de la RESERVA para elegir la rama de descarte. */
export interface EstadoReservaLeido {
  estado: EstadoReserva;
  subEstado: SubEstadoConsulta | null;
}

/**
 * Puerto de lectura del `(estado, subEstado)` actual de una RESERVA bajo el contexto RLS del
 * tenant. Devuelve `null` cuando la RESERVA es invisible bajo RLS (inexistente o de otro
 * tenant): el orquestador lo traduce a `ReservaNoEncontradaError` (404).
 */
export interface EstadoReservaLectorPort {
  leerEstado(params: {
    tenantId: string;
    reservaId: string;
  }): Promise<EstadoReservaLeido | null>;
}

/** Dependencias del orquestador (puertos + casos de uso hijos inyectados, hexagonal). */
export interface DescartarReservaOrquestadorDeps {
  lector: EstadoReservaLectorPort;
  descartarConsulta: DescartarConsultaPorClienteUseCase;
  descartarPreReserva: DescartarPreReservaUseCase;
}

// ---------------------------------------------------------------------------
// Caso de uso orquestador
// ---------------------------------------------------------------------------

export class DescartarReservaOrquestadorUseCase {
  constructor(private readonly deps: DescartarReservaOrquestadorDeps) {}

  /**
   * Lee el estado actual (bajo RLS) y ENRUTA por fase. `consulta` → US-013 (→2z); `pre_reserva`
   * → nueva transición (→reserva_cancelada); cualquier otro estado → 422 origen inválido sin
   * invocar ningún hijo. Propaga sin atrapar los errores de dominio del hijo (el controller los
   * mapea a HTTP). Una RESERVA invisible bajo RLS → 404.
   */
  async ejecutar(
    comando: DescartarReservaComando,
  ): Promise<ResultadoDescartarReserva> {
    const leido = await this.deps.lector.leerEstado({
      tenantId: comando.tenantId,
      reservaId: comando.reservaId,
    });
    if (leido === null) {
      throw new ReservaNoEncontradaError();
    }

    if (leido.estado === 'consulta') {
      const comandoConsulta: DescartarConsultaComando = {
        tenantId: comando.tenantId,
        usuarioId: comando.usuarioId,
        reservaId: comando.reservaId,
        motivo: comando.motivo,
      };
      return this.deps.descartarConsulta.ejecutar(comandoConsulta);
    }

    if (leido.estado === 'pre_reserva') {
      const comandoPreReserva: DescartarPreReservaComando = {
        tenantId: comando.tenantId,
        usuarioId: comando.usuarioId,
        reservaId: comando.reservaId,
        motivo: comando.motivo,
      };
      return this.deps.descartarPreReserva.ejecutar(comandoPreReserva);
    }

    throw new DescartePreReservaOrigenInvalidoError();
  }
}

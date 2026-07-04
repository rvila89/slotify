/**
 * Caso de uso `LeerFichaOperativaUseCase` (US-025 / UC-20).
 *
 * Lee la FICHA_OPERATIVA de una RESERVA SIN mutar ningún estado. Aplica la guarda de
 * acceso por `RESERVA.estado` (§D-3) y filtra por `tenant_id` (RLS): estado anterior
 * a `reserva_confirmada` → `FichaNoDisponibleError` (409); RESERVA inexistente/
 * cross-tenant → `ReservaNoEncontradaError` (404). No abre transacción (solo carga).
 */
import {
  FichaNoDisponibleError,
  ReservaNoEncontradaError,
  permiteAccederFicha,
  type CargarReservaConFichaPort,
  type FichaOperativa,
} from '../domain/ficha-operativa.ports';

export {
  FichaNoDisponibleError,
  ReservaNoEncontradaError,
} from '../domain/ficha-operativa.ports';
export type {
  EstadoReservaFicha,
  FichaOperativa,
  ReservaFichaOperativa,
} from '../domain/ficha-operativa.ports';

/** Comando de lectura: tenant del JWT (RLS), usuario y reserva objetivo. */
export interface LeerFichaOperativaComando {
  tenantId: string;
  usuarioId: string;
  reservaId: string;
}

/** Dependencias inyectadas del caso de uso. */
export interface LeerFichaOperativaDeps {
  cargarReservaConFicha: CargarReservaConFichaPort;
}

export class LeerFichaOperativaUseCase {
  constructor(private readonly deps: LeerFichaOperativaDeps) {}

  async ejecutar(comando: LeerFichaOperativaComando): Promise<FichaOperativa> {
    const { tenantId, reservaId } = comando;
    const reserva = await this.deps.cargarReservaConFicha({ tenantId, reservaId });

    if (reserva === null || reserva === undefined) {
      throw new ReservaNoEncontradaError();
    }
    if (!permiteAccederFicha(reserva.estado) || reserva.ficha === null) {
      throw new FichaNoDisponibleError();
    }
    return reserva.ficha;
  }
}

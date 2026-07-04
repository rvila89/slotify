/**
 * Caso de uso `GuardarFichaOperativaUseCase` (US-025 / UC-20).
 *
 * Guardado PARCIAL de la ficha (§D-5): persiste solo el subconjunto de campos enviado
 * dentro de UNA unidad de trabajo. Efectos según §D-2/§D-4:
 *   - Primer guardado con datos (ficha `pendiente` que queda con ≥1 campo de contenido)
 *     dispara `pendiente → en_curso`. Idempotente: si ya está en `en_curso`/`cerrado`,
 *     no re-transiciona.
 *   - Edición post-cierre (ficha `cerrado`): persiste, reescribe `fecha_cierre = now()`
 *     y NO transiciona (cerrado es estable).
 * Guardas de acceso (§D-3) y aislamiento tenant (RLS) ANTES de abrir la transacción:
 * estado anterior → `FichaNoDisponibleError`; inexistente/cross-tenant →
 * `ReservaNoEncontradaError`. AUDIT_LOG en cada guardado y en la transición.
 */
import {
  FichaNoDisponibleError,
  ReservaNoEncontradaError,
  permiteAccederFicha,
  type CamposFichaOperativa,
  type CargarReservaConFichaPort,
  type ClockPort,
  type FichaOperativa,
  type RepositoriosGuardadoFicha,
  type UnidadDeTrabajoFichaPort as UnidadDeTrabajoGenericaPort,
} from '../domain/ficha-operativa.ports';
import { tieneAlgunDatoDeContenido } from '../domain/maquina-estados-pre-evento';

export {
  FichaNoDisponibleError,
  ReservaNoEncontradaError,
} from '../domain/ficha-operativa.ports';
export type {
  ClockPort,
  EstadoReservaFicha,
  FichaOperativa,
  ReservaFichaOperativa,
} from '../domain/ficha-operativa.ports';

/** Repositorios ligados a la unidad de trabajo del guardado parcial. */
export type RepositoriosFicha = RepositoriosGuardadoFicha;

/** Unidad de trabajo transaccional del guardado parcial. */
export type UnidadDeTrabajoFichaPort = UnidadDeTrabajoGenericaPort<RepositoriosFicha>;

/** Comando de guardado: tenant/usuario del JWT + reserva + subconjunto parcial. */
export interface GuardarFichaOperativaComando {
  tenantId: string;
  usuarioId: string;
  reservaId: string;
  campos: CamposFichaOperativa;
}

/** Dependencias inyectadas del caso de uso. */
export interface GuardarFichaOperativaDeps {
  unidadDeTrabajo: UnidadDeTrabajoFichaPort;
  cargarReservaConFicha: CargarReservaConFichaPort;
  clock: ClockPort;
}

export class GuardarFichaOperativaUseCase {
  constructor(private readonly deps: GuardarFichaOperativaDeps) {}

  async ejecutar(comando: GuardarFichaOperativaComando): Promise<FichaOperativa> {
    const { tenantId, usuarioId, reservaId, campos } = comando;

    // Guarda de acceso + tenant ANTES de abrir la transacción (sin efectos si falla).
    const reserva = await this.deps.cargarReservaConFicha({ tenantId, reservaId });
    if (reserva === null || reserva === undefined) {
      throw new ReservaNoEncontradaError();
    }
    if (!permiteAccederFicha(reserva.estado) || reserva.ficha === null) {
      throw new FichaNoDisponibleError();
    }

    const estadoPrevio = reserva.ficha.preEventoStatus;

    return (await this.deps.unidadDeTrabajo.ejecutar(tenantId, async (repos) => {
      const fichaGuardada = await repos.ficha.guardarCampos(reservaId, campos);

      await repos.auditoria.registrar({
        tenantId,
        usuarioId,
        accion: 'actualizar',
        entidad: 'FICHA_OPERATIVA',
        entidadId: reservaId,
        datosNuevos: { ...campos },
      });

      if (estadoPrevio === 'cerrado') {
        // Edición post-cierre (§D-4): reescribe fecha_cierre, NO reabre el estado.
        const ahora = this.deps.clock.ahora();
        await repos.ficha.tocarFechaCierre(reservaId, ahora);
        return fichaGuardada;
      }

      if (estadoPrevio === 'pendiente' && tieneAlgunDatoDeContenido(fichaGuardada)) {
        // Primer guardado con datos (§D-2): pendiente → en_curso.
        await this.transicionarAEnCurso(repos, comando);
        const conTransicion: FichaOperativa = {
          ...fichaGuardada,
          preEventoStatus: 'en_curso',
        };
        return conTransicion;
      }

      return fichaGuardada;
    })) as FichaOperativa;
  }

  private async transicionarAEnCurso(
    repos: RepositoriosFicha,
    comando: GuardarFichaOperativaComando,
  ): Promise<void> {
    const { tenantId, usuarioId, reservaId } = comando;
    await repos.ficha.transicionarPreEvento(reservaId, 'en_curso');
    await repos.auditoria.registrar({
      tenantId,
      usuarioId,
      accion: 'transicion',
      entidad: 'FICHA_OPERATIVA',
      entidadId: reservaId,
      datosNuevos: { preEventoStatus: 'en_curso' },
    });
  }
}

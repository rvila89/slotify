/**
 * Caso de uso `CerrarFichaOperativaUseCase` (US-025 / UC-20).
 *
 * Cierra la FICHA_OPERATIVA (§D-6): fija `ficha_cerrada = true`, `fecha_cierre = now()`
 * y transiciona `pre_evento_status: en_curso → cerrado` dentro de UNA unidad de
 * trabajo. El cierre NUNCA falla por campos vacíos: calcula `avisosCamposVacios` (los
 * nombres camelCase de los campos de contenido vacíos, string en blanco = vacío) como
 * aviso puramente informativo. Guardas de acceso (§D-3) y aislamiento tenant (RLS)
 * ANTES de abrir la transacción. AUDIT_LOG de la transición.
 */
import {
  FichaNoDisponibleError,
  FichaYaCerradaError,
  ReservaNoEncontradaError,
  permiteAccederFicha,
  type CargarReservaConFichaPort,
  type ClockPort,
  type FichaOperativa,
  type RepositoriosCierreFicha,
  type UnidadDeTrabajoFichaPort as UnidadDeTrabajoGenericaPort,
} from '../domain/ficha-operativa.ports';
import type { ContenidoFicha } from '../domain/maquina-estados-pre-evento';

export {
  FichaNoDisponibleError,
  FichaYaCerradaError,
  ReservaNoEncontradaError,
} from '../domain/ficha-operativa.ports';
export type {
  ClockPort,
  EstadoReservaFicha,
  FichaOperativa,
  ReservaFichaOperativa,
} from '../domain/ficha-operativa.ports';

/** Repositorios ligados a la unidad de trabajo del cierre. */
export type RepositoriosFicha = RepositoriosCierreFicha;

/** Unidad de trabajo transaccional del cierre. */
export type UnidadDeTrabajoFichaPort = UnidadDeTrabajoGenericaPort<RepositoriosFicha>;

/** Comando de cierre: tenant/usuario del JWT + reserva objetivo. */
export interface CerrarFichaOperativaComando {
  tenantId: string;
  usuarioId: string;
  reservaId: string;
}

/** Dependencias inyectadas del caso de uso. */
export interface CerrarFichaOperativaDeps {
  unidadDeTrabajo: UnidadDeTrabajoFichaPort;
  cargarReservaConFicha: CargarReservaConFichaPort;
  clock: ClockPort;
}

/** Respuesta del cierre: la ficha cerrada + aviso informativo de campos vacíos (§D-6). */
export interface CerrarFichaOperativaResultado extends FichaOperativa {
  avisosCamposVacios: string[];
}

/** Campos de contenido, en orden de presentación, para el aviso de vacíos. */
const CAMPOS_CONTENIDO: ReadonlyArray<keyof ContenidoFicha> = [
  'numInvitadosConfirmado',
  'menuSeleccionado',
  'timingDetallado',
  'contactoEventoNombre',
  'contactoEventoTelefono',
  'notasOperativas',
  'briefingEquipo',
];

/** ¿El campo de contenido está vacío? (null; string en blanco/solo espacios = vacío). */
const estaVacio = (valor: number | string | null): boolean => {
  if (valor === null) {
    return true;
  }
  if (typeof valor === 'string') {
    return valor.trim().length === 0;
  }
  return false;
};

/** Lista los nombres camelCase de los campos de contenido vacíos (§D-6). */
const calcularAvisosCamposVacios = (ficha: ContenidoFicha): string[] =>
  CAMPOS_CONTENIDO.filter((campo) => estaVacio(ficha[campo]));

export class CerrarFichaOperativaUseCase {
  constructor(private readonly deps: CerrarFichaOperativaDeps) {}

  async ejecutar(
    comando: CerrarFichaOperativaComando,
  ): Promise<CerrarFichaOperativaResultado> {
    const { tenantId, usuarioId, reservaId } = comando;

    // Guarda de acceso + tenant ANTES de abrir la transacción (sin efectos si falla).
    const reserva = await this.deps.cargarReservaConFicha({ tenantId, reservaId });
    if (reserva === null || reserva === undefined) {
      throw new ReservaNoEncontradaError();
    }
    if (!permiteAccederFicha(reserva.estado) || reserva.ficha === null) {
      throw new FichaNoDisponibleError();
    }

    const avisosCamposVacios = calcularAvisosCamposVacios(reserva.ficha);
    const fichaCierreExistente = reserva.ficha;
    const fechaCierre = this.deps.clock.ahora();

    let fichaCerrada: FichaOperativa;
    try {
      fichaCerrada = (await this.deps.unidadDeTrabajo.ejecutar(
        tenantId,
        async (repos) => {
          const resultado = await repos.ficha.cerrar(reservaId, {
            fichaCerrada: true,
            fechaCierre,
            preEventoStatus: 'cerrado',
          });
          await repos.auditoria.registrar({
            tenantId,
            usuarioId,
            accion: 'transicion',
            entidad: 'FICHA_OPERATIVA',
            entidadId: reservaId,
            datosNuevos: { preEventoStatus: 'cerrado', fichaCerrada: true },
          });
          return resultado;
        },
      )) as FichaOperativa;
    } catch (error) {
      // Coordinación C-2: bajo el lock, la ficha YA estaba `cerrado` (otra vía —el
      // barrido A10 de US-026 o un cierre concurrente— ganó la carrera). La UoW abortó
      // sin mutar ni auditar. El cierre manual es IDEMPOTENTE: el estado deseado por el
      // gestor ya se cumplió → releemos la ficha cerrada actual y devolvemos 200 (no-op
      // exitoso), sin re-mutar ni duplicar auditoría.
      if (error instanceof FichaYaCerradaError) {
        const fichaActual = await this.releerFichaCerrada(
          tenantId,
          reservaId,
          fichaCierreExistente,
        );
        return { ...fichaActual, avisosCamposVacios };
      }
      throw error;
    }

    return { ...fichaCerrada, avisosCamposVacios };
  }

  /**
   * Relee la ficha (ya cerrada por otra vía) para construir la respuesta idempotente.
   * Si la relectura no la encuentra (carrera improbable), cae al snapshot cargado antes
   * de la transacción, proyectado como cerrado — nunca degrada a error.
   */
  private async releerFichaCerrada(
    tenantId: string,
    reservaId: string,
    respaldo: FichaOperativa,
  ): Promise<FichaOperativa> {
    const reserva = await this.deps.cargarReservaConFicha({ tenantId, reservaId });
    if (reserva?.ficha != null) {
      return reserva.ficha;
    }
    return { ...respaldo, fichaCerrada: true, preEventoStatus: 'cerrado' };
  }
}

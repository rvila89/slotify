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
import type {
  RecalcularReservaVivaResultado,
  RecalcularReservaVivaUseCase,
} from './recalcular-reserva-viva.use-case';

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
export type { RecalcularReservaVivaResultado } from './recalcular-reserva-viva.use-case';

/** Repositorios ligados a la unidad de trabajo del guardado parcial. */
export type RepositoriosFicha = RepositoriosGuardadoFicha;

/** Unidad de trabajo transaccional del guardado parcial. */
export type UnidadDeTrabajoFichaPort = UnidadDeTrabajoGenericaPort<RepositoriosFicha>;

/**
 * Campos ESTRUCTURADOS de aforo/duración (change `reserva-viva-edicion-recalculo-ficha`
 * §D-1) que la ficha enruta a la RESERVA y que disparan el recálculo en cascada dentro de
 * la ventana viva. Son SEPARADOS de `CamposFichaOperativa` (operativos, sin recálculo).
 */
export interface CamposEstructuralesFicha {
  duracionHoras?: number;
  numAdultosNinosMayores4?: number;
  numNinosMenores4?: number;
  /** Precio total manual (IVA incluido) del caso `tarifaAConsultar`. */
  precioManualEur?: string;
}

/** Comando de guardado: tenant/usuario del JWT + reserva + subconjunto parcial. */
export interface GuardarFichaOperativaComando {
  tenantId: string;
  usuarioId: string;
  reservaId: string;
  campos: CamposFichaOperativa;
  /** Campos estructurados de aforo/duración (opcionales; disparan recálculo, §D-1/§D-3). */
  estructurales?: CamposEstructuralesFicha;
}

/** Dependencias inyectadas del caso de uso. */
export interface GuardarFichaOperativaDeps {
  unidadDeTrabajo: UnidadDeTrabajoFichaPort;
  cargarReservaConFicha: CargarReservaConFichaPort;
  clock: ClockPort;
  /**
   * Recálculo en cascada (change `reserva-viva-edicion-recalculo-ficha`). Opcional: sin él,
   * los campos estructurados de aforo/duración se ignoran (compat con tests legados de
   * US-025 que no cablean el recálculo).
   */
  recalcularReservaViva?: RecalcularReservaVivaUseCase;
}

/**
 * Resultado del guardado: la ficha resultante MÁS el resultado del recálculo en cascada
 * (`undefined` cuando el guardado no tocó aforo/duración estructural). El controlador
 * proyecta `recalculo` a `RecalculoResultado | null` del contrato `GuardarFichaOperativaResponse`.
 */
export interface GuardarFichaOperativaResultado {
  ficha: FichaOperativa;
  recalculo?: RecalcularReservaVivaResultado;
}

export class GuardarFichaOperativaUseCase {
  constructor(private readonly deps: GuardarFichaOperativaDeps) {}

  async ejecutar(
    comando: GuardarFichaOperativaComando,
  ): Promise<GuardarFichaOperativaResultado> {
    const { tenantId, usuarioId, reservaId, campos } = comando;

    // Guarda de acceso + tenant ANTES de abrir la transacción (sin efectos si falla).
    const reserva = await this.deps.cargarReservaConFicha({ tenantId, reservaId });
    if (reserva === null || reserva === undefined) {
      throw new ReservaNoEncontradaError();
    }
    if (!permiteAccederFicha(reserva.estado) || reserva.ficha === null) {
      throw new FichaNoDisponibleError();
    }

    // RECÁLCULO en cascada (§D-1/§D-3): si el guardado trae aforo/duración estructurados,
    // se enrutan a la RESERVA vía `RecalcularReservaVivaUseCase` (guarda de ventana viva,
    // no-op si no cambia, recálculo transaccional + E9). Los campos operativos NO
    // estructurales (contacto, hora, notas, briefing) siguen guardándose sin restricción.
    const recalculo = await this.recalcularSiProcede(comando);

    const estadoPrevio = reserva.ficha.preEventoStatus;

    const ficha = (await this.deps.unidadDeTrabajo.ejecutar(tenantId, async (repos) => {
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

    return recalculo === undefined ? { ficha } : { ficha, recalculo };
  }

  /**
   * Invoca el recálculo en cascada si el guardado incluye aforo/duración estructurados o un
   * precio manual (§D-1) y DEVUELVE su resultado (para la respuesta del PATCH). El
   * `RecalcularReservaVivaUseCase` resuelve el desglose EFECTIVO (comando ?? vigente), la
   * guarda de ventana viva y el no-op. Sin `recalcularReservaViva` cableado o sin campos
   * estructurales → `undefined` (la respuesta lleva `recalculo: null`).
   */
  private async recalcularSiProcede(
    comando: GuardarFichaOperativaComando,
  ): Promise<RecalcularReservaVivaResultado | undefined> {
    const estructurales = comando.estructurales;
    if (this.deps.recalcularReservaViva === undefined || estructurales === undefined) {
      return undefined;
    }
    const traeAlgo =
      estructurales.duracionHoras !== undefined ||
      estructurales.numAdultosNinosMayores4 !== undefined ||
      estructurales.numNinosMenores4 !== undefined ||
      estructurales.precioManualEur !== undefined;
    if (!traeAlgo) {
      return undefined;
    }

    return this.deps.recalcularReservaViva.ejecutar({
      tenantId: comando.tenantId,
      usuarioId: comando.usuarioId,
      reservaId: comando.reservaId,
      ...(estructurales.duracionHoras !== undefined
        ? { duracionHoras: estructurales.duracionHoras }
        : {}),
      ...(estructurales.numAdultosNinosMayores4 !== undefined
        ? { numAdultosNinosMayores4: estructurales.numAdultosNinosMayores4 }
        : {}),
      ...(estructurales.numNinosMenores4 !== undefined
        ? { numNinosMenores4: estructurales.numNinosMenores4 }
        : {}),
      ...(estructurales.precioManualEur !== undefined
        ? { precioManualEur: estructurales.precioManualEur }
        : {}),
    });
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

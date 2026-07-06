/**
 * Caso de uso de APLICACIÓN (read-model): `ConsultarDashboardUseCase`
 * (`GET /dashboard` → `DashboardResponse`, US-044 / UC-34). LECTURA PURA (design.md
 * §D-5): agrega el estado operativo del tenant en 7 widgets y NO muta ninguna entidad.
 *
 * Orquesta un único puerto de lectura (`DashboardQueryPort`, §D-1: un endpoint agregado
 * en vez de 7) inyectado, pasándole SIEMPRE el `tenant_id` del comando (del JWT, nunca
 * del cliente — §D-4) y el instante del reloj inyectado (`ClockPort`, §D-3). Con ese
 * dataset — que el adaptador ya restringe a `activo = true` del tenant — calcula las
 * ventanas temporales (hoy/mañana, `[hoy, hoy+30]` inclusive) en backend y aplica los
 * criterios de cada widget. Defensa en profundidad: descarta cualquier fila `activo =
 * false` o de otro tenant que llegase por error.
 *
 * El `color` de los ítems de `proximos30Dias` se deriva REUTILIZANDO la función pura del
 * Calendario (US-039 / §D-2), sin duplicar el mapa. El pipeline EXCLUYE los estados
 * terminales (`reserva_completada`, `reserva_cancelada`, sub-estados 2x/2y/2z).
 *
 * Hexagonal: depende SOLO de puertos (interfaces); no importa Prisma ni `@nestjs/*`.
 */
import type { DashboardQueryPort } from '../domain/dashboard-query.port';
import type { ClockPort } from '../domain/clock.port';
import type {
  DashboardDataset,
  DashboardItem,
  DashboardItemProximos30Dias,
  DashboardReservaLectura,
  DashboardResultado,
  DashboardWidget,
} from '../domain/dashboard.types';
import { derivarColorDashboard } from '../domain/color-dashboard';
import type { SubEstadoConsulta } from '../../reservas/domain/maquina-estados';

// Re-exporta los tipos de dominio para el consumo desde la capa de aplicación/tests.
export type { DashboardQueryPort } from '../domain/dashboard-query.port';
export type { ClockPort } from '../domain/clock.port';
export type {
  DashboardDataset,
  DashboardReservaLectura,
  DashboardItem,
  DashboardItemProximos30Dias,
  DashboardResultado,
  DashboardWidget,
} from '../domain/dashboard.types';

/** Comando de entrada del query del dashboard. */
export interface ConsultarDashboardComando {
  /** Tenant del gestor (del JWT, nunca del cliente — §D-4). */
  tenantId: string;
  /**
   * Instante actual. Opcional: si se omite, se usa el reloj inyectado (§D-3). El
   * controlador no lo aporta; los tests lo fijan para las ventanas temporales.
   */
  ahora?: Date;
}

/** Dependencias inyectadas del use-case (puertos). */
export interface ConsultarDashboardDeps {
  dashboard: DashboardQueryPort;
  clock: ClockPort;
}

/** Sub-estados TERMINALES de consulta (no participan del pipeline). */
const SUB_ESTADOS_TERMINALES: ReadonlyArray<SubEstadoConsulta> = ['2x', '2y', '2z'];

/** Milisegundos en un día (para desplazar la ventana de 30 días). */
const MS_POR_DIA = 24 * 60 * 60 * 1000;

/** Formatea un `Date` a `YYYY-MM-DD` en UTC (coherente con las fechas DATE del dominio). */
const aFechaUtc = (fecha: Date): string => fecha.toISOString().slice(0, 10);

/** Construye un widget `{ items, total }` a partir de una lista ya filtrada. */
const widget = <T extends DashboardItem>(items: T[]): DashboardWidget<T> => ({
  items,
  total: items.length,
});

/** Proyecta una reserva del dataset a un `DashboardItem` (sin campos de negocio extra). */
const aItem = (r: DashboardReservaLectura): DashboardItem => ({
  reservaId: r.reservaId,
  codigo: r.codigo,
  clienteNombre: r.clienteNombre,
  estado: r.estado,
  subEstado: r.subEstado,
  fechaEvento: r.fechaEvento,
});

export class ConsultarDashboardUseCase {
  constructor(private readonly deps: ConsultarDashboardDeps) {}

  async ejecutar(
    comando: ConsultarDashboardComando,
  ): Promise<DashboardResultado> {
    const ahora = comando.ahora ?? this.deps.clock.ahora();
    const { tenantId } = comando;

    const dataset: DashboardDataset = await this.deps.dashboard.agregar({
      tenantId,
      ahora,
    });

    // Defensa en profundidad (§D-4): el adaptador ya filtra, pero el use-case nunca
    // expone filas inactivas ni de otro tenant aunque llegasen por error en el dataset.
    const reservas = dataset.reservas.filter(
      (r) => r.activo === true && r.tenantId === tenantId,
    );

    const hoyFecha = aFechaUtc(ahora);
    const mananaFecha = aFechaUtc(new Date(ahora.getTime() + MS_POR_DIA));
    const dia30Fecha = aFechaUtc(new Date(ahora.getTime() + 30 * MS_POR_DIA));

    return {
      hoyManana: this.calcularHoyManana(reservas, hoyFecha, mananaFecha),
      pipeline: this.calcularPipeline(reservas),
      subProcesosCriticos: this.calcularSubProcesosCriticos(reservas),
      pendientes: this.calcularPendientes(reservas),
      consultasEnCola: this.calcularConsultasEnCola(reservas),
      visitasProgramadas: this.calcularVisitasProgramadas(reservas, hoyFecha),
      proximos30Dias: this.calcularProximos30Dias(reservas, hoyFecha, dia30Fecha),
    };
  }

  /**
   * Hoy/mañana: `fecha_evento ∈ {hoy, mañana}` en `reserva_confirmada` o
   * `evento_en_curso`, ordenadas por `fecha_evento` ascendente.
   */
  private calcularHoyManana(
    reservas: DashboardReservaLectura[],
    hoyFecha: string,
    mananaFecha: string,
  ): DashboardWidget {
    const items = reservas
      .filter(
        (r) =>
          (r.estado === 'reserva_confirmada' || r.estado === 'evento_en_curso') &&
          r.fechaEvento !== null &&
          (r.fechaEvento === hoyFecha || r.fechaEvento === mananaFecha),
      )
      .sort((a, b) => (a.fechaEvento! < b.fechaEvento! ? -1 : a.fechaEvento! > b.fechaEvento! ? 1 : 0))
      .map(aItem);
    return widget(items);
  }

  /**
   * Pipeline: reservas activas EXCLUYENDO terminales (`reserva_completada`,
   * `reserva_cancelada`, sub-estados de consulta 2x/2y/2z).
   */
  private calcularPipeline(
    reservas: DashboardReservaLectura[],
  ): DashboardWidget {
    const items = reservas
      .filter((r) => !this.esTerminal(r))
      .map(aItem);
    return widget(items);
  }

  /**
   * Sub-procesos críticos: `reserva_confirmada` con algún sub-proceso atrasado
   * (pre-evento no cerrado, liquidación no cobrada o fianza no cobrada).
   */
  private calcularSubProcesosCriticos(
    reservas: DashboardReservaLectura[],
  ): DashboardWidget {
    const items = reservas
      .filter(
        (r) =>
          r.estado === 'reserva_confirmada' &&
          (r.preEventoStatus !== 'cerrado' ||
            r.liquidacionStatus !== 'cobrada' ||
            r.fianzaStatus !== 'cobrada'),
      )
      .map(aItem);
    return widget(items);
  }

  /**
   * Pendientes: acciones requeridas. En el MVP se aproxima con las consultas en cola y
   * las visitas con estado que requiere seguimiento; el criterio fino de TTL/factura se
   * refina en el adaptador. Se mantiene lectura pura y estado vacío independiente.
   */
  private calcularPendientes(
    reservas: DashboardReservaLectura[],
  ): DashboardWidget {
    const items = reservas
      .filter((r) => r.estado === 'pre_reserva')
      .map(aItem);
    return widget(items);
  }

  /** Consultas en cola: `sub_estado = 2d`. */
  private calcularConsultasEnCola(
    reservas: DashboardReservaLectura[],
  ): DashboardWidget {
    const items = reservas
      .filter((r) => r.estado === 'consulta' && r.subEstado === '2d')
      .map(aItem);
    return widget(items);
  }

  /**
   * Visitas programadas: `sub_estado = 2v` con `visita_programada_fecha` futura (>= hoy),
   * ordenadas por `visita_programada_fecha` ascendente.
   */
  private calcularVisitasProgramadas(
    reservas: DashboardReservaLectura[],
    hoyFecha: string,
  ): DashboardWidget {
    const items = reservas
      .filter(
        (r) =>
          r.estado === 'consulta' &&
          r.subEstado === '2v' &&
          r.visitaProgramadaFecha !== null &&
          r.visitaProgramadaFecha >= hoyFecha,
      )
      .sort((a, b) =>
        a.visitaProgramadaFecha! < b.visitaProgramadaFecha!
          ? -1
          : a.visitaProgramadaFecha! > b.visitaProgramadaFecha!
            ? 1
            : 0,
      )
      .map(aItem);
    return widget(items);
  }

  /**
   * Próximos 30 días: `fecha_evento ∈ [hoy, hoy + 30 días]` (inclusive), cada ítem con
   * su `color` canónico derivado con la MISMA función que el Calendario (§D-2). Los
   * pares `(estado, subEstado)` sin color (consulta terminal) se descartan.
   */
  private calcularProximos30Dias(
    reservas: DashboardReservaLectura[],
    hoyFecha: string,
    dia30Fecha: string,
  ): DashboardWidget<DashboardItemProximos30Dias> {
    const items = reservas
      .filter(
        (r) =>
          r.fechaEvento !== null &&
          r.fechaEvento >= hoyFecha &&
          r.fechaEvento <= dia30Fecha,
      )
      .sort((a, b) => (a.fechaEvento! < b.fechaEvento! ? -1 : a.fechaEvento! > b.fechaEvento! ? 1 : 0))
      .flatMap((r) => {
        const color = derivarColorDashboard(r.estado, r.subEstado);
        if (color === null) return [];
        return [{ ...aItem(r), color }];
      });
    return widget(items);
  }

  /** Un ítem es TERMINAL si su estado o sub-estado no participa del pipeline activo. */
  private esTerminal(r: DashboardReservaLectura): boolean {
    if (r.estado === 'reserva_completada' || r.estado === 'reserva_cancelada') {
      return true;
    }
    if (
      r.estado === 'consulta' &&
      r.subEstado !== null &&
      SUB_ESTADOS_TERMINALES.includes(r.subEstado)
    ) {
      return true;
    }
    return false;
  }
}

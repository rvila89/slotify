/**
 * Caso de uso de APLICACIÓN (read-model): `ObtenerCalendarioUseCase`
 * (`GET /calendario` → `CalendarioResponse`, US-039 / UC-29). LECTURA PURA: agrega la
 * disponibilidad del tenant por rango de fechas y NO muta `RESERVA` ni
 * `FECHA_BLOQUEADA` (design.md §D-7).
 *
 * Orquesta un único puerto de lectura (`CalendarioQueryPort`) inyectado: pasa SIEMPRE
 * el `tenant_id` del comando (del JWT, nunca del cliente — §D-4) más el rango y la
 * vista; devuelve el eco del rango y las fechas ocupadas tal cual las entrega el
 * adaptador (solo fechas con bloqueo activo; las libres no aparecen, §D-1). La `vista`
 * es informativa: el dataset del mismo rango es idéntico entre vistas.
 *
 * Hexagonal: depende SOLO del puerto (interfaz); no importa Prisma ni `@nestjs/*`.
 */
import type { ColorCalendario } from '../domain/derivacion-color';
import type {
  EstadoReserva,
  SubEstadoConsulta,
} from '../../reservas/domain/maquina-estados';

/** Vista de render solicitada (informativa; contrato `VistaCalendario`). */
export type VistaCalendario = 'mes' | 'semana' | 'dia' | 'lista';

/** Comando de entrada del query del calendario. */
export interface ObtenerCalendarioComando {
  /** Tenant del gestor (del JWT, nunca del query/path — §D-4). */
  tenantId: string;
  /** Inicio del rango (inclusive). */
  desde: Date;
  /** Fin del rango (inclusive). */
  hasta: Date;
  /** Vista solicitada (informativa; no altera el dataset). */
  vista: VistaCalendario;
}

/**
 * Proyección de UNA fecha ocupada (read-model). Reúne el dato de pintado (`color`,
 * ya derivado por el adaptador vía `derivarColor`) y el del popover de detalle. El
 * `ttlExpiracion` viaja como instante (`Date`), no pre-formateado: el mapeo a
 * `date-time` ISO lo hace el controlador.
 */
export interface CalendarioFechaLectura {
  /** Fecha ocupada (DATE, medianoche UTC). */
  fecha: Date;
  /** Color semántico canónico de la celda. */
  color: ColorCalendario;
  /** Estado de la reserva bloqueante. */
  estado: EstadoReserva;
  /** Sub-estado de la reserva bloqueante; `null` si no aplica. */
  subEstado: SubEstadoConsulta | null;
  /** ID de la reserva bloqueante (enlace a la ficha). */
  reservaId: string;
  /** Nombre del cliente de la reserva bloqueante (popover). */
  cliente: string;
  /** Vencimiento del bloqueo blando; `null` para firme/histórica. */
  ttlExpiracion: Date | null;
  /** Conteo de reservas en cola (2.d) apuntando a la bloqueante; 0 si no hay. */
  enCola: number;
}

/** Rango efectivo agregado (eco de los query params). */
export interface CalendarioRangoLectura {
  desde: Date;
  hasta: Date;
}

/** Read-model de la respuesta agregada del calendario. */
export interface CalendarioLectura {
  rango: CalendarioRangoLectura;
  fechas: CalendarioFechaLectura[];
}

/** Parámetros del puerto de lectura agregada por rango. */
export interface AgregarPorRangoParams {
  /** Tenant del JWT (filtro obligatorio + contexto RLS). */
  tenantId: string;
  /** Inicio del rango (inclusive). */
  desde: Date;
  /** Fin del rango (inclusive). */
  hasta: Date;
  /** Vista solicitada (informativa). */
  vista: VistaCalendario;
}

/**
 * Puerto de LECTURA del calendario. Implementado por el adaptador Prisma en
 * infraestructura: agrega `RESERVA ⋈ FECHA_BLOQUEADA` del tenant en el rango, deriva
 * el color y cuenta la cola. NO expone ningún método de escritura (lectura pura).
 */
export interface CalendarioQueryPort {
  agregarPorRango(
    params: AgregarPorRangoParams,
  ): Promise<CalendarioFechaLectura[]>;
}

/** Dependencias del caso de uso (puerto inyectado). */
export interface ObtenerCalendarioDeps {
  calendario: CalendarioQueryPort;
}

export class ObtenerCalendarioUseCase {
  constructor(private readonly deps: ObtenerCalendarioDeps) {}

  async ejecutar(
    comando: ObtenerCalendarioComando,
  ): Promise<CalendarioLectura> {
    // Pasa SIEMPRE el tenant del comando (del JWT) al puerto: ninguna fecha de otro
    // tenant es alcanzable (§D-4). La vista es informativa; el rango define el dataset.
    const fechas = await this.deps.calendario.agregarPorRango({
      tenantId: comando.tenantId,
      desde: comando.desde,
      hasta: comando.hasta,
      vista: comando.vista,
    });

    return {
      rango: { desde: comando.desde, hasta: comando.hasta },
      fechas,
    };
  }
}

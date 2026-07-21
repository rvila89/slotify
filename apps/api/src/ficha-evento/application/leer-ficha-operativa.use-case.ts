/**
 * Caso de uso `LeerFichaOperativaUseCase` (US-025 / UC-20 + change `reserva-viva-
 * edicion-recalculo-ficha` §D-2).
 *
 * Lee la FICHA_OPERATIVA de una RESERVA SIN mutar ningún estado. Aplica la guarda de
 * acceso por `RESERVA.estado` (§D-3) y filtra por `tenant_id` (RLS): estado anterior
 * a `reserva_confirmada` → `FichaNoDisponibleError` (409); RESERVA inexistente/
 * cross-tenant → `ReservaNoEncontradaError` (404). No abre transacción (solo carga).
 *
 * PRE-RELLENO al leer (§D-2): para cada campo, `valorFicha ?? valorDerivadoDeReservaOCliente`
 * (personas derivado con `derivarNumPersonas`, duración ← `RESERVA.duracionHoras`, hora ←
 * `RESERVA.horario`, contacto/teléfono/correo ← CLIENTE, notas ← `RESERVA.comentarios`).
 * Es de PRESENTACIÓN: leer NO muta ni dispara transiciones; un guardado posterior persiste.
 */
import { derivarNumPersonas } from '../../presupuestos/domain/derivar-num-personas';
import {
  FichaNoDisponibleError,
  ReservaNoEncontradaError,
  permiteAccederFicha,
  type CargarReservaConFichaPort,
  type FichaOperativa,
  type ReservaFichaOperativa as ReservaFichaOperativaDominio,
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

/** Compone el nombre de contacto del cliente (`nombre + ' ' + apellidos`), o null. */
const componerContactoNombre = (
  cliente: ReservaFichaOperativaDominio['cliente'],
): string | null => {
  if (cliente === undefined) {
    return null;
  }
  const partes = [cliente.nombre, cliente.apellidos].filter(
    (p): p is string => p !== null && p !== undefined && p.trim() !== '',
  );
  return partes.length > 0 ? partes.join(' ') : null;
};

/** Presentación de la duración estructurada de la RESERVA (`8` → `"8h"`), o null. */
const presentarDuracion = (duracionHoras: number | null | undefined): string | null =>
  duracionHoras === null || duracionHoras === undefined ? null : `${duracionHoras}h`;

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
    return this.prerellenar(reserva as ReservaFichaOperativaDominio);
  }

  /**
   * Aplica el pre-relleno al leer (§D-2): por campo, `valorFicha ?? valorDerivado`. No muta
   * la ficha en BD; devuelve una VISTA de presentación. Sin datos de RESERVA/CLIENTE
   * (lectura legada) devuelve la ficha tal cual.
   */
  private prerellenar(reserva: ReservaFichaOperativaDominio): FichaOperativa {
    const ficha = reserva.ficha as FichaOperativa;
    const datos = reserva.reserva;
    const cliente = reserva.cliente;

    const numInvitadosDerivado =
      datos === undefined
        ? ficha.numInvitadosConfirmado
        : derivarNumPersonas({
            numInvitadosFinal: datos.numInvitadosFinal,
            numAdultosNinosMayores4: datos.numAdultosNinosMayores4,
            numNinosMenores4: datos.numNinosMenores4,
          });

    return {
      ...ficha,
      numInvitadosConfirmado: ficha.numInvitadosConfirmado ?? numInvitadosDerivado,
      contactoEventoNombre:
        ficha.contactoEventoNombre ?? componerContactoNombre(cliente),
      contactoEventoTelefono: ficha.contactoEventoTelefono ?? cliente?.telefono ?? null,
      contactoEventoCorreo: ficha.contactoEventoCorreo ?? cliente?.email ?? null,
      horaLlegada: ficha.horaLlegada ?? datos?.horario ?? null,
      duracion: ficha.duracion ?? presentarDuracion(datos?.duracionHoras),
      notasOperativas: ficha.notasOperativas ?? datos?.comentarios ?? null,
      // Campos estructurados de la RESERVA expuestos en la vista de lectura (§D-1).
      duracionHoras: datos?.duracionHoras ?? null,
      numAdultosNinosMayores4: datos?.numAdultosNinosMayores4 ?? null,
      numNinosMenores4: datos?.numNinosMenores4 ?? null,
    };
  }
}

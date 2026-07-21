/**
 * Mapper de proyección de una fila `FichaOperativa` de Prisma al modelo de dominio
 * (US-025 / UC-20). El `preEventoStatus` NO vive en la tabla `ficha_operativa` sino en
 * `RESERVA.pre_evento_status`, así que se pasa aparte.
 */
import type { FichaOperativa as FichaOperativaPrisma } from '@prisma/client';
import type {
  FichaOperativa,
  PreEventoStatus,
} from '../domain/ficha-operativa.ports';

/** Proyecta la fila Prisma + el sub-proceso de la RESERVA al modelo de dominio. */
export const proyectarFicha = (
  fila: FichaOperativaPrisma,
  preEventoStatus: PreEventoStatus,
): FichaOperativa => ({
  idFicha: fila.idFicha,
  reservaId: fila.reservaId,
  numInvitadosConfirmado: fila.numInvitadosConfirmado,
  contactoEventoNombre: fila.contactoEventoNombre,
  contactoEventoTelefono: fila.contactoEventoTelefono,
  contactoEventoCorreo: fila.contactoEventoCorreo,
  horaLlegada: fila.horaLlegada,
  duracion: fila.duracion,
  notasOperativas: fila.notasOperativas,
  briefingEquipo: fila.briefingEquipo,
  fichaCerrada: fila.fichaCerrada,
  fechaCierre: fila.fechaCierre,
  preEventoStatus,
});

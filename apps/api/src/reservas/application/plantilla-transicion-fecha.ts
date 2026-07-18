/**
 * Render PURO de las plantillas del borrador E1 de la transición de fecha (US-005 /
 * change `email-transicion-fecha-borrador`).
 *
 * Módulo hexagonal de APLICACIÓN sin dependencias de framework ni de infraestructura
 * (no importa `@nestjs/*` ni `@prisma/*`): recibe datos primitivos y devuelve
 * `{ asunto, cuerpo }`. Es testeable en aislamiento (unit, sin Postgres).
 *
 * Dos plantillas según la rama de la transición:
 *   - `'disponible'` (rama libre 2.a → 2.b): la fecha propuesta está libre; el gestor
 *     revisará el borrador y ofrecerá el presupuesto (señal del 40 %).
 *   - `'cola'` (rama cola 2.a → 2.d): la fecha está bloqueada por otra consulta.
 *
 * Idioma: `'ca'` → catalán; cualquier otro valor (incl. `'es'`, otro código o ausencia)
 * → castellano. El idioma aplica tanto al texto fijo como al nombre del mes de la fecha.
 *
 * Placeholder `___`: cuando `personas`/`horas` son `null` (consulta exploratoria que aún
 * no los tiene), la plantilla "disponible" interpola `___` para que el gestor lo complete
 * al revisar el borrador (flujo US-046).
 *
 * Firma HARDCODEADA "Ari — Masia l'Encís" (coherente con el catálogo E1/E3;
 * parametrizar por tenant es deuda futura). El "40 %" de la señal es texto FIJO.
 * Textos: plan aprobado `email-transicion-fecha-borrador`.
 */
import { formatarFechaCA, formatarFechaES } from '../../comunicaciones/infrastructure/plantillas/formato-fecha';

/** Rama de la transición → plantilla a renderizar. */
export type TipoPlantillaTransicion = 'disponible' | 'cola';

/** Parámetros del render del borrador E1 de la transición de fecha. */
export interface RenderMensajeTransicionParams {
  /** Plantilla a usar según la rama de la transición. */
  tipo: TipoPlantillaTransicion;
  /** Idioma de la RESERVA: `'ca'` → catalán; cualquier otro → castellano. */
  idioma: string;
  /** Nombre de pila del cliente (`Cliente.nombre`). */
  nombre: string;
  /** Fecha del evento; se formatea según el idioma. */
  fechaEvento: Date;
  /** Nº de personas (`Reserva.num_invitados_final`); `null` → placeholder `___`. */
  personas: number | null;
  /** Horas del evento (`Reserva.duracion_horas`); `null` → placeholder `___`. */
  horas: number | null;
}

/** Resultado del render: asunto y cuerpo listos para la COMUNICACION. */
export interface MensajeTransicion {
  asunto: string;
  cuerpo: string;
}

/** Placeholder visible para un dato faltante (a completar por el gestor al revisar). */
const PLACEHOLDER = '___';

const FIRMA = "Ari — Masia l'Encís";

/** Valor mostrado de un dato numérico opcional: el número o el placeholder si falta. */
const valorOplaceholder = (valor: number | null): string =>
  valor === null ? PLACEHOLDER : String(valor);

const renderDisponibleCA = ({
  nombre,
  fechaEvento,
  personas,
  horas,
}: RenderMensajeTransicionParams): MensajeTransicion => {
  const fecha = formatarFechaCA(fechaEvento);
  const asunto = 'La data que ens proposes està disponible';
  const cuerpo = [
    `Hola ${nombre},`,
    '',
    'Moltes gràcies per la teva resposta i per compartir-nos la data! 😊',
    `He revisat la disponibilitat i tinc una bona notícia: la data que ens proposes, ${fecha}, està actualment disponible.`,
    `Si et sembla bé, et preparo el pressupost per a ${valorOplaceholder(personas)} persones i ${valorOplaceholder(horas)} hores pel ${fecha} perquè puguis fer el pagament del 40% i així deixar la reserva confirmada. En cas que finalment acabeu sent més persones ho afegiríem a l'import restant pendent d'abonar.`,
    "Aquest import final l'hauríeu de fer efectiu tres dies abans de l'esdeveniment, que seria també la data límit per confirmar possibles canvis en el nombre de persones.",
    'Per poder-te preparar el pressupost, necessitaria les següents dades:',
    'Nom i cognoms / DNI / Adreça i població',
    'Quedo pendent de la teva confirmació per avançar amb la reserva.',
    `Una abraçada, ${FIRMA}`,
  ].join('\n');
  return { asunto, cuerpo };
};

const renderDisponibleES = ({
  nombre,
  fechaEvento,
  personas,
  horas,
}: RenderMensajeTransicionParams): MensajeTransicion => {
  const fecha = formatarFechaES(fechaEvento);
  const asunto = 'La fecha que propones está disponible';
  const cuerpo = [
    `Hola ${nombre},`,
    '',
    '¡Muchas gracias por tu respuesta y por compartirnos la fecha! 😊',
    `He revisado la disponibilidad y tengo una buena noticia: la fecha que nos propones, ${fecha}, está actualmente disponible.`,
    `Si te parece bien, te preparo el presupuesto para ${valorOplaceholder(personas)} personas y ${valorOplaceholder(horas)} horas para el ${fecha} para que puedas hacer el pago del 40% y así dejar la reserva confirmada. En caso de que finalmente acabéis siendo más personas lo añadiríamos al importe restante pendiente de abonar.`,
    'Ese importe final deberíais hacerlo efectivo tres días antes del evento, que sería también la fecha límite para confirmar posibles cambios en el número de personas.',
    'Para poder prepararte el presupuesto, necesitaría los siguientes datos:',
    'Nombre y apellidos / DNI / Dirección y población',
    'Quedo pendiente de tu confirmación para avanzar con la reserva.',
    `Un abrazo, ${FIRMA}`,
  ].join('\n');
  return { asunto, cuerpo };
};

const renderColaCA = ({
  nombre,
  fechaEvento,
}: RenderMensajeTransicionParams): MensajeTransicion => {
  const fecha = formatarFechaCA(fechaEvento);
  const asunto = 'Sobre la data que ens proposes';
  const cuerpo = [
    `Hola ${nombre},`,
    '',
    'Moltes gràcies per la teva resposta i per compartir-nos la data! 😊',
    `Pel que fa a la data que ens proposes, ${fecha}, actualment està bloquejada per una altra consulta que estem gestionant.`,
    "Encara no disposem d'una confirmació definitiva, així que tan aviat com tinguem resposta et podrem confirmar si finalment queda disponible o no. Ens comprometem a informar-te al més aviat possible.",
    "Si mentrestant vols valorar alguna data alternativa, estarem encantats de revisar-ne la disponibilitat.",
    'Quedo a la teva disposició per a qualsevol dubte.',
    `Una abraçada, ${FIRMA}`,
  ].join('\n');
  return { asunto, cuerpo };
};

const renderColaES = ({
  nombre,
  fechaEvento,
}: RenderMensajeTransicionParams): MensajeTransicion => {
  const fecha = formatarFechaES(fechaEvento);
  const asunto = 'Sobre la fecha que propones';
  const cuerpo = [
    `Hola ${nombre},`,
    '',
    '¡Muchas gracias por tu respuesta y por compartirnos la fecha! 😊',
    `En cuanto a la fecha que nos propones, ${fecha}, actualmente está bloqueada por otra consulta que estamos gestionando.`,
    'Todavía no disponemos de una confirmación definitiva, así que en cuanto tengamos respuesta podremos confirmarte si finalmente queda disponible o no. Nos comprometemos a informarte lo antes posible.',
    'Si mientras tanto quieres valorar alguna fecha alternativa, estaremos encantados de revisar su disponibilidad.',
    'Quedo a tu disposición para cualquier duda.',
    `Un abrazo, ${FIRMA}`,
  ].join('\n');
  return { asunto, cuerpo };
};

/**
 * Renderiza el asunto y el cuerpo del borrador E1 de la transición de fecha según la
 * rama (`tipo`) y el idioma (`ca` vs. castellano). Puro y determinista.
 */
export const renderMensajeTransicionFecha = (
  params: RenderMensajeTransicionParams,
): MensajeTransicion => {
  const esCatalan = params.idioma === 'ca';
  if (params.tipo === 'cola') {
    return esCatalan ? renderColaCA(params) : renderColaES(params);
  }
  return esCatalan ? renderDisponibleCA(params) : renderDisponibleES(params);
};

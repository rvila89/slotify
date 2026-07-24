/**
 * Catálogo de plantillas en CÓDIGO `CatalogoPlantillasEnCodigo` (US-045, design.md
 * §3).
 *
 * INFRAESTRUCTURA que implementa el puerto de dominio `CatalogoPlantillasPort`:
 * registro tipado, indexado por `codigoEmail` + idioma, con render por interpolación
 * (sin motor de plantillas externo). Idiomas soportados: `es` y `ca`; cualquier otro
 * idioma devuelve `null` para que el motor aplique el fallback a `es` + AUDIT_LOG.
 *
 * Cobertura E1–E8: **E1 está ACTIVA** (render real). **E2–E8** quedan DECLARADAS
 * como diseñadas/INACTIVAS (sin trigger cableado en este change); su render real se
 * completa en la US que cablea cada trigger (E2→US-014, E3→US-021/022/023, …).
 */
import { Injectable } from '@nestjs/common';
import type {
  CatalogoPlantillasPort,
  Plantilla,
  RenderPlantilla,
} from '../../domain/catalogo-plantillas.port';
import type { CodigoEmail } from '../../domain/codigo-email';
import {
  htmlEscape,
  textoPlanoAHtml,
} from '../../application/texto-plano-a-html';
import { formatarFechaCA, formatarFechaES } from './formato-fecha';

/** Texto seguro a partir de una variable (evita `undefined`/`null` en el render). */
const texto = (valor: unknown): string =>
  valor === null || valor === undefined ? '' : String(valor);

/** Las 4 casuísticas de E1 según el estado de la fecha del evento. */
type TipoE1 = 'sin_fecha' | 'fecha_disponible' | 'fecha_confirmada' | 'fecha_cola';

/** Render real de la plantilla E1 en catalán (respuesta inicial automática, 4 casos). */
const renderE1Ca = (variables: Record<string, unknown>): RenderPlantilla => {
  const nombre = texto(variables.nombre);
  const tipoE1 = texto(variables.tipoE1) as TipoE1;
  const fechaEvento = variables.fechaEvento instanceof Date ? formatarFechaCA(variables.fechaEvento) : texto(variables.fechaEvento);
  const fechaAlternativa1 = variables.fechaAlternativa1 instanceof Date ? formatarFechaCA(variables.fechaAlternativa1) : texto(variables.fechaAlternativa1);
  const fechaAlternativa2 = variables.fechaAlternativa2 instanceof Date ? formatarFechaCA(variables.fechaAlternativa2) : texto(variables.fechaAlternativa2);

  const asunto = 'Hem rebut la teva consulta — Masia l\'Encís';

  const blocCompartir = `Podeu portar el vostre menjar, beguda i música. Tot el mobiliari i els espais estan inclosos en el preu del lloguer. Com a serveis opcionals, oferim l'ús de la barbacoa i/o del paeller per 30 € cadascun. També col·laborem amb proveïdors de confiança per si us interessa complementar l'experiència amb càtering, animació o altres serveis:\n\nhttps://masialencis.com/compartim/`;
  const blocContacte = `Si tens qualsevol dubte, una proposta especial o simplement vols conèixer l'espai abans de decidir-te, estaré encantada d'ensenyar-te'l en una visita sense cap compromís.\n\nEm pots contactar directament al 690 37 04 38.\n\nEspero poder ajudar-te a organitzar una jornada inoblidable a la Masia l'Encís!\n\nUna abraçada,\n\nAri\nMasia l'Encís`;
  const blocIntro = `Moltes gràcies pel teu interès en la Masia l'Encís! 😊\n\nSom un espai pensat perquè pugueu gaudir d'un dia especial amb amics, família o companys, en un entorn tranquil, privat i envoltat de natura. Disposem de jardí, piscina, zona de barbacoa i diferents espais perquè us sentiu com a casa.\n\nT'adjunto el dossier amb tota la informació i les tarifes. Hi trobaràs una orientació dels preus segons el nombre de persones i les hores que vulgueu reservar l'espai.`;

  let blocCentral: string;
  switch (tipoE1) {
    case 'fecha_disponible':
      blocCentral = `He revisat la disponibilitat i tinc una bona notícia: la data que ens proposes, ${fechaEvento}, actualment està disponible. Si us encaixa, us la puc reservar provisionalment sense cap compromís perquè tingueu temps de parlar-ho amb tranquil·litat i acabar de decidir-vos.`;
      break;
    case 'fecha_confirmada': {
      const alternativas: string[] = [];
      if (fechaAlternativa1) alternativas.push(fechaAlternativa1);
      if (fechaAlternativa2) alternativas.push(fechaAlternativa2);
      const ofertaAlternativas = alternativas.length > 0
        ? `\n\nTot i això, sí que tindríem disponibilitat el ${alternativas.join(' o el ')}, per si alguna d'aquestes opcions us pogués encaixar. Si alguna us interessa, us la puc reservar provisionalment sense cap compromís mentre ho valoreu.`
        : `\n\nSi les dates alternatives no us encaixen, no dubteu a comentar-me altres opcions i miraré de trobar una data disponible que s'adapti al que busqueu.`;
      blocCentral = `He revisat la disponibilitat i, malauradament, la data que ens proposes (${fechaEvento}) ja està confirmada per una altra reserva.${ofertaAlternativas}`;
      break;
    }
    case 'fecha_cola':
      blocCentral = `Pel que fa a la data que ens proposes (${fechaEvento}), actualment està bloquejada per una altra consulta que estem gestionant. Encara no disposem d'una confirmació definitiva, així que tan aviat com tinguem resposta et podrem confirmar si finalment queda disponible o no.\n\nMentrestant, et comparteixo tota la informació perquè pugueu valorar amb calma si l'espai, les condicions i els preus encaixen amb el que esteu buscant. D'aquesta manera, si finalment la data queda disponible, podrem avançar més ràpidament amb la reserva. I si no fos possible, mirarem de proposar-vos alguna data propera que us pugui encaixar.\n\nEns comprometem a informar-vos tan aviat com tinguem una resposta.`;
      break;
    default: // sin_fecha
      blocCentral = `Si ja teniu alguna data en ment, digue-m'ho i miraré personalment la disponibilitat. Si està lliure, us la puc bloquejar sense compromís mentre ho valoreu.`;
      break;
  }

  const cuerpoTexto = `Hola ${nombre},\n\n${blocIntro}\n\n${blocCentral}\n\n${blocCompartir}\n\n${blocContacte}`;
  const cuerpoHtml = textoPlanoAHtml(cuerpoTexto);

  return { asunto, cuerpoHtml, cuerpoTexto };
};

/** Render real de la plantilla E1 en castellano (respuesta inicial automática, 4 casos). */
const renderE1Es = (variables: Record<string, unknown>): RenderPlantilla => {
  const nombre = texto(variables.nombre);
  const tipoE1 = texto(variables.tipoE1) as TipoE1;
  const fechaEvento = variables.fechaEvento instanceof Date ? formatarFechaES(variables.fechaEvento) : texto(variables.fechaEvento);
  const fechaAlternativa1 = variables.fechaAlternativa1 instanceof Date ? formatarFechaES(variables.fechaAlternativa1) : texto(variables.fechaAlternativa1);
  const fechaAlternativa2 = variables.fechaAlternativa2 instanceof Date ? formatarFechaES(variables.fechaAlternativa2) : texto(variables.fechaAlternativa2);

  const asunto = 'Hemos recibido tu consulta — Masia l\'Encís';

  const blocCompartir = `Podéis traer vuestra comida, bebida y música. Todo el mobiliario y los espacios están incluidos en el precio del alquiler. Como servicios opcionales, ofrecemos el uso de la barbacoa y/o del paellero por 30 € cada uno. También colaboramos con proveedores de confianza por si os interesa complementar la experiencia con catering, animación u otros servicios:\n\nhttps://masialencis.com/compartim/`;
  const blocContacte = `Si tienes cualquier duda, una propuesta especial o simplemente quieres conocer el espacio antes de decidirte, estaré encantada de enseñártelo en una visita sin ningún compromiso.\n\nPuedes contactarme directamente en el 690 37 04 38.\n\n¡Espero poder ayudarte a organizar una jornada inolvidable en la Masia l'Encís!\n\nUn abrazo,\n\nAri\nMasia l'Encís`;
  const blocIntro = `¡Muchas gracias por tu interés en la Masia l'Encís! 😊\n\nSomos un espacio pensado para que podáis disfrutar de un día especial con amigos, familia o compañeros, en un entorno tranquilo, privado y rodeado de naturaleza. Disponemos de jardín, piscina, zona de barbacoa y diferentes espacios para que os sintáis como en casa.\n\nTe adjunto el dossier con toda la información y las tarifas. Encontrarás una orientación de los precios según el número de personas y las horas que queráis reservar el espacio.`;

  let blocCentral: string;
  switch (tipoE1) {
    case 'fecha_disponible':
      blocCentral = `He revisado la disponibilidad y tengo una buena noticia: la fecha que nos propones, ${fechaEvento}, actualmente está disponible. Si os encaja, puedo reservarla provisionalmente sin ningún compromiso para que tengáis tiempo de hablarlo con tranquilidad y terminar de decidiros.`;
      break;
    case 'fecha_confirmada': {
      const alternativas: string[] = [];
      if (fechaAlternativa1) alternativas.push(fechaAlternativa1);
      if (fechaAlternativa2) alternativas.push(fechaAlternativa2);
      const ofertaAlternativas = alternativas.length > 0
        ? `\n\nSin embargo, sí que tendríamos disponibilidad el ${alternativas.join(' o el ')}, por si alguna de estas opciones os pudiera encajar. Si alguna os interesa, puedo reservarla provisionalmente sin ningún compromiso mientras lo valoráis.`
        : `\n\nSi las fechas alternativas no os encajan, no dudéis en comentarme otras opciones e intentaré encontrar una fecha disponible que se adapte a lo que buscáis.`;
      blocCentral = `He revisado la disponibilidad y, lamentablemente, la fecha que nos propones (${fechaEvento}) ya está confirmada por otra reserva.${ofertaAlternativas}`;
      break;
    }
    case 'fecha_cola':
      blocCentral = `En cuanto a la fecha que nos propones (${fechaEvento}), actualmente está bloqueada por otra consulta que estamos gestionando. Todavía no disponemos de una confirmación definitiva, así que en cuanto tengamos respuesta podremos confirmarte si finalmente queda disponible o no.\n\nMientras tanto, te comparto toda la información para que podáis valorar con calma si el espacio, las condiciones y los precios encajan con lo que buscáis. De esta manera, si finalmente la fecha queda disponible, podremos avanzar más rápidamente con la reserva. Y si no fuera posible, intentaremos proponeros alguna fecha próxima que os pueda encajar.\n\nNos comprometemos a informaros en cuanto tengamos una respuesta.`;
      break;
    default: // sin_fecha
      blocCentral = `Si ya tenéis alguna fecha en mente, comentádmelo y miraré personalmente la disponibilidad. Si está libre, puedo bloquearla sin compromiso mientras lo valoráis.`;
      break;
  }

  const cuerpoTexto = `Hola ${nombre},\n\n${blocIntro}\n\n${blocCentral}\n\n${blocCompartir}\n\n${blocContacte}`;
  const cuerpoHtml = textoPlanoAHtml(cuerpoTexto);

  return { asunto, cuerpoHtml, cuerpoTexto };
};

/**
 * Render genérico de un email aún DISEÑADO/INACTIVO (E2, E4–E8). No se dispara en este
 * change; su contenido definitivo llega con la US que cablea el trigger.
 */
const renderInactivo = (codigo: CodigoEmail) => (
  _variables: Record<string, unknown>,
): RenderPlantilla => ({
  asunto: `Plantilla ${codigo} (pendiente de cableado)`,
  cuerpoHtml: `<p>Plantilla ${codigo} diseñada pero inactiva.</p>`,
  cuerpoTexto: `Plantilla ${codigo} diseñada pero inactiva.`,
});

/**
 * Render real de la plantilla E2 en castellano (presupuesto enviado al cliente). Texto de marca
 * definitivo del tenant (Masia l'Encís): pago anticipado del 40%, recálculo del listado final una
 * semana antes, instrucciones de transferencia (destinatario "Canoliart, SL", concepto "Masia
 * l'Encís"), condiciones particulares a devolver firmadas y firma «Ari — Masia l'Encís». El PDF del
 * presupuesto es el adjunto REQUERIDO. `{nombre}` = nombre de pila; `{codigoReserva}` en el asunto.
 */
const renderE2 = (variables: Record<string, unknown>): RenderPlantilla => {
  const nombre = texto(variables.nombre);
  const codigoReserva = texto(variables.codigoReserva);
  const esEdicion = variables.esEdicion === true;
  const referencia = codigoReserva === '' ? '' : ` (reserva ${codigoReserva})`;
  const asunto = esEdicion
    ? `Hemos actualizado tu presupuesto para el evento${referencia}`
    : `Tu presupuesto para el evento${referencia}`;
  const parrafos = [
    `Hola ${nombre},`,
    ...(esEdicion
      ? [
          'Hemos actualizado el presupuesto que te enviamos con los cambios solicitados. Te adjuntamos la versión revisada.',
        ]
      : []),
    "¡Muchas gracias por confiar en la Masia l'Encís!",
    'Te adjuntamos el presupuesto para que podáis efectuar el pago anticipado del 40% del importe total y así dejar confirmada la reserva.\nEl presupuesto está basado en las personas que tienes confirmadas actualmente y, una semana antes de la reserva, nos pondremos en contacto contigo para concretar el listado final de asistentes. En ese momento recalcularemos el importe total si es necesario.',
    'A la hora de realizar la transferencia, debes indicar como destinatario "Canoliart, SL" y, en el concepto, "Masia l\'Encís".',
    'Si tienes cualquier duda o necesitas adaptar algún detalle del presupuesto, ¡estaremos encantados de ayudarte!\nUn abrazo,\nAri\nMasia l\'Encís',
  ];
  const cuerpoTexto = parrafos.join('\n\n');
  const cuerpoHtml = parrafos
    .map((p) => `<p>${htmlEscape(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
  return { asunto, cuerpoHtml, cuerpoTexto };
};

/**
 * Render real de la plantilla E2 en catalán (presupuesto enviado al cliente). Variante catalana del
 * texto de marca del tenant, análoga a `renderE2` (ES). `{nombre}` = nombre de pila;
 * `{codigoReserva}` en el asunto.
 */
const renderE2Ca = (variables: Record<string, unknown>): RenderPlantilla => {
  const nombre = texto(variables.nombre);
  const codigoReserva = texto(variables.codigoReserva);
  const esEdicion = variables.esEdicion === true;
  const referencia = codigoReserva === '' ? '' : ` (reserva ${codigoReserva})`;
  const asunto = esEdicion
    ? `Hem actualitzat el teu pressupost per a l'esdeveniment${referencia}`
    : `El teu pressupost per a l'esdeveniment${referencia}`;
  const parrafos = [
    `Hola ${nombre},`,
    ...(esEdicion
      ? [
          "Hem actualitzat el pressupost que et vam enviar amb els canvis sol·licitats. T'adjuntem la versió revisada.",
        ]
      : []),
    "Moltes gràcies per confiar en la Masia l'Encís!",
    "T'adjuntem el pressupost perquè pugueu efectuar el pagament anticipat del 40% de l'import total i així deixar confirmada la reserva.\nEl pressupost està basat en les persones que tens confirmades actualment i, una setmana abans de la reserva, ens posarem en contacte amb tu per concretar el llistat final d'assistents. En aquest moment recalcularem l'import total si cal.",
    "A l'hora de realitzar la transferència, cal indicar com a destinatari \"Canoliart, SL\" i, en el concepte, \"Masia l'Encís\".",
    "Si tens qualsevol dubte o necessites adaptar algun detall del pressupost, estarem encantats d'ajudar-te!\nUna abraçada,\nAri\nMasia l'Encís",
  ];
  const cuerpoTexto = parrafos.join('\n\n');
  const cuerpoHtml = parrafos
    .map((p) => `<p>${htmlEscape(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
  return { asunto, cuerpoHtml, cuerpoTexto };
};

/**
 * Render real de la plantilla E3 en castellano (factura de señal 40%). Texto de marca aprobado
 * del tenant (Masia l'Encís): agradece la confianza, adjunta la factura del primer pago (40%),
 * recuerda el 60% restante antes del evento y cierra con la firma «Ari — Masia l'Encís». Las
 * condicions particulars se adjuntan en E3 (change condiciones-…-senal-…): SOLO si
 * `condicionesAdjuntas === true` se incluye el párrafo que pide devolverlas firmadas.
 */
const renderE3 = (variables: Record<string, unknown>): RenderPlantilla => {
  const nombre = texto(variables.nombre);
  const codigoReserva = texto(variables.codigoReserva);
  const condicionesAdjuntas = variables.condicionesAdjuntas === true;
  const referencia = codigoReserva === '' ? '' : ` — reserva ${codigoReserva}`;
  const asunto = `Factura de señal${referencia}`;
  const parrafos = [
    `Hola ${nombre},`,
    "¡Muchas gracias por confiar en la Masia l'Encís!",
    'Te adjuntamos la factura correspondiente al primer pago realizado, equivalente al 40% del importe total de la reserva.',
    'Te recordamos que antes de la fecha del evento, será necesario efectuar el pago del 60% restante.',
    ...(condicionesAdjuntas
      ? [
          'También te adjuntamos las condiciones particulares, que deberéis devolver debidamente firmadas antes de la fecha de la reserva.',
        ]
      : []),
    'Si tienes cualquier duda o necesitas que te ayudemos con cualquier detalle, estaremos encantados de atenderte.',
    "¡Muchas gracias!\nUn abrazo,\nAri\nMasia l'Encís",
  ];
  const cuerpoTexto = parrafos.join('\n\n');
  const cuerpoHtml = parrafos
    .map((p) => `<p>${htmlEscape(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
  return { asunto, cuerpoHtml, cuerpoTexto };
};

/**
 * Render real de la plantilla E3 en catalán (factura de senyal 40%). Variante catalana del texto
 * de marca aprobado, análoga a `renderE3` (ES). Las condicions particulars se adjuntan en E3 SOLO
 * si `condicionesAdjuntas === true` (change condiciones-…-senal-…).
 */
const renderE3Ca = (variables: Record<string, unknown>): RenderPlantilla => {
  const nombre = texto(variables.nombre);
  const codigoReserva = texto(variables.codigoReserva);
  const condicionesAdjuntas = variables.condicionesAdjuntas === true;
  const referencia = codigoReserva === '' ? '' : ` — reserva ${codigoReserva}`;
  const asunto = `Factura de senyal${referencia}`;
  const parrafos = [
    `Hola ${nombre},`,
    "Moltes gràcies per confiar en la Masia l'Encís!",
    "T'adjuntem la factura corresponent al primer pagament realitzat, equivalent al 40% de l'import total de la reserva.",
    "Et recordem que abans de la data de l'esdeveniment, serà necessari efectuar el pagament del 60% restant.",
    ...(condicionesAdjuntas
      ? [
          "També t'adjuntem les condicions particulars, que haureu de retornar degudament signades abans de la data de la reserva.",
        ]
      : []),
    "Si tens qualsevol dubte o necessites que t'ajudem amb algun detall, estarem encantats d'atendre't.",
    "Moltes gràcies!\nUna abraçada,\nAri\nMasia l'Encís",
  ];
  const cuerpoTexto = parrafos.join('\n\n');
  const cuerpoHtml = parrafos
    .map((p) => `<p>${htmlEscape(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
  return { asunto, cuerpoHtml, cuerpoTexto };
};

/** Formatea un importe (Decimal string/número) como euros con 2 decimales: `500` → `500,00 €`. */
const formatarImporteEsLiq = (valor: unknown): string => {
  const numero = Number(valor);
  if (Number.isNaN(numero)) {
    return texto(valor);
  }
  return `${numero.toFixed(2).replace('.', ',')} €`;
};

/**
 * Render real de la plantilla E4 en castellano (factura de liquidación, 60% restante). Texto de
 * marca aprobado (fix-liquidacion-fianza-independientes §Email copy): E4 = SOLO liquidación
 * (sin recibo de fianza). Recuerda abonar la fianza de `{fianzaEur}` € antes o el día del
 * evento. Adjunto REQUERIDO: el PDF de la liquidación. `{nombre}`, `{fianzaEur}`.
 */
const renderE4 = (variables: Record<string, unknown>): RenderPlantilla => {
  const nombre = texto(variables.nombre);
  const fianzaEur = formatarImporteEsLiq(variables.fianzaEur);
  const recordarCondicionesPendientes = variables.recordarCondicionesPendientes === true;
  const asunto = 'Factura de liquidación de tu reserva';
  const parrafos = [
    `Hola ${nombre},`,
    "¡Muchas gracias por confiar en la Masia l'Encís!",
    'Te adjuntamos la factura correspondiente al segundo pago, equivalente al 60% restante del importe total de la reserva.',
    `Te recordamos que, antes de la fecha del evento o el mismo día, deberás abonar la fianza de ${fianzaEur}.`,
    ...(recordarCondicionesPendientes
      ? [
          'Te recordamos también que aún tenemos pendiente recibir las condiciones particulares firmadas, que deberéis devolver antes de la fecha de la reserva.',
        ]
      : []),
    'Si tienes cualquier duda o necesitas ayuda con cualquier detalle de la organización, estaremos encantados de atenderte.',
    "¡Muchas gracias!\nUn abrazo,\nAri — Masia l'Encís",
  ];
  const cuerpoTexto = parrafos.join('\n\n');
  const cuerpoHtml = parrafos
    .map((p) => `<p>${htmlEscape(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
  return { asunto, cuerpoHtml, cuerpoTexto };
};

/** Render real de la plantilla E4 en catalán (factura de liquidació, 60% restant). */
const renderE4Ca = (variables: Record<string, unknown>): RenderPlantilla => {
  const nombre = texto(variables.nombre);
  const fianzaEur = formatarImporteEsLiq(variables.fianzaEur);
  const recordarCondicionesPendientes = variables.recordarCondicionesPendientes === true;
  const asunto = 'Factura de liquidació de la teva reserva';
  const parrafos = [
    `Hola ${nombre},`,
    "Moltes gràcies per confiar en la Masia l'Encís!",
    "T'adjuntem la factura corresponent al segon pagament, equivalent al 60% restant de l'import total de la reserva.",
    `Et recordem que, abans de la data de l'esdeveniment o el mateix dia, caldrà abonar la fiança de ${fianzaEur}.`,
    ...(recordarCondicionesPendientes
      ? [
          "Et recordem també que encara tenim pendent rebre les condicions particulars signades, que haureu de retornar abans de la data de la reserva.",
        ]
      : []),
    "Si tens qualsevol dubte o necessites ajuda amb qualsevol detall de l'organització, estarem encantats d'atendre't.",
    "Moltes gràcies!\nUna abraçada,\nAri — Masia l'Encís",
  ];
  const cuerpoTexto = parrafos.join('\n\n');
  const cuerpoHtml = parrafos
    .map((p) => `<p>${htmlEscape(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
  return { asunto, cuerpoHtml, cuerpoTexto };
};

/**
 * Render real de la plantilla E10 en castellano (fianza devuelta, confirmación). Texto de marca
 * aprobado (fix-liquidacion-fianza-independientes §Email copy). Sin adjuntos. `{nombre}`,
 * `{fianzaEur}`.
 */
const renderE10 = (variables: Record<string, unknown>): RenderPlantilla => {
  const nombre = texto(variables.nombre);
  const fianzaEur = formatarImporteEsLiq(variables.fianzaEur);
  const asunto = 'Te hemos devuelto la fianza';
  const parrafos = [
    `Hola ${nombre},`,
    "¡Esperamos que hayas disfrutado mucho de tu evento en la Masia l'Encís!",
    `Te confirmamos que te hemos devuelto la fianza de ${fianzaEur} mediante transferencia bancaria.`,
    'Si tienes cualquier duda, estaremos encantados de atenderte.',
    "¡Muchas gracias por confiar en nosotros!\nUn abrazo,\nAri — Masia l'Encís",
  ];
  const cuerpoTexto = parrafos.join('\n\n');
  const cuerpoHtml = parrafos
    .map((p) => `<p>${htmlEscape(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
  return { asunto, cuerpoHtml, cuerpoTexto };
};

/** Render real de la plantilla E10 en catalán (fiança retornada, confirmació). */
const renderE10Ca = (variables: Record<string, unknown>): RenderPlantilla => {
  const nombre = texto(variables.nombre);
  const fianzaEur = formatarImporteEsLiq(variables.fianzaEur);
  const asunto = "T'hem retornat la fiança";
  const parrafos = [
    `Hola ${nombre},`,
    "Esperem que hagis gaudit molt del teu esdeveniment a la Masia l'Encís!",
    `Et confirmem que t'hem retornat la fiança de ${fianzaEur} mitjançant transferència bancària.`,
    "Si tens qualsevol dubte, estarem encantats d'atendre't.",
    "Moltes gràcies per confiar en nosaltres!\nUna abraçada,\nAri — Masia l'Encís",
  ];
  const cuerpoTexto = parrafos.join('\n\n');
  const cuerpoHtml = parrafos
    .map((p) => `<p>${htmlEscape(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
  return { asunto, cuerpoHtml, cuerpoTexto };
};

/** Formatea un importe (Decimal string/número) como euros con 2 decimales: `500` → `500,00 €`. */
const formatarImporteEs = (valor: unknown): string => {
  const numero = Number(valor);
  if (Number.isNaN(numero)) {
    return texto(valor);
  }
  return `${numero.toFixed(2).replace('.', ',')} €`;
};

/** Descripción del cambio (es) para el cuerpo del E9. */
const describirCambioEs = (cambio: string): string => {
  switch (cambio) {
    case 'duracion':
      return 'la duración del evento';
    case 'personas_y_duracion':
      return 'el número de personas y la duración del evento';
    default:
      return 'el número de personas';
  }
};

/** Descripción del cambio (ca) para el cuerpo del E9. */
const describirCambioCa = (cambio: string): string => {
  switch (cambio) {
    case 'duracion':
      return 'la durada de l\'esdeveniment';
    case 'personas_y_duracion':
      return 'el nombre de persones i la durada de l\'esdeveniment';
    default:
      return 'el nombre de persones';
  }
};

/**
 * Render real de la plantilla E9 en castellano (modificación de reserva en la ventana viva,
 * change `reserva-viva-edicion-recalculo-ficha` §D-6). Notifica el cambio de personas/duración
 * y el nuevo restante a liquidar (pago inicial ya realizado + liquidación restante, sin reparto
 * 40/60). Adjunto: PDF del presupuesto de modificación (patrón E2). `{nombre}`, `{codigoReserva}`,
 * `{cambio}`, `{liquidacionRestante}`.
 */
const renderE9 = (variables: Record<string, unknown>): RenderPlantilla => {
  const nombre = texto(variables.nombre);
  const codigoReserva = texto(variables.codigoReserva);
  const cambio = describirCambioEs(texto(variables.cambio));
  const restante = formatarImporteEs(variables.liquidacionRestante);
  const referencia = codigoReserva === '' ? '' : ` (reserva ${codigoReserva})`;
  const asunto = `Hemos actualizado tu reserva${referencia}`;
  const parrafos = [
    `Hola ${nombre},`,
    `Hemos actualizado ${cambio} de tu reserva ${codigoReserva}. Te adjuntamos el presupuesto de modificación con el nuevo detalle.`,
    `El pago inicial que ya realizaste se mantiene sin cambios. Liquidación restante: ${restante}, que deberás abonar antes de la fecha del evento.`,
    "Si tienes cualquier duda, estaremos encantados de ayudarte.\nUn abrazo,\nAri\nMasia l'Encís",
  ];
  const cuerpoTexto = parrafos.join('\n\n');
  const cuerpoHtml = parrafos
    .map((p) => `<p>${htmlEscape(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
  return { asunto, cuerpoHtml, cuerpoTexto };
};

/** Render real de la plantilla E9 en catalán (modificación de reserva). Variante catalana. */
const renderE9Ca = (variables: Record<string, unknown>): RenderPlantilla => {
  const nombre = texto(variables.nombre);
  const codigoReserva = texto(variables.codigoReserva);
  const cambio = describirCambioCa(texto(variables.cambio));
  const restante = formatarImporteEs(variables.liquidacionRestante);
  const referencia = codigoReserva === '' ? '' : ` (reserva ${codigoReserva})`;
  const asunto = `Hem actualitzat la teva reserva${referencia}`;
  const parrafos = [
    `Hola ${nombre},`,
    `Hem actualitzat ${cambio} de la teva reserva ${codigoReserva}. T'adjuntem el pressupost de modificació amb el nou detall.`,
    `El pagament inicial que ja vas fer es manté sense canvis. Liquidació restant: ${restante}, que hauràs d'abonar abans de la data de l'esdeveniment.`,
    "Si tens qualsevol dubte, estarem encantats d'ajudar-te.\nUna abraçada,\nAri\nMasia l'Encís",
  ];
  const cuerpoTexto = parrafos.join('\n\n');
  const cuerpoHtml = parrafos
    .map((p) => `<p>${htmlEscape(p).replace(/\n/g, '<br>')}</p>`)
    .join('');
  return { asunto, cuerpoHtml, cuerpoTexto };
};

/** Plantilla E1 ACTIVA en `es` con su contrato de variables requeridas. */
const PLANTILLA_E1_ES: Plantilla = {
  codigoEmail: 'E1',
  idioma: 'es',
  activa: true,
  variablesRequeridas: ['nombre', 'tipoE1'],
  adjuntosRequeridos: [],
  render: renderE1Es,
};

/** Plantilla E1 ACTIVA en `ca` con su contrato de variables requeridas. */
const PLANTILLA_E1_CA: Plantilla = {
  codigoEmail: 'E1',
  idioma: 'ca',
  activa: true,
  variablesRequeridas: ['nombre', 'tipoE1'],
  adjuntosRequeridos: [],
  render: renderE1Ca,
};

/**
 * Plantilla E2 ACTIVA en `es` (presupuesto enviado, workstream C / D-1). El PDF del presupuesto
 * es el adjunto REQUERIDO (`adjuntosRequeridos: ['presupuesto']`, D-1 CERRADA = requerido): sin
 * él el motor BLOQUEA el envío (no se envía un E2 sin presupuesto).
 */
const PLANTILLA_E2_ES: Plantilla = {
  codigoEmail: 'E2',
  idioma: 'es',
  activa: true,
  variablesRequeridas: ['nombre', 'codigoReserva'],
  adjuntosRequeridos: ['presupuesto'],
  render: renderE2,
};

/**
 * Plantilla E2 ACTIVA en `ca` (presupuesto enviado, workstream E del change
 * `presupuesto-confirmar-ux-e2-idioma`). Mismo contrato que la variante `es`
 * (`variablesRequeridas`, `adjuntosRequeridos`), con el texto de marca en catalán.
 */
const PLANTILLA_E2_CA: Plantilla = {
  codigoEmail: 'E2',
  idioma: 'ca',
  activa: true,
  variablesRequeridas: ['nombre', 'codigoReserva'],
  adjuntosRequeridos: ['presupuesto'],
  render: renderE2Ca,
};

/**
 * Plantilla E3 ACTIVA en `es` (factura de señal, texto aprobado). La factura de señal es el
 * adjunto REQUERIDO. Requiere `nombre` y `codigoReserva` (el email ya no es variable de plantilla).
 */
const PLANTILLA_E3_ES: Plantilla = {
  codigoEmail: 'E3',
  idioma: 'es',
  activa: true,
  variablesRequeridas: ['nombre', 'codigoReserva'],
  adjuntosRequeridos: ['senal'],
  render: renderE3,
};

/**
 * Plantilla E3 ACTIVA en `ca` (factura de senyal, texto aprobado). Mismo contrato que la variante
 * `es`, con el texto de marca en catalán.
 */
const PLANTILLA_E3_CA: Plantilla = {
  codigoEmail: 'E3',
  idioma: 'ca',
  activa: true,
  variablesRequeridas: ['nombre', 'codigoReserva'],
  adjuntosRequeridos: ['senal'],
  render: renderE3Ca,
};

/**
 * Plantilla E9 ACTIVA en `es` (modificación de reserva, change `reserva-viva-edicion-recalculo-
 * ficha` §D-6). MVP: se envía SIN adjunto (`adjuntosRequeridos: []`). El PDF del presupuesto de
 * modificación (patrón E2) es deuda técnica del épico #6 (react-pdf): declarar `['presupuesto']`
 * aquí bloquearía el envío (`adjunto_no_disponible`) hasta que exista el generador de PDF de
 * modificación. El cliente recibe igualmente la notificación del cambio de precio (valor principal).
 */
const PLANTILLA_E9_ES: Plantilla = {
  codigoEmail: 'E9',
  idioma: 'es',
  activa: true,
  variablesRequeridas: ['nombre', 'codigoReserva'],
  adjuntosRequeridos: [],
  render: renderE9,
};

/** Plantilla E9 ACTIVA en `ca` (modificación de reserva). Mismo contrato que la variante `es`. */
const PLANTILLA_E9_CA: Plantilla = {
  codigoEmail: 'E9',
  idioma: 'ca',
  activa: true,
  variablesRequeridas: ['nombre', 'codigoReserva'],
  adjuntosRequeridos: [],
  render: renderE9Ca,
};

/**
 * Plantilla E4 ACTIVA en `es` (factura de liquidación, solo liquidación). El PDF de la
 * liquidación es el adjunto REQUERIDO. Requiere `nombre` y `fianzaEur` (recuerda abonar la
 * fianza antes o el día del evento). fix-liquidacion-fianza-independientes.
 */
const PLANTILLA_E4_ES: Plantilla = {
  codigoEmail: 'E4',
  idioma: 'es',
  activa: true,
  variablesRequeridas: ['nombre', 'fianzaEur'],
  adjuntosRequeridos: ['liquidacion'],
  render: renderE4,
};

/** Plantilla E4 ACTIVA en `ca` (factura de liquidació). Mismo contrato que la variante `es`. */
const PLANTILLA_E4_CA: Plantilla = {
  codigoEmail: 'E4',
  idioma: 'ca',
  activa: true,
  variablesRequeridas: ['nombre', 'fianzaEur'],
  adjuntosRequeridos: ['liquidacion'],
  render: renderE4Ca,
};

/**
 * Plantilla E10 ACTIVA en `es` (fianza devuelta, confirmación). Sin adjuntos. Requiere `nombre`
 * y `fianzaEur`. Disparada post-commit best-effort al registrar la devolución completa de la
 * fianza. fix-liquidacion-fianza-independientes §Email copy.
 */
const PLANTILLA_E10_ES: Plantilla = {
  codigoEmail: 'E10',
  idioma: 'es',
  activa: true,
  variablesRequeridas: ['nombre', 'fianzaEur'],
  adjuntosRequeridos: [],
  render: renderE10,
};

/** Plantilla E10 ACTIVA en `ca` (fiança retornada). Mismo contrato que la variante `es`. */
const PLANTILLA_E10_CA: Plantilla = {
  codigoEmail: 'E10',
  idioma: 'ca',
  activa: true,
  variablesRequeridas: ['nombre', 'fianzaEur'],
  adjuntosRequeridos: [],
  render: renderE10Ca,
};

/**
 * Códigos diferidos: declarados como diseñados/inactivos (sin trigger). E4 se ACTIVA
 * (fix-liquidacion-fianza-independientes: liquidación standalone). E5/E8 quedan INACTIVOS
 * (se retiran sus flujos: captura de IBAN eliminada). E9/E10 están ACTIVOS (no diferidos).
 */
const CODIGOS_DIFERIDOS: ReadonlyArray<CodigoEmail> = [
  'E5',
  'E6',
  'E7',
  'E8',
];

/** Construye una entrada inactiva en `es` para un código diferido. */
const plantillaInactivaEs = (codigo: CodigoEmail): Plantilla => ({
  codigoEmail: codigo,
  idioma: 'es',
  activa: false,
  variablesRequeridas: [],
  adjuntosRequeridos: [],
  render: renderInactivo(codigo),
});

/** Construye una entrada inactiva en `ca` para un código diferido. */
const plantillaInactivaCa = (codigo: CodigoEmail): Plantilla => ({
  codigoEmail: codigo,
  idioma: 'ca',
  activa: false,
  variablesRequeridas: [],
  adjuntosRequeridos: [],
  render: renderInactivo(codigo),
});

@Injectable()
export class CatalogoPlantillasEnCodigo implements CatalogoPlantillasPort {
  /** Registro indexado por `codigoEmail` (solo idioma `es` en el MVP). */
  private readonly registroEs: ReadonlyMap<CodigoEmail, Plantilla> = new Map<
    CodigoEmail,
    Plantilla
  >([
    ['E1', PLANTILLA_E1_ES],
    ['E2', PLANTILLA_E2_ES],
    ['E3', PLANTILLA_E3_ES],
    ['E4', PLANTILLA_E4_ES],
    ['E9', PLANTILLA_E9_ES],
    ['E10', PLANTILLA_E10_ES],
    ...CODIGOS_DIFERIDOS.map(
      (codigo): [CodigoEmail, Plantilla] => [codigo, plantillaInactivaEs(codigo)],
    ),
  ]);

  /** Registro indexado por `codigoEmail` en idioma `ca` (E1 activa; resto inactivas). */
  private readonly registroCa: ReadonlyMap<CodigoEmail, Plantilla> = new Map<
    CodigoEmail,
    Plantilla
  >([
    ['E1', PLANTILLA_E1_CA],
    ['E2', PLANTILLA_E2_CA],
    ['E3', PLANTILLA_E3_CA],
    ['E4', PLANTILLA_E4_CA],
    ['E9', PLANTILLA_E9_CA],
    ['E10', PLANTILLA_E10_CA],
    ...CODIGOS_DIFERIDOS.map(
      (codigo): [CodigoEmail, Plantilla] => [codigo, plantillaInactivaCa(codigo)],
    ),
  ]);

  seleccionar(codigoEmail: CodigoEmail, idioma: string): Plantilla | null {
    if (idioma === 'ca') {
      return this.registroCa.get(codigoEmail) ?? null;
    }
    if (idioma === 'es') {
      return this.registroEs.get(codigoEmail) ?? null;
    }
    // Idioma no soportado → `null` para que el motor active su fallback auditado a `es`.
    return null;
  }
}

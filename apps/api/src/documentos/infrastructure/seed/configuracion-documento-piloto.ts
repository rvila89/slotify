/**
 * Factory PURO de los datos de la `PlantillaDocumentoTenant` del tenant piloto
 * Masia l'Encís (épico #6, rebanada 6.1a `documentos-config-tenant-storage`;
 * BILINGÜE es/ca en el change `pdf-presupuesto-horario-idioma`, Mejora 3).
 *
 * Determinista y sin efectos: dado un `tenantId` devuelve siempre la misma
 * configuración. El seed (`prisma/seed.ts`) delega en este factory la
 * construcción de la fila (deleteMany + create), de modo que la regla dura del
 * épico se puede verificar por unit test sin Postgres.
 *
 * REGLA DURA del épico: `plantillaConceptoFiscal` es EXACTAMENTE
 * "Gestió ús espai de {nombreComercial} per esdeveniment" (ca; 6.5, alineado a la
 * referencia real `P2026023`) y NUNCA contiene la palabra "lloguer" en ningún idioma.
 * Datos reales del dossier del piloto (decisión A1: la config duplica sus propios datos
 * fiscales, razón social ≠ nombre comercial).
 *
 * Mejora 3: los cuatro textos libres son bilingües `{ ca, es }`. El `ca` conserva el
 * texto catalán vivo (equivale al backfill del `_ca`); el `es` es la traducción del seed
 * (revisada por el usuario en QA sobre el PDF real).
 *
 * 6.5: `logoUrl` sigue `null` en el factory PURO (determinista y testeable sin
 * side-effects); el seed (`prisma/seed.ts`) sube `masia-logo.jpg` al almacén y
 * SOBRESCRIBE `logoUrl` con la URL resultante. `colorPrimario` es el turquesa de
 * marca `#5edada`.
 */
import type {
  ConfiguracionDocumentoTenant,
  SeccionCondiciones,
} from '../../domain/configuracion-documento';

/** 14 secciones de las "Condicions particulars" del piloto, bilingües ca+es, en orden. */
const seccionesCondiciones = (): SeccionCondiciones[] => [
  {
    titulo: { ca: 'Reserva i pagament', es: 'Reserva y pago' },
    cuerpo: {
      ca: 'El client en dóna la conformitat i accepta les condicions de pagament següent:\n\n- Per confirmar la reserva, cal realitzar un pagament anticipat del 40% de l’import total mitjançant \ntransferència bancària. \n- Per formalitzar el pagament, envieu el comprovant a "info@masialencis.com". \n- Un cop rebut aquest pagament, la reserva quedarà confirmada automàticament. \n- Si el pagament no es rep en un termini màxim de dos dies un cop acceptat el pressupost per \npart del client, la reserva s’anul·larà.\n- El 60% restant s’ha d’abonar com a mínim una setmana abans de la data d’arribada.\n\nEl pagament es pot efectuar mitjançant transferència al núm. de compte:\n\nES30 0182 1683 4002 0172 9599\n\nEs reserva el dret d’admissió.',
      es: 'El cliente da su conformidad y acepta las siguientes condiciones de pago:\n\n- Para confirmar la reserva, es necesario realizar un pago anticipado del 40% del importe total mediante \ntransferencia bancaria. \n- Para formalizar el pago, envíe el comprobante a "info@masialencis.com". \n- Una vez recibido este pago, la reserva quedará confirmada automáticamente. \n- Si el pago no se recibe en un plazo máximo de dos días una vez aceptado el presupuesto por \nparte del cliente, la reserva se anulará.\n- El 60% restante debe abonarse como mínimo una semana antes de la fecha de llegada.\n\nEl pago puede efectuarse mediante transferencia al núm. de cuenta:\n\nES30 0182 1683 4002 0172 9599\n\nSe reserva el derecho de admisión.',
    },
  },
  {
    titulo: { ca: 'Fiança', es: 'Fianza' },
    cuerpo: {
      ca: 'A l\'entrada, el client haurà d\'abonar una fiança de 500€ (no inclosa en el pagament anticipat).\nAquesta serà retornada l\'endemà de la reserva, un cop s’hagi comprovat que no s’han produït \ndesperfectes .\nLa fiança de 500 € garanteix el bon ús de les instal·lacions, jardí, piscina, barbacoa, equipaments, \nmobiliari i elements decoratius i patrimonials de la finca. En cas de danys o desperfectes \nimputables a un mal ús, l’import necessari per a la seva reparació o reposició serà descomptat de \nla fiança, havent d’assumir la persona usuària la diferència si aquests superen l’import dipositat.',
      es: 'A la entrada, el cliente deberá abonar una fianza de 500€ (no incluida en el pago anticipado).\nEsta será devuelta al día siguiente de la reserva, una vez se haya comprobado que no se han producido \ndesperfectos.\nLa fianza de 500 € garantiza el buen uso de las instalaciones, jardín, piscina, barbacoa, equipamientos, \nmobiliario y elementos decorativos y patrimoniales de la finca. En caso de daños o desperfectos \nimputables a un mal uso, el importe necesario para su reparación o reposición será descontado de \nla fianza, debiendo asumir la persona usuaria la diferencia si estos superan el importe depositado.',
    },
  },
  {
    titulo: { ca: 'Política de cancel·lació', es: 'Política de cancelación' },
    cuerpo: {
      ca: 'L’import avançat del 40% no es retornarà en cap cas, excepte en reserves de més de 35 persones \nque s’hagin fet amb una antelació mínima de 6 mesos. En aquest cas, es podrà sol·licitar la \ndevolució si la cancel·lació es comunica amb almenys 2 mesos d’antelació a la data d’arribada. \nL’empresa es reserva el dret d’ anul·lar la reserva per causes externes alienes al client, procedint \nen aquest cas al reemborsament íntegre de l’import abonat.',
      es: 'El importe anticipado del 40% no se devolverá en ningún caso, excepto en reservas de más de 35 personas \nque se hayan realizado con una antelación mínima de 6 meses. En este caso, se podrá solicitar la \ndevolución si la cancelación se comunica con al menos 2 meses de antelación a la fecha de llegada. \nLa empresa se reserva el derecho de anular la reserva por causas externas ajenas al cliente, procediendo \nen este caso al reembolso íntegro del importe abonado.',
    },
  },
  {
    titulo: {
      ca: 'Responsabilitat i dades personals',
      es: 'Responsabilidad y datos personales',
    },
    cuerpo: {
      ca: 'Identificació de la persona responsable\nLa reserva s’ha de fer a nom d’una persona major d’edat, que haurà de facilitar el seu nom \ncomplet, número de DNI/NIE i una còpia del document a efectes d’identificació. \nAquesta persona serà considerada responsable de la reserva i de totes les persones assistents a \nl’activitat.\nResponsabilitat sobre el grup\nLa persona responsable assumeix la responsabilitat de l’ús correcte de les instal·lacions per part \nde tot el grup, així com dels possibles desperfectes, incompliments de les normes o incidències \nque puguin produir-se durant l’estada.\nProtecció de dades\nLes dades personals recollides seran tractades exclusivament per a la gestió de la reserva i \nla seguretat de les instal·lacions. Les dades s’emmagatzemaran de forma segura i es conservaran \núnicament durant el temps necessari per complir aquestes finalitats, sent posteriorment \neliminades. En cap cas seran cedides a tercers, excepte obligació legal.',
      es: 'Identificación de la persona responsable\nLa reserva debe hacerse a nombre de una persona mayor de edad, que deberá facilitar su nombre \ncompleto, número de DNI/NIE y una copia del documento a efectos de identificación. \nEsta persona será considerada responsable de la reserva y de todas las personas asistentes a \nla actividad.\nResponsabilidad sobre el grupo\nLa persona responsable asume la responsabilidad del uso correcto de las instalaciones por parte \nde todo el grupo, así como de los posibles desperfectos, incumplimientos de las normas o incidencias \nque puedan producirse durante la estancia.\nProtección de datos\nLos datos personales recogidos serán tratados exclusivamente para la gestión de la reserva y \nla seguridad de las instalaciones. Los datos se almacenarán de forma segura y se conservarán \núnicamente durante el tiempo necesario para cumplir estas finalidades, siendo posteriormente \neliminados. En ningún caso serán cedidos a terceros, salvo obligación legal.',
    },
  },
  {
    titulo: { ca: 'Visites', es: 'Visitas' },
    cuerpo: {
      ca: 'El preu de la reserva inclou una visita prèvia a les instal·lacions abans de la formalització de \nl’esdeveniment, amb la finalitat de conèixer l’espai i resoldre dubtes organitzatius. Qualsevol visita \naddicional i/o accés extraordinari haurà de ser autoritzada expressament per la propietat i podrà \ncomportar un cost addicional de 20€/hora.',
      es: 'El precio de la reserva incluye una visita previa a las instalaciones antes de la formalización del \nevento, con la finalidad de conocer el espacio y resolver dudas organizativas. Cualquier visita \nadicional y/o acceso extraordinario deberá ser autorizada expresamente por la propiedad y podrá \nconllevar un coste adicional de 20€/hora.',
    },
  },
  {
    titulo: { ca: 'Neteja', es: 'Limpieza' },
    cuerpo: {
      ca: 'Servei de neteja no inclòs. L\'espai s\'ha de deixar net i en les mateixes condicions en què s\'ha \ntrobat.\nEn reserves superiors a 20 persones i si s’utilitza la vaixella i estris de la masia, s’haurà de contractar \nun servei de neteja amb un cost addicional de 100€, que inclou únicament la neteja de la vaixella i \nestris. En aquests casos, s\'haurà de deixar la vaixella i els estris sense restes i dipositats al lloc indicat \nper a la seva neteja posterior per part de l\'organització. En el cas de contractar aquest servei, \nigualment s\'haurà de deixar l\'espai recollit i ordenat.\nEs podrà aplicar un recàrrec si l’espai no es deixa net i ordenat.',
      es: 'Servicio de limpieza no incluido. El espacio debe dejarse limpio y en las mismas condiciones en que se ha \nencontrado.\nEn reservas superiores a 20 personas y si se utiliza la vajilla y los utensilios de la masía, se deberá contratar \nun servicio de limpieza con un coste adicional de 100€, que incluye únicamente la limpieza de la vajilla y \nutensilios. En estos casos, se deberá dejar la vajilla y los utensilios sin restos y depositados en el lugar indicado \npara su limpieza posterior por parte de la organización. En caso de contratar este servicio, \nigualmente se deberá dejar el espacio recogido y ordenado.\nSe podrá aplicar un recargo si el espacio no se deja limpio y ordenado.',
    },
  },
  {
    titulo: { ca: 'Gestió de residus', es: 'Gestión de residuos' },
    cuerpo: {
      ca: 'Tota la brossa generada durant l’estada s’ha de dipositar als contenidors habilitats. En cas de no \nefectuar la recollida selectiva (reciclatge), el client s\'haurà d\'endur tots els residus generats. \nSi s\'utilitza la barbacoa, cal deixar les cendres a l’interior un cop finalitzat l’ús.',
      es: 'Toda la basura generada durante la estancia debe depositarse en los contenedores habilitados. En caso de no \nefectuar la recogida selectiva (reciclaje), el cliente deberá llevarse todos los residuos generados. \nSi se utiliza la barbacoa, hay que dejar las cenizas en el interior una vez finalizado el uso.',
    },
  },
  {
    titulo: { ca: 'Horaris', es: 'Horarios' },
    cuerpo: {
      ca: 'Els serveis es duen a terme en franges horàries concertades prèviament. L’horari habitual de \nservei és de 9:00 a 23:00 hores. Tot i això, oferim una certa flexibilitat horària segons les necessitats \ndel client. La puntualitat és essencial per al bon funcionament.',
      es: 'Los servicios se llevan a cabo en franjas horarias concertadas previamente. El horario habitual de \nservicio es de 9:00 a 23:00 horas. No obstante, ofrecemos cierta flexibilidad horaria según las necesidades \ndel cliente. La puntualidad es esencial para el buen funcionamiento.',
    },
  },
  {
    titulo: { ca: "Excés d'horari", es: 'Exceso de horario' },
    cuerpo: {
      ca: 'Durant l\'estada, es podrà sol·licitar l\'ampliació de les hores contractades, subjecta a disponibilitat i \namb aplicació del suplement corresponent segons franja horària, nombre de persones i temporada \nvigent. \nEn cas d\'excedir l\'horari contractat, s\'aplicarà un suplement segons la franja de persones i la \ntemporada vigent. Aquesta normativa s\'aplica quan el client excedeix els 30 minuts fora d\'horari.',
      es: 'Durante la estancia, se podrá solicitar la ampliación de las horas contratadas, sujeta a disponibilidad y \ncon aplicación del suplemento correspondiente según franja horaria, número de personas y temporada \nvigente. \nEn caso de exceder el horario contratado, se aplicará un suplemento según la franja de personas y la \ntemporada vigente. Esta normativa se aplica cuando el cliente excede los 30 minutos fuera de horario.',
    },
  },
  {
    titulo: {
      ca: 'Normes de convivència i ús responsable',
      es: 'Normas de convivencia y uso responsable',
    },
    cuerpo: {
      ca: 'L\'espai d\'ús està delimitat per una tanca perimetral, queda prohibit sortir d\'aquesta zona.\nEstà prohibit fumar tant a la zona de gespa com a l’entorn de la piscina. Les plantes són \nexlusivament d\'ús decoratiu, no es poden tocar ni trepitjar. Està totalment prohibit pujar al pou i \npujar-se o saltar sobre les pedres de la piscina. No ens fem responsables d’objectes perduts durant \nl’estada. No està permès l\'ús de globus amb confeti ni de qualsevol altre element que contingui \nmaterial dispersable o de difícil recollida, tant a l\'interior com a l\'exterior de la finca. \nNo es permeten mascotes.',
      es: 'El espacio de uso está delimitado por una valla perimetral, queda prohibido salir de esta zona.\nEstá prohibido fumar tanto en la zona de césped como en el entorno de la piscina. Las plantas son \nexclusivamente de uso decorativo, no se pueden tocar ni pisar. Está totalmente prohibido subir al pozo y \nsubirse o saltar sobre las piedras de la piscina. No nos hacemos responsables de objetos perdidos durante \nla estancia. No está permitido el uso de globos con confeti ni de cualquier otro elemento que contenga \nmaterial dispersable o de difícil recogida, tanto en el interior como en el exterior de la finca. \nNo se permiten mascotas.',
    },
  },
  {
    titulo: { ca: 'Capacitat', es: 'Capacidad' },
    cuerpo: {
      ca: 'El menjador interior té capacitat per a 30 comensals. És important respectar l’aforament establert \nper garantir la seguretat i la comoditat de tothom.',
      es: 'El comedor interior tiene capacidad para 30 comensales. Es importante respetar el aforo establecido \npara garantizar la seguridad y la comodidad de todos.',
    },
  },
  {
    titulo: { ca: 'Piscina', es: 'Piscina' },
    cuerpo: {
      ca: 'Prohibit pujar o saltar des de les pedres a la piscina. Els menors han d’estar sempre sota la \nsupervisió d’un adult. Prohibit portar vidre a la zona de piscina per motius de seguretat.',
      es: 'Prohibido subir o saltar desde las piedras a la piscina. Los menores deben estar siempre bajo la \nsupervisión de un adulto. Prohibido llevar vidrio a la zona de piscina por motivos de seguridad.',
    },
  },
  {
    titulo: { ca: 'Música i respecte veïnal', es: 'Música y respeto vecinal' },
    cuerpo: {
      ca: 'Es permet música ambiental a un volum moderat, però no es permeten equips de so de gran \npotència. Fora de l’horari de servei, el volum haurà de reduir-se de moderat a baix.',
      es: 'Se permite música ambiental a un volumen moderado, pero no se permiten equipos de sonido de gran \npotencia. Fuera del horario de servicio, el volumen deberá reducirse de moderado a bajo.',
    },
  },
  {
    titulo: { ca: 'Parking', es: 'Parking' },
    cuerpo: {
      ca: 'Els vehicles s\'han d\'estacionar exclusivament a la zona d\'aparcament habilitada i senyalitzada de la \nfinca. No es permet estacionar al voral de la carretera ni en altres espais no autoritzats.',
      es: 'Los vehículos deben estacionarse exclusivamente en la zona de aparcamiento habilitada y señalizada de la \nfinca. No se permite estacionar en el arcén de la carretera ni en otros espacios no autorizados.',
    },
  },
];

export const construirConfiguracionDocumentoPiloto = (
  tenantId: string,
): ConfiguracionDocumentoTenant => ({
  tenantId,
  branding: {
    logoUrl: null,
    colorPrimario: '#5edada',
    colorTexto: '#333333',
  },
  identidadFiscal: {
    razonSocialFiscal: 'Canoliart, SL',
    nombreComercial: "Masia l'Encís",
    nif: 'B10874287',
    direccionFiscal: '08731 - Sant Martí Sarroca / Barcelona',
    web: 'www.masialencis.com',
    email: 'info@masialencis.com',
  },
  banca: {
    iban: 'ES30 0182 1683 4002 0172 9599',
    beneficiarioTransferencia: 'Canoliart, SL',
    conceptoTransferencia: "Masia l'Encís",
  },
  textos: {
    plantillaConceptoFiscal: {
      ca: 'Gestió ús espai de {nombreComercial} per esdeveniment',
      es: 'Gestión de uso del espacio de {nombreComercial} para evento',
    },
    validesaTexto: { ca: '10 DIES', es: '10 DÍAS' },
    pieLegal: {
      ca:
        "Aquest document té una validesa de 10 dies des de la seva emissió. " +
        "L'acceptació del pressupost i el pagament de la senyal impliquen la " +
        "conformitat amb les condicions particulars de l'esdeveniment.",
      es:
        'Este documento tiene una validez de 10 días desde su emisión. ' +
        'La aceptación del presupuesto y el pago de la señal implican la ' +
        'conformidad con las condiciones particulares del evento.',
    },
  },
  condiciones: {
    titulo: { ca: 'Condicions Particulars', es: 'Condiciones Particulares' },
    secciones: seccionesCondiciones(),
  },
});

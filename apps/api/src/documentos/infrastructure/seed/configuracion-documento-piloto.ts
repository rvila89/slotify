/**
 * Factory PURO de los datos de la `PlantillaDocumentoTenant` del tenant piloto
 * Masia l'Encís (épico #6, rebanada 6.1a `documentos-config-tenant-storage`).
 *
 * Determinista y sin efectos: dado un `tenantId` devuelve siempre la misma
 * configuración. El seed (`prisma/seed.ts`) delega en este factory la
 * construcción de la fila (deleteMany + create), de modo que la regla dura del
 * épico se puede verificar por unit test sin Postgres.
 *
 * REGLA DURA del épico: `plantillaConceptoFiscal` es EXACTAMENTE
 * "Gestió de l'ús espai de {nombreComercial} per esdeveniment" y NUNCA contiene
 * la palabra "lloguer". Datos reales del dossier del piloto (decisión A1: la
 * config duplica sus propios datos fiscales, razón social ≠ nombre comercial).
 */
import type { ConfiguracionDocumentoTenant } from '../../domain/configuracion-documento';

export const construirConfiguracionDocumentoPiloto = (
  tenantId: string,
): ConfiguracionDocumentoTenant => ({
  tenantId,
  branding: {
    logoUrl: null,
    colorPrimario: '#1A1A1A',
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
    plantillaConceptoFiscal:
      "Gestió de l'ús espai de {nombreComercial} per esdeveniment",
    validesaTexto: '10 DIES',
    pieLegal:
      "Aquest document té una validesa de 10 dies des de la seva emissió. " +
      "L'acceptació del pressupost i el pagament de la senyal impliquen la " +
      "conformitat amb les condicions particulars de l'esdeveniment.",
  },
  condiciones: {
    titulo: 'Condicions Particulars',
    secciones: [
      {
        titulo: 'Reserva i pagament',
        cuerpo:
          'El client en dóna la conformitat i accepta les condicions de pagament següent:\n\n- Per confirmar la reserva, cal realitzar un pagament anticipat del 40% de l’import total mitjançant \ntransferència bancària. \n- Per formalitzar el pagament, envieu el comprovant a "info@masialencis.com". \n- Un cop rebut aquest pagament, la reserva quedarà confirmada automàticament. \n- Si el pagament no es rep en un termini màxim de dos dies un cop acceptat el pressupost per \npart del client, la reserva s’anul·larà.\n- El 60% restant s’ha d’abonar com a mínim una setmana abans de la data d’arribada.\n\nEl pagament es pot efectuar mitjançant transferència al núm. de compte:\n\nES30 0182 1683 4002 0172 9599\n\nEs reserva el dret d’admissió.',
      },
      {
        titulo: 'Fiança',
        cuerpo:
          'A l\'entrada, el client haurà d\'abonar una fiança de 500€ (no inclosa en el pagament anticipat).\nAquesta serà retornada l\'endemà de la reserva, un cop s’hagi comprovat que no s’han produït \ndesperfectes .\nLa fiança de 500 € garanteix el bon ús de les instal·lacions, jardí, piscina, barbacoa, equipaments, \nmobiliari i elements decoratius i patrimonials de la finca. En cas de danys o desperfectes \nimputables a un mal ús, l’import necessari per a la seva reparació o reposició serà descomptat de \nla fiança, havent d’assumir la persona usuària la diferència si aquests superen l’import dipositat.',
      },
      {
        titulo: 'Política de cancel·lació',
        cuerpo:
          'L’import avançat del 40% no es retornarà en cap cas, excepte en reserves de més de 35 persones \nque s’hagin fet amb una antelació mínima de 6 mesos. En aquest cas, es podrà sol·licitar la \ndevolució si la cancel·lació es comunica amb almenys 2 mesos d’antelació a la data d’arribada. \nL’empresa es reserva el dret d’ anul·lar la reserva per causes externes alienes al client, procedint \nen aquest cas al reemborsament íntegre de l’import abonat.',
      },
      {
        titulo: 'Responsabilitat i dades personals',
        cuerpo:
          'Identificació de la persona responsable\nLa reserva s’ha de fer a nom d’una persona major d’edat, que haurà de facilitar el seu nom \ncomplet, número de DNI/NIE i una còpia del document a efectes d’identificació. \nAquesta persona serà considerada responsable de la reserva i de totes les persones assistents a \nl’activitat.\nResponsabilitat sobre el grup\nLa persona responsable assumeix la responsabilitat de l’ús correcte de les instal·lacions per part \nde tot el grup, així com dels possibles desperfectes, incompliments de les normes o incidències \nque puguin produir-se durant l’estada.\nProtecció de dades\nLes dades personals recollides seran tractades exclusivament per a la gestió de la reserva i \nla seguretat de les instal·lacions. Les dades s’emmagatzemaran de forma segura i es conservaran \núnicament durant el temps necessari per complir aquestes finalitats, sent posteriorment \neliminades. En cap cas seran cedides a tercers, excepte obligació legal.',
      },
      {
        titulo: 'Visites',
        cuerpo:
          'El preu de la reserva inclou una visita prèvia a les instal·lacions abans de la formalització de \nl’esdeveniment, amb la finalitat de conèixer l’espai i resoldre dubtes organitzatius. Qualsevol visita \naddicional i/o accés extraordinari haurà de ser autoritzada expressament per la propietat i podrà \ncomportar un cost addicional de 20€/hora.',
      },
      {
        titulo: 'Neteja',
        cuerpo:
          'Servei de neteja no inclòs. L\'espai s\'ha de deixar net i en les mateixes condicions en què s\'ha \ntrobat.\nEn reserves superiors a 20 persones i si s’utilitza la vaixella i estris de la masia, s’haurà de contractar \nun servei de neteja amb un cost addicional de 100€, que inclou únicament la neteja de la vaixella i \nestris. En aquests casos, s\'haurà de deixar la vaixella i els estris sense restes i dipositats al lloc indicat \nper a la seva neteja posterior per part de l\'organització. En el cas de contractar aquest servei, \nigualment s\'haurà de deixar l\'espai recollit i ordenat.\nEs podrà aplicar un recàrrec si l’espai no es deixa net i ordenat.',
      },
      {
        titulo: 'Gestió de residus',
        cuerpo:
          'Tota la brossa generada durant l’estada s’ha de dipositar als contenidors habilitats. En cas de no \nefectuar la recollida selectiva (reciclatge), el client s\'haurà d\'endur tots els residus generats. \nSi s\'utilitza la barbacoa, cal deixar les cendres a l’interior un cop finalitzat l’ús.',
      },
      {
        titulo: 'Horaris',
        cuerpo:
          'Els serveis es duen a terme en franges horàries concertades prèviament. L’horari habitual de \nservei és de 9:00 a 23:00 hores. Tot i això, oferim una certa flexibilitat horària segons les necessitats \ndel client. La puntualitat és essencial per al bon funcionament.',
      },
      {
        titulo: 'Excés d\'horari',
        cuerpo:
          'Durant l\'estada, es podrà sol·licitar l\'ampliació de les hores contractades, subjecta a disponibilitat i \namb aplicació del suplement corresponent segons franja horària, nombre de persones i temporada \nvigent. \nEn cas d\'excedir l\'horari contractat, s\'aplicarà un suplement segons la franja de persones i la \ntemporada vigent. Aquesta normativa s\'aplica quan el client excedeix els 30 minuts fora d\'horari.',
      },
      {
        titulo: 'Normes de convivència i ús responsable',
        cuerpo:
          'L\'espai d\'ús està delimitat per una tanca perimetral, queda prohibit sortir d\'aquesta zona.\nEstà prohibit fumar tant a la zona de gespa com a l’entorn de la piscina. Les plantes són \nexlusivament d\'ús decoratiu, no es poden tocar ni trepitjar. Està totalment prohibit pujar al pou i \npujar-se o saltar sobre les pedres de la piscina. No ens fem responsables d’objectes perduts durant \nl’estada. No està permès l\'ús de globus amb confeti ni de qualsevol altre element que contingui \nmaterial dispersable o de difícil recollida, tant a l\'interior com a l\'exterior de la finca. \nNo es permeten mascotes.',
      },
      {
        titulo: 'Capacitat',
        cuerpo:
          'El menjador interior té capacitat per a 30 comensals. És important respectar l’aforament establert \nper garantir la seguretat i la comoditat de tothom.',
      },
      {
        titulo: 'Piscina',
        cuerpo:
          'Prohibit pujar o saltar des de les pedres a la piscina. Els menors han d’estar sempre sota la \nsupervisió d’un adult. Prohibit portar vidre a la zona de piscina per motius de seguretat.',
      },
      {
        titulo: 'Música i respecte veïnal',
        cuerpo:
          'Es permet música ambiental a un volum moderat, però no es permeten equips de so de gran \npotència. Fora de l’horari de servei, el volum haurà de reduir-se de moderat a baix.',
      },
      {
        titulo: 'Parking',
        cuerpo:
          'Els vehicles s\'han d\'estacionar exclusivament a la zona d\'aparcament habilitada i senyalitzada de la \nfinca. No es permet estacionar al voral de la carretera ni en altres espais no autoritzats.',
      },
    ],
  },
});

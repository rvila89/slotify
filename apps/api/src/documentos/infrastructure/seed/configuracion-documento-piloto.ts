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
});

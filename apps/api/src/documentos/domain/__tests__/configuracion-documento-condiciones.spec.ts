/**
 * TESTS del bloque `condiciones` del VO de dominio `ConfiguracionDocumentoTenant`
 * (épico #6, rebanada 6.4a `documentos-condiciones-particulares-pdf`) — fase TDD
 * RED. tasks.md Fase 2: 2.1.
 *
 * Trazabilidad: design.md §"Config `condiciones` en el VO + migración Prisma".
 * El VO gana un bloque `condiciones: CondicionesDocumento`, con
 *   CondicionesDocumento = { titulo: string; secciones: SeccionCondiciones[] }
 *   SeccionCondiciones  = { titulo: string; cuerpo: string }
 *
 * ESTRATEGIA: es un tipo PURO de dominio (sin react-pdf ni Prisma). El test es de
 * FORMA/TIPOS: construye un `ConfiguracionDocumentoTenant` válido CON el bloque
 * `condiciones` y afirma su forma; una comprobación a nivel de tipo asegura que
 * `SeccionCondiciones` y `CondicionesDocumento` existen con el shape esperado.
 *
 * RED: el bloque `condiciones` y los tipos `CondicionesDocumento`/
 * `SeccionCondiciones` aún NO existen en
 * `documentos/domain/configuracion-documento.ts`. El import de los tipos y el
 * literal con `condiciones` fallan a compilar (TS) → batería en ROJO por AUSENCIA
 * DE IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import type {
  ConfiguracionDocumentoTenant,
  CondicionesDocumento,
  SeccionCondiciones,
} from '../configuracion-documento';

const TENANT = '00000000-0000-0000-0000-000000000001';

/** Construye una config válida CON el bloque `condiciones`. */
const configConCondiciones = (
  condiciones: CondicionesDocumento,
): ConfiguracionDocumentoTenant => ({
  tenantId: TENANT,
  branding: { logoUrl: null, colorPrimario: '#1A1A1A', colorTexto: '#333333' },
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
    pieLegal: 'Validesa 10 dies.',
  },
  condiciones,
});

describe('ConfiguracionDocumentoTenant — bloque condiciones (2.1)', () => {
  it('debe_aceptar_una_config_con_titulo_y_lista_de_secciones', () => {
    // Arrange
    const seccion: SeccionCondiciones = {
      titulo: 'Reserva i pagament',
      cuerpo: 'Text de la secció.',
    };
    const condiciones: CondicionesDocumento = {
      titulo: 'Condicions Particulars',
      secciones: [seccion],
    };

    // Act
    const config = configConCondiciones(condiciones);

    // Assert — forma del bloque.
    expect(config.condiciones.titulo).toBe('Condicions Particulars');
    expect(config.condiciones.secciones).toHaveLength(1);
    expect(config.condiciones.secciones[0].titulo).toBe('Reserva i pagament');
    expect(config.condiciones.secciones[0].cuerpo).toBe('Text de la secció.');
  });

  it('debe_permitir_una_lista_de_secciones_vacia_en_el_tipo', () => {
    // El tipo tolera 0 secciones (la degradación a null la decide el adapter, D3).
    const config = configConCondiciones({ titulo: 'Condicions Particulars', secciones: [] });

    expect(config.condiciones.secciones).toEqual([]);
  });

  it('debe_exponer_cada_seccion_como_par_titulo_cuerpo', () => {
    // Comprobación a nivel de tipo: SeccionCondiciones = { titulo, cuerpo }.
    const secciones: SeccionCondiciones[] = [
      { titulo: 'Fiança', cuerpo: 'Cos 1' },
      { titulo: 'Neteja', cuerpo: 'Cos 2' },
    ];
    const config = configConCondiciones({ titulo: 'Condicions Particulars', secciones });

    for (const seccion of config.condiciones.secciones) {
      expect(typeof seccion.titulo).toBe('string');
      expect(typeof seccion.cuerpo).toBe('string');
    }
  });
});

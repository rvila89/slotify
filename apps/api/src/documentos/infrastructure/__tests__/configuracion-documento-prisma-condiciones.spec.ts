/**
 * TEST UNIT (Prisma mockeado) del mapeo de la columna JSON `condiciones` en
 * `ConfiguracionDocumentoPrismaAdapter` (épico #6, rebanada 6.4a
 * `documentos-condiciones-particulares-pdf`) — fase TDD RED. tasks.md Fase 2: 2.3.
 *
 * Trazabilidad: design.md §"Config `condiciones` en el VO + migración Prisma"
 * (`ConfiguracionDocumentoPrismaAdapter.aDominio(...)` mapea la columna JSON
 * `condiciones` al bloque `condiciones` del VO; cast tipado del `Json` de Prisma a
 * `CondicionesDocumento`).
 *
 * ESTRATEGIA: es UNIT, NO integración (los subagentes QA no tienen Postgres). Se
 * dobla `PrismaService`: `$transaction(cb)` invoca el callback con un `tx` cuyo
 * `plantillaDocumentoTenant.findUnique` devuelve una fila fabricada con la columna
 * `condiciones` como JSON. Se afirma que el VO devuelto expone `condiciones` con el
 * título y las secciones de esa columna. El aislamiento RLS/estructura de tabla se
 * verifica en el test de integración SQL real (`configuracion-documento-integracion`)
 * desde la sesión principal.
 *
 * RED: `aDominio` aún NO mapea la columna `condiciones` (y el VO ni siquiera tiene el
 * bloque). El acceso a `config.condiciones` está indefinido / no compila → batería en
 * ROJO por AUSENCIA DE IMPLEMENTACIÓN. GREEN es de `backend-developer`.
 */
import { ConfiguracionDocumentoPrismaAdapter } from '../configuracion-documento.prisma.adapter';
import type { PrismaService } from '../../../shared/prisma/prisma.service';

const TENANT = '00000000-0000-0000-0000-000000000001';

/** Bloque `condiciones` bilingüe tal como viaja en la columna JSON de Prisma. */
const condicionesJson = {
  titulo: { ca: 'Condicions Particulars', es: 'Condiciones Particulares' },
  secciones: [
    {
      titulo: { ca: 'Reserva i pagament', es: 'Reserva y pago' },
      cuerpo: { ca: 'Cos reserva.', es: 'Cuerpo reserva.' },
    },
    {
      titulo: { ca: 'Fiança', es: 'Fianza' },
      cuerpo: { ca: 'Cos fiança.', es: 'Cuerpo fianza.' },
    },
  ],
};

/** Fila `PlantillaDocumentoTenant` fabricada (incluye la columna JSON `condiciones`). */
const filaPrisma = () => ({
  tenantId: TENANT,
  logoUrl: null,
  colorPrimario: '#1A1A1A',
  colorTexto: '#333333',
  razonSocialFiscal: 'Canoliart, SL',
  nombreComercial: "Masia l'Encís",
  nif: 'B10874287',
  direccionFiscal: '08731 - Sant Martí Sarroca / Barcelona',
  web: 'www.masialencis.com',
  email: 'info@masialencis.com',
  iban: 'ES30 0182 1683 4002 0172 9599',
  beneficiarioTransferencia: 'Canoliart, SL',
  conceptoTransferencia: "Masia l'Encís",
  plantillaConceptoFiscalCa: "Gestió de l'ús espai de {nombreComercial} per esdeveniment",
  plantillaConceptoFiscalEs: 'Gestión del uso del espacio de {nombreComercial} para evento',
  validesaTextoCa: '10 DIES',
  validesaTextoEs: '10 DÍAS',
  pieLegalCa: 'Validesa 10 dies.',
  pieLegalEs: 'Validez 10 días.',
  condiciones: condicionesJson,
});

/**
 * Doble de `PrismaService`: `$transaction(cb)` corre el callback con un `tx` cuyo
 * `plantillaDocumentoTenant.findUnique` devuelve la fila dada; `fijarTenant` es un
 * no-op espiado.
 */
const prismaFalso = (fila: ReturnType<typeof filaPrisma> | null): PrismaService => {
  const tx = {
    plantillaDocumentoTenant: { findUnique: jest.fn(async () => fila) },
  };
  return {
    fijarTenant: jest.fn(async () => undefined),
    $transaction: jest.fn(async (cb: (t: typeof tx) => unknown) => cb(tx)),
  } as unknown as PrismaService;
};

describe('ConfiguracionDocumentoPrismaAdapter — mapea la columna JSON condiciones (2.3)', () => {
  it('debe_mapear_titulo_y_secciones_de_la_columna_condiciones_al_VO', async () => {
    // Arrange
    const adaptador = new ConfiguracionDocumentoPrismaAdapter(prismaFalso(filaPrisma()));

    // Act
    const config = await adaptador.obtenerPorTenant(TENANT);

    // Assert — el bloque condiciones bilingüe del VO refleja la columna JSON.
    expect(config).not.toBeNull();
    expect(config?.condiciones.titulo.ca).toBe('Condicions Particulars');
    expect(config?.condiciones.titulo.es).toBe('Condiciones Particulares');
    expect(config?.condiciones.secciones).toEqual([
      {
        titulo: { ca: 'Reserva i pagament', es: 'Reserva y pago' },
        cuerpo: { ca: 'Cos reserva.', es: 'Cuerpo reserva.' },
      },
      {
        titulo: { ca: 'Fiança', es: 'Fianza' },
        cuerpo: { ca: 'Cos fiança.', es: 'Cuerpo fianza.' },
      },
    ]);
    // Los textos libres se mapean a objetos bilingües.
    expect(config?.textos.validesaTexto).toEqual({ ca: '10 DIES', es: '10 DÍAS' });
  });

  it('debe_devolver_null_cuando_no_hay_fila_para_el_tenant', async () => {
    const adaptador = new ConfiguracionDocumentoPrismaAdapter(prismaFalso(null));

    const config = await adaptador.obtenerPorTenant(TENANT);

    expect(config).toBeNull();
  });
});

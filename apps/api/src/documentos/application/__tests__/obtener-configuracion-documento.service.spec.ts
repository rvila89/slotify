/**
 * TESTS del servicio de lectura de la config de documento del tenant
 * `ObtenerConfiguracionDocumentoService` (épico #6, rebanada 6.1a
 * `documentos-config-tenant-storage`) — fase TDD RED. tasks.md Fase 2: 2.2.
 *
 * Trazabilidad: spec-delta `documentos` (Requirement "Configuración de documento
 * por tenant (PlantillaDocumentoTenant)"; Scenario "La razón social fiscal y el
 * nombre comercial son campos distintos"; Requirement "Aislamiento multi-tenant con
 * RLS de la configuración de documento"; Scenario "Un tenant no ve la configuración
 * de otro tenant"), design.md §Arquitectura hexagonal (servicio de lectura +
 * puerto de repositorio) + §Matiz razón social fiscal ≠ nombre comercial.
 * Decisión A1 (duplicar): la config es la FUENTE DE VERDAD, con datos fiscales
 * propios (razonSocialFiscal ≠ nombreComercial).
 *
 * Ejercita el servicio de APLICACIÓN contra un DOBLE del puerto de repositorio de
 * lectura (in-memory). No toca Prisma ni la BD (hexagonal; hook `no-infra-in-domain`).
 * El aislamiento REAL por RLS se verifica en QA contra Postgres (tasks.md 4.4);
 * aquí se verifica que el servicio consulta por tenant y NO devuelve la config de
 * otro tenant.
 *
 * RED: aún no existen
 *   - `documentos/application/obtener-configuracion-documento.service.ts`
 *   - `documentos/domain/configuracion-documento.repository.port.ts`
 *   - `documentos/domain/configuracion-documento.ts` (VO de config)
 * Los imports fallan (TS2307) y la batería está en ROJO. GREEN = `backend-developer`.
 */
import { ObtenerConfiguracionDocumentoService } from '../obtener-configuracion-documento.service';
import type { ConfiguracionDocumentoRepositoryPort } from '../../domain/configuracion-documento.repository.port';
import type { ConfiguracionDocumentoTenant } from '../../domain/configuracion-documento';

// ---------------------------------------------------------------------------
// Datos canónicos (alineados con el seed del piloto Masia l'Encís).
// ---------------------------------------------------------------------------

const TENANT_A = '00000000-0000-0000-0000-000000000001';
const TENANT_B = '00000000-0000-0000-0000-0000000000ff';

const configTenantA = (): ConfiguracionDocumentoTenant => ({
  tenantId: TENANT_A,
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
    plantillaConceptoFiscal: "Gestió de l'ús espai de {nombreComercial} per esdeveniment",
    validesaTexto: '10 DIES',
    pieLegal: 'Text legal del peu del document.',
  },
  condiciones: {
    titulo: 'Condicions Particulars',
    secciones: [{ titulo: 'Reserva i pagament', cuerpo: 'Cos.' }],
  },
});

const configTenantB = (): ConfiguracionDocumentoTenant => ({
  ...configTenantA(),
  tenantId: TENANT_B,
  identidadFiscal: {
    ...configTenantA().identidadFiscal,
    razonSocialFiscal: 'Otro Tenant, SL',
    nombreComercial: 'Marca Vecina',
    nif: 'B00000000',
  },
});

// Doble in-memory del puerto de repositorio de lectura: aísla por tenantId.
const repoConfigsPorTenant = (
  configs: ConfiguracionDocumentoTenant[],
): ConfiguracionDocumentoRepositoryPort => ({
  obtenerPorTenant: async (tenantId) =>
    configs.find((c) => c.tenantId === tenantId) ?? null,
});

describe('ObtenerConfiguracionDocumentoService — lectura de config por tenant (2.2)', () => {
  it('debe_resolver_la_configuracion_del_tenant_solicitado', async () => {
    // Arrange
    const repo = repoConfigsPorTenant([configTenantA()]);
    const servicio = new ObtenerConfiguracionDocumentoService(repo);

    // Act
    const config = await servicio.ejecutar(TENANT_A);

    // Assert
    expect(config).not.toBeNull();
    expect(config?.tenantId).toBe(TENANT_A);
  });

  it('debe_exponer_razonSocialFiscal_y_nombreComercial_como_campos_DISTINTOS', async () => {
    // Arrange — matiz central del épico: razón social fiscal ≠ nombre comercial.
    const repo = repoConfigsPorTenant([configTenantA()]);
    const servicio = new ObtenerConfiguracionDocumentoService(repo);

    // Act
    const config = await servicio.ejecutar(TENANT_A);

    // Assert
    expect(config?.identidadFiscal.razonSocialFiscal).toBe('Canoliart, SL');
    expect(config?.identidadFiscal.nombreComercial).toBe("Masia l'Encís");
    expect(config?.identidadFiscal.razonSocialFiscal).not.toBe(
      config?.identidadFiscal.nombreComercial,
    );
  });

  it('debe_exponer_los_cuatro_bloques_branding_identidad_banca_textos', async () => {
    // Arrange
    const repo = repoConfigsPorTenant([configTenantA()]);
    const servicio = new ObtenerConfiguracionDocumentoService(repo);

    // Act
    const config = await servicio.ejecutar(TENANT_A);

    // Assert — NIF, dirección, banca y textos accesibles como campos propios.
    expect(config?.identidadFiscal.nif).toBe('B10874287');
    expect(config?.identidadFiscal.direccionFiscal).toContain('Sant Martí Sarroca');
    expect(config?.banca.iban).toBe('ES30 0182 1683 4002 0172 9599');
    expect(config?.banca.beneficiarioTransferencia).toBe('Canoliart, SL');
    expect(config?.textos.plantillaConceptoFiscal).toContain('espai');
    expect(config?.textos.validesaTexto).toBe('10 DIES');
  });

  it('debe_devolver_null_cuando_el_tenant_no_tiene_configuracion', async () => {
    // Arrange
    const repo = repoConfigsPorTenant([]);
    const servicio = new ObtenerConfiguracionDocumentoService(repo);

    // Act
    const config = await servicio.ejecutar(TENANT_A);

    // Assert
    expect(config).toBeNull();
  });

  it('debe_aislar_por_tenant_y_NO_devolver_la_configuracion_de_otro_tenant', async () => {
    // Arrange — dos tenants con config propia; se consulta bajo el tenant A.
    const repo = repoConfigsPorTenant([configTenantA(), configTenantB()]);
    const servicio = new ObtenerConfiguracionDocumentoService(repo);

    // Act
    const config = await servicio.ejecutar(TENANT_A);

    // Assert — solo la config del tenant A; la del B no se filtra.
    expect(config?.tenantId).toBe(TENANT_A);
    expect(config?.identidadFiscal.razonSocialFiscal).toBe('Canoliart, SL');
    expect(config?.identidadFiscal.nombreComercial).not.toBe('Marca Vecina');
  });
});

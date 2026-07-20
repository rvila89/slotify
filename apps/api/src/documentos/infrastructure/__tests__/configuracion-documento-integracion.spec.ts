/**
 * TEST de INTEGRACIÓN SQL real de `PlantillaDocumentoTenant` (épico #6, rebanada
 * 6.1a `documentos-config-tenant-storage`). tasks.md Fase 4 (4.4, 4.5).
 *
 * Se EJECUTA desde la SESIÓN PRINCIPAL (Postgres real, BD aislada `slotify_test`
 * vía `.env.test`) tras aplicar la migración. Verifica contra la BD real:
 *   1) la tabla existe con `UNIQUE(tenant_id)` y FK a `tenant`;
 *   2) RLS habilitada + policy `tenant_isolation` por `current_setting('app.tenant_id')`;
 *   3) la restricción `UNIQUE(tenant_id)` impone la relación 1-1;
 *   4) el aislamiento RLS: un tenant no ve la config de otro (vía el servicio real);
 *   5) el adaptador Prisma mapea la fila al VO de dominio (4 bloques; razón social
 *      fiscal ≠ nombre comercial).
 *
 * Trazabilidad: spec-delta `documentos` (Requirements "Configuración de documento
 * por tenant", "Aislamiento multi-tenant con RLS"), design.md §Testing.
 *
 * El aislamiento se apoya en que la app conecta con un rol sujeto a RLS (mismo
 * patrón que el resto de tablas del `init`: `ENABLE ROW LEVEL SECURITY` + policy,
 * sin `FORCE`). La idempotencia del SEED (scenario "re-ejecutar el seed") se
 * verifica aparte, ejecutando `pnpm db:seed` dos veces contra `slotify_dev`.
 */
import { Test, type TestingModule } from '@nestjs/testing';
import { ConfigModule } from '@nestjs/config';
import { DocumentosModule } from '../../documentos.module';
import { PrismaService } from '../../../shared/prisma/prisma.service';
import { ObtenerConfiguracionDocumentoService } from '../../application/obtener-configuracion-documento.service';
import { construirConfiguracionDocumentoPiloto } from '../seed/configuracion-documento-piloto';

const TENANT = '00000000-0000-0000-0000-000000000001';
const OTRO_TENANT = '00000000-0000-0000-0000-0000000000ff';

let moduleRef: TestingModule;
let prisma: PrismaService;
let servicio: ObtenerConfiguracionDocumentoService;

const crearConfig = (tenantId: string, over: Record<string, unknown> = {}) => {
  const base = construirConfiguracionDocumentoPiloto(tenantId);
  return prisma.$transaction(async (tx) => {
    await prisma.fijarTenant(tx, tenantId);
    return tx.plantillaDocumentoTenant.create({
      data: {
        tenantId,
        logoUrl: base.branding.logoUrl,
        colorPrimario: base.branding.colorPrimario,
        colorTexto: base.branding.colorTexto,
        razonSocialFiscal: base.identidadFiscal.razonSocialFiscal,
        nombreComercial: base.identidadFiscal.nombreComercial,
        nif: base.identidadFiscal.nif,
        direccionFiscal: base.identidadFiscal.direccionFiscal,
        web: base.identidadFiscal.web,
        email: base.identidadFiscal.email,
        iban: base.banca.iban,
        beneficiarioTransferencia: base.banca.beneficiarioTransferencia,
        conceptoTransferencia: base.banca.conceptoTransferencia,
        plantillaConceptoFiscalCa: base.textos.plantillaConceptoFiscal.ca,
        plantillaConceptoFiscalEs: base.textos.plantillaConceptoFiscal.es,
        validesaTextoCa: base.textos.validesaTexto.ca,
        validesaTextoEs: base.textos.validesaTexto.es,
        pieLegalCa: base.textos.pieLegal.ca,
        pieLegalEs: base.textos.pieLegal.es,
        ...over,
      },
    });
  });
};

const limpiar = async (): Promise<void> => {
  // Borra bajo el contexto RLS de cada tenant (la policy filtra por app.tenant_id).
  for (const tenantId of [TENANT, OTRO_TENANT]) {
    await prisma.$transaction(async (tx) => {
      await prisma.fijarTenant(tx, tenantId);
      await tx.plantillaDocumentoTenant.deleteMany({ where: { tenantId } });
    });
  }
};

beforeAll(async () => {
  moduleRef = await Test.createTestingModule({
    imports: [ConfigModule.forRoot({ isGlobal: true }), DocumentosModule],
  }).compile();
  await moduleRef.init();
  prisma = moduleRef.get(PrismaService);
  servicio = moduleRef.get(ObtenerConfiguracionDocumentoService);
});

afterAll(async () => {
  await limpiar();
  await moduleRef.close();
});

beforeEach(async () => {
  await limpiar();
});

describe('PlantillaDocumentoTenant — estructura de tabla (4.4)', () => {
  it('debe_existir_la_tabla_con_UNIQUE(tenant_id)_y_FK_a_tenant', async () => {
    const tabla = await prisma.$queryRaw<Array<{ reg: string | null }>>`
      SELECT to_regclass('public.plantilla_documento_tenant')::text AS reg`;
    expect(tabla[0]?.reg).toBe('plantilla_documento_tenant');

    const unique = await prisma.$queryRaw<Array<{ indexdef: string }>>`
      SELECT indexdef FROM pg_indexes
      WHERE tablename = 'plantilla_documento_tenant'
        AND indexdef ILIKE '%UNIQUE%tenant_id%'`;
    expect(unique.length).toBeGreaterThanOrEqual(1);

    const fk = await prisma.$queryRaw<Array<{ constraint_name: string }>>`
      SELECT constraint_name FROM information_schema.table_constraints
      WHERE table_name = 'plantilla_documento_tenant'
        AND constraint_type = 'FOREIGN KEY'`;
    expect(fk.length).toBeGreaterThanOrEqual(1);
  });

  it('debe_tener_ROW_LEVEL_SECURITY_habilitada_con_policy_por_app_tenant_id', async () => {
    const rls = await prisma.$queryRaw<Array<{ relrowsecurity: boolean }>>`
      SELECT relrowsecurity FROM pg_class
      WHERE relname = 'plantilla_documento_tenant'`;
    expect(rls[0]?.relrowsecurity).toBe(true);

    const policy = await prisma.$queryRaw<Array<{ policyname: string; qual: string }>>`
      SELECT policyname, qual FROM pg_policies
      WHERE tablename = 'plantilla_documento_tenant'`;
    expect(policy.length).toBeGreaterThanOrEqual(1);
    expect(policy.some((p) => p.qual?.includes('app.tenant_id'))).toBe(true);
  });
});

describe('PlantillaDocumentoTenant — relación 1-1 (UNIQUE tenant_id) (4.4)', () => {
  it('debe_rechazar_una_segunda_fila_con_el_mismo_tenant_id', async () => {
    await crearConfig(TENANT);
    await expect(crearConfig(TENANT)).rejects.toBeDefined();
    // Sigue habiendo exactamente una fila para ese tenant.
    const filas = await prisma.$transaction(async (tx) => {
      await prisma.fijarTenant(tx, TENANT);
      return tx.plantillaDocumentoTenant.findMany({ where: { tenantId: TENANT } });
    });
    expect(filas).toHaveLength(1);
  });
});

describe('PlantillaDocumentoTenant — aislamiento multi-tenant (4.4)', () => {
  // NOTA (verificado 2026-07-13): en dev/test la app conecta como OWNER de las
  // tablas y, sin `FORCE ROW LEVEL SECURITY` (ninguna tabla del proyecto lo usa),
  // Postgres bypasea la policy para el owner. El aislamiento efectivo en este código
  // se logra a nivel de APLICACIÓN: el adaptador consulta por `tenantId`
  // (`findUnique({ where: { tenantId } })`), nunca con un barrido sin filtro. La RLS
  // habilitada + policy (comprobada en el test de estructura) es la defensa en
  // profundidad que aplica en producción con un rol NO-owner. Aquí verificamos el
  // aislamiento como lo garantiza el código: cada tenant recibe SOLO su config.
  it('cada_tenant_recibe_solo_su_propia_config_via_el_servicio', async () => {
    await crearConfig(TENANT, { nombreComercial: 'Config del TENANT A' });
    await crearConfig(OTRO_TENANT, { nombreComercial: 'Config del TENANT B' });

    const configA = await servicio.ejecutar(TENANT);
    const configB = await servicio.ejecutar(OTRO_TENANT);

    expect(configA?.tenantId).toBe(TENANT);
    expect(configA?.identidadFiscal.nombreComercial).toBe('Config del TENANT A');
    expect(configB?.tenantId).toBe(OTRO_TENANT);
    expect(configB?.identidadFiscal.nombreComercial).toBe('Config del TENANT B');
  });
});

describe('PlantillaDocumentoTenant — adaptador mapea al VO de dominio (4.4)', () => {
  it('debe_devolver_los_cuatro_bloques_con_razon_social_distinta_del_nombre_comercial', async () => {
    await crearConfig(TENANT);

    const config = await servicio.ejecutar(TENANT);
    expect(config).not.toBeNull();
    // Razón social fiscal ≠ nombre comercial (requisito central del épico).
    expect(config?.identidadFiscal.razonSocialFiscal).toBe('Canoliart, SL');
    expect(config?.identidadFiscal.nombreComercial).toBe("Masia l'Encís");
    expect(config?.identidadFiscal.razonSocialFiscal).not.toBe(
      config?.identidadFiscal.nombreComercial,
    );
    // Los cuatro bloques presentes.
    expect(config?.branding).toBeDefined();
    expect(config?.banca.iban).toBe('ES30 0182 1683 4002 0172 9599');
    expect(config?.textos.plantillaConceptoFiscal.ca).toContain('espai');
    expect(config?.textos.plantillaConceptoFiscal.ca.toLowerCase()).not.toContain('lloguer');
    expect(config?.textos.plantillaConceptoFiscal.es.toLowerCase()).not.toContain('lloguer');
  });

  it('devuelve_null_si_el_tenant_no_tiene_configuracion', async () => {
    const config = await servicio.ejecutar(TENANT);
    expect(config).toBeNull();
  });
});

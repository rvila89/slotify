/**
 * Seed del tenant piloto — Masia l'Encís.
 * Provisiona: Tenant + TenantSettings + Usuario gestor (argon2),
 * 12 TemporadaCalendario, 45 Tarifa, 2 Extra.
 *
 * Usa un tenantId fijo conocido para que los tests puedan referenciarlo.
 */
import { promises as fs } from 'node:fs';
import * as path from 'node:path';
import { PrismaClient, Prisma, Temporada, Rol } from '@prisma/client';
import * as argon2 from 'argon2';
import { construirConfiguracionDocumentoPiloto } from '../src/documentos/infrastructure/seed/configuracion-documento-piloto';
import { AlmacenDocumentosLocalAdapter } from '../src/documentos/infrastructure/almacen-documentos-local.adapter';

const prisma = new PrismaClient();

// IDs fijos conocidos para tests
const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const USUARIO_ID = '00000000-0000-0000-0000-000000000002';
// Segundo tenant "vecino": existe SOLO para que los tests de aislamiento multi-tenant
// puedan sembrar datos ajenos (FK tenant_id) y verificar que NO se filtran. Sin
// settings/usuario/tarifas: es un tenant inerte de control (US-039 §Aislamiento).
const OTRO_TENANT_ID = '00000000-0000-0000-0000-0000000000ff';

// Mapeo mes -> temporada (Alta: 5-9; Media: 3,4,10,11; Baja: 12,1,2)
const TEMPORADAS_POR_MES: Array<{ mes: number; temporada: Temporada }> = [
  { mes: 1, temporada: Temporada.baja },
  { mes: 2, temporada: Temporada.baja },
  { mes: 3, temporada: Temporada.media },
  { mes: 4, temporada: Temporada.media },
  { mes: 5, temporada: Temporada.alta },
  { mes: 6, temporada: Temporada.alta },
  { mes: 7, temporada: Temporada.alta },
  { mes: 8, temporada: Temporada.alta },
  { mes: 9, temporada: Temporada.alta },
  { mes: 10, temporada: Temporada.media },
  { mes: 11, temporada: Temporada.media },
  { mes: 12, temporada: Temporada.baja },
];

// Tramos de invitados con precio (5 tramos; +51 = "a consultar", sin tarifa:
// US-016 devuelve "a consultar" cuando no hay tarifa que matchee).
const TRAMOS_INVITADOS = [
  { min: 1, max: 20 },
  { min: 21, max: 25 },
  { min: 26, max: 30 },
  { min: 31, max: 40 },
  { min: 41, max: 50 },
];

const DURACIONES = [4, 8, 12];

// Tarifas reales del dossier oficial de Masia l'Encís (IVA incluido).
// PRECIOS[temporada][idxTramo] = [precio 4h, precio 8h, precio 12h] en EUR.
// El orden de los tramos coincide con TRAMOS_INVITADOS y el de las
// columnas con DURACIONES.
const PRECIOS: Record<Temporada, number[][]> = {
  [Temporada.alta]: [
    [360, 698, 1015],
    [405, 785, 1142],
    [465, 902, 1311],
    [555, 1076, 1565],
    [615, 1193, 1734],
  ],
  [Temporada.media]: [
    [336, 651, 947],
    [378, 733, 1065],
    [434, 841, 1223],
    [518, 1004, 1460],
    [574, 1113, 1618],
  ],
  [Temporada.baja]: [
    [312, 605, 879],
    [351, 680, 989],
    [403, 781, 1136],
    [481, 933, 1356],
    [533, 1034, 1503],
  ],
};

async function main(): Promise<void> {
  // --- Tenant ---
  const tenantData = {
    nombre: "Masia l'Encís",
    emailContacto: 'info@masialencis.com',
    telefono: '+34 620 76 10 51',
    direccion: 'Avinguda del Castell, 08731, Sant Martí Sarroca (Barcelona)',
    nif: 'B10874287',
    capacidadMaxima: 50,
    activo: true,
  };
  await prisma.tenant.upsert({
    where: { idTenant: TENANT_ID },
    update: tenantData,
    create: { idTenant: TENANT_ID, ...tenantData },
  });

  // --- Segundo tenant de control (aislamiento multi-tenant) ---
  const otroTenantData = {
    nombre: 'Tenant Vecino (control de aislamiento)',
    emailContacto: 'control@otro-tenant.test',
    telefono: '+34 600 000 000',
    direccion: '—',
    nif: 'B00000000',
    capacidadMaxima: 50,
    activo: true,
  };
  await prisma.tenant.upsert({
    where: { idTenant: OTRO_TENANT_ID },
    update: otroTenantData,
    create: { idTenant: OTRO_TENANT_ID, ...otroTenantData },
  });

  // --- TenantSettings ---
  await prisma.tenantSettings.upsert({
    where: { tenantId: TENANT_ID },
    update: {},
    create: {
      tenantId: TENANT_ID,
      pctSenal: 40,
      fianzaDefaultEur: 500,
      ttlConsultaDias: 3,
      ttlPrereservaDias: 7,
      maxDiasProgramarVisita: 7,
      idioma: 'es',
    },
  });

  // --- Usuario gestor (argon2) ---
  const passwordHash = await argon2.hash('Slotify2026!');
  const usuarioData = {
    tenantId: TENANT_ID,
    email: 'info@masialencis.com',
    passwordHash,
    nombre: 'Roger',
    apellidos: 'Vilà',
    rol: Rol.gestor,
    activo: true,
  };
  await prisma.usuario.upsert({
    where: { idUsuario: USUARIO_ID },
    update: usuarioData,
    create: { idUsuario: USUARIO_ID, ...usuarioData },
  });

  // --- Fixtures de TESTS de integración (slotify_test) ---
  // Usuarios Gestor y tenant de control referenciados por los tests de integración /
  // concurrencia (p. ej. US-019 promoción manual: AUDIT_LOG con `usuario_id` del Gestor
  // exige el FK `audit_log_usuario_id_fkey`; el aislamiento multi-tenant usa un segundo
  // tenant). Idempotentes (upsert). No afectan a datos de dominio del piloto.
  const GESTORES_TEST: ReadonlyArray<{ id: string; email: string; nombre: string }> = [
    { id: '00000000-0000-0000-0000-0000000000a1', email: 'gestor-a1@slotify.test', nombre: 'Gestor A1' },
    { id: '00000000-0000-0000-0000-0000000000a2', email: 'gestor-a2@slotify.test', nombre: 'Gestor A2' },
  ];
  for (const gestor of GESTORES_TEST) {
    const data = {
      tenantId: TENANT_ID,
      email: gestor.email,
      passwordHash,
      nombre: gestor.nombre,
      rol: Rol.gestor,
      activo: true,
    };
    await prisma.usuario.upsert({
      where: { idUsuario: gestor.id },
      update: data,
      create: { idUsuario: gestor.id, ...data },
    });
  }

  // Tenant de control adicional usado por los tests de aislamiento multi-tenant que
  // siembran datos bajo este id (p. ej. US-019 integración: `OTRO_TENANT` = ...c9).
  const TENANT_CONTROL_TEST = '00000000-0000-0000-0000-0000000000c9';
  await prisma.tenant.upsert({
    where: { idTenant: TENANT_CONTROL_TEST },
    update: {},
    create: {
      idTenant: TENANT_CONTROL_TEST,
      nombre: 'Tenant Control Tests (...c9)',
      emailContacto: 'control-c9@slotify.test',
      telefono: '+34 600 000 001',
      direccion: '—',
      nif: 'B00000001',
      capacidadMaxima: 50,
      activo: true,
    },
  });

  // --- TemporadaCalendario (12 filas: una por mes) ---
  // El ER diagram (§3.8) define este modelo como mapeo `mes 1-12` -> temporada,
  // exactamente una fila por mes (12 filas). El "15 filas" de US-000 es una
  // inconsistencia del enunciado: Alta(5-9)=5 + Media(3,4,10,11)=4 + Baja(12,1,2)=3 = 12.
  await prisma.temporadaCalendario.deleteMany({ where: { tenantId: TENANT_ID } });
  await prisma.temporadaCalendario.createMany({
    data: TEMPORADAS_POR_MES.map((t) => ({ ...t, tenantId: TENANT_ID })),
  });

  // --- Tarifa (45 = 3 temporadas × 3 duraciones × 5 tramos) ---
  await prisma.tarifa.deleteMany({ where: { tenantId: TENANT_ID } });
  const tarifas: Array<{
    tenantId: string;
    temporada: Temporada;
    duracionHoras: number;
    invitadosMin: number;
    invitadosMax: number;
    precioTotalEur: number;
    vigenteDesde: Date;
  }> = [];
  const vigenteDesde = new Date('2026-01-01');
  for (const temporada of [Temporada.alta, Temporada.media, Temporada.baja]) {
    TRAMOS_INVITADOS.forEach((tramo, idxTramo) => {
      DURACIONES.forEach((duracion, idxDuracion) => {
        tarifas.push({
          tenantId: TENANT_ID,
          temporada,
          duracionHoras: duracion,
          invitadosMin: tramo.min,
          invitadosMax: tramo.max,
          precioTotalEur: PRECIOS[temporada][idxTramo][idxDuracion],
          vigenteDesde,
        });
      });
    });
  }
  await prisma.tarifa.createMany({ data: tarifas });

  // --- Extras ---
  await prisma.extra.deleteMany({ where: { tenantId: TENANT_ID } });
  await prisma.extra.createMany({
    data: [
      {
        tenantId: TENANT_ID,
        nombre: 'Barbacoa',
        descripcion: 'Servicio de barbacoa para el evento',
        precioEur: 30,
        activo: true,
      },
      {
        tenantId: TENANT_ID,
        nombre: 'Paellero',
        descripcion: 'Servicio de paellero para el evento',
        precioEur: 30,
        activo: true,
      },
    ],
  });

  // --- PlantillaDocumentoTenant del piloto (épico #6, 6.1a / 6.5) ---
  // Idempotente: deleteMany + create. El factory PURO construye los datos reales
  // (razón social ≠ nombre comercial; concepto "espai", nunca "lloguer").
  const configDocumento = construirConfiguracionDocumentoPiloto(TENANT_ID);

  // 6.5: sube el logo real del piloto al almacén DURABLE (mismo dir/baseUrl que
  // el runtime, resueltos desde env con los mismos defaults del módulo) y fija
  // `logoUrl` a la URL resultante (el factory PURO lo deja `null`). Idempotente:
  // `subir` sobrescribe el fichero; la clave es fija por tenant.
  const almacen = new AlmacenDocumentosLocalAdapter(
    path.resolve(process.env.ALMACEN_LOCAL_DIR ?? '.almacen'),
    process.env.ALMACEN_LOCAL_BASE_URL ?? 'http://localhost:3000/almacen',
  );
  const logoBytes = await fs.readFile(
    path.join(__dirname, 'seed-assets', 'masia-logo.jpg'),
  );
  const logoUrl = await almacen.subir(
    new Uint8Array(logoBytes),
    `logos/${TENANT_ID}.jpg`,
  );

  await prisma.plantillaDocumentoTenant.deleteMany({ where: { tenantId: TENANT_ID } });
  await prisma.plantillaDocumentoTenant.create({
    data: {
      tenantId: configDocumento.tenantId,
      logoUrl,
      colorPrimario: configDocumento.branding.colorPrimario,
      colorTexto: configDocumento.branding.colorTexto,
      razonSocialFiscal: configDocumento.identidadFiscal.razonSocialFiscal,
      nombreComercial: configDocumento.identidadFiscal.nombreComercial,
      nif: configDocumento.identidadFiscal.nif,
      direccionFiscal: configDocumento.identidadFiscal.direccionFiscal,
      web: configDocumento.identidadFiscal.web,
      email: configDocumento.identidadFiscal.email,
      iban: configDocumento.banca.iban,
      beneficiarioTransferencia: configDocumento.banca.beneficiarioTransferencia,
      conceptoTransferencia: configDocumento.banca.conceptoTransferencia,
      plantillaConceptoFiscalCa: configDocumento.textos.plantillaConceptoFiscal.ca,
      plantillaConceptoFiscalEs: configDocumento.textos.plantillaConceptoFiscal.es,
      validesaTextoCa: configDocumento.textos.validesaTexto.ca,
      validesaTextoEs: configDocumento.textos.validesaTexto.es,
      pieLegalCa: configDocumento.textos.pieLegal.ca,
      pieLegalEs: configDocumento.textos.pieLegal.es,
      condiciones: configDocumento.condiciones as unknown as Prisma.InputJsonValue,
    },
  });

  // --- Dossiers (PDF informativos por idioma, E1) ---
  // Los ficheros deben estar en seed-assets/. Idempotente: subir sobrescribe.
  const dossierFiles: Array<{ fichero: string; clave: string }> = [
    { fichero: 'Dossier-Masia-Encis-es.pdf', clave: 'dossiers/Dossier-Masia-Encis-es.pdf' },
    { fichero: 'Dossier-Masia-Encis-ca.pdf', clave: 'dossiers/Dossier-Masia-Encis-ca.pdf' },
  ];
  for (const dossier of dossierFiles) {
    const ruta = path.join(__dirname, 'seed-assets', dossier.fichero);
    try {
      const bytes = await fs.readFile(ruta);
      await almacen.subir(new Uint8Array(bytes), dossier.clave);
    } catch {
      // eslint-disable-next-line no-console
      console.warn(`Dossier no encontrado: ${dossier.fichero} — omitido`);
    }
  }

  const [nTemporadas, nTarifas, nExtras] = await Promise.all([
    prisma.temporadaCalendario.count({ where: { tenantId: TENANT_ID } }),
    prisma.tarifa.count({ where: { tenantId: TENANT_ID } }),
    prisma.extra.count({ where: { tenantId: TENANT_ID } }),
  ]);
  // eslint-disable-next-line no-console
  console.log(
    `Seed OK — tenant Masia l'Encís: ${nTemporadas} temporadas, ${nTarifas} tarifas, ${nExtras} extras.`,
  );
}

main()
  .catch((e) => {
    // eslint-disable-next-line no-console
    console.error(e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });

/**
 * Seed del tenant piloto — Masia l'Encís.
 * Provisiona: Tenant + TenantSettings + Usuario gestor (argon2),
 * 12 TemporadaCalendario, 45 Tarifa, 2 Extra.
 *
 * Usa un tenantId fijo conocido para que los tests puedan referenciarlo.
 */
import { PrismaClient, Temporada, Rol } from '@prisma/client';
import * as argon2 from 'argon2';

const prisma = new PrismaClient();

// IDs fijos conocidos para tests
const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const USUARIO_ID = '00000000-0000-0000-0000-000000000002';

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

// Tramos de invitados (5 tramos; >50 = "a consultar")
const TRAMOS_INVITADOS = [
  { min: 1, max: 10 },
  { min: 11, max: 20 },
  { min: 21, max: 30 },
  { min: 31, max: 50 },
  { min: 51, max: 999 },
];

const DURACIONES = [4, 8, 12];

// Multiplicadores de precio representativos
const FACTOR_TEMPORADA: Record<Temporada, number> = {
  [Temporada.alta]: 1.4,
  [Temporada.media]: 1.15,
  [Temporada.baja]: 1.0,
};
const FACTOR_DURACION: Record<number, number> = { 4: 1.0, 8: 1.6, 12: 2.1 };
const PRECIO_BASE_POR_TRAMO = [1200, 2000, 2800, 3800, 5000];

async function main(): Promise<void> {
  // --- Tenant ---
  await prisma.tenant.upsert({
    where: { idTenant: TENANT_ID },
    update: {},
    create: {
      idTenant: TENANT_ID,
      nombre: "Masia l'Encís",
      emailContacto: 'hola@masiallencis.com',
      telefono: '+34 600 000 000',
      direccion: "Camí de l'Encís, s/n, Girona",
      nif: 'B00000000',
      capacidadMaxima: 150,
      activo: true,
    },
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
  await prisma.usuario.upsert({
    where: { idUsuario: USUARIO_ID },
    update: {},
    create: {
      idUsuario: USUARIO_ID,
      tenantId: TENANT_ID,
      email: 'gestor@masiallencis.com',
      passwordHash,
      nombre: 'Gestor',
      apellidos: "Masia l'Encís",
      rol: Rol.gestor,
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
    for (const duracion of DURACIONES) {
      TRAMOS_INVITADOS.forEach((tramo, idx) => {
        const precio =
          PRECIO_BASE_POR_TRAMO[idx] *
          FACTOR_TEMPORADA[temporada] *
          FACTOR_DURACION[duracion];
        tarifas.push({
          tenantId: TENANT_ID,
          temporada,
          duracionHoras: duracion,
          invitadosMin: tramo.min,
          invitadosMax: tramo.max,
          precioTotalEur: Math.round(precio * 100) / 100,
          vigenteDesde,
        });
      });
    }
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

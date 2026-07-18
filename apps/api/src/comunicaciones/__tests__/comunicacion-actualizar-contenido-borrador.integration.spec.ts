/**
 * TEST DE INTEGRACIÓN (BD REAL) — `actualizarContenidoBorrador` del adaptador Prisma
 * (fix-borrador-e1-cuerpo-prerelleno).
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  ⚠️  REQUIERE POSTGRES REAL (`.env.test` → slotify_test) CON LAS MIGRACIONES
 *      APLICADAS. DEBE EJECUTARLO LA SESIÓN PRINCIPAL (que tiene Docker/Postgres).
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Por qué es OBLIGATORIO (no basta con dobles): la GUARDA de estado (`estado='borrador'`
 * en el `where` del `updateMany`) y el aislamiento por tenant (filtro `tenant_id`, RLS)
 * son comportamiento del motor de PostgreSQL, no del use-case. Un doble en memoria no
 * demuestra que una fila `enviado` NO se muta ni que otro tenant no la toca.
 *
 * Verifica:
 *   1. Sobre un borrador → actualiza asunto+cuerpo, SIN tocar estado ni fecha_envio.
 *   2. Sobre una fila `enviado` → NO la muta (guarda de estado).
 *   3. Cross-tenant → no muta la fila de otro tenant (aislamiento).
 *
 * Trazabilidad: spec-delta `comunicaciones` Requirement "Cableado real de E1 …"
 * (MODIFIED: el borrador E1 con comentarios nace con asunto y cuerpo renderizados);
 * `design.md` D-1/D-3.
 */
import { PrismaClient } from '@prisma/client';
import { ComunicacionRepositoryPrismaAdapter } from '../infrastructure/comunicacion.repository.prisma.adapter';

const prisma = new PrismaClient();

const TENANT_ID = '00000000-0000-0000-0000-000000000001';
const OTRO_TENANT = '00000000-0000-0000-0000-0000000000ff';
const EMAIL = 'marta.fix.borrador.e1@example.com';
const CODIGO_RESERVA = 'TST-FIX-E1-CUERPO';

let reservaId: string;
let clienteId: string;

const montarAdaptador = (): ComunicacionRepositoryPrismaAdapter =>
  new ComunicacionRepositoryPrismaAdapter(prisma);

const limpiar = async (): Promise<void> => {
  await prisma.comunicacion.deleteMany({ where: { tenantId: TENANT_ID, reservaId } });
};

beforeAll(async () => {
  const cliente = await prisma.cliente.create({
    data: { tenantId: TENANT_ID, nombre: 'Cliente Fix Borrador E1', email: EMAIL },
  });
  clienteId = cliente.idCliente;
  const reserva = await prisma.reserva.create({
    data: {
      tenantId: TENANT_ID,
      clienteId,
      codigo: CODIGO_RESERVA,
      estado: 'consulta',
      canalEntrada: 'web',
    },
  });
  reservaId = reserva.idReserva;
});

afterAll(async () => {
  await prisma.comunicacion.deleteMany({ where: { tenantId: TENANT_ID, reservaId } });
  await prisma.reserva.deleteMany({ where: { idReserva: reservaId } });
  await prisma.cliente.deleteMany({ where: { idCliente: clienteId } });
  await prisma.$disconnect();
});

beforeEach(async () => {
  await limpiar();
});

describe('ComunicacionRepositoryPrismaAdapter.actualizarContenidoBorrador (fix borrador E1)', () => {
  it('debe_rellenar_asunto_y_cuerpo_de_un_borrador_sin_tocar_estado_ni_fecha_envio', async () => {
    const repo = montarAdaptador();
    // Borrador E1 tal como lo crea el alta con comentarios: asunto placeholder, cuerpo vacío.
    const borrador = await repo.crear({
      tenantId: TENANT_ID,
      reservaId,
      clienteId,
      codigoEmail: 'E1',
      asunto: 'Hem rebut la teva consulta',
      cuerpo: '',
      destinatarioEmail: EMAIL,
      estado: 'borrador',
      fechaEnvio: null,
      esReenvio: false,
    });

    const out = await repo.actualizarContenidoBorrador({
      tenantId: TENANT_ID,
      idComunicacion: borrador.idComunicacion,
      asunto: 'ASUNTO_RENDERIZADO',
      cuerpo: '<p>CUERPO_sin_fecha</p>',
    });

    // La proyección devuelta conserva estado borrador + fecha_envio null.
    expect(out.estado).toBe('borrador');
    expect(out.fechaEnvio).toBeNull();

    // Persistencia real: asunto + cuerpo cambiados, estado/fecha intactos.
    const fila = await prisma.comunicacion.findUnique({
      where: { idComunicacion: borrador.idComunicacion },
      select: { asunto: true, cuerpo: true, estado: true, fechaEnvio: true },
    });
    expect(fila?.asunto).toBe('ASUNTO_RENDERIZADO');
    expect(fila?.cuerpo).toBe('<p>CUERPO_sin_fecha</p>');
    expect(fila?.estado).toBe('borrador');
    expect(fila?.fechaEnvio).toBeNull();
  });

  it('no_debe_mutar_una_fila_enviado_guarda_de_estado', async () => {
    const repo = montarAdaptador();
    const enviada = await repo.crear({
      tenantId: TENANT_ID,
      reservaId,
      clienteId,
      codigoEmail: 'E1',
      asunto: 'ASUNTO_ORIGINAL',
      cuerpo: '<p>original</p>',
      destinatarioEmail: EMAIL,
      estado: 'enviado',
      fechaEnvio: new Date('2026-07-18T10:00:00.000Z'),
      esReenvio: false,
    });

    await repo.actualizarContenidoBorrador({
      tenantId: TENANT_ID,
      idComunicacion: enviada.idComunicacion,
      asunto: 'NO_DEBE_APLICARSE',
      cuerpo: '<p>no aplica</p>',
    });

    const fila = await prisma.comunicacion.findUnique({
      where: { idComunicacion: enviada.idComunicacion },
      select: { asunto: true, cuerpo: true, estado: true },
    });
    // La guarda `estado='borrador'` impide el UPDATE sobre una fila enviada.
    expect(fila?.asunto).toBe('ASUNTO_ORIGINAL');
    expect(fila?.cuerpo).toBe('<p>original</p>');
    expect(fila?.estado).toBe('enviado');
  });

  it('no_debe_mutar_el_borrador_desde_otro_tenant_aislamiento', async () => {
    const repo = montarAdaptador();
    const borrador = await repo.crear({
      tenantId: TENANT_ID,
      reservaId,
      clienteId,
      codigoEmail: 'E1',
      asunto: 'ASUNTO_TENANT_DUENO',
      cuerpo: '<p>del dueño</p>',
      destinatarioEmail: EMAIL,
      estado: 'borrador',
      fechaEnvio: null,
      esReenvio: false,
    });

    // Otro tenant intenta rellenar el borrador: el filtro `tenant_id` del UPDATE y de la
    // relectura lo impide (no hay fila para ese tenant → rechaza), sin mutar la fila real.
    await expect(
      repo.actualizarContenidoBorrador({
        tenantId: OTRO_TENANT,
        idComunicacion: borrador.idComunicacion,
        asunto: 'INTRUSO',
        cuerpo: '<p>intruso</p>',
      }),
    ).rejects.toBeDefined();

    const fila = await prisma.comunicacion.findUnique({
      where: { idComunicacion: borrador.idComunicacion },
      select: { asunto: true, cuerpo: true },
    });
    expect(fila?.asunto).toBe('ASUNTO_TENANT_DUENO');
    expect(fila?.cuerpo).toBe('<p>del dueño</p>');
  });
});

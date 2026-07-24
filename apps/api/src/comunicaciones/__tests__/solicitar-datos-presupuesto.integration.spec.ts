/**
 * TEST DE INTEGRACIÓN (BD REAL) — `SolicitarDatosPresupuestoUseCase` cableado con los
 * ADAPTADORES Prisma reales contra Postgres (`slotify_test`) — change
 * `solicitud-datos-presupuesto-borrador`.
 *
 * ═══════════════════════════════════════════════════════════════════════════
 *  ⚠️  REQUIERE POSTGRES REAL + la migración `20260724120000_subtipo_solicitud_datos`.
 *      LO EJECUTA LA SESIÓN PRINCIPAL (los subagentes no tienen BD).
 * ═══════════════════════════════════════════════════════════════════════════
 *
 * Por qué es OBLIGATORIO (no basta con dobles): el test unit con dobles fijó la
 * ORQUESTACIÓN, pero NO puede demostrar (a) que el borrador persistido lleva el CUERPO de
 * la plantilla del E1 "disponible" (asunto "Pre-reserva confirmada" + "…necesitaría los
 * siguientes datos: Nombre y apellidos / DNI / Dirección y población") y NO el de la
 * plantilla del catálogo E1 (respuesta inicial "Hemos recibido tu consulta") — bug que un
 * `motor` fake enmascaró; ni (b) la coexistencia real bajo el índice UNIQUE parcial de la
 * terna `('E1','solicitud_datos')` con `('E1','fecha_disponible')`, ni el 409 tras `enviado`.
 *
 * Ejercita los adaptadores reales `CargarReservaPresupuestoContextoPrismaAdapter` (RLS) y
 * `ComunicacionRepositoryPrismaAdapter`. El AUDIT_LOG se dobla (irrelevante para la BD).
 */
import { PrismaService } from '../../shared/prisma/prisma.service';
import { ComunicacionRepositoryPrismaAdapter } from '../infrastructure/comunicacion.repository.prisma.adapter';
import { CargarReservaPresupuestoContextoPrismaAdapter } from '../infrastructure/cargar-reserva-presupuesto-contexto.prisma.adapter';
import {
  SolicitarDatosPresupuestoUseCase,
  ReservaNoEncontradaError,
  DatosFiscalesCompletosError,
} from '../application/solicitar-datos-presupuesto.use-case';
import { ComunicacionDuplicadaError } from '../domain/comunicacion.repository.port';
import type { AuditLogPort } from '../../shared/audit/audit-log.port';

const prisma = new PrismaService();
const TENANT_ID = '00000000-0000-0000-0000-000000000001';

const auditoria = {
  registrar: jest.fn(async () => undefined),
} as unknown as AuditLogPort;

const construirUseCase = (): SolicitarDatosPresupuestoUseCase =>
  new SolicitarDatosPresupuestoUseCase({
    cargarReserva: new CargarReservaPresupuestoContextoPrismaAdapter(prisma),
    comunicaciones: new ComunicacionRepositoryPrismaAdapter(prisma),
    auditoria,
  });

const clienteIds: string[] = [];
const reservaIds: string[] = [];
let seq = 0;

/** Crea CLIENTE + RESERVA de test y devuelve sus ids. Datos fiscales incompletos salvo flag. */
const sembrarReserva = async (opts: {
  idioma: string;
  fiscalCompleto?: boolean;
}): Promise<{ reservaId: string; clienteId: string }> => {
  seq += 1;
  const fiscal = opts.fiscalCompleto === true
    ? {
        dniNif: '12345678Z',
        direccion: 'Calle Mayor 1',
        codigoPostal: '08001',
        poblacion: 'Barcelona',
        provincia: 'Barcelona',
      }
    : {};
  const cliente = await prisma.cliente.create({
    data: {
      tenantId: TENANT_ID,
      nombre: 'Mercè',
      apellidos: 'Puig',
      email: `merce.solicitud.${seq}@example.com`,
      ...fiscal,
    },
  });
  const reserva = await prisma.reserva.create({
    data: {
      tenantId: TENANT_ID,
      clienteId: cliente.idCliente,
      codigo: `TST-SDP-${seq}`,
      estado: 'pre_reserva',
      canalEntrada: 'email',
      idioma: opts.idioma,
      fechaEvento: new Date('2026-09-12T00:00:00.000Z'),
      numInvitadosFinal: 80,
      duracionHoras: 'h8',
    },
  });
  clienteIds.push(cliente.idCliente);
  reservaIds.push(reserva.idReserva);
  return { reservaId: reserva.idReserva, clienteId: cliente.idCliente };
};

beforeAll(async () => {
  await prisma.$connect();
  const tenant = await prisma.tenant.findUnique({ where: { idTenant: TENANT_ID } });
  if (tenant === null) {
    throw new Error(
      `El tenant piloto ${TENANT_ID} no está sembrado en slotify_test: ejecuta el seed`,
    );
  }
});

afterAll(async () => {
  if (reservaIds.length > 0) {
    await prisma.comunicacion.deleteMany({ where: { reservaId: { in: reservaIds } } });
    await prisma.reserva.deleteMany({ where: { idReserva: { in: reservaIds } } });
  }
  if (clienteIds.length > 0) {
    await prisma.cliente.deleteMany({ where: { idCliente: { in: clienteIds } } });
  }
  await prisma.$disconnect();
});

describe('SolicitarDatosPresupuestoUseCase (integración BD real)', () => {
  it('persiste un borrador E1 solicitud_datos con el CUERPO de la plantilla disponible (castellano)', async () => {
    const { reservaId } = await sembrarReserva({ idioma: 'es' });

    const resultado = await construirUseCase().ejecutar({
      tenantId: TENANT_ID,
      usuarioId: TENANT_ID,
      reservaId,
    });

    expect(resultado.reutilizado).toBe(false);
    expect(resultado.estado).toBe('borrador');

    const fila = await prisma.comunicacion.findUniqueOrThrow({
      where: { idComunicacion: resultado.idComunicacion },
    });
    expect(fila.codigoEmail).toBe('E1');
    expect(fila.subtipo).toBe('solicitud_datos');
    expect(fila.estado).toBe('borrador');
    expect(fila.fechaEnvio).toBeNull();
    expect(fila.asunto).toBe('Pre-reserva confirmada');
    // CRUX: cuerpo de la plantilla de TRANSICIÓN, no de la respuesta inicial del catálogo.
    expect(fila.cuerpo).toContain(
      'Para poder prepararte el presupuesto, necesitaría los siguientes datos:',
    );
    expect(fila.cuerpo).toContain('Nombre y apellidos / DNI / Dirección y población');
    expect(fila.cuerpo).not.toContain('Hemos recibido tu consulta');
  });

  it('persiste el cuerpo catalán cuando idioma=ca', async () => {
    const { reservaId } = await sembrarReserva({ idioma: 'ca' });

    const resultado = await construirUseCase().ejecutar({
      tenantId: TENANT_ID,
      usuarioId: TENANT_ID,
      reservaId,
    });

    const fila = await prisma.comunicacion.findUniqueOrThrow({
      where: { idComunicacion: resultado.idComunicacion },
    });
    expect(fila.cuerpo).toContain(
      'Per poder-te preparar el pressupost, necessitaria les següents dades:',
    );
    expect(fila.cuerpo).toContain('Nom i cognoms / DNI / Adreça i població');
  });

  it('reutiliza el borrador pendiente en una segunda solicitud (no duplica fila)', async () => {
    const { reservaId } = await sembrarReserva({ idioma: 'es' });
    const uc = construirUseCase();

    const primera = await uc.ejecutar({ tenantId: TENANT_ID, usuarioId: TENANT_ID, reservaId });
    const segunda = await uc.ejecutar({ tenantId: TENANT_ID, usuarioId: TENANT_ID, reservaId });

    expect(segunda.reutilizado).toBe(true);
    expect(segunda.idComunicacion).toBe(primera.idComunicacion);
    const total = await prisma.comunicacion.count({
      where: { reservaId, codigoEmail: 'E1', subtipo: 'solicitud_datos' },
    });
    expect(total).toBe(1);
  });

  it('rechaza con 409 una segunda solicitud tras un envío consumado (una sola vez)', async () => {
    const { reservaId } = await sembrarReserva({ idioma: 'es' });
    const uc = construirUseCase();

    const creada = await uc.ejecutar({ tenantId: TENANT_ID, usuarioId: TENANT_ID, reservaId });
    // Simula el envío del borrador (lo que hace el flujo enviar-borrador).
    await prisma.comunicacion.update({
      where: { idComunicacion: creada.idComunicacion },
      data: { estado: 'enviado', fechaEnvio: new Date('2026-07-24T12:00:00.000Z') },
    });

    await expect(
      uc.ejecutar({ tenantId: TENANT_ID, usuarioId: TENANT_ID, reservaId }),
    ).rejects.toBeInstanceOf(ComunicacionDuplicadaError);

    const total = await prisma.comunicacion.count({
      where: { reservaId, codigoEmail: 'E1', subtipo: 'solicitud_datos' },
    });
    expect(total).toBe(1);
  });

  it('coexiste con un E1 fecha_disponible enviado (terna independiente, índice UNIQUE parcial)', async () => {
    const { reservaId, clienteId } = await sembrarReserva({ idioma: 'es' });
    // Un E1 `fecha_disponible` YA enviado no debe bloquear la solicitud de datos.
    await new ComunicacionRepositoryPrismaAdapter(prisma).crear({
      tenantId: TENANT_ID,
      reservaId,
      clienteId,
      codigoEmail: 'E1',
      asunto: 'Pre-reserva confirmada',
      cuerpo: 'texto fecha_disponible',
      destinatarioEmail: 'merce@example.com',
      estado: 'enviado',
      fechaEnvio: new Date('2026-07-20T09:00:00.000Z'),
      subtipo: 'fecha_disponible',
    });

    const resultado = await construirUseCase().ejecutar({
      tenantId: TENANT_ID,
      usuarioId: TENANT_ID,
      reservaId,
    });

    expect(resultado.reutilizado).toBe(false);
    const totalE1 = await prisma.comunicacion.count({
      where: { reservaId, codigoEmail: 'E1' },
    });
    expect(totalE1).toBe(2); // fecha_disponible (enviado) + solicitud_datos (borrador)
  });

  it('rechaza con 422 cuando los datos fiscales del cliente ya están completos', async () => {
    const { reservaId } = await sembrarReserva({ idioma: 'es', fiscalCompleto: true });

    await expect(
      construirUseCase().ejecutar({ tenantId: TENANT_ID, usuarioId: TENANT_ID, reservaId }),
    ).rejects.toBeInstanceOf(DatosFiscalesCompletosError);
  });

  it('rechaza con 404 una reserva inexistente para el tenant', async () => {
    await expect(
      construirUseCase().ejecutar({
        tenantId: TENANT_ID,
        usuarioId: TENANT_ID,
        reservaId: '00000000-0000-0000-0000-0000000000aa',
      }),
    ).rejects.toBeInstanceOf(ReservaNoEncontradaError);
  });
});
